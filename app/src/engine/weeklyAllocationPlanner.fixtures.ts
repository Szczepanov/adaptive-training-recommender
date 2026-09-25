import type { Recommendation, TrainingSettings, UserContext, UserEvent, UserPreferences } from './models';
import { ENRICHED_TEMPLATES } from './templates';
import { resolveDemandProfile } from './eventPresets';
import { buildCyclingEventPlan } from './planSchedule';
import { evaluatePeriodizationPhase } from './periodization';
import { creditObjectivesFromStimulus, generateWeeklyObjectives } from './microcycle';
import { createEmptyFatigue } from './fatigue';
import { generateWeekAheadPlan } from './planner';
import { addDaysToLocalDateString } from '../utils/localDate';

/** Shared live-sized week fixture for the planner unit tests and the isolated latency gate. */

export const TODAY = '2026-08-09';

export function settings(): TrainingSettings {
    return {
        userId: 'allocation-planner', schemaVersion: 2,
        equipment: { free_weights: true, cable_machine: false, treadmill: false, indoor_bike: true, pullup_bar: true },
        guardrails: { avoid_high_impact: false, avoid_heavy_lower_body: false, avoid_overhead_pressing: false, avoid_heavy_spinal_loading: false },
        defaults: { weekdayMaxMinutes: 90, weekendMaxMinutes: 150, environment: 'either' },
        preferences: { preferActiveRecovery: false },
        migration: { legacyReviewed: true, migratedAt: null },
        createdAt: '', updatedAt: '',
    };
}

export function context(): UserContext {
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

export const preferences: UserPreferences = {
    userId: 'allocation-planner', preferredRecoveryStyle: 'mixed',
    defaultWeekdayTimeMin: 90, defaultWeekendTimeMin: 150, preferredTimeOfDay: 'flexible',
    preferredModalities: ['Cycling'], deprioritizedModalities: [], avoidedModalities: [],
    explanationVerbosity: 'detailed', conservativeBias: false,
    preferredUnits: { distance: 'km', weight: 'kg', temperature: 'celsius' },
    schemaVersion: 1, createdAt: '', updatedAt: '',
};

export function event(): UserEvent {
    return {
        id: 'allocation-a-event', title: 'Road race', date: '2026-09-13',
        priority: 'A', lifecycle: 'scheduled', category: 'cycling_event',
        demandProfile: resolveDemandProfile('cycling_event', 'road_race'),
    };
}

export const readiness = {
    subjective: {
        readiness: 7, sleepQuality: 7, fatigue: 3, soreness: 3, stress: 3, motivation: 7,
        timeAvailable: 120, painFlag: false, alreadyTrainedToday: false, preferredModalityToday: null,
    },
    objective: {
        total_steps: 8000, sleep_score: 84, sleep_duration_min: 460, rhr: 50, rhr_7d_avg: 50, rhr_delta: 0,
        hrv_weekly_avg: 50, hrv_last_night: 50, hrv_delta: 0, respiration: 14, body_battery_wake: 84,
        last_3_days_hard_sessions_count: 0, yesterday_training: null, today_training: null,
        sleep_score_delta_7d: 0, rhr_delta_28d: 0, hrv_delta_28d: 0, sleep_score_delta_28d: 0,
        hrv_stdev_28d: 8, rhr_stdev_28d: 3, sleep_score_stdev_28d: 8,
    },
};

export function liveSizedWeek() {
    const focusEvent = event();
    const periodization = evaluatePeriodizationPhase([focusEvent], TODAY);
    const planState = buildCyclingEventPlan(focusEvent);
    if (planState.status !== 'AVAILABLE') throw new Error('event plan unavailable');
    const raceSpecific = ENRICHED_TEMPLATES.find(item => item.category === 'Race-Specific Endurance' && item.modality === 'Cycling');
    const recovery = ENRICHED_TEMPLATES.find(item => item.category === 'Mobility/Recovery');
    if (!recovery || !raceSpecific?.stimulusProfile) throw new Error('required templates missing');

    let microcycle = generateWeeklyObjectives(
        periodization.phase, addDaysToLocalDateString(TODAY, -7), focusEvent, planState.data, TODAY,
    );
    microcycle = creditObjectivesFromStimulus(microcycle, raceSpecific.stimulusProfile, raceSpecific.modality, raceSpecific.category);

    const todayRec: Recommendation = { template: recovery, rationale: 'Recovery.', mode: 'recover' };
    return {
        focusEvent, periodization, microcycle, todayRec,
        run: () => generateWeekAheadPlan(
            readiness, context(), preferences, TODAY, todayRec, null,
            { microcycle, fatigue: createEmptyFatigue(TODAY), trailingHistory: [] },
            { days: 7, events: [focusEvent] },
        ),
    };
}
