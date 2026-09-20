import { describe, expect, it } from 'vitest';
import { SCENARIOS } from './simulation/scenarios';
import { runScenario } from './simulation/analyze';
import { rankCandidates } from './optimizer';
import { ENRICHED_TEMPLATES } from './templates';
import type { CompletedExposure } from './trainingHistory';
import type { DailyReadiness, EngineObjectiveInput, FatigueState, FixedActivity, SubjectiveInput, UserEvent, UserPreferences } from './models';
import type { ResolvedAvailability } from './schedule';

const DEFAULT_FATIGUE: FatigueState = {
    lastUpdatedDate: '2026-03-01',
    externalLoadFatigue: { systemic: 0, cardiovascular: 0, lowerBody: 0, upperBody: 0, impactTissue: 0, neuromuscular: 0 },
    internalResponseStrain: { systemic: 0, cardiovascular: 0, lowerBody: 0, upperBody: 0, impactTissue: 0, neuromuscular: 0 },
    combinedFatigue: { systemic: 0, cardiovascular: 0, lowerBody: 0, upperBody: 0, impactTissue: 0, neuromuscular: 0 },
};

const DEFAULT_AVAILABILITY: ResolvedAvailability = {
    date: '2026-03-01',
    maxTimeMinutes: 120,
    availableEquipment: ['free_weights', 'indoor_bike', 'treadmill', 'cable_machine'],
    fixedActivities: [],
    reservedCapacityCost: 0,
    reservedCapacityCostProfile: { systemic: 0, cardiovascular: 0, lowerBody: 0, upperBody: 0, impactTissue: 0, neuromuscular: 0 },
    environmentOverride: null,
};

const DEFAULT_PREFERENCES: UserPreferences = {
    userId: 'user_default',
    schemaVersion: 1,
    createdAt: '2026-03-01T00:00:00Z',
    updatedAt: '2026-03-01T00:00:00Z',
    avoidedModalities: [],
    deprioritizedModalities: [],
    preferredModalities: [],
    conservativeBias: false,
    preferredRecoveryStyle: 'mixed',
    defaultWeekdayTimeMin: 60,
    defaultWeekendTimeMin: 90,
    preferredTimeOfDay: 'flexible',
    explanationVerbosity: 'detailed',
    preferredUnits: { distance: 'km', weight: 'kg', temperature: 'celsius' },
};

function addDays(date: string, days: number): string {
    const [year, month, day] = date.split('-').map(Number);
    const value = new Date(Date.UTC(year, month - 1, day));
    value.setUTCDate(value.getUTCDate() + days);
    return value.toISOString().slice(0, 10);
}

