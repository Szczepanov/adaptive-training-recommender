import { describe, expect, it } from 'vitest';
import { estimateActivitySteps } from '../derived/steps/activitySteps';
import { computeInternalResponseStrain } from './fatigue';
import type {
    DailyReadiness,
    DimensionalFatigue,
    EngineObjectiveInput,
    OccupationalLoadBaseline,
    PhysicalWorkCheckin,
    SubjectiveInput,
    TrainingRecord,
} from './models';
import { resolveOccupationalLoadContext } from './occupationalLoad';

const RUN_OR_FIELD_SPORT_REGEX = /run|soccer|football|trail/i;
const WALK_OR_HIKE_REGEX = /walk|hike/i;

function oracleEstimateActivitySteps(training: { type?: string; duration_min?: number } | null | undefined): number {
    if (!training || !training.duration_min || training.duration_min <= 0) return 0;
    const type = training.type || '';

    // Running and high-cadence field sports: ~155 steps/min
    if (RUN_OR_FIELD_SPORT_REGEX.test(type)) {
        return Math.round(training.duration_min * 155);
    }
    // Dedicated walking or hiking activities: ~110 steps/min
    if (WALK_OR_HIKE_REGEX.test(type)) {
        return Math.round(training.duration_min * 110);
    }
    // Other sports (cycling, swimming, gym strength) do not produce primary ambulatory impact steps
    return 0;
}

