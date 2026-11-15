import { describe, expect, it } from 'vitest';
import {
    buildEarlyResponseProtocol,
    evaluatePhysiologicalAnomaly,
    isHealthAnomalyThresholdPolicy,
    SHADOW_V1_HEALTH_ANOMALY_THRESHOLDS,
    VISIBLE_V1_HEALTH_ANOMALY_THRESHOLDS,
} from './healthAnomaly';
import type {
    HealthAnomalyFeatureSet,
    HealthAnomalyInput,
    HealthCoreSignal,
    HealthCoreSignalFeatures,
} from './healthAnomalyModels';
import type { DailyRecoverySnapshot, DailySubjectiveCheckin } from '../../../ledger/models';

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

    it('explains high RHR after a long easy-stimulus ride with very_high session cost (#809)', () => {
        const longEasy = snapshot({
            yesterdayTraining: {
                hardActivityCount: 0, highCostActivityCount: 1, intensityClassificationVersion: 2,
                primaryActivity: { activityId: 1, type: 'cycling', durationMin: 240, trainingEffect: 4.3, intensityTag: 'easy', sessionCost: 'very_high' },
            },
            last3DaysHighCostSessionsCount: 1,
        });
        const result = evaluate(featureSet(3, 0, 0), { recoverySnapshot: longEasy, last3DaysHardSessionsCount: 0, last3DaysHighCostSessionsCount: 1 });
        expect(result.state).toBe('explained_recovery_strain');
        expect(result.explanations).toContainEqual(expect.objectContaining({ kind: 'hard_training', strength: 'strong', evidence: ['YESTERDAY_HIGH_COST_SESSION'] }));
        const onlyWithin3d = evaluate(featureSet(3, 0, 0), { recoverySnapshot: snapshot(), last3DaysHardSessionsCount: 0, last3DaysHighCostSessionsCount: 1 });
        expect(onlyWithin3d.explanations).toContainEqual(expect.objectContaining({ kind: 'hard_training', evidence: ['HIGH_COST_SESSION_WITHIN_3D'] }));
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
            // Backend semantics intentionally exclude today from this D-1..D-3 count.
            last3DaysHardSessionsCount: 0,
        });
        const result = evaluate(featureSet(3, 0, 0), {
            recoverySnapshot: afterWorkoutResync,
            last3DaysHardSessionsCount: 0,
        });
        expect(result.state).toBe('watch_unexplained');
        expect(result.unexplainedEvidence).toEqual(['rhr:strong_anomaly:high']);
        expect(result.explanations.some(item => item.kind === 'hard_training')).toBe(false);
    });

    it('retains the causally safe D-1 to D-3 aggregate as moderate prior-training context', () => {
        const result = evaluate(featureSet(3, 0, 0), { last3DaysHardSessionsCount: 1 });
        expect(result.state).toBe('watch_unexplained');
        expect(result.explanations).toContainEqual(expect.objectContaining({
            kind: 'hard_training',
            strength: 'moderate',
            evidence: ['HARD_SESSION_WITHIN_3D'],
        }));
        expect(result.unexplainedEvidence).toEqual(['rhr:strong_anomaly:high']);
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

describe('evaluatePhysiologicalAnomaly visible-v1 early warning calibration', () => {
    const FORBIDDEN_DIAGNOSTIC_TERMS = [
        /\bdiagnos(is|ed|tic|e)\b/i,
        /\bpatholog(y|ical)\b/i,
        /\binfection\b/i,
        /\binfectious\b/i,
        /\bcovid\b/i,
        /\binfluenza\b/i,
        /\bdisease\b/i,
        /\bcure\b/i,
        /\bprescribe medication\b/i,
        /\bmedical condition\b/i,
    ];

    function evaluateVisible(features: HealthAnomalyFeatureSet, overrides: Partial<HealthAnomalyInput> = {}) {
        const result = evaluatePhysiologicalAnomaly(
            input(features, overrides),
            'visible-v1',
            VISIBLE_V1_HEALTH_ANOMALY_THRESHOLDS,
        );
        if (!result) throw new Error('expected visible-v1 assessment');
        return result;
    }

    it('validates VISIBLE_V1_HEALTH_ANOMALY_THRESHOLDS and rejects invalid optional policy extensions', () => {
        expect(isHealthAnomalyThresholdPolicy(VISIBLE_V1_HEALTH_ANOMALY_THRESHOLDS)).toBe(true);
        expect(isHealthAnomalyThresholdPolicy({
            ...VISIBLE_V1_HEALTH_ANOMALY_THRESHOLDS,
            emergingHistoryCount: 20,
        })).toBe(false);
        expect(isHealthAnomalyThresholdPolicy({
            ...VISIBLE_V1_HEALTH_ANOMALY_THRESHOLDS,
            allowFirstNightMultiDomainEscalation: 'yes',
        })).toBe(false);
        expect(isHealthAnomalyThresholdPolicy({
            ...VISIBLE_V1_HEALTH_ANOMALY_THRESHOLDS,
            downgradeResolvingRespiration: 1,
        })).toBe(false);
    });

    it('returns insufficient_evidence without episode tracking when all core signals are unavailable', () => {
        const result = evaluateVisible({
            date: '2026-08-21',
            baselineVersion: 5,
            coreSignals: [feature('rhr', null), feature('respiration', null), feature('hrv', null)],
        });
        expect(result.state).toBe('insufficient_evidence');
        expect(result.episodeId).toBeNull();
        expect(result.episodeDay).toBeNull();
        expect(result.calibrationStage).toBe('insufficient_evidence');
        expect(result.evidenceQuality).toBe('insufficient');
        expect(result.anomalySeverity).toBe('none');
        expect(result.earlyResponse?.level).toBe('none');
        expect(result.rationale.cautions).toContain('INSUFFICIENT_WEARABLE_BASELINE_OR_SIGNALS');
    });

    it('evaluates emerging 7-13d baselines conservatively with HRV candidate fallback and caps warnings at watch', () => {
        const rhrEmerging = feature('rhr', 2.2, { historyCount: 10 });
        const respEmerging = feature('respiration', 2.6, { historyCount: 10 });
        const hrvEmerging: HealthCoreSignalFeatures = {
            signal: 'hrv',
            adverseDirection: 'low',
            candidates: [
                {
                    estimator: 'log-mean-stdev-28d',
                    status: 'unavailable',
                    unavailableReason: 'insufficient_history',
                    currentValue: null,
                    baselineValue: null,
                    scaleValue: null,
                    deltaValue: null,
                    standardizedDeviation: null,
                    baselineVersion: 5,
                },
                {
                    estimator: 'mean-stdev-28d',
                    status: 'available',
                    unavailableReason: null,
                    currentValue: 42,
                    baselineValue: 60,
                    scaleValue: 6,
                    deltaValue: -18,
                    standardizedDeviation: -3.2,
                    baselineVersion: 5,
                },
            ],
            dataQuality: {
                signal: 'hrv',
                historyCount: 10,
                recentDayCoverage: 1,
                baselineWindowStart: '2026-07-24',
                baselineWindowEndExclusive: '2026-08-21',
                baselineAgeDays: 1,
                zeroOrNearZeroScale: false,
                currentValueMissing: false,
                suspectedQuantizationOrTies: false,
                baselineMaturity: 'emerging',
            },
            measurementProvenance: 'garmin:hrvOvernightAvg',
        };

        const result = evaluateVisible({
            date: '2026-08-21',
            baselineVersion: 5,
            coreSignals: [rhrEmerging, respEmerging, hrvEmerging],
        }, {
            persistence: {
                previousState: 'watch_unexplained',
                previousEpisodeId: 'health-anomaly:2026-08-20',
                previousEpisodeDay: 1,
                previousAssessmentDate: '2026-08-20',
                unexplainedPersistenceDays: 1,
                priorUnexplainedDays: 1,
            },
        });

        expect(result.calibrationStage).toBe('emerging_baseline');
        expect(result.evidenceQuality).toBe('emerging');
        expect(result.rationale.cautions).toContain('EMERGING_BASELINE_CAUTIOUS_INTERPRETATION');
        // Emerging baseline caps non-symptom warnings at watch_unexplained
        expect(result.state).toBe('watch_unexplained');
        expect(result.earlyResponse?.level).toBe('level_1_early_watch');
        // +0.5 emerging cutoff means z=2.2 RHR is moderate (2.0..3.0), while z=-3.2 HRV is strong (<= -3.0)
        expect(result.coreSignals.find(s => s.signal === 'rhr')?.status).toBe('moderate_anomaly');
        expect(result.coreSignals.find(s => s.signal === 'hrv')?.status).toBe('strong_anomaly');
        expect(result.coreSignals.find(s => s.signal === 'hrv')?.estimator).toBe('mean-stdev-28d');
    });

    it('distinguishes reliable_baseline (0 prior illnesses) from outcome_calibrated', () => {
        const reliable = evaluateVisible(featureSet());
        expect(reliable.calibrationStage).toBe('reliable_baseline');
        expect(reliable.personalCalibration).toBeNull();

        const calibrated = evaluateVisible(featureSet(), {
            personalCalibration: {
                asOfDate: '2026-08-21',
                priorEpisodesCount: 4,
                illnessConfirmedCount: 2,
                confounderExplainedCount: 1,
                noIllnessCount: 0,
                unknownCount: 1,
                positiveRespiratoryTestsCount: 1,
                negativeRespiratoryTestsCount: 0,
                medianLeadTimeDays: 1,
                calibrationEligible: true,
            },
        });
        expect(calibrated.calibrationStage).toBe('outcome_calibrated');
        expect(calibrated.personalCalibration?.calibrationEligible).toBe(true);
    });

    it('keeps Night-1 RHR + HRV moderate anomalies in watch_unexplained as correlated_autonomic_only', () => {
        const result = evaluateVisible(featureSet(1.8, 0, -1.9));
        expect(result.state).toBe('watch_unexplained');
        expect(result.evidenceQuality).toBe('correlated_autonomic_only');
        expect(result.anomalySeverity).toBe('moderate');
        expect(result.earlyResponse?.level).toBe('level_1_early_watch');
    });

    it('escalates Night-1 multi-domain anomalies (respiration + autonomic with strong anchor) under visible-v1', () => {
        const threeSignal = evaluateVisible(featureSet(2.0, 2.8, -1.8));
        expect(threeSignal.state).toBe('possible_illness_or_systemic_stress');
        expect(threeSignal.evidenceQuality).toBe('multi_domain_corroborated');
        expect(threeSignal.anomalySeverity).toBe('strong');
        expect(threeSignal.earlyResponse?.level).toBe('level_2_persistent_or_corroborated');

        const sickContactAnchor = evaluateVisible(featureSet(0, 2.8, -1.8), {
            subjectiveCheckin: checkin({ healthContext: { closeSickContact: true } }),
        });
        expect(sickContactAnchor.state).toBe('possible_illness_or_systemic_stress');
    });

    it('resets unexplainedPersistenceDays after explained_recovery_strain so first unexplained day stays watch', () => {
        const result = evaluateVisible(featureSet(2.6, 0, -2.6), {
            persistence: {
                previousState: 'explained_recovery_strain',
                previousEpisodeId: 'health-anomaly:2026-08-20',
                previousEpisodeDay: 1,
                previousAssessmentDate: '2026-08-20',
                unexplainedPersistenceDays: 1,
            },
        });
        expect(result.persistenceDays).toBe(2);
        expect(result.unexplainedPersistenceDays).toBe(1);
        // RHR + HRV without respiration stays watch on its first unexplained night
        expect(result.state).toBe('watch_unexplained');
    });

    it('downgrades vaccination and medication_change explanations on Day 3+ (priorAdverseDays >= 2)', () => {
        const day3Vaccination = evaluateVisible(featureSet(2.6, 2.6, -2.6), {
            subjectiveCheckin: checkin({ healthContext: { recentVaccination: true } }),
            persistence: {
                previousState: 'explained_recovery_strain',
                previousEpisodeId: 'health-anomaly:2026-08-19',
                previousEpisodeDay: 2,
                previousAssessmentDate: '2026-08-20',
                unexplainedPersistenceDays: 2,
                priorUnexplainedDays: 0,
            },
        });
        expect(day3Vaccination.explanations).toContainEqual(
            expect.objectContaining({ kind: 'vaccination', strength: 'moderate' }),
        );
        expect(day3Vaccination.unexplainedEvidence.length).toBe(3);
    });

    it('downgrades resolving respiration tail under VISIBLE_V1_HEALTH_ANOMALY_THRESHOLDS', () => {
        const snap = snapshot({ respirationAvg: 15.0 });
        snap.source.metricDates = { sleep: '2026-08-21' };
        snap.derived.respiration7dAvg = 15.2;
        snap.derived.respiration28dAvg = 14.0;
        const result = evaluateVisible(featureSet(0, 2.0, 0), {
            recoverySnapshot: snap,
        });
        expect(result.respirationElevation?.status).toBe('resolving');
        expect(result.coreSignals.find(s => s.signal === 'respiration')).toMatchObject({
            status: 'normal',
            direction: null,
        });
        expect(result.state).toBe('normal');
    });

    it('issues Level 3 symptoms protocol with IOC red flags and 3-stage RTS guidance even with normal wearables', () => {
        const result = evaluateVisible(featureSet(), {
            subjectiveCheckin: checkin({
                illnessSymptoms: true,
                healthContext: { symptoms: { present: true, severity: 'moderate', types: ['sore_throat'] } },
            }),
        });
        expect(result.state).toBe('symptoms_reported');
        expect(result.earlyResponse?.level).toBe('level_3_symptoms_reported');
        expect(result.earlyResponse?.redFlagWarnings.length).toBeGreaterThanOrEqual(2);
        expect(result.earlyResponse?.returnToSportGuidance).toHaveLength(3);
        expect(result.earlyResponse?.followupPromptEligible).toBe(true);
    });

    it('keeps every earlyResponse string free of forbidden diagnostic terminology', () => {
        const protocols = [
            buildEarlyResponseProtocol({
                state: 'normal',
                unexplainedPersistenceDays: 0,
                anomalySeverity: 'none',
                evidenceQuality: 'multi_domain_corroborated',
                calibrationStage: 'reliable_baseline',
            }),
            buildEarlyResponseProtocol({
                state: 'insufficient_evidence',
                unexplainedPersistenceDays: 0,
                anomalySeverity: 'none',
                evidenceQuality: 'insufficient',
                calibrationStage: 'insufficient_evidence',
            }),
            buildEarlyResponseProtocol({
                state: 'explained_recovery_strain',
                unexplainedPersistenceDays: 0,
                anomalySeverity: 'moderate',
                evidenceQuality: 'correlated_autonomic_only',
                calibrationStage: 'reliable_baseline',
            }),
            buildEarlyResponseProtocol({
                state: 'watch_unexplained',
                unexplainedPersistenceDays: 1,
                anomalySeverity: 'mild',
                evidenceQuality: 'emerging',
                calibrationStage: 'emerging_baseline',
            }),
            buildEarlyResponseProtocol({
                state: 'possible_illness_or_systemic_stress',
                unexplainedPersistenceDays: 2,
                anomalySeverity: 'strong',
                evidenceQuality: 'multi_domain_corroborated',
                calibrationStage: 'outcome_calibrated',
            }),
            buildEarlyResponseProtocol({
                state: 'symptoms_reported',
                unexplainedPersistenceDays: 1,
                anomalySeverity: 'moderate',
                evidenceQuality: 'single_channel',
                calibrationStage: 'reliable_baseline',
            }),
        ];

        for (const protocol of protocols) {
            const texts = [
                protocol.headline,
                protocol.summary,
                protocol.reassessTiming,
                protocol.nonDiagnosticNotice,
                ...protocol.actions,
                ...protocol.redFlagWarnings,
                ...protocol.returnToSportGuidance,
            ];
            for (const text of texts) {
                for (const forbidden of FORBIDDEN_DIAGNOSTIC_TERMS) {
                    expect(text, `Forbidden term ${forbidden} matched in "${text}"`).not.toMatch(forbidden);
                }
            }
        }
    });

    it('attributes standalone short_or_poor_sleep as moderate when single-sided and strong on RHR/HRV only when concordant', () => {
        const objectiveOnly = evaluateVisible(featureSet(2.2, 0, -2.0), {
            recoverySnapshot: snapshot({ sleepScore: 52, sleepDurationSec: 5.5 * 3600 }),
            subjectiveCheckin: checkin({ sleepQuality: 7 }),
        });
        expect(objectiveOnly.explanations).toContainEqual(expect.objectContaining({
            kind: 'short_or_poor_sleep',
            strength: 'moderate',
            explainsSignals: ['rhr', 'hrv'],
            evidence: ['OBJECTIVE_POOR_SLEEP'],
        }));
        expect(objectiveOnly.state).toBe('watch_unexplained');

        const subjectiveOnly = evaluateVisible(featureSet(2.2, 0, -2.0), {
            recoverySnapshot: snapshot({ sleepScore: 82, sleepDurationSec: 7.5 * 3600 }),
            subjectiveCheckin: checkin({ sleepQuality: 3 }),
        });
        expect(subjectiveOnly.explanations).toContainEqual(expect.objectContaining({
            kind: 'short_or_poor_sleep',
            strength: 'moderate',
            evidence: ['SUBJECTIVE_POOR_SLEEP'],
        }));
        expect(subjectiveOnly.state).toBe('watch_unexplained');

        const concordantAutonomic = evaluateVisible(featureSet(2.8, 0, -2.8), {
            recoverySnapshot: snapshot({ sleepScore: 50, sleepDurationSec: 5 * 3600 }),
            subjectiveCheckin: checkin({ sleepQuality: 3 }),
        });
        expect(concordantAutonomic.state).toBe('explained_recovery_strain');
        expect(concordantAutonomic.unexplainedEvidence).toEqual([]);
        expect(concordantAutonomic.explanations).toContainEqual(expect.objectContaining({
            kind: 'short_or_poor_sleep',
            strength: 'strong',
            explainsSignals: ['rhr', 'hrv'],
            evidence: ['OBJECTIVE_AND_SUBJECTIVE_POOR_SLEEP'],
        }));

        const concordantWithResp = evaluateVisible(featureSet(2.8, 2.8, -2.8), {
            recoverySnapshot: snapshot({ sleepScore: 50, sleepDurationSec: 5 * 3600 }),
            subjectiveCheckin: checkin({ sleepQuality: 3 }),
        });
        expect(concordantWithResp.state).toBe('watch_unexplained');
        expect(concordantWithResp.unexplainedEvidence).toEqual(['respiration:strong_anomaly:high']);
    });

    it('attributes standalone psychological_stress as moderate when single-sided and strong on RHR/HRV only when concordant', () => {
        const subjectiveOnly = evaluateVisible(featureSet(2.2, 0, -2.0), {
            recoverySnapshot: snapshot({ stress: { avg: 25, max: 55 } }),
            subjectiveCheckin: checkin({ mentalStress: 8 }),
        });
        expect(subjectiveOnly.explanations).toContainEqual(expect.objectContaining({
            kind: 'psychological_stress',
            strength: 'moderate',
            explainsSignals: ['rhr', 'hrv'],
            evidence: ['SUBJECTIVE_HIGH_STRESS'],
        }));
        expect(subjectiveOnly.state).toBe('watch_unexplained');

        const objectiveOnly = evaluateVisible(featureSet(2.2, 0, -2.0), {
            recoverySnapshot: snapshot({ stress: { avg: 58, max: 85 } }),
            subjectiveCheckin: checkin({ mentalStress: 3 }),
        });
        expect(objectiveOnly.explanations).toContainEqual(expect.objectContaining({
            kind: 'psychological_stress',
            strength: 'moderate',
            evidence: ['GARMIN_HIGH_STRESS'],
        }));
        expect(objectiveOnly.state).toBe('watch_unexplained');

        const concordantAutonomic = evaluateVisible(featureSet(2.8, 0, -2.8), {
            recoverySnapshot: snapshot({ stress: { avg: 58, max: 85 } }),
            subjectiveCheckin: checkin({ mentalStress: 8 }),
        });
        expect(concordantAutonomic.state).toBe('explained_recovery_strain');
        expect(concordantAutonomic.unexplainedEvidence).toEqual([]);
        expect(concordantAutonomic.explanations).toContainEqual(expect.objectContaining({
            kind: 'psychological_stress',
            strength: 'strong',
            explainsSignals: ['rhr', 'hrv'],
            evidence: ['OBJECTIVE_AND_SUBJECTIVE_HIGH_STRESS'],
        }));

        const concordantWithResp = evaluateVisible(featureSet(2.8, 2.8, -2.8), {
            recoverySnapshot: snapshot({ stress: { avg: 58, max: 85 } }),
            subjectiveCheckin: checkin({ mentalStress: 8 }),
        });
        expect(concordantWithResp.state).toBe('watch_unexplained');
        expect(concordantWithResp.unexplainedEvidence).toEqual(['respiration:strong_anomaly:high']);
    });

    it('keeps calibrationStage at emerging_baseline and blocks escalation when only emerging signals are anomalous alongside a normal reliable signal', () => {
        const mixedFeatures: HealthAnomalyFeatureSet = {
            date: '2026-08-21',
            baselineVersion: 5,
            coreSignals: [
                feature('rhr', 0, { historyCount: 20 }),
                feature('respiration', 3.0, { historyCount: 9, recentDayCoverage: 1 }),
                feature('hrv', -3.0, { historyCount: 9, recentDayCoverage: 1 }),
            ],
        };
        const result = evaluateVisible(mixedFeatures);
        expect(result.calibrationStage).toBe('emerging_baseline');
        expect(result.state).toBe('watch_unexplained');
        expect(result.rationale.cautions).toContain('EMERGING_BASELINE_CAUTIOUS_INTERPRETATION');

        const oneReliableOneEmerging = {
            date: '2026-08-21',
            baselineVersion: 5,
            coreSignals: [
                feature('rhr', 3.0, { historyCount: 20 }),
                feature('respiration', 3.0, { historyCount: 9, recentDayCoverage: 1 }),
                feature('hrv', 0, { historyCount: 20 }),
            ],
        };
        const partial = evaluateVisible(oneReliableOneEmerging);
        expect(partial.state).toBe('watch_unexplained');
    });

    it('does not claim breathing rate was normal in correlated_autonomic_only caveats when respiration is unavailable', () => {
        const unavailableRespFeatures: HealthAnomalyFeatureSet = {
            date: '2026-08-21',
            baselineVersion: 5,
            coreSignals: [
                feature('rhr', 2.2, { historyCount: 20 }),
                feature('respiration', null, { historyCount: 20, currentValueMissing: true }),
                feature('hrv', -2.2, { historyCount: 20 }),
            ],
        };
        const result = evaluateVisible(unavailableRespFeatures);
        expect(result.state).toBe('watch_unexplained');
        expect(result.evidenceQuality).toBe('correlated_autonomic_only');
        expect(result.earlyResponse?.summary).toContain('breathing rate was unavailable');
        expect(result.earlyResponse?.summary).not.toContain('remained normal');
    });
});
