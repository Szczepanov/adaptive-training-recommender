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
import type { FitWorkoutIdentityObservation } from './fitWorkoutIdentityDiagnostics';
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

/**
 * #895 WP5: what each source read actually returned, so "absent", "unreadable" and "not
 * linked" are three different facts instead of one `undefined` field. Produced only by
 * `getCompletedWorkoutsInRange`; consumed by the pure `workoutSourceDiagnostics.ts`.
 */
export type StructuredSourceRead =
    | { status: 'not_linked' }
    | { status: 'available' }
    /** The occurrence references an execution whose document does not exist. */
    | { status: 'execution_missing' }
    | { status: 'execution_invalid' }
    | { status: 'execution_unavailable' }
    | { status: 'definition_unresolved'; definition: 'MISSING' | 'INVALID' | 'UNAVAILABLE' }
    | { status: 'entries_unavailable' };

export type ProviderSourceRead =
    | 'not_linked'
    /** Only non-Garmin providers are attached; the v1 DTO has a Garmin telemetry slot only. */
    | 'non_garmin_only'
    | 'available'
    /** More than one provider source is attached (the DTO surfaces only the first Garmin
     * one). Mirrors `trainingResponseEvidence`, which reports several measured sources as
     * `ambiguous`. `multiple_available`: every Garmin ref hydrated; `multiple_incomplete`: some
     * Garmin ref has no record in the fetched window. */
    | 'multiple_available'
    | 'multiple_incomplete'
    /** The activities read succeeded but the linked Garmin ref has no record in the fetched
     * window. Deliberately not "deleted": the read window is bounded. */
    | 'activity_not_in_read_window'
    | 'activities_unreadable';

/** Device-local diary receipts (`sessionDiaryReceipts.ts`) for the linked execution. They
 * exist only on the device that wrote the diary, so zero here is not proof of "synced". */
export type OutboxSnapshot =
    | { status: 'not_linked' }
    | { status: 'read'; queued: number; failed: number }
    | { status: 'unreadable' };

/** `completed` = the sweep ran and evaluated every source. `incomplete` = it returned without
 * throwing but skipped sources (unreadable Activities, per-source errors). `failed` = it threw.
 * `not_run` = the caller read the canonical window without sweeping. Only `completed` licenses
 * a "no candidate" or "nothing recorded" claim. */
export type ReconciliationSweepStatus = 'completed' | 'incomplete' | 'failed' | 'not_run';

export interface CompletedWorkoutSourceReads {
    structured: StructuredSourceRead;
    provider: ProviderSourceRead;
    outbox: OutboxSnapshot;
    reconciliationSweep: ReconciliationSweepStatus;
    /** True when this window holds an `ambiguous` occurrence of the opposite source kind within
     * one local day. Ambiguous provenance stores no candidate ids and only the newly created
     * side is marked, so this single-source row may be its (unmarked) counterpart: "no
     * candidate" cannot be asserted for it. Conservative by construction. */
    ambiguousCounterpart: boolean;
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
    /** Read statuses behind `structured`/`garmin` (#895 WP5). Never inferred from the
     * presence of those fields: an `undefined` `structured` can mean any of several things. */
    sourceReads: CompletedWorkoutSourceReads;
    /** ADR-0051 D7: execution vs provider semantic FIT fingerprint. Absent on views built
     * without it, which the export reports as `not_observable`, never as a mismatch. */
    fitWorkoutIdentity?: FitWorkoutIdentityObservation;
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
