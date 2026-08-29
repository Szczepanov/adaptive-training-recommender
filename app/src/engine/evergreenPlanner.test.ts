import { describe, expect, it } from 'vitest';
import { generateWeekAheadPlanWithIntent } from './planner';
import { TEMPLATES } from './templates';
import { DEFAULT_BASE_DEMAND } from './periodization';
import type { DailyReadiness, Recommendation, TrainingIntentProfile, UserContext, UserEvent, UserPreferences } from './models';
import type { TrainingHistoryProvider } from './trainingHistory';

const history: TrainingHistoryProvider = { reconstruct: async () => [] };
const readiness: DailyReadiness = {
    subjective: { readiness: 8, sleepQuality: 8, fatigue: 2, soreness: 2, stress: 2, motivation: 8, timeAvailable: 60, painFlag: false, alreadyTrainedToday: false, preferredModalityToday: null },
    objective: { total_steps: 8000, sleep_score: 85, sleep_duration_min: 480, rhr: 50, rhr_7d_avg: 50, rhr_delta: 0, hrv_weekly_avg: 50, hrv_last_night: 50, hrv_delta: 0, respiration: 14, body_battery_wake: 90, last_3_days_hard_sessions_count: 0, yesterday_training: null, today_training: null, sleep_score_delta_7d: 0, rhr_delta_28d: 0, hrv_delta_28d: 0, sleep_score_delta_28d: 0, hrv_stdev_28d: 8, rhr_stdev_28d: 3, sleep_score_stdev_28d: 7 },
};
const context: UserContext = { goals: { shortTerm: '', midTerm: '', longTerm: '' }, constraints: { hasCableMachine: false, hasFreeWeights: true, hasTreadmill: false, hasIndoorBike: true, restrictedModalities: [], maxTimeMinutes: 60 }, preferences: { avoidedModalities: [], deprioritizedModalities: [], preferredModalities: [], conservativeBias: false } };
const preferences: UserPreferences = { userId: 'u1', preferredRecoveryStyle: 'mixed', defaultWeekdayTimeMin: 60, defaultWeekendTimeMin: 60, preferredTimeOfDay: 'flexible', preferredModalities: [], deprioritizedModalities: [], avoidedModalities: [], explanationVerbosity: 'detailed', conservativeBias: false, preferredUnits: { distance: 'km', weight: 'kg', temperature: 'celsius' }, schemaVersion: 1, createdAt: '', updatedAt: '' };
const profile: TrainingIntentProfile = { userId: 'u1', planningMode: 'evergreen', priorities: ['health'], weeklyCommitment: { minSessions: 2, targetSessions: 3, maxSessions: 4 }, organizationPreference: 'auto', schemaVersion: 1, createdAt: '', updatedAt: '' };
const cyclingEvent: UserEvent = { id: 'race', title: 'Ignored by evergreen', date: '2026-09-13', priority: 'A', lifecycle: 'scheduled', category: 'cycling_event', demandProfile: { aerobicEndurance: 0.8, thresholdPower: 0.8, vo2MaxPower: 0.7, repeatedSurges: 0.7, sprintPower: 0.3, fatigueResistance: 0.8, neuromuscular: 0.3 } };
const today: Recommendation = { template: TEMPLATES.find(template => template.id === 'rest_01')!, rationale: 'fixture', mode: 'recover' };

describe('evergreen week-ahead integration', () => {
    it('uses packed evergreen objectives instead of an event demand vector', async () => {
        const plan = await generateWeekAheadPlanWithIntent('u1', readiness, context, preferences, [cyclingEvent], '2026-08-10', today, null, { days: 6 }, history, undefined, profile);
        expect(plan.microcycleObjectives.map(objective => objective.key)).toContain('zone2_aerobic');
        expect(plan.microcycleObjectives.map(objective => objective.key)).not.toContain('race_specific_endurance');
        expect(plan.allocationReport.outcomes.some(outcome => outcome.occurrence.coverageSetId === 'evergreen_general')).toBe(true);
    });

    it('packs and concretely schedules aerobic plus strength coverage for a Running-only endurance+strength profile', async () => {
        // Regression: a former-elite-return-style persona with priorities
        // ['endurance', 'strength_muscle'] previously had two independent failure modes:
        // required-tier packing could starve aerobic work, and after that was fixed the
        // Running/no-bike path still had no concrete template able to earn aerobic_volume.
        const combinedProfile: TrainingIntentProfile = {
            ...profile, priorities: ['endurance', 'strength_muscle'],
            weeklyCommitment: { minSessions: 3, targetSessions: 4, maxSessions: 5 },
        };
        const combinedPreferences: UserPreferences = { ...preferences, preferredModalities: ['Running', 'Strength'] };
        const runningOnlyContext: UserContext = {
            ...context,
            constraints: { ...context.constraints, hasIndoorBike: false },
        };
        const plan = await generateWeekAheadPlanWithIntent('u1', readiness, runningOnlyContext, combinedPreferences, [], '2026-08-31', today, null, { days: 14 }, history, undefined, combinedProfile);
        const coverageKeys = plan.allocationReport.outcomes.map(outcome => outcome.occurrence.coverageKey);

        expect(coverageKeys).toContain('aerobic_volume');
        expect(coverageKeys).toContain('primary_strength');
        expect(plan.days.some(day => day.template.id === 'end_easy_02')).toBe(true);
        expect(plan.days.some(day => day.template.id === 'end_easy_01')).toBe(false);
    });

    it('does not take eventless evergreen objectives from DEFAULT_BASE_DEMAND', async () => {
        const baseline = await generateWeekAheadPlanWithIntent('u1', readiness, context, preferences, [], '2026-08-10', today, null, { days: 6 }, history, undefined, profile);
        const originalDemand = { ...DEFAULT_BASE_DEMAND };
        try {
            Object.assign(DEFAULT_BASE_DEMAND, {
                aerobicEndurance: 0,
                thresholdPower: 1,
                vo2MaxPower: 1,
                repeatedSurges: 1,
                sprintPower: 1,
                fatigueResistance: 1,
                neuromuscular: 1,
            });
            const mutated = await generateWeekAheadPlanWithIntent('u1', readiness, context, preferences, [], '2026-08-10', today, null, { days: 6 }, history, undefined, profile);
            expect(mutated.microcycleObjectives).toEqual(baseline.microcycleObjectives);
            expect(mutated.allocationReport.outcomes).toEqual(baseline.allocationReport.outcomes);
        } finally {
            Object.assign(DEFAULT_BASE_DEMAND, originalDemand);
        }
    });
});