import type {
    DailyReadiness,
    EngineObjectiveInput,
    SubjectiveInput,
    TrainingSettings,
    TrainingIntentProfile,
    UserContext,
    UserEvent,
    UserPreferences,
    SessionTemplate,
} from '../models';
import type { CompletedExposure } from '../trainingHistory';
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
    description: string;
    context: UserContext;
    event: UserEvent | null;
    /** Explicit profile scenarios exercise evergreen ownership without changing the
     * profile-less event-directed fixtures used by the committed baseline. */
    trainingIntentProfile?: TrainingIntentProfile | null;
    preferences?: UserPreferences | null;
    startDate: string;
    /** Optional deterministic history seeded before the first simulated decision. Phase
     * 6.3 needs this to reproduce failures that depend on yesterday's real training rather
     * than only on a synthetic readiness counter. */
    initialHistory?: CompletedExposure[];
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
    defaultsOverrides: Partial<TrainingSettings['defaults']> = {},
): UserContext {
    return {
        goals: { shortTerm: '', midTerm: '', longTerm: '' },
        constraints: {
            hasCableMachine: !!equipmentOverrides.cable_machine,
            hasFreeWeights: equipmentOverrides.free_weights ?? true,
            hasTreadmill: !!equipmentOverrides.treadmill,
            hasIndoorBike: !!equipmentOverrides.indoor_bike,
            restrictedModalities: injuries as SessionTemplate['modality'][],
            maxTimeMinutes: 90,
        },
        preferences: { avoidedModalities: [], deprioritizedModalities: [], preferredModalities, conservativeBias: false },
        trainingSettings: trainingSettings(equipmentOverrides, defaultsOverrides),
    };
}

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

function evergreenProfile(
    priorities: TrainingIntentProfile['priorities'],
    weeklyCommitment: TrainingIntentProfile['weeklyCommitment'],
): TrainingIntentProfile {
    return {
        userId: 'sim-user', planningMode: 'evergreen', priorities, weeklyCommitment,
        organizationPreference: 'auto', schemaVersion: 1, createdAt: '', updatedAt: '',
    };
}

