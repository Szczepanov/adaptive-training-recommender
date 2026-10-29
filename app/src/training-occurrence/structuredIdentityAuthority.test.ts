import { describe, expect, it } from 'vitest';
import { ENGINE_PERFORMED_TRAINING_CATALOG } from '../engine/performedTrainingCatalog';
import { deriveFactsFromOccurrence, type HydratedOccurrenceContext } from '../derived/training/performedTrainingFacts';
import { buildCoverageState, resolveCoverageHistory } from '../engine/coverage';
import { EVERGREEN_GENERAL_COVERAGE_SET } from '../workouts/event-plan';
import type { ActivityOverride, NormalizedGarminActivity } from '../ledger/models';
import type { PlanDefinition } from '../engine/planSchedule';
import type { PerformedTrainingOccurrence } from './models';

/**
 * #895 acceptance: "Structured exercise identity wins over conflicting Garmin exercise
 * recognition." Provider recognition is fallback/diagnostic evidence; it must not change the
 * session identity, modality, cost/stimulus semantics or weekly-role coverage credit of an
 * occurrence that has a structured execution. This file pins the SESSION-level derivation
 * (`deriveFactsFromOccurrence` never reads provider exercise sets); exercise/set-level
 * authority is pinned by `CompletedWorkoutList.test.tsx` (Garmin sets diagnostic-only),
 * `activitiesReadModelService.test.ts` and `engine/contextBriefResponseFeatures.test.ts`.
 */

const DATE = '2026-09-01';
const descriptor = EVERGREEN_GENERAL_COVERAGE_SET;

const occurrence: PerformedTrainingOccurrence = {
    schemaVersion: 1,
    performedOccurrenceId: 'occ-identity',
    userId: 'user-1',
    status: 'active',
    reconciliation: { state: 'matched' },
    sourceRefs: [
        { kind: 'structured_execution', executionId: 'exec-identity' },
        { kind: 'provider_activity', provider: 'garmin', activityId: 'garmin-identity' },
    ],
    modality: 'Strength',
    localDate: DATE,
    startedAt: `${DATE}T10:00:00.000Z`,
    createdAt: `${DATE}T11:00:00.000Z`,
    updatedAt: `${DATE}T11:00:00.000Z`,
};

const structured: NonNullable<HydratedOccurrenceContext['structured']> = {
    executionId: 'exec-identity',
    workoutId: 'strength_full_body_maintenance_01',
    templateId: 'str_full_01',
    modality: 'Strength',
    category: 'Full-body Strength',
    startedAt: `${DATE}T10:00:00.000Z`,
    durationMin: 60,
    workoutVariantId: 'full',
    isLegacyStrength: false,
};

/** Garmin recognized this as a running session with unrelated exercise names. */
const conflictingActivity: NormalizedGarminActivity = {
    activityId: 'garmin-identity', date: DATE, durationMin: 58, type: 'running',
    trainingEffectAerobic: 3.1, trainingEffectAnaerobic: 0.5, averageHr: 150,
    activityTrainingLoad: 80, intensityTag: 'hard',
    exerciseSets: [
        { setOrder: 1, setType: 'ACTIVE', repetitionCount: 12, weightKg: 10, exerciseName: 'BICYCLE_CRUNCH', exerciseCategory: 'CORE' },
        { setOrder: 2, setType: 'ACTIVE', repetitionCount: 8, weightKg: 20, exerciseName: 'LATERAL_RAISE', exerciseCategory: 'SHOULDER_PRESS' },
    ],
};

const conflictingOverride: ActivityOverride = {
    activityId: 'garmin-identity', userId: 'user-1', date: DATE,
    originalType: 'running', originalIntensityTag: 'hard',
    overriddenModality: 'Cycling', overriddenIntensity: 'hard',
    createdAt: `${DATE}T12:00:00.000Z`, updatedAt: `${DATE}T12:00:00.000Z`,
};

const provider = (overrides: Partial<NonNullable<HydratedOccurrenceContext['provider']>> = {}): NonNullable<HydratedOccurrenceContext['provider']> => ({
    activityId: 'garmin-identity',
    provider: 'garmin',
    modality: 'Running',
    startedAt: `${DATE}T10:00:00.000Z`,
    durationMin: 58,
    garminActivity: conflictingActivity,
    ...overrides,
});

