import { describe, expect, it } from 'vitest';
import type { ProgressResult } from '../observations/progress';
import type { SessionOutcome } from '../responses/outcome';
import type { CoverageCreditFact, PerformedExposureFact } from './performedTrainingFacts';
import type { IntentBlock } from './blockIntent';
import {
    evaluateProgressionReview,
    type BoundProgressEvidence,
    type LinkedProgressionExposureEvidence,
} from './progressionReview';

describe('progressionReview evaluator (ADR-0037 D-CHANGE / D-AUTHORITY)', () => {
    const validBlock: IntentBlock = {
        id: 'block_build_01', revision: 1, sourcePlanId: 'plan_01', sourcePlanRevision: 1,
        dateRange: { startDate: '2026-09-01', endDate: '2026-09-28' },
        objectives: [{
            id: 'obj_cycling_tempo', sport: 'cycling', adaptationScope: 'threshold_quality', coverageKey: 'sustained_quality',
            intent: 'develop', priority: 'must_have',
            doseEnvelope: { min: 60, target: 90, max: 120, unit: 'minutes', floorSemantics: 'hard_floor' },
            knowledgeLineage: ['claim_threshold_progression_v1'],
            successCriteria: { evaluationRef: { id: 'eval_spec_01', revision: 1, metricId: 'cycling_ftp' }, targetTrend: 'improving' },
            exitCriteria: { maxWeeksInBlock: 4, stagnationReviewAfterWeeks: 3 },
        }],
        reviewSchedule: { reviewCadenceDays: 14, nextReviewDate: '2026-09-14' },
        progressionContract: {
            targetBinding: { objectiveId: 'obj_cycling_tempo' }, variable: 'duration_min', unit: 'minutes', currentValue: 90,
            permittedRange: { min: 60, max: 120 }, increment: 10,
            knowledgeLineage: ['policy_duration_progression_v1'],
            observationWindowDays: 14, minCompletedExposures: 3, requiredFollowUpCoveragePct: 66, reviewCadenceDays: 14,
            reductionAlternative: { decrement: 10, trigger: 'adverse_response' },
        },
    };

    const exposures: PerformedExposureFact[] = [
        { performedOccurrenceId: 'occ_01', localDate: '2026-09-05', modality: 'Cycling', confidence: 'exact', sourceKinds: ['structured_execution'], evidenceTier: 'completedStructuredWorkout' },
        { performedOccurrenceId: 'occ_02', localDate: '2026-09-08', modality: 'Cycling', confidence: 'exact', sourceKinds: ['structured_execution'], evidenceTier: 'completedStructuredWorkout' },
        { performedOccurrenceId: 'occ_03', localDate: '2026-09-12', modality: 'Cycling', confidence: 'exact', sourceKinds: ['structured_execution'], evidenceTier: 'completedStructuredWorkout' },
    ];

    const outcomes: SessionOutcome[] = exposures.map((exposure, index) => ({
        policyVersion: 'm5.3-outcome-v1', sourceSession: { kind: 'execution', id: `s${index + 1}`, date: exposure.localDate },
        status: 'passed', hasFollowUpData: true, sourceFacts: { responseIds: [`r${index + 1}`], tissueRegions: [] }, override: {},
    }));

    const improving: ProgressResult = {
        metricId: 'cycling_ftp', comparable: true, status: 'meaningful_improvement', reasons: ['cleared noise floor'],
        progressPolicyVersion: 'ov-progress-v1', absoluteChange: 10, percentChange: 3.5,
    };
    const boundImproving: BoundProgressEvidence[] = [{ evaluationRef: { id: 'eval_spec_01', revision: 1, metricId: 'cycling_ftp' }, result: improving }];

    function coverage(exposure: PerformedExposureFact, key: CoverageCreditFact['coverageKey'] = 'sustained_quality'): CoverageCreditFact[] {
        return [{ performedOccurrenceId: exposure.performedOccurrenceId, coverageSetId: 'evergreen_general', coverageKey: key,
            workoutId: 'cycling_controlled_threshold_4x8_01', creditKind: 'exact', confidence: 1,
            reasonCode: 'exact_workout_identity', sourceKinds: ['structured_execution'] }];
    }

    function linked(exposure: PerformedExposureFact, outcome: SessionOutcome | undefined, options: {
        coverageKey?: CoverageCreditFact['coverageKey'];
        prescriptionStatus?: LinkedProgressionExposureEvidence['prescription']['status'];
        prescriptionValue?: number;
        sourcePlanRevision?: number;
        deliveredDoseFraction?: number;
    } = {}): LinkedProgressionExposureEvidence {
        return {
            exposure,
            coverageCredits: coverage(exposure, options.coverageKey),
            ...(options.deliveredDoseFraction === undefined ? {} : { deliveredDoseFraction: options.deliveredDoseFraction }),
            prescription: {
                status: options.prescriptionStatus ?? 'matched_current_target',
                sourcePlanRevision: options.sourcePlanRevision ?? 1,
                variable: 'duration_min', unit: 'minutes', value: options.prescriptionValue ?? 90,
            },
            ...(outcome ? { outcome } : {}),
        };
    }
    const cleanLinked = exposures.map((exposure, index) => linked(exposure, outcomes[index]));

    it('advances only when linked canonical role/current-dose/follow-up/outcome evidence all pass', () => {
        const review = evaluateProgressionReview({ intentBlock: validBlock, asOfDate: '2026-09-14', linkedExposures: cleanLinked, boundProgressResults: boundImproving });
        expect(review.action).toBe('advance_proposal');
        expect(review.proposedChange).toMatchObject({ previousValue: 90, proposedValue: 100 });
        expect(review.evidenceAudit).toMatchObject({ windowStartDate: '2026-09-01', windowEndDate: '2026-09-14', exposuresObserved: 3, followUpCoveragePct: 100, ambiguousOccurrenceCount: 0 });
    });

    it('holds when there is no progression contract', () => {
        const review = evaluateProgressionReview({ intentBlock: { ...validBlock, progressionContract: undefined }, asOfDate: '2026-09-14', linkedExposures: cleanLinked });
        expect(review.action).toBe('hold');
        expect(review.reasons).toContain('no_progression_contract_defined');
    });

    it('holds until review date and redirects at the authored block boundary', () => {
        expect(evaluateProgressionReview({ intentBlock: validBlock, asOfDate: '2026-09-10', linkedExposures: cleanLinked }).action).toBe('hold');
        const ended = evaluateProgressionReview({ intentBlock: validBlock, asOfDate: '2026-09-28', linkedExposures: cleanLinked });
        expect(ended.action).toBe('redirect');
        expect(ended.reasons).toContain('block_interval_ended_requires_review');
    });

    it('applies the observation-window lower bound instead of counting arbitrarily old work', () => {
        const old = { ...exposures[0], performedOccurrenceId: 'old', localDate: '2026-08-15' };
        const review = evaluateProgressionReview({ intentBlock: validBlock, asOfDate: '2026-09-14', linkedExposures: [linked(old, outcomes[0]), cleanLinked[1], cleanLinked[2]], boundProgressResults: boundImproving });
        expect(review.evidenceAudit.exposuresObserved).toBe(2);
        expect(review.action).toBe('hold');
    });

    it('does not count same-modality work without exact target coverage', () => {
        const unrelated = linked(exposures[0], outcomes[0], { coverageKey: 'aerobic_volume' });
        const review = evaluateProgressionReview({ intentBlock: validBlock, asOfDate: '2026-09-14', linkedExposures: [unrelated, cleanLinked[1], cleanLinked[2]], boundProgressResults: boundImproving });
        expect(review.evidenceAudit.roleRelevantExposureCount).toBe(2);
        expect(review.evidenceAudit.exposuresObserved).toBe(2);
        expect(review.action).toBe('hold');
    });

    it('accepts an explicitly allowed substitution only when its dose qualification is proven', () => {
        const block: IntentBlock = { ...validBlock, objectives: [{ ...validBlock.objectives[0], allowedSubstitutions: [{ targetCoverageKey: 'sustained_quality', allowedCoverageKeys: ['outdoor_event_specific'], minDoseFraction: 0.9 }] }] };
        const review = evaluateProgressionReview({ intentBlock: block, asOfDate: '2026-09-14', linkedExposures: [linked(exposures[0], outcomes[0], { coverageKey: 'outdoor_event_specific', deliveredDoseFraction: 0.9 }), cleanLinked[1], cleanLinked[2]], boundProgressResults: boundImproving });
        expect(review.action).toBe('advance_proposal');
        const underDose = evaluateProgressionReview({ intentBlock: block, asOfDate: '2026-09-14', linkedExposures: [linked(exposures[0], outcomes[0], { coverageKey: 'outdoor_event_specific', deliveredDoseFraction: 0.8 }), cleanLinked[1], cleanLinked[2]], boundProgressResults: boundImproving });
        expect(underDose.evidenceAudit.roleRelevantExposureCount).toBe(3);
        expect(underDose.evidenceAudit.exposuresObserved).toBe(2);
        expect(underDose.action).toBe('hold');
    });

    it('does not count stale dose or source-plan revision as current-target evidence', () => {
        const review = evaluateProgressionReview({ intentBlock: validBlock, asOfDate: '2026-09-14', linkedExposures: [linked(exposures[0], outcomes[0], { prescriptionValue: 80 }), linked(exposures[1], outcomes[1], { sourcePlanRevision: 2 }), cleanLinked[2]], boundProgressResults: boundImproving });
        expect(review.evidenceAudit.exposuresObserved).toBe(1);
        expect(review.action).toBe('hold');
    });

    it('retains partial target attempts for safety but not completed-dose credit', () => {
        const partialExposure: PerformedExposureFact = { ...exposures[0], performedOccurrenceId: 'occ_partial', localDate: '2026-09-11' };
        const partialReactive = linked(partialExposure, { ...outcomes[0], sourceSession: { ...outcomes[0].sourceSession, id: 'partial', date: '2026-09-11' }, status: 'reactive' }, { prescriptionStatus: 'partial' });
        const review = evaluateProgressionReview({ intentBlock: validBlock, asOfDate: '2026-09-14', linkedExposures: [partialReactive, ...cleanLinked], boundProgressResults: boundImproving });
        expect(review.evidenceAudit.exposuresObserved).toBe(3);
        expect(review.evidenceAudit.adverseResponseCount).toBe(1);
        expect(review.action).toBe('reduce_proposal');
    });

    it('requires follow-up evidence for partial target attempts too', () => {
        const partialExposure: PerformedExposureFact = { ...exposures[0], performedOccurrenceId: 'occ_partial_missing', localDate: '2026-09-11' };
        const review = evaluateProgressionReview({ intentBlock: validBlock, asOfDate: '2026-09-14', linkedExposures: [linked(partialExposure, undefined, { prescriptionStatus: 'partial' }), ...cleanLinked], boundProgressResults: boundImproving });
        expect(review.evidenceAudit.followUpCoveragePct).toBe(75);
        expect(review.evidenceAudit.unknownResponseCount).toBe(1);
        expect(review.action).toBe('hold');
    });

    it('deduplicates identical evidence and fails closed on conflicting duplicate evidence', () => {
        const duplicate = evaluateProgressionReview({ intentBlock: validBlock, asOfDate: '2026-09-14', linkedExposures: [cleanLinked[0], cleanLinked[0], cleanLinked[1], cleanLinked[2]], boundProgressResults: boundImproving });
        expect(duplicate.evidenceAudit.ambiguousOccurrenceCount).toBe(0);
        expect(duplicate.action).toBe('advance_proposal');
        const conflict = evaluateProgressionReview({ intentBlock: validBlock, asOfDate: '2026-09-14', linkedExposures: [cleanLinked[0], linked(exposures[0], outcomes[0], { prescriptionValue: 80 }), cleanLinked[1], cleanLinked[2]], boundProgressResults: boundImproving });
        expect(conflict.evidenceAudit.ambiguousOccurrenceCount).toBe(1);
        expect(conflict.action).toBe('hold');
        expect(conflict.reasons[0]).toContain('conflicting_duplicate_occurrence_evidence');
    });

    it('unrelated outcomes do not influence target safety', () => {
        const unrelatedExposure: PerformedExposureFact = { ...exposures[0], performedOccurrenceId: 'unrelated', localDate: '2026-09-11' };
        const unrelatedReactive = linked(unrelatedExposure, { ...outcomes[0], sourceSession: { ...outcomes[0].sourceSession, id: 'unrelated', date: '2026-09-11' }, status: 'reactive' }, { coverageKey: 'aerobic_volume' });
        const review = evaluateProgressionReview({ intentBlock: validBlock, asOfDate: '2026-09-14', linkedExposures: [...cleanLinked, unrelatedReactive], boundProgressResults: boundImproving });
        expect(review.evidenceAudit.adverseResponseCount).toBe(0);
        expect(review.action).toBe('advance_proposal');
    });

    it('holds on insufficient/unknown follow-up evidence', () => {
        const lowFollowUp = cleanLinked.map((evidence, index) => index === 0 ? evidence : { ...evidence, outcome: { ...evidence.outcome!, hasFollowUpData: false, status: 'unknown' as const } });
        const low = evaluateProgressionReview({ intentBlock: validBlock, asOfDate: '2026-09-14', linkedExposures: lowFollowUp, boundProgressResults: boundImproving });
        expect(low.evidenceAudit.followUpCoveragePct).toBe(33);
        expect(low.action).toBe('hold');
        const unknown = cleanLinked.map((evidence, index) => index === 0 ? { ...evidence, outcome: { ...evidence.outcome!, status: 'unknown' as const, hasFollowUpData: true } } : evidence);
        const unknownReview = evaluateProgressionReview({ intentBlock: validBlock, asOfDate: '2026-09-14', linkedExposures: unknown, boundProgressResults: boundImproving });
        expect(unknownReview.evidenceAudit.unknownResponseCount).toBe(1);
        expect(unknownReview.action).toBe('hold');
    });

    it('uses authored adverse fallback without hidden response-count thresholds', () => {
        const reactive = cleanLinked.map((evidence, index) => index === 0 ? evidence : { ...evidence, outcome: { ...evidence.outcome!, status: 'reactive' as const } });
        const reduced = evaluateProgressionReview({ intentBlock: validBlock, asOfDate: '2026-09-14', linkedExposures: reactive, boundProgressResults: boundImproving });
        expect(reduced.action).toBe('reduce_proposal');
        expect(reduced.proposedChange?.proposedValue).toBe(80);
        const redirectBlock: IntentBlock = { ...validBlock, progressionContract: { ...validBlock.progressionContract!, reductionAlternative: undefined, redirectCriteria: { triggers: ['adverse_response'] } } };
        expect(evaluateProgressionReview({ intentBlock: redirectBlock, asOfDate: '2026-09-14', linkedExposures: reactive }).action).toBe('redirect');
    });

    it('active restrictions block advancement and redirect only when explicitly authored', () => {
        expect(evaluateProgressionReview({ intentBlock: validBlock, asOfDate: '2026-09-14', linkedExposures: cleanLinked, activeRestrictions: { hasAdverseTissue: true } }).action).toBe('hold');
        const redirectBlock: IntentBlock = { ...validBlock, progressionContract: { ...validBlock.progressionContract!, reductionAlternative: undefined, redirectCriteria: { triggers: ['active_restriction'] } } };
        expect(evaluateProgressionReview({ intentBlock: redirectBlock, asOfDate: '2026-09-14', linkedExposures: cleanLinked, activeRestrictions: { hasAdverseTissue: true } }).action).toBe('redirect');
    });

    it('holds at max and matches the full evaluation reference', () => {
        const atMax = evaluateProgressionReview({ intentBlock: { ...validBlock, progressionContract: { ...validBlock.progressionContract!, currentValue: 120 } }, asOfDate: '2026-09-14', linkedExposures: cleanLinked.map(evidence => ({ ...evidence, prescription: { ...evidence.prescription, value: 120 } })), boundProgressResults: boundImproving });
        expect(atMax.action).toBe('hold');
        const wrongRevision: BoundProgressEvidence[] = [{ evaluationRef: { id: 'eval_spec_01', revision: 2, metricId: 'cycling_ftp' }, result: improving }];
        const wrong = evaluateProgressionReview({ intentBlock: validBlock, asOfDate: '2026-09-14', linkedExposures: cleanLinked, boundProgressResults: wrongRevision });
        expect(wrong.action).toBe('hold');
        expect(wrong.reasons[0]).toContain('bound_outcome_metric_missing');
    });

    it('enforces improving outcome and does not treat unclear-within-noise as maintenance proof', () => {
        const flat: BoundProgressEvidence[] = [{ evaluationRef: { id: 'eval_spec_01', revision: 1, metricId: 'cycling_ftp' }, result: { ...improving, status: 'unclear_within_noise', percentChange: 0.2 } }];
        expect(evaluateProgressionReview({ intentBlock: validBlock, asOfDate: '2026-09-14', linkedExposures: cleanLinked, boundProgressResults: flat }).action).toBe('hold');
        const maintenanceBlock: IntentBlock = { ...validBlock, objectives: [{ ...validBlock.objectives[0], intent: 'maintain', successCriteria: { evaluationRef: { id: 'eval_spec_01', revision: 1, metricId: 'cycling_ftp' }, targetTrend: 'stable', acceptableDeclineTolerancePct: 3 } }] };
        const maintenance = evaluateProgressionReview({ intentBlock: maintenanceBlock, asOfDate: '2026-09-14', linkedExposures: cleanLinked, boundProgressResults: flat });
        expect(maintenance.action).toBe('hold');
        expect(maintenance.reasons[0]).toBe('stable_target_unclear_within_noise');
    });

    it('requires explicit prerequisite evidence and respects max block duration', () => {
        const prereqBlock: IntentBlock = { ...validBlock, objectives: [{ ...validBlock.objectives[0], entryPrerequisites: { requiredPriorExposures: 2, minBaselineDays: 7 } }] };
        const prereq = evaluateProgressionReview({ intentBlock: prereqBlock, asOfDate: '2026-09-14', linkedExposures: cleanLinked, boundProgressResults: boundImproving });
        expect(prereq.reasons).toContain('required_prior_exposure_evidence_missing');
        const expired: IntentBlock = { ...validBlock, dateRange: { startDate: '2026-08-01', endDate: '2026-09-28' }, objectives: [{ ...validBlock.objectives[0], exitCriteria: { maxWeeksInBlock: 4 } }] };
        expect(evaluateProgressionReview({ intentBlock: expired, asOfDate: '2026-09-14', linkedExposures: cleanLinked }).action).toBe('redirect');
    });

    it('adverse safety evidence blocks advance even with an improving outcome', () => {
        const block: IntentBlock = { ...validBlock, progressionContract: { ...validBlock.progressionContract!, reductionAlternative: undefined, redirectCriteria: { triggers: ['active_restriction'] } } };
        const reactive = cleanLinked.map((evidence, index) => index === 1 ? { ...evidence, outcome: { ...evidence.outcome!, status: 'reactive' as const } } : evidence);
        const review = evaluateProgressionReview({ intentBlock: block, asOfDate: '2026-09-14', linkedExposures: reactive, boundProgressResults: boundImproving });
        expect(review.action).toBe('hold');
        expect(review.action).not.toBe('advance_proposal');
    });
});