function preferences(weekdayMinutes: number, weekendMinutes: number): UserPreferences {
    return {
        userId: 'sim-user', preferredRecoveryStyle: 'mixed', defaultWeekdayTimeMin: weekdayMinutes,
        defaultWeekendTimeMin: weekendMinutes, preferredTimeOfDay: 'flexible', preferredModalities: [],
        deprioritizedModalities: [], avoidedModalities: [], unavailableModalities: [], explanationVerbosity: 'detailed',
        conservativeBias: false, preferredUnits: { distance: 'km', weight: 'kg', temperature: 'celsius' },
        schemaVersion: 1, createdAt: '', updatedAt: '',
    };
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
        id: 'evergreen_health_two_sessions',
        label: 'Evergreen health priority (2 sessions)',
        description: 'A compact health-priority week proves the evergreen path handles a realistic lower commitment without inventing event authority.',
        context: context({ indoor_bike: true, free_weights: true }, ['Cycling', 'Strength']), event: null,
        trainingIntentProfile: evergreenProfile(['health'], { minSessions: 2, targetSessions: 2, maxSessions: 2 }),
        preferences: preferences(60, 60), startDate: START_DATE, weeks: 2,
        readinessForWeek: () => stableReadiness(),
    },
    {
        id: 'evergreen_balanced_four_sessions',
        label: 'Evergreen balanced performance (4 sessions)',
        description: 'A balanced four-session athlete exercises aerobic and strength roles under the evergreen coverage set.',
        context: context({ indoor_bike: true, free_weights: true }, ['Cycling', 'Strength']), event: null,
        trainingIntentProfile: evergreenProfile(['balanced_performance'], { minSessions: 3, targetSessions: 4, maxSessions: 4 }),
        preferences: preferences(75, 90), startDate: START_DATE, weeks: 2,
        readinessForWeek: () => stableReadiness(),
    },
    {
        id: 'evergreen_strength_six_sessions',
        label: 'Evergreen strength-leaning (6 sessions)',
        description: 'A higher-frequency strength athlete confirms the dedicated development objective survives weekly planning.',
        context: context({ free_weights: true, cable_machine: true, indoor_bike: true }, ['Strength', 'Cycling']), event: null,
        trainingIntentProfile: evergreenProfile(['strength_muscle', 'balanced_performance'], { minSessions: 4, targetSessions: 6, maxSessions: 6 }),
        preferences: preferences(60, 90), startDate: START_DATE, weeks: 2,
        readinessForWeek: () => stableReadiness(),
    },
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
        description: 'Qualification and anchor stress test: criterium demand reliably creates surge_repeatability across the chained horizon. Broad or non-cycling templates must not resolve that race-specific objective; anchor-hit outcomes are tracked separately.',
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
        id: 'cycling_criterium_recovery_clear_A',
        label: 'Cycling A-event (criterium, acute stress then recovery)',
        description: 'A high-fatigue check-in is followed by a healthy check-in one week later. The second decision window must contain train-tier days, proving the fatigue projection clears rather than holding the athlete in recover indefinitely after acute stress.',
        context: context({ indoor_bike: true, free_weights: true }, ['Cycling']),
        event: eventOn('e-criterium-recovery-clear', 40, 'cycling_event', 'criterium', 'A'),
        startDate: START_DATE,
        weeks: 2,
        readinessForWeek: (weekIndex) => weekIndex === 0
            ? stableReadiness(
                { readiness: 3, sleepQuality: 3, fatigue: 8, soreness: 8, stress: 8, motivation: 3 },
                { sleep_score: 55, sleep_duration_min: 330, rhr: 58, rhr_7d_avg: 50, rhr_delta: 8, hrv_last_night: 32, hrv_weekly_avg: 50, hrv_delta: -18, body_battery_wake: 35 },
            )
            : stableReadiness(
                { readiness: 8, sleepQuality: 8, fatigue: 2, soreness: 2, stress: 2, motivation: 8 },
                { sleep_score: 92, sleep_duration_min: 500, rhr: 46, rhr_7d_avg: 50, rhr_delta: -4, hrv_last_night: 65, hrv_weekly_avg: 50, hrv_delta: 15, body_battery_wake: 95 },
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
        description: 'Regression coverage for the category-substring bug: both Cycling and Running should be boosted, never penalized, for a triathlon focus event.',
        context: context({ indoor_bike: true, free_weights: true, treadmill: true }, ['Cycling', 'Running']),
        event: eventOn('e-tri', 40, 'triathlon', 'olympic', 'A'),
        startDate: START_DATE,
        weeks: 4,
        readinessForWeek: () => stableReadiness(),
    },
    {
        id: 'strength_meet_powerlifting_B',
        label: 'Strength B-event (powerlifting meet, 30 days out)',
        description: 'Documents a known engine limitation, not ideal behavior: the current generic weekly strength-maintenance objective does not represent full competition-lift programming.',
        context: context({ cable_machine: true, free_weights: true, pullup_bar: true }, ['Strength']),
        event: eventOn('e-strength', 30, 'strength_meet', 'powerlifting', 'B'),
        startDate: START_DATE,
        weeks: 4,
        readinessForWeek: () => stableReadiness(),
    },
    {
        id: 'general_target_generic',
        label: 'General target, C-priority (low-stakes goal, 50 days out)',
        description: 'A goal exists but never drives a taper (C-priority) and uses the generic demand preset, which is numerically close to the default Base demand -- expected to behave close to the no-event baseline.',
        context: context({ free_weights: true }, []),
        event: eventOn('e-general', 50, 'general_target', 'generic', 'C'),
        startDate: START_DATE,
        weeks: 4,
        readinessForWeek: () => stableReadiness(),
    },
    {
        id: 'field_sport_general_target',
        label: 'Field/team-sport-focused athlete (no event)',
        description: 'There is no dedicated UserEvent category for field/team sports; this scenario runs with no event and an explicit Field preference to measure reachability of Field Maintenance.',
        context: context({ free_weights: true }, ['Field']),
        event: null,
        startDate: START_DATE,
        weeks: 4,
        readinessForWeek: () => stableReadiness(),
    },
    {
        id: 'no_event_base_phase',
        label: 'No event at all (pure Base phase baseline)',
        description: 'Control scenario: no goals, no events, moderate equipment. Everything should stay in Base phase for the whole horizon.',
        context: context({ free_weights: true }, []),
        event: null,
        startDate: START_DATE,
        weeks: 4,
        readinessForWeek: () => stableReadiness(),
    },
    {
        id: 'cycling_a_event_build_week',
        label: 'Cycling A-event (Build phase, fixed fixture date)',
        description: 'Golden coaching-contract scenario. 60 days to A-event (Build phase), 1 week strip. Tests key cycling quality spacing, anchor protection, event modality frequency, objective resolution, and rest day presence.',
        context: context({ indoor_bike: true, free_weights: true }, ['Cycling'], [], { weekdayMaxMinutes: 60, weekendMaxMinutes: 150 }),
        event: {
            id: 'e-cycling-build-golden',
            title: 'cycling_event (road_race)',
            date: '2026-05-01',
            priority: 'A',
            lifecycle: 'scheduled',
            category: 'cycling_event',
            demandProfile: resolveDemandProfile('cycling_event', 'road_race'),
        },
        startDate: '2026-03-02',
        weeks: 1,
        readinessForWeek: () => stableReadiness(),
    },
    {
        id: 'cycling_specificity_after_hard_race_specific',
        label: 'Cycling Specificity after hard race-specific day -1',
        description: 'Phase 6.3 escaped-case regression: start exactly 35 days from an A-priority road race with a hard event-specific ride in completed history yesterday. Immediate recovery is allowed, but the next rolling week must still preserve distinct easy-aerobic, sustained-quality and renewed event-specific functions rather than collapse into technical/recovery filler.',
        context: context({ indoor_bike: true, free_weights: true }, ['Cycling'], [], { weekdayMaxMinutes: 90, weekendMaxMinutes: 150 }),
        event: {
            id: 'e-specificity-escaped',
            title: 'cycling_event (road_race)',
            date: '2026-09-13',
            priority: 'A',
            lifecycle: 'scheduled',
            category: 'cycling_event',
            demandProfile: resolveDemandProfile('cycling_event', 'road_race'),
        },
        startDate: '2026-08-09',
        initialHistory: [{
            occurrenceKey: 'scenario:specificity:hard-race-specific:2026-08-08',
            date: '2026-08-08',
            templateId: 'end_race_specific_01',
            workoutId: 'cycling_event_specific_endurance_01',
            modality: 'Cycling',
            category: 'Race-Specific Endurance',
            stimulusConfidence: 'exact',
            stimulusProfile: {
                aerobicEndurance: 0.8,
                thresholdPower: 0.4,
                vo2MaxPower: 0.4,
                repeatedSurges: 0.6,
                sprintPower: 0.1,
                fatigueResistance: 0.7,
                maxStrength: 0,
                hypertrophy: 0,
            },
            costProfile: {
                systemic: 0.55,
                cardiovascular: 0.6,
                lowerBody: 0.35,
                upperBody: 0.1,
                impactTissue: 0.15,
                neuromuscular: 0.3,
            },
            trainingRecordLike: {
                type: 'Cycling Race-Specific Endurance',
                duration_min: 90,
                training_effect: 0,
                intensity_tag: 'hard',
            },
        }],
        weeks: 1,
        readinessForWeek: () => stableReadiness(
            { readiness: 8, sleepQuality: 8, fatigue: 2, soreness: 2, stress: 2, motivation: 8, timeAvailable: 120 },
            { last_3_days_hard_sessions_count: 1, sleep_score: 88, sleep_duration_min: 480, body_battery_wake: 90 },
        ),
    },
];
