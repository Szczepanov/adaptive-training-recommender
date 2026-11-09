import { describe, expect, it } from 'vitest';
import {
    assertValidSessionResponse,
    assertValidSessionResponseFacts,
    validateSessionResponse,
    validateSessionResponseFacts,
} from './validation';
import type { SessionResponse } from './models';

function response(overrides: Partial<SessionResponse> = {}): SessionResponse {
    return {
        userId: 'u1',
        responseId: 'resp-1',
        sourceSession: { kind: 'execution', id: 'exec-1', date: '2026-08-19' },
        window: 'immediate',
        date: '2026-08-19',
        checkinRef: { date: '2026-08-19' },
        createdAt: '2026-08-19T10:00:00.000Z',
        updatedAt: '2026-08-19T10:00:00.000Z',
        ...overrides,
    };
}

describe('validateSessionResponse', () => {
    it('accepts a minimal valid response', () => {
        expect(validateSessionResponse(response())).toEqual({ ok: true, value: response() });
    });

    it('accepts every optional non-tissue fact', () => {
        const full = response({
            occurrenceId: 'occ-1', sessionRpe: 7, completedFraction: 0.9,
            unexpectedFatigue: true, techniqueNote: 'form broke down late', note: 'felt good overall',
        });
        expect(validateSessionResponse(full)).toEqual({ ok: true, value: full });
    });

    it.each(['immediate', 'later_day', 'next_morning'] as const)('accepts window %s', window => {
        // date equals sourceSession.date for immediate and later_day; next_morning is later.
        const date = window === 'next_morning' ? '2026-08-20' : '2026-08-19';
        expect(validateSessionResponse(response({ window, date })).ok).toBe(true);
    });

    it('rejects an immediate-window response whose date does not equal sourceSession.date', () => {
        const result = validateSessionResponse(response({ window: 'immediate', date: '2026-08-20' }));
        expect(result.ok).toBe(false);
    });

    it('accepts a same-day later_day response', () => {
        expect(validateSessionResponse(response({ window: 'later_day', date: '2026-08-19' })).ok).toBe(true);
    });

    it('rejects a same-day next_morning response', () => {
        expect(validateSessionResponse(response({ window: 'next_morning', date: '2026-08-19' })).ok).toBe(false);
    });

    it('rejects a later_day response dated on a different day', () => {
        expect(validateSessionResponse(response({ window: 'later_day', date: '2026-08-20' })).ok).toBe(false);
        expect(validateSessionResponse(response({ window: 'later_day', date: '2026-08-18' })).ok).toBe(false);
    });

    it('rejects a next_morning response dated before the source session', () => {
        expect(validateSessionResponse(response({ window: 'next_morning', date: '2026-08-18' })).ok).toBe(false);
    });

    it('rejects an invalid window', () => {
        const result = validateSessionResponse(response({ window: 'next_week' as never }));
        expect(result.ok).toBe(false);
    });

    it('rejects a malformed sourceSession', () => {
        const result = validateSessionResponse({ ...response(), sourceSession: { kind: 'execution' } });
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.issues[0].path).toBe('sourceSession');
    });

    it('rejects an unrecognized sourceSession.kind', () => {
        const result = validateSessionResponse({ ...response(), sourceSession: { kind: 'garmin', id: 'x', date: '2026-08-19' } });
        expect(result.ok).toBe(false);
    });

    it('rejects sessionRpe outside 0-10', () => {
        expect(validateSessionResponse(response({ sessionRpe: 11 })).ok).toBe(false);
        expect(validateSessionResponse(response({ sessionRpe: -1 })).ok).toBe(false);
    });

    it('rejects completedFraction outside 0-1', () => {
        expect(validateSessionResponse(response({ completedFraction: 1.5 })).ok).toBe(false);
    });

    it('rejects a malformed checkinRef', () => {
        const result = validateSessionResponse({ ...response(), checkinRef: { date: 'not-a-date' } });
        expect(result.ok).toBe(false);
    });

    it('rejects an empty occurrenceId when present', () => {
        const result = validateSessionResponse({ ...response(), occurrenceId: '' });
        expect(result.ok).toBe(false);
    });

    it('rejects an unrecognized top-level field', () => {
        const result = validateSessionResponse({ ...response(), extraField: 'nope' });
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.issues.some(issue => issue.path === 'extraField')).toBe(true);
    });

    it('rejects a non-object input', () => {
        expect(validateSessionResponse(null).ok).toBe(false);
        expect(validateSessionResponse('nope').ok).toBe(false);
        expect(validateSessionResponse([]).ok).toBe(false);
    });

    it('rejects missing required fields', () => {
        const { userId, ...withoutUserId } = response();
        void userId;
        const result = validateSessionResponse(withoutUserId);
        expect(result.ok).toBe(false);
    });
});

