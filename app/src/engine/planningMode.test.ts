import { describe, expect, it } from 'vitest';
import type { TrainingIntentProfile, UserEvent, UserGoal } from './models';
import { evaluatePeriodizationPhase } from './periodization';
import { resolveDemandProfile } from './eventPresets';
import { resolvePlanningContext, suggestTrainingPriorities } from './planningMode';

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

describe('training intent profile suggestions', () => {
    function goal(overrides: Partial<UserGoal & { id: string }>): UserGoal & { id: string } {
        return {
            id: 'goal-default', userId: 'u1', category: 'long-term', domain: 'other', title: 'Goal', description: null,
            priority: 3, status: 'active', targetDate: null, schemaVersion: 1, createdAt: '2026-01-01', updatedAt: '',
            ...overrides,
        };
    }

    it('maps, deduplicates, and orders active open-ended goals deterministically', () => {
        const suggestions = suggestTrainingPriorities([
            goal({ id: 'later-strength', domain: 'strength', priority: 5, createdAt: '2026-02-01' }),
            goal({ id: 'earlier-endurance', domain: 'endurance', priority: 5, createdAt: '2026-01-01' }),
            goal({ id: 'duplicate-health', domain: 'weight_loss', priority: 4 }),
            goal({ id: 'first-health', domain: 'general_fitness', priority: 4, createdAt: '2026-01-01' }),
            goal({ id: 'dated', domain: 'strength', priority: 5, targetDate: '2026-10-01' }),
            goal({ id: 'paused', domain: 'endurance', status: 'paused' }),
        ]);

        expect(suggestions).toEqual(['endurance', 'strength_muscle', 'health']);
    });

    it('falls back when no supported active, open-ended goal exists', () => {
        expect(suggestTrainingPriorities([
            goal({ domain: 'mobility' }),
            goal({ domain: 'strength', status: 'completed' }),
            goal({ domain: 'endurance', targetDate: '2026-10-01' }),
        ])).toEqual(['balanced_performance']);
    });
});
