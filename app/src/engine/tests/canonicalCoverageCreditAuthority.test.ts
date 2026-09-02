import { describe, expect, it } from 'vitest';
import { buildCoverageState, resolveCoverageHistory } from '../coverage';
import type { PerformedTrainingFactsSnapshot } from '../performedTrainingFacts';
import type { PlanDefinition } from '../planSchedule';

function plan(
    coverageSetId: PlanDefinition['coverageSetId'],
    phase: 'general' | 'build',
    coverageKey: 'primary_strength' | 'aerobic_volume',
): PlanDefinition {
    return {
        id: `plan-${coverageSetId}-${coverageKey}`,
        eventId: 'event-1',
        coverageSetId,
        blocks: [{
            id: 'block-1',
            phase,
            startDate: '2026-08-25',
            endDate: '2026-09-10',
            volumeScale: 1,
            intensityScale: 1,
        }],
        objectives: [{
            key: coverageKey === 'primary_strength' ? 'strength_maintenance' : 'zone2_aerobic',
            coverageKey,
            blockId: 'block-1',
            requiredCredit: 1,
            priority: 'must_have',
            coverageMinimumSessions: 1,
            coverageTargetSessions: 1,
        }],
        sequencingRules: [],
    };
}

function snapshot(overrides: Partial<PerformedTrainingFactsSnapshot>): PerformedTrainingFactsSnapshot {
    return {
        asOfDate: '2026-09-03',
        windowDays: 7,
        revision: 'test-revision',
        exposures: [],
        coverageCredits: [],
        ...overrides,
    };
}

