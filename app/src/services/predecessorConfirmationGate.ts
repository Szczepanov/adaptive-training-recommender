import type { ReassessmentResult } from '../engine/intradayReassessment';
import type { SessionResponseSourceRef } from '../responses/models';

/**
 * Presentation-only: what the athlete must answer before a dependent same-day member can
 * launch. `AdditionalSessionsCard` renders it as an explicit unexpected-fatigue No / Yes
 * question, whose answer becomes the predecessor's `immediate` `SessionResponse`.
 */
export interface PredecessorConfirmationPrompt {
    sourceSession: SessionResponseSourceRef;
    occurrenceId?: string;
    title?: string;
}

const PREDECESSOR_CONFIRMATION_REASON = 'Answer the check-in for your earlier session to unlock this one.';

interface PredecessorConfirmationFacts {
    /** The predecessor's structured execution; `null` when none is linked to its occurrence. */
    executionId: string | null;
    /** Warsaw-local date of that execution (the `immediate` window's own date). */
    executionDate?: string;
    predecessorCompleted: boolean;
    /** The predecessor's `immediate` response exists *and* carries an explicit fatigue answer. */
    hasExplicitFatigueAnswer: boolean;
    occurrenceId?: string | null;
    title?: string;
}

/**
 * #896: an untouched completion sheet no longer writes an `immediate` response, so a
 * completed predecessor can lack the confirmation `intradayLaunchClaim` requires for every
 * execution-backed predecessor. A response holding only sRPE or a note is no confirmation
 * either: `reassessDependentBundleMember` reads an absent `unexpectedFatigue` as "no
 * fatigue", which is exactly the implicit negative #896 forbids. So the member gets a prompt
 * until an explicit answer exists, and a `proceed` verdict is downgraded to `pending` rather
 * than offering a Start control on an unanswered symptom question. Answering updates the
 * response, moving its `updatedAt`, so the re-adjudicated decision pins the new confirmation
 * revision the claim compares. A `reject` stays a reject -- nothing to unlock.
 */
export function gatePredecessorConfirmation(
    verdict: ReassessmentResult,
    facts: PredecessorConfirmationFacts,
): { verdict: ReassessmentResult; prompt?: PredecessorConfirmationPrompt } {
    if (
        !facts.executionId
        || !facts.executionDate
        || !facts.predecessorCompleted
        || facts.hasExplicitFatigueAnswer
        || verdict.decision === 'reject'
    ) {
        return { verdict };
    }
    const prompt: PredecessorConfirmationPrompt = {
        sourceSession: { kind: 'execution', id: facts.executionId, date: facts.executionDate },
        ...(facts.occurrenceId ? { occurrenceId: facts.occurrenceId } : {}),
        ...(facts.title ? { title: facts.title } : {}),
    };
    if (verdict.decision !== 'proceed') return { verdict, prompt };
    return {
        verdict: { ...verdict, decision: 'pending', reason: PREDECESSOR_CONFIRMATION_REASON, predecessorConfirmed: false },
        prompt,
    };
}
