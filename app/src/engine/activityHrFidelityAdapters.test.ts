import { describe, expect, it } from 'vitest';
import {
    getGarminHrDependentAuthority,
    getGarminTrainingEffectAuthority,
    getGarminTrainingLoadAuthority,
} from './activityHrFidelityAdapters';
import type { NormalizedGarminActivity } from './models';

const activity = (hrMeasurement?: NormalizedGarminActivity['hrMeasurement']): NormalizedGarminActivity => ({
    activityId: 'a', date: '2026-08-29', type: 'cycling', durationMin: 60,
    trainingEffectAerobic: 3, trainingEffectAnaerobic: 2, averageHr: 145,
    activityTrainingLoad: 100, intensityTag: 'moderate', hrMeasurement,
});

const reconciledHighConfidenceMeasurement = (): NonNullable<NormalizedGarminActivity['hrMeasurement']> => ({
    externalHrSensorPresent: null,
    sourceForActivity: 'unknown',
    provenanceConfidence: 'unknown',
    sensorTechnology: 'unknown',
    activityMotionRisk: 'moderate',
    coveragePct: 100,
    longestGapSeconds: 1,
    signalQuality: 'clean',
    measurementConfidence: 'high',
    summaryCompatibility: 'verified_same_effective_trace',
    artifactFlags: [],
    reasons: [],
    diagnosticVersion: '1.0.0',
});

describe('Garmin HR-dependent vendor authority', () => {
    it('records training load as HR-dependent, never independent corroboration', () => {
        const result = getGarminTrainingLoadAuthority(activity());
        expect(result).toMatchObject({
            field: 'activityTrainingLoad',
            lineage: 'vendor_hr_dependent',
            independentCorroboration: false,
        });
        expect(result.authority).toMatchObject({
            status: 'BLOCKED',
            reasons: ['MEASUREMENT_UNAVAILABLE'],
        });
    });

    it('classifies both Training Effect fields on the same vendor HR-dependent lineage', () => {
        const aerobic = getGarminTrainingEffectAuthority(activity(), 'trainingEffectAerobic');
        const anaerobic = getGarminTrainingEffectAuthority(activity(), 'trainingEffectAnaerobic');

        for (const result of [aerobic, anaerobic]) {
            expect(result).toMatchObject({
                lineage: 'vendor_hr_dependent',
                independentCorroboration: false,
            });
            expect(result.authority).toMatchObject({
                status: 'BLOCKED',
                reasons: ['MEASUREMENT_UNAVAILABLE'],
            });
        }
    });

    it('does not authorize any vendor summary from a reconciled high-confidence trace alone', () => {
        const sourceActivity = activity(reconciledHighConfidenceMeasurement());

        for (const field of [
            'activityTrainingLoad',
            'trainingEffectAerobic',
            'trainingEffectAnaerobic',
        ] as const) {
            const result = getGarminHrDependentAuthority(sourceActivity, field);
            expect(result.authority).toMatchObject({
                status: 'BLOCKED',
                reasons: ['INPUT_LINEAGE_UNVERIFIED'],
            });
        }
    });

    it('does not treat anaerobic Training Effect power/pace inputs as independent HR corroboration', () => {
        const result = getGarminTrainingEffectAuthority(
            activity(reconciledHighConfidenceMeasurement()),
            'trainingEffectAnaerobic',
        );

        expect(result).toMatchObject({
            field: 'trainingEffectAnaerobic',
            lineage: 'vendor_hr_dependent',
            independentCorroboration: false,
        });
        expect(result.authority.status).toBe('BLOCKED');
        expect(result.authority.reasons).toEqual(['INPUT_LINEAGE_UNVERIFIED']);
    });
});
