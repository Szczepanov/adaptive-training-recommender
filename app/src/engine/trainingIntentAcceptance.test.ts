import { describe, expect, it } from 'vitest';
import { evaluateTraining, evaluateTrainingWithIntent, evaluateNextDayPlanWithIntent } from './rules';
import { resolveTrainingIntent } from './trainingIntent';
import type { AuthoredPlanBlock, DailyReadiness, FixedActivity, TrainingIntentProfile, UserContext, UserEvent, UserPreferences } from './models';
import type { TrainingHistoryProvider } from './trainingHistory';

const fixtureHistory: TrainingHistoryProvider = { reconstruct: async () => [] };

function context(overrides: Partial<UserContext['constraints']> = {}): UserContext {
    return {
        goals: { shortTerm: '', midTerm: '', longTerm: '' },
        constraints: { hasCableMachine: false, hasFreeWeights: true, hasTreadmill: false, hasIndoorBike: true, restrictedModalities: [], maxTimeMinutes: 90, ...overrides },
        preferences: { avoidedModalities: [], deprioritizedModalities: [], preferredModalities: [], conservativeBias: false },
    };
}

function readiness(overrides: Partial<DailyReadiness['subjective']> = {}): DailyReadiness {
    return {
        subjective: { readiness: 8, sleepQuality: 8, fatigue: 2, soreness: 2, stress: 2, motivation: 8, timeAvailable: 60, painFlag: false, alreadyTrainedToday: false, preferredModalityToday: null, ...overrides },
        objective: { total_steps: 8000, sleep_score: 85, sleep_duration_min: 480, rhr: 50, rhr_7d_avg: 50, rhr_delta: 0, hrv_weekly_avg: 50, hrv_last_night: 50, hrv_delta: 0, respiration: 14, body_battery_wake: 90, last_3_days_hard_sessions_count: 0, yesterday_training: null, today_training: null, sleep_score_delta_7d: 0, rhr_delta_28d: 0, hrv_delta_28d: 0, sleep_score_delta_28d: 0, hrv_stdev_28d: 8, rhr_stdev_28d: 3, sleep_score_stdev_28d: 7 },
    };
}

const roadRace: UserEvent = {
    id: 'a-road-race', title: 'Autumn Road Race', date: '2026-09-13', priority: 'A', lifecycle: 'scheduled', category: 'cycling_event',
    demandProfile: { aerobicEndurance: 0.8, thresholdPower: 0.9, vo2MaxPower: 0.7, repeatedSurges: 0.9, sprintPower: 0.5, fatigueResistance: 0.9, neuromuscular: 0.5 },
};
const runningRace: UserEvent = {
    ...roadRace, id: 'a-running-race', title: 'Autumn Marathon', category: 'running_race',
};

const evergreenProfile: TrainingIntentProfile = {
    userId: 'u1', planningMode: 'evergreen', priorities: ['balanced_performance'],
    weeklyCommitment: { minSessions: 2, targetSessions: 3, maxSessions: 4 },
    organizationPreference: 'auto', schemaVersion: 1, createdAt: '', updatedAt: '',
};
const evergreenPreferences: UserPreferences = {
    userId: 'u1', preferredRecoveryStyle: 'mixed', defaultWeekdayTimeMin: 60, defaultWeekendTimeMin: 60,
    preferredTimeOfDay: 'flexible', preferredModalities: [], deprioritizedModalities: [], avoidedModalities: [],
    explanationVerbosity: 'detailed', conservativeBias: false, preferredUnits: { distance: 'km', weight: 'kg', temperature: 'celsius' },
    schemaVersion: 1, createdAt: '', updatedAt: '',
};

// Event-relative fixture: literal dates here are test inputs only. Runtime block dates are
// derived from each event's own planning date by buildCyclingEventPlan.
const cyclingPlanFixture: UserEvent = {
    id: 'cycling-plan-fixture', title: 'Cycling Event Fixture', date: '2026-09-20', priority: 'A', lifecycle: 'scheduled', category: 'cycling_event', taper: { startDate: '2026-09-06' },
    demandProfile: { aerobicEndurance: 0.8, thresholdPower: 0.8, vo2MaxPower: 0.7, repeatedSurges: 0.7, sprintPower: 0.3, fatigueResistance: 0.8, neuromuscular: 0.3 },
};

