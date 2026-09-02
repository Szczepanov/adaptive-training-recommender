import { describe, it, expect } from 'vitest';
import {
    deriveFactsFromOccurrence,
    type HydratedOccurrenceContext,
} from '../performedTrainingFacts';
import {
    buildCoverageState,
    resolveCoverageHistory,
    coverageNeedTierForTemplate,
} from '../coverage';
import { EVERGREEN_GENERAL_COVERAGE_SET } from '../../workouts/event-plan';
import { TEMPLATES_BY_ID } from '../templates';
import type { PerformedTrainingOccurrence } from '../../training-occurrence/models';
import type { PlanDefinition } from '../planSchedule';

const planDef: PlanDefinition = {
    id: 'evergreen-general-plan',
    eventId: 'event-1',
    coverageSetId: 'evergreen_general',
    blocks: [
        {
            id: 'block-general',
            phase: 'general',
            startDate: '2026-08-25',
            endDate: '2026-09-10',
            volumeScale: 1.0,
            intensityScale: 1.0,
        },
    ],
    objectives: [
        {
            key: 'strength_maintenance',
            coverageKey: 'primary_strength',
            blockId: 'block-general',
            requiredCredit: 1,
            priority: 'must_have',
            role: 'primary_developmental',
            coverageMinimumSessions: 1,
            coverageTargetSessions: 1,
        },
    ],
    sequencingRules: [],
};

function occurrence(
    id: string,
    date: string,
    sourceRefs: PerformedTrainingOccurrence['sourceRefs'] = [],
): PerformedTrainingOccurrence {
    return {
        schemaVersion: 1,
        performedOccurrenceId: id,
        userId: 'user-1',
        status: 'active',
        reconciliation: {
            state: 'matched',
        },
        sourceRefs,
        modality: 'Strength',
        localDate: date,
        startedAt: `${date}T10:00:00.000Z`,
        createdAt: `${date}T11:00:00.000Z`,
        updatedAt: `${date}T11:00:00.000Z`,
    };
}

