import type { PerformedTrainingOccurrence } from './models';

/**
 * ADR-0034 requires a deterministic canonical survivor when two already-created
 * occurrences are later discovered to be the same physical workout. Creation time is the
 * primary ordering key; equal timestamps are explicitly tie-broken by canonical ID so
 * Firestore query ordering / sweep iteration order can never change the survivor.
 */
export function orderOccurrencesForMerge(
    left: PerformedTrainingOccurrence,
    right: PerformedTrainingOccurrence,
): readonly [PerformedTrainingOccurrence, PerformedTrainingOccurrence] {
    const createdAtOrder = left.createdAt.localeCompare(right.createdAt);
    const order = createdAtOrder !== 0
        ? createdAtOrder
        : left.performedOccurrenceId.localeCompare(right.performedOccurrenceId);
    return order <= 0 ? [left, right] : [right, left];
}
