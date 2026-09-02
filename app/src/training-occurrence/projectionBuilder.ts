/**
 * Builds the minimal display-summary fields for a `PerformedTrainingOccurrence`
 * (`localDate`, `modality`, `startedAt`, `endedAt`) from whichever sources are currently
 * attached. Intentionally tiny -- no HR/exercise/detail fields here; that projection is
 * PR 2's Activities read-model work (`docs/plans/training-occurrence-pr1-scope.md`
 * "minimum canonical record").
 *
 * Structured-execution facts win when present, matching ADR-0034's Adaptive-authoritative
 * precedence for workout identity/semantics -- a structured session's own timeline is the
 * session-of-record even though a Garmin device timer can be independently accurate.
 * Fields simply absent from every source (e.g. a Garmin activity ingested before
 * `startedAt`/`endedAt` existed) stay absent rather than fabricated.
 */
import type { PerformedTrainingOccurrence, ReconciliationSourceFacts } from './models';

export interface OccurrenceProjection {
    localDate?: string;
    modality?: string;
    startedAt?: string;
    endedAt?: string;
}

export function buildProjection(facts: readonly ReconciliationSourceFacts[]): OccurrenceProjection {
    if (facts.length === 0) return {};
    const structured = facts.find(fact => fact.sourceRef.kind === 'structured_execution');
    const primary = structured ?? facts[0];

    return {
        localDate: primary.localDate,
        modality: structured?.modality ?? facts.find(fact => fact.modality)?.modality,
        startedAt: structured?.startedAt ?? facts.find(fact => fact.startedAt)?.startedAt,
        endedAt: structured?.endedAt ?? facts.find(fact => fact.endedAt)?.endedAt,
    };
}

/** Merges a freshly-built projection onto an existing occurrence's summary fields --
 * never overwrites a known field with `undefined` (e.g. attaching a Garmin source with no
 * `startedAt` must not erase a structured execution's already-recorded `startedAt`). */
export function mergeProjection(
    existing: Pick<PerformedTrainingOccurrence, 'localDate' | 'modality' | 'startedAt' | 'endedAt'>,
    next: OccurrenceProjection,
): OccurrenceProjection {
    return {
        localDate: next.localDate ?? existing.localDate,
        modality: next.modality ?? existing.modality,
        startedAt: next.startedAt ?? existing.startedAt,
        endedAt: next.endedAt ?? existing.endedAt,
    };
}

/**
 * Projection update rule applied when attaching one additional source to an
 * already-existing occurrence (`repository.ts#attachSource`). Structured execution facts
 * are always authoritative once present, regardless of arrival order: a structured source
 * arriving after a Garmin-only occurrence overwrites the occurrence's summary fields with
 * its own; a Garmin source arriving after a structured source already exists must never
 * overwrite those fields (ADR-0034 "Source precedence rules"). This is intentionally a
 * coarse, whole-field precedence for PR 1's minimal projection -- full field-level
 * precedence (exercise/set detail) is PR 2 scope.
 */
export function projectionAfterAttach(
    occurrence: PerformedTrainingOccurrence,
    incoming: ReconciliationSourceFacts,
): OccurrenceProjection {
    const incomingIsStructured = incoming.sourceRef.kind === 'structured_execution';
    const occurrenceHasStructured = occurrence.sourceRefs.some(ref => ref.kind === 'structured_execution');

    if (incomingIsStructured) return mergeProjection(occurrence, buildProjection([incoming]));
    if (occurrenceHasStructured) return mergeProjection(occurrence, {});
    return mergeProjection(occurrence, buildProjection([incoming]));
}