function oracleComputeInternalResponseStrain(readiness: DailyReadiness): DimensionalFatigue {
    const { subjective, objective } = readiness;

    // Normalize subjective scores 1-10 to 0-1
    const subFatigue = (subjective.fatigue - 1) / 9;
    const subSoreness = (subjective.soreness - 1) / 9;

    // Objective strain signals
    const hrvDrop = objective.hrv_delta !== null && objective.hrv_delta < 0 ? Math.min(1, Math.abs(objective.hrv_delta) / 15) : 0;
    const rhrElevated = objective.rhr_delta !== null && objective.rhr_delta > 0 ? Math.min(1, objective.rhr_delta / 10) : 0;
    const sleepDeficit = objective.sleep_score !== null && objective.sleep_score < 75 ? (75 - objective.sleep_score) / 50 : 0;

    // Acute ambulatory surge (unlogged high-volume walking/hiking)
    // Evaluates net ambient steps (totalSteps - estimatedActivitySteps) against the 7-day baseline.
    // Triggers when ambient steps >= 1.8x baseline AND excess >= +6,000 steps above baseline.
    let ambulatoryTissueStrain = 0;
    const steps7dAvg = objective.steps_7d_avg;
    const totalSteps = objective.total_steps;
    const activitySteps = oracleEstimateActivitySteps(objective.yesterday_training);
    const ambientSteps = totalSteps !== null && totalSteps !== undefined
        ? Math.max(0, totalSteps - activitySteps)
        : null;
    if (
        ambientSteps !== null &&
        steps7dAvg !== null &&
        steps7dAvg !== undefined &&
        steps7dAvg > 0
    ) {
        const excessAmbientSteps = ambientSteps - steps7dAvg;
        const surgeRatio = ambientSteps / steps7dAvg;
        if (surgeRatio >= 1.8 && excessAmbientSteps >= 6000) {
            // Scale smoothly up to a 0.4 dampening cap for a +15,000 excess ambient step surge
            ambulatoryTissueStrain = Math.min(0.4, (excessAmbientSteps / 15000) * 0.4);
        }
    }

    // Garmin Body Battery is a proprietary composite of HRV, stress, sleep and activity.
    // Its inclusion here is useful context, but this mapping and its thresholds are product
    // calibration rather than a diagnosis or a validated universal training-readiness rule.
    const bbDepletion = objective.body_battery_wake !== null && objective.body_battery_wake < 50
        ? Math.min(1, Math.max(0, (50 - objective.body_battery_wake) / 30))
        : 0;

    // Conservative non-diluted product floors. Athlete self-report and longitudinal
    // autonomic signals are useful monitoring inputs, but the exact 8/9/10 cut-points and
    // 0.60-0.80 floors below are policy calibration, not physiological constants.
    // 1. High subjective fatigue (>= 8/10) directly limits systemic capacity in the model.
    // When accompanied by low readiness (<= 4) or high stress (>= 8), use the stronger floor.
    const severeSubjectiveDistress = (subjective.fatigue >= 8 && subjective.readiness <= 4) ||
        (subjective.readiness <= 3 && subjective.stress >= 8) ||
        (subjective.fatigue >= 8 && subjective.stress >= 8);
    const acuteSubjectiveFatigueFloor = severeSubjectiveDistress ? 0.65 : (subjective.fatigue >= 8 ? 0.60 : 0);

    // 2. Very high self-reported life stress gets a conservative non-diluted floor. The
    // exact >=9 threshold is not a universal injury-risk or autonomic-dysfunction boundary.
    const acuteSubjectiveStressFloor = subjective.stress >= 9 ? 0.60 : 0;

    // 3. Concordant HRV/RHR/Body-Battery deterioration gets a stronger multi-signal floor.
    // This is intentionally a recovery-planning heuristic, not a diagnosis of "autonomic collapse".
    const combinedAcuteRecoveryFlag = (
        objective.hrv_delta !== null && objective.hrv_delta <= -10 &&
        objective.rhr_delta !== null && objective.rhr_delta >= 5 &&
        objective.body_battery_wake !== null && objective.body_battery_wake <= 35
    ) || (hrvDrop >= 0.8 && rhrElevated >= 0.6 && bbDepletion >= 0.7);
    const acuteBiometricFloor = combinedAcuteRecoveryFlag ? 0.80 : 0;

    // 4. Very high soreness gets a conservative tissue-strain floor. The 0.88 value and
    // the dimensional decay half-lives are product planning parameters; soreness >=8 does
    // not by itself establish muscle breakdown or a biologically mandatory 48-hour recovery.
    const acuteTissueStrain = subjective.soreness >= 8 ? 0.88 : subSoreness;

    // 5. Unlogged non-exercise physical activity / manual labor (D-1)
    let physicalWorkStrain = 0;
    const pw = subjective.physicalWork;
    const occupational = resolveOccupationalLoadContext(pw, subjective.occupationalBaseline, ambientSteps, steps7dAvg ?? null);
    const pwAreas = new Set(pw?.loadAreas ?? []);
    if (pw?.performed) {
        physicalWorkStrain = occupational.acuteDeviation;
    }
    const hasSpecificAreas = pwAreas.size > 0;
    const workSystemic = physicalWorkStrain * 0.60;
    const workUpperBody = (!hasSpecificAreas || pwAreas.has('upper_body') || pwAreas.has('grip_forearms'))
        ? physicalWorkStrain * 0.85
        : 0;
    const workLowerBody = (!hasSpecificAreas || pwAreas.has('legs_carrying'))
        ? physicalWorkStrain * 0.85
        : 0;
    const workNeuromuscular = (!hasSpecificAreas || pwAreas.has('grip_forearms') || pwAreas.has('lower_back_spine'))
        ? physicalWorkStrain * 0.75
        : physicalWorkStrain * 0.40;
    const effectiveWorkIntensity = pw?.intensity ?? 'moderate';
    const workImpact = (pwAreas.has('legs_carrying') && effectiveWorkIntensity !== 'moderate')
        ? physicalWorkStrain * 0.40
        : 0;

    const baseSystemic = 0.3 * subFatigue + 0.25 * hrvDrop + 0.25 * sleepDeficit + 0.2 * bbDepletion;
    const systemic = Math.min(1, Math.max(baseSystemic, acuteSubjectiveFatigueFloor, acuteSubjectiveStressFloor, acuteBiometricFloor, workSystemic));

    const baseCardiovascular = 0.5 * rhrElevated + 0.5 * hrvDrop;
    const cardiovascular = Math.min(1, Math.max(baseCardiovascular, acuteBiometricFloor));

    const lowerBody = Math.min(1, Math.max(acuteTissueStrain + ambulatoryTissueStrain, workLowerBody));
    const upperBody = Math.min(1, Math.max(acuteTissueStrain * 0.7, workUpperBody));
    const impactTissue = Math.min(1, Math.max(acuteTissueStrain + ambulatoryTissueStrain, workImpact));

    const baseNeuromuscular = 0.5 * subFatigue + 0.5 * (1 - (subjective.motivation / 10));
    const neuromuscular = Math.min(1, Math.max(baseNeuromuscular, workNeuromuscular));

    return {
        systemic,
        cardiovascular,
        lowerBody,
        upperBody,
        impactTissue,
        neuromuscular,
    };
}

const TOTAL_STEPS_VALUES: ReadonlyArray<number | null | undefined> = [
    null,
    undefined,
    0,
    5_000,
    9_000,
    17_999,
    18_000,
    25_000,
    40_000,
];

const STEPS_7D_AVG_VALUES: ReadonlyArray<number | null | undefined> = [
    null,
    undefined,
    0,
    5_000,
    10_000,
];

