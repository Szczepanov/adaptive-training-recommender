import { describe, expect, it } from 'vitest';
import {
    validateIntentBlock,
    validatePlanIntentBlocks,
    type IntentBlock,
} from './blockIntent';

describe('blockIntent validation (ADR-0037 D-INTENT)', () => {
    const validBlock: IntentBlock = {
        id: 'block_2026_09_cycling_build',
        revision: 1,
        sourcePlanId: 'plan_cycling_advanced_01',
        sourcePlanRevision: 1,
        dateRange: { startDate: '2026-09-07', endDate: '2026-10-04' },
        objectives: [
            {
                id: 'obj_threshold_dev',
                sport: 'cycling',
                adaptationScope: 'threshold_quality',
                coverageKey: 'sustained_quality',
                intent: 'develop',
                priority: 'must_have',
                doseEnvelope: { min: 60, target: 90, max: 120, unit: 'minutes', floorSemantics: 'hard_floor' },
                knowledgeLineage: ['claim_threshold_interval_adaptation_v1'],
                protectedRoles: [
                    { kind: 'coverage_role', coverageKey: 'sustained_quality' },
                    { kind: 'session', sessionId: 'session_threshold_anchor' },
                ],
                allowedSubstitutions: [{
                    targetCoverageKey: 'sustained_quality',
                    allowedCoverageKeys: ['outdoor_event_specific'],
                    minDoseFraction: 0.9,
                    rationale: 'Equivalent authored quality role when exact coverage qualifies.',
                }],
                successCriteria: {
                    evaluationRef: { id: 'eval_threshold', revision: 1, metricId: 'cycling_ftp' },
                    minCompletedExposures: 3,
                    targetTrend: 'improving',
                },
                entryPrerequisites: {
                    requiredPriorExposures: 2,
                    minBaselineDays: 7,
                    prohibitedTissueSeverities: ['limit', 'exclude'],
                },
                exitCriteria: { maxWeeksInBlock: 4, stagnationReviewAfterWeeks: 3 },
            },
            {
                id: 'obj_strength_maint',
                sport: 'strength',
                adaptationScope: 'strength_maintenance',
                coverageKey: 'primary_strength',
                intent: 'maintain',
                priority: 'should_have',
                doseEnvelope: { min: 1, target: 2, max: 2, unit: 'sessions', floorSemantics: 'soft_floor' },
                knowledgeLineage: ['claim_strength_maintenance_v1'],
                successCriteria: {
                    evaluationRef: { id: 'eval_strength', revision: 1, metricId: 'strength_maintenance' },
                    targetTrend: 'stable',
                    acceptableDeclineTolerancePct: 3,
                },
            },
        ],
        reviewSchedule: { reviewCadenceDays: 14, nextReviewDate: '2026-09-21' },
        progressionContract: {
            targetBinding: { objectiveId: 'obj_threshold_dev' },
            variable: 'duration_min',
            unit: 'minutes',
            currentValue: 90,
            permittedRange: { min: 60, max: 120 },
            increment: 10,
            knowledgeLineage: ['policy_progression_duration_v1'],
            observationWindowDays: 14,
            minCompletedExposures: 3,
            requiredFollowUpCoveragePct: 66,
            reviewCadenceDays: 14,
            reductionAlternative: { decrement: 10, trigger: 'adverse_response' },
        },
        title: 'Cycling Build & Strength Maintenance',
    };

    it('accepts a fully valid develop + maintain block', () => {
        expect(validateIntentBlock(validBlock)).toEqual({ valid: true, issues: [] });
    });

    it('rejects missing source identity and invalid calendar/review dates', () => {
        const invalid = {
            ...validBlock,
            sourcePlanId: '',
            sourcePlanRevision: 0,
            dateRange: { startDate: '2026-02-30', endDate: '2026-10-04' },
            reviewSchedule: { reviewCadenceDays: 0, nextReviewDate: '2026-99-01' },
        } as IntentBlock;
        const codes = validateIntentBlock(invalid).issues.map(issue => issue.code);
        expect(codes).toContain('MISSING_SOURCE_PLAN_ID');
        expect(codes).toContain('INVALID_SOURCE_PLAN_REVISION');
        expect(codes).toContain('INVALID_DATE_RANGE');
        expect(codes).toContain('INVALID_BLOCK_REVIEW_CADENCE');
        expect(codes).toContain('INVALID_NEXT_REVIEW_DATE');
    });

    it('rejects unsupported typed objective vocabulary and duplicate objective ids', () => {
        const invalid: IntentBlock = {
            ...validBlock,
            objectives: [
                { ...validBlock.objectives[0], sport: 'rowing' as never, adaptationScope: 'free_text_scope' as never },
                { ...validBlock.objectives[0], coverageKey: 'anything' as never },
            ],
        };
        const codes = validateIntentBlock(invalid).issues.map(issue => issue.code);
        expect(codes).toContain('DUPLICATE_OBJECTIVE_ID');
        expect(codes).toContain('INVALID_OBJECTIVE_SPORT');
        expect(codes).toContain('INVALID_ADAPTATION_SCOPE');
        expect(codes).toContain('INVALID_OBJECTIVE_COVERAGE_KEY');
    });

    it('rejects free-form/invalid protected references instead of treating labels as exact roles', () => {
        const invalid: IntentBlock = {
            ...validBlock,
            objectives: [{
                ...validBlock.objectives[0],
                protectedRoles: [
                    { kind: 'coverage_role', coverageKey: 'made_up_role' as never },
                    { kind: 'session', sessionId: '' },
                    { kind: 'session', sessionId: '' },
                ],
            }],
        };
        const codes = validateIntentBlock(invalid).issues.map(issue => issue.code);
        expect(codes).toContain('INVALID_PROTECTED_COVERAGE_ROLE');
        expect(codes).toContain('INVALID_PROTECTED_SESSION_ID');
        expect(codes).toContain('DUPLICATE_PROTECTED_ROLE');
    });

    it('requires objective and progression knowledge lineage plus non-empty success criteria', () => {
        const invalid: IntentBlock = {
            ...validBlock,
            objectives: [{
                ...validBlock.objectives[0],
                knowledgeLineage: [],
                successCriteria: {},
            }],
            progressionContract: {
                ...validBlock.progressionContract!,
                targetBinding: { objectiveId: 'obj_threshold_dev' },
                knowledgeLineage: [],
            },
        };
        const codes = validateIntentBlock(invalid).issues.map(issue => issue.code);
        expect(codes.filter(code => code === 'MISSING_KNOWLEDGE_LINEAGE').length).toBeGreaterThanOrEqual(2);
        expect(codes).toContain('EMPTY_SUCCESS_CRITERIA');
    });

    it('rejects unsupported dose units and non-finite/inverted envelopes', () => {
        const invalid: IntentBlock = {
            ...validBlock,
            objectives: [{
                ...validBlock.objectives[0],
                doseEnvelope: {
                    ...validBlock.objectives[0].doseEnvelope,
                    min: Number.NaN,
                    target: 130,
                    max: 120,
                    unit: 'gallons' as never,
                },
            }],
        };
        const codes = validateIntentBlock(invalid).issues.map(issue => issue.code);
        expect(codes).toContain('UNSUPPORTED_DOSE_UNIT');
        expect(codes).toContain('INVALID_DOSE_MIN');
        expect(codes).toContain('INVERTED_DOSE_BOUNDS_TARGET_MAX');
    });

    it('validates substitutions, prerequisites and prospective outcome criteria', () => {
        const invalid: IntentBlock = {
            ...validBlock,
            objectives: [{
                ...validBlock.objectives[0],
                allowedSubstitutions: [{ targetCoverageKey: 'aerobic_volume', allowedCoverageKeys: [], minDoseFraction: 1.2 }],
                entryPrerequisites: { requiredPriorExposures: 1.5 },
                successCriteria: { targetTrend: 'improving' },
            }],
        };
        const codes = validateIntentBlock(invalid).issues.map(issue => issue.code);
        expect(codes).toContain('SUBSTITUTION_TARGET_MISMATCH');
        expect(codes).toContain('EMPTY_SUBSTITUTION_CANDIDATES');
        expect(codes).toContain('INVALID_SUBSTITUTION_MIN_DOSE_FRACTION');
        expect(codes).toContain('INVALID_REQUIRED_PRIOR_EXPOSURES');
        expect(codes).toContain('OUTCOME_CRITERIA_REQUIRE_EVALUATION_REF');
    });

    it('requires measured maintenance to declare an explicit decline tolerance', () => {
        const invalid: IntentBlock = {
            ...validBlock,
            objectives: [{
                ...validBlock.objectives[1],
                successCriteria: {
                    evaluationRef: { id: 'eval_strength', revision: 1, metricId: 'strength_maintenance' },
                    targetTrend: 'stable',
                },
            }],
        };
        expect(validateIntentBlock(invalid).issues.some(issue => issue.code === 'MAINTENANCE_OUTCOME_REQUIRES_TOLERANCE')).toBe(true);
    });

    it('rejects dangling targets, arbitrary progression paths/units and non-finite current values', () => {
        const invalid: IntentBlock = {
            ...validBlock,
            progressionContract: {
                ...validBlock.progressionContract!,
                targetBinding: { objectiveId: 'missing' },
                variable: 'watts.anywhere' as never,
                unit: 'joules',
                currentValue: Number.NaN,
            },
        };
        const codes = validateIntentBlock(invalid).issues.map(issue => issue.code);
        expect(codes).toContain('DANGLING_PROGRESSION_TARGET_OBJECTIVE');
        expect(codes).toContain('UNSUPPORTED_PROGRESSION_VARIABLE');
        expect(codes).toContain('INVALID_CURRENT_VALUE');
    });

    it('requires positive integer evidence windows/cadence and non-zero follow-up coverage', () => {
        const invalid: IntentBlock = {
            ...validBlock,
            progressionContract: {
                ...validBlock.progressionContract!,
                observationWindowDays: 14.5,
                minCompletedExposures: 2.5,
                requiredFollowUpCoveragePct: 0,
                reviewCadenceDays: 7,
            },
        };
        const codes = validateIntentBlock(invalid).issues.map(issue => issue.code);
        expect(codes).toContain('INVALID_OBSERVATION_WINDOW');
        expect(codes).toContain('INVALID_MIN_COMPLETED_EXPOSURES');
        expect(codes).toContain('INVALID_FOLLOW_UP_COVERAGE_PCT');
        expect(codes).toContain('PROGRESSION_REVIEW_CADENCE_MISMATCH');
    });

    it('requires an authored reduction or redirect fallback and rejects ambiguous adverse actions', () => {
        const missingFallback: IntentBlock = {
            ...validBlock,
            progressionContract: {
                ...validBlock.progressionContract!,
                reductionAlternative: undefined,
                redirectCriteria: undefined,
            },
        };
        expect(validateIntentBlock(missingFallback).issues.some(issue => issue.code === 'MISSING_PROGRESSION_FALLBACK')).toBe(true);

        const ambiguous: IntentBlock = {
            ...validBlock,
            progressionContract: {
                ...validBlock.progressionContract!,
                redirectCriteria: { triggers: ['adverse_response'] },
            },
        };
        expect(validateIntentBlock(ambiguous).issues.some(issue => issue.code === 'AMBIGUOUS_ADVERSE_RESPONSE_ACTION')).toBe(true);

        const withoutTriggers = {
            ...validBlock,
            progressionContract: {
                ...validBlock.progressionContract!,
                reductionAlternative: undefined,
                redirectCriteria: {} as never,
            },
        };
        const withoutTriggersValidation = validateIntentBlock(withoutTriggers);
        expect(withoutTriggersValidation.valid).toBe(false);
        const codes = withoutTriggersValidation.issues.map(issue => issue.code);
        expect(codes).toContain('EMPTY_REDIRECT_TRIGGERS');
        expect(codes).toContain('MISSING_PROGRESSION_FALLBACK');
    });

    it('rejects reductions that need hidden range clamping', () => {
        const invalid: IntentBlock = {
            ...validBlock,
            progressionContract: {
                ...validBlock.progressionContract!,
                currentValue: 65,
                reductionAlternative: { decrement: 10, trigger: 'adverse_response' },
            },
        };
        expect(validateIntentBlock(invalid).issues.some(issue => issue.code === 'REDUCTION_DECREMENT_EXCEEDS_RANGE')).toBe(true);
    });

    it('rejects progression ranges outside the authored objective envelope', () => {
        const invalid: IntentBlock = {
            ...validBlock,
            progressionContract: { ...validBlock.progressionContract!, permittedRange: { min: 50, max: 130 } },
        };
        expect(validateIntentBlock(invalid).issues.some(issue => issue.code === 'PROGRESSION_RANGE_EXCEEDS_OBJECTIVE_ENVELOPE')).toBe(true);
    });

    it('rejects overlapping blocks only within the same source plan', () => {
        const blockA: IntentBlock = { ...validBlock, id: 'block_a', dateRange: { startDate: '2026-09-01', endDate: '2026-09-15' }, reviewSchedule: { reviewCadenceDays: 7, nextReviewDate: '2026-09-08' }, progressionContract: undefined };
        const blockB: IntentBlock = { ...validBlock, id: 'block_b', dateRange: { startDate: '2026-09-10', endDate: '2026-09-25' }, reviewSchedule: { reviewCadenceDays: 7, nextReviewDate: '2026-09-17' }, progressionContract: undefined };
        const otherPlan: IntentBlock = { ...blockB, id: 'block_other', sourcePlanId: 'plan_other' };

        expect(validatePlanIntentBlocks([blockA, blockB]).issues.some(issue => issue.code === 'OVERLAPPING_INTENT_BLOCKS')).toBe(true);
        expect(validatePlanIntentBlocks([blockA, otherPlan]).issues.some(issue => issue.code === 'OVERLAPPING_INTENT_BLOCKS')).toBe(false);
    });

    it('does not throw during plan overlap validation when a block has a malformed date', () => {
        const malformed = { ...validBlock, id: 'bad_date', dateRange: { startDate: '', endDate: '' } } as IntentBlock;
        expect(() => validatePlanIntentBlocks([validBlock, malformed])).not.toThrow();
        expect(validatePlanIntentBlocks([validBlock, malformed]).valid).toBe(false);
    });
});
