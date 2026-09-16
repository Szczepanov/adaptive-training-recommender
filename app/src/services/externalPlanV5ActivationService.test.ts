import { describe, expect, it, vi } from 'vitest';
import { activateIntentBlocksFromPlan, externalIntentBlockId, type IntentBlockActivationServiceDependency } from './externalPlanV5ActivationService';
import { EXTERNAL_PLAN_SCHEMA_V5, type ExternalIntentBlockV5, type ExternalTrainingPlanV5 } from '../sessions/externalPlanV5';
import type { IntentBlockHeader } from './intentBlockService';
import type { BlockObjectiveDefinition } from '../engine/blockIntent';

function objective(): BlockObjectiveDefinition {
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
    };
}

function entry(overrides: Partial<ExternalIntentBlockV5> = {}): ExternalIntentBlockV5 {
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

function plan(overrides: Partial<ExternalTrainingPlanV5> = {}): ExternalTrainingPlanV5 {
    return {
        schema: EXTERNAL_PLAN_SCHEMA_V5,
        planId: 'v5-import-1',
        revision: 1,
        title: 'Imported v5 plan',
        startDate: '2026-08-17',
        weekCount: 4,
        sessions: [],
        restDays: [],
        intentBlocks: [entry()],
        ...overrides,
    };
}

function header(overrides: Partial<IntentBlockHeader> = {}): IntentBlockHeader {
    return {
        userId: 'user-1',
        blockId: 'v5-import-1::block-1',
        revision: 1,
        contentHash: 'a'.repeat(64),
        sourcePlanId: 'v5-import-1',
        sourcePlanRevision: 1,
        createdAt: '2026-08-17T00:00:00.000Z',
        updatedAt: '2026-08-17T00:00:00.000Z',
        ...overrides,
    };
}

describe('activateIntentBlocksFromPlan', () => {
    it('returns [] for a plan with no intentBlocks -- absence never triggers a Firestore call', async () => {
        const getHeaderState = vi.fn();
        const save = vi.fn();
        const results = await activateIntentBlocksFromPlan('user-1', plan({ intentBlocks: undefined }), { getHeaderState, save });
        expect(results).toEqual([]);
        expect(getHeaderState).not.toHaveBeenCalled();
        expect(save).not.toHaveBeenCalled();
    });

    it('saves a first revision (revision 1) for a block with no existing header', async () => {
        const getHeaderState = vi.fn().mockResolvedValue({ status: 'MISSING' });
        const save = vi.fn().mockResolvedValue(header());
        const service: IntentBlockActivationServiceDependency = { getHeaderState, save };

        const results = await activateIntentBlocksFromPlan('user-1', plan(), service);

        expect(results).toEqual([{ entryId: 'block-1', blockId: 'v5-import-1::block-1', outcome: { status: 'saved', header: header() } }]);
        expect(save).toHaveBeenCalledTimes(1);
        const [userId, block, options] = save.mock.calls[0];
        expect(userId).toBe('user-1');
        expect(block.id).toBe('v5-import-1::block-1');
        expect(block.revision).toBe(1);
        expect(block.sourcePlanId).toBe('v5-import-1');
        expect(block.sourcePlanRevision).toBe(1);
        expect(block.dateRange).toEqual({ startDate: '2026-08-17', endDate: '2026-08-30' });
        expect(options).toEqual({ sourceSchemaVersion: EXTERNAL_PLAN_SCHEMA_V5, sourceRef: 'v5-import-1@1' });
    });

    it('continues an existing block\'s revision sequence for a newer source-plan revision', async () => {
        const getHeaderState = vi.fn().mockResolvedValue({ status: 'AVAILABLE', data: header({ revision: 4 }) });
        const save = vi.fn().mockResolvedValue(header({ revision: 5, sourcePlanRevision: 2 }));
        const results = await activateIntentBlocksFromPlan('user-1', plan({ revision: 2 }), { getHeaderState, save });

        expect(results[0].outcome).toEqual({ status: 'saved', header: header({ revision: 5, sourcePlanRevision: 2 }) });
        expect(save.mock.calls[0][1].revision).toBe(5);
        expect(save.mock.calls[0][1].sourcePlanRevision).toBe(2);
    });

    it('is idempotent for the same immutable source-plan revision', async () => {
        const existing = header({ revision: 4, sourcePlanRevision: 1 });
        const getHeaderState = vi.fn().mockResolvedValue({ status: 'AVAILABLE', data: existing });
        const save = vi.fn();

        const results = await activateIntentBlocksFromPlan('user-1', plan({ revision: 1 }), { getHeaderState, save });

        expect(results).toEqual([{ entryId: 'block-1', blockId: 'v5-import-1::block-1', outcome: { status: 'saved', header: existing } }]);
        expect(save).not.toHaveBeenCalled();
    });

    it('fails closed when the existing header cannot be read safely', async () => {
        const save = vi.fn();
        const unavailable = await activateIntentBlocksFromPlan('user-1', plan(), {
            getHeaderState: vi.fn().mockResolvedValue({ status: 'UNAVAILABLE', operation: 'read intent block header', retryable: true, message: 'network down' }),
            save,
        });
        const invalid = await activateIntentBlocksFromPlan('user-1', plan(), {
            getHeaderState: vi.fn().mockResolvedValue({ status: 'INVALID', issues: [{ code: 'path-identity-mismatch' }] }),
            save,
        });

        expect(unavailable[0].outcome.status).toBe('failed');
        expect(unavailable[0].outcome.status === 'failed' && unavailable[0].outcome.message).toContain('network down');
        expect(invalid[0].outcome.status).toBe('failed');
        expect(invalid[0].outcome.status === 'failed' && invalid[0].outcome.message).toContain('invalid');
        expect(save).not.toHaveBeenCalled();
    });

    it('refuses stale or colliding source ownership instead of overwriting it', async () => {
        const save = vi.fn();
        const stale = await activateIntentBlocksFromPlan('user-1', plan({ revision: 1 }), {
            getHeaderState: vi.fn().mockResolvedValue({ status: 'AVAILABLE', data: header({ revision: 4, sourcePlanRevision: 2 }) }),
            save,
        });
        const collision = await activateIntentBlocksFromPlan('user-1', plan({ revision: 2 }), {
            getHeaderState: vi.fn().mockResolvedValue({ status: 'AVAILABLE', data: header({ revision: 4, sourcePlanId: 'some-other-source' }) }),
            save,
        });

        expect(stale[0].outcome.status).toBe('failed');
        expect(stale[0].outcome.status === 'failed' && stale[0].outcome.message).toContain('newer source plan revision');
        expect(collision[0].outcome.status).toBe('failed');
        expect(collision[0].outcome.status === 'failed' && collision[0].outcome.message).toContain('already owned');
        expect(save).not.toHaveBeenCalled();
    });

    it('derives the same blockId across revisions of the same plan, namespaced by planId', () => {
        expect(externalIntentBlockId('v5-import-1', 'block-1')).toBe('v5-import-1::block-1');
    });

    it('reports one block\'s failure without throwing and without blocking other blocks', async () => {
        const getHeaderState = vi.fn().mockResolvedValue({ status: 'MISSING' });
        const save = vi.fn()
            .mockRejectedValueOnce(new Error('IntentBlock validation failed: boom'))
            .mockResolvedValueOnce(header({ blockId: 'v5-import-1::block-2' }));

        const results = await activateIntentBlocksFromPlan(
            'user-1',
            plan({ intentBlocks: [entry({ id: 'block-1' }), entry({ id: 'block-2' })] }),
            { getHeaderState, save },
        );

        expect(results).toHaveLength(2);
        expect(results[0].outcome.status).toBe('failed');
        expect(results[0].outcome.status === 'failed' && results[0].outcome.message).toContain('boom');
        expect(results[1].outcome.status).toBe('saved');
    });
});
