import { describe, it, expect } from 'vitest';
import { evaluateTrainingWithIntent } from '../rules';
import { deriveFactsFromOccurrence } from '../performedTrainingFacts';
import { evaluateStrengthSpacingStatus } from '../strengthSpacingPolicy';
import { ENRICHED_TEMPLATES_BY_ID } from '../templates';
import type { TrainingHistoryProvider, CompletedExposure } from '../trainingHistory';
import type { DailyReadiness, UserContext, NormalizedGarminActivity } from '../models';

function createContext(overrides: Partial<UserContext['constraints']> = {}): UserContext {
    return {
        goals: { shortTerm: 'General Fitness', midTerm: '', longTerm: '' },
        constraints: {
            hasCableMachine: false,
            hasFreeWeights: true,
            hasTreadmill: false,
            hasIndoorBike: true,
            restrictedModalities: [],
            maxTimeMinutes: 90,
            ...overrides,
        },
        preferences: {
            avoidedModalities: [],
            deprioritizedModalities: [],
            preferredModalities: ['Cycling', 'Strength'],
            conservativeBias: false,
            preferredRecoveryStyle: 'mixed',
        },
    };
}

function createGreenReadiness(): DailyReadiness {
    return {
        subjective: {
            readiness: 8,
            sleepQuality: 8,
            fatigue: 2,
            soreness: 2,
            stress: 3,
            motivation: 8,
            timeAvailable: 90,
            painFlag: false,
            alreadyTrainedToday: false,
            preferredModalityToday: null,
        },
        objective: {
            total_steps: 8500,
            sleep_score: 85,
            sleep_duration_min: 460,
            rhr: 48,
            rhr_7d_avg: 49,
            rhr_delta: -1,
            hrv_weekly_avg: 55,
            hrv_last_night: 58,
            hrv_delta: 3,
            respiration: 13.5,
            body_battery_wake: 90,
            last_3_days_hard_sessions_count: 0,
            yesterday_training: null,
            today_training: null,
            sleep_score_delta_7d: 0,
            rhr_delta_28d: 0,
            hrv_delta_28d: 0,
            sleep_score_delta_28d: 0,
            hrv_stdev_28d: 8,
            rhr_stdev_28d: 3,
            sleep_score_stdev_28d: 8,
        },
    };
}

/**
 * Production incident fixture: Activity 24197884873 on 2026-09-01.
 * 77-minute strength_training activity with low aerobic TE (0.2), low load (2.9), easy tag.
 */
const PRODUCTION_GARMIN_FIXTURE_2026_09_01: NormalizedGarminActivity = {
    activityId: '24197884873',
    date: '2026-09-01',
    type: 'strength_training',
    durationMin: 77,
    averageHr: 85,
    trainingEffectAerobic: 0.2,
    trainingEffectAnaerobic: 0,
    activityTrainingLoad: 2.9,
    intensityTag: 'easy',
};

