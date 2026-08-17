import { describe, expect, it } from 'vitest';
import {
    STALE_IN_PROGRESS_HOURS,
    buildNewStrengthSession,
    canTransitionStrengthSessionState,
    computeSessionDate,
    isStaleInProgressSession,
    validateStrengthSessionTransition,
} from './strengthSessionLifecycle';

describe('computeSessionDate', () => {
    it('attributes a session starting well before midnight to that same day', () => {
        expect(computeSessionDate('2026-08-17T18:00:00Z')).toBe('2026-08-17');
    });

    it('attributes a session crossing midnight Warsaw-local to its START date, not where it finished', () => {
        // 2026-08-17T23:30:00Z is 2026-08-18T01:30 in Europe/Warsaw (CEST, UTC+2) -- already
        // past local midnight at start. The session belongs to the 18th, the day it began
        // in local time, regardless of when logging continues.
        expect(computeSessionDate('2026-08-17T23:30:00Z')).toBe('2026-08-18');
    });

    it('respects the winter (CET, UTC+1) offset too, not just summer CEST', () => {
        // Warsaw is always ahead of UTC (CET UTC+1 in winter, CEST UTC+2 in summer), so a
        // UTC-split bug can only ever manifest as "local has already rolled to the next
        // day while UTC has not" -- the case above. This asserts the winter offset is
        // applied correctly too, via Intl rather than a hardcoded +1/+2.
        expect(computeSessionDate('2026-01-01T23:30:00Z')).toBe('2026-01-02');
    });
});

describe('buildNewStrengthSession', () => {
    it('creates an in_progress session with no exercises yet, dated from the start instant', () => {
        const session = buildNewStrengthSession('u1', 's1', '2026-08-17T18:00:00Z');
        expect(session).toEqual({
            userId: 'u1', sessionId: 's1', date: '2026-08-17',
            startedAt: '2026-08-17T18:00:00Z', updatedAt: '2026-08-17T18:00:00Z',
            state: 'in_progress', exercises: [], schemaVersion: 1,
        });
    });
});

describe('canTransitionStrengthSessionState / validateStrengthSessionTransition', () => {
    it('allows in_progress to move to any state, including re-saving itself', () => {
        expect(canTransitionStrengthSessionState('in_progress', 'in_progress')).toBe(true);
        expect(canTransitionStrengthSessionState('in_progress', 'completed')).toBe(true);
        expect(canTransitionStrengthSessionState('in_progress', 'abandoned')).toBe(true);
    });

    it('treats completed and abandoned as terminal', () => {
        expect(canTransitionStrengthSessionState('completed', 'in_progress')).toBe(false);
        expect(canTransitionStrengthSessionState('completed', 'abandoned')).toBe(false);
        expect(canTransitionStrengthSessionState('abandoned', 'in_progress')).toBe(false);
        expect(canTransitionStrengthSessionState('abandoned', 'completed')).toBe(false);
    });

    it('allows idempotent re-saves of a terminal state', () => {
        expect(canTransitionStrengthSessionState('completed', 'completed')).toBe(true);
        expect(canTransitionStrengthSessionState('abandoned', 'abandoned')).toBe(true);
    });

    it('reports why an illegal transition is rejected', () => {
        const result = validateStrengthSessionTransition('completed', 'in_progress');
        expect(result.ok).toBe(false);
        expect(result.reason).toMatch(/terminal/i);
    });

    it('reports success for a legal transition', () => {
        expect(validateStrengthSessionTransition('in_progress', 'completed')).toEqual({ ok: true });
    });
});

describe('isStaleInProgressSession', () => {
    it('is never stale if not in_progress', () => {
        expect(isStaleInProgressSession({ state: 'completed', startedAt: '2026-08-01T00:00:00Z' }, '2026-08-17T00:00:00Z')).toBe(false);
    });

    it('is not stale within the threshold', () => {
        const session = { state: 'in_progress' as const, startedAt: '2026-08-17T18:00:00Z' };
        expect(isStaleInProgressSession(session, '2026-08-17T19:30:00Z')).toBe(false);
    });

    it('is stale past the default threshold', () => {
        const session = { state: 'in_progress' as const, startedAt: '2026-08-17T18:00:00Z' };
        const justPast = new Date(new Date('2026-08-17T18:00:00Z').getTime() + (STALE_IN_PROGRESS_HOURS * 60 * 60 * 1000) + 1).toISOString();
        expect(isStaleInProgressSession(session, justPast)).toBe(true);
    });

    it('honours an explicit threshold override', () => {
        const session = { state: 'in_progress' as const, startedAt: '2026-08-17T18:00:00Z' };
        expect(isStaleInProgressSession(session, '2026-08-17T19:00:00Z', 0.5)).toBe(true);
    });
});
