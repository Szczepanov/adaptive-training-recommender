import { describe, expect, it } from 'vitest';
import type { Recommendation, TrainingSettings, UserContext, UserEvent, UserPreferences } from './models';
import { ENRICHED_TEMPLATES } from './templates';
import { resolveDemandProfile } from './eventPresets';
import { buildCyclingEventPlan } from './planSchedule';
import { evaluatePeriodizationPhase } from './periodization';
import { creditObjectivesFromStimulus, generateWeeklyObjectives } from './microcycle';
import { createEmptyFatigue } from './fatigue';
import { generateWeekAheadPlan } from './planner';
import { coverageKeysForTemplate } from './coverage';
import { addDaysToLocalDateString, getDayDiff } from '../utils/localDate';

const TODAY = '2026-08-09';

function settings(): TrainingSettings {
    return {
        userId: 'specificity-contract', schemaVersion: 2,
        equipment: { free_weights: true, cable_machine: false, treadmill: false, indoor_bike: true, pullup_bar: true },
        guardrails: { avoid_high_impact: false, avoid_heavy_lower_body: false, avoid_overhead_pressing: false, avoid_heavy_spinal_loading: false },
        defaults: { weekdayMaxMinutes: 90, weekendMaxMinutes: 150, environment: 'either' },
        preferences: { preferActiveRecovery: false },
        migration: { legacyReviewed: true, migratedAt: null },
        createdAt: '', updatedAt: '',
    };
}

function context(): UserContext {
    return {
        goals: { shortTerm: '', midTerm: '', longTerm: '' },
        constraints: {
            hasCableMachine: false, hasFreeWeights: true, hasTreadmill: false, hasIndoorBike: true,
            maxTimeMinutes: 150,
        },
        preferences: { avoidedModalities: [], deprioritizedModalities: [], preferredModalities: ['Cycling'], conservativeBias: false },
        trainingSettings: settings(),
    };
}

const preferences: UserPreferences = {
    userId: 'specificity-contract', preferredRecoveryStyle: 'mixed',
    defaultWeekdayTimeMin: 90, defaultWeekendTimeMin: 150, preferredTimeOfDay: 'flexible',
    preferredModalities: ['Cycling'], deprioritizedModalities: [], avoidedModalities: [],
    explanationVerbosity: 'detailed', conservativeBias: false,
    preferredUnits: { distance: 'km', weight: 'kg', temperature: 'celsius' },
    schemaVersion: 1, createdAt: '', updatedAt: '',
};

function event(): UserEvent {
    return {
        id: 'specificity-a-event', title: 'Road race', date: '2026-09-13',
        priority: 'A', lifecycle: 'scheduled', category: 'cycling_event',
        demandProfile: resolveDemandProfile('cycling_event', 'road_race'),
    };
}

function templateByCategory(category: string, modality = 'Cycling') {
    const template = ENRICHED_TEMPLATES.find(item => item.category === category && item.modality === modality);
    if (!template) throw new Error(`Missing ${modality} ${category}`);
    return template;
}

describe('escaped coaching contract: Specificity after hard race-specific day -1', () => {
    it('recovers immediately without allowing support work to replace the rolling developmental roles', () => {
        const focusEvent = event();
        const periodization = evaluatePeriodizationPhase([focusEvent], TODAY);
        expect(periodization.phase.phaseName).toBe('Specificity');

        const planState = buildCyclingEventPlan(focusEvent);
        if (planState.status !== 'AVAILABLE') throw new Error('event plan unavailable');
        const raceSpecific = templateByCategory('Race-Specific Endurance');
        const recovery = ENRICHED_TEMPLATES.find(item => item.category === 'Mobility/Recovery');
        if (!recovery || !raceSpecific.stimulusProfile) throw new Error('required templates missing');

        // Deliberately reproduce the original failure mechanism: yesterday's hard
        // race-specific work cross-credits physiological objectives before the next week
        // is planned. Coverage must remain independent from those adaptation credits.
        let microcycle = generateWeeklyObjectives(
            periodization.phase,
            addDaysToLocalDateString(TODAY, -7),
            focusEvent,
            planState.data,
            TODAY,
        );
        microcycle = creditObjectivesFromStimulus(
            microcycle,
            raceSpecific.stimulusProfile,
            raceSpecific.modality,
            raceSpecific.category,
        );

        const todayRec: Recommendation = {
            template: recovery,
            rationale: 'Appropriate immediate recovery after yesterday hard race-specific work.',
            mode: 'recover',
        };

        const week = generateWeekAheadPlan(
            {
                subjective: {
                    readiness: 6, sleepQuality: 7, fatigue: 4, soreness: 4, stress: 3, motivation: 7,
                    timeAvailable: 120, painFlag: false, alreadyTrainedToday: false, preferredModalityToday: null,
                },
                objective: {
                    total_steps: 8000, sleep_score: 82, sleep_duration_min: 460, rhr: 50, rhr_7d_avg: 50, rhr_delta: 0,
                    hrv_weekly_avg: 50, hrv_last_night: 50, hrv_delta: 0, respiration: 14, body_battery_wake: 80,
                    last_3_days_hard_sessions_count: 1, yesterday_training: null, today_training: null,
                    sleep_score_delta_7d: 0, rhr_delta_28d: 0, hrv_delta_28d: 0, sleep_score_delta_28d: 0,
                    hrv_stdev_28d: 8, rhr_stdev_28d: 3, sleep_score_stdev_28d: 8,
                },
            },
            context(),
            preferences,
            TODAY,
            todayRec,
            null,
            {
                microcycle,
                fatigue: createEmptyFatigue(TODAY),
                trailingHistory: [{
                    date: addDaysToLocalDateString(TODAY, -1),
                    templateId: raceSpecific.id,
                    category: raceSpecific.category,
                    modality: raceSpecific.modality,
                    role: 'anchor',
                    systemicCost: raceSpecific.systemicCost,
                    lowerBodyCost: raceSpecific.costProfile?.lowerBody ?? 0,
                    type: raceSpecific.title,
                }],
            },
            { days: 7, events: [focusEvent] },
        );

        const coverageByDay = week.days.map(day => ({
            date: day.date,
            keys: coverageKeysForTemplate(day.template, 'peak'),
            template: day.template,
        }));
        expect(coverageByDay.some(day => day.keys.includes('easy_aerobic'))).toBe(true);
        expect(coverageByDay.some(day => day.keys.includes('sustained_quality'))).toBe(true);
        expect(coverageByDay.some(day => day.keys.includes('outdoor_event_specific'))).toBe(true);

        const keyDates = coverageByDay
            .filter(day => day.keys.includes('sustained_quality') || day.keys.includes('outdoor_event_specific'))
            .map(day => day.date)
            .sort();
        for (let i = 1; i < keyDates.length; i++) {
            expect(getDayDiff(keyDates[i], keyDates[i - 1])).toBeGreaterThanOrEqual(2);
        }

        const technicalCount = week.days.filter(day => day.template.category === 'Technical Skill').length;
        const mobilityCount = week.days.filter(day => day.template.category === 'Mobility/Recovery').length;
        expect(technicalCount + mobilityCount).toBeLessThan(week.days.length);
    });
});
