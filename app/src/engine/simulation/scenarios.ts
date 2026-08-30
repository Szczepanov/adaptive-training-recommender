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
    FixedActivity,
} from '../models';
import type { CompletedExposure } from '../trainingHistory';
import { resolveDemandProfile } from '../eventPresets';
import { addDaysToLocalDateString } from '../../utils/localDate';
import { subjectiveProfileReadiness, subjectiveProfileDay, SUBJECTIVE_PROFILE_KINDS, type SubjectiveProfileKind } from './subjectiveProfiles';
import {
    computeSubjectiveBaseline,
    REFERENCE_SUBJECTIVE_BASELINE_POLICY,
    type SubjectiveCheckinForBaseline,
} from '../subjectiveBaseline';
import { makeThreshold3x17Exposure } from './deliveredDoseScenarios';

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
    /** Legacy single-event shorthand retained for existing fixtures. `events` is the
     * authoritative multi-event input when supplied. */
    event?: UserEvent | null;
    events?: readonly UserEvent[];
    /** Explicit profile scenarios exercise evergreen ownership without changing the
     * profile-less event-directed fixtures used by the committed baseline. */
    trainingIntentProfile?: TrainingIntentProfile | null;
    preferences?: UserPreferences | null;
    startDate: string;
    /** Optional deterministic history seeded before the first simulated decision. Phase
     * 6.3 needs this to reproduce failures that depend on yesterday's real training rather
     * than only on a synthetic readiness counter. */
    initialHistory?: CompletedExposure[];
    /** User-authored commitments passed through every day-0/day-1/week-ahead decision. */
    fixedActivities?: FixedActivity[];
    /** Optional policy-report grouping; assertions remain independently classified. */
    tags?: readonly string[];
    /** Simulated 7-day windows, chained (not one large `days:` call -- see analyze.ts for
     *  why: the anchor-day pre-pass only nominates once per call). */
    weeks: number;
    readinessForWeek: (weekIndex: number) => DailyReadiness;
    /** Date-level deterministic override for the decision at each chained week start. */
    readinessForDate?: (date: string, weekIndex: number) => DailyReadiness;
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

function fixedActivity(overrides: Partial<FixedActivity> & Pick<FixedActivity, 'id' | 'date'>): FixedActivity {
    return {
        userId: 'sim-user', title: 'Scheduled activity', durationMin: 60, fixed: true,
        environment: 'either', equipment: [], isCompleted: false, createdAt: '', updatedAt: '',
        ...overrides,
    };
}

const SUBJECTIVE_PROFILE_META: Record<SubjectiveProfileKind, { label: string; description: string }> = {
    habitual_low: {
        label: 'Subjective profile: habitual low reporter',
        description: 'Phase 9.5: a flat, chronically low subjective reporter (readiness ~3, fatigue ~7). The existing absolute floor already keeps this athlete off `train`; the fixture proves a future drift term must not relax that (D-SUBJFLOOR).',
    },
    habitual_high: {
        label: 'Subjective profile: habitual high reporter',
        description: 'Phase 9.5: a flat, consistently high subjective reporter (readiness ~8, fatigue ~2). Stays `train` throughout -- the absolute floor is far away, which is exactly why a real decline from this baseline would need a drift term to catch early.',
    },
    slow_drifter: {
        label: 'Subjective profile: slow drifter',
        description: 'Phase 9.5: readiness declines from 8 to 6 over three weeks, then holds -- the case the drift term exists for. Currently invisible to every absolute threshold; must become visible to a 7d-vs-28d comparison.',
    },
    noisy_stationary: {
        label: 'Subjective profile: noisy but stationary',
        description: 'Phase 9.5: a stable mean with +/-2 day-to-day swing. Must never read as decline -- noise is not drift.',
    },
    chronically_sore: {
        label: 'Subjective profile: chronically sore',
        description: 'Phase 9.5: soreness holds at 7 (above the existing `soreness > 6` absolute floor) while everything else stays near-neutral. The safety case: already forces `modify` every day and must never habituate to "normal, proceed".',
    },
};

