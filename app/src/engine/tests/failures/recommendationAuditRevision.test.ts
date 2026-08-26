import { describe, it, expect } from 'vitest';
import { buildRecommendationAudit } from '../../provenance';
import type { Recommendation } from '../../models';
import type { TrainingHistorySnapshot } from '../../trainingHistorySnapshot';

describe('Recommendation audit revision anchoring', () => {
    it('records the immutable training-history revision used by the decision', () => {
        const recommendation: Recommendation = {
            template: {
                id: 'run-tempo-30',
                category: 'Hard Endurance',
                modality: 'Running',
                durationMin: 30,
                durationMax: 45,
                title: 'Tempo Run',
                description: 'Tempo run',
                requiredEquipment: [],
                environment: 'either',
                safetyTags: [],
                systemicCost: 4,
                objectiveTransferable: true,
            },
            mode: 'train',
            rationale: 'Baseline is stable, load approved.',
            envelopes: {
                safety: { clinicalFlagActive: false, restrictedModalities: [] },
                plan: { maxAllowableTier: 'Hard', taperActive: false },
            },
            telemetry: {
                metricStrain: { acuteDeviation: 0, multiDayDrift: 0, totalMetricStrain: 0 },
                contextPenalties: { recentHardSessions: 0, bodyBatteryDeficit: 0, sleepFloorPenalty: 0, conservativeBias: 0 },
                subjectiveDrift: 0,
                totalDecisionScore: 0,
            },
            decisionTrace: { policyVersion: 'test-v1', candidateScores: [], droppedContributorObjectives: [] },
        };

        const historySnapshot: TrainingHistorySnapshot = {
            throughDateExclusive: '2026-08-26',
            windowDays: 7,
            completedEvents: [],
            exposures: [],
            sourceStates: {
                activities: { status: 'AVAILABLE', revision: 'r1' },
                recommendations: { status: 'AVAILABLE', revision: 'r1' },
                manualTraining: { status: 'AVAILABLE', revision: 'r1' },
            },
            generatedAt: new Date().toISOString(),
            revision: 'rev_12345',
        };

        const audit = buildRecommendationAudit(recommendation, historySnapshot);
        expect(audit).not.toBeNull();
        expect(audit?.decisionContextRevision).toBe('rev_12345');
        expect(audit?.policyVersion).toBe('test-v1');
    });
});
