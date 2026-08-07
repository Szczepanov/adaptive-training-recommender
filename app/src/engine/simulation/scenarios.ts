import type {
    DailyReadiness,
    EngineObjectiveInput,
    SubjectiveInput,
    TrainingSettings,
    UserContext,
    UserEvent,
} from '../models';
import { resolveDemandProfile } from '../eventPresets';
import { addDaysToLocalDateString } from '../../utils/localDate';

/**
 * One named, reproducible athlete configuration the simulation harness runs the real
 * planner against. This is the single source of truth for scenario definitions -- both
 * `scenarios.test.ts` (pass/fail regression coverage) and `scripts/simulate-scenarios.ts`
 * (the analysis report) import this same list, so a scenario added here automatically
 * gets both without being defined twice.
 */
export interface AthleteScenario {
    id: string;
    label: string;
    /** Shown verbatim in the generated report -- self-documenting, especially for
     *  scenarios that exist specifically to record a known engine limitation rather than
     *  to prove ideal behavior. */
    description: string;
    context: UserContext;
    event: UserEvent | null;
    startDate: string;
    /** Simulated 7-day windows, chained (not one large `days:` call -- see analyze.ts for
     *  why: the anchor-day pre-pass only nominates once per call). */
    weeks: number;
    readinessForWeek: (weekIndex: number) => DailyReadiness;
}

function trainingSettings(overrides: Partial<TrainingSettings['equipment']> = {}, defaults: Partial<TrainingSettings['defaults']> = {}): TrainingSettings {
    return {
        userId: 'sim-user',
        schemaVersion: 2,
        equipment: { free_weights: true, cable_machine: false, treadmill: false, indoor_bike: false, pullup_bar: false, ...overrides },
        guardrails: { avoid_high_impact: false, avoid_heavy_lower_body: false, avoid_overhead_pressing: false, avoid_heavy_spinal_loading: false },
        defaults: { weekdayMaxMinutes: 60, weekendMaxMinutes: 120, environment: 'either', ...defaults },
        preferences: { preferActiveRecovery: false },
        migration: { legacyReviewed: true, migratedAt: null },
        createdAt: '', updatedAt: '',
    };
}

function context(
    equipmentOverrides: Partial<TrainingSettings['equipment']>,
    preferredModalities: string[] = [],
    injuries: string[] = [],
): UserContext {
    return {
        goals: { shortTerm: '', midTerm: '', longTerm: '' },
        constraints: {
            hasCableMachine: !!equipmentOverrides.cable_machine,
            hasFreeWeights: equipmentOverrides.free_weights ?? true,
            hasTreadmill: !!equipmentOverrides.treadmill,
            hasIndoorBike: !!equipmentOverrides.indoor_bike,
            injuries,
            maxTimeMinutes: 90,
        },
        preferences: { avoidedModalities: [], deprioritizedModalities: [], preferredModalities, conservativeBias: false },
        trainingSettings: trainingSettings(equipmentOverrides),
    };
}

/** Moderate, stable readiness -- not maximally green -- so day-0 picks reflect a normal
 *  week rather than an artificially extreme hash-selected pick (see this session's
 *  earlier finding: a maximally green readiness can land on the single hardest available
 *  option, which is realistic sometimes but not representative as a *default* fixture). */
function stableReadiness(overrides: Partial<SubjectiveInput> = {}, objectiveOverrides: Partial<EngineObjectiveInput> = {}): DailyReadiness {
    const subjective: SubjectiveInput = {
        readiness: 6, sleepQuality: 6, fatigue: 4, soreness: 4, stress: 4, motivation: 6,
        timeAvailable: 60, painFlag: false, alreadyTrainedToday: false, preferredModalityToday: null,
        ...overrides,
    };
    const objective: EngineObjectiveInput = {
        total_steps: 8000, sleep_score: 80, sleep_duration_min: 440, rhr: 50, rhr_7d_avg: 50, rhr_delta: 0,
        hrv_weekly_avg: 50, hrv_last_night: 50, hrv_delta: 0, respiration: 14, body_battery_wake: 80,
        last_3_days_hard_sessions_count: 0, yesterday_training: null, today_training: null,
        sleep_score_delta_7d: 0, rhr_delta_28d: 0, hrv_delta_28d: 0, sleep_score_delta_28d: 0,
        hrv_stdev_28d: 8.5, rhr_stdev_28d: 3.5, sleep_score_stdev_28d: 7.8,
        ...objectiveOverrides,
    };
    return { subjective, objective };
}

