import { describe, expect, it } from 'vitest';
import { buildCoverageState } from './coverage';
import { buildCyclingEventPlan } from './planSchedule';
import { resolveDemandProfile } from './eventPresets';
import type { UserEvent } from './models';

const event: UserEvent = {
    id: 'occurrence-test-event',
    title: 'Cycling target',
    date: '2026-09-13',
    priority: 'A',
    lifecycle: 'scheduled',
    category: 'cycling_event',
    demandProfile: resolveDemandProfile('cycling_event', 'road_race'),
};

function plan() {
    const state = buildCyclingEventPlan(event);
    if (state.status !== 'AVAILABLE') throw new Error('cycling plan unavailable');
    return state.data;
}

describe('ADR-0016 coverage occurrence idempotency', () => {
    it('counts the same physical/projected occurrence only once even if replayed twice', () => {
        const state = buildCoverageState(plan(), '2026-08-20', [
            {
                occurrenceKey: 'recommendation:2026-08-18',
                date: '2026-08-18',
                templateId: 'end_easy_01',
                durationMin: 60,
                source: 'projected',
            },
            {
                occurrenceKey: 'recommendation:2026-08-18',
                date: '2026-08-18',
                templateId: 'end_easy_01',
                durationMin: 60,
                source: 'completed',
            },
        ]);

        const easy = state.requirements.find(item => item.key === 'aerobic_volume');
        expect(easy).toBeDefined();
        expect((easy?.completedSessions ?? 0) + (easy?.projectedSessions ?? 0)).toBe(1);
        expect(easy?.credits).toHaveLength(1);
        expect(easy?.credits[0].occurrenceKey).toBe('recommendation:2026-08-18');
    });

    it('counts two genuinely different occurrences separately', () => {
        const state = buildCoverageState(plan(), '2026-08-20', [
            {
                occurrenceKey: 'recommendation:2026-08-18',
                date: '2026-08-18',
                templateId: 'end_easy_01',
                durationMin: 60,
                source: 'completed',
            },
            {
                occurrenceKey: 'recommendation:2026-08-19',
                date: '2026-08-19',
                templateId: 'end_easy_01',
                durationMin: 60,
                source: 'completed',
            },
        ]);

        const easy = state.requirements.find(item => item.key === 'aerobic_volume');
        expect(easy?.completedSessions).toBe(2);
        expect(easy?.credits.map(item => item.occurrenceKey).sort()).toEqual([
            'recommendation:2026-08-18',
            'recommendation:2026-08-19',
        ]);
    });
});
