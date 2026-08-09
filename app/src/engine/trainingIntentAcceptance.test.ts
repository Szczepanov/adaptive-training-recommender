import { describe, expect, it } from 'vitest';
import { evaluateTraining, evaluateTrainingWithIntent, evaluateNextDayPlanWithIntent } from './rules';
import { resolveTrainingIntent } from './trainingIntent';
import type { DailyReadiness, FixedActivity, UserContext, UserEvent } from './models';
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

// Matches resolvePlanDefinitionForEvent's narrow id/category/date match (planSchedule.ts)
// -- the one event buildSeptemberCyclingEventPlan's block calendar was actually authored for.
const septemberCyclingEvent: UserEvent = {
    id: 'sep-event-1', title: 'September Cycling Event', date: '2026-09-20', priority: 'A', lifecycle: 'scheduled', category: 'cycling_event',
    demandProfile: { aerobicEndurance: 0.8, thresholdPower: 0.8, vo2MaxPower: 0.7, repeatedSurges: 0.7, sprintPower: 0.3, fatigueResistance: 0.8, neuromuscular: 0.3 },
};

describe('day-0 event-intent acceptance', () => {
    it('changes the healthy day-0 selection for an A-priority road race 37 days away and targets an unresolved objective', async () => {
        const input = readiness();
        const baseline = await evaluateTrainingWithIntent('u1', input, context(), [], '2026-08-07', undefined, fixtureHistory);
        const eventDriven = await evaluateTrainingWithIntent('u1', input, context(), [roadRace], '2026-08-07', undefined, fixtureHistory);
        const intent = await resolveTrainingIntent('u1', [roadRace], '2026-08-07', input, 7, fixtureHistory);
        expect(eventDriven.template.id).not.toBe(baseline.template.id);
        // Race-Specific Endurance's only day-0-eligible candidate (37 days out excludes the
        // <=35-day race-sim template) has thresholdPower stimulus below threshold_quality's
        // qualification.minimumStimulus, so since calculateStimulusBenefit (optimizer.ts) enforces
        // that gate it correctly earns no benefit toward that objective. Hard Endurance genuinely
        // qualifies for both threshold_quality and surge_repeatability and wins on real merit.
        expect(eventDriven.template.category).toBe('Hard Endurance');
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

describe('ADR-0012 explicit PlanDefinition wiring (Phase 2 review fix)', () => {
    it('resolveTrainingIntent picks up the authored PlanDefinition for the September cycling event, scoped to the active block', async () => {
        // 2026-08-10 falls inside block_build (2026-08-01..2026-08-23) only.
        const intent = await resolveTrainingIntent('u1', [septemberCyclingEvent], '2026-08-10', readiness(), 7, fixtureHistory);
        expect(intent.microcycle.objectives.length).toBeGreaterThan(0);
        expect(intent.microcycle.objectives.every(o => o.id.startsWith('obj_plan_'))).toBe(true);
        expect(intent.microcycle.objectives.every(o => o.windowStart === '2026-08-01' && o.windowEnd === '2026-08-23')).toBe(true);
    });

    it('does not apply the September plan to a different cycling event it was not authored for', async () => {
        const intent = await resolveTrainingIntent('u1', [roadRace], '2026-08-10', readiness(), 7, fixtureHistory);
        expect(intent.microcycle.objectives.some(o => o.id.startsWith('obj_plan_'))).toBe(false);
    });

    it('uses the authored active PlanBlock as exact PlannedDose authority', async () => {
        const build = await resolveTrainingIntent('u1', [septemberCyclingEvent], '2026-08-10', readiness(), 7, fixtureHistory);
        const travel = await resolveTrainingIntent('u1', [septemberCyclingEvent], '2026-08-26', readiness(), 7, fixtureHistory);
        const taper = await resolveTrainingIntent('u1', [septemberCyclingEvent], '2026-09-10', readiness(), 7, fixtureHistory);

        expect(build.plannedDose).toEqual({ volume: 1.0, intensity: 1.0 });
        expect(travel.plannedDose).toEqual({ volume: 0.6, intensity: 0.8 });
        expect(taper.plannedDose).toEqual({ volume: 0.5, intensity: 1.0 });
    });
});

describe('Phase 6.2b -- fixed activities affect the live day-0/day-1 selection, not just the week-ahead forecast', () => {
    // Regression for a real gap: `evaluateTrainingWithIntent` (today's actual pick) and
    // `evaluateNextDayPlanWithIntent` (tomorrow's provisional plan) never received
    // `fixedActivities` at all before this fix, so a booked activity on today/tomorrow
    // could not affect either -- only the week-ahead forecast strip (day 2+) did.
    const fixedActivity = (overrides: Partial<FixedActivity> & Pick<FixedActivity, 'id' | 'date'>): FixedActivity => ({
        userId: 'u1', title: 'Fixed activity', durationMin: 30, isCompleted: false, fixed: true,
        environment: 'either', equipment: [],
        createdAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z',
        ...overrides,
    });

    it("a travel-day availabilityOverride on TODAY constrains today's own eligible time budget", async () => {
        const input = readiness();
        // 55-minute day budget minus a 50-minute activity leaves 5 minutes -- below any
        // real template's floor, so the live pick must fail closed to recovery.
        const travelDay = fixedActivity({ id: 'travel', date: '2026-08-07', durationMin: 50, availabilityOverride: 55 });

        const withoutTravel = await evaluateTrainingWithIntent('u1', input, context(), [], '2026-08-07', undefined, fixtureHistory, undefined, []);
        const withTravel = await evaluateTrainingWithIntent('u1', input, context(), [], '2026-08-07', undefined, fixtureHistory, undefined, [travelDay]);

        expect(['Rest', 'Mobility/Recovery']).not.toContain(withoutTravel.template.category);
        expect(['Rest', 'Mobility/Recovery']).toContain(withTravel.template.category);
    });

    it("a booked fixed activity on TODAY that already resolves strength_maintenance lowers a same-day Strength candidate's utility (stimulus credited before ranking, not after)", async () => {
        // A generous time budget so the fixed activity's own duration does not itself
        // exclude the Strength candidate on time -- this test isolates the credit-ordering
        // effect, not the (separately tested) time-budget effect.
        const input = readiness({ timeAvailable: 90 });
        const homeGym = fixedActivity({ id: 'home_gym', date: '2026-08-07', expectedStimulus: { maxStrength: 1.0 } });
        const strengthTemplateId = 'str_upper_01'; // requiredEquipment: ['free_weights'], owned by context()

        const withoutActivity = await evaluateTrainingWithIntent('u1', input, context(), [], '2026-08-07', undefined, fixtureHistory, undefined, []);
        const withActivity = await evaluateTrainingWithIntent('u1', input, context(), [], '2026-08-07', undefined, fixtureHistory, undefined, [homeGym]);

        const scoreWithout = withoutActivity.decisionTrace?.candidateScores.find(c => c.templateId === strengthTemplateId)?.utilityScore;
        const scoreWith = withActivity.decisionTrace?.candidateScores.find(c => c.templateId === strengthTemplateId)?.utilityScore;
        expect(scoreWithout).toBeDefined();
        expect(scoreWith).toBeDefined();
        // optimizer.ts's isStrengthResolved gate applies a same-day 0.20x suppression to
        // every Strength candidate once strength_maintenance is no longer unresolved -- it
        // only fires here if the fixed activity's credit landed before ranking ran.
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
