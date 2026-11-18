import type { DistanceEntryPayload, DurationEntryPayload } from '../../../sessions/models';
import { buildRpeGauge } from './rpeGauge';

export type SideKey = 'left' | 'right' | 'bilateral';

function optionalNumber(raw: string): number | undefined | null {
    if (raw.trim().length === 0) return undefined;
    const value = parseFloat(raw);
    return Number.isFinite(value) ? value : null;
}

/** A hold set from the card's drafts; `null` when it cannot be logged. RPE outside 1-10 is dropped. */
export function buildHoldPayload(draft: { seconds: string; loadKg: string; rpe: string }): DurationEntryPayload | null {
    const seconds = parseInt(draft.seconds, 10);
    if (!Number.isFinite(seconds) || seconds <= 0) return null;
    const loadKg = optionalNumber(draft.loadKg);
    if (loadKg === null || (loadKg !== undefined && loadKg < 0)) return null;
    const gauge = buildRpeGauge(draft.rpe);
    return {
        kind: 'duration',
        seconds,
        ...(loadKg !== undefined ? { loadKg } : {}),
        ...(gauge ? { gauge } : {}),
    };
}

/** A distance set (carry, sled, split) from the card's drafts; `null` when it cannot be logged. */
export function buildDistancePayload(
    draft: { meters: string; seconds: string; loadKg: string; rpe: string },
    acceptsLoad: boolean,
): DistanceEntryPayload | null {
    const meters = parseFloat(draft.meters);
    if (!Number.isFinite(meters) || meters <= 0) return null;
    const parsedSeconds = optionalNumber(draft.seconds);
    if (parsedSeconds === null || (parsedSeconds !== undefined && parsedSeconds < 0)) return null;
    // A zero split means "not timed": omit it (the rules require a present split to be > 0).
    const durationSeconds = parsedSeconds === 0 ? undefined : parsedSeconds;
    const loadKg = acceptsLoad ? optionalNumber(draft.loadKg) : undefined;
    if (loadKg === null || (loadKg !== undefined && loadKg < 0)) return null;
    const gauge = buildRpeGauge(draft.rpe);
    return {
        kind: 'distance',
        meters,
        ...(durationSeconds !== undefined ? { durationSeconds } : {}),
        ...(loadKg !== undefined ? { loadKg } : {}),
        ...(gauge ? { gauge } : {}),
    };
}
