import { describe, expect, it } from 'vitest';
import type { DailyReadiness, TrainingIntentProfile, UserContext, UserEvent } from './models';
import type { TrainingHistoryProvider } from './trainingHistory';
import { getActiveKnowledgeClaim, KNOWLEDGE_CLAIM_IDS } from '../knowledge/sportsKnowledgeRegistry';
import {
    compareKnowledgeLineage,
    readinessKnowledgeRefs,
    snapshotKnowledgeLineage,
    trainingIntentKnowledgeRefs,
} from './knowledgeLineage';
import { evaluateTrainingWithIntent, type ExternalPlanContext } from './rules';

function readiness(overrides: Partial<DailyReadiness['objective']> = {}): DailyReadiness {
    return {
        subjective: {
            readiness: 8, sleepQuality: 8, fatigue: 2, soreness: 2, stress: 2, motivation: 8,
            timeAvailable: 60, painFlag: false, alreadyTrainedToday: false, preferredModalityToday: null,
        },
        objective: {
            total_steps: null, sleep_score: null, sleep_duration_min: null,
            rhr: null, rhr_7d_avg: null, rhr_delta: null,
            hrv_weekly_avg: null, hrv_last_night: null, hrv_delta: null,
            respiration: null, body_battery_wake: null, last_3_days_hard_sessions_count: 0,
            yesterday_training: null, today_training: null,
            sleep_score_delta_7d: null, rhr_delta_28d: null, hrv_delta_28d: null,
            sleep_score_delta_28d: null, hrv_stdev_28d: null, rhr_stdev_28d: null,
            sleep_score_stdev_28d: null,
            ...overrides,
        },
    };
}

const context = {
    goals: { shortTerm: '', midTerm: '', longTerm: '' },
    constraints: { hasCableMachine: false, hasFreeWeights: true, hasTreadmill: false, hasIndoorBike: true, restrictedModalities: [], maxTimeMinutes: 180 },
    preferences: {
        avoidedModalities: [], deprioritizedModalities: [], preferredModalities: [], conservativeBias: false,
    },
} as unknown as UserContext;

