import { describe, expect, it } from 'vitest';
import {
    evaluatePhysiologicalAnomaly,
    SHADOW_V1_HEALTH_ANOMALY_THRESHOLDS,
} from './healthAnomaly';
import type {
    HealthAnomalyFeatureSet,
    HealthAnomalyInput,
    HealthCoreSignal,
    HealthCoreSignalFeatures,
} from './healthAnomalyModels';
import type { DailyRecoverySnapshot, DailySubjectiveCheckin } from './models';

function feature(
    signal: HealthCoreSignal,
    z: number | null,
    overrides: Partial<HealthCoreSignalFeatures['dataQuality']> = {},
): HealthCoreSignalFeatures {
    const estimator = SHADOW_V1_HEALTH_ANOMALY_THRESHOLDS.estimatorBySignal[signal];
    return {
        signal,
        adverseDirection: signal === 'hrv' ? 'low' : 'high',
        candidates: [{
            estimator,
            status: z === null ? 'unavailable' : 'available',
            unavailableReason: z === null ? 'missing_scale' : null,
            currentValue: z === null ? null : signal === 'hrv' ? Math.log(50) : 50 + z,
            baselineValue: z === null ? null : signal === 'hrv' ? Math.log(60) : 50,
            scaleValue: z === null ? null : 1,
            deltaValue: z === null ? null : z,
            standardizedDeviation: z,
            baselineVersion: 5,
        }],
        dataQuality: {
            signal,
            historyCount: 20,
            recentDayCoverage: 1,
            baselineWindowStart: '2026-07-24',
            baselineWindowEndExclusive: '2026-08-21',
            baselineAgeDays: 1,
            zeroOrNearZeroScale: false,
            currentValueMissing: false,
            suspectedQuantizationOrTies: false,
            ...overrides,
        },
        measurementProvenance: null,
    };
}

function featureSet(rhr = 0, respiration = 0, hrv = 0): HealthAnomalyFeatureSet {
    return {
        date: '2026-08-21',
        baselineVersion: 5,
        coreSignals: [feature('rhr', rhr), feature('respiration', respiration), feature('hrv', hrv)],
    };
}

function snapshot(overrides: Partial<DailyRecoverySnapshot['raw']> = {}): DailyRecoverySnapshot {
    return {
        userId: 'u1',
        date: '2026-08-21',
        source: { garminSyncedAt: '2026-08-21T06:00:00Z', sourceSchemaVersion: 3, timezone: 'Europe/Warsaw' },
        raw: {
            sleepScore: 85,
            sleepDurationSec: 8 * 60 * 60,
            restingHr: 50,
            hrvOvernightAvg: 60,
            hrvStatus: null,
            respirationAvg: 14,
            bodyBatteryWake: 70,
            bodyBatteryChange: 40,
            totalSteps: 8000,
            last3DaysHardSessionsCount: 0,
            yesterdayTraining: null,
            todayTraining: null,
            stress: { avg: 25, max: 70 },
            trainingReadiness: { score: 75 },
            ...overrides,
        },
        derived: {
            baselineComputationVersion: 5,
            sleepScore7dAvg: 85,
            sleepScore28dAvg: 84,
            restingHr7dAvg: 50,
            restingHr28dAvg: 50,
            hrv7dAvg: 60,
            hrv28dAvg: 60,
            respiration7dAvg: 14,
            respiration28dAvg: 14,
            hrv28dStdev: 5,
            restingHr28dStdev: 2,
            sleepScore28dStdev: 5,
            respiration28dMad: 0.5,
            deltas: {
                sleepScoreVs7d: 0,
                sleepScoreVs28d: 1,
                restingHrVs7d: 0,
                restingHrVs28d: 0,
                hrvVs7d: 0,
                hrvVs28d: 0,
                respirationVs7d: 0,
                respirationVs28d: 0,
            },
        },
        dataQuality: { sleepScoreAvailable: true, restingHrAvailable: true, hrvAvailable: true, baseline7dReady: true, baseline28dReady: true },
    } as DailyRecoverySnapshot;
}