// Issue #1202 (ADR-0053): one case per value check the session_responses rules no longer
// make. SessionResponseService runs these through assertValidSessionResponse (creates) and
// assertValidSessionResponseFacts (partial fact updates) before any Firestore call.
describe('session response write-side ownership (#1202)', () => {
    it.each([
        ['sourceSession.kind', { sourceSession: { kind: 'manual', id: 'exec-1', date: '2026-08-19' } }, 'sourceSession: Invalid sourceSession: expected { kind: strength|execution, id, date }'],
        ['sourceSession.id', { sourceSession: { kind: 'execution', id: '', date: '2026-08-19' } }, 'sourceSession: Invalid sourceSession: expected { kind: strength|execution, id, date }'],
        ['sourceSession.date', { sourceSession: { kind: 'execution', id: 'exec-1', date: '2026-02-30' } }, 'sourceSession: Invalid sourceSession: expected { kind: strength|execution, id, date }'],
        ['window', { window: 'next_week' }, 'window: Invalid window: next_week'],
        ['date', { date: '2026-13-01' }, 'date: date must be a YYYY-MM-DD string'],
        ['immediate date ordering', { window: 'immediate', date: '2026-08-20' }, 'date: date must equal sourceSession.date for an immediate-window response'],
        ['later_day date ordering', { window: 'later_day', date: '2026-08-18' }, 'date: date must equal sourceSession.date for a later_day response'],
        ['next_morning date ordering', { window: 'next_morning', date: '2026-08-19' }, 'date: date must be strictly later than sourceSession.date for a next_morning response'],
        ['checkinRef.date', { checkinRef: { date: '19-08-2026' } }, 'checkinRef: Invalid checkinRef: expected { date }'],
        ['sessionRpe above 10', { sessionRpe: 11 }, 'sessionRpe: sessionRpe must be a number between 0 and 10'],
        ['sessionRpe below 0', { sessionRpe: -1 }, 'sessionRpe: sessionRpe must be a number between 0 and 10'],
        ['NaN sessionRpe', { sessionRpe: Number.NaN }, 'sessionRpe: sessionRpe must be a number between 0 and 10'],
        ['completedFraction above 1', { completedFraction: 1.5 }, 'completedFraction: completedFraction must be a number between 0 and 1'],
        ['NaN completedFraction', { completedFraction: Number.NaN }, 'completedFraction: completedFraction must be a number between 0 and 1'],
        ['unexpectedFatigue type', { unexpectedFatigue: 'yes' }, 'unexpectedFatigue: unexpectedFatigue must be boolean'],
    ])('assertValidSessionResponse rejects an invalid %s', (_label, override, message) => {
        expect(() => assertValidSessionResponse({ ...response(), ...override })).toThrow(`Invalid session response: ${message}`);
    });

    it('assertValidSessionResponse accepts a valid response', () => {
        expect(() => assertValidSessionResponse(response({ sessionRpe: 0, completedFraction: 1 }))).not.toThrow();
    });

    it('validateSessionResponseFacts accepts each revisable fact', () => {
        const patch = { sessionRpe: 10, completedFraction: 0, unexpectedFatigue: false, techniqueNote: 't', note: 'n' };
        expect(validateSessionResponseFacts(patch)).toEqual({ ok: true, value: patch });
    });

    it.each([
        ['sessionRpe', { sessionRpe: 10.5 }, 'sessionRpe: sessionRpe must be a number between 0 and 10'],
        ['completedFraction', { completedFraction: -0.1 }, 'completedFraction: completedFraction must be a number between 0 and 1'],
        ['unexpectedFatigue', { unexpectedFatigue: 1 }, 'unexpectedFatigue: unexpectedFatigue must be boolean'],
        ['a provenance field', { window: 'later_day' }, 'window: Not a revisable session fact: window'],
    ])('assertValidSessionResponseFacts rejects an invalid %s', (_label, patch, message) => {
        expect(() => assertValidSessionResponseFacts(patch)).toThrow(`Invalid session response facts: ${message}`);
    });
});