describe('recommendation knowledge lineage', () => {
    it('freezes active claim versions in deterministic deduplicated order', () => {
        const ids = [
            KNOWLEDGE_CLAIM_IDS.readinessModeThresholds,
            KNOWLEDGE_CLAIM_IDS.hrvContextualMonitoring,
            KNOWLEDGE_CLAIM_IDS.readinessModeThresholds,
        ];
        const lineage = snapshotKnowledgeLineage(ids);
        expect(lineage.map(item => item.claimId)).toEqual([...new Set(ids)].sort());
        lineage.forEach(item => expect(item.version).toBe(getActiveKnowledgeClaim(item.claimId).version));
    });

    it('fails closed when runtime policy emits an unknown claim id', () => {
        expect(() => snapshotKnowledgeLineage(['missing.claim'])).toThrow(/Unknown sports knowledge claim/);
    });

    it('reports knowledge drift separately from absent legacy lineage', () => {
        const claim = getActiveKnowledgeClaim(KNOWLEDGE_CLAIM_IDS.hrvContextualMonitoring);
        expect(compareKnowledgeLineage(undefined)).toEqual({ status: 'lineage_unavailable', drift: [] });
        expect(compareKnowledgeLineage([{ claimId: claim.id, version: claim.version }]))
            .toEqual({ status: 'matches_current', drift: [] });
        expect(compareKnowledgeLineage([{ claimId: claim.id, version: claim.version + 1 }]))
            .toMatchObject({ status: 'drifted', drift: [{ claimId: claim.id, recordedVersion: claim.version + 1, currentVersion: claim.version }] });
    });

    it('attributes only covered objective-readiness families that have applicable inputs', () => {
        const refs = readinessKnowledgeRefs(readiness({
            hrv_delta: -8, hrv_delta_28d: -4, hrv_stdev_28d: 6,
            last_3_days_hard_sessions_count: 2,
        }), context);
        expect(refs).toEqual(expect.arrayContaining([
            KNOWLEDGE_CLAIM_IDS.hrvContextualMonitoring,
            KNOWLEDGE_CLAIM_IDS.hrvGuidedTrainingConditional,
            KNOWLEDGE_CLAIM_IDS.readinessPhysiologicalStrainModel,
            KNOWLEDGE_CLAIM_IDS.readinessAcuteBiometricFloors,
            KNOWLEDGE_CLAIM_IDS.trainingStressRecoveryBalance,
            KNOWLEDGE_CLAIM_IDS.recentHardReadinessPenalty,
            KNOWLEDGE_CLAIM_IDS.readinessModeThresholds,
        ]));
        expect(refs).not.toContain('readiness.subjective_mode_thresholds');
    });

    it('does not attribute 28-day-only biometric context when metricStrain short-circuits without a 7-day anchor', () => {
        const refs = readinessKnowledgeRefs(readiness({
            hrv_delta_28d: -8,
            rhr_delta_28d: 5,
            sleep_score_delta_28d: -12,
            respiration_delta_28d: 1.5,
            hrv_stdev_28d: 6,
            rhr_stdev_28d: 2,
            sleep_score_stdev_28d: 5,
            respiration_mad_28d: 0.8,
        }), context);
        expect(refs).toEqual([]);
    });

    it('adds taper lineage only for an active endurance taper and spacing lineage only when history exists', () => {
        const focusEvent = { category: 'cycling_event' } as UserEvent;
        const noHistory = trainingIntentKnowledgeRefs({
            history: [], periodization: { focusEvent, phase: { taperActive: true } },
        });
        expect(noHistory).toEqual(expect.arrayContaining([
            KNOWLEDGE_CLAIM_IDS.endurancePreEventTaper,
            KNOWLEDGE_CLAIM_IDS.taperWindowsVolumePolicy,
            KNOWLEDGE_CLAIM_IDS.taperSharpeningPolicy,
        ]));
        expect(noHistory).not.toContain(KNOWLEDGE_CLAIM_IDS.rollingHardDensityCap);

        const withHistory = trainingIntentKnowledgeRefs({
            history: [{}], periodization: { focusEvent, phase: { taperActive: false } },
        });
        expect(withHistory).toEqual(expect.arrayContaining([
            KNOWLEDGE_CLAIM_IDS.rollingHardDensityCap,
            KNOWLEDGE_CLAIM_IDS.hardLowerBodySpacing,
            KNOWLEDGE_CLAIM_IDS.strengthEnduranceAdjacency,
        ]));
        expect(withHistory).not.toContain(KNOWLEDGE_CLAIM_IDS.endurancePreEventTaper);
    });

    it('merges training-intent lineage into external-plan recommendations', async () => {
        const focusEvent = {
            id: 'race',
            title: 'Road Race',
            date: '2026-08-31',
            priority: 'A',
            lifecycle: 'scheduled',
            category: 'cycling_event',
            demandProfile: {
                aerobicEndurance: 0.9, thresholdPower: 0.8, vo2MaxPower: 0.5, repeatedSurges: 0.8,
                sprintPower: 0.4, fatigueResistance: 0.9, neuromuscular: 0.4,
            },
        } as UserEvent;
        const externalPlan: ExternalPlanContext = {
            planId: 'autumn-block',
            revision: 1,
            contentHash: 'hash-1',
            session: {
                id: 'w1-threshold',
                title: 'Threshold 3x12',
                priority: 'key',
                placement: { week: 1, preferredDay: 'monday', flexibility: 'preferred', ifMissed: 'drop' },
                gating: { modality: 'cycling', intensity: 'hard', durationMin: 60, durationMax: 75, environment: 'either', equipment: [] },
                prescription: { summary: '3x12 at threshold.' },
            } as unknown as ExternalPlanContext['session'],
        };
        const trainingIntentProfile: TrainingIntentProfile = {
            userId: 'u1',
            planningMode: 'externally_planned',
            priorities: ['balanced_performance'],
            weeklyCommitment: { minSessions: 3, targetSessions: 4, maxSessions: 5 },
            organizationPreference: 'auto',
            schemaVersion: 1,
            createdAt: '',
            updatedAt: '',
        };
        const inMemoryHistoryProvider: TrainingHistoryProvider = {
            reconstruct: async () => [],
            getSnapshot: async (_u, throughDateExclusive, windowDays) => ({
                throughDateExclusive,
                windowDays,
                completedEvents: [],
                exposures: [],
                sourceStates: {
                    activities: { status: 'AVAILABLE', revision: 'test' },
                    recommendations: { status: 'AVAILABLE', revision: 'test' },
                    manualTraining: { status: 'MISSING' },
                },
                generatedAt: new Date().toISOString(),
                revision: 'test',
            }),
        };
        const rec = await evaluateTrainingWithIntent(
            'u1', readiness(), context, [focusEvent], '2026-08-31', undefined, inMemoryHistoryProvider, null, [], [],
            trainingIntentProfile, null, 'max', externalPlan,
        );
        expect(rec.knowledgeRefs).toEqual(expect.arrayContaining([
            KNOWLEDGE_CLAIM_IDS.enduranceIntensityDistribution,
            KNOWLEDGE_CLAIM_IDS.internalLoadIntensityBands,
            KNOWLEDGE_CLAIM_IDS.internalResponseStrainModel,
        ]));
    });
});