describe('canonical coverage semantic authority', () => {
    it('does not reclassify an exact-looking exposure when canonical credit chose another role', () => {
        const facts = snapshot({
            exposures: [{
                performedOccurrenceId: 'occ-1',
                localDate: '2026-09-01',
                modality: 'Strength',
                confidence: 'exact',
                sourceKinds: ['structured_execution'],
                evidenceTier: 'completedStructuredWorkout',
                workoutId: 'strength_full_body_maintenance_01',
            }],
            coverageCredits: [{
                performedOccurrenceId: 'occ-1',
                coverageSetId: 'september_cycling_event',
                coverageKey: 'compact_strength',
                workoutId: 'strength_full_body_maintenance_01',
                creditKind: 'exact',
                confidence: 1,
                reasonCode: 'exact_workout_identity',
                sourceKinds: ['structured_execution'],
            }],
        });

        const state = buildCoverageState(
            plan('september_cycling_event', 'build', 'primary_strength'),
            '2026-09-03',
            resolveCoverageHistory(facts),
        );

        expect(state.requirements.find(item => item.key === 'primary_strength')?.completedSessions).toBe(0);
    });

    it('fails closed when canonical credits belong to a different coverage set', () => {
        const facts = snapshot({
            exposures: [{
                performedOccurrenceId: 'occ-2',
                localDate: '2026-09-01',
                modality: 'Strength',
                confidence: 'exact',
                sourceKinds: ['structured_execution'],
                evidenceTier: 'completedStructuredWorkout',
                workoutId: 'strength_full_body_maintenance_01',
            }],
            coverageCredits: [{
                performedOccurrenceId: 'occ-2',
                coverageSetId: 'evergreen_general',
                coverageKey: 'primary_strength',
                workoutId: 'strength_full_body_maintenance_01',
                creditKind: 'exact',
                confidence: 1,
                reasonCode: 'exact_workout_identity',
                sourceKinds: ['structured_execution'],
            }],
        });

        const state = buildCoverageState(
            plan('september_cycling_event', 'build', 'primary_strength'),
            '2026-09-03',
            resolveCoverageHistory(facts),
        );

        expect(state.requirements.find(item => item.key === 'primary_strength')?.completedSessions).toBe(0);
    });

    it('treats creditKind none as authoritative even if exposure carries a catalog workout id', () => {
        const facts = snapshot({
            exposures: [{
                performedOccurrenceId: 'occ-3',
                localDate: '2026-09-01',
                modality: 'Strength',
                confidence: 'inferred',
                sourceKinds: ['provider_activity'],
                evidenceTier: 'durationIntensity',
                workoutId: 'strength_full_body_maintenance_01',
            }],
            coverageCredits: [{
                performedOccurrenceId: 'occ-3',
                coverageSetId: 'evergreen_general',
                coverageKey: 'primary_strength',
                workoutId: 'strength_full_body_maintenance_01',
                creditKind: 'none',
                confidence: 0,
                reasonCode: 'generic_modality_only',
                sourceKinds: ['provider_activity'],
            }],
        });

        const state = buildCoverageState(
            plan('evergreen_general', 'general', 'primary_strength'),
            '2026-09-03',
            resolveCoverageHistory(facts),
        );

        expect(state.requirements.find(item => item.key === 'primary_strength')?.completedSessions).toBe(0);
    });

    it('keeps semantic_confident disabled until a dedicated policy enables it', () => {
        const facts = snapshot({
            exposures: [{
                performedOccurrenceId: 'occ-4',
                localDate: '2026-09-01',
                modality: 'Strength',
                confidence: 'high',
                sourceKinds: ['structured_execution'],
                evidenceTier: 'completedStructuredWorkout',
            }],
            coverageCredits: [{
                performedOccurrenceId: 'occ-4',
                coverageSetId: 'evergreen_general',
                coverageKey: 'primary_strength',
                creditKind: 'semantic_confident',
                confidence: 0.9,
                reasonCode: 'semantic_classifier',
                sourceKinds: ['structured_execution'],
            }],
        });

        const state = buildCoverageState(
            plan('evergreen_general', 'general', 'primary_strength'),
            '2026-09-03',
            resolveCoverageHistory(facts),
        );

        expect(state.requirements.find(item => item.key === 'primary_strength')?.completedSessions).toBe(0);
    });

    it('retains the aerobic minimum-duration guard after identity cuts over to canonical credits', () => {
        const facts = snapshot({
            exposures: [{
                performedOccurrenceId: 'occ-5',
                localDate: '2026-09-01',
                modality: 'Cycling',
                confidence: 'exact',
                sourceKinds: ['structured_execution'],
                evidenceTier: 'completedStructuredWorkout',
                workoutId: 'cycling_zone2_standard_01',
                durationMin: 1,
            }],
            coverageCredits: [{
                performedOccurrenceId: 'occ-5',
                coverageSetId: 'evergreen_general',
                coverageKey: 'aerobic_volume',
                workoutId: 'cycling_zone2_standard_01',
                creditKind: 'exact',
                confidence: 1,
                reasonCode: 'exact_workout_identity',
                sourceKinds: ['structured_execution'],
            }],
        });

        const state = buildCoverageState(
            plan('evergreen_general', 'general', 'aerobic_volume'),
            '2026-09-03',
            resolveCoverageHistory(facts),
        );

        expect(state.requirements.find(item => item.key === 'aerobic_volume')?.completedSessions).toBe(0);
    });

    it('keeps exposure-only injected fixtures on legacy descriptor lookup for projection compatibility', () => {
        const history = resolveCoverageHistory({
            exposures: [{
                performedOccurrenceId: 'occ-legacy-fixture',
                localDate: '2026-09-01',
                modality: 'Strength',
                workoutId: 'strength_full_body_maintenance_01',
            }],
        });

        const state = buildCoverageState(
            plan('evergreen_general', 'general', 'primary_strength'),
            '2026-09-03',
            history,
        );

        expect(state.requirements.find(item => item.key === 'primary_strength')?.completedSessions).toBe(1);
    });

    it('records hypothetical planner entries as projected rather than completed coverage', () => {
        const projectedHistory = resolveCoverageHistory(undefined, [{
            date: '2026-09-02',
            templateId: 'full_body_strength_01',
            modality: 'Strength',
            category: 'Full-body Strength',
            source: 'projected',
        }]);

        const state = buildCoverageState(
            plan('evergreen_general', 'general', 'primary_strength'),
            '2026-09-03',
            projectedHistory,
        );
        const requirement = state.requirements.find(item => item.key === 'primary_strength');

        expect(requirement?.completedSessions).toBe(0);
        expect(requirement?.projectedSessions).toBe(1);
    });
});
