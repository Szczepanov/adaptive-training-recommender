import { describe, expect, it } from 'vitest';
import { evaluateRecoveryConstraints } from './optimizer';
import { SCENARIOS } from './simulation/scenarios';
import { runScenario } from './simulation/analyze';
import type {
    DailyReadiness,
    EngineObjectiveInput,
    FixedActivity,
    SessionHistoryEntry,
    SessionTemplate,
    SubjectiveInput,
    UserEvent,
} from './models';
import type { CompletedExposure } from './trainingHistory';

function addDays(date: string, days: number): string {
    const [year, month, day] = date.split('-').map(Number);
    const value = new Date(Date.UTC(year, month - 1, day));
    value.setUTCDate(value.getUTCDate() + days);
    return value.toISOString().slice(0, 10);
}

function dayDiff(later: string, earlier: string): number {
    const toUtc = (date: string) => {
        const [year, month, day] = date.split('-').map(Number);
        return Date.UTC(year, month - 1, day);
    };
    return Math.round((toUtc(later) - toUtc(earlier)) / 86_400_000);
}

function exposureOn(exposure: CompletedExposure, date: string, occurrenceSuffix: string): CompletedExposure {
    return { ...structuredClone(exposure), occurrenceKey: `judge:${occurrenceSuffix}:${date}`, date };
}

