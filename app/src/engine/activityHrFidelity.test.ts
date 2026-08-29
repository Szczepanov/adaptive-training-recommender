import { describe, expect, it } from 'vitest';
import {
    getHrUseAuthority,
    type HrAuthorityStatus,
    type HrUseAuthorityContext,
    type HrUseCase,
} from './activityHrFidelity';
import type { HrMeasurement, NormalizedGarminActivity } from './models';

const highMeasurement: HrMeasurement = {
    externalHrSensorPresent: true,
    sourceForActivity: 'external',
    provenanceConfidence: 'confirmed',
    sensorTechnology: 'electrode_chest_strap',
    activityMotionRisk: 'low',
    coveragePct: 99,
    longestGapSeconds: 1,
    signalQuality: 'clean',
    measurementConfidence: 'high',
    summaryCompatibility: 'verified_same_effective_trace',
    artifactFlags: [],
    reasons: [],
    diagnosticVersion: '1.0.0',
};

const activity = (measurement: Partial<HrMeasurement> = {}): NormalizedGarminActivity => ({
    activityId: 'a',
    date: '2026-08-29',
    type: 'cycling',
    durationMin: 60,
    trainingEffectAerobic: 3,
    trainingEffectAnaerobic: 0,
    averageHr: 145,
    activityTrainingLoad: 100,
    intensityTag: 'moderate',
    hrMeasurement: { ...highMeasurement, ...measurement },
});

const fullContext: HrUseAuthorityContext = {
    inputLineageVerified: true,
    segmentContextVerified: true,
    peakContextVerified: true,
    thresholdProtocolVerified: true,
    healthAnomalyCorroborated: true,
};

const allUseCases: HrUseCase[] = [
    'DISPLAY_AVERAGE',
    'DISPLAY_TRACE',
    'ZONE_DISTRIBUTION',
    'TRAINING_LOAD',
    'TRAINING_EFFECT',
    'AEROBIC_DECOUPLING',
    'INTERVAL_RESPONSE',
    'MAX_HR_UPDATE',
    'THRESHOLD_HR_UPDATE',
    'WORKOUT_COMPLIANCE',
    'HEALTH_ANOMALY',
];

