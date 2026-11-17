import { describe, expect, it } from 'vitest';
import { validateExternalPlanPlacement } from './validation';

const placement = (assignment: Record<string, unknown>) => ({
    userId: 'u1', planId: 'plan-1', revision: 1, updatedAt: '2026-11-17T08:00:00Z',
    assignments: [{ sessionId: 's1', date: '2026-11-18', ...assignment }],
});
const errorsOf = (assignment: Record<string, unknown>) =>
    validateExternalPlanPlacement(placement(assignment)).errors.map(error => error.field);

describe('validateExternalPlanPlacement drop/move reason (ledger export Phase 3C)', () => {
    it('accepts a legacy assignment without a reason, a blank reason and a coded reason', () => {
        expect(errorsOf({ status: 'moved' })).toEqual([]);
        expect(errorsOf({ status: 'dropped', reason: null })).toEqual([]);
        expect(errorsOf({ status: 'dropped', reason: { code: 'pain' } })).toEqual([]);
        expect(errorsOf({ status: 'moved', reason: { code: 'travel', note: 'Away until Friday' } })).toEqual([]);
    });

    it('accepts movedFrom only as a valid date on a moved session', () => {
        expect(errorsOf({ status: 'moved', movedFrom: '2026-11-16' })).toEqual([]);
        expect(errorsOf({ status: 'dropped', movedFrom: '2026-11-16' })).toEqual(['assignments[0].movedFrom']);
        expect(errorsOf({ status: 'moved', movedFrom: '16/11/2026' })).toEqual(['assignments[0].movedFrom']);
        // Non-string values are rejected, never thrown on.
        expect(errorsOf({ status: 'moved', movedFrom: ['2026-11-16'] })).toEqual(['assignments[0].movedFrom']);
        expect(errorsOf({ status: 'moved', movedFrom: 20261116 })).toEqual(['assignments[0].movedFrom']);
    });

    it('rejects a reason on a session that was neither moved nor dropped', () => {
        expect(errorsOf({ status: 'planned', reason: null })).toEqual(['assignments[0].reason']);
        expect(errorsOf({ status: 'completed', reason: { code: 'time' } })).toEqual(['assignments[0].reason']);
    });

    it('rejects unknown codes, extra keys and blank or over-long notes', () => {
        expect(errorsOf({ status: 'dropped', reason: { code: 'weather' } })).toEqual(['assignments[0].reason']);
        expect(errorsOf({ status: 'dropped', reason: { code: 'time', by: 'coach' } })).toEqual(['assignments[0].reason']);
        expect(errorsOf({ status: 'dropped', reason: { code: 'time', note: '   ' } })).toEqual(['assignments[0].reason']);
        expect(errorsOf({ status: 'dropped', reason: { code: 'time', note: 'x'.repeat(201) } })).toEqual(['assignments[0].reason']);
        expect(errorsOf({ status: 'dropped', reason: 'time' })).toEqual(['assignments[0].reason']);
    });
});
