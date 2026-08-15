import { describe, expect, it } from 'vitest';
import { evaluateTrainingWithIntent, type ExternalPlanContext } from './rules';
import { resolvePlanningContext } from './planningMode';
import { evaluatePeriodizationPhase } from './periodization';
import { isExternalTemplateId } from './externalSessionProfiles';
import { validateTrainingIntentProfile } from './validation';
import type {
    DailyReadiness, EngineObjectiveInput, ExternalPlanSession,
    SubjectiveInput, TrainingIntentProfile, TrainingSettings, UserContext,
} from './models';

const DATE = '2026-08-18';

function readiness(s: Partial<SubjectiveInput> = {}, o: Partial<EngineObjectiveInput> = {}): DailyReadiness {
    return {
        subjective: {
            readiness: 8, sleepQuality: 8, fatigue: 2, soreness: 2, stress: 2, motivation: 8,
            timeAvailable: 150, painFlag: false, alreadyTrainedToday: false, preferredModalityToday: null, ...s,
        },
        objective: {
            total_steps: 8000, sleep_score: 85, sleep_duration_min: 460, rhr: 48, rhr_7d_avg: 48, rhr_delta: 0,
            hrv_weekly_avg: 60, hrv_last_night: 60, hrv_delta: 0, respiration: 13, body_battery_wake: 85,
            last_3_days_hard_sessions_count: 0, yesterday_training: null, today_training: null,
            sleep_score_delta_7d: 0, rhr_delta_28d: 0, hrv_delta_28d: 0, sleep_score_delta_28d: 0,
            hrv_stdev_28d: 8.5, rhr_stdev_28d: 3.5, sleep_score_stdev_28d: 7.8, ...o,
        },
    };
}

function settings(): TrainingSettings {
    return {
        userId: 'athlete', schemaVersion: 3,
        equipment: { free_weights: true, cable_machine: false, treadmill: false, indoor_bike: true, pullup_bar: true },
        guardrails: { avoid_high_impact: false, avoid_heavy_lower_body: false, avoid_overhead_pressing: false, avoid_heavy_spinal_loading: false },
        defaults: { weekdayMaxMinutes: 180, weekendMaxMinutes: 240, environment: 'either' },
        preferences: { preferActiveRecovery: false },
        migration: { legacyReviewed: true, migratedAt: null },
        createdAt: '', updatedAt: '',
    };
}

function context(): UserContext {
    return {
        goals: { shortTerm: '', midTerm: '', longTerm: '' },
        constraints: { hasCableMachine: false, hasFreeWeights: true, hasTreadmill: false, hasIndoorBike: true, restrictedModalities: [], maxTimeMinutes: 180 },
        preferences: { avoidedModalities: [], deprioritizedModalities: [], preferredModalities: [], conservativeBias: false },
        trainingSettings: settings(),
    };
}

function session(overrides: Partial<ExternalPlanSession> = {}): ExternalPlanSession {
    return {
        id: 'w1-threshold', title: 'Threshold 3x12', priority: 'key',
        placement: { week: 1, preferredDay: 'tuesday', flexibility: 'preferred', ifMissed: 'drop' },
        gating: { modality: 'cycling', intensity: 'hard', durationMin: 60, durationMax: 75, environment: 'either', equipment: [] },
        prescription: { summary: '3x12 at threshold.' },
        ...overrides,
    };
}

const externalPlan = (overrides: Partial<ExternalPlanSession> = {}): ExternalPlanContext =>
    ({ planId: 'autumn-block', revision: 1, session: session(overrides) });

function profile(planningMode: TrainingIntentProfile['planningMode']): TrainingIntentProfile {
    return {
        userId: 'u1', planningMode, priorities: ['balanced_performance'],
        weeklyCommitment: { minSessions: 3, targetSessions: 4, maxSessions: 5 },
        organizationPreference: 'auto', schemaVersion: 1, createdAt: '', updatedAt: '',
    };
}

