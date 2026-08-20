import { describe, expect, it } from 'vitest';
import { parseSessionResponseDocument } from './sessionResponse';
import type { SessionResponse } from '../../responses/models';

function response(): SessionResponse {
    return {
        userId: 'u1',
        responseId: 'resp-1',
        sourceSession: { kind: 'execution', id: 'exec-1', date: '2026-08-18' },
        window: 'immediate',
        date: '2026-08-18',
        checkinRef: { date: '2026-08-18' },
        createdAt: '2026-08-18T10:45:00.000Z',
        updatedAt: '2026-08-18T10:45:00.000Z',
    };
}

describe('parseSessionResponseDocument', () => {
    it('reports MISSING for an absent document', () => {
        expect(parseSessionResponseDocument(undefined, 'users/u1/session_responses/resp-1')).toEqual({ status: 'MISSING' });
        expect(parseSessionResponseDocument(null, 'users/u1/session_responses/resp-1')).toEqual({ status: 'MISSING' });
    });

    it('parses a valid document as AVAILABLE', () => {
        const result = parseSessionResponseDocument(response(), 'users/u1/session_responses/resp-1');
        expect(result).toEqual({ status: 'AVAILABLE', data: response(), revision: null });
    });

    it('reports INVALID with a documentPath and issue detail for a malformed document', () => {
        const result = parseSessionResponseDocument({ ...response(), window: 'next_week' }, 'users/u1/session_responses/resp-1');
        expect(result.status).toBe('INVALID');
        if (result.status === 'INVALID') {
            expect(result.issues[0].documentPath).toBe('users/u1/session_responses/resp-1');
            expect(result.issues[0].code).toBe('invalid-session-response');
        }
    });
});
