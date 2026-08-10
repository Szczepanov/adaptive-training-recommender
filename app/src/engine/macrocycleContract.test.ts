import { describe, expect, it } from 'vitest';
import { resolveDemandProfile } from './eventPresets';
import { buildCyclingEventPlan } from './planSchedule';
import { evaluatePeriodizationPhase } from './periodization';
import type { UserEvent } from './models';

function cyclingEvent(date: string, taper?: UserEvent['taper']): UserEvent {
    return {
        id: `macrocycle-${date}`,
        title: 'September road race',
        date,
        priority: 'A',
        lifecycle: 'scheduled',
        category: 'cycling_event',
        demandProfile: resolveDemandProfile('cycling_event', 'road_race'),
        ...(taper ? { taper } : {}),
    };
}

describe('macrocycle v5 taper contract', () => {
    it.each([
        ['2026-09-05', '2026-08-31', '2026-08-30'],
        ['2026-09-13', '2026-09-07', '2026-09-06'],
    ])('keeps the decisive peak week before the %s taper branch', (raceDate, taperStart, peakEnd) => {
        const event = cyclingEvent(raceDate);
        const planState = buildCyclingEventPlan(event);
        if (planState.status !== 'AVAILABLE') throw new Error('expected cycling plan');

        const blocks = new Map(planState.data.blocks.map(block => [block.id, block]));
        expect(blocks.get('block_peak')?.endDate).toBe(peakEnd);
        expect(blocks.get('block_taper')).toMatchObject({ startDate: taperStart, endDate: raceDate === '2026-09-05' ? '2026-09-04' : '2026-09-12' });
        const peakObjectives = planState.data.objectives.filter(objective => objective.blockId === 'block_peak').map(objective => objective.coverageKey);
        expect(peakObjectives).toContain('sustained_quality');
        expect(peakObjectives).toContain('outdoor_event_specific');
        expect(evaluatePeriodizationPhase([event], peakEnd).phase.taperActive).toBe(false);
        expect(evaluatePeriodizationPhase([event], taperStart).phase.taperActive).toBe(true);
    });

    it('honours an explicit authored taper start over the cycling A-event default', () => {
        const event = cyclingEvent('2026-09-05', { startDate: '2026-08-25' });
        const planState = buildCyclingEventPlan(event);
        if (planState.status !== 'AVAILABLE') throw new Error('expected cycling plan');
        expect(planState.data.blocks.find(block => block.id === 'block_taper')?.startDate).toBe('2026-08-25');
        expect(evaluatePeriodizationPhase([event], '2026-08-24').phase.taperActive).toBe(false);
        expect(evaluatePeriodizationPhase([event], '2026-08-25').phase.taperActive).toBe(true);
    });
});