describe('resolvePlanningContext with externally_planned (D-EXT)', () => {
    const noEvents = evaluatePeriodizationPhase([], DATE);

    it('resolves external only when a session is actually placed today', () => {
        const withSession = resolvePlanningContext(profile('externally_planned'), noEvents, DATE, session());
        expect(withSession.mode).toBe('externally_planned');
        expect(withSession.externalSession?.id).toBe('w1-threshold');
        expect(withSession.externalFallback).toBe(false);
    });

    it('falls back and flags it when the mode is selected but no session is placed', () => {
        const unplanned = resolvePlanningContext(profile('externally_planned'), noEvents, DATE, null);
        // Choosing the mode does not suspend the engine on days the plan leaves empty.
        expect(unplanned.mode).toBe('evergreen');
        expect(unplanned.externalFallback).toBe(true);
    });

    it('ignores a placed session for an athlete who did not choose the mode', () => {
        for (const mode of ['evergreen', 'event_directed'] as const) {
            const resolved = resolvePlanningContext(profile(mode), noEvents, DATE, session());
            expect(resolved.mode, mode).not.toBe('externally_planned');
            expect(resolved.externalSession, mode).toBeNull();
        }
    });

    it('is accepted by the persisted profile validator and nothing else new is', () => {
        const valid = validateTrainingIntentProfile({ ...profile('externally_planned') });
        expect(valid.isValid).toBe(true);
        expect(validateTrainingIntentProfile({ ...profile('evergreen'), planningMode: 'imported' }).isValid).toBe(false);
    });
});

describe('evaluateTrainingWithIntent in externally_planned mode', () => {
    async function evaluate(plan: ExternalPlanContext | null, r: DailyReadiness = readiness()) {
        return evaluateTrainingWithIntent(
            'u1', r, context(), [], DATE, undefined, undefined, null, [], [],
            profile('externally_planned'), null, 'max', plan,
        );
    }

    it('returns the imported session rather than a ranked catalog pick', async () => {
        const recommendation = await evaluate(externalPlan());

        expect(isExternalTemplateId(recommendation.template.id)).toBe(true);
        expect(recommendation.template.title).toBe('Threshold 3x12');
        expect(recommendation.externalPrescription).toMatchObject({
            planId: 'autumn-block', revision: 1, sessionId: 'w1-threshold',
        });
        expect(recommendation.externalVerdict?.decision).toBe('proceed');
    });

    it('ranks nothing, so the audit records no candidate scores', async () => {
        const recommendation = await evaluate(externalPlan());
        expect(recommendation.decisionTrace?.candidateScores).toEqual([]);
    });

    it('shows recovery, not a prescription, when the verdict is not actionable', async () => {
        const exhausted = readiness({ fatigue: 9, soreness: 9, readiness: 1, sleepQuality: 1, motivation: 1 });
        const recommendation = await evaluate(externalPlan(), exhausted);

        expect(recommendation.externalVerdict?.decision).toBe('defer');
        // The imported session must not render as "do this" on a day it was excluded.
        expect(isExternalTemplateId(recommendation.template.id)).toBe(false);
        expect(recommendation.template.category).toBe('Rest');
        expect(recommendation.mode).toBe('recover');
    });

    it('keeps an event actionable and advisory even on a hard readiness day', async () => {
        const exhausted = readiness({ fatigue: 9, soreness: 9, readiness: 1, sleepQuality: 1, motivation: 1 });
        const recommendation = await evaluate(
            externalPlan({ isEvent: true, placement: { week: 1, preferredDay: 'tuesday', flexibility: 'fixed', ifMissed: 'drop' } }),
            exhausted,
        );

        expect(recommendation.externalVerdict?.decision).toBe('advisory');
        expect(isExternalTemplateId(recommendation.template.id)).toBe(true);
        expect(recommendation.externalPrescription?.isEvent).toBe(true);
    });

    it('still ranks a catalog pick when no session is placed today', async () => {
        const recommendation = await evaluate(null);

        expect(isExternalTemplateId(recommendation.template.id)).toBe(false);
        expect(recommendation.externalPrescription).toBeUndefined();
        expect(recommendation.decisionTrace?.candidateScores.length ?? 0).toBeGreaterThan(0);
    });
});