function checkin(overrides: Partial<DailySubjectiveCheckin> = {}): DailySubjectiveCheckin {
    return {
        userId: 'u1',
        date: '2026-08-21',
        readiness: 8,
        sleepQuality: 8,
        fatigue: 2,
        soreness: 2,
        mentalStress: 2,
        motivation: 8,
        painOrInjury: false,
        illnessSymptoms: false,
        unusuallyLimitedTime: false,
        alreadyTrainedToday: false,
        availability: { timeAvailableMin: 60, preferredModalityToday: null, indoorOnly: false },
        notes: null,
        submittedAt: '2026-08-21T06:05:00Z',
        dataQuality: { isComplete: true, missingFields: [] },
        schemaVersion: 1,
        createdAt: '2026-08-21T06:05:00Z',
        updatedAt: '2026-08-21T06:05:00Z',
        ...overrides,
    };
}

function input(features: HealthAnomalyFeatureSet, overrides: Partial<HealthAnomalyInput> = {}): HealthAnomalyInput {
    return {
        date: '2026-08-21',
        timezone: 'Europe/Warsaw',
        recoverySnapshot: snapshot(),
        subjectiveCheckin: checkin(),
        features,
        coreSignals: [],
        supportingSignals: [],
        dataQuality: [],
        last3DaysHardSessionsCount: 0,
        persistence: {
            previousState: null,
            previousEpisodeId: null,
            previousEpisodeDay: null,
            previousAssessmentDate: null,
            unexplainedPersistenceDays: 0,
        },
        ...overrides,
    };
}

function evaluate(features: HealthAnomalyFeatureSet, overrides: Partial<HealthAnomalyInput> = {}) {
    const result = evaluatePhysiologicalAnomaly(input(features, overrides), 'shadow-v1');
    if (!result) throw new Error('expected assessment');
    return result;
}

