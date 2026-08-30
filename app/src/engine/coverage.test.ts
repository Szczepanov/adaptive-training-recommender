import { describe, expect, it } from 'vitest';
import { ENRICHED_TEMPLATES } from './templates';
import { resolveDemandProfile } from './eventPresets';
import { buildCyclingEventPlan } from './planSchedule';
import {
    buildCoverageState,
    coverageKeysForExposure,
    coverageKeysForTemplate,
    coverageNeedTierForTemplate,
    getUnfulfilledRequiredCoverage,
    getUnfulfilledTargetCoverage,
} from './coverage';
import type { SessionTemplate, UserEvent } from './models';
import { addDaysToLocalDateString } from '../utils/localDate';
import { EVERGREEN_GENERAL_COVERAGE_SET, type EventPlanCoverageKey, type EventPlanPhase } from '../workouts/event-plan';

function templateForCoverage(key: EventPlanCoverageKey, phase: EventPlanPhase): SessionTemplate {
    const template = ENRICHED_TEMPLATES.find(item => coverageKeysForTemplate(item, phase).includes(key));
    if (!template) throw new Error(`No engine template resolves to coverage ${key} in ${phase}`);
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
    it('credits a true continuous run, while keeping walk-run distinct, for evergreen aerobic volume', () => {
        expect(coverageKeysForExposure({ workoutId: 'running_easy_continuous_01', durationMin: 40 }, 'general', EVERGREEN_GENERAL_COVERAGE_SET)).toContain('aerobic_volume');
        expect(coverageKeysForExposure({ workoutId: 'running_walk_run_01', durationMin: 40 }, 'general', EVERGREEN_GENERAL_COVERAGE_SET)).not.toContain('aerobic_volume');
    });

    it('keeps the Running legacy bridge reachable without weakening the aerobic-volume duration floor', () => {
        const running = ENRICHED_TEMPLATES.find(template => template.id === 'end_easy_02');
        const cycling = ENRICHED_TEMPLATES.find(template => template.id === 'end_easy_01');
        if (!running || !cycling) throw new Error('Continuous aerobic engine templates missing');

        expect(running.durationMin).toBe(30);
        expect(running.easierDose).toMatchObject({ durationMin: 30, durationMax: 30 });
        expect(coverageKeysForTemplate(running, 'general', EVERGREEN_GENERAL_COVERAGE_SET)).toContain('aerobic_volume');
        expect(coverageKeysForTemplate(cycling, 'general', EVERGREEN_GENERAL_COVERAGE_SET)).toContain('aerobic_volume');
        expect(coverageKeysForExposure({ templateId: running.id, durationMin: 29 }, 'general', EVERGREEN_GENERAL_COVERAGE_SET)).not.toContain('aerobic_volume');
        expect(coverageKeysForExposure({ templateId: running.id, durationMin: 30 }, 'general', EVERGREEN_GENERAL_COVERAGE_SET)).toContain('aerobic_volume');
    });

    it('adds a first-class Walking bridge without weakening the aerobic-volume duration floor', () => {
        // Walking gap: resolveEvidenceBackedStrategy() already permits 'Walking' as an
        // aerobic substitution modality, but no SessionTemplate/workout previously existed
        // to fulfill it -- a Walking-preferring, no-bike, non-runner athlete had zero
        // reachable candidates for a required evergreen aerobic role. end_walk_01 /
        // walking_brisk_continuous_01 close that gap the same way end_easy_02 closed it for
        // Running: a genuinely purposeful continuous exposure, distinct from generic
        // recovery walking, at or above the shared 30-minute continuous-aerobic floor.
        const walking = ENRICHED_TEMPLATES.find(template => template.id === 'end_walk_01');
        if (!walking) throw new Error('Continuous walking engine template missing');

        expect(walking.modality).toBe('Walking');
        expect(walking.durationMin).toBeGreaterThanOrEqual(30);
        expect(coverageKeysForTemplate(walking, 'general', EVERGREEN_GENERAL_COVERAGE_SET)).toContain('aerobic_volume');
        expect(coverageKeysForExposure({ templateId: walking.id, durationMin: 29 }, 'general', EVERGREEN_GENERAL_COVERAGE_SET)).not.toContain('aerobic_volume');
        expect(coverageKeysForExposure({ templateId: walking.id, durationMin: 30 }, 'general', EVERGREEN_GENERAL_COVERAGE_SET)).toContain('aerobic_volume');
    });

    it('maps exact authored workout identity, never overlapping stimulus', () => {
        expect(coverageKeysForExposure({ workoutId: 'cycling_zone2_standard_01', durationMin: 60 }, 'peak')).toContain('aerobic_volume');
        expect(coverageKeysForExposure({ workoutId: 'cycling_zone2_standard_01', durationMin: 20 }, 'peak')).not.toContain('aerobic_volume');
        const recoverySpin = coverageKeysForExposure({ workoutId: 'cycling_recovery_spin_01', durationMin: 60 }, 'peak');
        expect(recoverySpin).toContain('recovery_spin');
        expect(recoverySpin).not.toContain('aerobic_volume');
        expect(coverageKeysForExposure({ workoutId: 'cycling_controlled_threshold_4x8_01' }, 'peak')).toContain('sustained_quality');
        const eventSpecific = coverageKeysForExposure({ workoutId: 'cycling_event_specific_endurance_01' }, 'peak');
        expect(eventSpecific).toContain('outdoor_event_specific');
        expect(eventSpecific).toContain('short_surges');
        expect(eventSpecific).not.toContain('aerobic_volume');
        expect(eventSpecific).not.toContain('sustained_quality');
        expect(coverageKeysForExposure({ workoutId: 'unknown-workout' }, 'peak')).toEqual([]);
        expect(coverageKeysForExposure({ modality: 'Cycling', category: 'Race-Specific Endurance' }, 'peak')).toEqual([]);
    });

    it('uses the same coarse-template -> detailed-workout resolution as prescription generation', () => {
        expect(coverageKeysForTemplate(templateForCoverage('aerobic_volume', 'peak'), 'peak')).toContain('aerobic_volume');
        expect(coverageKeysForTemplate(templateForCoverage('sustained_quality', 'peak'), 'peak')).toContain('sustained_quality');
        expect(coverageKeysForTemplate(templateForCoverage('outdoor_event_specific', 'peak'), 'peak')).toContain('outdoor_event_specific');
        expect(coverageKeysForTemplate(templateForCoverage('recovery_or_rest', 'peak'), 'peak')).toContain('recovery_or_rest');
    });

    it('keeps adaptation-compatible race-specific history from substituting for aerobic or sustained roles and times hard roles to anchors', () => {
        const event = cyclingEvent();
        const planState = buildCyclingEventPlan(event);
        if (planState.status !== 'AVAILABLE') throw new Error('cycling plan should be available');
        const asOfDate = '2026-08-20';
        const raceTemplate = templateForCoverage('outdoor_event_specific', 'peak');
        const state = buildCoverageState(planState.data, asOfDate, [{
            date: addDaysToLocalDateString(asOfDate, -1),
            templateId: raceTemplate.id,
        }]);

        const byKey = new Map(state.requirements.map(item => [item.key, item]));
        expect(byKey.get('outdoor_event_specific')?.completedSessions).toBe(1);
        expect(byKey.get('aerobic_volume')?.completedSessions).toBe(0);
        expect(byKey.get('sustained_quality')?.completedSessions).toBe(0);
        expect(byKey.get('recovery_or_rest')?.completedSessions).toBe(0);

        const zone2 = templateForCoverage('aerobic_volume', 'peak');
        const threshold = templateForCoverage('sustained_quality', 'peak');
        const recovery = templateForCoverage('recovery_or_rest', 'peak');
        const technical = ENRICHED_TEMPLATES.find(item => item.modality === 'Cycling' && item.category === 'Technical Skill');
        if (!technical) throw new Error('Cycling Technical Skill template missing');

        expect(coverageNeedTierForTemplate(state, zone2)).toBe(1);
        expect(coverageNeedTierForTemplate(state, threshold)).toBe(2);
        expect(coverageNeedTierForTemplate(state, threshold, 'quality')).toBe(0);
        expect(coverageNeedTierForTemplate(state, recovery)).toBe(2);
        expect(coverageNeedTierForTemplate(state, raceTemplate)).toBeGreaterThanOrEqual(2);
        expect(coverageNeedTierForTemplate(state, technical)).toBe(3);
    });

    it('keeps recovery spins and abbreviated Zone 2 out of the aerobic-volume floor', () => {
        const planState = buildCyclingEventPlan(cyclingEvent());
        if (planState.status !== 'AVAILABLE') throw new Error('cycling plan should be available');
        const asOfDate = '2026-08-20';
        const history = [
            { date: '2026-08-18', workoutId: 'cycling_recovery_spin_01', durationMin: 45 },
            { date: '2026-08-19', workoutId: 'cycling_zone2_standard_01', durationMin: 20 },
        ];
        const state = buildCoverageState(planState.data, asOfDate, history);
        const aerobicVolume = state.requirements.find(item => item.key === 'aerobic_volume');

        expect(aerobicVolume).toMatchObject({ minimumSessions: 1, targetSessions: 2, completedSessions: 0 });
        expect(getUnfulfilledRequiredCoverage(state).map(item => item.key)).toContain('aerobic_volume');
        expect(getUnfulfilledTargetCoverage(state).map(item => item.key)).toContain('aerobic_volume');

        const completed = buildCoverageState(planState.data, asOfDate, [
            ...history,
            { date: '2026-08-17', workoutId: 'cycling_zone2_standard_01', durationMin: 60 },
        ]);
        expect(completed.requirements.find(item => item.key === 'aerobic_volume')).toMatchObject({ completedSessions: 1, targetSessions: 2 });
        expect(getUnfulfilledRequiredCoverage(completed).map(item => item.key)).not.toContain('aerobic_volume');
        expect(getUnfulfilledTargetCoverage(completed).map(item => item.key)).toContain('aerobic_volume');
    });

    it('expires coverage when an exposure leaves the rolling seven-day window', () => {
        const event = cyclingEvent();
        const planState = buildCyclingEventPlan(event);
        if (planState.status !== 'AVAILABLE') throw new Error('cycling plan should be available');
        const date = '2026-08-20';
        const raceTemplate = templateForCoverage('outdoor_event_specific', 'peak');
        const exposureDate = addDaysToLocalDateString(date, -6);
        const today = buildCoverageState(planState.data, date, [{ date: exposureDate, templateId: raceTemplate.id }]);
        expect(today.requirements.find(item => item.key === 'outdoor_event_specific')?.completedSessions).toBe(1);
        const tomorrow = buildCoverageState(planState.data, addDaysToLocalDateString(date, 1), [{ date: exposureDate, templateId: raceTemplate.id }]);
        expect(tomorrow.requirements.find(item => item.key === 'outdoor_event_specific')?.completedSessions).toBe(1);
        const dayAfterTomorrow = buildCoverageState(planState.data, addDaysToLocalDateString(date, 2), [{ date: exposureDate, templateId: raceTemplate.id }]);
        expect(dayAfterTomorrow.requirements.find(item => item.key === 'outdoor_event_specific')?.completedSessions).toBe(0);
    });
});
