/** Immutable snapshots of a placement change. Dates are Warsaw calendar dates. */
export interface PlacementAssignment {
    sessionId: string;
    date: string;
    status: 'planned' | 'completed' | 'moved' | 'dropped' | 'superseded';
}

export interface PlacementEvent {
    userId: string;
    planId: string;
    revision: number;
    changedOn: string;
    recordedAt: string;
    previous: PlacementAssignment[];
    assignments: PlacementAssignment[];
    successors: Record<string, { revision: number; sessionId: string }>;
}

/** Returns the last recorded snapshot on or before the requested date. */
export function placementAsOf(events: readonly PlacementEvent[], date: string): PlacementAssignment[] | null {
    const latest = events.filter(event => event.changedOn <= date)
        .sort((a, b) => a.changedOn.localeCompare(b.changedOn) || a.recordedAt.localeCompare(b.recordedAt)).at(-1);
    return latest ? latest.assignments.map(assignment => ({ ...assignment })) : null;
}
