/**
 * PR 2 (ADR-0034 / docs/plans/training-occurrence-implementation-checklist.md "PR 2 —
 * unified Activities/read model"): the provider-agnostic "completed workout" DTO the
 * Activities UI renders instead of a raw `NormalizedGarminActivity` row.
 *
 * Field-level provenance is explicit rather than flattened (ADR-0034 "Field-level
 * provenance"): `structured` carries Adaptive-authoritative planned/performed semantics,
 * `garmin` carries the full raw measured-telemetry object as-is (never copied/mutated),
 * and `garminExerciseSetsAreDiagnosticOnly` tells the UI never to render Garmin's own
 * exercise/rep/weight recognition as competing canonical content once a structured source
 * exists (ADR-0034 "Garmin exercise recognition, reps, weight, and rest metadata are
 * fallback/diagnostic evidence when a structured execution exists").
 */
import type { NormalizedGarminActivity } from '../engine/models';
import type { PerformedSessionComparison } from '../sessions/performedComparison';
import type { StructuredStepDetail } from './structuredSetDetail';
import { isProviderActivityRef, isStructuredExecutionRef, type PerformedTrainingOccurrence, type ReconciliationProvenance } from './models';

export interface CompletedWorkoutSourceBadge {
    hasStructured: boolean;
    hasProvider: boolean;
    providers: string[];
}

export type PerformedRestAvailability = 'recorded' | 'not_recorded' | 'unavailable';

export interface CompletedWorkoutStructuredDetail {
    title: string;
    comparison: PerformedSessionComparison;
    /** Prescribed target plus per-set performed rows and performed rest, per step. */
    steps: StructuredStepDetail[];
    /** `recorded`: durable performed-rest events exist. `not_recorded`: the read
     * succeeded with none (e.g. a session logged before rest events existed), so the UI
     * says so rather than implying zero rest. `unavailable`: the read itself failed, so
     * nothing may be inferred about whether rest was recorded. */
    performedRest: PerformedRestAvailability;
}

export interface CompletedWorkoutView {
    performedOccurrenceId: string;
    /** `sourceIdentity.ts` keys of every attached source -- lets a manual-link offer
     * respect a prior sticky unlink between the same two sources. */
    sourceKeys: string[];
    localDate?: string;
    modality?: string;
    startedAt?: string;
    endedAt?: string;
    sourceBadge: CompletedWorkoutSourceBadge;
    reconciliation: ReconciliationProvenance;
    structured?: CompletedWorkoutStructuredDetail;
    /** Present when at least one provider_activity source resolved to a real record.
     * Only the first/primary provider activity is surfaced in PR 2 -- the v1 UI exposes
     * one primary Garmin activity per ADR-0034's explicit allowance, even though the
     * domain model supports more. */
    garmin?: NormalizedGarminActivity;
    /** True whenever a structured source is attached -- the UI must render Garmin's own
     * `exerciseSets` (if present) as fallback/diagnostic only, never as a second
     * competing representation of exercise/rep/weight identity. */
    garminExerciseSetsAreDiagnosticOnly: boolean;
}

export function sourceBadgeFor(occurrence: Pick<PerformedTrainingOccurrence, 'sourceRefs'>): CompletedWorkoutSourceBadge {
    const providerRefs = occurrence.sourceRefs.filter(isProviderActivityRef);
    return {
        hasStructured: occurrence.sourceRefs.some(isStructuredExecutionRef),
        hasProvider: providerRefs.length > 0,
        providers: [...new Set(providerRefs.map(ref => ref.provider))],
    };
}

export interface ManualLinkCandidate {
    providerOccurrenceId: string;
    activity: NormalizedGarminActivity;
}

/**
 * ADR-0034 "Manual reconciliation UX": when automatic reconciliation left a structured
 * execution and a Garmin activity as two rows (ambiguous, or no timestamps to match on),
 * the athlete can say they are the same workout. Offered only for a structured-only row
 * and a Garmin-only row on the same local date with no known modality conflict, and never
 * for a pair the athlete previously unlinked -- that exclusion is sticky and re-linking it
 * would need its own explicit undo flow.
 */
export function manualLinkCandidatesFor(
    workout: CompletedWorkoutView,
    all: readonly CompletedWorkoutView[],
): ManualLinkCandidate[] {
    if (!workout.sourceBadge.hasStructured || workout.sourceBadge.hasProvider || !workout.localDate) return [];
    const excludedByStructured = new Set(workout.reconciliation.excludedSourceKeys ?? []);
    return all.flatMap(other => {
        if (other.performedOccurrenceId === workout.performedOccurrenceId) return [];
        if (other.sourceBadge.hasStructured || !other.garmin || other.localDate !== workout.localDate) return [];
        if (workout.modality && other.modality && workout.modality !== other.modality) return [];
        const excludedByProvider = new Set(other.reconciliation.excludedSourceKeys ?? []);
        const previouslySeparated = other.sourceKeys.some(key => excludedByStructured.has(key))
            || workout.sourceKeys.some(key => excludedByProvider.has(key));
        return previouslySeparated ? [] : [{ providerOccurrenceId: other.performedOccurrenceId, activity: other.garmin }];
    });
}
