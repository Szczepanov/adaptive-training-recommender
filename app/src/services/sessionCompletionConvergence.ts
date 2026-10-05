import type { SessionExecution } from '../sessions/models';
import { sessionOccurrenceService } from './sessionOccurrenceService';
import { sessionResponseService } from './sessionResponseService';
import { reconcileStructuredCompletion } from '../training-occurrence';

/**
 * Converges retryable downstream records from canonical durable terminal evidence.
 * Failures are intentionally isolated: once the execution is terminal, a temporary
 * response/occurrence/reconciliation outage must not turn completion into a failure.
 */
export async function convergeCompletedExecution(
    userId: string,
    execution: SessionExecution,
    dominantModality?: string,
): Promise<void> {
    if (execution.state !== 'completed') return;
    const evidence = execution.completionEvidence;

    if (evidence) {
        try {
            await sessionResponseService.recordOrUpdateResponse(
                userId,
                { kind: 'execution', id: execution.executionId, date: execution.date },
                'immediate',
                execution.date,
                execution.date,
                {
                    ...(evidence.sessionRpe !== undefined ? { sessionRpe: evidence.sessionRpe } : {}),
                    ...(evidence.completedFraction !== undefined ? { completedFraction: evidence.completedFraction } : {}),
                    ...(evidence.unexpectedFatigue !== undefined ? { unexpectedFatigue: evidence.unexpectedFatigue } : {}),
                    ...(evidence.note !== undefined ? { note: evidence.note } : {}),
                },
                execution.occurrenceId,
                evidence.submittedAt,
            );
        } catch (error) {
            console.warn('[sessionCompletionConvergence] immediate response convergence failed:', error);
        }
    }

    if (execution.occurrenceId) {
        try {
            await sessionOccurrenceService.transitionOccurrenceState(
                userId,
                execution.occurrenceId,
                'completed',
                execution.completedAt ?? execution.updatedAt,
            );
        } catch (error) {
            console.warn('[sessionCompletionConvergence] occurrence convergence failed:', error);
        }
    }

    try {
        await reconcileStructuredCompletion(userId, execution, dominantModality);
    } catch (error) {
        console.warn('[sessionCompletionConvergence] performed-training reconciliation failed:', error);
    }
}
