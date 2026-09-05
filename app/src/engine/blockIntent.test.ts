import { describe, it, expect } from 'vitest';
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
        dateRange: {
            startDate: '2026-09-07',
            endDate: '2026-10-04',
        },
        objectives: [
            {
                id: 'obj_threshold_dev',
                sport: 'cycling',
                adaptationScope: 'aerobic_power',
                coverageKey: 'sustained_quality',
                intent: 'develop',
                priority: 'must_have',
                doseEnvelope: {
                    min: 60,
                    target: 90,
                    max: 120,
                    unit: 'minutes',
                    floorSemantics: 'hard_floor',
                },
                knowledgeLineage: ['claim_threshold_interval_adaptation_v1'],
            },
            {
                id: 'obj_strength_maint',
                sport: 'strength',
                adaptationScope: 'muscle_retention',
                coverageKey: 'primary_strength',
                intent: 'maintain',
                priority: 'should_have',
                doseEnvelope: {
                    min: 1,
                    target: 2,
                    max: 2,
                    unit: 'sessions',
                    floorSemantics: 'soft_floor',
                },
                knowledgeLineage: ['claim_resistance_maintenance_dose_v1'],
            },
        ],
        reviewSchedule: {
            reviewCadenceDays: 14,
            nextReviewDate: '2026-09-21',
        },
        progressionContract: {
            targetBinding: {
                objectiveId: 'obj_threshold_dev',
            },
            variable: 'duration_min',
            unit: 'minutes',
            currentValue: 90,
            permittedRange: {
                min: 60,
                max: 120,
            },
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
        title: 'Cycling Build & Strength Maintenance',
    };

    it('accepts a fully valid intent block with develop and maintain objectives', () => {
        const result = validateIntentBlock(validBlock);
        expect(result.valid).toBe(true);
        expect(result.issues).toHaveLength(0);
    });

    it('rejects an empty objective list', () => {
        const invalid: IntentBlock = {
            ...validBlock,
            objectives: [],
        };
        const result = validateIntentBlock(invalid);
        expect(result.valid).toBe(false);
        expect(result.issues.some(i => i.code === 'NO_OBJECTIVES')).toBe(true);
    });

    it('rejects duplicate objective IDs within the same block', () => {
        const invalid: IntentBlock = {
            ...validBlock,
            objectives: [
                validBlock.objectives[0],
                { ...validBlock.objectives[0], sport: 'running' },
            ],
        };
        const result = validateIntentBlock(invalid);
        expect(result.valid).toBe(false);
        expect(result.issues.some(i => i.code === 'DUPLICATE_OBJECTIVE_ID')).toBe(true);
    });

    it('rejects unsupported dose units', () => {
        const invalid: IntentBlock = {
            ...validBlock,
            objectives: [
                {
                    ...validBlock.objectives[0],
                    doseEnvelope: {
                        ...validBlock.objectives[0].doseEnvelope,
                        unit: 'gallons' as unknown as import('./blockIntent').DoseUnit,
                    },
                },
            ],
        };
        const result = validateIntentBlock(invalid);
        expect(result.valid).toBe(false);
        expect(result.issues.some(i => i.code === 'UNSUPPORTED_DOSE_UNIT')).toBe(true);
    });

    it('rejects inverted dose envelopes (min > target or target > max)', () => {
        const invertedMinTarget: IntentBlock = {
            ...validBlock,
            objectives: [
                {
                    ...validBlock.objectives[0],
                    doseEnvelope: {
                        ...validBlock.objectives[0].doseEnvelope,
                        min: 100,
                        target: 80,
                    },
                },
            ],
        };
        const result = validateIntentBlock(invertedMinTarget);
        expect(result.valid).toBe(false);
        expect(result.issues.some(i => i.code === 'INVERTED_DOSE_BOUNDS_MIN_TARGET')).toBe(true);
    });

    it('rejects progression contract targeting a non-existent objective ID', () => {
        const invalid: IntentBlock = {
            ...validBlock,
            progressionContract: {
                ...validBlock.progressionContract!,
                targetBinding: {
                    objectiveId: 'non_existent_objective_id',
                },
            },
        };
        const result = validateIntentBlock(invalid);
        expect(result.valid).toBe(false);
        expect(result.issues.some(i => i.code === 'DANGLING_PROGRESSION_TARGET_OBJECTIVE')).toBe(true);
    });

    it('rejects progression contract with current value outside permitted range', () => {
        const invalid: IntentBlock = {
            ...validBlock,
            progressionContract: {
                ...validBlock.progressionContract!,
                currentValue: 150, // max is 120
            },
        };
        const result = validateIntentBlock(invalid);
        expect(result.valid).toBe(false);
        expect(result.issues.some(i => i.code === 'CURRENT_VALUE_OUT_OF_RANGE')).toBe(true);
    });

    it('rejects non-positive progression increment', () => {
        const invalid: IntentBlock = {
            ...validBlock,
            progressionContract: {
                ...validBlock.progressionContract!,
                increment: 0,
            },
        };
        const result = validateIntentBlock(invalid);
        expect(result.valid).toBe(false);
        expect(result.issues.some(i => i.code === 'INVALID_PROGRESSION_INCREMENT')).toBe(true);
    });

    it('validates plan-level blocks and rejects overlapping active intervals', () => {
        const blockA: IntentBlock = {
            ...validBlock,
            id: 'block_a',
            dateRange: { startDate: '2026-09-01', endDate: '2026-09-15' },
        };
        const blockBOverlapping: IntentBlock = {
            ...validBlock,
            id: 'block_b',
            dateRange: { startDate: '2026-09-10', endDate: '2026-09-25' },
        };

        const result = validatePlanIntentBlocks([blockA, blockBOverlapping]);
        expect(result.valid).toBe(false);
        expect(result.issues.some(i => i.code === 'OVERLAPPING_INTENT_BLOCKS')).toBe(true);
    });
});
