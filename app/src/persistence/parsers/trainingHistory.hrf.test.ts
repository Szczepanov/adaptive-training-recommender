import { expect, it } from 'vitest';
import { parseNormalizedGarminActivity } from './trainingHistory';

const activity = {
    activityId: 'a-1',
    date: '2026-08-06',
    type: 'cycling',
    durationMin: 45,
    trainingEffectAerobic: 3.2,
    trainingEffectAnaerobic: null,
    averageHr: 150,
    activityTrainingLoad: 115,
    intensityTag: 'hard',
};

const validHrMeasurement = {
    externalHrSensorPresent: null,
    sourceForActivity: 'unknown',
    provenanceConfidence: 'unknown',
    sensorTechnology: 'unknown',
    activityMotionRisk: 'moderate',
    coveragePct: 100,
    longestGapSeconds: 1,
    signalQuality: 'clean',
    measurementConfidence: 'moderate',
    summaryCompatibility: 'unknown',
    artifactFlags: [],
    reasons: ['SOURCE_UNKNOWN'],
    diagnosticVersion: '1.0.0',
};

it('drops HR measurement metadata with coverage above 100 percent without invalidating the activity', () => {
    const parsed = parseNormalizedGarminActivity({
        ...activity,
        hrMeasurement: { ...validHrMeasurement, coveragePct: 100.1 },
    }, 'users/u1/activities/a-1', 'a-1');

    expect(parsed).toMatchObject({ status: 'AVAILABLE', data: { activityId: 'a-1' } });
    if (parsed.status !== 'AVAILABLE') throw new Error('expected available activity');
    expect(parsed.data.hrMeasurement).toBeUndefined();
});

it('accepts the valid upper coverage bound', () => {
    const parsed = parseNormalizedGarminActivity({
        ...activity,
        hrMeasurement: validHrMeasurement,
    }, 'users/u1/activities/a-1', 'a-1');

    expect(parsed).toMatchObject({
        status: 'AVAILABLE',
        data: { hrMeasurement: { coveragePct: 100 } },
    });
});
