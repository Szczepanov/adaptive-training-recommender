import { describe, expect, it } from 'vitest';
import type { DimensionalFatigue, FatigueState, UserPreferences } from './models';
import type { ResolvedAvailability } from './schedule';
import { combineFatigue, computeInternalResponseStrain, decayFatigue } from './fatigue';
import { ENRICHED_TEMPLATES_BY_ID } from './templates';
import { rankCandidates } from './optimizer';
import { workoutForTemplate } from '../workouts/prescription';

// Behavioral authority: docs/macrocycle-v5.md — Recovery authority + Strength during cycling build.
const ZERO: DimensionalFatigue = {
    systemic: 0, cardiovascular: 0, lowerBody: 0, upperBody: 0, impactTissue: 0, neuromuscular: 0,
};
const FATIGUE: FatigueState = {
    lastUpdatedDate: '2026-08-10',
    externalLoadFatigue: { ...ZERO, lowerBody: 0.8, impactTissue: 0.8 },
    internalResponseStrain: { ...ZERO },
    combinedFatigue: { ...ZERO, lowerBody: 0.8, impactTissue: 0.8 },
};
const AVAILABILITY: ResolvedAvailability = {
    date: '2026-08-10', maxTimeMinutes: 180, availableEquipment: ['free_weights', 'indoor_bike'],
    fixedActivities: [], reservedCapacityCost: 0,
    reservedCapacityCostProfile: { systemic: 0, cardiovascular: 0, lowerBody: 0, upperBody: 0, impactTissue: 0, neuromuscular: 0 },
    environmentOverride: null,
};
function preferences(style: UserPreferences['preferredRecoveryStyle']): UserPreferences {
    return {
        userId: 'macrocycle-w3', preferredRecoveryStyle: style,
        defaultWeekdayTimeMin: 90, defaultWeekendTimeMin: 150, preferredTimeOfDay: 'flexible',
        preferredModalities: [], deprioritizedModalities: [], avoidedModalities: [], explanationVerbosity: 'detailed',
        conservativeBias: false, preferredUnits: { distance: 'km', weight: 'kg', temperature: 'celsius' },
        schemaVersion: 1, createdAt: '', updatedAt: '',
    };
}

