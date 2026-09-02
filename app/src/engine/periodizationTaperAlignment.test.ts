import { describe, expect, it } from 'vitest';
import { evaluatePeriodizationPhase, resolveMultiEventObjectives } from './periodization';
import type { UserEvent } from './models';

const CYCLING_DEMAND = {
    aerobicEndurance: 0.8,
    thresholdPower: 0.8,
    vo2MaxPower: 0.5,
    repeatedSurges: 0.7,
    sprintPower: 0.2,
    fatigueResistance: 0.8,
    neuromuscular: 0.3,
};

function cyclingEvent(
    overrides: Partial<UserEvent> & Pick<UserEvent, 'id' | 'date' | 'priority'>,
): UserEvent {
    return {
        title: overrides.id,
        lifecycle: 'scheduled',
        category: 'cycling_event',
        demandProfile: CYCLING_DEMAND,
        ...overrides,
    };
}

describe('multi-event contributor taper policy alignment', () => {
    it('uses cycling-A race-week alignment instead of a duplicated 14-day contributor window', () => {
        const currentDate = '2026-08-12';
        const authority = cyclingEvent({ id: 'authority-a', date: '2026-08-14', priority: 'A' });
        // Saturday race: canonical cycling-A taper starts on race-week Monday (2026-08-17),
        // so ten days out this contributor is still in normal race-specific work.
        const contributor = cyclingEvent({ id: 'contributor-a', date: '2026-08-22', priority: 'A' });

        const authorityResult = evaluatePeriodizationPhase([authority, contributor], currentDate);
        const resolution = resolveMultiEventObjectives([authority, contributor], currentDate, authorityResult, []);
        const raceSpecific = resolution.objectives.find(objective => objective.key === 'race_specific_endurance');

        expect(raceSpecific?.title).toBe('Cycling Race-Specific Endurance');
    });

    it('honors an authored contributor taper start date instead of waiting for the default B window', () => {
        const currentDate = '2026-08-12';
        const authority = cyclingEvent({ id: 'authority-a', date: '2026-08-14', priority: 'A' });
        const contributor = cyclingEvent({
            id: 'contributor-b',
            date: '2026-08-22',
            priority: 'B',
            taper: { startDate: currentDate },
        });

        const authorityResult = evaluatePeriodizationPhase([authority, contributor], currentDate);
        const resolution = resolveMultiEventObjectives([authority, contributor], currentDate, authorityResult, []);
        const raceSpecific = resolution.objectives.find(objective => objective.key === 'race_specific_endurance');

        expect(raceSpecific?.title).toBe('Taper Sharpening (event-specific freshness)');
    });
});
