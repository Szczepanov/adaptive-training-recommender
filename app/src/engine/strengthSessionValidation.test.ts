import { describe, expect, it } from 'vitest';
import type { StrengthSession } from './models';
import { assertValidStrengthSession, validateStrengthSession } from './strengthSessionValidation';

function session(extra: Record<string, unknown> = {}): StrengthSession {
    return {
        userId: 'u1',
        sessionId: 's1',
        date: '2026-08-17',
        startedAt: '2026-08-17T18:00:00Z',
        updatedAt: '2026-08-17T18:00:00Z',
        state: 'in_progress',
        exercises: [],
        schemaVersion: 1,
        ...extra,
    } as StrengthSession;
}

describe('validateStrengthSession', () => {
    it('accepts a new session and a completed session with metadata', () => {
        expect(validateStrengthSession(session())).toEqual([]);
        expect(validateStrengthSession(session({
            state: 'completed', completedAt: '2026-08-17T19:00:00Z', sessionRpe: 0, notes: 'ok', sourceRecommendationDate: '2026-08-17',
        }))).toEqual([]);
        expect(validateStrengthSession(session({ sessionRpe: 10 }))).toEqual([]);
    });

    it.each([
        ['a malformed date', { date: '2026-8-17' }, 'date'],
        ['an impossible date', { date: '2026-02-30' }, 'date'],
        ['a malformed sourceRecommendationDate', { sourceRecommendationDate: '17-08-2026' }, 'sourceRecommendationDate'],
        ['an impossible sourceRecommendationDate', { sourceRecommendationDate: '2026-13-01' }, 'sourceRecommendationDate'],
        ['schemaVersion 2', { schemaVersion: 2 }, 'schemaVersion'],
        ['an unknown state', { state: 'paused' }, 'state'],
        ['an unparseable completedAt', { state: 'completed', completedAt: 'not-a-time' }, 'completedAt'],
        ['a non-string completedAt', { state: 'completed', completedAt: 5 }, 'completedAt'],
        ['sessionRpe above 10', { sessionRpe: 11 }, 'sessionRpe'],
        ['a negative sessionRpe', { sessionRpe: -1 }, 'sessionRpe'],
        ['a NaN sessionRpe', { sessionRpe: Number.NaN }, 'sessionRpe'],
        ['a string sessionRpe', { sessionRpe: '5' }, 'sessionRpe'],
        ['notes over 2000 characters', { notes: 'x'.repeat(2001) }, 'notes'],
        ['more than 30 exercises', { exercises: Array.from({ length: 31 }, () => ({ exerciseId: 'a', sets: [] })) }, 'exercises'],
    ])('rejects %s', (_label, extra, path) => {
        expect(validateStrengthSession(session(extra)).map(issue => issue.path)).toContain(path);
        expect(() => assertValidStrengthSession(session(extra))).toThrow(/Invalid strength session/);
    });
});
