import { describe, expect, it } from 'vitest';
import { mapCheckinToSubjectiveInput, mapContextFromGoalsAndTrainingSettings, mapSnapshotToEngineInput, resolveClinicalEnvelopeSources, resolveRedFlagFindings } from './adapters';
import type {
    DailyRecoverySnapshot,
    DailySubjectiveCheckin,
    TrainingSettings,
    UserPreferences,
} from './models';

function testTrainingSettings(overrides: Partial<TrainingSettings> = {}): TrainingSettings {
    return {
        userId: 'athlete', schemaVersion: 2,
        equipment: { free_weights: true, cable_machine: false, treadmill: false, indoor_bike: true, pullup_bar: false },
        guardrails: { avoid_high_impact: false, avoid_heavy_lower_body: false, avoid_overhead_pressing: false, avoid_heavy_spinal_loading: false },
        defaults: { weekdayMaxMinutes: 45, weekendMaxMinutes: 120, environment: 'either' },
        preferences: { preferActiveRecovery: false },
        migration: { legacyReviewed: true, migratedAt: null },
        createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
        ...overrides,
    };
}

function testCheckin(overrides: Partial<DailySubjectiveCheckin> = {}): DailySubjectiveCheckin {
    return {
        userId: 'athlete', date: '2026-08-08',
        readiness: 8, sleepQuality: 8, fatigue: 3, soreness: 3, mentalStress: 3, motivation: 8,
        painOrInjury: false, illnessSymptoms: false, unusuallyLimitedTime: false, alreadyTrainedToday: false,
        availability: { timeAvailableMin: 60, preferredModalityToday: null, indoorOnly: false },
        notes: null, submittedAt: '2026-08-08T07:00:00.000Z',
        dataQuality: { isComplete: true, missingFields: [] },
        schemaVersion: 1, createdAt: '2026-08-08T07:00:00.000Z', updatedAt: '2026-08-08T07:00:00.000Z',
        ...overrides,
    };
}

function respirationSnapshot(
    baselineComputationVersion: number,
    respiration28dMad: number | null | undefined,
): DailyRecoverySnapshot {
    return {
        raw: {
            totalSteps: null,
            sleepScore: null,
            sleepDurationSec: null,
            restingHr: null,
            hrvOvernightAvg: null,
            respirationAvg: 17,
            bodyBatteryWake: null,
            last3DaysHardSessionsCount: 0,
            yesterdayTraining: null,
            todayTraining: null,
        },
        derived: {
            baselineComputationVersion,
            restingHr7dAvg: null,
            hrv7dAvg: null,
            steps7dAvg: null,
            steps28dAvg: null,
            hrv28dStdev: null,
            restingHr28dStdev: null,
            sleepScore28dStdev: null,
            steps28dStdev: null,
            respiration28dMad,
            deltas: {
                sleepScoreVs7d: null,
                sleepScoreVs28d: null,
                restingHrVs7d: null,
                restingHrVs28d: null,
                hrvVs7d: null,
                hrvVs28d: null,
                respirationVs7d: 2,
                respirationVs28d: 3,
                stepsVs7d: null,
                stepsVs28d: null,
            },
        },
    } as unknown as DailyRecoverySnapshot;
}

