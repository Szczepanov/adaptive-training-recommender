import { describe, expect, it } from 'vitest';
import type { SessionDefinition } from '../sessions/models';
import type { DailyReadiness, PlannedDose, UserContext } from './models';
import type { ResolvedAvailability } from './schedule';
import type { evaluateReadinessAndSafetyEnvelope } from './rules';
import { adjudicateAuthoredSession, createAuthoredSessionTemplate } from './authoredSessionGates';

type EnvelopeState = ReturnType<typeof evaluateReadinessAndSafetyEnvelope>;

describe('authoredSessionGates (ADR-0023 / D-MAUTH / D-CANDIDATE)', () => {
    const sampleDefinition: SessionDefinition = {
        schemaVersion: 1,
        id: 'test-session',
        revision: 1,
        title: 'Threshold Run & Core',
        intent: 'training',
        dominantModality: 'Running',
        duration: { min: 45, max: 60 },
        blocks: [
            {
                id: 'b1',
                role: 'main',
                executionMode: 'sequential',
                steps: [
                    {
                        id: 's1',
                        kind: 'exercise',
                        exerciseRef: { kind: 'catalog', exerciseId: 'interval_run' },
                        dose: { kind: 'distance', meters: 1000 },
                    },
                    {
                        id: 's2',
                        kind: 'exercise',
                        exerciseRef: { kind: 'catalog', exerciseId: 'plank' },
                        dose: { kind: 'duration', seconds: 60 },
                    },
                    {
                        id: 's3',
                        kind: 'exercise',
                        exerciseRef: { kind: 'catalog', exerciseId: 'squat' },
                        dose: { kind: 'repetition', sets: 4, reps: 10 },
                    },
                ],
            },
        ],
    };

    const mockReadiness = {
        subjective: {
            soreness: 2,
            stress: 2,
            fatigue: 2,
            sleepQuality: 4,
            readinessScore: 85,
        },
        objective: null,
    } as unknown as DailyReadiness;

    const mockContext = {
        preferences: {
            avoidedModalities: [],
            deprioritizedModalities: [],
            preferredModalities: ['Running', 'Cycling', 'Strength'],
            conservativeBias: false,
        },
        equipment: ['treadmill', 'free_weights'],
        trainingSettings: {
            equipment: {
                free_weights: true,
                cable_machine: true,
                treadmill: true,
                indoor_bike: true,
                pullup_bar: true,
            },
            guardrails: {
                avoid_high_impact: false,
                avoid_heavy_lower_body: false,
                avoid_overhead_pressing: false,
                avoid_heavy_spinal_loading: false,
            },
            defaults: { weekdayMaxMinutes: 60, weekendMaxMinutes: 90, environment: 'either' },
            preferences: { preferActiveRecovery: false },
            migration: { legacyReviewed: true, migratedAt: '2026-08-01' },
        },
        constraints: {
            hasFreeWeights: true,
            hasCableMachine: true,
            hasTreadmill: true,
            hasIndoorBike: true,
            restrictedModalities: [],
            impliedGuardrails: [],
            restrictedCategories: [],
        },
    } as unknown as UserContext;

    const mockPlannedDose: PlannedDose = {
        volume: 1.0,
        intensity: 1.0,
    };

    const mockAvailability = {
        maxTimeMinutes: 75,
        restrictedModalities: [],
        reservedCapacityCostProfile: 0,
    } as unknown as ResolvedAvailability;

    it('approves an authored session replacement when all gates clear under train mode', () => {
        const envelopeState = {
            mode: 'train',
            envelopes: {
                safety: { restrictedModalities: [], clinicalFlagActive: false },
                plan: { maxAllowableTier: 'Hard' },
            },
            telemetry: {},
        } as unknown as EnvelopeState;

        const verdict = adjudicateAuthoredSession(
            sampleDefinition,
            mockReadiness,
            mockContext,
            envelopeState,
            mockPlannedDose,
            '2026-08-18',
            mockAvailability,
        );

        expect(verdict.decision).toBe('proceed');
        expect(verdict.gateFailures).toHaveLength(0);
        expect(verdict.scaledDefinition).toBeDefined();
        expect(verdict.scaledDefinition?.blocks[0].steps[2].dose).toMatchObject({
            kind: 'repetition',
            sets: 4,
        });
    });

    it('deterministically scales an authored session when mode is modify', () => {
        const envelopeState = {
            mode: 'modify',
            envelopes: {
                safety: { restrictedModalities: [], clinicalFlagActive: false },
                plan: { maxAllowableTier: 'Moderate' },
            },
            telemetry: {},
        } as unknown as EnvelopeState;

        const verdict = adjudicateAuthoredSession(
            sampleDefinition,
            mockReadiness,
            mockContext,
            envelopeState,
            mockPlannedDose,
            '2026-08-18',
            mockAvailability,
        );

        expect(verdict.decision).toBe('scale');
        expect(verdict.scaledDefinition).toBeDefined();
        // 4 sets scaled by ~0.7 -> 3 sets
        expect(verdict.scaledDefinition?.blocks[0].steps[2].dose).toMatchObject({
            kind: 'repetition',
            sets: 3,
        });
    });

    it('rejects an authored high-intensity session when mode is recover', () => {
        const envelopeState = {
            mode: 'recover',
            envelopes: {
                safety: { restrictedModalities: [], clinicalFlagActive: false },
                plan: { maxAllowableTier: 'Rest' },
            },
            telemetry: {},
        } as unknown as EnvelopeState;

        const verdict = adjudicateAuthoredSession(
            sampleDefinition,
            mockReadiness,
            mockContext,
            envelopeState,
            mockPlannedDose,
            '2026-08-18',
            mockAvailability,
        );

        expect(verdict.decision).toBe('reject');
        expect(verdict.gateFailures).toContain('restricted_category');
    });

    it('rejects an authored session when duration exceeds available time budget', () => {
        const envelopeState = {
            mode: 'train',
            envelopes: {
                safety: { restrictedModalities: [], clinicalFlagActive: false },
                plan: { maxAllowableTier: 'Hard' },
            },
            telemetry: {},
        } as unknown as EnvelopeState;

        const tightAvailability = {
            maxTimeMinutes: 30, // Session needs 45-60
            restrictedModalities: [],
            reservedCapacityCostProfile: 0,
        } as unknown as ResolvedAvailability;

        const verdict = adjudicateAuthoredSession(
            sampleDefinition,
            mockReadiness,
            mockContext,
            envelopeState,
            mockPlannedDose,
            '2026-08-18',
            tightAvailability,
        );

        expect(verdict.decision).toBe('reject');
        expect(verdict.gateFailures).toContain('time_limit');
    });

    it('uses the authored modality to derive the category checked by guardrails', () => {
        const strengthDefinition = { ...sampleDefinition, dominantModality: 'Strength' };
        expect(createAuthoredSessionTemplate(strengthDefinition).category).toBe('Full-body Strength');
    });

    it('rejects an additional session when accepted same-day work exhausts the plan ceiling', () => {
        const envelopeState = {
            mode: 'train',
            envelopes: {
                safety: { restrictedModalities: [], clinicalFlagActive: false },
                plan: { maxAllowableTier: 'Easy' },
            },
            telemetry: {},
        } as unknown as EnvelopeState;

        const verdict = adjudicateAuthoredSession(
            sampleDefinition,
            mockReadiness,
            mockContext,
            envelopeState,
            mockPlannedDose,
            '2026-08-18',
            mockAvailability,
            0.3,
        );

        expect(verdict.decision).toBe('reject');
        expect(verdict.gateFailures).toContain('restricted_category');
    });

    it('permits a recovery-intent session in recover mode', () => {
        const envelopeState = {
            mode: 'recover',
            envelopes: {
                safety: { restrictedModalities: [], clinicalFlagActive: false },
                plan: { maxAllowableTier: 'Rest' },
            },
            telemetry: {},
        } as unknown as EnvelopeState;
        const recoveryDefinition = { ...sampleDefinition, intent: 'recovery' as const, dominantModality: 'Mobility' };

        const verdict = adjudicateAuthoredSession(
            recoveryDefinition, mockReadiness, mockContext, envelopeState,
            mockPlannedDose, '2026-08-18', mockAvailability,
        );

        expect(verdict.decision).toBe('proceed');
    });
});
