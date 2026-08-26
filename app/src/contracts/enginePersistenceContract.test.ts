import { describe, expect, it } from 'vitest';
import { validateRecommendationAuditContract, validatePersistedRecommendationContract } from './enginePersistenceContract';
import { evaluateTrainingWithIntent } from '../engine/rules';
import { buildRecommendationAudit } from '../engine/provenance';
import { parseDailyRecommendation } from '../persistence/parsers/trainingHistory';
import type { DailyReadiness, EngineObjectiveInput, SubjectiveInput, UserContext } from '../engine/models';
import type { TrainingHistorySnapshot } from '../engine/trainingHistorySnapshot';

describe('EnginePersistenceContract', () => {
    const baseSubjective: SubjectiveInput = {
        readiness: 8,
        sleepQuality: 8,
        fatigue: 2,
        soreness: 2,
        stress: 2,
        motivation: 8,
        timeAvailable: 60,
        painFlag: false,
        alreadyTrainedToday: false,
        preferredModalityToday: null,
    };

    const baseObjective: EngineObjectiveInput = {
        sleep_score: 85,
        sleep_duration_min: 480,
        rhr: 48,
        rhr_7d_avg: 49,
        rhr_delta: -1,
        hrv_weekly_avg: 65,
        hrv_last_night: 68,
        hrv_delta: 3,
        hrv_stdev_28d: null,
        rhr_stdev_28d: null,
        sleep_score_stdev_28d: null,
        respiration: 14.2,
        respiration_delta: 0,
        respiration_delta_28d: 0,
        respiration_mad_28d: null,
        body_battery_wake: 85,
        last_3_days_hard_sessions_count: 0,
        yesterday_training: null,
        today_training: null,
        sleep_score_delta_7d: 2,
        rhr_delta_28d: -2,
        hrv_delta_28d: 4,
        sleep_score_delta_28d: 3,
        total_steps: 8000,
        steps_7d_avg: 8500,
        steps_28d_avg: 8400,
        steps_delta_7d: -500,
        steps_delta_28d: -400,
    };

    const baseReadiness: DailyReadiness = {
        subjective: baseSubjective,
        objective: baseObjective,
    };

    const baseContext: UserContext = {
        preferences: {
            preferredModalities: ['Running', 'Cycling'],
            deprioritizedModalities: [],
            avoidedModalities: [],
            conservativeBias: false,
        },
        constraints: {
            hasCableMachine: false,
            hasFreeWeights: false,
            hasTreadmill: false,
            hasIndoorBike: false,
            maxTimeMinutes: 60,
            restrictedModalities: [],
            restrictedCategories: [],
            impliedGuardrails: [],
        },
        goals: { shortTerm: '', midTerm: '', longTerm: '' },
    };

    const mockHistoryProvider = {
        reconstruct: async () => [],
    };

    const mockHistorySnapshot: TrainingHistorySnapshot = {
        revision: 'rev-2026-08-26',
        generatedAt: '2026-08-26T06:00:00Z',
        throughDateExclusive: '2026-08-26',
        windowDays: 7,
        sourceStates: {
            activities: { status: 'AVAILABLE', revision: 'r1' },
            recommendations: { status: 'AVAILABLE', revision: 'r1' },
            manualTraining: { status: 'AVAILABLE', revision: 'r1' },
        },
        exposures: [],
        completedEvents: [],
    };

    it('generates recommendations that strictly satisfy persistence contracts', async () => {
        const rec = await evaluateTrainingWithIntent(
            'user-1',
            baseReadiness,
            baseContext,
            [],
            '2026-08-26',
            undefined,
            mockHistoryProvider,
        );

        expect(rec.template).toBeDefined();
        expect(rec.decisionTrace).toBeDefined();

        const audit = buildRecommendationAudit(rec, mockHistorySnapshot);
        expect(audit).not.toBeNull();
        const auditContractResult = validateRecommendationAuditContract(audit);
        expect(auditContractResult.valid).toBe(true);
        expect(auditContractResult.errors).toEqual([]);

        const persistedDoc = {
            userId: 'user-1',
            date: '2026-08-26',
            templateId: rec.template.id,
            templateTitle: rec.template.title,
            category: rec.template.category,
            modality: rec.template.modality,
            mode: rec.mode,
            rationale: rec.rationale,
            revision: 1,
            recommendationAudit: audit!,
        };

        const recContractResult = validatePersistedRecommendationContract(persistedDoc);
        expect(recContractResult.valid).toBe(true);

        const parseResult = parseDailyRecommendation(persistedDoc, 'users/user-1/daily_recommendations/2026-08-26');
        expect(parseResult.status).toBe('AVAILABLE');
        if (parseResult.status === 'AVAILABLE') {
            expect(parseResult.data.templateId).toBe(rec.template.id);
        }
    });
});
