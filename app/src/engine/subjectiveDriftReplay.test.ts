import { describe, expect, it } from 'vitest';
import type { DailyRecommendation, RecommendationAudit } from './models';
import { POLICY_VERSION } from './policy';
import { replayRecommendationAudit } from './replay';
import type { SubjectiveDriftAudit } from './subjectiveDriftAudit';

function driftAudit(overrides: Partial<SubjectiveDriftAudit> = {}): SubjectiveDriftAudit {
    return {
        estimatorId: 'subjective-baseline-v1-mean-stdev-7-28',
        estimatorPolicyVersion: 'subjective-drift-score-v1-equal-weights-strain-z-cap',
        historyThroughDateExclusive: '2026-08-16', recentRecordedDays: 7, longRecordedDays: 28,
        contribution: 1.2,
        perMetricContributions: { readiness: 0.2, sleepQuality: 0.2, fatigue: 0.2, soreness: 0.2, mentalStress: 0.2, motivation: 0.2 },
        decisionRelevant: true, ...overrides,
    };
}
function recommendation(subjectiveDrift?: unknown): DailyRecommendation {
    const baseAudit: RecommendationAudit = {
        policyVersion: POLICY_VERSION, evaluatedAt: '2026-08-16T06:00:00Z', decisionContextRevision: 'history-v1:test', safetyStatus: 'complete',
        history: { completedEventCount: 0, unmatchedEventCount: 0, sourceStatuses: { activities: 'AVAILABLE', recommendations: 'AVAILABLE', manualTraining: 'MISSING' } },
        envelope: { safetyRestrictedModalityCount: 0, planMaxAllowableTier: 'Easy' },
        candidateScores: [{ templateId: 'easy-ride', utilityScore: 1, excludedReasons: [] }], droppedContributorObjectives: [],
    };
    const audit = subjectiveDrift === undefined ? baseAudit : ({ ...baseAudit, subjectiveDrift } as RecommendationAudit);
    return {
        userId: 'u1', date: '2026-08-16', templateId: 'easy-ride', templateTitle: 'Easy ride', category: 'Easy Endurance', modality: 'Cycling',
        mode: 'modify', rationale: 'test', schemaVersion: 3, createdAt: '', updatedAt: '', recommendationAudit: audit,
        adherence: { respondedAt: null, followed: null, actualModality: null, actualDurationMin: null, skipped: false, notes: null },
    };
}

describe('Phase 9.7 subjective drift replay', () => {
    it('preserves legacy replay when subjective drift provenance is absent', () => {
        expect(replayRecommendationAudit(recommendation())).toEqual({ reproducible: true, policyMatchesCurrent: true, errors: [] });
    });
    it('accepts compact normalized drift provenance that reconciles', () => {
        const result = replayRecommendationAudit(recommendation(driftAudit()));
        expect(result.reproducible).toBe(true);
        expect(result.errors).toEqual([]);
    });
    it('rejects a history boundary that leaks past the decision boundary', () => {
        const result = replayRecommendationAudit(recommendation(driftAudit({ historyThroughDateExclusive: '2026-08-17' })));
        expect(result.reproducible).toBe(false);
        expect(result.errors.some(error => error.includes('history boundary'))).toBe(true);
    });
    it('rejects non-reconciling components and non-canonical metric maps', () => {
        const mismatch = replayRecommendationAudit(recommendation(driftAudit({ contribution: 9 })));
        expect(mismatch.reproducible).toBe(false);
        expect(mismatch.errors.some(error => error.includes('does not reconcile'))).toBe(true);

        const malformed = { ...driftAudit(), perMetricContributions: { readiness: 1.2 } };
        const missingMetrics = replayRecommendationAudit(recommendation(malformed));
        expect(missingMetrics.reproducible).toBe(false);
        expect(missingMetrics.errors.some(error => error.includes('canonical metric set'))).toBe(true);
    });
});