const START_DATE = '2026-08-07';

function eventOn(
    id: string,
    daysOut: number,
    category: UserEvent['category'],
    preset: string,
    priority: UserEvent['priority'],
): UserEvent {
    return {
        id, title: `${category} (${preset})`,
        date: addDaysToLocalDateString(START_DATE, daysOut),
        priority, lifecycle: 'scheduled', category,
        demandProfile: resolveDemandProfile(category, preset),
    };
}

export const SCENARIOS: AthleteScenario[] = [
    {
        id: 'cycling_gran_fondo_A',
        label: 'Cycling A-event (gran fondo, 40 days out)',
        description: 'A long, low-surge cycling event should not manufacture a surge_repeatability objective its own demand profile does not justify. This remains a useful control for the qualification change: objectiveResolution should show that surge-specific work is absent or rare here, while cycling remains appropriately represented.',
        context: context({ indoor_bike: true, free_weights: true }, ['Cycling']),
        event: eventOn('e-cycling', 40, 'cycling_event', 'gran_fondo', 'A'),
        startDate: START_DATE,
        weeks: 4,
        readinessForWeek: () => stableReadiness(),
    },
    {
        id: 'cycling_criterium_A',
        label: 'Cycling A-event (criterium, 40 days out)',
        description: 'Qualification and anchor stress test: criterium demand reliably creates surge_repeatability across the chained horizon. Broad or non-cycling templates must not resolve that race-specific objective; anchor-hit outcomes are tracked separately because this change deliberately does not alter optimizer ranking policy.',
        context: context({ indoor_bike: true, free_weights: true }, ['Cycling']),
        event: eventOn('e-criterium', 40, 'cycling_event', 'criterium', 'A'),
        startDate: START_DATE,
        weeks: 4,
        readinessForWeek: () => stableReadiness(),
    },
    {
        id: 'cycling_criterium_fresh_A',
        label: 'Cycling A-event (criterium, fresh trajectory)',
        description: 'Same athlete and event as the normal criterium scenario, but consistently strong sleep, HRV and subjective readiness. This makes the harness reveal whether higher capacity creates more specific work rather than merely changing a readiness label.',
        context: context({ indoor_bike: true, free_weights: true }, ['Cycling']),
        event: eventOn('e-criterium-fresh', 40, 'cycling_event', 'criterium', 'A'),
        startDate: START_DATE,
        weeks: 4,
        readinessForWeek: () => stableReadiness(
            { readiness: 8, sleepQuality: 8, fatigue: 2, soreness: 2, stress: 2, motivation: 8 },
            { sleep_score: 92, sleep_duration_min: 500, rhr: 46, rhr_7d_avg: 50, rhr_delta: -4, hrv_last_night: 65, hrv_weekly_avg: 50, hrv_delta: 15, body_battery_wake: 95 },
        ),
    },
    {
        id: 'cycling_criterium_stressed_A',
        label: 'Cycling A-event (criterium, stressed trajectory)',
        description: 'Same athlete and event as the normal criterium scenario, with poor sleep, elevated resting heart rate, lower HRV and high soreness. It must reduce risky work without hiding objective misses or converting unsafe capacity into a nominally successful plan.',
        context: context({ indoor_bike: true, free_weights: true }, ['Cycling']),
        event: eventOn('e-criterium-stressed', 40, 'cycling_event', 'criterium', 'A'),
        startDate: START_DATE,
        weeks: 4,
        readinessForWeek: () => stableReadiness(
            { readiness: 3, sleepQuality: 3, fatigue: 8, soreness: 8, stress: 8, motivation: 3 },
            { sleep_score: 55, sleep_duration_min: 330, rhr: 58, rhr_7d_avg: 50, rhr_delta: 8, hrv_last_night: 32, hrv_weekly_avg: 50, hrv_delta: -18, body_battery_wake: 35 },
        ),
    },
    {
        id: 'running_marathon_A',
        label: 'Running A-event (marathon, 40 days out)',
        description: 'No indoor bike -- verifies the plan never leans on Cycling equipment the athlete does not own, and that running-relevant templates dominate a running-focused build.',
        context: context({ indoor_bike: false, free_weights: true, treadmill: true }, ['Running']),
        event: eventOn('e-running', 40, 'running_race', 'marathon', 'A'),
        startDate: START_DATE,
        weeks: 4,
        readinessForWeek: () => stableReadiness(),
    },
    {
        id: 'triathlon_olympic_A',
        label: 'Triathlon A-event (olympic, 40 days out)',
        description: 'Regression coverage for the category-substring bug fixed this session (optimizer.ts Patch 2): both Cycling and Running should be boosted, never penalized, for a triathlon focus event.',
        context: context({ indoor_bike: true, free_weights: true, treadmill: true }, ['Cycling', 'Running']),
        event: eventOn('e-tri', 40, 'triathlon', 'olympic', 'A'),
        startDate: START_DATE,
        weeks: 4,
        readinessForWeek: () => stableReadiness(),
    },
    {
        id: 'strength_meet_powerlifting_B',
        label: 'Strength B-event (powerlifting meet, 30 days out)',
        description: 'Documents a known engine limitation, not ideal behavior: microcycle.ts\'s generateWeeklyObjectives always generates exactly one strength_maintenance objective per rolling window regardless of how strength-dominant the demand profile is. A real powerlifting block should call for materially more weekly strength volume than this. Left unfixed deliberately -- needs its own design work on how strength volume should scale with demand.',
        context: context({ cable_machine: true, free_weights: true, pullup_bar: true }, ['Strength']),
        event: eventOn('e-strength', 30, 'strength_meet', 'powerlifting', 'B'),
        startDate: START_DATE,
        weeks: 4,
        readinessForWeek: () => stableReadiness(),
    },
    {
        id: 'general_target_generic',
        label: 'General target, C-priority (low-stakes goal, 50 days out)',
        description: 'A goal exists but never drives a taper (C-priority) and uses the generic demand preset, which is numerically close to the default Base demand -- expected to behave close to the no-event baseline. Exercises the "goal present but not governing" path distinctly from true Base phase.',
        context: context({ free_weights: true }, []),
        event: eventOn('e-general', 50, 'general_target', 'generic', 'C'),
        startDate: START_DATE,
        weeks: 4,
        readinessForWeek: () => stableReadiness(),
    },
    {
        id: 'field_sport_general_target',
        label: 'Field/team-sport-focused athlete (no event)',
        description: 'There is no dedicated UserEvent category for field/team sports (the union is running_race | cycling_event | triathlon | strength_meet | general_target) -- this scenario runs with no event at all and an explicit Field preference, to see how reachable Field Maintenance actually is over a 4-week horizon on its own. Field Maintenance is intent-optimizer-only (Path B) by earlier design (its 2-day lower-body-spacing rule can\'t be enforced on the readiness-only path).',
        context: context({ free_weights: true }, ['Field']),
        event: null,
        startDate: START_DATE,
        weeks: 4,
        readinessForWeek: () => stableReadiness(),
    },
    {
        id: 'no_event_base_phase',
        label: 'No event at all (pure Base phase baseline)',
        description: 'Control scenario: no goals, no events, moderate equipment. Everything should stay in Base phase for the whole horizon; used to sanity-check the harness itself and provide a comparison baseline for every other scenario\'s metrics.',
        context: context({ free_weights: true }, []),
        event: null,
        startDate: START_DATE,
        weeks: 4,
        readinessForWeek: () => stableReadiness(),
    },
];
