import type { GateableSession } from './eligibility';
import { inferredSafetyTags, toGateableSession } from './externalSessionProfiles';
import type { GuardrailKey } from './models';
import { isV2Session, type AnyExternalPlanSession as ExternalPlanSession } from '../sessions/externalPlanV2';
import type { RangeOrNumber, SessionStep } from '../sessions/models';
import { EXERCISES_BY_ID } from '../workouts/exercises';
import type { ExerciseDefinition } from '../workouts/models';

/**
 * M8.1 (docs/plans/multidomain-session-authoring-execution-and-evidence.md) -- a **default-off
 * measurement candidate**, not a production adapter. `externalSessionProfiles.ts`'s
 * `inferredSafetyTags()` infers safety tags from coarse authored `modality` x `intensity`
 * alone: any strength session at moderate+ intensity gets all three of
 * `avoid_heavy_lower_body`/`avoid_overhead_pressing`/`avoid_heavy_spinal_loading`, whether it
 * contains a single heavy back squat or nothing but bench press and rows. This module reads a
 * v2+ session's real content instead -- resolved required steps, their catalog movement
 * metadata, and their actually-authored effort/load -- to classify per movement rather than
 * per coarse bucket.
 *
 * Nothing here is imported by any production selection path (`rules.ts`, `optimizer.ts`,
 * `prescription.ts`). It exists to produce a comparison report
 * (`simulation/authoredSessionProfilesComparison.ts`) that measures whether this is worth
 * shipping (M8.3) -- "code exists" is never itself authorization (M8's own framing).
 *
 * Cost/stimulus are deliberately untouched: `systemicCost` is carried through only because
 * `GateableSession` requires the field, copied unchanged from `toGateableSession()`.
 */

/** `workouts/strengthExposure.ts` (ADR-0021 D-STRCOST, a sibling default-off candidate)
 * already established this muscle-set convention for `primaryMuscles`; mirrored here rather
 * than invented afresh, kept local exactly as that module keeps its own copy local. */
const LOWER_BODY_MUSCLES = new Set(['quadriceps', 'glutes', 'hamstrings', 'calves', 'adductors', 'hip_flexors', 'soleus', 'gastrocnemius', 'tibialis_anterior']);

/** Squat/hinge patterns loaded through a rigid barbell are the axial-spine case; the same
 * pattern under a dumbbell/kettlebell/bodyweight variant is not (goblet squat, kettlebell
 * deadlift) -- lower-body-heavy without loading the spine the same way. */
const AXIAL_SPINE_PATTERNS = new Set(['squat', 'hinge']);

/** RPE >= 7 or >=75% of a known max: near-max effort, the same "near failure" direction
 * `workouts/oneRepMax.ts`'s `isNearFailureGauge` already treats as the heavy threshold. */
const HEAVY_RPE_THRESHOLD = 7;
const HEAVY_PERCENT_THRESHOLD = 75;

export interface AuthoredSessionEligibilityCandidate extends GateableSession {
    /** 'discounted' when any required step could not be resolved to a real catalog movement
     * (an unknown catalog id, or free-text) -- the "weakest link" rule
     * `strengthExposure.ts`'s `deriveStrengthExposure` already applies to its own evidence
     * tier, mirrored here rather than re-derived. */
    evidenceConfidence: 'resolved' | 'discounted';
    /** Required step ids that forced the conservative `inferredSafetyTags` fallback. */
    unresolvedStepIds: string[];
}

function rangeMax(value: RangeOrNumber | undefined): number | undefined {
    if (value === undefined) return undefined;
    return typeof value === 'number' ? value : value.max;
}

/** Authored content carries RPE two ways -- `{ kind: 'rpe', target }` (every hand-authored
 * fixture) and a bare `{ rpe }` (`canonicalWorkoutAdapter.ts`'s import path). Both are read;
 * `sessionDefinitionDiff.ts` already treats them as two independent possible sources rather
 * than one canonical field, so this mirrors that rather than picking just one. */
function effortRpe(effort: SessionStep['effort']): RangeOrNumber | undefined {
    if (!effort) return undefined;
    if (effort.kind === 'rpe' && effort.target !== undefined) return effort.target;
    return effort.rpe;
}

function isHeavyStep(step: SessionStep): boolean {
    const rpe = rangeMax(effortRpe(step.effort));
    if (rpe !== undefined && rpe >= HEAVY_RPE_THRESHOLD) return true;
    if (step.load?.kind === 'percent_one_rm' || step.load?.kind === 'percent_max') {
        return step.load.percent >= HEAVY_PERCENT_THRESHOLD;
    }
    return false;
}