function exposureOn(exposure: CompletedExposure, date: string, occurrenceSuffix: string): CompletedExposure {
    return {
        ...structuredClone(exposure),
        occurrenceKey: `judge:${occurrenceSuffix}:${date}`,
        date,
    };
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
    const goodSubjective: Partial<SubjectiveInput> = { readiness: 9, sleepQuality: 9, fatigue: 1, soreness: 1, stress: 2, motivation: 9 };

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

    it('prevents quality stacking in race week: hard training yesterday blocks high-cost surges on Day 3', async () => {
        const fresh = await runScenario({
            ...base,
            id: 'judge_int_race7_fresh',
            event: race7,
            events: [race7],
            weeks: 1,
            fixedActivities: race7Fixed,
            readinessForWeek: () => makeReadiness(goodSubjective, goodObjective),
        });

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

        const freshHardCount = fresh.decisionTraces.filter(t => t.selected.projectedCost.systemic >= 0.5).length;
        const hardYdayHardCount = hardYday.decisionTraces.filter(t => t.selected.projectedCost.systemic >= 0.5).length;

        // In race week (7 days out from A-event), no high-cost (>= 0.50) sessions are allowed in taper
        expect(freshHardCount).toBe(0);
        expect(hardYdayHardCount).toBe(0);

        // Immediate response keeps first two days easy after hard training yesterday
        expect(hardYday.decisionTraces[0].selected.projectedCost.systemic).toBeLessThanOrEqual(0.35);
        expect(hardYday.decisionTraces[1].selected.projectedCost.systemic).toBeLessThanOrEqual(0.35);

        // Pre-event sharpening remains preserved on Day 4 (D-3 before race)
        expect(hardYday.decisionTraces[4].selected.templateId).toBe('end_taper_sharpen_01');
    });

    it('avoids over-resting after severe objective adversity before an A-event: allows light neuromuscular sharpening on D-2', async () => {
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

        // Does NOT produce 7 consecutive rest/mobility days
        const nonRestDays = badObj.decisionTraces.filter(t => t.selected.category !== 'Rest' && t.selected.category !== 'Mobility/Recovery');
        expect(nonRestDays.length).toBeGreaterThanOrEqual(2);

        // Day 5 (D-2 before race) schedules light taper sharpening (systemicCost <= 0.45)
        expect(badObj.decisionTraces[4].selected.templateId).toBe('end_taper_sharpen_01');
        expect(badObj.decisionTraces[4].selected.projectedCost.systemic).toBeLessThanOrEqual(0.45);

        // Days 1-3 remain fully safe and graduated
        expect(['Rest', 'Mobility/Recovery']).toContain(badObj.decisionTraces[0].selected.category);
        expect(['Rest', 'Mobility/Recovery']).toContain(badObj.decisionTraces[1].selected.category);
        expect(['Rest', 'Mobility/Recovery']).toContain(badObj.decisionTraces[2].selected.category);
    });

    it('enforces heavy strength spacing (>=4 days) and general strength spacing (>=3 days) for endurance events', () => {
        const heavyStrengthTemplate = ENRICHED_TEMPLATES.find(t => t.id === 'str_full_01');
        expect(heavyStrengthTemplate).toBeDefined();
        const reducedStrengthTemplate = ENRICHED_TEMPLATES.find(t => t.id === 'str_full_03');
        expect(reducedStrengthTemplate).toBeDefined();

        const cyclingEvent: UserEvent = {
            id: 'event-crit',
            title: 'Criterium Championship',
            category: 'cycling_event',
            date: '2026-08-30',
            priority: 'A',
            lifecycle: 'scheduled',
            demandProfile: { aerobicEndurance: 0.8, thresholdPower: 0.8, vo2MaxPower: 0.6, repeatedSurges: 0.7, sprintPower: 0.3, fatigueResistance: 0.7, neuromuscular: 0.3 },
        };

        // 1. Heavy strength candidate after prior heavy strength 2 days ago -> rejected (gap < 4)
        const resultHeavyGap2 = rankCandidates(
            [heavyStrengthTemplate!],
            [],
            DEFAULT_FATIGUE,
            DEFAULT_AVAILABILITY,
            [],
            DEFAULT_PREFERENCES,
            {
                date: '2026-08-20',
                focusEvent: cyclingEvent,
                recentHistory: [{
                    date: '2026-08-18',
                    templateId: 'str_full_01',
                    modality: 'Strength',
                    category: 'Full-body Strength',
                    systemicCost: 0.8,
                    lowerBodyCost: 0.7,
                }],
            },
        );
        expect(resultHeavyGap2.rejected).toHaveLength(1);
        expect(resultHeavyGap2.rejected[0].excludedReasons).toContain('HARD_LOWER_BODY_SPACING_VIOLATION');

        // 2. Light strength candidate after prior strength 2 days ago -> rejected (gap < 3)
        const resultLightGap2 = rankCandidates(
            [reducedStrengthTemplate!],
            [],
            DEFAULT_FATIGUE,
            DEFAULT_AVAILABILITY,
            [],
            DEFAULT_PREFERENCES,
            {
                date: '2026-08-20',
                focusEvent: cyclingEvent,
                recentHistory: [{
                    date: '2026-08-18',
                    templateId: 'str_full_03',
                    modality: 'Strength',
                    category: 'Full-body Strength',
                    systemicCost: 0.45,
                    lowerBodyCost: 0.35,
                }],
            },
        );
        expect(resultLightGap2.rejected).toHaveLength(1);
        expect(resultLightGap2.rejected[0].excludedReasons).toContain('HARD_LOWER_BODY_SPACING_VIOLATION');

        // 3. Light strength candidate after prior strength 3 days ago -> accepted (gap >= 3)
        const resultLightGap3 = rankCandidates(
            [reducedStrengthTemplate!],
            [],
            DEFAULT_FATIGUE,
            DEFAULT_AVAILABILITY,
            [],
            DEFAULT_PREFERENCES,
            {
                date: '2026-08-21',
                focusEvent: cyclingEvent,
                recentHistory: [{
                    date: '2026-08-18',
                    templateId: 'str_full_03',
                    modality: 'Strength',
                    category: 'Full-body Strength',
                    systemicCost: 0.45,
                    lowerBodyCost: 0.35,
                }],
            },
        );
        expect(resultLightGap3.accepted).toHaveLength(1);
    });
});
