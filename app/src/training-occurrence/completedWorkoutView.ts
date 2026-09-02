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
import { isProviderActivityRef, isStructuredExecutionRef, type PerformedTrainingOccurrence, type ReconciliationProvenance } from './models';

export interface CompletedWorkoutSourceBadge {
    hasStructured: boolean;
    hasProvider: boolean;
    providers: string[];
}

export interface CompletedWorkoutStructuredDetail {
    title: string;
    comparison: PerformedSessionComparison;
}

export interface CompletedWorkoutView {
    performedOccurrenceId: string;
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