describe('day-0 event-intent acceptance', () => {
    it('uses the resolved evergreen context to suppress event authority without changing profile-less event behavior', async () => {
        const legacy = await resolveTrainingIntent('u1', [roadRace], '2026-08-07', readiness(), 7, fixtureHistory);
        const evergreen = await resolveTrainingIntent('u1', [roadRace], '2026-08-07', readiness(), 7, fixtureHistory, undefined, [], evergreenProfile);

        expect(legacy.planningContext).toMatchObject({ mode: 'event_directed', eventStrategy: 'structured_plan', focusEvent: { id: roadRace.id } });
        expect(legacy.periodization.focusEvent?.id).toBe(roadRace.id);
        expect(evergreen.planningContext).toMatchObject({ mode: 'evergreen', focusEvent: null, eventStrategy: null });
        expect(evergreen.periodization.focusEvent).toBeNull();
    });

    it('changes the healthy day-0 selection for an A-priority road race and starts with an unmet explicit weekly role rather than forcing intensity immediately', async () => {
        const input = readiness();
        const baseline = await evaluateTrainingWithIntent('u1', input, context(), [], '2026-08-07', undefined, fixtureHistory);
        const eventDriven = await evaluateTrainingWithIntent('u1', input, context(), [roadRace], '2026-08-07', undefined, fixtureHistory);
        const intent = await resolveTrainingIntent('u1', [roadRace], '2026-08-07', input, 7, fixtureHistory);
        expect(eventDriven.template.id).not.toBe(baseline.template.id);
        // ADR-0016: a fresh rolling week does not imply "hard today". Easy aerobic is a
        // distinct required role and hard quality is anchor-timed/repairable later.
        expect(eventDriven.template.category).toBe('Easy Endurance');
        expect(intent.unresolvedObjectives.map(objective => objective.key)).toContain('surge_repeatability');
        expect(intent.unresolvedObjectives.map(objective => objective.key)).toContain('race_specific_endurance');
        expect(eventDriven.rationale).toContain('Build phase');
    });

    it('keeps pain, low body battery, and already-trained safety caps ahead of optimizer preference', async () => {
        const pain = await evaluateTrainingWithIntent('u1', readiness({ painFlag: true }), context(), [roadRace], '2026-08-07', undefined, fixtureHistory);
        const lowBatteryInput = readiness();
        lowBatteryInput.objective.body_battery_wake = 10;
        const lowBattery = await evaluateTrainingWithIntent('u1', lowBatteryInput, context(), [roadRace], '2026-08-07', undefined, fixtureHistory);
        const alreadyTrained = await evaluateTrainingWithIntent('u1', readiness({ alreadyTrainedToday: true }), context(), [roadRace], '2026-08-07', undefined, fixtureHistory);
        for (const rec of [pain, lowBattery, alreadyTrained]) {
            expect(rec.mode).toBe('recover');
            expect(['Rest', 'Mobility/Recovery']).toContain(rec.template.category);
        }
    });

    it('does not let a goal title containing taper alter safety output', () => {
        const input = readiness({ painFlag: true });
        const ordinary = evaluateTraining(input, context(), '2026-08-07');
        const titleOnly = evaluateTraining(input, { ...context(), goals: { shortTerm: 'taper aggressively', midTerm: '', longTerm: '' } }, '2026-08-07');
        expect(titleOnly.mode).toBe(ordinary.mode);
        expect(titleOnly.template.category).toBe(ordinary.template.category);
    });
});

