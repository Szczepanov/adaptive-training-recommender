import type { DeliveredDose, ObjectiveKey, ObjectiveProgress, PlannerState, WeeklyObjective, WorkoutStimulusProfile } from './models';
import type { DataIssue, DataState } from './dataState';
export type { DeliveredDose } from './models';

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

/** How sure the engine is about a stimulus profile, from strongest to weakest evidence --
 * see docs/plans/phase-5-sequence-planning.md 5.5 and completedTraining.ts's EvidenceTier,
 * which produces this value. Absent (the default) means "authored/hypothetical data",
 * e.g. a catalog template's own stimulusProfile evaluated for a *planned* candidate --
 * there is nothing to be unsure about there, so it earns full credit exactly as before
 * this parameter existed. */
export type StimulusConfidence = 'exact' | 'inferred' | 'unknown';

/** Discounts earned credit by how confident the evidence is, so a genuinely unplanned
 * session still counts toward adaptation (closing the asymmetry where cost was already
 * charged but benefit was not) without being trusted as much as a confirmed exact match. */
export const CONFIDENCE_CREDIT_WEIGHT: Record<StimulusConfidence, number> = {
    exact: 1.0,
    inferred: 0.75,
    unknown: 0.4,
};

const CANONICAL_AXES = [
    'aerobicEndurance',
    'thresholdPower',
    'vo2MaxPower',
    'repeatedSurges',
    'sprintPower',
    'fatigueResistance',
    'maxStrength',
    'hypertrophy',
] as const;

const LEGACY_AXES = [
    'aerobicCapacity',
    'thresholdDevelopment',
    'surgeRepeatability',
] as const;

function isValidStimulusValue(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

function clamp01(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.min(1, Math.max(0, value));
}

/**
 * Boundary reader for persisted or external stimulus records.
 *
 * Partial-canonical policy is axis-local: a supplied canonical axis wins for that axis;
 * the corresponding legacy rename may backfill only when that canonical axis is absent.
 * Canonical-only axes that are absent remain 0 because legacy persistence never carried
 * them. Every supplied known canonical/legacy value must nevertheless be a finite number
 * in the documented 0..1 range; malformed persisted data is INVALID even if a valid
 * canonical value would otherwise override it.
 */
export function readStimulusProfile(raw: unknown): DataState<WorkoutStimulusProfile> {
    if (!raw || typeof raw !== 'object') {
        return {
            status: 'INVALID',
            issues: [{ code: 'stimulus_profile_missing_axes', documentPath: 'completed-training stimulus profile' }],
        };
    }
    const r = raw as Record<string, unknown>;

    const hasCanonical = CANONICAL_AXES.some(axis => r[axis] !== undefined);
    const hasLegacy = LEGACY_AXES.some(axis => r[axis] !== undefined);

    if (!hasCanonical && !hasLegacy) {
        return {
            status: 'INVALID',
            issues: [{ code: 'stimulus_profile_missing_axes', documentPath: 'completed-training stimulus profile' }],
        };
    }

    const invalidIssues: DataIssue[] = [];
    for (const axis of [...CANONICAL_AXES, ...LEGACY_AXES]) {
        const value = r[axis];
        if (value !== undefined && !isValidStimulusValue(value)) {
            invalidIssues.push({
                code: 'stimulus_profile_invalid_axis',
                field: axis,
                documentPath: 'completed-training stimulus profile',
            });
        }
    }
    if (invalidIssues.length > 0) {
        return { status: 'INVALID', issues: invalidIssues };
    }

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
        status: 'AVAILABLE',
        revision: null,
        data: {
            aerobicEndurance: (r.aerobicEndurance as number | undefined) ?? (r.aerobicCapacity as number | undefined) ?? 0,
            thresholdPower: (r.thresholdPower as number | undefined) ?? (r.thresholdDevelopment as number | undefined) ?? 0,
            vo2MaxPower: (r.vo2MaxPower as number | undefined) ?? 0,
            repeatedSurges: (r.repeatedSurges as number | undefined) ?? (r.surgeRepeatability as number | undefined) ?? 0,
            sprintPower: (r.sprintPower as number | undefined) ?? 0,
            fatigueResistance: (r.fatigueResistance as number | undefined) ?? 0,
            maxStrength: (r.maxStrength as number | undefined) ?? 0,
            hypertrophy: (r.hypertrophy as number | undefined) ?? 0,
        },
    };
}

