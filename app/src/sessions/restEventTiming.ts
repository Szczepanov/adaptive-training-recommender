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
