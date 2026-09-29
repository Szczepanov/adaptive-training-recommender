/**
 * PR 3 (training-occurrence plan): pure start/adjust/close state transitions for one
 * performed rest interval. Kept separate from `useSessionRunner.ts`'s imperative glue
 * (mirroring `restTiming.ts`'s `resolvePostEntryRestSeconds`) so the required test matrix
 * -- elapsed normally, skipped, extended, next-set-started, session-ended, no fabricated
 * duration on resume, duplicate-close idempotency -- is directly testable without a React
 * hook-testing harness, which this repository does not have.
 *
 * `actualSeconds` is always derived from this rest's own `startedAt`/`endedAt` instants,
 * never inferred from two separate `SessionEntry.completedAt` values -- the gap between
 * two entries can include setup, equipment changes, or the next work set itself.
 */
import type { RestEndReason, SessionRestEvent } from './models';

export interface ActiveRestState {
    afterEntryId: string;
    startedAt: string;
    prescribedSeconds?: number;
    adjustmentSeconds: number;
}

export type RestEventFields = Pick<
    SessionRestEvent,
    'afterEntryId' | 'startedAt' | 'endedAt' | 'actualSeconds' | 'endReason' | 'prescribedSeconds' | 'adjustmentSeconds'
>;

/**
 * Total countdown length for one active rest: prescribed plus net adjustments.
 * Clamped to >= 0 so a net-negative adjustment (or a missing prescription on a
 * local-only manual timer) can never produce a negative deadline. Pure.
 */
export function restTotalSeconds(active: ActiveRestState): number {
    return Math.max(0, (active.prescribedSeconds ?? 0) + active.adjustmentSeconds);
}

/** Wall-clock deadline (epoch ms) for one active rest. Pure. */
export function restDeadlineMs(active: ActiveRestState): number {
    return Date.parse(active.startedAt) + restTotalSeconds(active) * 1000;
}

/**
 * Whole seconds remaining until the rest deadline at `nowMs`, never negative.
 * Uses `ceil` so a rest with 900 ms left still displays `1s` instead of
 * flipping to `0s` (and firing completion) almost a second early. A throttled
 * tab that missed ticks simply observes a smaller (or zero) remainder on its
 * next repaint -- the value is derived, never accumulated. Pure.
 */
export function restSecondsRemainingAt(active: ActiveRestState, nowMs: number): number {
    const deadline = restDeadlineMs(active);
    if (!Number.isFinite(deadline) || !Number.isFinite(nowMs)) return 0;
    return Math.max(0, Math.ceil((deadline - nowMs) / 1000));
}

/**
 * Whole session-elapsed seconds between a session `startedAt` instant and
 * `nowMs`, floored and never negative. The live display derives from this on
 * every repaint rather than counting interval callbacks. Pure.
 */
export function sessionElapsedSecondsAt(startedAt: string, nowMs: number): number {
    const startMs = Date.parse(startedAt);
    if (!Number.isFinite(startMs) || !Number.isFinite(nowMs)) return 0;
    return Math.max(0, Math.floor((nowMs - startMs) / 1000));
}

export function startRest(afterEntryId: string, startedAt: string, prescribedSeconds?: number): ActiveRestState {
    return {
        afterEntryId,
        startedAt,
        ...(prescribedSeconds !== undefined ? { prescribedSeconds } : {}),
        adjustmentSeconds: 0,
    };
}

/** `deltaSeconds` may be negative (a UI could allow reducing rest); accumulated so the
 * eventual close reports total net adjustment, not just the most recent tap. */
export function adjustRest(active: ActiveRestState, deltaSeconds: number): ActiveRestState {
    return { ...active, adjustmentSeconds: active.adjustmentSeconds + deltaSeconds };
}

/**
 * Closes the active rest into durable event fields. `actualSeconds` is clamped to >= 0 so
 * a clock skew or out-of-order call can never persist a negative duration. Pure and
 * idempotent in the sense that calling it twice with the same inputs produces the same
 * result -- callers (the hook) are responsible for calling it at most once per active
 * rest instance (clearing their own "active rest" reference immediately after), which is
 * what actually prevents a duplicate persisted event, not this function itself.
 */
export function closeRest(active: ActiveRestState, endedAt: string, endReason: RestEndReason): RestEventFields {
    const actualSeconds = Math.max(0, Math.round((Date.parse(endedAt) - Date.parse(active.startedAt)) / 1000));
    return {
        afterEntryId: active.afterEntryId,
        startedAt: active.startedAt,
        endedAt,
        actualSeconds,
        endReason,
        ...(active.prescribedSeconds !== undefined ? { prescribedSeconds: active.prescribedSeconds } : {}),
        ...(active.adjustmentSeconds !== 0 ? { adjustmentSeconds: active.adjustmentSeconds } : {}),
    };
}