/** Calculates credit from an already validated/canonical profile. Use this when one
 * exposure fans out across several objectives so validation and divergence logging happen
 * once at the exposure boundary instead of once per objective.
 *
 * `confidence` (Phase 5.5) discounts earnedCredit via CONFIDENCE_CREDIT_WEIGHT and
 * defaults to 'exact' -- every pre-existing caller that doesn't pass it keeps today's
 * full-credit behavior unchanged. */
export function deriveObjectiveCreditFromProfile(
    objective: WeeklyObjective,
    stimulus: WorkoutStimulusProfile,
    dose: DeliveredDose = {},
    context?: CreditContext,
    confidence: StimulusConfidence = 'exact',
): ObjectiveCredit {
    const completionRatio = clamp01(dose.completionRatio ?? 1.0);

    if (objective.qualification) {
        const qual = objective.qualification;
        if (qual.allowedModalities && qual.allowedModalities.length > 0) {
            // Fail closed: a modality-scoped objective cannot be satisfied by evidence
            // whose modality isn't even known (e.g. a genuinely unclassified Garmin
            // activity) -- silently *skipping* this check when context.modality is
            // absent would let an unknown-source session credit an objective it was
            // never shown to actually match.
            if (!context?.modality) {
                return { objectiveId: objective.id, objectiveKey: objective.key, earnedCredit: 0, qualifies: false, reason: 'Modality unknown' };
            }
            const allowed = qual.allowedModalities.map(m => m.toLowerCase());
            if (!allowed.includes(context.modality.toLowerCase())) {
                return { objectiveId: objective.id, objectiveKey: objective.key, earnedCredit: 0, qualifies: false, reason: 'Modality not allowed' };
            }
        }
        if (qual.allowedCategories && qual.allowedCategories.length > 0) {
            if (!context?.category) {
                return { objectiveId: objective.id, objectiveKey: objective.key, earnedCredit: 0, qualifies: false, reason: 'Category unknown' };
            }
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

    let durationRatio = 1;
    if (objective.key !== 'strength_maintenance'
        && dose.plannedDurationMin !== undefined
        && dose.completedDurationMin !== undefined) {
        const planned = dose.plannedDurationMin;
        const completed = dose.completedDurationMin;
        durationRatio = Number.isFinite(planned) && planned > 0 && Number.isFinite(completed) && completed >= 0
            ? clamp01(completed / planned)
            : 0;
    }

    const deliveredDoseRatio = completionRatio * durationRatio;
    const confidenceWeight = CONFIDENCE_CREDIT_WEIGHT[confidence];
    const earnedCredit = Math.round(rawStimulusContribution * deliveredDoseRatio * confidenceWeight * 100) / 100;

    return {
        objectiveId: objective.id,
        objectiveKey: objective.key,
        earnedCredit,
        qualifies: true,
    };
}

/**
 * Calculates dose-sensitive fractional objective credit derived from an untrusted or
 * persisted stimulus profile and delivered duration/completion evidence.
 */
export function deriveObjectiveCredit(
    objective: WeeklyObjective,
    rawStimulus: unknown,
    dose: DeliveredDose = {},
    context?: CreditContext,
    confidence: StimulusConfidence = 'exact',
): ObjectiveCredit {
    const stimulusState = readStimulusProfile(rawStimulus);
    if (stimulusState.status !== 'AVAILABLE') {
        return {
            objectiveId: objective.id,
            objectiveKey: objective.key,
            earnedCredit: 0,
            qualifies: false,
            reason: 'Invalid stimulus profile',
        };
    }
    return deriveObjectiveCreditFromProfile(objective, stimulusState.data, dose, context, confidence);
}

/**
 * Compatibility reader for a persisted `PlannerState`/`ObjectiveProgress` pair. The live
 * microcycle ledger also uses fractional credit; this helper remains for audit/replay callers
 * that hold progress separately from their objective objects.
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
