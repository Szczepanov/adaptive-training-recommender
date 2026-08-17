import type { LoggedSet } from '../engine/models';

/**
 * Rest is derived from consecutive `LoggedSet.completedAt` timestamps (D-SETLOG, ADR-0021)
 * -- never stored separately, and never accumulated in a running counter. A counter that
 * increments once per tick is wrong the moment a background tab throttles or suspends its
 * timer (routine on a phone in a pocket between sets): the display would read low by
 * however many ticks were missed. Recomputing `now - since` from wall-clock time on every
 * tick is immune to that -- whatever ticks did fire, the next one shows the true elapsed
 * time, not an accumulated approximation of it.
 */

/** Whole seconds between two ISO instants, floored and never negative (a clock skew or a
 *  stale `nowIso` must not display as a negative countdown). */
export function elapsedSeconds(sinceIso: string, nowIso: string): number {
    const ms = new Date(nowIso).getTime() - new Date(sinceIso).getTime();
    return Number.isFinite(ms) ? Math.max(0, Math.floor(ms / 1000)) : 0;
}

/** `M:SS`, unbounded minutes (a session can run past 59 minutes; rest itself never should,
 *  but this is also used for elapsed-since-session-start displays). */
export function formatElapsed(totalSeconds: number): string {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/** Rest actually taken between two consecutive sets, for post-hoc analysis (e.g. S1.7's
 *  overload view, or a future rest-aware cost model) -- distinct from the live countdown
 *  the runner shows *before* the next set is logged, which has no "next" timestamp yet. */
export function deriveRestSecondsBetweenSets(previous: LoggedSet, next: LoggedSet): number {
    return elapsedSeconds(previous.completedAt, next.completedAt);
}

/** One entry per set, in order; the first set has no prior set to rest from. Same 5x3 at
 *  90 seconds' rest and at 4 minutes' rest are different sessions -- this is what makes
 *  that difference readable without a separately stored field the client write could ever
 *  disagree with the timestamps on. */
export function deriveRestIntervals(sets: readonly LoggedSet[]): (number | null)[] {
    return sets.map((set, index) => (index === 0 ? null : deriveRestSecondsBetweenSets(sets[index - 1], set)));
}
