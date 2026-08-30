import { describe, expect, it } from 'vitest';
import { evaluateNextDayPlan, evaluateTraining } from './rules';
import { generateWeekAheadPlan, prepareWeekAheadPlanSeed } from './planner';
import { beamSearchWeekAheadPlan } from './sequenceSearch';
import type { DailyReadiness, EngineObjectiveInput, SubjectiveInput, UserContext, UserEvent } from './models';

function baseContext(overrides: Partial<UserContext['constraints']> = {}): UserContext {
    return {
        goals: { shortTerm: '', midTerm: '', longTerm: '' },
        constraints: {
            hasCableMachine: false, hasFreeWeights: true, hasTreadmill: false, hasIndoorBike: false,
            restrictedModalities: [], maxTimeMinutes: 90, ...overrides,
        },
        preferences: { avoidedModalities: [], deprioritizedModalities: [], preferredModalities: [], conservativeBias: false },
    };
}

function neutralSubjective(overrides: Partial<SubjectiveInput> = {}): SubjectiveInput {
    return {
        readiness: 6, sleepQuality: 6, fatigue: 4, soreness: 4, stress: 4, motivation: 6,
        timeAvailable: 60, painFlag: false, alreadyTrainedToday: false, preferredModalityToday: null,
        ...overrides,
    };
}

function quietObjective(overrides: Partial<EngineObjectiveInput> = {}): EngineObjectiveInput {
    return {
        total_steps: 8000, sleep_score: 82, sleep_duration_min: 450, rhr: 50, rhr_7d_avg: 50, rhr_delta: 0,
        hrv_weekly_avg: 50, hrv_last_night: 50, hrv_delta: 0, respiration: 14, body_battery_wake: 82,
        last_3_days_hard_sessions_count: 0, yesterday_training: null, today_training: null,
        sleep_score_delta_7d: 0, rhr_delta_28d: 0, hrv_delta_28d: 0, sleep_score_delta_28d: 0,
        hrv_stdev_28d: 8.5, rhr_stdev_28d: 3.5, sleep_score_stdev_28d: 7.8,
        ...overrides,
    };
}

function buildTodayAndTomorrow(context: UserContext, date = '2026-08-07') {
    const readiness: DailyReadiness = { subjective: neutralSubjective(), objective: quietObjective() };
    const todayRec = evaluateTraining(readiness, context, date);
    const nextDayPlan = evaluateNextDayPlan(readiness, context, date, todayRec);
    return {
        readiness, todayRec,
        tomorrowRec: nextDayPlan.branches.yellow.recommendation,
        seed: prepareWeekAheadPlanSeed(readiness, [], date, []),
    };
}

const cyclingEvent = (daysOut: string): UserEvent => ({
    id: 'e1', title: 'Gran Fondo', date: daysOut, priority: 'A', lifecycle: 'scheduled', category: 'cycling_event',
    demandProfile: { aerobicEndurance: 0.8, thresholdPower: 0.75, vo2MaxPower: 0.7, repeatedSurges: 0.7, sprintPower: 0.3, fatigueResistance: 0.8, neuromuscular: 0.3 },
});

describe('beamSearchWeekAheadPlan (Phase 5.1 prototype)', () => {
    it('produces the requested number of days, with today/tomorrow copied verbatim from the greedy inputs', () => {
        const context = baseContext();
        const { todayRec, tomorrowRec, seed } = buildTodayAndTomorrow(context);
        const plan = beamSearchWeekAheadPlan(context, null, '2026-08-07', todayRec, tomorrowRec, seed, { days: 7 });

        expect(plan.days).toHaveLength(7);
        expect(plan.days[0].confidence).toBe('provisional');
        expect(plan.days[0].template.id).toBe(tomorrowRec.template.id);
        expect(plan.days.slice(1).every(d => d.confidence === 'projected')).toBe(true);
    });

    // Regression contract for per-branch objective reconciliation: with a width/count of
    // one, the prototype has no search freedom and must reuse the same date-specific
    // objective state and rank-0 decisions as the greedy planner.
    it('degenerates to exactly the greedy algorithm when beamWidth=1 and candidatesPerDay=1', () => {
        // The strongest correctness check available: with only ever one branch and one
        // candidate considered per day, cumulative-score pruning can never diverge from
        // picking rank-0 each day -- i.e. this must reproduce generateWeekAheadPlan
        // exactly, proving the reused rankCandidates/fatigue/objective wiring is faithful.
        const context = baseContext();
        const event = cyclingEvent('2026-08-27');
        const { todayRec, tomorrowRec, seed } = buildTodayAndTomorrow(context);

        const greedyPlan = generateWeekAheadPlan(
            { subjective: neutralSubjective(), objective: quietObjective() }, context, null,
            '2026-08-07', todayRec, tomorrowRec, seed, { days: 7, events: [event] },
        );
        const beamPlan = beamSearchWeekAheadPlan(context, null, '2026-08-07', todayRec, tomorrowRec, seed, { days: 7, events: [event] }, 1, 1);

        expect(beamPlan.days.map(d => d.template.id)).toEqual(greedyPlan.days.map(d => d.template.id));
        expect(beamPlan.days.map(d => d.date)).toEqual(greedyPlan.days.map(d => d.date));
    });

    it('a wider beam explores more branch-days than a narrow one (branchDaysScored grows monotonically with beam width)', () => {
        const context = baseContext();
        const event = cyclingEvent('2026-08-27');
        const { todayRec, tomorrowRec, seed } = buildTodayAndTomorrow(context);

        const narrow = beamSearchWeekAheadPlan(context, null, '2026-08-07', todayRec, tomorrowRec, seed, { days: 7, events: [event] }, 1, 1);
        const wide = beamSearchWeekAheadPlan(context, null, '2026-08-07', todayRec, tomorrowRec, seed, { days: 7, events: [event] }, 15, 5);

        expect(wide.branchDaysScored).toBeGreaterThan(narrow.branchDaysScored);
        expect(wide.beamWidthUsed).toBe(15);
        expect(wide.candidatesPerDayUsed).toBe(5);
    });

    it('the explain trail has one entry per projected day with a non-decreasing cumulative score', () => {
        const context = baseContext();
        const { todayRec, tomorrowRec, seed } = buildTodayAndTomorrow(context);
        const plan = beamSearchWeekAheadPlan(context, null, '2026-08-07', todayRec, tomorrowRec, seed, { days: 7 });

        // 7 total days - 1 provisional (tomorrow) = 6 projected/searched days.
        expect(plan.explain).toHaveLength(6);
        for (let i = 1; i < plan.explain.length; i++) {
            expect(plan.explain[i].cumulativeScoreAfter).toBeGreaterThanOrEqual(plan.explain[i - 1].cumulativeScoreAfter);
        }
    });

    it('never selects a template requiring equipment the athlete does not have (hard gate honored)', () => {
        const context = baseContext({ hasFreeWeights: false, hasCableMachine: false, hasTreadmill: false, hasIndoorBike: false });
        const { todayRec, tomorrowRec, seed } = buildTodayAndTomorrow(context);
        const plan = beamSearchWeekAheadPlan(context, null, '2026-08-07', todayRec, tomorrowRec, seed, { days: 7 }, 15, 5);

        // The athlete owns no equipment at all, so every accepted candidate (hard-gated
        // by MISSING_REQUIRED_EQUIPMENT inside rankCandidates before this prototype ever
        // sees it) must require none either.
        plan.days.forEach(day => {
            expect(day.template.requiredEquipment).toEqual([]);
        });
    });
});
