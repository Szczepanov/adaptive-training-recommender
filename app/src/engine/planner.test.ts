import { describe, expect, it } from 'vitest';
import { evaluateNextDayPlan, evaluateTraining } from './rules';
import { generateWeekAheadPlan } from './planner';
import type { DailyReadiness, EngineObjectiveInput, SubjectiveInput, UserContext, UserEvent } from './models';
import type { DayOfWeekSchedule } from './models';
import type { CompletedExposure } from './microcycleHistory';

// --- Fixtures (mirrors rules.test.ts's pattern) -----------------------------

function baseContext(overrides: Partial<UserContext['constraints']> = {}): UserContext {
    return {
        goals: { shortTerm: '', midTerm: '', longTerm: '' },
        constraints: {
            hasCableMachine: false,
            hasFreeWeights: true,
            hasTreadmill: false,
            hasIndoorBike: false,
            injuries: [],
            maxTimeMinutes: 90,
            ...overrides,
        },
        preferences: {
            avoidedModalities: [],
            deprioritizedModalities: [],
            preferredModalities: [],
            conservativeBias: false,
        },
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
    return { readiness, todayRec, tomorrowRec: nextDayPlan.branches.yellow.recommendation };
}

// --- Tests -------------------------------------------------------------------

describe('generateWeekAheadPlan', () => {
    it('produces the requested number of days with the correct confidence tiers', () => {
        const context = baseContext();
        const { readiness, todayRec, tomorrowRec } = buildTodayAndTomorrow(context);

        const plan = generateWeekAheadPlan(readiness, context, null, '2026-08-07', todayRec, tomorrowRec, { days: 7 });

        expect(plan.days).toHaveLength(7);
        expect(plan.days[0]).toMatchObject({ dayOffset: 0, confidence: 'confirmed', date: '2026-08-07' });
        expect(plan.days[1]).toMatchObject({ dayOffset: 1, confidence: 'provisional', date: '2026-08-08' });
        for (let i = 2; i < 7; i++) {
            expect(plan.days[i].confidence).toBe('projected');
            expect(plan.days[i].dayOffset).toBe(i);
        }
        // Dates are consecutive local calendar days.
        expect(plan.days.map(d => d.date)).toEqual([
            '2026-08-07', '2026-08-08', '2026-08-09', '2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13',
        ]);
    });

    it('falls back to just today+tomorrow-provisional shape when no tomorrowRec is supplied and days=2', () => {
        const context = baseContext();
        const { readiness, todayRec } = buildTodayAndTomorrow(context);

        const plan = generateWeekAheadPlan(readiness, context, null, '2026-08-07', todayRec, null, { days: 2 });

        // With no tomorrowRec, offset 1 is filled by the projected optimizer path instead.
        expect(plan.days).toHaveLength(2);
        expect(plan.days[0].confidence).toBe('confirmed');
        expect(plan.days[1].confidence).toBe('projected');
    });

    it('never recommends a modality the user has an active hard injury constraint against', () => {
        const context = baseContext({ injuries: ['Running'] });
        const { readiness, todayRec, tomorrowRec } = buildTodayAndTomorrow(context);

        const plan = generateWeekAheadPlan(readiness, context, null, '2026-08-07', todayRec, tomorrowRec, { days: 7 });

        // Only check the projected tail (offsets 2+), which is entirely optimizer-driven
        // and therefore where the safety gate threaded through rankCandidatesByUtility applies.
        const projected = plan.days.filter(d => d.confidence === 'projected');
        expect(projected.length).toBeGreaterThan(0);
        projected.forEach(d => expect(d.template.modality).not.toBe('Running'));
    });

    it('falls back to rest for a projected day with zero available time rather than dropping it', () => {
        const context = baseContext();
        const { readiness, todayRec, tomorrowRec } = buildTodayAndTomorrow(context);
        const zeroTimeSchedule: DayOfWeekSchedule[] = [0, 1, 2, 3, 4, 5, 6].map(dayOfWeek => ({
            dayOfWeek: dayOfWeek as DayOfWeekSchedule['dayOfWeek'],
            defaultMaxTimeMin: 0,
            preferredLocation: 'home',
        }));

        const plan = generateWeekAheadPlan(readiness, context, null, '2026-08-07', todayRec, tomorrowRec, {
            days: 7,
            weeklySchedule: zeroTimeSchedule,
        });

        plan.days.filter(d => d.confidence === 'projected').forEach(d => {
            expect(d.template.category).toBe('Rest');
        });
    });

    it('returns a rolling-window microcycle objective ledger that is non-empty for the default Base phase', () => {
        const context = baseContext();
        const { readiness, todayRec, tomorrowRec } = buildTodayAndTomorrow(context);

        const plan = generateWeekAheadPlan(readiness, context, null, '2026-08-07', todayRec, tomorrowRec, { days: 7 });

        expect(plan.microcycleObjectives.length).toBeGreaterThan(0);
        // A full week of picks should be enough to satisfy at least one weekly objective's target.
        expect(plan.microcycleObjectives.some(o => o.completedExposures >= 1)).toBe(true);
    });

    it('seeds the rolling objective ledger from completed adherence history', () => {
        const context = baseContext();
        const { readiness, todayRec, tomorrowRec } = buildTodayAndTomorrow(context);
        const history: CompletedExposure[] = [{
            date: '2026-08-05',
            costProfile: { systemic: 0.7, cardiovascular: 0.8, lowerBody: 0.7, upperBody: 0, impactTissue: 0.3, neuromuscular: 0.4 },
            trainingRecordLike: { type: 'Cycling Threshold', duration_min: 45, training_effect: 3, intensity_tag: 'hard' },
        }];
        const plan = generateWeekAheadPlan(readiness, context, null, '2026-08-07', todayRec, tomorrowRec, { days: 2, history });
        expect(plan.microcycleObjectives.find(objective => objective.key === 'threshold_quality')?.completedExposures).toBe(1);
    });

    it('evaluates periodization separately for each displayed date across a taper boundary', () => {
        const context = baseContext();
        const { readiness, todayRec, tomorrowRec } = buildTodayAndTomorrow(context);
        const event: UserEvent = {
            id: 'a-event', title: 'A event', date: '2026-08-22', priority: 'A', lifecycle: 'scheduled', category: 'cycling_event',
            demandProfile: { aerobicEndurance: 0.8, thresholdPower: 0.75, vo2MaxPower: 0.4, repeatedSurges: 0.6, sprintPower: 0.3, fatigueResistance: 0.8, neuromuscular: 0.3 },
        };

        const plan = generateWeekAheadPlan(readiness, context, null, '2026-08-07', todayRec, tomorrowRec, {
            days: 3,
            events: [event],
        });

        expect(plan.days[0].phaseName).toBe('Specificity'); // 15 days out
        expect(plan.days[1].phaseName).toBe('Peak/Taper'); // 14 days out
        expect(plan.days[2].phaseName).toBe('Peak/Taper');
    });

    it('is a pure function of its inputs -- same inputs produce the same plan', () => {
        const context = baseContext();
        const { readiness, todayRec, tomorrowRec } = buildTodayAndTomorrow(context);

        const planA = generateWeekAheadPlan(readiness, context, null, '2026-08-07', todayRec, tomorrowRec, { days: 5 });
        const planB = generateWeekAheadPlan(readiness, context, null, '2026-08-07', todayRec, tomorrowRec, { days: 5 });

        expect(planA.days.map(d => d.template.id)).toEqual(planB.days.map(d => d.template.id));
    });
});
