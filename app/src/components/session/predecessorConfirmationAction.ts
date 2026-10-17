import type { PredecessorConfirmationPrompt } from '../../services/predecessorConfirmationGate';
import { sessionResponseService, type SessionResponseService } from '../../services/sessionResponseService';

/**
 * #896 recovery path: records the athlete's explicit post-session answer as the predecessor's
 * `immediate` `SessionResponse` -- the record `intradayLaunchClaim` reads as confirmation.
 * Only an explicit No / Yes reaches here; nothing is written for an unanswered prompt.
 */
export async function recordPredecessorConfirmation(
    userId: string,
    prompt: PredecessorConfirmationPrompt,
    unexpectedFatigue: boolean,
    service: SessionResponseService = sessionResponseService,
): Promise<void> {
    await service.recordOrUpdateResponse(
        userId,
        prompt.sourceSession,
        'immediate',
        prompt.sourceSession.date,
        prompt.sourceSession.date,
        { unexpectedFatigue },
        prompt.occurrenceId,
    );
}
