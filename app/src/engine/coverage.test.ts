import { describe, expect, it } from 'vitest';
import { WORKOUTS } from '../workouts/catalog';
import { ENRICHED_TEMPLATES } from './templates';
import { resolveDemandProfile } from './eventPresets';
import { buildCyclingEventPlan } from './planSchedule';
import {
    buildCoverageState,
    coverageKeysForExposure,
    coverageNeedTierForTemplate,
} from './coverage';
import type { SessionTemplate, UserEvent } from './models';
import { addDaysToLocalDateString } from '../utils/localDate';

function templateForWorkout(workoutId: string): SessionTemplate {
    const workout = WORKOUTS.find(item => item.id === workoutId);
    const templateId = workout?.engineTemplateIds?.[0];
    const template = ENRICHED_TEMPLATES.find(item => item.id === templateId);
    if (!template) throw new Error(`No engine template for workout ${workoutId}`);
    return template;
}

function cyclingEvent(date = '2026-09-13'): UserEvent {
    return {
        id: 'coverage-event',
        title: 'Road cycling event',
        date,
        priority: 'A',
        lifecycle: 'scheduled',
        category: 'cycling_event',
        demandProfile: resolveDemandProfile('cycling_event', 'road_race'),
    };
}

describe('Phase 6.2c explicit weekly coverage', () => {
    it('maps exact authored workout identity, never overlapping stimulus', () => {
        expect(coverageKeysForExposure({ workoutId: 'cycling_zone2_standard_01' }, 'peak'))
            .toContain('easy_aerobic');
        expect(coverageKeysForExposure({ workoutId: 'cycling_controlled_threshold_4x8_01' }, 'peak'))
            .toContain('sustained_quality');

        const eventSpecific = coverageKeysForExposure({ workoutId: 'cycling_event_specific_endurance_01' }, 'peak');
        expect(eventSpecific).toContain('outdoor_event_specific');
        expect(eventSpecific).toContain('short_surges');
        expect(eventSpecific).not.toContain('easy_aerobic');
        expect(eventSpecific).not.toContain('sustained_quality');

        expect(coverageKeysForExposure({ workoutId: 'unknown-workout' }, 'peak')).toEqual([]);
        expect(coverageKeysForExposure({ modality: 'Cycling', category: 'Race-Specific Endurance' }, 'peak')).toEqual([]);
    });

    it('keeps adaptation-compatible race-specific history from substituting for easy or sustained roles', () => {
        const event = cyclingEvent();
        const planState = buildCyclingEventPlan(event);
        if (planState.status !== 'AVAILABLE') throw new Error('cycling plan should be available');
        const asOfDate = '2026-08-20';
        const raceTemplate = templateForWorkout('cycling_event_specific_endurance_01');
        const state = buildCoverageState(planState.data, asOfDate, [{
            date: addDaysToLocalDateString(asOfDate, -1),
            templateId: raceTemplate.id,
        }]);

        const byKey = new Map(state.requirements.map(item => [item.key, item]));
        expect(byKey.get('outdoor_event_specific')?.completedSessions).toBe(1);
        expect(byKey.get('easy_aerobic')?.completedSessions).toBe(0);
        expect(byKey.get('sustained_quality')?.completedSessions).toBe(0);

        const zone2 = templateForWorkout('cycling_zone2_standard_01');
        const threshold = templateForWorkout('cycling_controlled_threshold_4x8_01');
        const technical = ENRICHED_TEMPLATES.find(item => item.modality === 'Cycling' && item.category === 'Technical Skill');
        if (!technical) throw new Error('Cycling Technical Skill template missing');

        expect(coverageNeedTierForTemplate(state, zone2)).toBe(1);
        expect(coverageNeedTierForTemplate(state, threshold)).toBe(1);
        expect(coverageNeedTierForTemplate(state, raceTemplate)).toBeGreaterThanOrEqual(2);
        expect(coverageNeedTierForTemplate(state, technical)).toBe(3);
    });

    it('expires coverage when an exposure leaves the rolling seven-day window', () => {
        const event = cyclingEvent();
        const planState = buildCyclingEventPlan(event);
        if (planState.status !== 'AVAILABLE') throw new Error('cycling plan should be available');
        const date = '2026-08-20';
        const raceTemplate = templateForWorkout('cycling_event_specific_endurance_01');
        const exposureDate = addDaysToLocalDateString(date, -6);

        const today = buildCoverageState(planState.data, date, [{ date: exposureDate, templateId: raceTemplate.id }]);
        expect(today.requirements.find(item => item.key === 'outdoor_event_specific')?.completedSessions).toBe(1);

        const tomorrow = buildCoverageState(planState.data, addDaysToLocalDateString(date, 1), [{ date: exposureDate, templateId: raceTemplate.id }]);
        expect(tomorrow.requirements.find(item => item.key === 'outdoor_event_specific')?.completedSessions).toBe(0);
    });
});
