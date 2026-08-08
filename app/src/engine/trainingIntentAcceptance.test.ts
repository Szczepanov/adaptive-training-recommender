import { describe, expect, it } from 'vitest';
import { evaluateTraining, evaluateTrainingWithIntent } from './rules';
import { resolveTrainingIntent } from './trainingIntent';
import type { DailyReadiness, UserContext, UserEvent } from './models';
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
        expect(eventDriven.template.category).toBe('Race-Specific Endurance');
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

    it('preserves taper intensity while reducing its volume component', async () => {
        const build = await resolveTrainingIntent('u1', [septemberCyclingEvent], '2026-08-10', readiness(), 7, fixtureHistory);
        const taper = await resolveTrainingIntent('u1', [septemberCyclingEvent], '2026-09-10', readiness(), 7, fixtureHistory);

        expect(taper.plannedDose.intensity).toBe(1);
        expect(taper.plannedDose.volume).toBeLessThan(build.plannedDose.volume);
    });
});
