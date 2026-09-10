import { describe, expect, it } from 'vitest';
import { deriveDurationOverridesForDate, SELECTION_WIRED_COVERAGE_KEYS } from './confirmedProgressionOverrides';
import type { BlockObjectiveDefinition, IntentBlock } from './blockIntent';

function objective(overrides: Partial<BlockObjectiveDefinition> = {}): BlockObjectiveDefinition {
    return {
        id: 'obj_threshold_dev',
        sport: 'cycling',
        adaptationScope: 'threshold_quality',
        coverageKey: 'sustained_quality',
        intent: 'develop',
        priority: 'must_have',
        doseEnvelope: { min: 60, target: 90, max: 120, unit: 'minutes', floorSemantics: 'hard_floor' },
        knowledgeLineage: ['claim_threshold_interval_adaptation_v1'],
        successCriteria: { minCompletedExposures: 3 },
        ...overrides,
    };
}

function block(overrides: Partial<IntentBlock> = {}, objectiveOverrides: Partial<BlockObjectiveDefinition> = {}): IntentBlock {
    return {
        id: 'block_a',
        revision: 1,
        sourcePlanId: 'block_a',
        sourcePlanRevision: 1,
        dateRange: { startDate: '2026-09-01', endDate: '2026-09-30' },
        objectives: [objective(objectiveOverrides)],
        reviewSchedule: { reviewCadenceDays: 14, nextReviewDate: '2026-09-15' },
        progressionContract: {
            targetBinding: { objectiveId: 'obj_threshold_dev' },
            variable: 'duration_min',
            unit: 'minutes',
            currentValue: 100,
            permittedRange: { min: 60, max: 120 },
            increment: 10,
            knowledgeLineage: ['policy_progression_duration_v1'],
            observationWindowDays: 14,
            minCompletedExposures: 3,
            requiredFollowUpCoveragePct: 66,
            reviewCadenceDays: 14,
        },
        ...overrides,
    };
}

describe('SELECTION_WIRED_COVERAGE_KEYS', () => {
    it('is exactly the 3 roles EVERGREEN_PACKING_COVERAGE defines', () => {
        expect([...SELECTION_WIRED_COVERAGE_KEYS].sort()).toEqual(['aerobic_volume', 'primary_strength', 'sustained_quality']);
    });
});

describe('deriveDurationOverridesForDate', () => {
    it('applies a confirmed progression for a wired coverage key within the active date range', () => {
        const result = deriveDurationOverridesForDate([block()], '2026-09-10');
        expect(result.overrides.get('sustained_quality')).toBe(100);
        expect(result.unsupported).toEqual([]);
    });

    it('ignores a block whose date range does not cover the requested date', () => {
        const before = deriveDurationOverridesForDate([block()], '2026-08-31');
        const after = deriveDurationOverridesForDate([block()], '2026-10-01');
        expect(before.overrides.size).toBe(0);
        expect(after.overrides.size).toBe(0);
    });

    it('ignores a block with no progression contract', () => {
        const noContract = block({ progressionContract: undefined });
        const result = deriveDurationOverridesForDate([noContract], '2026-09-10');
        expect(result.overrides.size).toBe(0);
        expect(result.unsupported).toEqual([]);
    });

    it('classifies each ObjectiveKey by whether its coverageKey is wired', () => {
        const wired: Array<[BlockObjectiveDefinition['adaptationScope'], BlockObjectiveDefinition['coverageKey']]> = [
            ['zone2_aerobic', 'aerobic_volume'],
            ['strength_maintenance', 'primary_strength'],
            ['strength_development', 'primary_strength'],
            ['threshold_quality', 'sustained_quality'],
        ];
        for (const [adaptationScope, coverageKey] of wired) {
            const result = deriveDurationOverridesForDate([block({}, { adaptationScope, coverageKey })], '2026-09-10');
            expect(result.overrides.get(coverageKey)).toBe(100);
            expect(result.unsupported).toEqual([]);
        }

        const unsupported: Array<[BlockObjectiveDefinition['adaptationScope'], BlockObjectiveDefinition['coverageKey']]> = [
            ['surge_repeatability', 'short_surges'],
            ['race_specific_endurance', 'outdoor_event_specific'],
            ['vo2_max', 'gap_closing'],
        ];
        for (const [adaptationScope, coverageKey] of unsupported) {
            const result = deriveDurationOverridesForDate([block({}, { adaptationScope, coverageKey })], '2026-09-10');
            expect(result.overrides.size).toBe(0);
            expect(result.unsupported).toEqual([
                { blockId: 'block_a', objectiveId: 'obj_threshold_dev', coverageKey, adaptationScope },
            ]);
        }
    });

    it('clamps currentValue into the objective dose envelope defensively when units match', () => {
        const outOfRange = block(
            { progressionContract: { ...block().progressionContract!, currentValue: 999 } },
            { doseEnvelope: { min: 60, target: 90, max: 120, unit: 'minutes', floorSemantics: 'hard_floor' } },
        );
        const result = deriveDurationOverridesForDate([outOfRange], '2026-09-10');
        expect(result.overrides.get('sustained_quality')).toBe(120);
    });

    it('does not clamp minute progression against an objective envelope expressed in sessions', () => {
        const mixedUnits = block(
            {},
            { doseEnvelope: { min: 2, target: 3, max: 4, unit: 'sessions', floorSemantics: 'hard_floor' } },
        );
        const result = deriveDurationOverridesForDate([mixedUnits], '2026-09-10');
        expect(result.overrides.get('sustained_quality')).toBe(100);
    });

    it('resolves a same-coverage-key collision deterministically by lexicographically smaller blockId', () => {
        const first = block({ id: 'block_a', progressionContract: { ...block().progressionContract!, currentValue: 90 } });
        const second = block({ id: 'block_b', progressionContract: { ...block().progressionContract!, currentValue: 110 } });
        const result = deriveDurationOverridesForDate([second, first], '2026-09-10');
        expect(result.overrides.get('sustained_quality')).toBe(90);
        expect(result.overrides.size).toBe(1);
    });

    it('ignores a progression contract whose targetBinding.objectiveId has no matching objective', () => {
        const dangling = block({
            progressionContract: { ...block().progressionContract!, targetBinding: { objectiveId: 'does_not_exist' } },
        });
        const result = deriveDurationOverridesForDate([dangling], '2026-09-10');
        expect(result.overrides.size).toBe(0);
        expect(result.unsupported).toEqual([]);
    });
});