describe('mapSnapshotToEngineInput respiration baseline compatibility', () => {
    it('keeps respiration decision-inert by default even for a complete v3 median/MAD baseline', () => {
        const objective = mapSnapshotToEngineInput(respirationSnapshot(3, 0.8));

        expect(objective.respiration_delta).toBeNull();
        expect(objective.respiration_delta_28d).toBeNull();
        expect(objective.respiration_mad_28d).toBeNull();
    });

    it('keeps pre-v3 mean-based respiration deltas inert even when comparison scoring is enabled', () => {
        const objective = mapSnapshotToEngineInput(
            respirationSnapshot(2, undefined),
            'median-mad-v1',
        );

        expect(objective.respiration_delta).toBeNull();
        expect(objective.respiration_delta_28d).toBeNull();
        expect(objective.respiration_mad_28d).toBeNull();
    });

    it('keeps v3+ respiration inert until a 28d MAD is actually available', () => {
        const objective = mapSnapshotToEngineInput(
            respirationSnapshot(3, null),
            'median-mad-v1',
        );

        expect(objective.respiration_delta).toBeNull();
        expect(objective.respiration_delta_28d).toBeNull();
        expect(objective.respiration_mad_28d).toBeNull();
    });

    it('forwards the v3 median/MAD signal only under the explicit comparison policy', () => {
        const objective = mapSnapshotToEngineInput(
            respirationSnapshot(3, 0.8),
            'median-mad-v1',
        );

        expect(objective.respiration_delta).toBe(2);
        expect(objective.respiration_delta_28d).toBe(3);
        expect(objective.respiration_mad_28d).toBe(0.8);
    });
});

function sleepDecisionAuthoritySnapshot(baselineComputationVersion: number): DailyRecoverySnapshot {
    return {
        raw: {
            totalSteps: null,
            sleepScore: null,
            sleepDurationSec: null,
            restingHr: null,
            hrvOvernightAvg: null,
            respirationAvg: null,
            bodyBatteryWake: null,
            last3DaysHardSessionsCount: 0,
            yesterdayTraining: null,
            todayTraining: null,
        },
        derived: {
            baselineComputationVersion,
            restingHr7dAvg: null,
            hrv7dAvg: null,
            steps7dAvg: null,
            steps28dAvg: null,
            hrv28dStdev: null,
            restingHr28dStdev: null,
            sleepScore28dStdev: null,
            steps28dStdev: null,
            sleepDurationAccumulated2dDeficitSec: 3300, // 55 min
            sleepDurationAccumulated3dDeficitSec: 4200, // 70 min
            bedtime7dCircularMeanMinutes: 1350,
            deltas: {
                sleepScoreVs7d: null,
                sleepScoreVs28d: null,
                restingHrVs7d: null,
                restingHrVs28d: null,
                hrvVs7d: null,
                hrvVs28d: null,
                respirationVs7d: null,
                respirationVs28d: null,
                stepsVs7d: null,
                stepsVs28d: null,
                sleepDurationVs7dMedian: -1200, // -20 min (20 min short)
                sleepDurationVs28dMedian: -900,
                bedtimeDeviationVs7dMinutes: 15,
                bedtimeDeviationVs28dMinutes: 10,
                wakeTimeDeviationVs7dMinutes: -5,
                wakeTimeDeviationVs28dMinutes: -3,
                sleepMidpointDeviationVs7dMinutes: 8,
                sleepMidpointDeviationVs28dMinutes: 6,
            },
        },
    } as unknown as DailyRecoverySnapshot;
}

describe('mapSnapshotToEngineInput sleep-decision-authority (Phase 2/3) fields', () => {
    it('leaves every sleep-decision-authority field null below baselineComputationVersion 6', () => {
        const objective = mapSnapshotToEngineInput(sleepDecisionAuthoritySnapshot(5));

        expect(objective.sleep_duration_delta_7d_min).toBeNull();
        expect(objective.sleep_duration_delta_28d_min).toBeNull();
        expect(objective.sleep_duration_accumulated_2d_deficit_min).toBeNull();
        expect(objective.sleep_duration_accumulated_3d_deficit_min).toBeNull();
        expect(objective.bedtime_deviation_7d_min).toBeNull();
        expect(objective.wake_time_deviation_7d_min).toBeNull();
        expect(objective.sleep_midpoint_deviation_7d_min).toBeNull();
    });

    it('converts seconds to minutes for duration/deficit fields at baselineComputationVersion 6+', () => {
        const objective = mapSnapshotToEngineInput(sleepDecisionAuthoritySnapshot(6));

        expect(objective.sleep_duration_delta_7d_min).toBe(-20);
        expect(objective.sleep_duration_delta_28d_min).toBe(-15);
        expect(objective.sleep_duration_accumulated_2d_deficit_min).toBe(55);
        expect(objective.sleep_duration_accumulated_3d_deficit_min).toBe(70);
    });

    it('passes bedtime/wake-time/sleep-midpoint deviations through unconverted (already minutes)', () => {
        const objective = mapSnapshotToEngineInput(sleepDecisionAuthoritySnapshot(6));

        expect(objective.bedtime_deviation_7d_min).toBe(15);
        expect(objective.bedtime_deviation_28d_min).toBe(10);
        expect(objective.wake_time_deviation_7d_min).toBe(-5);
        expect(objective.wake_time_deviation_28d_min).toBe(-3);
        expect(objective.sleep_midpoint_deviation_7d_min).toBe(8);
        expect(objective.sleep_midpoint_deviation_28d_min).toBe(6);
    });
});

