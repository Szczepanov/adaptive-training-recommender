import { describe, expect, it } from 'vitest';
import {
    validateExternalTrainingPlanV5,
    resolveExternalIntentBlock,
    isV5Plan,
    EXTERNAL_PLAN_SCHEMA_V5,
    type ExternalIntentBlockV5,
} from './externalPlanV5';
import { validateExternalTrainingPlanV4, EXTERNAL_PLAN_SCHEMA_V4 } from './externalPlanV4';
import type { BlockObjectiveDefinition, BlockProgressionContract } from '../engine/blockIntent';

import fixture01 from './fixtures/01-full-body-maintenance.json';

function objective(overrides: Partial<BlockObjectiveDefinition> = {}): BlockObjectiveDefinition {
    return {
        id: 'obj-1',
        sport: 'cycling',
        adaptationScope: 'zone2_aerobic',
        coverageKey: 'aerobic_volume',
        intent: 'maintain',
        priority: 'must_have',
        doseEnvelope: { min: 60, target: 90, max: 120, unit: 'minutes', floorSemantics: 'soft_floor' },
        knowledgeLineage: ['claim-1'],
        successCriteria: { minCompletedExposures: 2 },
        ...overrides,
    };
}

function progressionContract(targetBinding: BlockProgressionContract['targetBinding']): BlockProgressionContract {
    return {
        targetBinding,
        variable: 'duration_min',
        unit: 'minutes',
        currentValue: 90,
        permittedRange: { min: 60, max: 120 },
        increment: 10,
        knowledgeLineage: ['claim-1'],
        observationWindowDays: 14,
        minCompletedExposures: 2,
        requiredFollowUpCoveragePct: 80,
        reviewCadenceDays: 14,
        redirectCriteria: { triggers: ['adverse_response'] },
    };
}

function intentBlock(overrides: Partial<ExternalIntentBlockV5> = {}): ExternalIntentBlockV5 {
    return {
        id: 'block-1',
        startWeek: 1,
        startDay: 'monday',
        endWeek: 2,
        endDay: 'sunday',
        objectives: [objective()],
        reviewCadenceDays: 14,
        nextReviewWeek: 2,
        nextReviewDay: 'sunday',
        ...overrides,
    };
}

function planV5(overrides: Record<string, unknown> = {}) {
    return {
        schema: EXTERNAL_PLAN_SCHEMA_V5,
        planId: 'v5-import-1',
        revision: 1,
        title: 'Imported v5 plan',
        startDate: '2026-08-17', // a Monday
        weekCount: 4,
        sessions: [
            {
                id: 'w1-session', title: 'Full Body Maintenance', priority: 'key',
                placement: { week: 1, preferredDay: 'monday', flexibility: 'preferred', ifMissed: 'reschedule_within_week' },
                gating: { modality: 'strength', intensity: 'moderate', durationMin: 45, durationMax: 55, environment: 'either', equipment: [] },
                definition: fixture01,
            },
        ],
        restDays: [],
        ...overrides,
    };
}

