import { describe, expect, it } from 'vitest';
import { evaluateEnvelopes } from './rules';
import type { DailyReadiness, TrainingSettings, UserContext } from './models';

function settings(): TrainingSettings {
    return {
        userId: 'athlete',
        schemaVersion: 3,
        equipment: {
            free_weights: true,
            cable_machine: false,
            treadmill: false,
            indoor_bike: true,
            pullup_bar: true,
        },
        guardrails: {
            avoid_high_impact: false,
            avoid_heavy_lower_body: false,
            avoid_overhead_pressing: false,
            avoid_heavy_spinal_loading: false,
        },
        defaults: { weekdayMaxMinutes: 180, weekendMaxMinutes: 240, environment: 'either' },
        preferences: { preferActiveRecovery: false },
        migration: { legacyReviewed: true, migratedAt: null },
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
    };
}

function context(): UserContext {
    return {
        goals: { shortTerm: '', midTerm: '', longTerm: '' },
        constraints: {
            hasCableMachine: false,
            hasFreeWeights: true,
            hasTreadmill: false,
            hasIndoorBike: true,
            restrictedModalities: [],
            maxTimeMinutes: 180,
        },
        preferences: {
            avoidedModalities: [],
            deprioritizedModalities: [],
            preferredModalities: [],
            conservativeBias: false,
        },
        trainingSettings: settings(),
    };
}

function readiness(): DailyReadiness {
    return {
        subjective: {
            readiness: 8,
            sleepQuality: 8,
            fatigue: 2,
            soreness: 2,
            stress: 2,
            motivation: 8,
            timeAvailable: 120,
            painFlag: true,
            clinicalEnvelopeSources: ['red_flag'],
            redFlagFindings: [{
                category: 'systemic_infection',
                source: 'explicit_checkin',
                description: 'Red-flag symptom reported.',
            }],
            alreadyTrainedToday: false,
            preferredModalityToday: null,
        },
        objective: {
            total_steps: 8000,
            sleep_score: 85,
            sleep_duration_min: 460,
            rhr: 48,
            rhr_7d_avg: 48,
            rhr_delta: 0,
            hrv_weekly_avg: 60,
            hrv_last_night: 60,
            hrv_delta: 0,
            respiration: 13,
            body_battery_wake: 85,
            last_3_days_hard_sessions_count: 0,
            yesterday_training: null,
            today_training: null,
            sleep_score_delta_7d: 0,
            rhr_delta_28d: 0,
            hrv_delta_28d: 0,
            sleep_score_delta_28d: 0,
            hrv_stdev_28d: 8.5,
            rhr_stdev_28d: 3.5,
            sleep_score_stdev_28d: 7.8,
        },
    };
}

describe('SEP-C4 red-flag reason labels', () => {
    it('renders the compatibility category as a non-diagnostic systemic/cardiopulmonary warning', () => {
        const reason = evaluateEnvelopes(readiness(), context()).safety.clinicalReason;

        expect(reason).toContain('systemic / cardiopulmonary warning');
        expect(reason).not.toContain('systemic infection');
    });
});
