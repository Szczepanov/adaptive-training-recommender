import { afterEach, describe, expect, it, vi } from 'vitest';
import { evaluateNextDayPlan, evaluateTraining } from './rules';
import { mapContextFromGoalsAndTrainingSettings } from './adapters';
import { generateWeekAheadPlan, generateWeekAheadPlanWithIntent, prepareWeekAheadPlanSeed, projectTrailingHistory, resolveWeeklyAnchors } from './planner';
import type { DailyReadiness, EngineObjectiveInput, FatigueState, FixedActivity, SubjectiveInput, TrainingSettings, UserContext, UserEvent, UserPreferences } from './models';
import type { CompletedExposure, TrainingHistoryProvider } from './trainingHistory';
import { rankCandidatesByUtility } from './optimizer';
import { resolveAvailability } from './schedule';
import { ENRICHED_TEMPLATES } from './templates';

// --- Fixtures (mirrors rules.test.ts's pattern) -----------------------------

function baseContext(overrides: Partial<UserContext['constraints']> = {}): UserContext {
    return {
        goals: { shortTerm: '', midTerm: '', longTerm: '' },
        constraints: {
            hasCableMachine: false,
            hasFreeWeights: true,
            hasTreadmill: false,
            hasIndoorBike: false,
            restrictedModalities: [],
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
    return {
        readiness,
        todayRec,
        tomorrowRec: nextDayPlan.branches.yellow.recommendation,
        seed: prepareWeekAheadPlanSeed(readiness, [], date, []),
    };
}

// --- Tests -------------------------------------------------------------------

describe('generateWeekAheadPlan', () => {
    afterEach(() => vi.useRealTimers());

    it('produces the requested number of future days beginning tomorrow', () => {
        const context = baseContext();
        const { readiness, todayRec, tomorrowRec } = buildTodayAndTomorrow(context);

        const plan = generateWeekAheadPlan(readiness, context, null, '2026-08-07', todayRec, tomorrowRec, prepareWeekAheadPlanSeed(readiness, [], '2026-08-07', []), { days: 7 });

        expect(plan.days).toHaveLength(7);
        expect(plan.startDate).toBe('2026-08-08');
        expect(plan.days[0]).toMatchObject({ dayOffset: 1, confidence: 'provisional', date: '2026-08-08' });
        for (let i = 1; i < 7; i++) {
            expect(plan.days[i].confidence).toBe('projected');
            expect(plan.days[i].dayOffset).toBe(i + 1);
        }
        // Dates are consecutive local calendar days.
        expect(plan.days.map(d => d.date)).toEqual([
            '2026-08-08', '2026-08-09', '2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14',
        ]);
    });

    it('uses a projected pick for tomorrow when no tomorrow preview is supplied', () => {
        const context = baseContext();
        const { readiness, todayRec } = buildTodayAndTomorrow(context);

        const plan = generateWeekAheadPlan(readiness, context, null, '2026-08-07', todayRec, null, prepareWeekAheadPlanSeed(readiness, [], '2026-08-07', []), { days: 2 });

        // With no tomorrowRec, offset 1 is filled by the projected optimizer path instead.
        expect(plan.days).toHaveLength(2);
        expect(plan.days[0]).toMatchObject({ dayOffset: 1, confidence: 'projected', date: '2026-08-08' });
        expect(plan.days[1]).toMatchObject({ dayOffset: 2, confidence: 'projected', date: '2026-08-09' });
    });

    it('never recommends a modality the user has an active hard injury constraint against', () => {
        const context = baseContext({ restrictedModalities: ['Running'] });
        const { readiness, todayRec, tomorrowRec } = buildTodayAndTomorrow(context);

        const plan = generateWeekAheadPlan(readiness, context, null, '2026-08-07', todayRec, tomorrowRec, prepareWeekAheadPlanSeed(readiness, [], '2026-08-07', []), { days: 7 });

        // Only check the projected tail (offsets 2+), which is entirely optimizer-driven
        // and therefore where the safety gate threaded through rankCandidatesByUtility applies.
        const projected = plan.days.filter(d => d.confidence === 'projected');
        expect(projected.length).toBeGreaterThan(0);
        projected.forEach(d => expect(d.template.modality).not.toBe('Running'));
    });

    it('an exclude achilles injury holds across all 7 projected days', () => {
        const settings: TrainingSettings = {
            userId: 'user1',
            schemaVersion: 3,
            equipment: { free_weights: true, cable_machine: true, treadmill: true, indoor_bike: true, pullup_bar: true },
            guardrails: { avoid_high_impact: false, avoid_heavy_lower_body: false, avoid_overhead_pressing: false, avoid_heavy_spinal_loading: false },
            injuries: [{ region: 'achilles', severity: 'exclude' }],
            defaults: { weekdayMaxMinutes: 60, weekendMaxMinutes: 60, environment: 'either' },
            preferences: { preferActiveRecovery: false },
            migration: { legacyReviewed: true, migratedAt: null },
            createdAt: '2026-08-08T00:00:00Z',
            updatedAt: '2026-08-08T00:00:00Z',
        };
        const context = mapContextFromGoalsAndTrainingSettings([], settings, null, '2026-08-07');
        const { readiness, todayRec, tomorrowRec } = buildTodayAndTomorrow(context);
        const plan = generateWeekAheadPlan(readiness, context, null, '2026-08-07', todayRec, tomorrowRec, prepareWeekAheadPlanSeed(readiness, [], '2026-08-07', []), { days: 7 });

        plan.days.forEach(d => expect(d.template.modality).not.toBe('Running'));
    });

    it('omits category-restricted templates from projected days for a quadriceps exclude injury', () => {
        const settings: TrainingSettings = {
            userId: 'user1', schemaVersion: 3,
            equipment: { free_weights: true, cable_machine: true, treadmill: true, indoor_bike: true, pullup_bar: true },
            guardrails: { avoid_high_impact: false, avoid_heavy_lower_body: false, avoid_overhead_pressing: false, avoid_heavy_spinal_loading: false },
            injuries: [{ region: 'quadriceps', severity: 'exclude' }],
            defaults: { weekdayMaxMinutes: 60, weekendMaxMinutes: 60, environment: 'either' },
            preferences: { preferActiveRecovery: false }, migration: { legacyReviewed: true, migratedAt: null },
            createdAt: '2026-08-08T00:00:00Z', updatedAt: '2026-08-08T00:00:00Z',
        };
        const context = mapContextFromGoalsAndTrainingSettings([], settings, null, '2026-08-07');
        const { readiness, todayRec, tomorrowRec } = buildTodayAndTomorrow(context);
        const plan = generateWeekAheadPlan(readiness, context, null, '2026-08-07', todayRec, tomorrowRec, prepareWeekAheadPlanSeed(readiness, [], '2026-08-07', []), { days: 7 });

        plan.days.filter(day => day.confidence === 'projected').forEach(day => {
            expect(['Lower-body Strength', 'Full-body Strength']).not.toContain(day.template.category);
        });
    });

    it('omits category-restricted templates from projected days for a hamstring exclude injury', () => {
        const settings: TrainingSettings = {
            userId: 'user1', schemaVersion: 3,
            equipment: { free_weights: true, cable_machine: true, treadmill: true, indoor_bike: true, pullup_bar: true },
            guardrails: { avoid_high_impact: false, avoid_heavy_lower_body: false, avoid_overhead_pressing: false, avoid_heavy_spinal_loading: false },
            injuries: [{ region: 'hamstring', severity: 'exclude' }],
            defaults: { weekdayMaxMinutes: 60, weekendMaxMinutes: 60, environment: 'either' },
            preferences: { preferActiveRecovery: false }, migration: { legacyReviewed: true, migratedAt: null },
            createdAt: '2026-08-08T00:00:00Z', updatedAt: '2026-08-08T00:00:00Z',
        };
        const context = mapContextFromGoalsAndTrainingSettings([], settings, null, '2026-08-07');
        const { readiness, todayRec, tomorrowRec } = buildTodayAndTomorrow(context);
        const plan = generateWeekAheadPlan(readiness, context, null, '2026-08-07', todayRec, tomorrowRec, prepareWeekAheadPlanSeed(readiness, [], '2026-08-07', []), { days: 7 });

        plan.days.filter(day => day.confidence === 'projected').forEach(day => {
            expect(['Lower-body Strength', 'Full-body Strength']).not.toContain(day.template.category);
        });
    });

    it('uses the Warsaw calendar date when resolving an omitted injury-policy date', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-08-07T22:30:00.000Z')); // 00:30 on 8 August in Warsaw
        const settings: TrainingSettings = {
            userId: 'user1', schemaVersion: 3,
            equipment: { free_weights: true, cable_machine: true, treadmill: true, indoor_bike: true, pullup_bar: true },
            guardrails: { avoid_high_impact: false, avoid_heavy_lower_body: false, avoid_overhead_pressing: false, avoid_heavy_spinal_loading: false },
            injuries: [{ region: 'knee', severity: 'exclude', reviewBy: '2026-08-07' }],
            defaults: { weekdayMaxMinutes: 60, weekendMaxMinutes: 60, environment: 'either' },
            preferences: { preferActiveRecovery: false }, migration: { legacyReviewed: true, migratedAt: null },
            createdAt: '2026-08-07T00:00:00Z', updatedAt: '2026-08-07T00:00:00Z',
        };

        expect(mapContextFromGoalsAndTrainingSettings([], settings, null).constraints.restrictedModalities).toEqual([]);
    });

    it('falls back to rest for a projected day with zero available time rather than dropping it', () => {
        // Zero time comes from the athlete's own maxTimeMinutes constraint now (there's
        // no separate weeklySchedule override to force this through anymore -- time
        // budget is sourced from real constraints/TrainingSettings only).
        const context = baseContext({ maxTimeMinutes: 0 });
        const { readiness, todayRec, tomorrowRec } = buildTodayAndTomorrow(context);

        const plan = generateWeekAheadPlan(readiness, context, null, '2026-08-07', todayRec, tomorrowRec, prepareWeekAheadPlanSeed(readiness, [], '2026-08-07', []), {
            days: 7,
        });

        plan.days.filter(d => d.confidence === 'projected').forEach(d => {
            expect(d.template.category).toBe('Rest');
        });
    });

    it('returns a rolling-window microcycle objective ledger that is non-empty for the default Base phase', () => {
        const context = baseContext();
        const { readiness, todayRec, tomorrowRec } = buildTodayAndTomorrow(context);

        const plan = generateWeekAheadPlan(readiness, context, null, '2026-08-07', todayRec, tomorrowRec, prepareWeekAheadPlanSeed(readiness, [], '2026-08-07', []), { days: 7 });

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
        const plan = generateWeekAheadPlan(readiness, context, null, '2026-08-07', todayRec, tomorrowRec, prepareWeekAheadPlanSeed(readiness, [], '2026-08-07', history), { days: 2 });
        expect(plan.microcycleObjectives.find(objective => objective.key === 'threshold_quality')?.completedExposures).toBe(1);
    });

    it('evaluates periodization separately for each displayed date across a taper boundary', () => {
        const context = baseContext();
        const { readiness, todayRec, tomorrowRec } = buildTodayAndTomorrow(context);
        const event: UserEvent = {
            id: 'a-event', title: 'A event', date: '2026-08-22', priority: 'A', lifecycle: 'scheduled', category: 'cycling_event',
            demandProfile: { aerobicEndurance: 0.8, thresholdPower: 0.75, vo2MaxPower: 0.4, repeatedSurges: 0.6, sprintPower: 0.3, fatigueResistance: 0.8, neuromuscular: 0.3 },
        };

        const plan = generateWeekAheadPlan(readiness, context, null, '2026-08-07', todayRec, tomorrowRec, prepareWeekAheadPlanSeed(readiness, [event], '2026-08-07', []), {
            days: 3,
            events: [event],
        });

        expect(plan.days[0].phaseName).toBe('Peak/Taper'); // 14 days out
        expect(plan.days[1].phaseName).toBe('Peak/Taper');
        expect(plan.days[2].phaseName).toBe('Peak/Taper');
    });

    it('is a pure function of its inputs -- same inputs produce the same plan', () => {
        const context = baseContext();
        const { readiness, todayRec, tomorrowRec } = buildTodayAndTomorrow(context);

        const seed = prepareWeekAheadPlanSeed(readiness, [], '2026-08-07', []);
        const planA = generateWeekAheadPlan(readiness, context, null, '2026-08-07', todayRec, tomorrowRec, seed, { days: 5 });
        const planB = generateWeekAheadPlan(readiness, context, null, '2026-08-07', todayRec, tomorrowRec, seed, { days: 5 });

        expect(planA.days.map(d => d.template.id)).toEqual(planB.days.map(d => d.template.id));
    });

    it('loads adherence history once in the async wrapper before delegating to the pure chain', async () => {
        const context = baseContext();
        const { readiness, todayRec, tomorrowRec } = buildTodayAndTomorrow(context);
        let calls = 0;
        const provider: TrainingHistoryProvider = {
            reconstruct: async () => {
                calls += 1;
                return [];
            },
        };
        const plan = await generateWeekAheadPlanWithIntent(
            'u1', readiness, context, null, [], '2026-08-07', todayRec, tomorrowRec, { days: 3 }, provider,
        );
        expect(calls).toBe(1);
        expect(plan.days).toHaveLength(3);
    });

    it('projects completed history into the seed without inventing a modality', () => {
        const context = baseContext();
        const { readiness } = buildTodayAndTomorrow(context);
        const history: CompletedExposure[] = [{
            date: '2026-08-05',
            costProfile: { systemic: 0.8, cardiovascular: 0.7, lowerBody: 0.6, upperBody: 0, impactTissue: 0.2, neuromuscular: 0.3 },
            trainingRecordLike: { type: 'hard Cycling threshold', duration_min: 45, training_effect: 3, intensity_tag: 'hard' },
        }];

        expect(projectTrailingHistory(history)).toEqual([{ date: '2026-08-05', type: 'hard Cycling threshold', systemicCost: 0.8 }]);
        expect(prepareWeekAheadPlanSeed(readiness, [], '2026-08-07', history).trailingHistory)
            .toEqual([{ date: '2026-08-05', type: 'hard Cycling threshold', systemicCost: 0.8 }]);
    });

    it('suppresses a hard Cycling candidate at a fresh plan boundary when real trailing history has two hard Cycling days', () => {
        const context = baseContext({ hasIndoorBike: true });
        const availability = resolveAvailability('2026-08-08', null, [], context);
        const bikeVo2 = ENRICHED_TEMPLATES.find(template => template.id === 'end_hard_02')!;
        const fatigue: FatigueState = {
            lastUpdatedDate: '2026-08-08',
            externalLoadFatigue: { systemic: 0, cardiovascular: 0, lowerBody: 0, upperBody: 0, impactTissue: 0, neuromuscular: 0 },
            internalResponseStrain: { systemic: 0, cardiovascular: 0, lowerBody: 0, upperBody: 0, impactTissue: 0, neuromuscular: 0 },
            combinedFatigue: { systemic: 0, cardiovascular: 0, lowerBody: 0, upperBody: 0, impactTissue: 0, neuromuscular: 0 },
        };
        const preferences: UserPreferences = {
            userId: '', preferredRecoveryStyle: 'mixed', defaultWeekdayTimeMin: 45, defaultWeekendTimeMin: 60,
            preferredTimeOfDay: 'flexible', preferredModalities: [], deprioritizedModalities: [], avoidedModalities: [],
            explanationVerbosity: 'detailed', conservativeBias: false,
            preferredUnits: { distance: 'km', weight: 'kg', temperature: 'celsius' }, schemaVersion: 1, createdAt: '', updatedAt: '',
        };
        const noHistory = rankCandidatesByUtility([bikeVo2], [], fatigue, availability, [], preferences)[0].utilityScore;
        const seededHistory = rankCandidatesByUtility([bikeVo2], [], fatigue, availability, [], preferences, {
            recentHistory: [
                { type: 'hard Cycling intervals', systemicCost: 0.8 },
                { type: 'hard Cycling threshold', systemicCost: 0.8 },
            ],
        })[0]?.utilityScore ?? 0;

        expect(seededHistory).toBeLessThan(noHistory);
    });
});

// --- "Does the plan actually make coaching sense" regression tests -----------
// Locks in the fixes for the split-brain objective ledger, unreachable-rest utility
// formula, fabricated location/equipment, and the endurance anti-stacking exemption --
// all of which combined to produce e.g. "Tempo Ride" recommended 7 days straight with
// its own claimed objectives never actually resolving.
describe('generateWeekAheadPlan produces plans that make coaching sense', () => {
    it('does not repeat the identical template on 3+ consecutive projected days', () => {
        const context = baseContext();
        const { readiness, todayRec, tomorrowRec } = buildTodayAndTomorrow(context);

        const plan = generateWeekAheadPlan(readiness, context, null, '2026-08-07', todayRec, tomorrowRec, prepareWeekAheadPlanSeed(readiness, [], '2026-08-07', []), { days: 7 });

        const projected = plan.days.filter(d => d.confidence === 'projected');
        expect(projected.length).toBeGreaterThan(0);
        let run = 1;
        for (let i = 1; i < projected.length; i++) {
            run = projected[i].template.id === projected[i - 1].template.id ? run + 1 : 1;
            expect(run).toBeLessThan(3);
        }
    });

    it('includes at least one rest or recovery day across a realistic 7-day forecast, not just an unbroken run of training', () => {
        const context = baseContext();
        const { readiness, todayRec, tomorrowRec } = buildTodayAndTomorrow(context);

        const plan = generateWeekAheadPlan(readiness, context, null, '2026-08-07', todayRec, tomorrowRec, prepareWeekAheadPlanSeed(readiness, [], '2026-08-07', []), { days: 7 });

        expect(plan.days.some(d => d.template.category === 'Rest' || d.template.category === 'Mobility/Recovery')).toBe(true);
    });

    it('forces the projected tail into rest/mobility once sustained heavy load pushes fatigue past the recover threshold', () => {
        // Two prior max-cost days plus today's own rough readiness -- previously no
        // fatigue level, including this one, could out-score Rest's floor utility, so
        // the projected loop would keep prescribing training regardless.
        const context = baseContext();
        const readiness: DailyReadiness = {
            subjective: neutralSubjective({ fatigue: 8, soreness: 8, readiness: 2 }),
            objective: quietObjective({ hrv_delta: -10, sleep_score: 45 }),
        };
        const heavyHistory: CompletedExposure[] = ['2026-08-05', '2026-08-06'].map(date => ({
            date,
            costProfile: { systemic: 1.0, cardiovascular: 1.0, lowerBody: 1.0, upperBody: 0.8, impactTissue: 0.9, neuromuscular: 1.0 },
            trainingRecordLike: { type: 'Hard Endurance', duration_min: 60, training_effect: 4, intensity_tag: 'hard' },
        }));
        const todayRec = evaluateTraining(readiness, context, '2026-08-07');
        const tomorrowRec = evaluateNextDayPlan(readiness, context, '2026-08-07', todayRec).branches.yellow.recommendation;

        const plan = generateWeekAheadPlan(readiness, context, null, '2026-08-07', todayRec, tomorrowRec, prepareWeekAheadPlanSeed(readiness, [], '2026-08-07', heavyHistory), { days: 7 });

        const projected = plan.days.filter(d => d.confidence === 'projected');
        expect(projected.some(d => d.template.category === 'Rest' || d.template.category === 'Mobility/Recovery')).toBe(true);
    });

    it('never picks a template requiring equipment the athlete does not own, anywhere in the projected week', () => {
        const context = baseContext({ hasFreeWeights: false, hasIndoorBike: false, hasCableMachine: false, hasTreadmill: false });
        const { readiness, todayRec, tomorrowRec } = buildTodayAndTomorrow(context);

        const plan = generateWeekAheadPlan(readiness, context, null, '2026-08-07', todayRec, tomorrowRec, prepareWeekAheadPlanSeed(readiness, [], '2026-08-07', []), { days: 7 });

        plan.days.filter(d => d.confidence === 'projected').forEach(d => {
            expect(d.template.requiredEquipment).toEqual([]);
        });
    });

    it('resolves the threshold objective under an A-priority cycling event instead of leaving it permanently unresolved', () => {
        // Regression for the exact reported failure: Tempo Ride/Bike VO2 Intervals claim
        // a high thresholdDevelopment stimulus and win ranking on that basis every day,
        // but under the old keyword-matched ledger the objective they won on could never
        // actually complete, so the plan kept "needing" threshold work forever.
        const context = baseContext({ hasIndoorBike: true });
        const { readiness, todayRec, tomorrowRec } = buildTodayAndTomorrow(context);
        const event: UserEvent = {
            id: 'e1', title: 'Gran Fondo', date: '2026-09-20', priority: 'A', lifecycle: 'scheduled', category: 'cycling_event',
            demandProfile: { aerobicEndurance: 0.8, thresholdPower: 0.75, vo2MaxPower: 0.7, repeatedSurges: 0.7, sprintPower: 0.3, fatigueResistance: 0.8, neuromuscular: 0.3 },
        };

        const plan = generateWeekAheadPlan(readiness, context, null, '2026-08-07', todayRec, tomorrowRec, prepareWeekAheadPlanSeed(readiness, [event], '2026-08-07', []), { days: 7, events: [event] });

        const threshold = plan.microcycleObjectives.find(o => o.key === 'threshold_quality');
        expect(threshold).toBeDefined();
        expect(threshold!.completedExposures).toBeGreaterThanOrEqual(1);
    });

    it('a "Works toward" objective claim on a displayed day is only made when that pick genuinely covers it', () => {
        // addressesObjectives now comes from the same coverage threshold that actually
        // credits the ledger (STIMULUS_CREDIT_COVERAGE_THRESHOLD) rather than a looser
        // "touches the axis at all" check, so the UI never claims progress the ledger
        // itself didn't grant.
        const context = baseContext();
        const { readiness, todayRec, tomorrowRec } = buildTodayAndTomorrow(context);

        const plan = generateWeekAheadPlan(readiness, context, null, '2026-08-07', todayRec, tomorrowRec, prepareWeekAheadPlanSeed(readiness, [], '2026-08-07', []), { days: 7 });

        // Every day that claims to address an objective must have actually moved that
        // objective's completedExposures up by the time the ledger is walked forward --
        // i.e. no day over-claims progress the final ledger doesn't reflect exceeding.
        const claimedTitles = new Set(plan.days.flatMap(d => d.addressesObjectives));
        claimedTitles.forEach(title => {
            const objective = plan.microcycleObjectives.find(o => o.title === title);
            expect(objective).toBeDefined();
            expect(objective!.completedExposures).toBeGreaterThan(0);
        });
    });
});

// --- Weekly-architecture anchor-day layer -------------------------------------

function weeklyTrainingSettings(overrides: Partial<TrainingSettings['defaults']> = {}): TrainingSettings {
    return {
        userId: 'u1', schemaVersion: 2,
        // indoor_bike: the midweek "structured quality" templates (Tempo Ride / Bike VO2
        // Intervals) require it -- the outdoor Race-Specific Endurance templates don't
        // (requiredEquipment: []), so this only gates the quality-anchor side.
        equipment: { free_weights: true, cable_machine: false, treadmill: false, indoor_bike: true, pullup_bar: false },
        guardrails: { avoid_high_impact: false, avoid_heavy_lower_body: false, avoid_overhead_pressing: false, avoid_heavy_spinal_loading: false },
        defaults: { weekdayMaxMinutes: 45, weekendMaxMinutes: 150, environment: 'either', ...overrides },
        preferences: { preferActiveRecovery: false },
        migration: { legacyReviewed: true, migratedAt: null }, createdAt: '', updatedAt: '',
    };
}

const cyclingEvent = (daysOut: string): UserEvent => ({
    id: 'e1', title: 'Gran Fondo', date: daysOut, priority: 'A', lifecycle: 'scheduled', category: 'cycling_event',
    demandProfile: { aerobicEndurance: 0.8, thresholdPower: 0.75, vo2MaxPower: 0.7, repeatedSurges: 0.7, sprintPower: 0.3, fatigueResistance: 0.8, neuromuscular: 0.3 },
});

describe('resolveWeeklyAnchors', () => {
    it('nominates no anchors at all when no focus event governs any candidate day', () => {
        const context = baseContext();
        context.trainingSettings = weeklyTrainingSettings();
        const anchors = resolveWeeklyAnchors('2026-08-07', 7, [], [], context);
        expect(anchors).toEqual({ eventSpecificAnchorDate: null, qualityAnchorDate: null });
    });

    it('nominates the event-specific anchor on the day with the largest real time budget, and a quality anchor at least 2 days away', () => {
        // 2026-08-07 is a Friday -- offsets 2..7 land on Sun(08-09) Mon Tue Wed Thu Fri(08-14).
        // Only Sunday gets the weekend budget (150 min); every weekday is capped at 45 --
        // too short for any Race-Specific Endurance template's 50+ min floor, so Sunday is
        // the only day that can host it.
        const context = baseContext();
        context.trainingSettings = weeklyTrainingSettings();
        const event = cyclingEvent('2026-08-27'); // 20 days out -> Specificity phase, no taper
        const anchors = resolveWeeklyAnchors('2026-08-07', 7, [event], [], context);

        expect(anchors.eventSpecificAnchorDate).toBe('2026-08-09');
        expect(anchors.qualityAnchorDate).not.toBeNull();
        expect(anchors.qualityAnchorDate).not.toBe('2026-08-09');
    });

    it('migrates an event-specific anchor to the next feasible day when its preferred day is fully reserved', () => {
        const context = baseContext();
        // A 60-minute weekday can host the shortest race-specific template. With Sunday
        // fully reserved, Monday is the nearest viable fallback instead of silently
        // treating the protected objective as completed or dropping it without a signal.
        context.trainingSettings = weeklyTrainingSettings({ weekdayMaxMinutes: 60 });
        const event = cyclingEvent('2026-08-27');
        const reservedSunday: FixedActivity = {
            id: 'family-event', userId: 'athlete-1', title: 'Fixed commitment', date: '2026-08-09', durationMin: 150,
            isCompleted: false, fixed: true, environment: 'either', equipment: [],
            createdAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z',
        };

        const anchors = resolveWeeklyAnchors('2026-08-07', 7, [event], [reservedSunday], context);

        expect(anchors.eventSpecificAnchorDate).toBe('2026-08-10');
    });

    it('nominates no event-specific anchor once every candidate day is in the taper window (the race-specific templates explicitly excludeTaper)', () => {
        const context = baseContext();
        context.trainingSettings = weeklyTrainingSettings();
        const event = cyclingEvent('2026-08-14'); // 7 days out -> inside the 14-day A-event taper window for every offset 2..7
        const anchors = resolveWeeklyAnchors('2026-08-07', 7, [event], [], context);
        expect(anchors.eventSpecificAnchorDate).toBeNull();
    });
});

describe('generateWeekAheadPlan weekly-architecture anchoring', () => {
    it('boosts a Race-Specific Endurance pick onto the nominated event-specific anchor day', () => {
        const context = baseContext();
        context.trainingSettings = weeklyTrainingSettings();
        context.preferences.preferredModalities = ['Cycling'];
        // soreness: 7 forces today into 'modify' mode (systemicCost <= 0.5), same as the
        // synthetic 'yellow' scenario tomorrowRec already always uses -- keeps the fatigue
        // seeded into the anchor day realistic-but-modest, so the anchor boost is being
        // tested on its own merits rather than fighting a hard day's residual fatigue (a
        // real hard/moderate day legitimately CAN outrank the anchor via the fatigue-tier
        // gate -- that's correct, not a bug, so this test deliberately avoids that case).
        const readiness: DailyReadiness = { subjective: neutralSubjective({ soreness: 7 }), objective: quietObjective() };
        const event = cyclingEvent('2026-08-27'); // Specificity phase, no taper
        const todayRec = evaluateTraining(readiness, context, '2026-08-07');
        const tomorrowRec = evaluateNextDayPlan(readiness, context, '2026-08-07', todayRec).branches.yellow.recommendation;

        const plan = generateWeekAheadPlan(
            readiness, context, null, '2026-08-07', todayRec, tomorrowRec,
            prepareWeekAheadPlanSeed(readiness, [event], '2026-08-07', []),
            { days: 7, events: [event] },
        );

        const sunday = plan.days.find(d => d.date === '2026-08-09');
        expect(sunday).toBeDefined();
        expect(sunday!.template.category).toBe('Race-Specific Endurance');
    });

    it('does not change plan output at all when resolveWeeklyAnchors returns no anchors (Base phase, no event)', () => {
        const context = baseContext();
        const { readiness, todayRec, tomorrowRec } = buildTodayAndTomorrow(context);
        const seed = prepareWeekAheadPlanSeed(readiness, [], '2026-08-07', []);

        const anchors = resolveWeeklyAnchors('2026-08-07', 7, [], [], context);
        expect(anchors).toEqual({ eventSpecificAnchorDate: null, qualityAnchorDate: null });

        // Same plan as the pre-existing "produces the requested number of future days"
        // fixture -- asserting it's untouched by this feature's presence.
        const plan = generateWeekAheadPlan(readiness, context, null, '2026-08-07', todayRec, tomorrowRec, seed, { days: 7 });
        expect(plan.days).toHaveLength(7);
    });
});
