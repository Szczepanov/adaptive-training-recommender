import type {
    FixedActivity,
    MicrocycleState,
    ObjectiveQualification,
    SessionTemplate,
    TrainingRecord,
    UserEvent,
    WeeklyObjective,
    WorkoutStimulusProfile,
} from './models';
import type { CompletedExposure } from './microcycleHistory';
import type { PlanDefinition } from './planSchedule';
import { modalitiesForEventCategory, type PhaseWeights } from './periodization';

export function generateWeeklyObjectives(
    phaseWeights: PhaseWeights,
    windowStartDate: string,
    focusEvent: UserEvent | null,
    planDefinition?: PlanDefinition | null,
    /** Reference date used to select which PlanBlock is "current" for the plan-derived
     *  branch below -- defaults to windowStartDate so existing callers that only pass 4
     *  args keep working, but a caller building a forward-looking microcycle (e.g.
     *  trainingIntent.ts, where windowStartDate is a lookback boundary rather than
     *  today) should pass today's date explicitly. */
    asOfDate: string = windowStartDate
): MicrocycleState {
    if (planDefinition && planDefinition.objectives.length > 0) {
        const objectives: WeeklyObjective[] = [];
        const blockMap = new Map(planDefinition.blocks.map((b) => [b.id, b]));
        // Scope to the block(s) actually active on asOfDate -- a PlanDefinition spans the
        // whole macrocycle (build/travel/peak/taper/race/recovery), and without this an
        // athlete in the build block would see peak- and taper-block objectives (e.g. a
        // race-specific-endurance session two months out) as already "unresolved" from
        // day one. Multiple blocks can be active simultaneously only if the caller passed
        // an invalid overlapping schedule (buildPlanDefinition rejects that), so this is
        // normally at most one block.
        const activeBlockIds = new Set(
            planDefinition.blocks
                .filter((b) => b.startDate <= asOfDate && asOfDate <= b.endDate)
                .map((b) => b.id)
        );

        planDefinition.objectives
            .filter((objDef) => activeBlockIds.has(objDef.blockId))
            .forEach((objDef, idx) => {
            const block = blockMap.get(objDef.blockId);
            const windowStart = block?.startDate;
            const windowEnd = block?.endDate;

            let title = 'Plan Objective';
            let targetStimulus: Record<string, number> = { aerobicCapacity: 0.5 };
            let qualification: WeeklyObjective['qualification'] = undefined;
            const allowedModalities = focusEvent ? modalitiesForEventCategory(focusEvent.category) : [];

            switch (objDef.key) {
                case 'zone2_aerobic':
                    title = 'Aerobic Base (Zone 2)';
                    targetStimulus = { aerobicCapacity: 0.8 };
                    break;
                case 'threshold_quality':
                    title = 'Threshold Development';
                    targetStimulus = { thresholdDevelopment: 0.9 };
                    qualification = {
                        minimumStimulus: { thresholdDevelopment: 0.6 },
                        ...(allowedModalities.length > 0 ? { allowedModalities } : {}),
                    };
                    break;
                case 'surge_repeatability':
                    title = 'Surge & High-Intensity Repeatability';
                    targetStimulus = { surgeRepeatability: 0.9, aerobicCapacity: 0.5 };
                    qualification = {
                        minimumStimulus: { surgeRepeatability: 0.6 },
                        ...(allowedModalities.length > 0 ? { allowedModalities } : {}),
                    };
                    break;
                case 'strength_maintenance':
                    title = 'Strength & Neuromuscular Maintenance';
                    targetStimulus = { maxStrength: 0.7, hypertrophy: 0.5 };
                    break;
                case 'race_specific_endurance':
                    title = 'Cycling Race-Specific Endurance';
                    targetStimulus = { aerobicCapacity: 0.6, surgeRepeatability: 0.6 };
                    qualification = {
                        minimumStimulus: { aerobicCapacity: 0.6 },
                        allowedModalities: ['Cycling'],
                        allowedCategories: ['Race-Specific Endurance'],
                    };
                    break;
                case 'vo2_max':
                    title = 'VO2 Max Intervals';
                    targetStimulus = { vo2MaxPower: 0.9, aerobicCapacity: 0.5 };
                    break;
                default: {
                    // Exhaustiveness guard: a future ObjectiveKey addition must add a case
                    // above, not silently fall through to the 'Plan Objective' placeholder.
                    const _exhaustive: never = objDef.key;
                    void _exhaustive;
                }
            }

            objectives.push({
                id: `obj_plan_${objDef.key}_${idx}`,
                key: objDef.key,
                title,
                requiredCredit: objDef.requiredCredit,
                targetExposures: objDef.requiredCredit || 1,
                completedExposures: 0,
                targetStimulus,
                priority: objDef.priority,
                qualification,
                windowStart,
                windowEnd,
            });
        });

        return {
            windowStartDate,
            objectives,
        };
    }

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
        const allowedModalities = focusEvent ? modalitiesForEventCategory(focusEvent.category) : [];
        objectives.push({
            id: 'obj_threshold',
            key: 'threshold_quality',
            title: 'Threshold Development',
            targetExposures: 1,
            completedExposures: 0,
            targetStimulus: { thresholdDevelopment: 0.9 },
            qualification: {
                minimumStimulus: { thresholdDevelopment: 0.6 },
                ...(allowedModalities.length > 0 ? { allowedModalities } : {}),
            },
        });
    }

    // 3. Surge / VO2 exposure
    if ((demand.vo2MaxPower >= 0.6 || demand.repeatedSurges >= 0.6) && phaseWeights.phaseName !== 'Post-Event Recovery') {
        const allowedModalities = focusEvent ? modalitiesForEventCategory(focusEvent.category) : [];
        objectives.push({
            id: 'obj_surges',
            key: 'surge_repeatability',
            title: 'Surge & High-Intensity Repeatability',
            targetExposures: 1,
            completedExposures: 0,
            targetStimulus: { surgeRepeatability: 0.9, aerobicCapacity: 0.5 },
            qualification: {
                minimumStimulus: { surgeRepeatability: 0.6 },
                ...(allowedModalities.length > 0 ? { allowedModalities } : {}),
            },
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

    // 5. Protected cycling-specific work. This is intentionally guarded by both the
    // event type and catalog support: a generic endurance session or an indoor interval
    // cannot complete it, and sports without an equivalent catalog are not promised an
    // unfulfillable objective.
    if (focusEvent?.category === 'cycling_event'
        && !phaseWeights.taperActive
        && (demand.fatigueResistance >= 0.7 || demand.repeatedSurges >= 0.6)) {
        objectives.push({
            id: 'obj_cycling_race_specific',
            key: 'race_specific_endurance',
            title: 'Cycling Race-Specific Endurance',
            targetExposures: 1,
            completedExposures: 0,
            targetStimulus: { aerobicCapacity: 0.6, surgeRepeatability: 0.6 },
            qualification: {
                minimumStimulus: { aerobicCapacity: 0.6 },
                allowedModalities: ['Cycling'],
                allowedCategories: ['Race-Specific Endurance'],
            },
        });
    }

    return {
        windowStartDate,
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

/** Applies an objective's optional strict qualification policy. Objectives without one
 *  retain the legacy stimulus-coverage-only completion behavior. */
export function qualifiesForObjective(
    stimulus: WorkoutStimulusProfile,
    modality: SessionTemplate['modality'],
    qualification: ObjectiveQualification | undefined,
    category?: SessionTemplate['category'],
): boolean {
    const allowedModalities = qualification?.allowedModalities;
    if (allowedModalities && allowedModalities.length > 0 && !allowedModalities.includes(modality)) return false;
    const allowedCategories = qualification?.allowedCategories;
    if (allowedCategories && allowedCategories.length > 0 && (!category || !allowedCategories.includes(category))) return false;

    return Object.entries(qualification?.minimumStimulus ?? {}).every(([axis, minimum]) =>
        (stimulus[axis as keyof WorkoutStimulusProfile] ?? 0) >= minimum
    );
}

/**
 * Credits weekly objectives from a workout's own numeric stimulus profile -- the same
 * vector calculateStimulusBenefit (optimizer.ts) scores candidates against -- instead of
 * pattern-matching a free-text description. This is the crediting path for internally
 * generated picks (planner.ts's projected days) where a real SessionTemplate and its
 * profile are available.
 *
 * updateMicrocycleProgress's keyword matching below remains the conservative fallback
 * for externally-reported completions that carry nothing but a loose type string. Exact
 * followed recommendations and reconciled events retain their structured profile through
 * CompletedExposure and must use this same qualification path.
 */
export function creditObjectivesFromStimulus(
    microcycle: MicrocycleState,
    stimulus: WorkoutStimulusProfile,
    modality: SessionTemplate['modality'],
    category?: SessionTemplate['category'],
): MicrocycleState {
    return {
        ...microcycle,
        objectives: microcycle.objectives.map(obj => {
            if (obj.completedExposures >= obj.targetExposures) return obj;
            if (stimulusCoverage(stimulus, obj.targetStimulus) < STIMULUS_CREDIT_COVERAGE_THRESHOLD) return obj;
            if (!qualifiesForObjective(stimulus, modality, obj.qualification, category)) return obj;
            return { ...obj, completedExposures: obj.completedExposures + 1 };
        }),
    };
}

/** Seeds the rolling microcycle from completed, ordered exposures before projecting
 * the next recommendation. */
export function buildMicrocycleState(
    phase: PhaseWeights,
    windowStartDate: string,
    history: CompletedExposure[],
    focusEvent: UserEvent | null,
    planDefinition?: PlanDefinition | null,
    /** See generateWeeklyObjectives's asOfDate -- pass today's date here (not
     *  windowStartDate, which is a lookback boundary) so a plan-derived microcycle scopes
     *  to the block actually active today. */
    asOfDate?: string
): MicrocycleState {
    return history.reduce((state, exposure) => {
        if (exposure.stimulusProfile && exposure.modality) {
            return creditObjectivesFromStimulus(state, exposure.stimulusProfile, exposure.modality, exposure.category);
        }
        return updateMicrocycleProgress(state, exposure.trainingRecordLike);
    }, generateWeeklyObjectives(phase, windowStartDate, focusEvent, planDefinition, asOfDate));
}
