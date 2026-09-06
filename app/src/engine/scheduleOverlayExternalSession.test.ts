import { describe, expect, it } from 'vitest';
import { adjudicateExternalSession } from './externalSession';
import { evaluateReadinessAndSafetyEnvelope } from './rules';
import type {
    DailyReadiness,
    ExternalPlanSession,
    PlannedDose,
    TrainingSettings,
    UserContext,
} from './models';
import type { ResolvedAvailability } from './schedule';

const DATE = '2026-11-20';

function readiness(): DailyReadiness {
    return {
        subjective: {
            readiness: 9,
            sleepQuality: 9,
            fatigue: 1,
            soreness: 1,
            stress: 1,
            motivation: 9,
            timeAvailable: 120,
            painFlag: false,
            alreadyTrainedToday: false,
            preferredModalityToday: null,
        },
        objective: {
            total_steps: 8000,
            sleep_score: 88,
            sleep_duration_min: 480,
            rhr: 48,
            rhr_7d_avg: 48,
            rhr_delta: 0,
            hrv_weekly_avg: 65,
            hrv_last_night: 68,
            hrv_delta: 3,
            respiration: 14,
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

function session(): ExternalPlanSession {
    return {
        id: 'w1-threshold',
        title: 'Threshold 3x12',
        priority: 'key',
        placement: {
            week: 1,
            preferredDay: 'friday',
            flexibility: 'preferred',
            ifMissed: 'reschedule_within_week',
        },
        gating: {
            modality: 'cycling',
            intensity: 'hard',
            durationMin: 60,
            durationMax: 75,
            environment: 'either',
            equipment: [],
        },
        prescription: { summary: '3x12 at threshold.' },
        scaling: { reducible: true, minimumUsefulDurationMin: 20 },
    };
}

function reducingAvailability(): ResolvedAvailability {
    return {
        date: DATE,
        maxTimeMinutes: 120,
        availableEquipment: ['indoor_bike'],
        fixedActivities: [],
        reservedCapacityCost: 0,
        reservedCapacityCostProfile: {
            systemic: 0,
            cardiovascular: 0,
            lowerBody: 0,
            upperBody: 0,
            impactTissue: 0,
            neuromuscular: 0,
        },
        volumeScale: 0.5,
        intensityScale: 0.5,
        environmentOverride: null,
    };
}

function adjudicate(plannedDose: PlannedDose) {
    const r = readiness();
    const c = context();
    return adjudicateExternalSession(
        session(),
        r,
        c,
        evaluateReadinessAndSafetyEnvelope(r, c, DATE),
        plannedDose,
        DATE,
        reducingAvailability(),
    );
}

describe('external sessions under schedule overlays', () => {
    it('applies overlay volume and intensity scales to a valid authored dose', () => {
        const verdict = adjudicate({ volume: 1, intensity: 1 });
        expect(verdict.decision).toBe('proceed');
        expect(verdict.executionDose).toEqual({ volume: 0.5, intensity: 0.5 });
    });

    it('rejects an invalid authored dose before a reducing overlay can mask it', () => {
        const verdict = adjudicate({ volume: 1, intensity: 1.5 });
        expect(verdict.decision).toBe('skip');
        expect(verdict.executionDose).toBeUndefined();
        expect(verdict.rationale).toContain('outside the supported contract');
    });
});