/** Steps that must be performed for the session to count as done -- "optional steps cannot
 * block the session" (M8.1). Deliberately simpler than `groupProgression.ts`'s private
 * `requiredSteps()`: that helper falls back to treating an all-optional block as fully
 * required for rotation-progress math, which is the wrong answer here -- an all-optional
 * block genuinely contributes no required movement to the session's eligibility profile. */
function requiredExerciseSteps(session: ExternalPlanSession): SessionStep[] {
    if (!isV2Session(session)) return [];
    return session.definition.blocks.flatMap(block =>
        block.steps.filter(step => step.kind === 'exercise' && !step.optional),
    );
}

interface StepClassification {
    resolved: boolean;
    exercise?: ExerciseDefinition;
}

function classifyStep(step: SessionStep): StepClassification {
    if (step.exerciseRef?.kind !== 'catalog') return { resolved: false };
    const exercise = EXERCISES_BY_ID.get(step.exerciseRef.exerciseId);
    if (!exercise) return { resolved: false };
    return { resolved: true, exercise };
}

function safetyTagsForResolvedStep(step: SessionStep, exercise: ExerciseDefinition): GuardrailKey[] {
    const tags: GuardrailKey[] = [];
    const heavy = isHeavyStep(step);
    const hasBarbell = exercise.equipment.includes('barbell');
    const patterns = new Set(exercise.movementPatterns);

    if (heavy && exercise.primaryMuscles.some(muscle => LOWER_BODY_MUSCLES.has(muscle))) {
        tags.push('avoid_heavy_lower_body');
    }
    if (patterns.has('vertical_push')) {
        tags.push('avoid_overhead_pressing');
    }
    if (heavy && hasBarbell && [...patterns].some(pattern => AXIAL_SPINE_PATTERNS.has(pattern))) {
        tags.push('avoid_heavy_spinal_loading');
    }
    if (exercise.impact === 'high') {
        tags.push('avoid_high_impact');
    }
    return tags;
}

function uniqueTags(tags: GuardrailKey[]): GuardrailKey[] {
    return [...new Set(tags)];
}

/**
 * The candidate's own safety-tag derivation: fine-grained where a required step resolves to
 * a real catalog movement, falling back to today's coarse `inferredSafetyTags` for whatever
 * doesn't. "Unknown and free-text movements force conservative eligibility" (M8.1) --
 * unresolved steps never make the session look *safer*, only ever add the same conservative
 * tags production already trusts.
 */
function deriveCandidateSafetyEvidence(session: ExternalPlanSession, requiredSteps: SessionStep[]): {
    safetyTags: GuardrailKey[];
    evidenceConfidence: 'resolved' | 'discounted';
    unresolvedStepIds: string[];
} {
    const tags: GuardrailKey[] = [];
    const unresolvedStepIds: string[] = [];

    for (const step of requiredSteps) {
        const classification = classifyStep(step);
        if (classification.resolved && classification.exercise) {
            tags.push(...safetyTagsForResolvedStep(step, classification.exercise));
        } else {
            unresolvedStepIds.push(step.id);
        }
    }

    if (unresolvedStepIds.length > 0) {
        tags.push(...inferredSafetyTags(session));
    }

    return {
        safetyTags: uniqueTags(tags),
        evidenceConfidence: unresolvedStepIds.length > 0 ? 'discounted' : 'resolved',
        unresolvedStepIds,
    };
}

/** The definition's own authored duration range, in preference to the coarse authored
 * `gating` range -- the "actual definition duration" M8.1 asks for. Falls back to `gating`
 * when a v2+ session's own definition carries no duration at all. */
function candidateDuration(session: ExternalPlanSession): { durationMin: number; durationMax: number } {
    if (isV2Session(session) && session.definition.duration) {
        return { durationMin: session.definition.duration.min, durationMax: session.definition.duration.max };
    }
    return { durationMin: session.gating.durationMin, durationMax: session.gating.durationMax };
}

export function deriveAuthoredSessionEligibility(session: ExternalPlanSession): AuthoredSessionEligibilityCandidate {
    const base = toGateableSession(session);

    if (!isV2Session(session)) {
        // No step content to resolve at all -- identical to today, and correctly marked as
        // unresolved evidence rather than silently claiming a fine-grained result it never
        // computed.
        return { ...base, evidenceConfidence: 'discounted', unresolvedStepIds: [] };
    }

    const requiredSteps = requiredExerciseSteps(session);
    const { safetyTags, evidenceConfidence, unresolvedStepIds } = deriveCandidateSafetyEvidence(session, requiredSteps);
    const duration = candidateDuration(session);

    return {
        ...base,
        ...duration,
        safetyTags,
        evidenceConfidence,
        unresolvedStepIds,
    };
}
