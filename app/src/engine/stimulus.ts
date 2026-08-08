import type { ObjectiveKey, ObjectiveProgress, PlannerState, WeeklyObjective, WorkoutStimulusProfile } from './models';

export interface DeliveredDose {
    plannedDurationMin?: number;
    completedDurationMin?: number;
    completionRatio?: number; // 0.0 to 1.0 (defaults to 1.0)
}

export interface CreditContext {
    modality?: string;
    category?: string;
}

export interface ObjectiveCredit {
    objectiveId: string;
    objectiveKey: ObjectiveKey;
    earnedCredit: number;
    qualifies: boolean;
    reason?: string;
}

/**
 * Calculates dose-sensitive fractional objective credit derived from the workout's stimulus profile
 * and delivered duration/completion ratio.
 */
export function deriveObjectiveCredit(
    objective: WeeklyObjective,
    stimulus: WorkoutStimulusProfile,
    dose: DeliveredDose = {},
    context?: CreditContext
): ObjectiveCredit {
    const completionRatio = Math.min(1.0, Math.max(0.0, dose.completionRatio ?? 1.0));
    
    // Check qualification constraints if present
    if (objective.qualification) {
        const qual = objective.qualification;
        if (qual.allowedModalities && qual.allowedModalities.length > 0 && context?.modality) {
            const allowed = qual.allowedModalities.map(m => m.toLowerCase());
            if (!allowed.includes(context.modality.toLowerCase())) {
                return { objectiveId: objective.id, objectiveKey: objective.key, earnedCredit: 0, qualifies: false, reason: 'Modality not allowed' };
            }
        }
        if (qual.allowedCategories && qual.allowedCategories.length > 0 && context?.category) {
            const allowed = qual.allowedCategories.map(c => c.toLowerCase());
            if (!allowed.includes(context.category.toLowerCase())) {
                return { objectiveId: objective.id, objectiveKey: objective.key, earnedCredit: 0, qualifies: false, reason: 'Category not allowed' };
            }
        }
        if (qual.minimumStimulus) {
            for (const [axis, minVal] of Object.entries(qual.minimumStimulus)) {
                const val = stimulus[axis as keyof WorkoutStimulusProfile] ?? 0;
                if (val < (minVal ?? 0)) {
                    return { objectiveId: objective.id, objectiveKey: objective.key, earnedCredit: 0, qualifies: false, reason: `Minimum ${axis} stimulus not met` };
                }
            }
        }
    }

    // Derive raw stimulus contribution based on objective key
    let rawStimulusContribution = 0;
    switch (objective.key) {
        case 'zone2_aerobic':
            rawStimulusContribution = (stimulus.aerobicEndurance ?? stimulus.aerobicCapacity ?? 0);
            break;
        case 'threshold_quality':
            rawStimulusContribution = (stimulus.thresholdPower ?? stimulus.thresholdDevelopment ?? 0);
            break;
        case 'surge_repeatability':
            rawStimulusContribution = (stimulus.repeatedSurges ?? stimulus.surgeRepeatability ?? 0);
            break;
        case 'vo2_max':
            rawStimulusContribution = (stimulus.vo2MaxPower ?? 0);
            break;
        case 'strength_maintenance':
            rawStimulusContribution = Math.max(
                stimulus.maxStrength ?? 0,
                stimulus.hypertrophy ?? 0
            );
            break;
        case 'race_specific_endurance':
            rawStimulusContribution = Math.max(
                stimulus.fatigueResistance ?? 0,
                ((stimulus.aerobicEndurance ?? stimulus.aerobicCapacity ?? 0) * 0.5 + (stimulus.repeatedSurges ?? stimulus.surgeRepeatability ?? 0) * 0.5)
            );
            break;
        default: {
            const objKey: string = (objective as { key?: string }).key ?? 'unknown';
            console.warn(`[deriveObjectiveCredit] Unrecognized objective key: ${objKey}`);
            rawStimulusContribution = 0;
            break;
        }
    }

    // Scale by delivered dose completion ratio
    const earnedCredit = Math.round(rawStimulusContribution * completionRatio * 100) / 100;

    return {
        objectiveId: objective.id,
        objectiveKey: objective.key,
        earnedCredit,
        qualifies: true,
    };
}

/**
 * V2 counterpart of microcycle.ts's `getUnresolvedObjectives(microcycle: MicrocycleState)`
 * (deliberately named differently to avoid colliding with it): operates on the fractional
 * `PlannerState`/`ObjectiveProgress` shape rather than integer `completedExposures`, so an
 * objective with partial dose-sensitive credit (see `deriveObjectiveCredit` above) can stay
 * "unresolved" even once at least one exposure has landed. Falls back to the objective's own
 * `completedExposures` when no progress entry is supplied, so it degrades gracefully for
 * objectives that haven't been credited through the fractional path yet.
 *
 * Not yet wired into planner.ts/microcycle.ts -- the live scheduling pipeline still runs on
 * the integer exposure-count model in microcycle.ts. This exists as the V2 building block for
 * migrating that pipeline; call sites should switch over deliberately, not implicitly, since
 * the two credit models are not numerically equivalent.
 */
export function getUnresolvedObjectivesV2(
    state: PlannerState,
    progress: ObjectiveProgress[] = []
): WeeklyObjective[] {
    const progressMap = new Map(progress.map(p => [p.objectiveId, p]));
    return state.weeklyObjectives.filter(obj => {
        const required = obj.requiredCredit ?? (obj.targetExposures > 0 ? obj.targetExposures : 1);
        const prog = progressMap.get(obj.id);
        const credit = prog ? prog.completedCredit : obj.completedExposures;
        return credit < required;
    });
}
