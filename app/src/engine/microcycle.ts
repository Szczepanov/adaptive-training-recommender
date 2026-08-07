import type {
    FixedActivity,
    MicrocycleState,
    TrainingRecord,
    WeeklyObjective,
    WorkoutStimulusProfile,
} from './models';
import type { CompletedExposure } from './microcycleHistory';
import type { PhaseWeights } from './periodization';

export function generateWeeklyObjectives(
    phaseWeights: PhaseWeights,
    weekStartDate: string
): MicrocycleState {
    const demand = phaseWeights.targetDemandVector;
    const objectives: WeeklyObjective[] = [];

    // 1. Aerobic Base / Z2 exposure
    if (demand.aerobicEndurance >= 0.4) {
        objectives.push({
            id: 'obj_z2_aerobic',
            key: 'zone2_aerobic',
            title: 'Aerobic Base (Zone 2)',
            targetExposures: demand.aerobicEndurance >= 0.7 ? 2 : 1,
            completedExposures: 0,
            targetStimulus: { aerobicCapacity: 0.8 },
        });
    }

    // 2. Threshold exposure
    if (demand.thresholdPower >= 0.5 && !phaseWeights.taperActive) {
        objectives.push({
            id: 'obj_threshold',
            key: 'threshold_quality',
            title: 'Threshold Development',
            targetExposures: 1,
            completedExposures: 0,
            targetStimulus: { thresholdDevelopment: 0.9 },
        });
    }

    // 3. Surge / VO2 exposure
    if ((demand.vo2MaxPower >= 0.6 || demand.repeatedSurges >= 0.6) && phaseWeights.phaseName !== 'Post-Event Recovery') {
        objectives.push({
            id: 'obj_surges',
            key: 'surge_repeatability',
            title: 'Surge & High-Intensity Repeatability',
            targetExposures: 1,
            completedExposures: 0,
            targetStimulus: { surgeRepeatability: 0.9, aerobicCapacity: 0.5 },
        });
    }

    // 4. Strength maintenance
    objectives.push({
        id: 'obj_strength',
        key: 'strength_maintenance',
        title: 'Strength & Neuromuscular Maintenance',
        targetExposures: 1,
        completedExposures: 0,
        targetStimulus: { maxStrength: 0.7, hypertrophy: 0.5 },
    });

    return {
        weekStartDate,
        objectives,
    };
}

/**
 * Updates microcycle objective completion status from a completed activity (Garmin sync or fixed activity).
 */
export function updateMicrocycleProgress(
    currentMicrocycle: MicrocycleState,
    activity: TrainingRecord | FixedActivity
): MicrocycleState {
    const updatedObjectives = currentMicrocycle.objectives.map(obj => {
        let matched = false;
        const actType = ('type' in activity ? activity.type : activity.title).toLowerCase();

        if (obj.key === 'threshold_quality' && (actType.includes('threshold') || actType.includes('hard') || actType.includes('tempo'))) {
            matched = true;
        } else if (obj.key === 'surge_repeatability' && (actType.includes('surge') || actType.includes('vo2') || actType.includes('football') || actType.includes('field') || actType.includes('hiit') || actType.includes('race-specific') || actType.includes('race sim'))) {
            matched = true;
        } else if (obj.key === 'zone2_aerobic' && (actType.includes('easy') || actType.includes('endurance') || actType.includes('zone 2') || actType.includes('running') || actType.includes('cycling'))) {
            matched = true;
        } else if (obj.key === 'strength_maintenance' && (actType.includes('strength') || actType.includes('weight') || actType.includes('lifting'))) {
            matched = true;
        }

        if (matched) {
            return {
                ...obj,
                completedExposures: Math.min(obj.targetExposures, obj.completedExposures + 1),
            };
        }
        return obj;
    });

    return {
        ...currentMicrocycle,
        objectives: updatedObjectives,
    };
}

export function getUnresolvedObjectives(microcycle: MicrocycleState): WeeklyObjective[] {
    return microcycle.objectives.filter(o => o.completedExposures < o.targetExposures);
}

/** Fraction (0-1) of an objective's target stimulus vector a workout's own stimulus
 *  profile actually satisfies, weighted by how strongly the objective demands each axis. */
export function stimulusCoverage(
    stimulus: WorkoutStimulusProfile,
    targetStimulus: WeeklyObjective['targetStimulus']
): number {
    let weightedSum = 0;
    let weightTotal = 0;
    (Object.entries(targetStimulus) as [keyof WorkoutStimulusProfile, number][]).forEach(([key, target]) => {
        if (!target) return;
        weightTotal += target;
        weightedSum += target * (stimulus[key] ?? 0);
    });
    return weightTotal === 0 ? 0 : weightedSum / weightTotal;
}

/** A pick must cover at least this much of an objective's target stimulus vector to
 *  earn credit -- keeps a session that merely touches an axis (e.g. a technical skill
 *  drill with a token 0.1 aerobicCapacity) from silently resolving it. */
export const STIMULUS_CREDIT_COVERAGE_THRESHOLD = 0.6;

/**
 * Credits weekly objectives from a workout's own numeric stimulus profile -- the same
 * vector calculateStimulusBenefit (optimizer.ts) scores candidates against -- instead of
 * pattern-matching a free-text description. This is the crediting path for internally
 * generated picks (planner.ts's projected days) where a real SessionTemplate and its
 * profile are available.
 *
 * updateMicrocycleProgress's keyword matching below remains the crediting path for
 * externally-reported completions (Garmin-synced activities, adherence records) that
 * carry nothing but a loose type string and no structured stimulus data -- there is
 * nothing to compute coverage against for those, so the two crediting paths intentionally
 * coexist rather than one replacing the other.
 */
export function creditObjectivesFromStimulus(
    microcycle: MicrocycleState,
    stimulus: WorkoutStimulusProfile
): MicrocycleState {
    return {
        ...microcycle,
        objectives: microcycle.objectives.map(obj => {
            if (obj.completedExposures >= obj.targetExposures) return obj;
            if (stimulusCoverage(stimulus, obj.targetStimulus) < STIMULUS_CREDIT_COVERAGE_THRESHOLD) return obj;
            return { ...obj, completedExposures: obj.completedExposures + 1 };
        }),
    };
}

/** Seeds the rolling microcycle from completed, ordered exposures before projecting
 * the next recommendation. */
export function buildMicrocycleState(
    phase: PhaseWeights,
    windowStartDate: string,
    history: CompletedExposure[]
): MicrocycleState {
    return history.reduce(
        (state, exposure) => updateMicrocycleProgress(state, exposure.trainingRecordLike),
        generateWeeklyObjectives(phase, windowStartDate)
    );
}
