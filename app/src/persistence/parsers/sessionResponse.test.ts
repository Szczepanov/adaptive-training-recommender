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

// Issue #1202: the sessionRpe/completedFraction range checks now also reject non-finite
// numbers on read. They must accept exactly what the former rules accepted:
// `!('sessionRpe' in data) || (data.sessionRpe is number && data.sessionRpe >= 0 && data.sessionRpe <= 10)`
// and the same for completedFraction over 0..1. NaN and Infinity always failed those bounds.
describe('parseSessionResponseDocument range back-compat (#1202)', () => {
    const responsePath = 'users/u1/session_responses/resp-1';

    it.each([
        ['absent facts', {}],
        ['sessionRpe 0', { sessionRpe: 0 }],
        ['sessionRpe 10', { sessionRpe: 10 }],
        ['a fractional sessionRpe', { sessionRpe: 6.5 }],
        ['completedFraction 0', { completedFraction: 0 }],
        ['completedFraction 1', { completedFraction: 1 }],
        ['a fractional completedFraction', { completedFraction: 0.75 }],
    ])('still parses a stored response with %s (the former rule accepted it)', (_label, overrides) => {
        expect(parseSessionResponseDocument({ ...response(), ...overrides }, responsePath).status).toBe('AVAILABLE');
    });

    it.each([
        ['sessionRpe', Number.NaN, 'sessionRpe must be a number between 0 and 10'],
        ['sessionRpe', Number.POSITIVE_INFINITY, 'sessionRpe must be a number between 0 and 10'],
        ['sessionRpe', null, 'sessionRpe must be a number between 0 and 10'],
        ['completedFraction', Number.NaN, 'completedFraction must be a number between 0 and 1'],
        ['completedFraction', Number.NEGATIVE_INFINITY, 'completedFraction must be a number between 0 and 1'],
        ['completedFraction', null, 'completedFraction must be a number between 0 and 1'],
    ])('reports %s = %s as INVALID (the former rule rejected it)', (field, value, message) => {
        expect(parseSessionResponseDocument({ ...response(), [field]: value }, responsePath)).toMatchObject({
            status: 'INVALID',
            issues: [{ field, message }],
        });
    });
});
