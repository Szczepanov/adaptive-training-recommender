import { describe, expect, it } from 'vitest';
import type { ClosedLoopFeedbackRecord } from '../feedback/feedbackModels';
import { deriveFeedbackLoopEvidence } from './feedbackLoopEvidence';

function record(overrides: Partial<ClosedLoopFeedbackRecord> = {}): ClosedLoopFeedbackRecord {
    return {
        date: '2026-08-26',
        recommendationRef: { recommendationId: 'rec-123', revision: 1 },
        decision: {
            date: '2026-08-26',
            recommendationRef: { recommendationId: 'rec-123', revision: 1 },
            action: 'accepted',
            reasons: [],
            note: null,
            decidedAt: '2026-08-26T07:30:00Z',
        },
        doseReconciliation: {
            date: '2026-08-26',
            plannedDurationMin: 60,
            actualDurationMin: 60,
            plannedWorkKj: null,
            actualWorkKj: null,
            durationDeltaPct: 0,
            workDeltaPct: null,
            completedZoneDistribution: null,
            holdCompliancePct: null,
            stepOmissionsCount: 0,
        },
        recoveryTrajectory: null,
        regret: null,
        utility: null,
        createdAt: '2026-08-26T07:31:00Z',
        updatedAt: '2026-08-26T07:32:00Z',
        ...overrides,
    };
}

describe('deriveFeedbackLoopEvidence', () => {
    it('returns an explicit zero/null-state summary for no evidence rather than implying zero modification', () => {
        const evidence = deriveFeedbackLoopEvidence([]);
        expect(evidence.recordCount).toBe(0);
        expect(evidence.modificationRatePct).toBeNull();
        expect(evidence.regretRatePct).toBeNull();
        expect(evidence.averageUtilityScore).toBeNull();
        expect(evidence.sourceIds.feedbackRecordIds).toEqual([]);
    });

    it('counts decision actions and computes the modification rate over accepted vs. not', () => {
        const evidence = deriveFeedbackLoopEvidence([
            record({ date: '2026-08-01', decision: { ...record().decision, date: '2026-08-01', action: 'accepted' } }),
            record({ date: '2026-08-02', decision: { ...record().decision, date: '2026-08-02', action: 'scaled_down' } }),
            record({ date: '2026-08-03', decision: { ...record().decision, date: '2026-08-03', action: 'rejected_rest' } }),
        ]);
        expect(evidence.recordCount).toBe(3);
        expect(evidence.decisionActionCounts).toMatchObject({ accepted: 1, scaled_down: 1, rejected_rest: 1 });
        expect(evidence.modificationRatePct).toBeCloseTo(66.67, 1);
    });

    it('excludes inconclusive regret labels from both the numerator and denominator of the regret rate', () => {
        const evidence = deriveFeedbackLoopEvidence([
            record({ regret: { date: '2026-08-26', regretClass: 'optimal_choice', athleteDeclaredRegret: 'none', confidence: 'medium', rationales: [], counterfactualAlternative: null } }),
            record({ regret: { date: '2026-08-26', regretClass: 'overreaching_crash', athleteDeclaredRegret: 'should_have_rested', confidence: 'high', rationales: [], counterfactualAlternative: 'lower dose' } }),
            record({ regret: { date: '2026-08-26', regretClass: 'inconclusive', athleteDeclaredRegret: null, confidence: 'low', rationales: [], counterfactualAlternative: null } }),
        ]);
        expect(evidence.regretClassCounts).toMatchObject({ optimal_choice: 1, overreaching_crash: 1, inconclusive: 1 });
        // 1 regretful out of 2 classified (the inconclusive record is excluded from the denominator).
        expect(evidence.regretRatePct).toBe(50);
    });

    it('averages utility, clarity, hold compliance and duration delta only over records that report them', () => {
        const evidence = deriveFeedbackLoopEvidence([
            record({
                utility: { utilityScore: 4, clarityScore: 5, coachingHelpfulness: 'helpful', feedbackNote: null },
                doseReconciliation: { ...record().doseReconciliation, holdCompliancePct: 90, durationDeltaPct: 10 },
            }),
            record({
                utility: { utilityScore: 2, clarityScore: 3, coachingHelpfulness: 'unhelpful', feedbackNote: null },
                doseReconciliation: { ...record().doseReconciliation, holdCompliancePct: null, durationDeltaPct: null },
            }),
            record({ doseReconciliation: { ...record().doseReconciliation, holdCompliancePct: null, durationDeltaPct: null } }), // no utility, no dose deltas reported
        ]);
        expect(evidence.averageUtilityScore).toBe(3);
        expect(evidence.averageClarityScore).toBe(4);
        expect(evidence.coachingHelpfulnessCounts).toMatchObject({ helpful: 1, unhelpful: 1 });
        expect(evidence.averageHoldCompliancePct).toBe(90);
        expect(evidence.averageDurationDeltaPct).toBe(10);
    });

    it('derives sorted, deduplicated feedback record ids from date and recommendation revision', () => {
        const evidence = deriveFeedbackLoopEvidence([
            record({ date: '2026-08-02', recommendationRef: { recommendationId: 'rec-2', revision: 1 } }),
            record({ date: '2026-08-01', recommendationRef: { recommendationId: 'rec-1', revision: 3 } }),
            record({ date: '2026-08-01', recommendationRef: { recommendationId: 'rec-1', revision: 3 } }),
        ]);
        expect(evidence.sourceIds.feedbackRecordIds).toEqual(['2026-08-01@r3', '2026-08-02@r1']);
    });
});
