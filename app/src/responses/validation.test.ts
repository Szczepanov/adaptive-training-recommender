import { describe, expect, it } from 'vitest';
import { validateSessionResponse } from './validation';
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
        expect(validateSessionResponse(response({ window })).ok).toBe(true);
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