/** Phase 9.5: one scenario per named subjective profile in `subjectiveProfiles.ts`.
 *  `readinessForDate` samples the profile's genuinely daily-resolution generator at
 *  `weekIndex * 7`, matching `runScenario`'s actual sampling cadence -- it takes one
 *  reading per chained week, not one per calendar day (see its doc comment). `weeks: 4`
 *  gives 28 days per fixture, matching the 28-day baseline window the rest of Phase 9 uses.
 *  No event, minimal equipment/context, mirroring `no_event_base_phase` -- the point of
 *  these fixtures is isolating subjective variance, not exercising event/equipment paths
 *  already covered elsewhere in this corpus. */

/** One prior day's profile values, adapted to `computeSubjectiveBaseline`'s minimal
 * structural input. Deliberately duplicated from `subjectiveDriftComparison.ts`'s private
 * `profileHistoryRow` rather than imported -- that module is the comparison harness built
 * on top of this scenario corpus, not a dependency of it. */
function subjectiveProfileHistoryRow(kind: SubjectiveProfileKind, dayIndex: number, date: string): SubjectiveCheckinForBaseline {
    const values = subjectiveProfileDay(kind, dayIndex);
    return {
        date,
        readiness: values.readiness,
        sleepQuality: values.sleepQuality,
        fatigue: values.fatigue,
        soreness: values.soreness,
        mentalStress: values.stress,
        motivation: values.motivation,
    };
}

/** Phase 9.6: attaches a real `subjectiveBaseline` computed from the profile's own
 * deterministic daily series preceding `date` (strictly `< date`, matching D-SUBJHIST), so
 * the real planner path (`evaluateTrainingWithIntent`) has something to read once a caller
 * explicitly passes `subjectiveDriftPolicy: 'drift'`. Harmless under the production default
 * `'off'`, since the baseline is simply never read. */
function subjectiveProfileReadinessWithBaseline(kind: SubjectiveProfileKind, dayIndex: number, date: string): DailyReadiness {
    const history: SubjectiveCheckinForBaseline[] = [];
    for (let priorDayIndex = 0; priorDayIndex < dayIndex; priorDayIndex += 1) {
        history.push(subjectiveProfileHistoryRow(kind, priorDayIndex, addDaysToLocalDateString(date, priorDayIndex - dayIndex)));
    }
    const subjectiveBaseline = computeSubjectiveBaseline(history, date, REFERENCE_SUBJECTIVE_BASELINE_POLICY);
    return { ...subjectiveProfileReadiness(kind, dayIndex), subjectiveBaseline };
}

