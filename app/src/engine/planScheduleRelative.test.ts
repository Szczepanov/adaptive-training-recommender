import { describe, expect, it } from 'vitest';
import { resolveDemandProfile } from './eventPresets';
import { buildCyclingEventPlan, resolvePlanDefinitionForEvent } from './planSchedule';
import type { UserEvent } from './models';
import { addDaysToLocalDateString } from '../utils/localDate';

function event(date: string, priority: UserEvent['priority'] = 'A'): UserEvent {
    return {
        id: `cycling-${date}-${priority}`,
        title: 'Cycling target',
        date,
        priority,
        lifecycle: 'scheduled',
        category: 'cycling_event',
        demandProfile: resolveDemandProfile('cycling_event', 'road_race'),
    };
}

describe('Phase 6.2c event-relative cycling PlanDefinition', () => {
    it('authors blocks from an arbitrary event date and does not fabricate travel', () => {
        const target = event('2026-09-13', 'A');
        const result = buildCyclingEventPlan(target);
        if (result.status !== 'AVAILABLE') throw new Error(JSON.stringify(result));

        const byId = new Map(result.data.blocks.map(block => [block.id, block]));
        expect(byId.get('block_build')).toMatchObject({
            startDate: addDaysToLocalDateString(target.date, -84),
            endDate: addDaysToLocalDateString(target.date, -36),
        });
        expect(byId.get('block_peak')).toMatchObject({
            startDate: addDaysToLocalDateString(target.date, -35),
            endDate: '2026-09-06',
        });
        expect(byId.get('block_taper')).toMatchObject({
            startDate: '2026-09-07',
            endDate: addDaysToLocalDateString(target.date, -1),
        });
        expect(byId.get('block_race')?.startDate).toBe(target.date);
        expect(result.data.blocks.some(block => block.phase === 'travel')).toBe(false);
    });

    it('resolves the authored plan for cycling dates other than the old 2026-09-20 fixture', () => {
        const plan = resolvePlanDefinitionForEvent(event('2026-09-13'));
        expect(plan).not.toBeNull();
        expect(plan?.blocks.find(block => block.id === 'block_race')?.startDate).toBe('2026-09-13');
    });

    it('uses the shorter B taper and no automatic C taper', () => {
        const b = buildCyclingEventPlan(event('2026-09-13', 'B'));
        const c = buildCyclingEventPlan(event('2026-09-13', 'C'));
        if (b.status !== 'AVAILABLE' || c.status !== 'AVAILABLE') throw new Error('plans unavailable');
        expect(b.data.blocks.find(block => block.phase === 'taper')?.startDate).toBe('2026-09-08');
        expect(c.data.blocks.some(block => block.phase === 'taper')).toBe(false);
        expect(c.data.blocks.find(block => block.phase === 'peak')?.endDate).toBe('2026-09-12');
    });

    it('authors distinct developmental coverage floors in build/specificity', () => {
        const result = buildCyclingEventPlan(event('2026-09-13'));
        if (result.status !== 'AVAILABLE') throw new Error('plan unavailable');
        for (const blockId of ['block_build', 'block_peak']) {
            const defs = result.data.objectives.filter(item => item.blockId === blockId);
            const byCoverage = new Map(defs.map(item => [item.coverageKey, item]));
            expect(byCoverage.get('aerobic_volume')).toMatchObject({ coverageMinimumSessions: 1, coverageTargetSessions: 2 });
            expect(byCoverage.get('sustained_quality')?.coverageMinimumSessions).toBe(1);
            expect(byCoverage.get('outdoor_event_specific')?.coverageMinimumSessions).toBe(1);
            expect(byCoverage.get('primary_strength')?.coverageMinimumSessions).toBe(1);
        }
    });
});