describe('external-plan@5 (ADR-0037 D-SCHEMA)', () => {
    it('validates a well-formed v5 plan with one intent block', () => {
        const result = validateExternalTrainingPlanV5(planV5({ intentBlocks: [intentBlock()] }));
        expect(result.isValid).toBe(true);
        expect(result.data?.intentBlocks).toHaveLength(1);
    });

    it('accepts a plan with intentBlocks entirely absent -- retains the inherited v4 contract', () => {
        const plan = planV5() as Record<string, unknown>;
        delete plan.intentBlocks;
        const result = validateExternalTrainingPlanV5(plan);
        expect(result.isValid).toBe(true);
        expect(result.data?.intentBlocks).toBeUndefined();
    });

    it('isV5Plan narrows on the schema literal', () => {
        expect(isV5Plan({ schema: EXTERNAL_PLAN_SCHEMA_V5 })).toBe(true);
        expect(isV5Plan({ schema: EXTERNAL_PLAN_SCHEMA_V4 })).toBe(false);
    });

    it('rejects malformed intentBlocks entries without throwing', () => {
        for (const malformed of [null, 42, 'block', []]) {
            expect(() => validateExternalTrainingPlanV5(planV5({ intentBlocks: [malformed] }))).not.toThrow();
            const result = validateExternalTrainingPlanV5(planV5({ intentBlocks: [malformed] }));
            expect(result.isValid).toBe(false);
        }
    });

    it('rejects malformed nested intent data without throwing across the external JSON boundary', () => {
        const malformed = { ...intentBlock(), objectives: [null] };
        expect(() => validateExternalTrainingPlanV5(planV5({ intentBlocks: [malformed] }))).not.toThrow();
        const result = validateExternalTrainingPlanV5(planV5({ intentBlocks: [malformed] }));
        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.field === 'intentBlocks' && e.message.includes('malformed nested'))).toBe(true);
    });

    it('rejects an intentBlocks entry missing required relative-date fields', () => {
        const bad = intentBlock() as unknown as Record<string, unknown>;
        delete bad.startWeek;
        const result = validateExternalTrainingPlanV5(planV5({ intentBlocks: [bad] }));
        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.field === 'intentBlocks[0].startWeek')).toBe(true);
    });

    it('rejects an out-of-range week and an unsupported weekday', () => {
        const result = validateExternalTrainingPlanV5(planV5({
            intentBlocks: [intentBlock({ startWeek: 99, endDay: 'holiday' as never })],
        }));
        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.field === 'intentBlocks[0].startWeek')).toBe(true);
        expect(result.errors.some(e => e.field === 'intentBlocks[0].endDay')).toBe(true);
    });

    it('rejects an unrecognized field on an intent block', () => {
        const result = validateExternalTrainingPlanV5(planV5({
            intentBlocks: [{ ...intentBlock(), extraField: 'nope' }],
        }));
        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.message.includes('extraField'))).toBe(true);
    });

    it('rejects duplicate intent block ids within the plan', () => {
        const result = validateExternalTrainingPlanV5(planV5({
            intentBlocks: [intentBlock({ id: 'dup' }), intentBlock({ id: 'dup' })],
        }));
        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.message.includes('unique'))).toBe(true);
    });

    it('rejects an intent block id longer than the Firestore boundary', () => {
        const result = validateExternalTrainingPlanV5(planV5({
            intentBlocks: [intentBlock({ id: 'b'.repeat(65) })],
        }));
        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.field === 'intentBlocks[0].id')).toBe(true);
    });

    it('rejects an intent block id containing a Firestore path separator', () => {
        const result = validateExternalTrainingPlanV5(planV5({
            intentBlocks: [intentBlock({ id: 'strength/base' })],
        }));
        expect(result.isValid).toBe(false);
        expect(result.errors).toContainEqual(expect.objectContaining({ field: 'intentBlocks[0].id', message: expect.stringContaining('/') }));
    });

    it('rejects more than EXTERNAL_PLAN_MAX_WEEKS intent blocks', () => {
        const blocks = Array.from({ length: 27 }, (_, i) => intentBlock({ id: `block-${i}`, startWeek: 1, endWeek: 1 }));
        const result = validateExternalTrainingPlanV5(planV5({ weekCount: 1, intentBlocks: blocks }));
        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.field === 'intentBlocks')).toBe(true);
    });

    it('delegates deep objective validation to engine/blockIntent.ts -- an invalid dose envelope is rejected', () => {
        const result = validateExternalTrainingPlanV5(planV5({
            intentBlocks: [intentBlock({
                objectives: [objective({ doseEnvelope: { min: 100, target: 50, max: 120, unit: 'minutes', floorSemantics: 'soft_floor' } })],
            })],
        }));
        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.message.includes('INVERTED_DOSE_BOUNDS') || e.field.includes('doseEnvelope'))).toBe(true);
    });

    it('rejects two intent blocks that overlap in date range (via validatePlanIntentBlocks)', () => {
        const result = validateExternalTrainingPlanV5(planV5({
            intentBlocks: [
                intentBlock({ id: 'a', startWeek: 1, startDay: 'monday', endWeek: 2, endDay: 'sunday' }),
                intentBlock({ id: 'b', startWeek: 2, startDay: 'monday', endWeek: 3, endDay: 'sunday' }),
            ],
        }));
        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.message.includes('overlap'))).toBe(true);
    });

    it('rejects a protectedRoles session reference dangling outside this plan\'s sessions', () => {
        const result = validateExternalTrainingPlanV5(planV5({
            intentBlocks: [intentBlock({
                objectives: [objective({ protectedRoles: [{ kind: 'session', sessionId: 'not-a-real-session' }] })],
            })],
        }));
        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.field.includes('protectedRoles') && e.message.includes('not-a-real-session'))).toBe(true);
    });

    it('accepts a protectedRoles session reference that matches a real session in this plan', () => {
        const result = validateExternalTrainingPlanV5(planV5({
            intentBlocks: [intentBlock({
                objectives: [objective({ protectedRoles: [{ kind: 'session', sessionId: 'w1-session' }] })],
            })],
        }));
        expect(result.isValid).toBe(true);
    });

    it('rejects a progressionContract targetBinding session reference dangling outside this plan', () => {
        const result = validateExternalTrainingPlanV5(planV5({
            intentBlocks: [intentBlock({
                progressionContract: progressionContract({ objectiveId: 'obj-1', sessionId: 'ghost-session' }),
            })],
        }));
        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.field.includes('progressionContract.targetBinding.sessionId'))).toBe(true);
    });

    it('rejects a progressionContract targetBinding step reference dangling inside a real session', () => {
        const result = validateExternalTrainingPlanV5(planV5({
            intentBlocks: [intentBlock({
                progressionContract: progressionContract({ objectiveId: 'obj-1', sessionId: 'w1-session', stepId: 'ghost-step' }),
            })],
        }));
        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.field.includes('progressionContract.targetBinding.stepId') && e.message.includes('ghost-step'))).toBe(true);
    });

    it('accepts a progressionContract step reference that resolves inside the named session', () => {
        const result = validateExternalTrainingPlanV5(planV5({
            intentBlocks: [intentBlock({
                progressionContract: progressionContract({ objectiveId: 'obj-1', sessionId: 'w1-session', stepId: 'step-warmup-1' }),
            })],
        }));
        expect(result.isValid).toBe(true);
    });

    it('inherits v4 intraday/rest contracts unchanged -- session-level intraday still validates', () => {
        const plan = planV5({
            sessions: [{
                id: 'w1-session', title: 'AM Ride', priority: 'key',
                placement: { week: 1, preferredDay: 'monday', flexibility: 'fixed', ifMissed: 'drop' },
                gating: { modality: 'cycling', intensity: 'moderate', durationMin: 45, durationMax: 55, environment: 'outdoor', equipment: [] },
                definition: fixture01,
                intraday: { window: { startLocal: '06:00', endLocal: '07:00' }, bundleId: 'double', order: 0 },
            }],
        });
        const result = validateExternalTrainingPlanV5(plan);
        expect(result.isValid).toBe(true);
    });

    it('v4 continues to reject an intentBlocks field -- it is v5-only', () => {
        const result = validateExternalTrainingPlanV4(planV5({ schema: EXTERNAL_PLAN_SCHEMA_V4, intentBlocks: [intentBlock()] }));
        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.message.includes('intentBlocks'))).toBe(true);
    });

    it('rejects the wrong schema literal', () => {
        const result = validateExternalTrainingPlanV5(planV5({ schema: EXTERNAL_PLAN_SCHEMA_V4 }));
        expect(result.isValid).toBe(false);
        expect(result.errors).toContainEqual(expect.objectContaining({ field: 'schema' }));
    });
});

describe('resolveExternalIntentBlock', () => {
    it('resolves relative week/day boundaries to absolute dates against the plan startDate', () => {
        const block = resolveExternalIntentBlock(
            { planId: 'v5-import-1', revision: 3, startDate: '2026-08-17' }, // a Monday
            intentBlock({ startWeek: 1, startDay: 'monday', endWeek: 2, endDay: 'sunday', nextReviewWeek: 2, nextReviewDay: 'sunday' }),
            5,
        );
        expect(block.dateRange).toEqual({ startDate: '2026-08-17', endDate: '2026-08-30' });
        expect(block.reviewSchedule.nextReviewDate).toBe('2026-08-30');
        expect(block.sourcePlanId).toBe('v5-import-1');
        expect(block.sourcePlanRevision).toBe(3);
        expect(block.revision).toBe(5);
    });
});
