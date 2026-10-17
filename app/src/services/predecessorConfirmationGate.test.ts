import { describe, expect, it } from 'vitest';
import type { ReassessmentResult } from '../engine/intradayReassessment';
import { gatePredecessorConfirmation } from './predecessorConfirmationGate';

type PredecessorConfirmationFacts = Parameters<typeof gatePredecessorConfirmation>[1];
const PREDECESSOR_CONFIRMATION_REASON = 'Answer the check-in for your earlier session to unlock this one.';

const inputRevision = {
    availabilityRevision: 'a', completedFactsRevision: 'f', checkinRevision: 'c', placementRevision: 'p', ledgerRevision: 'l',
};

function verdict(decision: ReassessmentResult['decision'], reason = 'engine reason'): ReassessmentResult {
    return { decision, reason, inputRevision, timingPrerequisiteMet: true, predecessorConfirmed: decision === 'proceed' };
}

const unconfirmed: PredecessorConfirmationFacts = {
    executionId: 'exec-am',
    executionDate: '2026-10-17',
    predecessorCompleted: true,
    hasExplicitFatigueAnswer: false,
    occurrenceId: 'occ-am',
    title: 'Morning strength',
};

describe('gatePredecessorConfirmation (#896)', () => {
    it('downgrades a proceed verdict to pending and prompts when the immediate response is missing', () => {
        const result = gatePredecessorConfirmation(verdict('proceed'), unconfirmed);
        expect(result.verdict.decision).toBe('pending');
        expect(result.verdict.reason).toBe(PREDECESSOR_CONFIRMATION_REASON);
        expect(result.verdict.predecessorConfirmed).toBe(false);
        expect(result.prompt).toEqual({
            sourceSession: { kind: 'execution', id: 'exec-am', date: '2026-10-17' },
            occurrenceId: 'occ-am',
            title: 'Morning strength',
        });
    });

    it.each(['pending', 'scale'] as const)('keeps a %s verdict unchanged but still offers the prompt', decision => {
        const original = verdict(decision);
        const result = gatePredecessorConfirmation(original, unconfirmed);
        expect(result.verdict).toBe(original);
        expect(result.prompt?.sourceSession.id).toBe('exec-am');
    });

    it('never prompts for a rejected member', () => {
        const original = verdict('reject');
        expect(gatePredecessorConfirmation(original, unconfirmed)).toEqual({ verdict: original });
    });

    it.each([
        ['the immediate response already carries an explicit fatigue answer', { hasExplicitFatigueAnswer: true }],
        ['the predecessor has no linked execution', { executionId: null }],
        ['the execution date is unknown', { executionDate: undefined }],
        ['the predecessor is not completed', { predecessorCompleted: false }],
    ] as const)('passes the verdict through untouched when %s', (_label, override) => {
        const original = verdict('proceed');
        expect(gatePredecessorConfirmation(original, { ...unconfirmed, ...override })).toEqual({ verdict: original });
    });

    it('omits absent presentation fields instead of inventing them', () => {
        const result = gatePredecessorConfirmation(verdict('pending'), { ...unconfirmed, occurrenceId: null, title: undefined });
        expect(result.prompt).toEqual({ sourceSession: { kind: 'execution', id: 'exec-am', date: '2026-10-17' } });
    });
});
