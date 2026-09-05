import { describe, expect, it } from 'vitest';
import { buildCoverageState, coverageKeysForTemplate, coverageNeedTierForTemplate } from './coverage';
import { resolveDemandProfile } from './eventPresets';
import type { SessionTemplate, UserEvent } from './models';
import { buildCyclingEventPlan } from './planSchedule';
import { ENRICHED_TEMPLATES } from './templates';
import type { EventPlanCoverageKey, EventPlanPhase } from '../workouts/event-plan';

function cyclingEvent(date = '2026-09-13'): UserEvent {
    return {
        id: 'anchor-authority-event',
        title: 'Road cycling event',
        date,
        priority: 'A',
        lifecycle: 'scheduled',
        category: 'cycling_event',
        demandProfile: resolveDemandProfile('cycling_event', 'road_race'),
    };
}

function templateForCoverage(key: EventPlanCoverageKey, phase: EventPlanPhase): SessionTemplate {
    const template = ENRICHED_TEMPLATES.find(item => coverageKeysForTemplate(item, phase).includes(key));
    if (!template) throw new Error(`No engine template resolves to coverage ${key} in ${phase}`);
    return template;
}

describe('nominated anchor coverage authority', () => {
    it('keeps an event-specific anchor at tier 0 even when an earlier exposure already met its weekly minimum', () => {
        const planState = buildCyclingEventPlan(cyclingEvent());
        if (planState.status !== 'AVAILABLE') throw new Error('cycling plan should be available');

        const asOfDate = '2026-08-20';
        const raceSpecific = templateForCoverage('outdoor_event_specific', 'peak');
        const easyAerobic = templateForCoverage('aerobic_volume', 'peak');
        const state = buildCoverageState(planState.data, asOfDate, [{
            date: '2026-08-19',
            templateId: raceSpecific.id,
        }]);

        expect(state.requirements.find(item => item.key === 'outdoor_event_specific')).toMatchObject({
            minimumSessions: 1,
            completedSessions: 1,
        });
        expect(state.requirements.find(item => item.key === 'aerobic_volume')).toMatchObject({
            minimumSessions: 1,
            completedSessions: 0,
        });

        // On an unclaimed date, the already-met race-specific role does not force a repeat.
        expect(coverageNeedTierForTemplate(state, raceSpecific)).toBeGreaterThanOrEqual(2);
        expect(coverageNeedTierForTemplate(state, easyAerobic)).toBe(1);

        // On the explicitly authored anchor date, date-level role authority wins before
        // utility/cost comparison; the unmet easy floor remains available for another day.
        expect(coverageNeedTierForTemplate(state, raceSpecific, 'event-specific')).toBe(0);
        expect(coverageNeedTierForTemplate(state, easyAerobic, 'event-specific')).toBe(1);
    });

    it('applies the same date-level authority to a nominated quality anchor after its weekly minimum was met', () => {
        const planState = buildCyclingEventPlan(cyclingEvent());
        if (planState.status !== 'AVAILABLE') throw new Error('cycling plan should be available');

        const asOfDate = '2026-08-20';
        const quality = templateForCoverage('sustained_quality', 'peak');
        const state = buildCoverageState(planState.data, asOfDate, [{
            date: '2026-08-19',
            templateId: quality.id,
        }]);

        expect(state.requirements.find(item => item.key === 'sustained_quality')).toMatchObject({
            minimumSessions: 1,
            completedSessions: 1,
        });
        expect(coverageNeedTierForTemplate(state, quality)).toBeGreaterThanOrEqual(2);
        expect(coverageNeedTierForTemplate(state, quality, 'quality')).toBe(0);
    });
});
