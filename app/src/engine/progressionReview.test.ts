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
        id: 'block_build_01',
        revision: 1,
        sourcePlanId: 'plan_01',
        sourcePlanRevision: 1,
        dateRange: { startDate: '2026-09-01', endDate: '2026-09-28' },
        objectives: [{
            id: 'obj_cycling_tempo',
            sport: 'cycling',
            adaptationScope: 'tempo_endurance',
            coverageKey: 'sustained_quality',
            intent: 'develop',
            priority: 'must_have',
            doseEnvelope: { min: 60, target: 90, max: 120, unit: 'minutes', floorSemantics: 'hard_floor' },
            successCriteria: {
                evaluationRef: { id: 'eval_spec_01', revision: 1, metricId: 'cycling_ftp' },
                targetTrend: 'improving',
            },
        }],
        reviewSchedule: { reviewCadenceDays: 14, nextReviewDate: '2026-09-14' },
        progressionContract: {
            targetBinding: { objectiveId: 'obj_cycling_tempo' },
            variable: 'duration_min',
            unit: 'minutes',
            currentValue: 90,
            permittedRange: { min: 60, max: 120 },
            increment: 10,
            observationWindowDays: 14,
            minCompletedExposures: 3,
            requiredFollowUpCoveragePct: 66,
            reviewCadenceDays: 14,
            reductionAlternative: { decrement: 10, trigger: 'adverse_response' },
        },
    };

    const exposures: PerformedExposureFact[] = [
        { performedOccurrenceId: 'occ_01', localDate: '2026-09-05', modality: 'Cycling', confidence: 'exact', sourceKinds: ['structured_execution'], evidenceTier: 'completedStructuredWorkout' },
        { performedOccurrenceId: 'occ_02', localDate: '2026-09-08', modality: 'Cycling', confidence: 'exact', sourceKinds: ['structured_execution'], evidenceTier: 'completedStructuredWorkout' },
        { performedOccurrenceId: 'occ_03', localDate: '2026-09-12', modality: 'Cycling', confidence: 'exact', sourceKinds: ['structured_execution'], evidenceTier: 'completedStructuredWorkout' },
    ];

    const outcomes: SessionOutcome[] = exposures.map((exposure, index) => ({
        policyVersion: 'm5.3-outcome-v1',
        sourceSession: { kind: 'execution', id: `s${index + 1}`, date: exposure.localDate },
        status: 'passed',
        hasFollowUpData: true,
        sourceFacts: { responseIds: [`r${index + 1}`], tissueRegions: [] },
        override: {},
    }));

    const improving: ProgressResult = {
        metricId: 'cycling_ftp',
        comparable: true,
        status: 'meaningful_improvement',
        reasons: ['cleared noise floor'],
        progressPolicyVersion: 'ov-progress-v1',
        absoluteChange: 10,
        percentChange: 3.5,
    };

    const boundImproving: BoundProgressEvidence[] = [{
        evaluationRef: { id: 'eval_spec_01', revision: 1, metricId: 'cycling_ftp' },
        result: improving,
    }];

    function coverage(exposure: PerformedExposureFact, key: CoverageCreditFact['coverageKey'] = 'sustained_quality'): CoverageCreditFact[] {
        return [{
            performedOccurrenceId: exposure.performedOccurrenceId,
            coverageSetId: 'evergreen_general',
            coverageKey: key,
            workoutId: 'cycling_controlled_threshold_4x8_01',
            creditKind: 'exact',
            confidence: 1,
            reasonCode: 'exact_workout_identity',
            sourceKinds: ['structured_execution'],
        }];
    }

    function linked(
        exposure: PerformedExposureFact,
        outcome: SessionOutcome | undefined,
        options: {
            coverageKey?: CoverageCreditFact['coverageKey'];
            prescriptionStatus?: LinkedProgressionExposureEvidence['prescription']['status'];
        } = {},
    ): LinkedProgressionExposureEvidence {
        return {
            exposure,
            coverageCredits: coverage(exposure, options.coverageKey),
            prescription: { status: options.prescriptionStatus ?? 'matched_current_target' },
            ...(outcome ? { outcome } : {}),
        };
    }

    const cleanLinked = exposures.map((exposure, index) => linked(exposure, outcomes[index]));

    it('advances only when linked canonical role/prescription/follow-up/outcome evidence all pass', () => {
        const review = evaluateProgressionReview({
            intentBlock: validBlock,
            asOfDate: '2026-09-14',
            linkedExposures: cleanLinked,
            boundProgressResults: boundImproving,
        });
        expect(review.action).toBe('advance_proposal');
        expect(review.proposedChange).toMatchObject({ previousValue: 90, proposedValue: 100 });
        expect(review.proposedChange?.derivedDoseEffects.delta).toBe(10);
        expect(review.evidenceAudit).toMatchObject({
            windowStartDate: '2026-09-01',
            windowEndDate: '2026-09-14',
            exposuresObserved: 3,
            followUpCoveragePct: 100,
        });
    });

    it('holds when there is no progression contract', () => {
        const review = evaluateProgressionReview({
            intentBlock: { ...validBlock, progressionContract: undefined },
            asOfDate: '2026-09-14',
            linkedExposures: cleanLinked,
        });
        expect(review.action).toBe('hold');
        expect(review.reasons).toContain('no_progression_contract_defined');
    });

    it('holds until the authored review date', () => {
        const review = evaluateProgressionReview({
            intentBlock: validBlock,
            asOfDate: '2026-09-10',
            linkedExposures: cleanLinked,
        });
        expect(review.action).toBe('hold');
        expect(review.reasons.some(reason => reason.includes('review_cadence_not_reached'))).toBe(true);
    });

    it('applies the observation-window lower bound instead of counting arbitrarily old work', () => {
        const old = { ...exposures[0], performedOccurrenceId: 'old', localDate: '2026-08-15' };
        const review = evaluateProgressionReview({
            intentBlock: validBlock,
            asOfDate: '2026-09-14',
            linkedExposures: [linked(old, outcomes[0]), cleanLinked[1], cleanLinked[2]],
            boundProgressResults: boundImproving,
        });
        expect(review.action).toBe('hold');
        expect(review.evidenceAudit.exposuresObserved).toBe(2);
        expect(review.reasons.some(reason => reason.includes('insufficient_completed_exposures'))).toBe(true);
    });

    it('does not count same-modality work without exact target coverage', () => {
        const unrelated = linked(exposures[0], outcomes[0], { coverageKey: 'aerobic_volume' });
        const review = evaluateProgressionReview({
            intentBlock: validBlock,
            asOfDate: '2026-09-14',
            linkedExposures: [unrelated, cleanLinked[1], cleanLinked[2]],
            boundProgressResults: boundImproving,
        });
        expect(review.evidenceAudit.candidateExposureCount).toBe(3);
        expect(review.evidenceAudit.exposuresObserved).toBe(2);
        expect(review.evidenceAudit.excludedExposureCount).toBe(1);
        expect(review.action).toBe('hold');
    });

    it('does not count prescription-mismatched or partial work as completed current-target exposure', () => {
        const partial = linked(exposures[0], outcomes[0], { prescriptionStatus: 'partial' });
        const review = evaluateProgressionReview({
            intentBlock: validBlock,
            asOfDate: '2026-09-14',
            linkedExposures: [partial, cleanLinked[1], cleanLinked[2]],
            boundProgressResults: boundImproving,
        });
        expect(review.evidenceAudit.exposuresObserved).toBe(2);
        expect(review.action).toBe('hold');
    });

    it('deduplicates repeated canonical occurrence ids', () => {
        const review = evaluateProgressionReview({
            intentBlock: validBlock,
            asOfDate: '2026-09-14',
            linkedExposures: [cleanLinked[0], cleanLinked[0], cleanLinked[1], cleanLinked[2]],
            boundProgressResults: boundImproving,
        });
        expect(review.evidenceAudit.candidateExposureCount).toBe(3);
        expect(review.evidenceAudit.exposuresObserved).toBe(3);
        expect(review.action).toBe('advance_proposal');
    });

    it('uses only outcomes explicitly linked to qualifying occurrences', () => {
        const unrelatedReactive = linked(
            { ...exposures[0], performedOccurrenceId: 'unrelated', localDate: '2026-09-11' },
            { ...outcomes[0], status: 'reactive' },
            { coverageKey: 'aerobic_volume' },
        );
        const review = evaluateProgressionReview({
            intentBlock: validBlock,
            asOfDate: '2026-09-14',
            linkedExposures: [...cleanLinked, unrelatedReactive],
            boundProgressResults: boundImproving,
        });
        expect(review.evidenceAudit.adverseResponseCount).toBe(0);
        expect(review.action).toBe('advance_proposal');
    });

    it('holds when linked follow-up coverage is below the authored threshold', () => {
        const lowFollowUp = cleanLinked.map((evidence, index) => index === 0
            ? evidence
            : { ...evidence, outcome: { ...evidence.outcome!, hasFollowUpData: false, status: 'unknown' as const } });
        const review = evaluateProgressionReview({
            intentBlock: validBlock,
            asOfDate: '2026-09-14',
            linkedExposures: lowFollowUp,
            boundProgressResults: boundImproving,
        });
        expect(review.evidenceAudit.followUpCoveragePct).toBe(33);
        expect(review.action).toBe('hold');
        expect(review.reasons.some(reason => reason.includes('insufficient_followup_evidence'))).toBe(true);
    });

    it('reduces on authored adverse_response reduction without a hidden adverse-count redirect threshold', () => {
        const twoReactive = cleanLinked.map((evidence, index) => index === 0
            ? evidence
            : { ...evidence, outcome: { ...evidence.outcome!, status: 'reactive' as const } });
        const review = evaluateProgressionReview({
            intentBlock: validBlock,
            asOfDate: '2026-09-14',
            linkedExposures: twoReactive,
            boundProgressResults: boundImproving,
        });
        expect(review.evidenceAudit.adverseResponseCount).toBe(2);
        expect(review.action).toBe('reduce_proposal');
        expect(review.proposedChange?.proposedValue).toBe(80);
    });

    it('redirects only when an explicit redirect trigger is authored', () => {
        const redirectBlock: IntentBlock = {
            ...validBlock,
            progressionContract: {
                ...validBlock.progressionContract!,
                reductionAlternative: undefined,
                redirectCriteria: { triggers: ['adverse_response'] },
            },
        };
        const reactive = cleanLinked.map((evidence, index) => index === 2
            ? { ...evidence, outcome: { ...evidence.outcome!, status: 'reactive' as const } }
            : evidence);
        const review = evaluateProgressionReview({
            intentBlock: redirectBlock,
            asOfDate: '2026-09-14',
            linkedExposures: reactive,
        });
        expect(review.action).toBe('redirect');
        expect(review.reasons[0]).toContain('adverse_response_triggers_redirect');
    });

    it('active restrictions block advancement and redirect only when explicitly authored', () => {
        const held = evaluateProgressionReview({
            intentBlock: validBlock,
            asOfDate: '2026-09-14',
            linkedExposures: cleanLinked,
            activeRestrictions: { hasAdverseTissue: true },
        });
        expect(held.action).toBe('hold');

        const redirectBlock: IntentBlock = {
            ...validBlock,
            progressionContract: {
                ...validBlock.progressionContract!,
                redirectCriteria: { triggers: ['active_restriction'] },
            },
        };
        const redirected = evaluateProgressionReview({
            intentBlock: redirectBlock,
            asOfDate: '2026-09-14',
            linkedExposures: cleanLinked,
            activeRestrictions: { hasAdverseTissue: true },
        });
        expect(redirected.action).toBe('redirect');
    });

    it('holds at the maximum permitted value', () => {
        const review = evaluateProgressionReview({
            intentBlock: {
                ...validBlock,
                progressionContract: { ...validBlock.progressionContract!, currentValue: 120 },
            },
            asOfDate: '2026-09-14',
            linkedExposures: cleanLinked,
            boundProgressResults: boundImproving,
        });
        expect(review.action).toBe('hold');
        expect(review.reasons[0]).toContain('max_permitted_value_reached');
    });

    it('matches the full evaluation reference, not metric id alone', () => {
        const wrongRevision: BoundProgressEvidence[] = [{
            evaluationRef: { id: 'eval_spec_01', revision: 2, metricId: 'cycling_ftp' },
            result: improving,
        }];
        const review = evaluateProgressionReview({
            intentBlock: validBlock,
            asOfDate: '2026-09-14',
            linkedExposures: cleanLinked,
            boundProgressResults: wrongRevision,
        });
        expect(review.action).toBe('hold');
        expect(review.reasons[0]).toContain('bound_outcome_metric_missing');
    });

    it('enforces the authored improving target instead of treating merely non-declining as success', () => {
        const flat: BoundProgressEvidence[] = [{
            evaluationRef: { id: 'eval_spec_01', revision: 1, metricId: 'cycling_ftp' },
            result: { ...improving, status: 'unclear_within_noise', percentChange: 0.2 },
        }];
        const review = evaluateProgressionReview({
            intentBlock: validBlock,
            asOfDate: '2026-09-14',
            linkedExposures: cleanLinked,
            boundProgressResults: flat,
        });
        expect(review.action).toBe('hold');
        expect(review.reasons[0]).toContain('bound_outcome_not_improving');
    });

    it('requires explicit prerequisite evidence when the objective authored prerequisites', () => {
        const block: IntentBlock = {
            ...validBlock,
            objectives: [{
                ...validBlock.objectives[0],
                entryPrerequisites: { requiredPriorExposures: 2, minBaselineDays: 7 },
            }],
        };
        const review = evaluateProgressionReview({
            intentBlock: block,
            asOfDate: '2026-09-14',
            linkedExposures: cleanLinked,
            boundProgressResults: boundImproving,
        });
        expect(review.action).toBe('hold');
        expect(review.reasons).toContain('required_prior_exposure_evidence_missing');
        expect(review.reasons).toContain('required_baseline_duration_evidence_missing');
    });

    it('redirects when an authored maximum block duration has expired', () => {
        const block: IntentBlock = {
            ...validBlock,
            dateRange: { startDate: '2026-08-01', endDate: '2026-09-28' },
            objectives: [{
                ...validBlock.objectives[0],
                exitCriteria: { maxWeeksInBlock: 4 },
            }],
        };
        const review = evaluateProgressionReview({
            intentBlock: block,
            asOfDate: '2026-09-14',
            linkedExposures: cleanLinked,
        });
        expect(review.action).toBe('redirect');
        expect(review.reasons[0]).toContain('max_block_duration_exit_reached');
    });

    it('adverse safety evidence blocks advance even when the outcome metric is improving', () => {
        const block: IntentBlock = {
            ...validBlock,
            progressionContract: { ...validBlock.progressionContract!, reductionAlternative: undefined },
        };
        const reactive = cleanLinked.map((evidence, index) => index === 1
            ? { ...evidence, outcome: { ...evidence.outcome!, status: 'reactive' as const } }
            : evidence);
        const review = evaluateProgressionReview({
            intentBlock: block,
            asOfDate: '2026-09-14',
            linkedExposures: reactive,
            boundProgressResults: boundImproving,
        });
        expect(review.action).toBe('hold');
        expect(review.action).not.toBe('advance_proposal');
        expect(review.reasons[0]).toContain('adverse_safety_response_blocks_advancement');
    });
});
