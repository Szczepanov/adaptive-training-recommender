import { describe, expect, it } from 'vitest';
import { getGarminTrainingLoadAuthority } from './activityHrFidelityAdapters';
import type { NormalizedGarminActivity } from './models';

const activity = (hrMeasurement?: NormalizedGarminActivity['hrMeasurement']): NormalizedGarminActivity => ({
    activityId: 'a', date: '2026-08-29', type: 'cycling', durationMin: 60,
    trainingEffectAerobic: 3, trainingEffectAnaerobic: 0, averageHr: 145,
    activityTrainingLoad: 100, intensityTag: 'moderate', hrMeasurement,
});

describe('getGarminTrainingLoadAuthority', () => {
    it('records vendor load as HR-dependent, never independent corroboration', () => {
        const result = getGarminTrainingLoadAuthority(activity());
        expect(result).toMatchObject({ field: 'activityTrainingLoad', lineage: 'vendor_hr_dependent', independentCorroboration: false });
        expect(result.authority).toMatchObject({ status: 'BLOCKED', reasons: ['MEASUREMENT_UNAVAILABLE'] });
    });

    it('does not authorize a high trace for an unreconciled vendor summary', () => {
        const result = getGarminTrainingLoadAuthority(activity({
            externalHrSensorPresent: null, sourceForActivity: 'unknown', provenanceConfidence: 'unknown', sensorTechnology: 'unknown',
            activityMotionRisk: 'moderate', coveragePct: 100, longestGapSeconds: 1, signalQuality: 'clean',
            measurementConfidence: 'high', summaryCompatibility: 'verified_same_effective_trace', artifactFlags: [], reasons: [], diagnosticVersion: '1.0.0',
        }));
        expect(result.authority).toMatchObject({ status: 'BLOCKED', reasons: ['INPUT_LINEAGE_UNVERIFIED'] });
    });
});