describe('getHrUseAuthority', () => {
    it('allows every high-confidence use only when all of its feature-specific prerequisites are supplied', () => {
        for (const useCase of allUseCases) {
            expect(getHrUseAuthority(activity(), useCase, fullContext)).toMatchObject({
                status: 'ALLOWED',
                policyVersion: 'hrf5-shadow-v1',
            });
        }
    });

    it('matches the approved moderate-confidence policy without mislabeling moderate evidence as low', () => {
        const expected: Record<HrUseCase, HrAuthorityStatus> = {
            DISPLAY_AVERAGE: 'ALLOWED',
            DISPLAY_TRACE: 'ALLOWED',
            ZONE_DISTRIBUTION: 'BOUNDED',
            TRAINING_LOAD: 'BOUNDED',
            TRAINING_EFFECT: 'BOUNDED',
            AEROBIC_DECOUPLING: 'BLOCKED',
            INTERVAL_RESPONSE: 'BOUNDED',
            MAX_HR_UPDATE: 'BLOCKED',
            THRESHOLD_HR_UPDATE: 'BLOCKED',
            WORKOUT_COMPLIANCE: 'BOUNDED',
            HEALTH_ANOMALY: 'OBSERVATIONAL',
        };
        const candidate = activity({ measurementConfidence: 'moderate' });

        for (const useCase of allUseCases) {
            const authority = getHrUseAuthority(candidate, useCase, fullContext);
            expect(authority.status).toBe(expected[useCase]);
            if (authority.status !== 'ALLOWED') {
                expect(authority.reasons).toContain('MODERATE_MEASUREMENT_CONFIDENCE');
                expect(authority.reasons).not.toContain('LOW_MEASUREMENT_CONFIDENCE');
            }
        }
    });

    it('fails closed when exact child lineage or feature context has not been verified', () => {
        expect(getHrUseAuthority(activity(), 'ZONE_DISTRIBUTION')).toMatchObject({
            status: 'BLOCKED', reasons: ['INPUT_LINEAGE_UNVERIFIED'],
        });
        expect(getHrUseAuthority(activity(), 'TRAINING_LOAD')).toMatchObject({
            status: 'BLOCKED', reasons: ['INPUT_LINEAGE_UNVERIFIED'],
        });
        expect(getHrUseAuthority(activity(), 'TRAINING_EFFECT')).toMatchObject({
            status: 'BLOCKED', reasons: ['INPUT_LINEAGE_UNVERIFIED'],
        });
        expect(getHrUseAuthority(activity(), 'AEROBIC_DECOUPLING', { inputLineageVerified: true })).toMatchObject({
            status: 'BLOCKED', reasons: ['SEGMENT_CONTEXT_UNVERIFIED'],
        });
        expect(getHrUseAuthority(activity(), 'INTERVAL_RESPONSE', { inputLineageVerified: true })).toMatchObject({
            status: 'BLOCKED', reasons: ['SEGMENT_CONTEXT_UNVERIFIED'],
        });
        expect(getHrUseAuthority(activity(), 'MAX_HR_UPDATE', { inputLineageVerified: true })).toMatchObject({
            status: 'BLOCKED', reasons: ['PEAK_CONTEXT_UNVERIFIED'],
        });
        expect(getHrUseAuthority(activity(), 'THRESHOLD_HR_UPDATE', { inputLineageVerified: true })).toMatchObject({
            status: 'BLOCKED', reasons: ['THRESHOLD_PROTOCOL_UNVERIFIED'],
        });
    });

    it('lets an audited exact input lineage supersede a broad unknown scalar but never a known contradiction', () => {
        const unknown = activity({ summaryCompatibility: 'unknown' });
        expect(getHrUseAuthority(unknown, 'ZONE_DISTRIBUTION')).toMatchObject({
            status: 'BLOCKED', reasons: ['SUMMARY_LINEAGE_UNVERIFIED'],
        });
        expect(getHrUseAuthority(unknown, 'ZONE_DISTRIBUTION', { inputLineageVerified: true }).status).toBe('ALLOWED');

        const discordant = activity({ summaryCompatibility: 'discordant' });
        expect(getHrUseAuthority(discordant, 'ZONE_DISTRIBUTION', { inputLineageVerified: true })).toMatchObject({
            status: 'BLOCKED', reasons: ['SUMMARY_LINEAGE_DISCORDANT'],
        });
    });

    it('keeps absent, unknown, unreliable, and low evidence distinct', () => {
        const absent = { ...activity(), hrMeasurement: undefined };
        expect(getHrUseAuthority(absent, 'DISPLAY_AVERAGE')).toMatchObject({
            status: 'OBSERVATIONAL', reasons: ['MEASUREMENT_UNAVAILABLE'],
        });
        expect(getHrUseAuthority(absent, 'MAX_HR_UPDATE', fullContext)).toMatchObject({
            status: 'BLOCKED', reasons: ['MEASUREMENT_UNAVAILABLE'],
        });

        const expectedReason = {
            unknown: 'MEASUREMENT_UNKNOWN',
            unreliable: 'MEASUREMENT_UNRELIABLE',
            low: 'LOW_MEASUREMENT_CONFIDENCE',
        } as const;
        for (const confidence of ['unknown', 'unreliable', 'low'] as const) {
            const candidate = activity({ measurementConfidence: confidence });
            expect(getHrUseAuthority(candidate, 'DISPLAY_TRACE').status).toBe('OBSERVATIONAL');
            expect(getHrUseAuthority(candidate, 'MAX_HR_UPDATE', fullContext)).toMatchObject({
                status: 'BLOCKED', reasons: [expectedReason[confidence]],
            });
        }
    });

    it('preserves an isolated-spike reason specifically for max-HR authority', () => {
        const candidate = activity({ artifactFlags: ['ISOLATED_SPIKE'] });
        expect(getHrUseAuthority(candidate, 'MAX_HR_UPDATE', fullContext)).toMatchObject({
            status: 'BLOCKED', reasons: ['PEAK_ARTIFACT'],
        });
        expect(getHrUseAuthority(candidate, 'DISPLAY_AVERAGE').status).toBe('ALLOWED');

        const realisticHrf3Candidate = activity({
            artifactFlags: ['ISOLATED_SPIKE'],
            measurementConfidence: 'low',
            signalQuality: 'suspect',
        });
        const authority = getHrUseAuthority(realisticHrf3Candidate, 'MAX_HR_UPDATE', fullContext);
        expect(authority.status).toBe('BLOCKED');
        expect(authority.reasons).toContain('LOW_MEASUREMENT_CONFIDENCE');
        expect(authority.reasons).toContain('PEAK_ARTIFACT');
    });

    it('does not borrow summary lineage for workout compliance', () => {
        const candidate = activity({ summaryCompatibility: 'discordant' });
        expect(getHrUseAuthority(candidate, 'WORKOUT_COMPLIANCE').status).toBe('ALLOWED');
        expect(getHrUseAuthority(
            activity({ summaryCompatibility: 'discordant', measurementConfidence: 'moderate' }),
            'WORKOUT_COMPLIANCE',
        )).toMatchObject({
            status: 'BOUNDED', reasons: ['MODERATE_MEASUREMENT_CONFIDENCE'],
        });
    });

    it('requires independent health corroboration and never promotes moderate evidence above observational', () => {
        expect(getHrUseAuthority(activity(), 'HEALTH_ANOMALY')).toMatchObject({
            status: 'OBSERVATIONAL', reasons: ['HEALTH_CORROBORATION_REQUIRED'],
        });
        expect(getHrUseAuthority(activity(), 'HEALTH_ANOMALY', { healthAnomalyCorroborated: true })).toMatchObject({
            status: 'ALLOWED', reasons: [],
        });
        expect(getHrUseAuthority(
            activity({ measurementConfidence: 'moderate' }),
            'HEALTH_ANOMALY',
            { healthAnomalyCorroborated: true },
        )).toMatchObject({
            status: 'OBSERVATIONAL', reasons: ['MODERATE_MEASUREMENT_CONFIDENCE'],
        });
        expect(getHrUseAuthority(
            activity({ measurementConfidence: 'low' }),
            'HEALTH_ANOMALY',
            { healthAnomalyCorroborated: true },
        )).toMatchObject({
            status: 'BLOCKED', reasons: ['LOW_MEASUREMENT_CONFIDENCE'],
        });
    });
});