describe('macrocycle v5 recovery and strength contracts', () => {
    it('keeps max fusion as the default and exposes additive fusion only as an explicit selector', () => {
        const external = { ...ZERO, systemic: 0.45, lowerBody: 0.5 };
        const internal = { ...ZERO, systemic: 0.3, lowerBody: 0.4 };
        expect(combineFatigue(external, internal)).toMatchObject({ systemic: 0.45, lowerBody: 0.5 });
        expect(combineFatigue(external, internal, 'additive')).toMatchObject({ systemic: 0.75, lowerBody: 0.9 });
    });

    it('prefers complete rest for passive/mixed recover-tier days and active recovery only when explicitly active', () => {
        const rest = ENRICHED_TEMPLATES_BY_ID.get('rest_01');
        const mobility = ENRICHED_TEMPLATES_BY_ID.get('mob_01');
        if (!rest || !mobility) throw new Error('recovery templates missing');

        const rank = (style: UserPreferences['preferredRecoveryStyle']) => rankCandidates(
            [mobility, rest], [], FATIGUE, AVAILABILITY, [], preferences(style),
            { date: '2026-08-10', fatigueTier: 'recover' },
        ).accepted[0]?.template.id;

        expect(rank('passive')).toBe('rest_01');
        expect(rank('mixed')).toBe('rest_01');
        expect(rank('active')).toBe('mob_01');
    });

    it('lets a saturated 48-hour fatigue dimension clear below recover and modify thresholds with rest', () => {
        const saturated = { ...ZERO, lowerBody: 1, impactTissue: 1 };
        const after24h = decayFatigue(saturated, 24);
        const after48h = decayFatigue(saturated, 48);
        expect(Math.max(after24h.lowerBody, after24h.impactTissue)).toBeGreaterThan(0.65);
        expect(Math.max(after48h.lowerBody, after48h.impactTissue)).toBeLessThan(0.60);
    });

    it('keeps primary full-body strength reachable inside the modify ceiling without relaxing recover', () => {
        const reduced = ENRICHED_TEMPLATES_BY_ID.get('str_full_03');
        if (!reduced) throw new Error('str_full_03 missing');
        expect(reduced.category).toBe('Full-body Strength');
        expect(reduced.systemicCost).toBeLessThanOrEqual(0.5);
        expect(reduced.costProfile?.systemic).toBeLessThanOrEqual(0.5);
        expect(workoutForTemplate(reduced.id)?.id).toBe('strength_full_body_maintenance_01');
    });

    it('injects tissue-specific fatigue dampening when an acute unlogged step surge is detected', () => {
        const baseReadiness = {
            subjective: {
                readiness: 8, sleepQuality: 8, fatigue: 2, soreness: 1, stress: 2, motivation: 8,
                timeAvailable: 90, painFlag: false, alreadyTrainedToday: false, preferredModalityToday: null,
            },
            objective: {
                total_steps: 20000, sleep_score: 85, sleep_duration_min: 480, rhr: 50, rhr_7d_avg: 50, rhr_delta: 0,
                hrv_weekly_avg: 50, hrv_last_night: 50, hrv_delta: 0, respiration: 14, body_battery_wake: 90,
                last_3_days_hard_sessions_count: 0, yesterday_training: null, today_training: null,
                sleep_score_delta_7d: 0, rhr_delta_28d: 0, hrv_delta_28d: 0, sleep_score_delta_28d: 0,
                hrv_stdev_28d: 8, rhr_stdev_28d: 3, sleep_score_stdev_28d: 7,
                steps_7d_avg: 5000, steps_28d_avg: 5500, steps_delta_7d: 15000, steps_delta_28d: 14500, steps_stdev_28d: 800,
            },
        };

        const normalReadiness = {
            ...baseReadiness,
            objective: {
                ...baseReadiness.objective,
                total_steps: 5000,
                steps_delta_7d: 0,
            },
        };

        const normalStrain = computeInternalResponseStrain(normalReadiness);
        const surgeStrain = computeInternalResponseStrain(baseReadiness);

        expect(normalStrain.impactTissue).toBe(0);
        expect(normalStrain.lowerBody).toBe(0);
        expect(surgeStrain.impactTissue).toBeGreaterThan(0.35);
        expect(surgeStrain.lowerBody).toBeGreaterThan(0.35);
    });

    it('does not trigger an ambient surge when high step volume is explained by a logged running activity', () => {
        const loggedRunReadiness = {
            subjective: {
                readiness: 8, sleepQuality: 8, fatigue: 2, soreness: 1, stress: 2, motivation: 8,
                timeAvailable: 90, painFlag: false, alreadyTrainedToday: false, preferredModalityToday: null,
            },
            objective: {
                total_steps: 20000, sleep_score: 85, sleep_duration_min: 480, rhr: 50, rhr_7d_avg: 50, rhr_delta: 0,
                hrv_weekly_avg: 50, hrv_last_night: 50, hrv_delta: 0, respiration: 14, body_battery_wake: 90,
                last_3_days_hard_sessions_count: 1,
                yesterday_training: {
                    type: 'running',
                    duration_min: 90, // 90 min * 155 steps/min = ~13,950 steps -> ambient = 6,050 vs 5,000 baseline
                    training_effect: 3.5,
                    intensity_tag: 'hard',
                },
                today_training: null,
                sleep_score_delta_7d: 0, rhr_delta_28d: 0, hrv_delta_28d: 0, sleep_score_delta_28d: 0,
                hrv_stdev_28d: 8, rhr_stdev_28d: 3, sleep_score_stdev_28d: 7,
                steps_7d_avg: 5000, steps_28d_avg: 5500, steps_delta_7d: 15000, steps_delta_28d: 14500, steps_stdev_28d: 800,
            },
        };

        const strain = computeInternalResponseStrain(loggedRunReadiness);
        // Because the run accounts for ~14k steps, net ambient steps (6,050) is only +1,050 above baseline -> no ambient surge
        expect(strain.impactTissue).toBe(0);
        expect(strain.lowerBody).toBe(0);
    });

    it('enforces non-diluted acute strain floors for isolated high subjective fatigue and stress', () => {
        const neutralObjective = {
            total_steps: 5000, sleep_score: 80, sleep_duration_min: 480, rhr: 50, rhr_7d_avg: 50, rhr_delta: 0,
            hrv_weekly_avg: 50, hrv_last_night: 50, hrv_delta: 0, respiration: 14, body_battery_wake: 80,
            last_3_days_hard_sessions_count: 0, yesterday_training: null, today_training: null,
            sleep_score_delta_7d: 0, rhr_delta_28d: 0, hrv_delta_28d: 0, sleep_score_delta_28d: 0,
            hrv_stdev_28d: 8, rhr_stdev_28d: 3, sleep_score_stdev_28d: 7,
            steps_7d_avg: 5000, steps_28d_avg: 5500, steps_delta_7d: 0, steps_delta_28d: 0, steps_stdev_28d: 800,
        };

        // 1. Fatigue = 8/10 alone with neutral wearable metrics
        const fatigue8Readiness = {
            subjective: {
                readiness: 7, sleepQuality: 7, fatigue: 8, soreness: 2, stress: 2, motivation: 7,
                timeAvailable: 90, painFlag: false, alreadyTrainedToday: false, preferredModalityToday: null,
            },
            objective: neutralObjective,
        };
        const fatigue8Strain = computeInternalResponseStrain(fatigue8Readiness);
        expect(fatigue8Strain.systemic).toBeGreaterThanOrEqual(0.60);

        // 2. Severe distress: Fatigue = 8 with low readiness = 3
        const severeDistressReadiness = {
            subjective: {
                readiness: 3, sleepQuality: 4, fatigue: 8, soreness: 3, stress: 5, motivation: 4,
                timeAvailable: 90, painFlag: false, alreadyTrainedToday: false, preferredModalityToday: null,
            },
            objective: neutralObjective,
        };
        const severeStrain = computeInternalResponseStrain(severeDistressReadiness);
        expect(severeStrain.systemic).toBeGreaterThanOrEqual(0.65);

        // 3. Stress = 9 alone
        const stress9Readiness = {
            subjective: {
                readiness: 6, sleepQuality: 6, fatigue: 3, soreness: 1, stress: 9, motivation: 5,
                timeAvailable: 90, painFlag: false, alreadyTrainedToday: false, preferredModalityToday: null,
            },
            objective: neutralObjective,
        };
        const stressStrain = computeInternalResponseStrain(stress9Readiness);
        expect(stressStrain.systemic).toBeGreaterThanOrEqual(0.60);

        // 4. Severe autonomic collapse: HRV drop -17, RHR +7, Body Battery 22
        const autonomicCrashReadiness = {
            subjective: {
                readiness: 7, sleepQuality: 7, fatigue: 3, soreness: 1, stress: 2, motivation: 7,
                timeAvailable: 90, painFlag: false, alreadyTrainedToday: false, preferredModalityToday: null,
            },
            objective: {
                ...neutralObjective,
                hrv_delta: -17, rhr_delta: 7, body_battery_wake: 22, sleep_score: 50,
            },
        };
        const crashStrain = computeInternalResponseStrain(autonomicCrashReadiness);
        expect(crashStrain.systemic).toBeGreaterThanOrEqual(0.80);
        expect(crashStrain.cardiovascular).toBeGreaterThanOrEqual(0.80);

        // 5. Soreness = 8: takes 48h to clear below modify threshold (0.60)
        const sore8Readiness = {
            subjective: {
                readiness: 6, sleepQuality: 7, fatigue: 3, soreness: 8, stress: 2, motivation: 7,
                timeAvailable: 90, painFlag: false, alreadyTrainedToday: false, preferredModalityToday: null,
            },
            objective: neutralObjective,
        };
        const soreStrain = computeInternalResponseStrain(sore8Readiness);
        expect(soreStrain.lowerBody).toBeGreaterThanOrEqual(0.88);
        const after24h = decayFatigue(soreStrain, 24);
        const after48h = decayFatigue(soreStrain, 48);
        expect(after24h.lowerBody).toBeGreaterThanOrEqual(0.60);
        expect(after48h.lowerBody).toBeLessThan(0.60);
    });
});