describe('ADR-0012/0016 explicit event-relative PlanDefinition wiring', () => {
    it('resolveTrainingIntent picks up the authored cycling PlanDefinition, scoped to the active relative block', async () => {
        const intent = await resolveTrainingIntent('u1', [cyclingPlanFixture], '2026-08-10', readiness(), 7, fixtureHistory);
        expect(intent.microcycle.objectives.length).toBeGreaterThan(0);
        expect(intent.microcycle.objectives.every(o => o.id.startsWith('obj_plan_'))).toBe(true);
        expect(intent.microcycle.objectives.every(o => o.windowStart === '2026-06-28' && o.windowEnd === '2026-08-15')).toBe(true);
    });

    it('applies the richer authored plan to another cycling target date instead of falling back to generic mode', async () => {
        const intent = await resolveTrainingIntent('u1', [roadRace], '2026-08-10', readiness(), 7, fixtureHistory);
        expect(intent.microcycle.objectives.some(o => o.id.startsWith('obj_plan_'))).toBe(true);
        expect(intent.microcycle.objectives.some(o => o.key === 'race_specific_endurance')).toBe(true);
    });

    it('uses the authored active PlanBlock as exact PlannedDose authority without fabricating travel', async () => {
        const build = await resolveTrainingIntent('u1', [cyclingPlanFixture], '2026-08-10', readiness(), 7, fixtureHistory);
        const specificity = await resolveTrainingIntent('u1', [cyclingPlanFixture], '2026-08-26', readiness(), 7, fixtureHistory);
        const taper = await resolveTrainingIntent('u1', [cyclingPlanFixture], '2026-09-10', readiness(), 7, fixtureHistory);

        expect(build.plannedDose).toEqual({ volume: 1.0, intensity: 0.9 });
        expect(specificity.plannedDose).toEqual({ volume: 1.0, intensity: 1.1 });
        expect(taper.plannedDose).toEqual({ volume: 0.6, intensity: 1.0 });
    });

    it('uses an explicit persisted travel range as the active plan block and exposes its two required roles', async () => {
        const travel: AuthoredPlanBlock = {
            id: 'trip-august', userId: 'u1', eventId: roadRace.id, phase: 'travel',
            startDate: '2026-08-19', endDate: '2026-08-22', volumeScale: 0.6, intensityScale: 0.5,
            createdAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z',
        };
        const intent = await resolveTrainingIntent('u1', [roadRace], '2026-08-20', readiness(), 7, fixtureHistory, undefined, [travel]);

        expect(intent.plannedDose).toEqual({ volume: 0.6, intensity: 0.5 });
        expect(intent.microcycle.objectives.map(objective => objective.key).sort()).toEqual(['strength_maintenance', 'zone2_aerobic']);
    });

    it('applies the same authored travel overlay to demand-derived and evergreen intent without a structured plan', async () => {
        const travel: AuthoredPlanBlock = {
            id: 'shared-trip', userId: 'u1', eventId: null, phase: 'travel',
            startDate: '2026-08-10', endDate: '2026-08-12', volumeScale: 0.6, intensityScale: 0.5,
            createdAt: '', updatedAt: '',
        };
        const demandDerivedBase = await resolveTrainingIntent('u1', [runningRace], '2026-08-11', readiness(), 7, fixtureHistory);
        const demandDerivedTravel = await resolveTrainingIntent('u1', [runningRace], '2026-08-11', readiness(), 7, fixtureHistory, undefined, [travel]);
        const evergreenBase = await resolveTrainingIntent('u1', [roadRace], '2026-08-11', readiness(), 7, fixtureHistory, undefined, [], evergreenProfile);
        const evergreenTravel = await resolveTrainingIntent('u1', [roadRace], '2026-08-11', readiness(), 7, fixtureHistory, undefined, [travel], evergreenProfile);

        expect(demandDerivedTravel.planningContext.eventStrategy).toBe('demand_derived');
        expect(demandDerivedTravel.plannedDose).toEqual({
            volume: demandDerivedBase.plannedDose.volume * 0.6,
            intensity: demandDerivedBase.plannedDose.intensity * 0.5,
        });
        expect(evergreenTravel.plannedDose).toEqual({
            volume: evergreenBase.plannedDose.volume * 0.6,
            intensity: evergreenBase.plannedDose.intensity * 0.5,
        });
    });

    it('applies authored travel intensity constraints before ranking for demand-derived and evergreen paths', async () => {
        const travel: AuthoredPlanBlock = {
            id: 'ranking-trip', userId: 'u1', eventId: null, phase: 'travel',
            startDate: '2026-08-10', endDate: '2026-08-12', volumeScale: 0.6, intensityScale: 0.5,
            createdAt: '', updatedAt: '',
        };
        const recommendations = await Promise.all([
            evaluateTrainingWithIntent('u1', readiness(), context(), [runningRace], '2026-08-11', undefined, fixtureHistory, undefined, [], [travel]),
            evaluateTrainingWithIntent('u1', readiness(), context(), [roadRace], '2026-08-11', undefined, fixtureHistory, undefined, [], [travel], evergreenProfile, evergreenPreferences),
        ]);

        for (const recommendation of recommendations) {
            expect(recommendation.plannedDose?.intensity).toBeLessThan(0.8);
            expect(recommendation.decisionTrace?.candidateScores.find(candidate => candidate.templateId === 'end_hard_01')?.excludedReasons)
                .toContain('INTENSITY_SCALE_INADMISSIBLE');
        }
    });
});