describe('PR 3 — Canonical weekly coverage credit cutover', () => {
    const descriptor = EVERGREEN_GENERAL_COVERAGE_SET;
    const fullBodyTemplate = TEMPLATES_BY_ID.get('str_full_01')!;

    it('exact strength_full_body_maintenance_01 execution -> one primary_strength credit', () => {
        const occ = occurrence('occ-fb-1', '2026-09-01', [
            { kind: 'structured_execution', executionId: 'exec-fb-1' },
        ]);
        const hydrated: HydratedOccurrenceContext = {
            structured: {
                executionId: 'exec-fb-1',
                workoutId: 'strength_full_body_maintenance_01',
                templateId: 'str_full_01',
                modality: 'Strength',
                category: 'Full-body Strength',
                startedAt: '2026-09-01T10:00:00.000Z',
                durationMin: 60,
                isLegacyStrength: false,
            },
        };

        const facts = deriveFactsFromOccurrence(occ, hydrated, descriptor);
        expect(facts.coverageCredits).toHaveLength(1);
        expect(facts.coverageCredits[0]).toMatchObject({
            coverageKey: 'primary_strength',
            workoutId: 'strength_full_body_maintenance_01',
            creditKind: 'exact',
            confidence: 1.0,
            reasonCode: 'exact_workout_identity',
        });

        // Test in buildCoverageState
        const history = resolveCoverageHistory({
            asOfDate: '2026-09-03',
            windowDays: 7,
            revision: 'rev-1',
            exposures: [facts.exposure],
            coverageCredits: facts.coverageCredits,
        });

        const state = buildCoverageState(planDef, '2026-09-03', history, descriptor);
        const strengthReq = state.requirements.find(r => r.key === 'primary_strength');
        expect(strengthReq).toBeDefined();
        expect(strengthReq?.completedSessions).toBe(1);
        expect(strengthReq?.credits).toHaveLength(1);
        expect(strengthReq?.credits[0].workoutId).toBe('strength_full_body_maintenance_01');

        // Need tier for full-body strength drops to 3 (already fulfilled)
        const tier = coverageNeedTierForTemplate(state, fullBodyTemplate, null);
        expect(tier).toBe(3);
    });

    it('exact strength_bodyweight_full_body_01 -> one primary_strength credit', () => {
        const occ = occurrence('occ-bw-1', '2026-09-01', [
            { kind: 'structured_execution', executionId: 'exec-bw-1' },
        ]);
        const hydrated: HydratedOccurrenceContext = {
            structured: {
                executionId: 'exec-bw-1',
                workoutId: 'strength_bodyweight_full_body_01',
                templateId: 'str_full_02',
                modality: 'Strength',
                category: 'Full-body Strength',
                startedAt: '2026-09-01T10:00:00.000Z',
                durationMin: 45,
                isLegacyStrength: false,
            },
        };

        const facts = deriveFactsFromOccurrence(occ, hydrated, descriptor);
        expect(facts.coverageCredits).toHaveLength(1);
        expect(facts.coverageCredits[0]).toMatchObject({
            coverageKey: 'primary_strength',
            workoutId: 'strength_bodyweight_full_body_01',
            creditKind: 'exact',
        });

        const history = resolveCoverageHistory({
            asOfDate: '2026-09-03',
            windowDays: 7,
            revision: 'rev-1',
            exposures: [facts.exposure],
            coverageCredits: facts.coverageCredits,
        });

        const state = buildCoverageState(planDef, '2026-09-03', history, descriptor);
        const strengthReq = state.requirements.find(r => r.key === 'primary_strength');
        expect(strengthReq?.completedSessions).toBe(1);
    });

    it('strength_compact_power_01 -> no primary_strength credit', () => {
        const occ = occurrence('occ-cp-1', '2026-09-01', [
            { kind: 'structured_execution', executionId: 'exec-cp-1' },
        ]);
        const hydrated: HydratedOccurrenceContext = {
            structured: {
                executionId: 'exec-cp-1',
                workoutId: 'strength_compact_power_01',
                modality: 'Strength',
                startedAt: '2026-09-01T10:00:00.000Z',
                durationMin: 30,
                isLegacyStrength: false,
            },
        };

        const facts = deriveFactsFromOccurrence(occ, hydrated, descriptor);
        expect(facts.coverageCredits).toHaveLength(1);
        expect(facts.coverageCredits[0].coverageKey).toBe('compact_strength');
        expect(facts.coverageCredits.some(c => c.coverageKey === 'primary_strength')).toBe(false);

        const history = resolveCoverageHistory({
            asOfDate: '2026-09-03',
            windowDays: 7,
            revision: 'rev-1',
            exposures: [facts.exposure],
            coverageCredits: facts.coverageCredits,
        });

        const state = buildCoverageState(planDef, '2026-09-03', history, descriptor);
        const strengthReq = state.requirements.find(r => r.key === 'primary_strength');
        expect(strengthReq?.completedSessions).toBe(0);
    });

    it('generic Garmin Strength -> no exact primary_strength credit', () => {
        const occ = occurrence('occ-garmin-1', '2026-09-01', [
            { kind: 'provider_activity', provider: 'garmin', activityId: 'garmin-123' },
        ]);
        const hydrated: HydratedOccurrenceContext = {
            provider: {
                activityId: 'garmin-123',
                provider: 'garmin',
                modality: 'Strength',
                startedAt: '2026-09-01T10:00:00.000Z',
                durationMin: 60,
                garminActivity: {
                    activityId: 'garmin-123',
                    date: '2026-09-01',
                    durationMin: 60,
                    type: 'strength_training',
                    trainingEffectAerobic: 0.2,
                    trainingEffectAnaerobic: 0,
                    averageHr: null,
                    activityTrainingLoad: 2.9,
                    intensityTag: 'easy',
                },
            },
        };

        const facts = deriveFactsFromOccurrence(occ, hydrated, descriptor);
        expect(facts.coverageCredits).toHaveLength(1);
        expect(facts.coverageCredits[0]).toMatchObject({
            coverageKey: 'primary_strength',
            creditKind: 'none',
            confidence: 0,
            reasonCode: 'generic_modality_only',
        });

        const history = resolveCoverageHistory({
            asOfDate: '2026-09-03',
            windowDays: 7,
            revision: 'rev-1',
            exposures: [facts.exposure],
            coverageCredits: facts.coverageCredits,
        });

        const state = buildCoverageState(planDef, '2026-09-03', history, descriptor);
        const strengthReq = state.requirements.find(r => r.key === 'primary_strength');
        expect(strengthReq?.completedSessions).toBe(0);
        expect(strengthReq?.credits).toHaveLength(0);
    });

    it('app+Garmin exact full-body -> one credit, not two', () => {
        const occ = occurrence('occ-merged-1', '2026-09-01', [
            { kind: 'structured_execution', executionId: 'exec-fb-1' },
            { kind: 'provider_activity', provider: 'garmin', activityId: 'garmin-123' },
        ]);
        const hydrated: HydratedOccurrenceContext = {
            structured: {
                executionId: 'exec-fb-1',
                workoutId: 'strength_full_body_maintenance_01',
                templateId: 'str_full_01',
                modality: 'Strength',
                category: 'Full-body Strength',
                startedAt: '2026-09-01T10:00:00.000Z',
                durationMin: 60,
                isLegacyStrength: false,
            },
            provider: {
                activityId: 'garmin-123',
                provider: 'garmin',
                modality: 'Strength',
                startedAt: '2026-09-01T10:00:00.000Z',
                durationMin: 60,
                garminActivity: {
                    activityId: 'garmin-123',
                    date: '2026-09-01',
                    durationMin: 60,
                    type: 'strength_training',
                    trainingEffectAerobic: 0.2,
                    trainingEffectAnaerobic: 0,
                    averageHr: null,
                    activityTrainingLoad: 2.9,
                    intensityTag: 'easy',
                },
            },
        };

        const facts = deriveFactsFromOccurrence(occ, hydrated, descriptor);
        expect(facts.coverageCredits).toHaveLength(1);
        expect(facts.coverageCredits[0].creditKind).toBe('exact');
        expect(facts.coverageCredits[0].sourceKinds).toEqual(['structured_execution', 'provider_activity']);

        const history = resolveCoverageHistory({
            asOfDate: '2026-09-03',
            windowDays: 7,
            revision: 'rev-1',
            exposures: [facts.exposure],
            coverageCredits: facts.coverageCredits,
        });

        const state = buildCoverageState(planDef, '2026-09-03', history, descriptor);
        const strengthReq = state.requirements.find(r => r.key === 'primary_strength');
        expect(strengthReq?.completedSessions).toBe(1);
        expect(strengthReq?.credits).toHaveLength(1);
    });

    it('exact catalog identity survives source arrival in either order', () => {
        const occA = occurrence('occ-order-a', '2026-09-01', [
            { kind: 'structured_execution', executionId: 'exec-1' },
            { kind: 'provider_activity', provider: 'garmin', activityId: 'garmin-1' },
        ]);
        const occB = occurrence('occ-order-b', '2026-09-01', [
            { kind: 'provider_activity', provider: 'garmin', activityId: 'garmin-1' },
            { kind: 'structured_execution', executionId: 'exec-1' },
        ]);

        const hydrated: HydratedOccurrenceContext = {
            structured: {
                executionId: 'exec-1',
                workoutId: 'strength_full_body_maintenance_01',
                templateId: 'str_full_01',
                modality: 'Strength',
                category: 'Full-body Strength',
                startedAt: '2026-09-01T10:00:00.000Z',
                durationMin: 60,
                isLegacyStrength: false,
            },
            provider: {
                activityId: 'garmin-1',
                provider: 'garmin',
                modality: 'Strength',
                startedAt: '2026-09-01T10:00:00.000Z',
                durationMin: 60,
            },
        };

        const factsA = deriveFactsFromOccurrence(occA, hydrated, descriptor);
        const factsB = deriveFactsFromOccurrence(occB, hydrated, descriptor);

        expect(factsA.exposure.workoutId).toBe('strength_full_body_maintenance_01');
        expect(factsB.exposure.workoutId).toBe('strength_full_body_maintenance_01');
        expect(factsA.coverageCredits[0].creditKind).toBe('exact');
        expect(factsB.coverageCredits[0].creditKind).toBe('exact');
    });

    it('unknown/legacy identity remains uncredited but observable', () => {
        const occ = occurrence('occ-legacy-1', '2026-09-01', [
            { kind: 'structured_execution', executionId: 'exec-legacy-1' },
        ]);
        const hydrated: HydratedOccurrenceContext = {
            structured: {
                executionId: 'exec-legacy-1',
                workoutId: undefined,
                templateId: undefined,
                modality: 'Strength',
                startedAt: '2026-09-01T10:00:00.000Z',
                durationMin: 50,
                isLegacyStrength: true,
            },
        };

        const facts = deriveFactsFromOccurrence(occ, hydrated, descriptor);
        expect(facts.exposure.modality).toBe('Strength');
        expect(facts.exposure.workoutId).toBeUndefined();
        expect(facts.exposure.confidence).toBe('high');

        expect(facts.coverageCredits).toHaveLength(1);
        expect(facts.coverageCredits[0]).toMatchObject({
            coverageKey: 'primary_strength',
            creditKind: 'none',
            reasonCode: 'generic_modality_only',
        });

        const history = resolveCoverageHistory({
            asOfDate: '2026-09-03',
            windowDays: 7,
            revision: 'rev-1',
            exposures: [facts.exposure],
            coverageCredits: facts.coverageCredits,
        });

        const state = buildCoverageState(planDef, '2026-09-03', history, descriptor);
        const strengthReq = state.requirements.find(r => r.key === 'primary_strength');
        expect(strengthReq?.completedSessions).toBe(0);
    });

    it('resolveCoverageHistory treats canonical [] as authoritative over legacy fallback', () => {
        const legacyExposures = [{
            date: '2026-09-01',
            modality: 'Strength' as const,
            workoutId: 'strength_full_body_maintenance_01',
            durationMin: 60,
        }];

        const historyFromEmpty = resolveCoverageHistory({
            asOfDate: '2026-09-03',
            windowDays: 7,
            revision: 'rev-empty',
            exposures: [],
            coverageCredits: [],
        }, legacyExposures);

        expect(historyFromEmpty).toEqual([]);

        const historyFromNull = resolveCoverageHistory(null, legacyExposures);
        expect(historyFromNull).toHaveLength(1);
        expect(historyFromNull[0].workoutId).toBe('strength_full_body_maintenance_01');
    });
});
