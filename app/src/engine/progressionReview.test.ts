import { describe, it, expect } from 'vitest';
import type { IntentBlock } from './blockIntent';
import type { TrainingIntentProfile } from './models';
import type { PerformedExposureFact } from './performedTrainingFacts';
import type { SessionOutcome } from '../responses/outcome';
import type { ProgressResult } from '../observations/progress';
import { evaluateProgressionReview } from './progressionReview';

describe('progressionReview evaluator (ADR-0037 D-CHANGE / D-AUTHORITY)', () => {
    const validBlock: IntentBlock = {
        id: 'block_build_01',
        revision: 1,
        sourcePlanId: 'plan_01',
        sourcePlanRevision: 1,
        dateRange: { startDate: '2026-09-01', endDate: '2026-09-28' },
        objectives: [
            {
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
            },
        ],
        reviewSchedule: {
            reviewCadenceDays: 14,
            nextReviewDate: '2026-09-14',
        },
        progressionContract: {
            targetBinding: {
                objectiveId: 'obj_cycling_tempo',
            },
            variable: 'duration_min',
            unit: 'minutes',
            currentValue: 90,
            permittedRange: { min: 60, max: 120 },
            increment: 10,
            observationWindowDays: 14,
            minCompletedExposures: 3,
            requiredFollowUpCoveragePct: 66,
            reviewCadenceDays: 14,
            reductionAlternative: {
                decrement: 10,
                trigger: 'adverse_response',
            },
        },
    };

    const baseProfile: Pick<TrainingIntentProfile, 'priorities' | 'weeklyCommitment'> = {
        priorities: ['endurance'],
        weeklyCommitment: { minSessions: 3, targetSessions: 5, maxSessions: 6 },
    };

    const mockExposures: PerformedExposureFact[] = [
        {
            performedOccurrenceId: 'occ_01',
            localDate: '2026-09-05',
            modality: 'Cycling',
            confidence: 'exact',
            sourceKinds: ['structured_execution'],
            evidenceTier: 'completedStructuredWorkout',
        },
        {
            performedOccurrenceId: 'occ_02',
            localDate: '2026-09-08',
            modality: 'Cycling',
            confidence: 'exact',
            sourceKinds: ['structured_execution'],
            evidenceTier: 'completedStructuredWorkout',
        },
        {
            performedOccurrenceId: 'occ_03',
            localDate: '2026-09-12',
            modality: 'Cycling',
            confidence: 'exact',
            sourceKinds: ['structured_execution'],
            evidenceTier: 'completedStructuredWorkout',
        },
    ];

    const mockPassedOutcomes: SessionOutcome[] = [
        {
            policyVersion: 'm5.3-outcome-v1',
            sourceSession: { kind: 'execution', id: 's1', date: '2026-09-05' },
            status: 'passed',
            hasFollowUpData: true,
            sourceFacts: { responseIds: ['r1'], tissueRegions: [] },
            override: {},
        },
        {
            policyVersion: 'm5.3-outcome-v1',
            sourceSession: { kind: 'execution', id: 's2', date: '2026-09-08' },
            status: 'passed',
            hasFollowUpData: true,
            sourceFacts: { responseIds: ['r2'], tissueRegions: [] },
            override: {},
        },
        {
            policyVersion: 'm5.3-outcome-v1',
            sourceSession: { kind: 'execution', id: 's3', date: '2026-09-12' },
            status: 'passed',
            hasFollowUpData: true,
            sourceFacts: { responseIds: ['r3'], tissueRegions: [] },
            override: {},
        },
    ];

    const mockImprovingProgress: ProgressResult[] = [
        {
            metricId: 'cycling_ftp',
            comparable: true,
            status: 'meaningful_improvement',
            reasons: ['cleared noise floor'],
            progressPolicyVersion: 'ov-progress-v1',
            absoluteChange: 10,
            percentChange: 3.5,
        },
    ];

    it('returns advance_proposal when all prerequisites, exposure count, follow-up, and outcome metrics are satisfied', () => {
        const result = evaluateProgressionReview({
            intentBlock: validBlock,
            trainingIntentProfile: baseProfile,
            asOfDate: '2026-09-14',
            completedExposures: mockExposures,
            sessionOutcomes: mockPassedOutcomes,
            progressResults: mockImprovingProgress,
        });

        expect(result.action).toBe('advance_proposal');
        expect(result.proposedChange).toBeDefined();
        expect(result.proposedChange?.variable).toBe('duration_min');
        expect(result.proposedChange?.previousValue).toBe(90);
        expect(result.proposedChange?.proposedValue).toBe(100); // 90 + 10 increment
        expect(result.evidenceAudit.exposuresObserved).toBe(3);
        expect(result.evidenceAudit.followUpCoveragePct).toBe(100);
        expect(result.evidenceAudit.adverseResponseCount).toBe(0);
    });

    it('returns hold if block has no progression contract defined', () => {
        const blockWithoutContract: IntentBlock = {
            ...validBlock,
            progressionContract: undefined,
        };
        const result = evaluateProgressionReview({
            intentBlock: blockWithoutContract,
            trainingIntentProfile: baseProfile,
            asOfDate: '2026-09-14',
            completedExposures: mockExposures,
            sessionOutcomes: mockPassedOutcomes,
        });

        expect(result.action).toBe('hold');
        expect(result.reasons).toContain('no_progression_contract_defined');
        expect(result.proposedChange).toBeUndefined();
    });

    it('returns hold if review cadence date has not yet arrived', () => {
        const result = evaluateProgressionReview({
            intentBlock: validBlock,
            trainingIntentProfile: baseProfile,
            asOfDate: '2026-09-10', // nextReviewDate is 2026-09-14
            completedExposures: mockExposures,
            sessionOutcomes: mockPassedOutcomes,
        });

        expect(result.action).toBe('hold');
        expect(result.reasons.some(r => r.includes('review_cadence_not_reached'))).toBe(true);
    });

    it('returns hold if observed completed exposures are fewer than required', () => {
        const result = evaluateProgressionReview({
            intentBlock: validBlock,
            trainingIntentProfile: baseProfile,
            asOfDate: '2026-09-14',
            completedExposures: [mockExposures[0]], // only 1 exposure, 3 required
            sessionOutcomes: [mockPassedOutcomes[0]],
            progressResults: mockImprovingProgress,
        });

        expect(result.action).toBe('hold');
        expect(result.reasons.some(r => r.includes('insufficient_completed_exposures'))).toBe(true);
        expect(result.proposedChange).toBeUndefined();
    });

    it('returns hold if follow-up coverage is below required percentage', () => {
        const outcomesWithoutFollowup: SessionOutcome[] = [
            { ...mockPassedOutcomes[0], hasFollowUpData: false },
            { ...mockPassedOutcomes[1], hasFollowUpData: false },
            { ...mockPassedOutcomes[2], hasFollowUpData: true },
        ]; // 1 of 3 = 33% < 66% required

        const result = evaluateProgressionReview({
            intentBlock: validBlock,
            trainingIntentProfile: baseProfile,
            asOfDate: '2026-09-14',
            completedExposures: mockExposures,
            sessionOutcomes: outcomesWithoutFollowup,
            progressResults: mockImprovingProgress,
        });

        expect(result.action).toBe('hold');
        expect(result.reasons.some(r => r.includes('insufficient_followup_evidence'))).toBe(true);
    });

    it('triggers reduce_proposal when adverse tissue response is observed and reductionAlternative is present', () => {
        const reactiveOutcomes: SessionOutcome[] = [
            mockPassedOutcomes[0],
            mockPassedOutcomes[1],
            {
                ...mockPassedOutcomes[2],
                status: 'reactive',
                hasFollowUpData: true,
            },
        ];

        const result = evaluateProgressionReview({
            intentBlock: validBlock,
            trainingIntentProfile: baseProfile,
            asOfDate: '2026-09-14',
            completedExposures: mockExposures,
            sessionOutcomes: reactiveOutcomes,
            progressResults: mockImprovingProgress,
        });

        expect(result.action).toBe('reduce_proposal');
        expect(result.proposedChange?.previousValue).toBe(90);
        expect(result.proposedChange?.proposedValue).toBe(80); // 90 - 10 decrement
    });

    it('triggers redirect when multiple adverse responses or active restrictions are present', () => {
        const multipleReactive: SessionOutcome[] = [
            mockPassedOutcomes[0],
            { ...mockPassedOutcomes[1], status: 'reactive' },
            { ...mockPassedOutcomes[2], status: 'reactive' },
        ];

        const result = evaluateProgressionReview({
            intentBlock: validBlock,
            trainingIntentProfile: baseProfile,
            asOfDate: '2026-09-14',
            completedExposures: mockExposures,
            sessionOutcomes: multipleReactive,
        });

        expect(result.action).toBe('redirect');
        expect(result.reasons.some(r => r.includes('adverse_safety_response_detected'))).toBe(true);
    });

    it('returns hold when current value is already at permitted maximum', () => {
        const maxedBlock: IntentBlock = {
            ...validBlock,
            progressionContract: {
                ...validBlock.progressionContract!,
                currentValue: 120, // max is 120
            },
        };

        const result = evaluateProgressionReview({
            intentBlock: maxedBlock,
            trainingIntentProfile: baseProfile,
            asOfDate: '2026-09-14',
            completedExposures: mockExposures,
            sessionOutcomes: mockPassedOutcomes,
            progressResults: mockImprovingProgress,
        });

        expect(result.action).toBe('hold');
        expect(result.reasons.some(r => r.includes('max_permitted_value_reached'))).toBe(true);
    });

    it('adverse safety response strictly blocks advance even if outcome metric is improving (Safety Monotonicity)', () => {
        const reactiveOutcomesNoAlternative: SessionOutcome[] = [
            mockPassedOutcomes[0],
            { ...mockPassedOutcomes[1], status: 'reactive' },
            mockPassedOutcomes[2],
        ];
        const blockWithoutReduction: IntentBlock = {
            ...validBlock,
            progressionContract: {
                ...validBlock.progressionContract!,
                reductionAlternative: undefined,
            },
        };

        const result = evaluateProgressionReview({
            intentBlock: blockWithoutReduction,
            trainingIntentProfile: baseProfile,
            asOfDate: '2026-09-14',
            completedExposures: mockExposures,
            sessionOutcomes: reactiveOutcomesNoAlternative,
            progressResults: mockImprovingProgress, // outcome says improving!
        });

        expect(result.action).toBe('hold');
        expect(result.action).not.toBe('advance_proposal');
        expect(result.reasons.some(r => r.includes('adverse_safety_response_blocks_advancement'))).toBe(true);
    });
});
