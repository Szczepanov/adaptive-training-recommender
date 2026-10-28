/** Immutable snapshots of a placement change. Dates are Warsaw calendar dates. */
export interface PlacementAssignment {
    sessionId: string;
    date: string;
    status: 'planned' | 'completed' | 'moved' | 'dropped' | 'superseded';
}

/** Why the overlay a save replaced could not be read as its previous snapshot. */
export const PLACEMENT_PREVIOUS_STATE_REASONS = [
    'current-schema-invalid',
    'current-identity-mismatch',
    'legacy-schema-invalid',
    'legacy-identity-mismatch',
] as const;
export type PlacementPreviousStateReason = typeof PLACEMENT_PREVIOUS_STATE_REASONS[number];

export interface PlacementEvent {
    userId: string;
    planId: string;
    revision: number;
    changedOn: string;
    recordedAt: string;
    previous: PlacementAssignment[];
    assignments: PlacementAssignment[];
    successors: Record<string, { revision: number; sessionId: string }>;
    /**
     * Present only when the replaced overlay was corrupt. `previous` is then empty because the
     * prior assignments are unknown, never because none existed.
     */
    previousState?: 'invalid';
    previousStateReason?: PlacementPreviousStateReason;
}

/** True when the event's `previous` snapshot is a recorded state rather than an unknown one. */
export const hasRecordedPrevious = (event: PlacementEvent): boolean => event.previousState !== 'invalid';

/** Returns the last recorded snapshot on or before the requested date. */
export function placementAsOf(events: readonly PlacementEvent[], date: string): PlacementAssignment[] | null {
    const latest = events.filter(event => event.changedOn <= date)
        .sort((a, b) => a.changedOn.localeCompare(b.changedOn) || a.recordedAt.localeCompare(b.recordedAt)).at(-1);
    return latest ? latest.assignments.map(assignment => ({ ...assignment })) : null;
}

/**
 * The overlay as it stood before the first recorded change. History says nothing about when
 * that state began, so callers use it only as the best-known state before history starts.
 * Returns null when that first change replaced a corrupt overlay: the earlier state is unknown.
 */
export function placementBeforeHistory(events: readonly PlacementEvent[]): PlacementAssignment[] | null {
    const first = [...events]
        .sort((a, b) => a.changedOn.localeCompare(b.changedOn) || a.recordedAt.localeCompare(b.recordedAt))[0];
    return first && hasRecordedPrevious(first) ? first.previous.map(assignment => ({ ...assignment })) : null;
}
