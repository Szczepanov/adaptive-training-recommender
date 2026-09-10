import { describe, expect, it } from 'vitest';
import { deriveDurationOverridesForDate, progressionOverrideKey, SELECTION_WIRED_COVERAGE_KEYS } from './confirmedProgressionOverrides';
import { EVERGREEN_PACKING_COVERAGE, packWeeklyDose } from './weeklyDosePacking';
import type { EvidenceBackedStrategy } from './evergreenStrategy';
import type { ResolvedTrainingCapacity } from './trainingCapacity';
import type { BlockObjectiveDefinition, IntentBlock } from './blockIntent';

/**
 * `cycling_zone2_standard_01` (aerobic_volume), `strength_full_body_maintenance_01`
 * (primary_strength) and `cycling_controlled_threshold_4x8_01` (sustained_quality) are the
 * real catalog workouts these fixtures target. Every `currentValue` below is chosen to fit
 * inside that workout's real `duration.minimumMin`/`maximumMin` bounds -- a value that
 * doesn't is deliberately exercised as its own "unsupported" case, since
 * `exactWorkoutTargets` (confirmedProgressionOverrides.ts) rejects a confirmed target no
 * catalog workout can physically represent rather than crediting it as accounting metadata.
 */

function objective(overrides: Partial<BlockObjectiveDefinition> = {}): BlockObjectiveDefinition {
    return {
        id: 'obj_threshold_dev',
        sport: 'cycling',
        adaptationScope: 'threshold_quality',
        coverageKey: 'sustained_quality',
        intent: 'develop',
        priority: 'must_have',
        doseEnvelope: { min: 45, target: 70, max: 90, unit: 'minutes', floorSemantics: 'hard_floor' },
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
            currentValue: 70,
            permittedRange: { min: 45, max: 90 },
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
    it('applies a confirmed progression for a wired coverage key within the active date range, keyed to the exact catalog workout', () => {
        const result = deriveDurationOverridesForDate([block()], '2026-09-10');
        expect(result.overrides.get(progressionOverrideKey('sustained_quality', 'cycling_controlled_threshold_4x8_01'))).toBe(70);
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

    it('classifies each wired ObjectiveKey against its real catalog workout, sport-matched', () => {
        const wired: Array<[BlockObjectiveDefinition['adaptationScope'], BlockObjectiveDefinition['coverageKey'], BlockObjectiveDefinition['sport'], string]> = [
            ['zone2_aerobic', 'aerobic_volume', 'cycling', 'cycling_zone2_standard_01'],
            ['strength_maintenance', 'primary_strength', 'strength', 'strength_full_body_maintenance_01'],
            ['strength_development', 'primary_strength', 'strength', 'strength_full_body_maintenance_01'],
            ['threshold_quality', 'sustained_quality', 'cycling', 'cycling_controlled_threshold_4x8_01'],
        ];
        for (const [adaptationScope, coverageKey, sport, workoutId] of wired) {
            const result = deriveDurationOverridesForDate([block({}, { adaptationScope, coverageKey, sport })], '2026-09-10');
            expect(result.overrides.get(progressionOverrideKey(coverageKey, workoutId))).toBe(70);
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
                { blockId: 'block_a', objectiveId: 'obj_threshold_dev', coverageKey, adaptationScope, reason: 'coverage_not_wired' },
            ]);
        }
    });

    it('rejects a confirmed value no real catalog workout can physically represent, rather than crediting it', () => {
        // cycling_controlled_threshold_4x8_01's real maximumMin is 90; clamping alone would
        // let 999 through as 90 (matching the objective envelope's max), but 90 does still
        // fit that workout -- push the envelope itself past the workout's ceiling so the
        // clamped value has nothing left it can represent.
        const outOfRange = block(
            { progressionContract: { ...block().progressionContract!, currentValue: 999, permittedRange: { min: 45, max: 200 } } },
            { doseEnvelope: { min: 45, target: 70, max: 200, unit: 'minutes', floorSemantics: 'hard_floor' } },
        );
        const result = deriveDurationOverridesForDate([outOfRange], '2026-09-10');
        expect(result.overrides.size).toBe(0);
        expect(result.unsupported).toEqual([
            { blockId: 'block_a', objectiveId: 'obj_threshold_dev', coverageKey: 'sustained_quality', adaptationScope: 'threshold_quality', reason: 'no_exact_prescription_target' },
        ]);
    });

    it('does not clamp minute progression against an objective envelope expressed in sessions', () => {
        const mixedUnits = block(
            {},
            { doseEnvelope: { min: 2, target: 3, max: 4, unit: 'sessions', floorSemantics: 'hard_floor' } },
        );
        const result = deriveDurationOverridesForDate([mixedUnits], '2026-09-10');
        expect(result.overrides.get(progressionOverrideKey('sustained_quality', 'cycling_controlled_threshold_4x8_01'))).toBe(70);
    });

    it('treats two active blocks confirming the same coverage key as ambiguous, retracting both rather than silently favoring one', () => {
        const first = block({ id: 'block_a', progressionContract: { ...block().progressionContract!, currentValue: 60 } });
        const second = block({ id: 'block_b', progressionContract: { ...block().progressionContract!, currentValue: 80 } });
        const result = deriveDurationOverridesForDate([second, first], '2026-09-10');
        expect(result.overrides.size).toBe(0);
        expect(result.unsupported.map(entry => ({ blockId: entry.blockId, reason: entry.reason }))).toEqual(
            expect.arrayContaining([
                { blockId: 'block_a', reason: 'ambiguous_active_role_progression' },
                { blockId: 'block_b', reason: 'ambiguous_active_role_progression' },
            ]),
        );
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

describe('deriveDurationOverridesForDate -> packWeeklyDose (production key contract, end to end)', () => {
    const capacity: ResolvedTrainingCapacity = {
        minSessions: 2, targetSessions: 2, maxSessions: 2,
        weekdayMinutes: 90, weekendMinutes: 90,
        usableWindows: [
            { date: '2026-09-08', availableMinutes: 90 },
            { date: '2026-09-09', availableMinutes: 90 },
        ],
        estimatedTargetWeeklyMinutes: 180, warnings: [],
    };
    const strategy: EvidenceBackedStrategy = {
        requirements: [{
            adaptation: 'aerobic_endurance', priority: 'required',
            floor: { dose: { unit: 'minutes', value: 150 }, semantics: 'guideline_recommended_minimum' },
            target: { unit: 'minutes', minimum: 150, target: 150, maximum: 300 },
            // Restricted to cycling only, so the packer's eligible-workout set for this
            // requirement is exactly the one workout the confirmed progression targets --
            // not the sibling running/walking workouts also on the aerobic_volume role.
            substitutionPolicy: { equivalentModalitiesAllowed: false, permittedModalities: ['Cycling'] },
            knowledgeRefs: ['test.claim'],
            evidence: {
                knowledgeClaimId: 'test.claim', knowledgeClaimVersion: 1, sourceId: 'test', sourceIds: ['test'],
                population: 'test', outcome: 'test', confidence: 'high', evidenceCertainty: 'moderate',
                maturity: 'established', status: 'active', applicability: [], authority: 'guideline_target',
                policyVersion: 'test', reviewedOn: '2026-08-10',
            },
        }], warnings: [],
    };

    it('carries a confirmed progression from the real derivation helper through to weekly delivered-dose accounting', () => {
        const confirmedBlock = block({}, { adaptationScope: 'zone2_aerobic', coverageKey: 'aerobic_volume', sport: 'cycling' });
        const overrides = deriveDurationOverridesForDate([confirmedBlock], '2026-09-08');
        expect(overrides.overrides.get(progressionOverrideKey('aerobic_volume', 'cycling_zone2_standard_01'))).toBe(70);

        const baseline = packWeeklyDose(strategy, capacity, EVERGREEN_PACKING_COVERAGE);
        const withConfirmedProgression = packWeeklyDose(strategy, capacity, EVERGREEN_PACKING_COVERAGE, overrides.overrides);

        // cycling_zone2_standard_01's catalog duration is 60 min; 2 sessions credit 120 min,
        // below the 150-minute floor. The confirmed 70-minute progression raises that to 140
        // -- still short, but the two budgets must differ, proving the exact-scoped key the
        // real helper emits is understood by the packer, not silently ignored.
        expect(baseline.shortfalls).toEqual([expect.objectContaining({ code: 'below_guideline_range' })]);
        expect(withConfirmedProgression.shortfalls).toEqual([expect.objectContaining({ code: 'below_guideline_range', message: expect.stringContaining('140') })]);
        expect(withConfirmedProgression).not.toEqual(baseline);
    });

    it('does not apply the override when the eligible workout set for the requirement is not the one the progression was confirmed against', () => {
        const confirmedBlock = block({}, { adaptationScope: 'zone2_aerobic', coverageKey: 'aerobic_volume', sport: 'cycling' });
        const overrides = deriveDurationOverridesForDate([confirmedBlock], '2026-09-08');

        // Widen the requirement's permitted modalities so the packer's eligible set for
        // aerobic_volume also includes the running/walking workouts the progression was
        // never confirmed against -- the override must not leak onto those.
        const multiModalStrategy: EvidenceBackedStrategy = {
            ...strategy,
            requirements: [{ ...strategy.requirements[0], substitutionPolicy: { equivalentModalitiesAllowed: true, permittedModalities: ['Cycling', 'Running', 'Walking'] } }],
        };
        const withConfirmedProgression = packWeeklyDose(multiModalStrategy, capacity, EVERGREEN_PACKING_COVERAGE, overrides.overrides);
        const baseline = packWeeklyDose(multiModalStrategy, capacity, EVERGREEN_PACKING_COVERAGE);
        expect(withConfirmedProgression).toEqual(baseline);
    });
});