describe('evaluatePhysiologicalAnomaly HA3', () => {
    it('returns normal when all adverse core channels are normal', () => {
        expect(evaluate(featureSet()).state).toBe('normal');
    });

    it('treats one high RHR after a prior hard session as explained, never possible illness', () => {
        const hard = snapshot({
            yesterdayTraining: { hardActivityCount: 1, primaryActivity: { activityId: 1, type: 'cycling', durationMin: 60, trainingEffect: 4, intensityTag: 'hard' } },
        });
        const result = evaluate(featureSet(3, 0, 0), { recoverySnapshot: hard, last3DaysHardSessionsCount: 1 });
        expect(result.state).toBe('explained_recovery_strain');
        expect(result.unexplainedEvidence).toEqual([]);
        expect(result.persistenceDays).toBe(1);
    });

    it('explains RHR-up + HRV-down after prior hard training when respiration is normal', () => {
        const hard = snapshot({
            yesterdayTraining: { hardActivityCount: 1, primaryActivity: { activityId: 1, type: 'cycling', durationMin: 60, trainingEffect: 4, intensityTag: 'hard' } },
        });
        expect(evaluate(featureSet(3, 0, -2), { recoverySnapshot: hard, last3DaysHardSessionsCount: 1 }).state)
            .toBe('explained_recovery_strain');
    });

    it('does not let same-day hard training retroactively explain morning physiology', () => {
        const afterWorkoutResync = snapshot({
            todayTraining: { hardActivityCount: 1, primaryActivity: { activityId: 2, type: 'cycling', durationMin: 75, trainingEffect: 4.2, intensityTag: 'hard' } },
            last3DaysHardSessionsCount: 1,
        });
        const result = evaluate(featureSet(3, 0, 0), {
            recoverySnapshot: afterWorkoutResync,
            last3DaysHardSessionsCount: 1,
        });
        expect(result.state).toBe('watch_unexplained');
        expect(result.unexplainedEvidence).toEqual(['rhr:strong_anomaly:high']);
        expect(result.explanations.some(item => item.kind === 'hard_training')).toBe(false);
    });

    it('creates an unexplained watch for a first-day multi-signal adverse pattern', () => {
        const result = evaluate(featureSet(3, 3, -2));
        expect(result.state).toBe('watch_unexplained');
        expect(result.unexplainedEvidence).toHaveLength(3);
        expect(result.persistenceDays).toBe(1);
    });

    it('escalates the same multi-signal residual only after the candidate persistence threshold', () => {
        const result = evaluate(featureSet(3, 3, -2), {
            persistence: {
                previousState: 'watch_unexplained',
                previousEpisodeId: 'health-anomaly:2026-08-20',
                previousEpisodeDay: 1,
                previousAssessmentDate: '2026-08-20',
                unexplainedPersistenceDays: 1,
            },
        });
        expect(result.state).toBe('possible_illness_or_systemic_stress');
        expect(result.persistenceDays).toBe(2);
        expect(result.episodeId).toBe('health-anomaly:2026-08-20');
        expect(result.episodeDay).toBe(2);
    });

    it('preserves adverse physiology persistence when strong context explains the signal', () => {
        const hard = snapshot({
            yesterdayTraining: { hardActivityCount: 1, primaryActivity: { activityId: 1, type: 'cycling', durationMin: 60, trainingEffect: 4, intensityTag: 'hard' } },
        });
        const result = evaluate(featureSet(3, 0, 0), {
            recoverySnapshot: hard,
            persistence: {
                previousState: 'explained_recovery_strain',
                previousEpisodeId: 'health-anomaly:2026-08-20',
                previousEpisodeDay: 1,
                previousAssessmentDate: '2026-08-20',
                unexplainedPersistenceDays: 1,
            },
        });
        expect(result.state).toBe('explained_recovery_strain');
        expect(result.unexplainedEvidence).toEqual([]);
        expect(result.persistenceDays).toBe(2);
        expect(result.rationale.facts).toContainEqual({ code: 'PERSISTENCE', value: 2, unit: 'days' });
    });

    it('resets persistence across a non-adjacent gap instead of carrying the prior count forward', () => {
        const result = evaluate(featureSet(3, 3, -2), {
            persistence: {
                previousState: 'watch_unexplained',
                previousEpisodeId: 'health-anomaly:2026-08-17',
                previousEpisodeDay: 3,
                previousAssessmentDate: '2026-08-18',
                unexplainedPersistenceDays: 3,
            },
        });
        expect(result.persistenceDays).toBe(1);
        expect(result.episodeDay).toBe(1);
        expect(result.state).toBe('watch_unexplained');
    });

    it('resets persistence when no previous assessment date is known, even if a prior count is supplied', () => {
        const result = evaluate(featureSet(3, 3, -2), {
            persistence: {
                previousState: 'watch_unexplained',
                previousEpisodeId: 'health-anomaly:2026-08-20',
                previousEpisodeDay: 1,
                previousAssessmentDate: null,
                unexplainedPersistenceDays: 5,
            },
        });
        expect(result.persistenceDays).toBe(1);
        expect(result.state).toBe('watch_unexplained');
    });

    it('gives explicit symptoms semantic priority even when wearables are normal', () => {
        const result = evaluate(featureSet(), {
            subjectiveCheckin: checkin({ illnessSymptoms: true }),
        });
        expect(result.state).toBe('symptoms_reported');
        expect(result.rationale.facts).toContainEqual({ code: 'SYMPTOMS_REPORTED', value: true });
    });

    it('does not fabricate a normal respiration signal when its feature is unavailable', () => {
        const features = featureSet(3, 0, -2);
        features.coreSignals[1] = feature('respiration', null);
        const result = evaluate(features);
        expect(result.coreSignals.find(item => item.signal === 'respiration')?.status).toBe('unavailable');
        expect(result.state).toBe('watch_unexplained');
    });

    it('fails a channel closed when history coverage or baseline age is inadequate', () => {
        const features = featureSet(3, 3, -2);
        features.coreSignals[0] = feature('rhr', 3, { historyCount: 13 });
        features.coreSignals[1] = feature('respiration', 3, { baselineAgeDays: 5 });
        const result = evaluate(features);
        expect(result.coreSignals.find(item => item.signal === 'rhr')?.status).toBe('unavailable');
        expect(result.coreSignals.find(item => item.signal === 'respiration')?.status).toBe('unavailable');
        expect(result.state).toBe('watch_unexplained');
    });

    it('does not reject the selected candidate for a near-zero scale on an unselected estimator', () => {
        const features = featureSet(3, 0, -2);
        // Simulates buildDataQuality's aggregate flag when a *different* candidate estimator
        // (e.g. the unselected median-mad-28d) has a near-zero scale, while the selected
        // mean-stdev-28d candidate (z = 3, scale implicitly fine) is perfectly usable.
        features.coreSignals[0] = feature('rhr', 3, { zeroOrNearZeroScale: true });
        const result = evaluate(features);
        expect(result.coreSignals.find(item => item.signal === 'rhr')?.status).toBe('strong_anomaly');
    });

    it('lets alcohol strongly explain RHR/HRV without automatically erasing respiration residual', () => {
        const result = evaluate(featureSet(3, 3, -3), {
            subjectiveCheckin: checkin({ healthContext: { alcoholDrinksLast24h: 3 } }),
        });
        expect(result.state).toBe('watch_unexplained');
        expect(result.unexplainedEvidence).toEqual(['respiration:strong_anomaly:high']);
    });

    it('combines disruptive travel with objectively poor sleep into stronger explanation', () => {
        const result = evaluate(featureSet(3, 0, -3), {
            recoverySnapshot: snapshot({ sleepScore: 45, sleepDurationSec: 5 * 60 * 60 }),
            subjectiveCheckin: checkin({ healthContext: { travelDisruption: 'timezone_shift' } }),
        });
        expect(result.state).toBe('explained_recovery_strain');
        expect(result.explanations).toContainEqual(expect.objectContaining({ kind: 'travel_or_jetlag', strength: 'strong' }));
    });

    it('keeps supporting Garmin composites from escalating core evidence', () => {
        const result = evaluate(featureSet(), {
            recoverySnapshot: snapshot({ sleepScore: 20, bodyBatteryWake: 5, stress: { avg: 90, max: 100 }, trainingReadiness: { score: 5 } }),
        });
        expect(result.supportingSignals.filter(item => item.status === 'adverse').length).toBeGreaterThan(2);
        expect(result.evidenceLevel).toBe('none');
        expect(result.state).toBe('normal');
    });

    it('never emits manual physiology supporting signals, even when Garmin core values are missing', () => {
        const missingSnapshot = snapshot({ restingHr: null, hrvOvernightAvg: null, respirationAvg: null });
        const result = evaluate(featureSet(), { recoverySnapshot: missingSnapshot });
        expect(result.supportingSignals.some(item => item.code.startsWith('MANUAL_'))).toBe(false);
        expect(result.evidenceLevel).toBe('none');
        expect(result.state).toBe('normal');
    });

    it('retains unusually high HRV as two-sided out-of-range telemetry without treating it as adverse', () => {
        const result = evaluate(featureSet(0, 0, 3));
        expect(result.coreSignals.find(item => item.signal === 'hrv')).toMatchObject({
            status: 'strong_anomaly',
            direction: 'two_sided',
        });
        expect(result.evidenceLevel).toBe('none');
        expect(result.state).toBe('normal');
    });

    it('returns null with policy off regardless of anomaly severity', () => {
        expect(evaluatePhysiologicalAnomaly(input(featureSet(4, 4, -4)), 'off')).toBeNull();
    });

    it('fails closed for malformed threshold policy', () => {
        const malformed = { ...SHADOW_V1_HEALTH_ANOMALY_THRESHOLDS, strongDeviation: 1 };
        expect(evaluatePhysiologicalAnomaly(input(featureSet(4, 4, -4)), 'shadow-v1', malformed)).toBeNull();
    });
});
