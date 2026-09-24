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

/** Manual link (ADR-0034 "manual confirms are sticky"): merges a Garmin-only occurrence
 * into the structured occurrence the athlete says it belongs to. The structured row
 * survives so its stable ID and structured field authority are kept; the recorded `link`
 * decision is sticky, and "Unlink Garmin source" reverses it. */
export async function linkCompletedWorkoutSources(
    userId: string,
    structuredOccurrenceId: string,
    providerOccurrenceId: string,
    actor: string,
): Promise<void> {
    const now = new Date().toISOString();
    await performedTrainingOccurrenceRepository.mergeOccurrences(userId, structuredOccurrenceId, providerOccurrenceId, {
        state: 'matched',
        linkedAt: now,
        manualDecision: {
            decision: 'link',
            actor,
            decidedAt: now,
            resultingState: 'matched',
            reason: 'manual link from Activities',
        },
    });
}