describe('Phase 6.2b -- fixed activities affect the live day-0/day-1 selection, not just the week-ahead forecast', () => {
    const fixedActivity = (overrides: Partial<FixedActivity> & Pick<FixedActivity, 'id' | 'date'>): FixedActivity => ({
        userId: 'u1', title: 'Fixed activity', durationMin: 30, isCompleted: false, fixed: true,
        environment: 'either', equipment: [],
        createdAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z',
        ...overrides,
    });

    it("a travel-day availabilityOverride on TODAY constrains today's own eligible time budget", async () => {
        const input = readiness();
        const travelDay = fixedActivity({ id: 'travel', date: '2026-08-07', durationMin: 50, availabilityOverride: 55 });

        const withoutTravel = await evaluateTrainingWithIntent('u1', input, context(), [], '2026-08-07', undefined, fixtureHistory, undefined, []);
        const withTravel = await evaluateTrainingWithIntent('u1', input, context(), [], '2026-08-07', undefined, fixtureHistory, undefined, [travelDay]);

        expect(['Rest', 'Mobility/Recovery']).not.toContain(withoutTravel.template.category);
        expect(['Rest', 'Mobility/Recovery']).toContain(withTravel.template.category);
    });

    it('applies a fixed travel-day capacity constraint before selection for demand-derived and evergreen paths', async () => {
        const input = readiness({ timeAvailable: 90 });
        const travelDay = fixedActivity({ id: 'shared-travel-day', date: '2026-08-11', durationMin: 20, availabilityOverride: 20 });
        const recommendations = await Promise.all([
            evaluateTrainingWithIntent('u1', input, context(), [runningRace], '2026-08-11', undefined, fixtureHistory, undefined, [travelDay]),
            evaluateTrainingWithIntent('u1', input, context(), [roadRace], '2026-08-11', undefined, fixtureHistory, undefined, [travelDay], [], evergreenProfile, evergreenPreferences),
        ]);

        for (const recommendation of recommendations) {
            expect(recommendation.template.id).toBe('rest_01');
        }
    });

    it("a booked fixed activity on TODAY that already resolves strength_maintenance lowers a same-day Strength candidate's utility (stimulus credited before ranking, not after)", async () => {
        const input = readiness({ timeAvailable: 90 });
        const homeGym = fixedActivity({ id: 'home_gym', date: '2026-08-07', expectedStimulus: { maxStrength: 1.0 } });
        const strengthTemplateId = 'str_upper_01';

        const withoutActivity = await evaluateTrainingWithIntent('u1', input, context(), [], '2026-08-07', undefined, fixtureHistory, undefined, []);
        const withActivity = await evaluateTrainingWithIntent('u1', input, context(), [], '2026-08-07', undefined, fixtureHistory, undefined, [homeGym]);

        const scoreWithout = withoutActivity.decisionTrace?.candidateScores.find(c => c.templateId === strengthTemplateId)?.utilityScore;
        const scoreWith = withActivity.decisionTrace?.candidateScores.find(c => c.templateId === strengthTemplateId)?.utilityScore;
        expect(scoreWithout).toBeDefined();
        expect(scoreWith).toBeDefined();
        expect(scoreWith!).toBeLessThan(scoreWithout!);
    });

    it("a booked fixed activity on TOMORROW affects tomorrow's provisional plan through evaluateNextDayPlanWithIntent", async () => {
        const input = readiness({ timeAvailable: 90 });
        const todayRec = await evaluateTrainingWithIntent('u1', input, context(), [], '2026-08-07', undefined, fixtureHistory);
        const tomorrowHomeGym = fixedActivity({ id: 'home_gym_tomorrow', date: '2026-08-08', expectedStimulus: { maxStrength: 1.0 } });
        const strengthTemplateId = 'str_upper_01';

        const withoutActivity = await evaluateNextDayPlanWithIntent('u1', [], input, context(), '2026-08-07', todayRec, fixtureHistory, undefined, []);
        const withActivity = await evaluateNextDayPlanWithIntent('u1', [], input, context(), '2026-08-07', todayRec, fixtureHistory, undefined, [tomorrowHomeGym]);

        const yellowWithout = withoutActivity.branches.yellow.recommendation;
        const yellowWith = withActivity.branches.yellow.recommendation;
        const scoreWithout = yellowWithout.decisionTrace?.candidateScores.find(c => c.templateId === strengthTemplateId)?.utilityScore;
        const scoreWith = yellowWith.decisionTrace?.candidateScores.find(c => c.templateId === strengthTemplateId)?.utilityScore;
        expect(scoreWithout).toBeDefined();
        expect(scoreWith).toBeDefined();
        expect(scoreWith!).toBeLessThan(scoreWithout!);
    });
});
