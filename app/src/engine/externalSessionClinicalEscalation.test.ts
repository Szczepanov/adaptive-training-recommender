import { describe, expect, it } from 'vitest';
import { adjudicateExternalSession } from './externalSession';
import { evaluateReadinessAndSafetyEnvelope } from './rules';
import type {
    DailyReadiness,
    EngineObjectiveInput,
    ExternalPlanSession,
    PlannedDose,
    SubjectiveInput,
    TrainingSettings,
    UserContext,
} from './models';

const DATE = '2026-09-01';
const FULL_DOSE: PlannedDose = { volume: 1, intensity: 1 };

function subjective(overrides: Partial<SubjectiveInput> = {}): SubjectiveInput {
    return {
        readiness: 8,
        sleepQuality: 8,
        fatigue: 2,
        soreness: 2,
        stress: 2,
        motivation: 8,
        timeAvailable: 120,
        painFlag: false,
        alreadyTrainedToday: false,
        preferredModalityToday: null,
        ...overrides,
    };
}

function objective(): EngineObjectiveInput {
    return {
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

function session(overrides: Partial<ExternalPlanSession> = {}): ExternalPlanSession {
    return {
        id: 'event-1',
        title: 'Target event',
        priority: 'key',
        placement: {
            week: 1,
            preferredDay: 'tuesday',
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
        prescription: { summary: 'Race.' },
        ...overrides,
    };
}

function redFlagReadiness(): DailyReadiness {
    return {
        subjective: subjective({
            painFlag: true,
            clinicalEnvelopeSources: ['red_flag'],
            redFlagFindings: [{
                category: 'systemic_infection',
                source: 'explicit_checkin',
                description: 'Red-flag symptom reported.',
            }],
        }),
        objective: objective(),
    };
}

function adjudicate(s: ExternalPlanSession) {
    const readiness = redFlagReadiness();
    const ctx = context();
    return adjudicateExternalSession(
        s,
        readiness,
        ctx,
        evaluateReadinessAndSafetyEnvelope(readiness, ctx, DATE),
        FULL_DOSE,
        DATE,
    );
}

describe('SEP-C4 imported-session clinical escalation', () => {
    it('skips an imported training session instead of merely deferring it as readiness recovery', () => {
        const verdict = adjudicate(session({ isEvent: false }));
        expect(verdict.decision).toBe('skip');
        expect(verdict.executionDose).toBeUndefined();
        expect(verdict.rationale).toContain('training prescriptions are paused');
    });

    it('keeps an event advisory but removes permissive start language under a red flag', () => {
        const verdict = adjudicate(session({ isEvent: true }));
        expect(verdict.decision).toBe('advisory');
        expect(verdict.executionDose).toBeUndefined();
        expect(verdict.rationale).toContain('cannot clear you to start');
        expect(verdict.rationale).toContain('medical evaluation');
        expect(verdict.rationale).toContain('acute chest pain/pressure');
        expect(verdict.rationale).toContain('unexplained shortness of breath');
        expect(verdict.rationale).toContain('fainting/near-fainting');
        expect(verdict.rationale).toContain('new neurologic symptoms');
        expect(verdict.rationale).not.toContain('decision to start is yours');
    });
});