const planDef: PlanDefinition = {
    id: 'evergreen-general-plan', eventId: 'event-1', coverageSetId: 'evergreen_general',
    blocks: [{ id: 'block-general', phase: 'general', startDate: '2026-08-25', endDate: '2026-09-10', volumeScale: 1.0, intensityScale: 1.0 }],
    objectives: [{
        key: 'strength_maintenance', coverageKey: 'primary_strength', blockId: 'block-general', requiredCredit: 1,
        priority: 'must_have', role: 'primary_developmental', coverageMinimumSessions: 1, coverageTargetSessions: 1,
    }],
    sequencingRules: [],
};

describe('structured identity over conflicting provider recognition (#895)', () => {
    const structuredOnly = deriveFactsFromOccurrence(occurrence, { structured }, ENGINE_PERFORMED_TRAINING_CATALOG, descriptor);

    it.each([
        ['conflicting Garmin type and exercise sets', provider()],
        ['conflicting provider override to another modality', provider({ override: conflictingOverride })],
    ])('keeps structured identity and modality with %s', (_label, conflicting) => {
        const facts = deriveFactsFromOccurrence(occurrence, { structured, provider: conflicting }, ENGINE_PERFORMED_TRAINING_CATALOG, descriptor);

        expect(facts.exposure.modality).toBe('Strength');
        expect(facts.exposure.workoutId).toBe('strength_full_body_maintenance_01');
        expect(facts.exposure.templateId).toBe('str_full_01');
        expect(facts.exposure.sourceKinds).toEqual(['structured_execution', 'provider_activity']);
    });

    it('the whole exposure is identical to the structured-only exposure apart from source provenance', () => {
        const withProvider = deriveFactsFromOccurrence(occurrence, { structured, provider: provider({ override: conflictingOverride }) }, ENGINE_PERFORMED_TRAINING_CATALOG, descriptor);
        const withoutProvenance = (exposure: typeof withProvider.exposure) => ({ ...exposure, sourceKinds: undefined, providerActivityIds: undefined });
        expect(withProvider.exposure.sourceKinds).toEqual(['structured_execution', 'provider_activity']);
        expect(structuredOnly.exposure.sourceKinds).toEqual(['structured_execution']);
        expect(withoutProvenance(withProvider.exposure)).toEqual(withoutProvenance(structuredOnly.exposure));
    });

    it('weekly-role credits are identical with and without the conflicting provider evidence', () => {
        const withProvider = deriveFactsFromOccurrence(occurrence, { structured, provider: provider({ override: conflictingOverride }) }, ENGINE_PERFORMED_TRAINING_CATALOG, descriptor);
        const strip = (credits: typeof withProvider.coverageCredits) => credits.map(({ coverageKey, workoutId, creditKind, reasonCode }) => ({ coverageKey, workoutId, creditKind, reasonCode }));

        expect(strip(withProvider.coverageCredits)).toEqual(strip(structuredOnly.coverageCredits));

        const history = resolveCoverageHistory({
            asOfDate: '2026-09-03', windowDays: 7, revision: 'rev-1',
            exposures: [withProvider.exposure], coverageCredits: withProvider.coverageCredits,
        });
        const strength = buildCoverageState(planDef, '2026-09-03', history, descriptor).requirements.find(r => r.key === 'primary_strength');
        expect(strength?.completedSessions).toBe(1);
    });

    it('without a structured execution the provider evidence is the fallback identity', () => {
        const providerOnly = deriveFactsFromOccurrence(
            { ...occurrence, sourceRefs: [occurrence.sourceRefs[1]], modality: undefined },
            { provider: provider() },
            ENGINE_PERFORMED_TRAINING_CATALOG,
            descriptor,
        );
        expect(providerOnly.exposure.modality).toBe('Running');
        expect(providerOnly.exposure.workoutId).toBeUndefined();
        expect(providerOnly.coverageCredits.some(credit => credit.creditKind === 'exact')).toBe(false);
    });
});
