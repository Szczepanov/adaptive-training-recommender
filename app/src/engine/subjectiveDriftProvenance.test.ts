import { describe, expect, it } from 'vitest';
import type { Recommendation } from './models';
import { TEMPLATES } from './templates';
import { POLICY_VERSION } from './policy';
import { buildRecommendationAudit } from './provenance';
import { buildTrainingHistorySnapshot } from './trainingHistorySnapshot';
import type { SubjectiveDriftDecisionEvidence } from './simulation/subjectiveDriftEvidence';

function snapshot() {
    return buildTrainingHistorySnapshot(
        '2026-08-16', 7,
        { status: 'AVAILABLE', revision: 'activities-r1', data: [] },
        { status: 'AVAILABLE', revision: 'recommendations-r1', data: [] },
        '2026-08-16T08:00:00Z',
    );
}
function recommendation(): Recommendation {
    const template = TEMPLATES.find(item => item.category === 'Easy Endurance');
    if (!template) throw new Error('Test fixture requires an easy template');
    return {
        template, mode: 'modify', rationale: 'Not part of normalized audit.',
        envelopes: { safety: { clinicalFlagActive: false, restrictedModalities: [] }, plan: { maxAllowableTier: 'Easy', taperActive: false } },
        decisionTrace: {
            policyVersion: POLICY_VERSION,
            candidateScores: [{ templateId: template.id, utilityScore: 1, excludedReasons: [] }],
            droppedContributorObjectives: [],
        },
    };
}
const evidence: SubjectiveDriftDecisionEvidence = {
    estimatorId: 'subjective-baseline-v1-mean-stdev-7-28',
    estimatorPolicyVersion: 'subjective-drift-score-v1-equal-weights-strain-z-cap',
    historyThroughDateExclusive: '2026-08-16',
    recentRecordedDays: 6, longRecordedDays: 23, contribution: 1.25,
    perMetricContributions: { readiness: 0.25, sleepQuality: 0.2, fatigue: 0.3, soreness: 0.25, mentalStress: 0.15, motivation: 0.1 },
    modeWithoutDrift: 'train', modeWithDrift: 'modify', decisionRelevant: true, totalDecisionScoreWithDrift: 1.4,
};

describe('Phase 9.7 recommendation audit', () => {
    it('preserves the exact legacy audit shape when no drift evidence is supplied', () => {
        const audit = buildRecommendationAudit(recommendation(), snapshot(), '2026-08-16T09:00:00Z');
        expect(audit).not.toBeNull();
        expect(Object.keys(audit!)).not.toContain('subjectiveDrift');
    });
    it('stores only compact normalized drift provenance when evidence is explicitly supplied', () => {
        const audit = buildRecommendationAudit(recommendation(), snapshot(), '2026-08-16T09:00:00Z', evidence);
        expect(audit?.subjectiveDrift).toEqual({
            estimatorId: evidence.estimatorId, estimatorPolicyVersion: evidence.estimatorPolicyVersion,
            historyThroughDateExclusive: evidence.historyThroughDateExclusive,
            recentRecordedDays: evidence.recentRecordedDays, longRecordedDays: evidence.longRecordedDays,
            contribution: evidence.contribution, perMetricContributions: evidence.perMetricContributions, decisionRelevant: true,
        });
        const serialized = JSON.stringify(audit);
        expect(serialized).not.toContain('modeWithoutDrift');
        expect(serialized).not.toContain('modeWithDrift');
        expect(serialized).not.toContain('totalDecisionScoreWithDrift');
        expect(serialized).not.toContain('Not part of normalized audit');
    });
});
