import { describe, expect, it } from 'vitest';
import { getHrUseAuthority, type HrUseCase } from './activityHrFidelity';
import type { NormalizedGarminActivity } from './models';

const activity = (overrides: Partial<NormalizedGarminActivity> = {}): NormalizedGarminActivity => ({
    activityId: 'a', date: '2026-08-29', type: 'cycling', durationMin: 60,
    trainingEffectAerobic: 3, trainingEffectAnaerobic: 0, averageHr: 145,
    activityTrainingLoad: 100, intensityTag: 'moderate',
    hrMeasurement: {
        externalHrSensorPresent: null, sourceForActivity: 'unknown', provenanceConfidence: 'unknown', sensorTechnology: 'unknown',
        activityMotionRisk: 'moderate', coveragePct: 100, longestGapSeconds: 1, signalQuality: 'clean',
        measurementConfidence: 'high', summaryCompatibility: 'verified_same_effective_trace', artifactFlags: [], reasons: [], diagnosticVersion: '1.0.0',
    }, ...overrides,
});

describe('getHrUseAuthority', () => {
    it('covers every approved use case for a verified high-confidence trace', () => {
        const cases: HrUseCase[] = ['DISPLAY_AVERAGE', 'DISPLAY_TRACE', 'ZONE_DISTRIBUTION', 'TRAINING_LOAD', 'AEROBIC_DECOUPLING', 'INTERVAL_RESPONSE', 'MAX_HR_UPDATE', 'THRESHOLD_HR_UPDATE', 'WORKOUT_COMPLIANCE'];
        for (const useCase of cases) expect(getHrUseAuthority(activity(), useCase).status).toBe('ALLOWED');
        expect(getHrUseAuthority(activity(), 'HEALTH_ANOMALY')).toMatchObject({ status: 'OBSERVATIONAL', reasons: ['HEALTH_CORROBORATION_REQUIRED'] });
    });

    it('keeps absent, unknown, and unreliable evidence distinct and fail-closed for sensitive use', () => {
        expect(getHrUseAuthority(activity({ hrMeasurement: undefined }), 'DISPLAY_AVERAGE')).toMatchObject({ status: 'OBSERVATIONAL', reasons: ['MEASUREMENT_UNAVAILABLE'] });
        for (const confidence of ['unknown', 'unreliable'] as const) {
            const candidate = activity({ hrMeasurement: { ...activity().hrMeasurement!, measurementConfidence: confidence } });
            expect(getHrUseAuthority(candidate, 'MAX_HR_UPDATE')).toMatchObject({ status: 'BLOCKED', reasons: [confidence === 'unknown' ? 'MEASUREMENT_UNKNOWN' : 'MEASUREMENT_UNRELIABLE'] });
        }
    });

    it('bounds moderate evidence only where the shadow policy permits it', () => {
        const candidate = activity({ hrMeasurement: { ...activity().hrMeasurement!, measurementConfidence: 'moderate' } });
        expect(getHrUseAuthority(candidate, 'ZONE_DISTRIBUTION').status).toBe('BOUNDED');
        expect(getHrUseAuthority(candidate, 'AEROBIC_DECOUPLING').status).toBe('BLOCKED');
    });

    it('blocks summary-dependent uses when lineage is unknown or discordant', () => {
        for (const summaryCompatibility of ['unknown', 'discordant'] as const) {
            const candidate = activity({ hrMeasurement: { ...activity().hrMeasurement!, summaryCompatibility } });
            expect(getHrUseAuthority(candidate, 'TRAINING_LOAD').status).toBe('BLOCKED');
        }
    });

    it('blocks an isolated peak only for max-HR authority', () => {
        const candidate = activity({ hrMeasurement: { ...activity().hrMeasurement!, artifactFlags: ['ISOLATED_SPIKE'] } });
        expect(getHrUseAuthority(candidate, 'MAX_HR_UPDATE')).toMatchObject({ status: 'BLOCKED', reasons: ['PEAK_ARTIFACT'] });
        expect(getHrUseAuthority(candidate, 'DISPLAY_AVERAGE').status).toBe('ALLOWED');
    });
});
