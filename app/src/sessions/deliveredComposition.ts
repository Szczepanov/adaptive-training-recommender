import type { MovementCompositionPattern } from './movementCompositionContract';
import type { SessionEntry } from './models';

/** Delivered work for one movement-composition pattern in one structured execution. */
export interface DeliveredPatternWork {
    /** Non-deleted working entries stamped with the pattern. */
    workingSets: number;
    /** Distinct authored step ids those entries were logged against, sorted. */
    stepIds: string[];
}

/** A performed, non-deleted working set: warm-ups, choice events and unchecked items carry no exposure. */
export function isWorkingEntry(entry: SessionEntry): boolean {
    if (entry.deletedAt) return false;
    const { payload } = entry;
    switch (payload.kind) {
        case 'repetition': return payload.reps > 0 && payload.isWarmup !== true;
        case 'duration': return payload.seconds > 0;
        case 'checkoff': return payload.completed;
        default: return false;
    }
}

/** The entries `deliveredPatternWork` counts: non-deleted working sets stamped with the pattern. */
export function deliveredPatternEntries(
    entries: readonly SessionEntry[],
    pattern: MovementCompositionPattern,
): SessionEntry[] {
    return entries.filter(entry => entry.compositionPatterns?.includes(pattern) && isWorkingEntry(entry));
}

/**
 * Issue #813 / #803 delivered-exposure rule (owner decision, 2026-10-17): a structured
 * execution delivers a movement pattern only through logged working sets whose entry carries
 * that pattern. The runner stamps `SessionEntry.compositionPatterns` from the active step at
 * log time, including after a swap that drops the pattern, so this reads what was performed
 * rather than what was authored. An authored-but-unlogged step, a warm-up set or a step with
 * no structured composition evidence never counts. Returns null when nothing qualifies:
 * absence of evidence, not a negative observation.
 */
export function deliveredPatternWork(
    entries: readonly SessionEntry[],
    pattern: MovementCompositionPattern,
): DeliveredPatternWork | null {
    const delivered = deliveredPatternEntries(entries, pattern);
    if (delivered.length === 0) return null;
    const stepIds = [...new Set(delivered.map(entry => entry.stepId).filter((id): id is string => !!id))].sort();
    return { workingSets: delivered.length, stepIds };
}