describe('mapContextFromGoalsAndTrainingSettings (Phase 5.4 tissue response wiring)', () => {
    it('turns persisted unavailable modalities into hard engine restrictions', () => {
        const preferences: UserPreferences = {
            userId: 'athlete', preferredRecoveryStyle: 'mixed', defaultWeekdayTimeMin: 45, defaultWeekendTimeMin: 60,
            preferredTimeOfDay: 'flexible', preferredModalities: [], deprioritizedModalities: [], avoidedModalities: [],
            unavailableModalities: ['Cycling'], explanationVerbosity: 'detailed', conservativeBias: false,
            preferredUnits: { distance: 'km', weight: 'kg', temperature: 'celsius' }, schemaVersion: 1,
            createdAt: '', updatedAt: '',
        };

        const context = mapContextFromGoalsAndTrainingSettings([], testTrainingSettings(), preferences, '2026-08-08');
        expect(context.constraints.restrictedModalities).toContain('Cycling');
    });

    it("threads today's tissue response into the injury gate, tightening a monitor-only knee constraint", () => {
        const settings = testTrainingSettings({ injuries: [{ region: 'knee', severity: 'monitor' }] });
        const checkin = testCheckin({
            painOrInjury: true,
            tissueResponses: { knee: { region: 'knee', morningState: 'normal', painDuringTraining: 'severe' } },
        });

        const context = mapContextFromGoalsAndTrainingSettings([], settings, null, '2026-08-08', checkin);

        expect(context.constraints.restrictedModalities).toContain('Running');
        expect(context.injuryPolicyTrace).toEqual({
            tissueSeverityApplied: true,
            regionMappingFamilies: ['lower_limb_impact'],
            clinicalEnvelopeSources: ['pain_or_injury'],
        });
    });

    it("a high-readiness, no-pain check-in leaves an existing constraint's restrictions exactly as they were", () => {
        const settings = testTrainingSettings({ injuries: [{ region: 'knee', severity: 'exclude', reviewBy: '2026-09-01' }] });
        const checkin = testCheckin({ readiness: 10 });

        const context = mapContextFromGoalsAndTrainingSettings([], settings, null, '2026-08-08', checkin);

        expect(context.constraints.restrictedModalities).toContain('Running');
    });

    it('behaves the same with no check-in supplied at all (backward compatible)', () => {
        const settings = testTrainingSettings({ injuries: [{ region: 'shoulder', severity: 'limit' }] });
        const context = mapContextFromGoalsAndTrainingSettings([], settings, null, '2026-08-08');
        expect(context.constraints.impliedGuardrails).toContain('avoid_overhead_pressing');
    });

    // Regression coverage for the Home.tsx forecast-leak bug: a today-only tissue-derived
    // restriction (no standing InjuryConstraint at all) must restrict a decision built WITH
    // today's checkin, but must NOT restrict a decision built without one -- which is
    // exactly the distinction Home.tsx's `context` (today) vs `forecastContext`
    // (tomorrow's provisional plan and the week-ahead strip) relies on to keep a single
    // day's tissue flag from silently blocking Running on every projected day of the week.
    it("a today-only tissue-derived restriction (no standing InjuryConstraint) restricts today's context but not a forecast context built without the checkin", () => {
        const settings = testTrainingSettings({ injuries: [] });
        const checkin = testCheckin({
            painOrInjury: true,
            tissueResponses: { knee: { region: 'knee', morningState: 'severe' } },
        });

        const todayContext = mapContextFromGoalsAndTrainingSettings([], settings, null, '2026-08-08', checkin);
        expect(todayContext.constraints.restrictedModalities).toContain('Running');

        const forecastContext = mapContextFromGoalsAndTrainingSettings([], settings, null, '2026-08-08', null);
        expect(forecastContext.constraints.restrictedModalities).not.toContain('Running');
    });
});