describe('Strength Recommendation Canonical Occurrence Cutover (Incident Reproduction)', () => {
    const context = createContext();
    const readiness = createGreenReadiness();

    it('2026-09-02 engine does NOT recommend Full-body Strength following 2026-09-01 Garmin strength session', async () => {
        // Completed exposure representing the 2026-09-01 Garmin activity
        const garminExposure: CompletedExposure = {
            date: '2026-09-01',
            modality: 'Strength',
            trainingRecordLike: {
                type: 'strength_training',
                duration_min: 77,
                training_effect: 0.2,
                intensity_tag: 'easy',
            },
            costProfile: { systemic: 0.2, cardiovascular: 0.05, lowerBody: 0.2, upperBody: 0.2, impactTissue: 0.1, neuromuscular: 0.15 },
        };

        const historyProvider: TrainingHistoryProvider = {
            reconstruct: async () => [garminExposure],
        };

        const rec = await evaluateTrainingWithIntent(
            'u1',
            readiness,
            context,
            [],
            '2026-09-02',
            undefined,
            historyProvider,
        );

        // Crucial invariant: The engine must NOT recommend Reduced Full-body Strength Maintenance (str_full_03)
        // or any Full-body / Lower-body strength candidate simply because weekly full-body coverage appears unfulfilled.
        expect(rec.template.category).not.toBe('Full-body Strength');
        expect(rec.template.category).not.toBe('Lower-body Strength');
        expect(rec.template.id).not.toBe('str_full_03');
        expect(rec.template.id).not.toBe('str_full_01');

        // Instead, the engine recommends a non-conflicting session (e.g. aerobic endurance or upper body or mobility)
        expect(['Easy Endurance', 'Moderate Endurance', 'Upper-body Strength', 'Mobility/Recovery']).toContain(rec.template.category);
    });

    it('App-logged structured strength on 2026-09-01 also suppresses Day +1 full-body candidate', async () => {
        const appStructuredExposure: CompletedExposure = {
            date: '2026-09-01',
            modality: 'Strength',
            category: 'Full-body Strength',
            templateId: 'str_full_01',
            workoutId: 'strength_full_body_maintenance_01',
            trainingRecordLike: {
                type: 'Strength Full-body Strength',
                duration_min: 45,
                training_effect: 0,
                intensity_tag: 'moderate',
            },
            costProfile: { systemic: 0.45, cardiovascular: 0.1, lowerBody: 0.55, upperBody: 0.5, impactTissue: 0.2, neuromuscular: 0.4 },
        };

        const historyProvider: TrainingHistoryProvider = {
            reconstruct: async () => [appStructuredExposure],
        };

        const rec = await evaluateTrainingWithIntent(
            'u1',
            readiness,
            context,
            [],
            '2026-09-02',
            undefined,
            historyProvider,
        );

        expect(rec.template.category).not.toBe('Full-body Strength');
        expect(rec.template.category).not.toBe('Lower-body Strength');
    });

    it('Allows full-body strength on Day +2 (2026-09-03) after 48 hours spacing has elapsed', async () => {
        const garminExposure: CompletedExposure = {
            date: '2026-09-01',
            modality: 'Strength',
            trainingRecordLike: {
                type: 'strength_training',
                duration_min: 77,
                training_effect: 0.2,
                intensity_tag: 'easy',
            },
            costProfile: { systemic: 0.2, cardiovascular: 0.05, lowerBody: 0.2, upperBody: 0.2, impactTissue: 0.1, neuromuscular: 0.15 },
        };

        const historyProvider: TrainingHistoryProvider = {
            reconstruct: async () => [garminExposure],
        };

        const rec = await evaluateTrainingWithIntent(
            'u1',
            readiness,
            context,
            [],
            '2026-09-03', // 2 days later (diff = 2)
            undefined,
            historyProvider,
        );

        // On Day +2 with green readiness, strength is once again admissible
        // (the 48h spacing restriction no longer blocks full-body candidates).
        expect(rec).toBeDefined();
    });

    it('derives canonical facts from production 77min Garmin fixture and restricts next-day full-body candidates', () => {
        const occurrence = {
            schemaVersion: 1,
            performedOccurrenceId: 'pto-incident-prod-1',
            userId: 'u1',
            status: 'active' as const,
            localDate: '2026-09-01',
            modality: 'Strength',
            sourceRefs: [{ kind: 'provider_activity' as const, provider: 'garmin', activityId: '24197884873' }],
            reconciliation: { state: 'single_source' as const },
            createdAt: '2026-09-02T06:30:20Z',
            updatedAt: '2026-09-02T06:30:20Z',
        };

        const hydrated = {
            provider: {
                activityId: '24197884873',
                provider: 'garmin',
                modality: 'Strength' as const,
                durationMin: 77,
                garminActivity: PRODUCTION_GARMIN_FIXTURE_2026_09_01,
            },
        };

        const { exposure, coverageCredits } = deriveFactsFromOccurrence(occurrence, hydrated);

        // 1. Exposure represents the physical session as Strength with 77 min observed duration
        expect(exposure.modality).toBe('Strength');
        expect(exposure.durationMin).toBe(77);
        expect(exposure.localDate).toBe('2026-09-01');

        // 2. Generic Garmin strength does NOT falsely satisfy exact full-body weekly role
        expect(coverageCredits[0].creditKind).toBe('none');
        expect(coverageCredits[0].reasonCode).toBe('generic_modality_only');

        // 3. Spacing policy correctly recognizes the recent strength exposure and restricts Day +1 full-body
        const candidateFullBody = ENRICHED_TEMPLATES_BY_ID.get('str_full_03')!;

        const spacingStatus = evaluateStrengthSpacingStatus([exposure], '2026-09-02', candidateFullBody);
        expect(spacingStatus.isRestricted).toBe(true);
        expect(spacingStatus.reasonCode).toBe('RECENT_STRENGTH_SPACING_VIOLATION');
        expect(spacingStatus.rationale).toContain('2026-09-01');
    });
});
