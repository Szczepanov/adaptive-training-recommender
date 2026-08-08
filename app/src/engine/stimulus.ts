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
 * Boundary reader for persisted or external stimulus records.
 * Canonical fields win unconditionally; legacy fields convert if canonical fields are missing.
 * Disagreements between canonical and legacy fields are logged.
 */
export function readStimulusProfile(raw: unknown): WorkoutStimulusProfile {
    if (!raw || typeof raw !== 'object') {
        return {
            aerobicEndurance: 0,
            thresholdPower: 0,
            vo2MaxPower: 0,
            repeatedSurges: 0,
            sprintPower: 0,
            fatigueResistance: 0,
            maxStrength: 0,
            hypertrophy: 0,
        };
    }
    const r = raw as Record<string, unknown>;

    const hasCanonical =
        r.aerobicEndurance !== undefined ||
        r.thresholdPower !== undefined ||
        r.vo2MaxPower !== undefined ||
        r.repeatedSurges !== undefined ||
        r.sprintPower !== undefined ||
        r.fatigueResistance !== undefined ||
        r.maxStrength !== undefined ||
        r.hypertrophy !== undefined;

    const hasLegacy =
        r.aerobicCapacity !== undefined ||
        r.thresholdDevelopment !== undefined ||
        r.surgeRepeatability !== undefined;

    if (hasCanonical && hasLegacy) {
        if (r.aerobicEndurance !== undefined && r.aerobicCapacity !== undefined && r.aerobicEndurance !== r.aerobicCapacity) {
            console.warn(`[readStimulusProfile] Divergence: aerobicEndurance (${r.aerobicEndurance}) vs legacy aerobicCapacity (${r.aerobicCapacity}). Canonical wins.`);
        }
        if (r.thresholdPower !== undefined && r.thresholdDevelopment !== undefined && r.thresholdPower !== r.thresholdDevelopment) {
            console.warn(`[readStimulusProfile] Divergence: thresholdPower (${r.thresholdPower}) vs legacy thresholdDevelopment (${r.thresholdDevelopment}). Canonical wins.`);
        }
        if (r.repeatedSurges !== undefined && r.surgeRepeatability !== undefined && r.repeatedSurges !== r.surgeRepeatability) {
            console.warn(`[readStimulusProfile] Divergence: repeatedSurges (${r.repeatedSurges}) vs legacy surgeRepeatability (${r.surgeRepeatability}). Canonical wins.`);
        }
    }

    return {
        aerobicEndurance: (r.aerobicEndurance as number) ?? (r.aerobicCapacity as number) ?? 0,
        thresholdPower: (r.thresholdPower as number) ?? (r.thresholdDevelopment as number) ?? 0,
        vo2MaxPower: (r.vo2MaxPower as number) ?? 0,
        repeatedSurges: (r.repeatedSurges as number) ?? (r.surgeRepeatability as number) ?? 0,
        sprintPower: (r.sprintPower as number) ?? 0,
        fatigueResistance: (r.fatigueResistance as number) ?? 0,
        maxStrength: (r.maxStrength as number) ?? 0,
        hypertrophy: (r.hypertrophy as number) ?? 0,
    };
}

/**
 * Calculates dose-sensitive fractional objective credit derived from the workout's stimulus profile
 * and delivered duration/completion ratio.
 */
export function deriveObjectiveCredit(
    objective: WeeklyObjective,
    rawStimulus: unknown,
    dose: DeliveredDose = {},
    context?: CreditContext
): ObjectiveCredit {
    const stimulus = readStimulusProfile(rawStimulus);
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
                const canonicalAxis = axis === 'thresholdDevelopment' ? 'thresholdPower'
                    : axis === 'surgeRepeatability' ? 'repeatedSurges'
                    : axis === 'aerobicCapacity' ? 'aerobicEndurance'
                    : axis;
                const val = stimulus[canonicalAxis as keyof WorkoutStimulusProfile] ?? 0;
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
            rawStimulusContribution = stimulus.aerobicEndurance;
            break;
        case 'threshold_quality':
            rawStimulusContribution = stimulus.thresholdPower;
            break;
        case 'surge_repeatability':
            rawStimulusContribution = stimulus.repeatedSurges;
            break;
        case 'vo2_max':
            rawStimulusContribution = stimulus.vo2MaxPower;
            break;
        case 'strength_maintenance':
            rawStimulusContribution = Math.max(stimulus.maxStrength, stimulus.hypertrophy);
            break;
        case 'race_specific_endurance':
            rawStimulusContribution = Math.max(
                stimulus.fatigueResistance,
                (stimulus.aerobicEndurance * 0.5 + stimulus.repeatedSurges * 0.5)
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