function makeReadiness(
    subjectiveOverrides: Partial<SubjectiveInput>,
    objectiveOverrides: Partial<EngineObjectiveInput>,
): DailyReadiness {
    const subjective: SubjectiveInput = {
        readiness: 6, sleepQuality: 6, fatigue: 4, soreness: 4, stress: 4, motivation: 6,
        timeAvailable: 60, painFlag: false, alreadyTrainedToday: false, preferredModalityToday: null,
        ...subjectiveOverrides,
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

describe('race-week quality density and severe recovery sequencing (Issue #676)', () => {
    const base = SCENARIOS.find(s => s.id === 'cycling_criterium_A');
    expect(base).toBeDefined();
    if (!base) return;

    const hardLoadSource = SCENARIOS.find(s => s.id === 'external_load_green_readiness');
    expect(hardLoadSource?.initialHistory).toBeDefined();
    const hardExposure = hardLoadSource!.initialHistory![0];

    const goodObjective: Partial<EngineObjectiveInput> = {
        hrv_delta: 8, hrv_delta_28d: 8, hrv_last_night: 58, rhr: 46, rhr_delta: -4, rhr_delta_28d: -4,
        sleep_score: 92, sleep_duration_min: 480, sleep_score_delta_7d: 8, sleep_score_delta_28d: 8, body_battery_wake: 92,
    };
    const badObjective: Partial<EngineObjectiveInput> = {
        hrv_delta: -17, hrv_delta_28d: -17, hrv_last_night: 33, rhr: 57, rhr_delta: 7, rhr_delta_28d: 7,
        sleep_score: 50, sleep_duration_min: 300, sleep_score_delta_7d: -28, sleep_score_delta_28d: -28, body_battery_wake: 22,
    };

    expect(base.event).toBeDefined();
    const race7: UserEvent = structuredClone(base.event!);
    race7.date = addDays(base.startDate, 7);
    const race7Fixed: FixedActivity[] = [{
        id: `judge-event:${race7.id}`,
        userId: 'judge-user',
        title: `Scheduled event: ${race7.title}`,
        date: race7.date,
        durationMin: 60,
        fixed: true,
        environment: 'outdoor',
        equipment: [],
        isCompleted: false,
        expectedCost: { systemic: 0.95, cardiovascular: 0.95, lowerBody: 0.65, upperBody: 0.1, impactTissue: 0.2, neuromuscular: 0.8 },
        createdAt: '2026-08-01T00:00:00Z',
        updatedAt: '2026-08-01T00:00:00Z',
    }];

    it('prevents race-week quality stacking after hard training yesterday while preserving a later light sharpen', async () => {
        const hardYday = await runScenario({
            ...base,
            id: 'judge_int_race7_hard_yday',
            event: race7,
            events: [race7],
            weeks: 1,
            initialHistory: [exposureOn(hardExposure, addDays(base.startDate, -1), 'race7-hard-yesterday')],
            fixedActivities: race7Fixed,
            readinessForWeek: () => makeReadiness(
                { readiness: 7, sleepQuality: 7, fatigue: 4, soreness: 3, stress: 3, motivation: 7 },
                goodObjective,
            ),
        });

        expect(hardYday.decisionTraces[0].selected.projectedCost.systemic).toBeLessThanOrEqual(0.35);
        expect(hardYday.decisionTraces[1].selected.projectedCost.systemic).toBeLessThanOrEqual(0.35);

        const earlyHighCost = hardYday.decisionTraces.filter(trace => {
            const daysToRace = dayDiff(race7.date, trace.date);
            return daysToRace >= 4 && daysToRace <= 6 && trace.selected.projectedCost.systemic >= 0.5;
        });
        expect(earlyHighCost).toHaveLength(0);

        const sharpen = hardYday.decisionTraces.find(trace => {
            const daysToRace = dayDiff(race7.date, trace.date);
            return (daysToRace === 2 || daysToRace === 3) && trace.selected.templateId === 'end_taper_sharpen_01';
        });
        expect(sharpen).toBeDefined();
        expect(sharpen!.selected.projectedCost.systemic).toBeLessThanOrEqual(0.45);
    });

    it('allows bounded late re-entry sharpening after severe objective adversity without resuming Strength', async () => {
        const badObj = await runScenario({
            ...base,
            id: 'judge_int_race7_badobj',
            event: race7,
            events: [race7],
            weeks: 1,
            fixedActivities: race7Fixed,
            readinessForWeek: () => makeReadiness(
                { readiness: 5, sleepQuality: 5, fatigue: 5, soreness: 5, stress: 5, motivation: 5 },
                badObjective,
            ),
        });

        for (const trace of badObj.decisionTraces.slice(0, 2)) {
            expect(['Rest', 'Mobility/Recovery']).toContain(trace.selected.category);
        }
        expect(badObj.decisionTraces.slice(0, 5).some(trace => trace.selected.modality === 'Strength')).toBe(false);

        const sharpen = badObj.decisionTraces.find(trace => {
            const daysToRace = dayDiff(race7.date, trace.date);
            return (daysToRace === 2 || daysToRace === 3) && trace.selected.templateId === 'end_taper_sharpen_01';
        });
        expect(sharpen).toBeDefined();
        expect(sharpen!.selected.projectedCost.systemic).toBeLessThanOrEqual(0.45);
    });

    it('handles hard-yesterday plus severe adversity without strength/quality rebuilding', async () => {
        const combined = await runScenario({
            ...base,
            id: 'judge_int_race7_hard_yday_badobj',
            event: race7,
            events: [race7],
            weeks: 1,
            initialHistory: [exposureOn(hardExposure, addDays(base.startDate, -1), 'race7-hard-yesterday-badobj')],
            fixedActivities: race7Fixed,
            readinessForWeek: () => makeReadiness(
                { readiness: 5, sleepQuality: 5, fatigue: 5, soreness: 5, stress: 5, motivation: 5 },
                badObjective,
            ),
        });

        for (const trace of combined.decisionTraces.slice(0, 2)) {
            expect(['Rest', 'Mobility/Recovery']).toContain(trace.selected.category);
        }
        expect(combined.decisionTraces.slice(0, 5).some(trace => trace.selected.modality === 'Strength')).toBe(false);

        const sharpen = combined.decisionTraces.find(trace => {
            const daysToRace = dayDiff(race7.date, trace.date);
            return (daysToRace === 2 || daysToRace === 3) && trace.selected.templateId === 'end_taper_sharpen_01';
        });
        expect(sharpen).toBeDefined();
        expect(sharpen!.selected.projectedCost.systemic).toBeLessThanOrEqual(0.45);
    });

    it('counts a recent >0.45 race-specific exposure as hard history for the Priority-A interaction guard', () => {
        const targetDate = '2026-08-25';
        const event: UserEvent = { ...structuredClone(race7), date: '2026-08-30', priority: 'A' };
        const candidate: SessionTemplate = {
            id: 'issue-676-hard-candidate',
            category: 'Race-Specific Endurance',
            modality: 'Cycling',
            durationMin: 45,
            durationMax: 45,
            title: 'Issue 676 hard race-specific candidate',
            description: 'Test-only candidate.',
            requiredEquipment: [],
            environment: 'either',
            safetyTags: [],
            systemicCost: 0.50,
        };
        const history: SessionHistoryEntry[] = [{
            date: '2026-08-23',
            templateId: 'issue-676-prior-race-specific',
            category: 'Race-Specific Endurance',
            modality: 'Cycling',
            role: 'supporting',
            intensityClass: 'moderate',
            systemicCost: 0.48,
            lowerBodyCost: 0.30,
        }];

        const reasons = evaluateRecoveryConstraints(candidate, targetDate, history, {
            date: targetDate,
            focusEvent: event,
        });
        expect(reasons).toContain('PRE_EVENT_TAPER_RESTRICTION');
    });
});
