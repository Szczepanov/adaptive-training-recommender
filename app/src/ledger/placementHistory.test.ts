import { describe, expect, it } from 'vitest';
import { placementAsOf, type PlacementEvent } from './placementHistory';

const event = (changedOn: string, recordedAt: string, date: string, status: 'planned' | 'moved'): PlacementEvent => ({
    userId: 'u', planId: 'p', revision: 1, changedOn, recordedAt, previous: [],
    assignments: [{ sessionId: 's', date, status }], successors: {},
});

describe('placementAsOf', () => {
    it('reconstructs the last change for the day regardless of input order and does not invent earlier history', () => {
        const events = [event('2026-08-19', '2026-08-19T12:00:00Z', '2026-08-22', 'moved'),
            event('2026-08-18', '2026-08-18T10:00:00Z', '2026-08-20', 'planned'),
            event('2026-08-19', '2026-08-19T08:00:00Z', '2026-08-21', 'moved')];
        expect(placementAsOf(events, '2026-08-17')).toBeNull();
        expect(placementAsOf(events, '2026-08-18')?.[0].date).toBe('2026-08-20');
        expect(placementAsOf(events, '2026-08-19')?.[0].date).toBe('2026-08-22');
        expect(events[0].assignments[0].date).toBe('2026-08-22');
    });
});
