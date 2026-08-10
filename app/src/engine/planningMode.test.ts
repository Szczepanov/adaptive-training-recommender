import { describe, expect, it } from 'vitest';
import type { TrainingIntentProfile, UserEvent } from './models';
import { evaluatePeriodizationPhase } from './periodization';
import { resolveDemandProfile } from './eventPresets';
import { resolvePlanningContext } from './planningMode';

function profile(mode: TrainingIntentProfile['planningMode']): TrainingIntentProfile {
    return {
        userId: 'u1', planningMode: mode, priorities: ['balanced_performance'],
        weeklyCommitment: { minSessions: 2, targetSessions: 3, maxSessions: 4 },
        organizationPreference: 'auto', schemaVersion: 1, createdAt: '', updatedAt: '',
    };
}

function event(category: UserEvent['category']): UserEvent {
    return {
        id: category, title: category, date: '2026-09-13', priority: 'A', lifecycle: 'scheduled', category,
        demandProfile: resolveDemandProfile(category, category === 'cycling_event' ? 'road_race' : undefined),
    };
}

describe('ADR-0017 planning mode resolution', () => {
    it('keeps profile-less legacy events event-directed and routes cycling through the structured plan', () => {
        const periodization = evaluatePeriodizationPhase([event('cycling_event')], '2026-08-10');
        expect(resolvePlanningContext(null, periodization, '2026-08-10')).toMatchObject({
            mode: 'event_directed', eventStrategy: 'structured_plan', focusEvent: { category: 'cycling_event' },
        });
    });

    it.each(['running_race', 'triathlon', 'strength_meet', 'general_target'] as UserEvent['category'][])(
        'uses demand-derived strategy for non-cycling event %s', category => {
            const context = resolvePlanningContext(profile('event_directed'), evaluatePeriodizationPhase([event(category)], '2026-08-10'), '2026-08-10');
            expect(context).toMatchObject({ mode: 'event_directed', eventStrategy: 'demand_derived' });
        },
    );

    it('lets explicit evergreen mode suppress event strategy and makes no-event legacy input evergreen', () => {
        const withEvent = resolvePlanningContext(profile('evergreen'), evaluatePeriodizationPhase([event('cycling_event')], '2026-08-10'), '2026-08-10');
        const withoutEvent = resolvePlanningContext(null, evaluatePeriodizationPhase([], '2026-08-10'), '2026-08-10');
        expect(withEvent).toMatchObject({ mode: 'evergreen', focusEvent: null, eventStrategy: null });
        expect(withoutEvent).toMatchObject({ mode: 'evergreen', focusEvent: null, eventStrategy: null });
    });
});