const DURATION_MIN_VALUES = [0, -5, 30, 90] as const;

const WORKOUT_TYPES: ReadonlyArray<string | undefined> = [
    'running',
    'Trail Run',
    'soccer',
    'football',
    'walking',
    'hike',
    'cycling',
    'swimming',
    'strength',
    '',
    undefined,
];

const TRAINING_GRID: ReadonlyArray<{ type?: string; duration_min?: number } | null | undefined> = [
    null,
    undefined,
    {},
    ...WORKOUT_TYPES.flatMap((type) =>
        DURATION_MIN_VALUES.map((duration_min) => ({
            ...(type !== undefined ? { type } : {}),
            duration_min,
        })),
    ),
];

interface PhysicalWorkScenario {
    label: string;
    physicalWork?: PhysicalWorkCheckin;
    occupationalBaseline?: OccupationalLoadBaseline;
}

const PHYSICAL_WORK_SCENARIOS: ReadonlyArray<PhysicalWorkScenario> = [
    { label: 'absent' },
    {
        label: 'performed without load areas',
        physicalWork: {
            performed: true,
            intensity: 'hard',
            duration: 'extended',
        },
    },
    {
        label: 'performed with load areas',
        physicalWork: {
            performed: true,
            intensity: 'hard',
            duration: 'medium',
            loadAreas: ['legs_carrying', 'lower_back_spine'],
        },
    },
    {
        label: 'performed with occupational baseline',
        physicalWork: {
            performed: true,
            intensity: 'exhausting',
            duration: 'extended',
            loadAreas: ['upper_body', 'legs_carrying'],
        },
        occupationalBaseline: {
            typicalIntensity: 'moderate',
            typicalDuration: 'medium',
            typicalLoadAreas: ['legs_carrying'],
            source: 'user_authored',
            confidence: 0.8,
        },
    },
];

function buildReadiness(
    totalSteps: number | null | undefined,
    steps7dAvg: number | null | undefined,
    yesterdayTraining: { type?: string; duration_min?: number } | null | undefined,
    pwScenario: PhysicalWorkScenario,
): DailyReadiness {
    const subjective: SubjectiveInput = {
        readiness: 8,
        sleepQuality: 8,
        fatigue: 2,
        soreness: 2,
        stress: 2,
        motivation: 8,
        timeAvailable: 60,
        painFlag: false,
        alreadyTrainedToday: false,
        preferredModalityToday: null,
        ...(pwScenario.physicalWork ? { physicalWork: pwScenario.physicalWork } : {}),
        ...(pwScenario.occupationalBaseline ? { occupationalBaseline: pwScenario.occupationalBaseline } : {}),
    };

    const objective: EngineObjectiveInput = {
        total_steps: totalSteps as number | null,
        sleep_score: 85,
        sleep_duration_min: 450,
        rhr: 50,
        rhr_7d_avg: 50,
        rhr_delta: 0,
        hrv_weekly_avg: 50,
        hrv_last_night: 50,
        hrv_delta: 0,
        respiration: 14,
        body_battery_wake: 85,
        last_3_days_hard_sessions_count: 0,
        yesterday_training: yesterdayTraining as TrainingRecord | null,
        today_training: null,
        sleep_score_delta_7d: 0,
        rhr_delta_28d: 0,
        hrv_delta_28d: 0,
        sleep_score_delta_28d: 0,
        hrv_stdev_28d: 8.5,
        rhr_stdev_28d: 3.5,
        sleep_score_stdev_28d: 7.8,
        steps_7d_avg: steps7dAvg,
    };

    return { subjective, objective };
}

describe('fatigue D-1 activity-step deduction frozen oracle (#1187 / PR1-12)', () => {
    it('matches pre-change estimateActivitySteps across the entire training grid', () => {
        for (const training of TRAINING_GRID) {
            expect(estimateActivitySteps(training)).toBe(oracleEstimateActivitySteps(training));
        }
    });

    it('matches pre-change computeInternalResponseStrain DimensionalFatigue across the step/training/physicalWork grid', () => {
        for (const totalSteps of TOTAL_STEPS_VALUES) {
            for (const steps7dAvg of STEPS_7D_AVG_VALUES) {
                for (const training of TRAINING_GRID) {
                    for (const pwScenario of PHYSICAL_WORK_SCENARIOS) {
                        const readiness = buildReadiness(totalSteps, steps7dAvg, training, pwScenario);
                        expect(computeInternalResponseStrain(readiness)).toEqual(
                            oracleComputeInternalResponseStrain(readiness),
                        );
                    }
                }
            }
        }
    });
});