describe('mapCheckinToSubjectiveInput painFlag (allergy-aware illness gating)', () => {
    it('records compact clinical-envelope origins without raw symptom detail', () => {
        expect(resolveClinicalEnvelopeSources(testCheckin({ painOrInjury: true }))).toEqual(['pain_or_injury']);
        expect(resolveClinicalEnvelopeSources(testCheckin({ illnessSymptoms: true }))).toEqual(['non_allergy_illness']);
        expect(resolveClinicalEnvelopeSources(testCheckin({ painOrInjury: true, illnessSymptoms: true })))
            .toEqual(['pain_or_injury', 'non_allergy_illness']);
    });

    it('sets painFlag when illnessSymptoms is true and no healthContext detail is supplied (unchanged default)', () => {
        const checkin = testCheckin({ illnessSymptoms: true });
        expect(mapCheckinToSubjectiveInput(checkin).painFlag).toBe(true);
    });

    it('clears painFlag for a mild, allergy-attributed nasal symptom day', () => {
        const checkin = testCheckin({
            illnessSymptoms: true,
            healthContext: {
                symptoms: {
                    present: true,
                    severity: 'mild',
                    types: ['sneezing', 'runny_nose'],
                    suspectedCause: 'allergy',
                },
            },
        });
        expect(mapCheckinToSubjectiveInput(checkin).painFlag).toBe(false);
    });

    it('also permits an explicitly moderate allergy day when every reported symptom remains nasal', () => {
        const checkin = testCheckin({
            illnessSymptoms: true,
            healthContext: {
                symptoms: {
                    present: true,
                    severity: 'moderate',
                    types: ['congestion', 'sneezing'],
                    suspectedCause: 'allergy',
                },
            },
        });
        expect(mapCheckinToSubjectiveInput(checkin).painFlag).toBe(false);
    });

    it('keeps painFlag set when allergy-attributed severity is missing', () => {
        const checkin = testCheckin({
            illnessSymptoms: true,
            healthContext: {
                symptoms: {
                    present: true,
                    types: ['sneezing'],
                    suspectedCause: 'allergy',
                },
            },
        });
        expect(mapCheckinToSubjectiveInput(checkin).painFlag).toBe(true);
    });

    it('keeps painFlag set when allergy-attributed severity is explicitly null', () => {
        const checkin = testCheckin({
            illnessSymptoms: true,
            healthContext: {
                symptoms: {
                    present: true,
                    severity: null,
                    types: ['sneezing'],
                    suspectedCause: 'allergy',
                },
            },
        });
        expect(mapCheckinToSubjectiveInput(checkin).painFlag).toBe(true);
    });

    it('keeps painFlag set when an allergy cause is selected without symptom types', () => {
        const checkin = testCheckin({
            illnessSymptoms: true,
            healthContext: {
                symptoms: { present: true, severity: 'mild', suspectedCause: 'allergy' },
            },
        });
        expect(mapCheckinToSubjectiveInput(checkin).painFlag).toBe(true);
    });

    it('keeps painFlag set for a severe allergy-attributed day', () => {
        const checkin = testCheckin({
            illnessSymptoms: true,
            healthContext: {
                symptoms: {
                    present: true,
                    severity: 'severe',
                    types: ['sneezing'],
                    suspectedCause: 'allergy',
                },
            },
        });
        expect(mapCheckinToSubjectiveInput(checkin).painFlag).toBe(true);
    });

    it.each([
        'sore_throat',
        'cough',
        'fever_or_chills',
        'headache_or_body_aches',
        'gastrointestinal',
        'unusual_fatigue',
        'other',
    ] as const)(
        'keeps painFlag set when an allergy-attributed day includes non-nasal symptom type %s',
        symptomType => {
            const checkin = testCheckin({
                illnessSymptoms: true,
                healthContext: {
                    symptoms: {
                        present: true,
                        severity: 'mild',
                        types: ['sneezing', symptomType],
                        suspectedCause: 'allergy',
                    },
                },
            });
            expect(mapCheckinToSubjectiveInput(checkin).painFlag).toBe(true);
        },
    );

    it.each(['unsure', 'infectious', undefined] as const)(
        'keeps painFlag set when suspectedCause is %s (fail-safe default)',
        suspectedCause => {
            const checkin = testCheckin({
                illnessSymptoms: true,
                healthContext: {
                    symptoms: {
                        present: true,
                        severity: 'mild',
                        types: ['sneezing'],
                        ...(suspectedCause ? { suspectedCause } : {}),
                    },
                },
            });
            expect(mapCheckinToSubjectiveInput(checkin).painFlag).toBe(true);
        },
    );

    it('keeps painFlag set for painOrInjury regardless of allergy attribution', () => {
        const checkin = testCheckin({
            painOrInjury: true,
            illnessSymptoms: true,
            healthContext: {
                symptoms: {
                    present: true,
                    severity: 'mild',
                    types: ['sneezing'],
                    suspectedCause: 'allergy',
                },
            },
        });
        expect(mapCheckinToSubjectiveInput(checkin).painFlag).toBe(true);
    });

    describe('red-flag findings (clinical escalation protocol)', () => {
        it('resolves explicit red flags from checkin', () => {
            const checkin = testCheckin({
                painOrInjury: true,
                redFlags: {
                    present: true,
                    categories: ['neurological', 'acute_trauma_structural'],
                },
            });
            const findings = resolveRedFlagFindings(checkin);
            expect(findings).toHaveLength(2);
            expect(findings[0]).toEqual({
                category: 'neurological',
                source: 'explicit_checkin',
                description: 'Athlete reported red-flag symptom: neurological.',
            });
            expect(findings[1]).toEqual({
                category: 'acute_trauma_structural',
                source: 'explicit_checkin',
                description: 'Athlete reported red-flag symptom: acute trauma structural.',
            });
            expect(resolveClinicalEnvelopeSources(checkin)).toContain('red_flag');
            const subjective = mapCheckinToSubjectiveInput(checkin);
            expect(subjective.painFlag).toBe(true);
            expect(subjective.redFlagFindings).toEqual(findings);
        });

        it('detects implicit systemic infection red flag from severe fever/chills symptoms', () => {
            const checkin = testCheckin({
                illnessSymptoms: true,
                healthContext: {
                    symptoms: {
                        present: true,
                        severity: 'severe',
                        types: ['fever_or_chills', 'headache_or_body_aches'],
                        suspectedCause: 'infectious',
                    },
                },
            });
            const findings = resolveRedFlagFindings(checkin);
            expect(findings).toHaveLength(1);
            expect(findings[0]).toEqual({
                category: 'systemic_infection',
                source: 'severe_systemic_symptoms',
                description: 'Severe fever or chills reported in health symptoms.',
            });
            expect(resolveClinicalEnvelopeSources(checkin)).toContain('red_flag');
            const subjective = mapCheckinToSubjectiveInput(checkin);
            expect(subjective.painFlag).toBe(true);
            expect(subjective.redFlagFindings).toEqual(findings);
        });

        it('does not treat mild or non-fever symptoms as red flags', () => {
            const checkin = testCheckin({
                illnessSymptoms: true,
                healthContext: {
                    symptoms: {
                        present: true,
                        severity: 'mild',
                        types: ['fever_or_chills'],
                    },
                },
            });
            expect(resolveRedFlagFindings(checkin)).toEqual([]);
            expect(resolveClinicalEnvelopeSources(checkin)).not.toContain('red_flag');
        });
    });
});