function subjectiveProfileScenario(kind: SubjectiveProfileKind): AthleteScenario {
    const meta = SUBJECTIVE_PROFILE_META[kind];
    return {
        id: `subjective_${kind}`,
        label: meta.label,
        description: meta.description,
        context: context({ free_weights: true }, []),
        event: null,
        startDate: START_DATE, weeks: 4, tags: ['subjective-profile'],
        readinessForWeek: () => subjectiveProfileReadiness(kind, 0),
        readinessForDate: (date, weekIndex) => subjectiveProfileReadinessWithBaseline(kind, weekIndex * 7, date),
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
        context: context({ indoor_bike: true, free_weights: true, outdoor_bike: true }, ['Cycling']),
        event: eventOn('e-cycling', 40, 'cycling_event', 'gran_fondo', 'A'),
        startDate: START_DATE,
        weeks: 4,
        readinessForWeek: () => stableReadiness(),
    },
    {
        id: 'cycling_criterium_A',
        label: 'Cycling A-event (criterium, 40 days out)',
        description: 'Qualification and anchor stress test: criterium demand reliably creates surge_repeatability across the chained horizon. Broad or non-cycling templates must not resolve that race-specific objective; anchor-hit outcomes are tracked separately.',
        context: context({ indoor_bike: true, free_weights: true, outdoor_bike: true }, ['Cycling']),
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
        id: 'multi_event_taper_conflict_static',
        label: 'Multi-event taper conflict already active',
        description: 'An A-priority cycling authority is already tapering on day one while a later running contributor remains relevant. This guards one governing taper authority with multiple demand contributors.',
        context: context({ indoor_bike: true, free_weights: true, treadmill: true }, ['Cycling', 'Running']),
        events: [
            eventOn('multi-static-authority', 9, 'cycling_event', 'road_race', 'A'),
            eventOn('multi-static-contributor', 24, 'running_race', 'marathon', 'B'),
        ],
        startDate: START_DATE, weeks: 1, tags: ['multi-event', 'taper'],
        readinessForWeek: () => stableReadiness(),
    },
    {
        id: 'multi_event_taper_conflict_mid_horizon',
        label: 'Multi-event taper conflict mid-horizon',
        description: 'The A-priority cycling taper begins inside the seven-day forecast, so future objectives must re-resolve on the transition date without revoking earlier credit.',
        context: context({ indoor_bike: true, free_weights: true, treadmill: true }, ['Cycling', 'Running']),
        events: [
            eventOn('multi-mid-authority', 18, 'cycling_event', 'road_race', 'A'),
            eventOn('multi-mid-contributor', 26, 'running_race', 'marathon', 'B'),
        ],
        startDate: START_DATE, weeks: 1, tags: ['multi-event', 'taper', 'transition'],
        readinessForWeek: () => stableReadiness(),
    },
    {
        id: 'fixed_football_midweek',
        label: 'Booked football session midweek',
        description: 'A scheduled field session has explicit stimulus and cost. The planner must reserve its time and apply its load once while leaving other day context unchanged.',
        context: context({ indoor_bike: true, free_weights: true }, ['Cycling']),
        event: eventOn('fixed-football-event', 40, 'cycling_event', 'criterium', 'A'),
        fixedActivities: [fixedActivity({
            id: 'football-midweek', date: '2026-08-10', title: 'Football match', durationMin: 90,
            environment: 'outdoor', equipment: [], expectedStimulus: { aerobicEndurance: 0.7, repeatedSurges: 0.7 },
            expectedCost: { systemic: 0.7, cardiovascular: 0.8, lowerBody: 0.6, impactTissue: 0.6, neuromuscular: 0.5 },
        })],
        startDate: START_DATE, weeks: 1, tags: ['fixed-activity'],
        readinessForWeek: () => stableReadiness(),
    },
    {
        id: 'travel_day_context_override',
        label: 'Travel day with day-wide context override',
        description: 'A travel commitment deliberately restricts the whole day to a short indoor-bike window; it is distinct from an activity venue and exercises explicit availability context.',
        context: context({ indoor_bike: true, free_weights: true }, ['Cycling']),
        event: eventOn('travel-context-event', 40, 'cycling_event', 'road_race', 'A'),
        fixedActivities: [fixedActivity({
            id: 'travel-context', date: '2026-08-09', title: 'Travel day', durationMin: 15, availabilityOverride: 45,
            availabilityContextOverride: { environment: 'indoor', equipment: ['indoor_bike'] },
        })],
        startDate: START_DATE, weeks: 1, tags: ['fixed-activity', 'travel'],
        readinessForWeek: () => stableReadiness(),
    },
    {
        id: 'external_load_green_readiness',
        label: 'High external load despite green readiness',
        description: 'A hard cycling exposure yesterday is paired with nominally green wearable and subjective signals. The external-load path must remain visible to planning rather than being erased by the check-in.',
        context: context({ indoor_bike: true, free_weights: true }, ['Cycling']),
        event: eventOn('external-load-event', 40, 'cycling_event', 'criterium', 'A'),
        initialHistory: [{
            occurrenceKey: 'scenario:external-load:hard:2026-08-06', date: '2026-08-06', templateId: 'end_hard_02',
            workoutId: 'cycling_vo2_6x3_01', modality: 'Cycling', category: 'Hard Endurance', stimulusConfidence: 'exact',
            stimulusProfile: { aerobicEndurance: 0.6, thresholdPower: 0.8, vo2MaxPower: 0.9, repeatedSurges: 1, sprintPower: 0.3, fatigueResistance: 0.6, maxStrength: 0, hypertrophy: 0 },
            costProfile: { systemic: 0.8, cardiovascular: 0.9, lowerBody: 0.5, upperBody: 0, impactTissue: 0.1, neuromuscular: 0.5 },
            trainingRecordLike: { type: 'Cycling VO2 intervals', duration_min: 60, training_effect: 0, intensity_tag: 'hard' },
        }],
        startDate: START_DATE, weeks: 1, tags: ['fatigue', 'external-load'],
        readinessForWeek: () => stableReadiness({ readiness: 8, sleepQuality: 8, fatigue: 2, soreness: 2, stress: 2, motivation: 8 }),
    },
    {
        id: 'readiness_crash_then_return',
        label: 'Readiness crash then return',
        description: 'Date-level readiness starts with a clear crash and returns to green at the next chained decision, proving the date-level scenario contract rather than a weekly-only fixture.',
        context: context({ indoor_bike: true, free_weights: true }, ['Cycling']),
        event: eventOn('readiness-crash-event', 40, 'cycling_event', 'criterium', 'A'),
        startDate: START_DATE, weeks: 2, tags: ['fatigue', 'readiness'],
        readinessForWeek: () => stableReadiness(),
        readinessForDate: (_date, weekIndex) => weekIndex === 0
            ? stableReadiness({ readiness: 2, sleepQuality: 2, fatigue: 9, soreness: 8, stress: 9, motivation: 2 }, { sleep_score: 50, sleep_duration_min: 300, rhr_delta: 8, hrv_delta: -18, body_battery_wake: 20 })
            : stableReadiness({ readiness: 8, sleepQuality: 8, fatigue: 2, soreness: 2, stress: 2, motivation: 8 }, { sleep_score: 92, sleep_duration_min: 500, rhr_delta: -4, hrv_delta: 15, body_battery_wake: 95 }),
    },
    {
        id: 'inferred_partial_completion',
        label: 'Inferred and partial completion evidence',
        description: 'History combines exact, Garmin-inferred, and abbreviated evidence so scenario reports retain the evidence boundary instead of treating every past exposure as full completion.',
        context: context({ indoor_bike: true, free_weights: true }, ['Cycling']),
        event: eventOn('inferred-partial-event', 40, 'cycling_event', 'road_race', 'A'),
        initialHistory: [
            {
                occurrenceKey: 'scenario:completion:exact:2026-08-05', date: '2026-08-05', templateId: 'end_easy_01', workoutId: 'cycling_zone2_standard_01', modality: 'Cycling', category: 'Easy Endurance', stimulusConfidence: 'exact',
                stimulusProfile: { aerobicEndurance: 0.8, thresholdPower: 0.2, vo2MaxPower: 0, repeatedSurges: 0, sprintPower: 0, fatigueResistance: 0.2, maxStrength: 0, hypertrophy: 0 }, costProfile: { systemic: 0.3, cardiovascular: 0.3, lowerBody: 0.2, upperBody: 0, impactTissue: 0, neuromuscular: 0.1 },
                trainingRecordLike: { type: 'Cycling endurance', duration_min: 60, training_effect: 0, intensity_tag: 'easy' },
            },
            {
                occurrenceKey: 'scenario:completion:inferred:2026-08-06', date: '2026-08-06', modality: 'Cycling', category: 'Moderate Endurance', stimulusConfidence: 'inferred',
                stimulusProfile: { aerobicEndurance: 0.7, thresholdPower: 0.8, vo2MaxPower: 0.2, repeatedSurges: 0.3, sprintPower: 0, fatigueResistance: 0.5, maxStrength: 0, hypertrophy: 0 }, costProfile: { systemic: 0.45, cardiovascular: 0.5, lowerBody: 0.3, upperBody: 0, impactTissue: 0, neuromuscular: 0.2 },
                trainingRecordLike: { type: 'Garmin tempo ride', duration_min: 25, training_effect: 0, intensity_tag: 'moderate' },
            },
        ],
        startDate: START_DATE, weeks: 1, tags: ['evidence', 'partial-completion'],
        readinessForWeek: () => stableReadiness(),
    },
    {
        id: 'reduced_time_equipment_limited_borderline',
        label: 'Borderline readiness with reduced time and limited equipment',
        description: 'A 30-minute weekday ceiling and no bike/treadmill exercise the time and equipment gates at the modify boundary without an event-specific plan masking those constraints.',
        context: context({ free_weights: true }, [], [], { weekdayMaxMinutes: 30, weekendMaxMinutes: 45 }),
        event: null,
        startDate: START_DATE, weeks: 1, tags: ['readiness', 'time-limit', 'equipment-limit'],
        readinessForWeek: () => stableReadiness(
            { readiness: 5, sleepQuality: 5, fatigue: 6, soreness: 6, stress: 5, motivation: 5, timeAvailable: 30 },
            { sleep_score: 68, sleep_duration_min: 420, rhr_delta: 3, hrv_delta: -4, body_battery_wake: 62 },
        ),
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
    {
        id: 'delivered_dose_threshold_3x17_exact',
        label: 'Delivered dose: 3x17m threshold exact execution',
        description: 'Yesterday completed exact 3x17m threshold intervals at 95% FTP. Engine must enforce post-threshold aerobic spacing before the next high-intensity session.',
        context: context({ indoor_bike: true, free_weights: true }, ['Cycling'], [], { weekdayMaxMinutes: 90 }),
        event: eventOn('delivered-exact-event', 35, 'cycling_event', 'road_race', 'A'),
        startDate: START_DATE,
        weeks: 1,
        initialHistory: [makeThreshold3x17Exposure('2026-08-06', 'exact')],
        tags: ['delivered-dose', 'threshold-intervals', 'fatigue'],
        readinessForWeek: () => stableReadiness({ readiness: 7, fatigue: 4, soreness: 4 }),
    },
    {
        id: 'delivered_dose_threshold_3x17_surged',
        label: 'Delivered dose: 3x17m threshold surged/over-delivered',
        description: 'Yesterday over-paced threshold session at 105% FTP leading to acute neuromuscular failure in rep 3. Higher fatigue requires extra recovery buffer.',
        context: context({ indoor_bike: true, free_weights: true }, ['Cycling'], [], { weekdayMaxMinutes: 90 }),
        event: eventOn('delivered-surged-event', 35, 'cycling_event', 'road_race', 'A'),
        startDate: START_DATE,
        weeks: 1,
        initialHistory: [makeThreshold3x17Exposure('2026-08-06', 'surged')],
        tags: ['delivered-dose', 'threshold-intervals', 'fatigue'],
        readinessForWeek: () => stableReadiness({ readiness: 5, fatigue: 7, soreness: 6 }),
    },
    {
        id: 'delivered_dose_threshold_3x17_curtailed',
        label: 'Delivered dose: 3x17m threshold curtailed (2 of 3)',
        description: 'Yesterday cut short threshold session after 2 of 3 reps (34 min in Zone 4). Moderate load allows quicker resumption of training.',
        context: context({ indoor_bike: true, free_weights: true }, ['Cycling'], [], { weekdayMaxMinutes: 90 }),
        event: eventOn('delivered-curtailed-event', 35, 'cycling_event', 'road_race', 'A'),
        startDate: START_DATE,
        weeks: 1,
        initialHistory: [makeThreshold3x17Exposure('2026-08-06', 'curtailed')],
        tags: ['delivered-dose', 'threshold-intervals', 'fatigue'],
        readinessForWeek: () => stableReadiness({ readiness: 7, fatigue: 4, soreness: 3 }),
    },
    ...SUBJECTIVE_PROFILE_KINDS.map(subjectiveProfileScenario),
    {
        id: 'adversarial_pain_with_high_readiness',
        label: 'Adversarial: Chronic Pain with High Objective Readiness',
        description: 'Pristine wearable metrics and high subjective energy, but painFlag is persistently declared. Safety gates must force recovery / non-impact days.',
        context: context({ indoor_bike: true, free_weights: true, treadmill: true }, ['Running'], []),
        startDate: START_DATE,
        weeks: 2,
        tags: ['adversarial', 'safety', 'pain-gate'],
        readinessForWeek: () => stableReadiness(
            { readiness: 8, fatigue: 3, soreness: 7, painFlag: true, timeAvailable: 60 },
            { sleep_score: 95, sleep_duration_min: 520, body_battery_wake: 92, hrv_delta: 12, rhr_delta: -3 },
        ),
    },
    {
        id: 'adversarial_delayed_fatigue_masked_sleep',
        label: 'Adversarial: Excessive Load Masked by Isolated Sleep Spikes',
        description: 'High recent hard training density paired with high sleep scores. Cumulative strain penalties must prevent premature high-intensity escalation.',
        context: context({ indoor_bike: true, free_weights: true }, ['Cycling'], []),
        event: eventOn('adv-delayed-fatigue-event', 28, 'cycling_event', 'road_race', 'A'),
        startDate: START_DATE,
        weeks: 2,
        tags: ['adversarial', 'safety', 'fatigue-fusion'],
        readinessForWeek: (weekIndex) => weekIndex === 0
            ? stableReadiness(
                { readiness: 7, fatigue: 6, soreness: 6, timeAvailable: 90 },
                { last_3_days_hard_sessions_count: 2, sleep_score: 94, sleep_duration_min: 510, body_battery_wake: 85 },
            )
            : stableReadiness({ readiness: 6, fatigue: 4, soreness: 4 }),
    },
    {
        id: 'adversarial_injury_vs_a_priority_race',
        label: 'Adversarial: Knee Injury Exclusion vs A-Priority Running Race',
        description: 'Approaching an A-priority running race with a mandatory knee injury restriction. The engine must never prescribe running despite the event priority.',
        context: context({ free_weights: true, indoor_bike: true, treadmill: true }, ['Running'], ['Running']),
        event: eventOn('adv-injury-running-race', 14, 'running_race', 'half_marathon', 'A'),
        startDate: START_DATE,
        weeks: 2,
        tags: ['adversarial', 'safety', 'injury-dominance'],
        readinessForWeek: () => stableReadiness({ readiness: 8, fatigue: 3, soreness: 2 }),
    },
    {
        id: 'adversarial_cross_sport_football_strength',
        label: 'Adversarial: Multi-Sport Lower-Body Collision with Guardrails',
        description: 'Multi-sport training with avoid_heavy_lower_body guardrail enabled to prevent dangerous lower-body tissue failure.',
        context: {
            ...context({ free_weights: true, indoor_bike: true }, ['Field', 'Strength'], []),
            trainingSettings: {
                ...trainingSettings({ free_weights: true, indoor_bike: true }),
                guardrails: {
                    avoid_high_impact: false,
                    avoid_heavy_lower_body: true,
                    avoid_overhead_pressing: false,
                    avoid_heavy_spinal_loading: false,
                },
            },
        },
        startDate: START_DATE,
        weeks: 2,
        tags: ['adversarial', 'safety', 'cross-sport-guardrails'],
        readinessForWeek: () => stableReadiness({ readiness: 7, fatigue: 4, soreness: 4 }),
    },
];
