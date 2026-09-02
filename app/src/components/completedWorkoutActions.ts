/**
 * Diagnostic-only helper wiring `CompletedWorkoutList`'s `onUnlinkSource` to the
 * repository primitive directly (ADR-0034 "Manual reconciliation UX"). Kept out of the
 * presentational component so it stays trivially testable without mocking Firestore, and
 * in its own file (not `activityTelemetryFormat.ts`) since it is action/service logic,
 * not presentation formatting.
 */
import { performedTrainingOccurrenceRepository } from '../training-occurrence/repository';

export async function unlinkCompletedWorkoutSource(
    userId: string,
    performedOccurrenceId: string,
    sourceKey: string,
    actor: string,
): Promise<void> {
    await performedTrainingOccurrenceRepository.unlinkSource(userId, performedOccurrenceId, sourceKey, actor, 'manual diagnostic unlink from Activities');
}
