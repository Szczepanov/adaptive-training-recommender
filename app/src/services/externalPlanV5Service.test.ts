import { beforeEach, describe, expect, it, vi } from 'vitest';
import fixture01 from '../sessions/fixtures/01-full-body-maintenance.json';
import { EXTERNAL_PLAN_SCHEMA_V4 } from '../sessions/externalPlanV4';
import { EXTERNAL_PLAN_SCHEMA_V5 } from '../sessions/externalPlanV5';

const firestore = vi.hoisted(() => {
    const batch = {
        set: vi.fn(),
        commit: vi.fn().mockResolvedValue(undefined),
    };
    return {
        collection: vi.fn(), doc: vi.fn(), getDoc: vi.fn(), getDocs: vi.fn(), setDoc: vi.fn(),
        writeBatch: vi.fn(() => batch),
        batch,
    };
});

vi.mock('firebase/firestore', () => firestore);
vi.mock('../firebase', () => ({ getDb: vi.fn(() => ({})) }));

import { computeContentHash, ExternalPlanService } from './externalPlanService';

function v5Plan(overrides: Record<string, unknown> = {}) {
    return {
        schema: EXTERNAL_PLAN_SCHEMA_V5,
        planId: 'v5-service-integration',
        revision: 2,
        title: 'V5 service integration',
        startDate: '2026-08-17',
        weekCount: 4,
        sessions: [{
            id: 'am',
            title: 'AM strength',
            priority: 'key',
            placement: { week: 1, preferredDay: 'monday', flexibility: 'preferred', ifMissed: 'drop' },
            gating: {
                modality: 'strength', intensity: 'moderate', durationMin: 45, durationMax: 55,
                environment: 'either', equipment: [],
            },
            definition: fixture01,
        }],
        restDays: [],
        intentBlocks: [{
            id: 'block-1',
            startWeek: 1,
            startDay: 'monday',
            endWeek: 4,
            endDay: 'sunday',
            objectives: [{
                id: 'obj-1',
                sport: 'strength',
                adaptationScope: 'strength_maintenance',
                coverageKey: 'primary_strength',
                intent: 'maintain',
                priority: 'must_have',
                doseEnvelope: { min: 30, target: 45, max: 55, unit: 'minutes', floorSemantics: 'soft_floor' },
                knowledgeLineage: ['claim-1'],
                successCriteria: { minCompletedExposures: 2 },
            }],
            reviewCadenceDays: 28,
            nextReviewWeek: 4,
            nextReviewDay: 'sunday',
        }],
        ...overrides,
    };
}

describe('ExternalPlanService external-plan@5 integration', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        firestore.doc.mockImplementation((_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }));
        firestore.collection.mockImplementation((_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }));
        firestore.getDoc.mockResolvedValue({ exists: () => false });
        firestore.setDoc.mockResolvedValue(undefined);
        firestore.batch.commit.mockResolvedValue(undefined);
    });

    it('dispatches v5 validation on import and persists the immutable v5 bytes, including intentBlocks', async () => {
        const raw = v5Plan();
        const result = await new ExternalPlanService().import('u1', raw);

        expect(result.status).toBe('AVAILABLE');
        if (result.status !== 'AVAILABLE') throw new Error('unreachable');
        expect(result.data.plan.schema).toBe(EXTERNAL_PLAN_SCHEMA_V5);
        expect((result.data.plan as { intentBlocks?: unknown[] }).intentBlocks).toHaveLength(1);
        expect(firestore.batch.set.mock.calls[0][1]).toEqual(raw);
    });

    it('dispatches v5 validation when immutable revision bytes are read back', async () => {
        firestore.getDoc.mockResolvedValue({ exists: () => true, data: () => v5Plan() });

        const state = await new ExternalPlanService().getRevisionState('u1', 'v5-service-integration', 2);

        expect(state.status).toBe('AVAILABLE');
        if (state.status !== 'AVAILABLE') throw new Error('unreachable');
        expect(state.data.schema).toBe(EXTERNAL_PLAN_SCHEMA_V5);
    });

    it('rejects malformed v5 bytes (overlapping intent blocks) through the service instead of writing a partial import', async () => {
        const malformed = v5Plan({
            intentBlocks: [
                ...v5Plan().intentBlocks,
                { ...v5Plan().intentBlocks[0], id: 'block-2' },
            ],
        });

        const result = await new ExternalPlanService().import('u1', malformed);

        expect(result.status).toBe('INVALID');
        expect(firestore.batch.set).not.toHaveBeenCalled();
        expect(firestore.setDoc).not.toHaveBeenCalled();
    });

    it('accepts a v5 plan with intentBlocks entirely absent', async () => {
        const plan = v5Plan() as Record<string, unknown>;
        delete plan.intentBlocks;
        const result = await new ExternalPlanService().import('u1', plan);
        expect(result.status).toBe('AVAILABLE');
    });

    it('includes intentBlocks bytes in the immutable content hash', async () => {
        const original = v5Plan();
        const changed = v5Plan({
            intentBlocks: [{ ...v5Plan().intentBlocks[0], reviewCadenceDays: 7 }],
        });

        expect(await computeContentHash(original)).not.toBe(await computeContentHash(changed));
    });

    it('allows a newer v5 revision to supersede an existing block when its stable id is retained', async () => {
        firestore.getDoc
            .mockResolvedValueOnce({ exists: () => true, data: () => ({ revision: 2 }) })
            .mockResolvedValueOnce({ exists: () => true, data: () => v5Plan({ revision: 2 }) });

        const result = await new ExternalPlanService().import('u1', v5Plan({ revision: 3 }));

        expect(result.status).toBe('AVAILABLE');
        expect(firestore.batch.set).toHaveBeenCalledTimes(2);
    });

    it('fails closed when the header points to a missing predecessor revision', async () => {
        firestore.getDoc
            .mockResolvedValueOnce({ exists: () => true, data: () => ({ revision: 2 }) })
            .mockResolvedValueOnce({ exists: () => false });

        const result = await new ExternalPlanService().import('u1', v5Plan({ revision: 3 }));

        expect(result.status).toBe('INVALID');
        if (result.status !== 'INVALID') throw new Error('unreachable');
        expect(result.issues).toContainEqual(expect.objectContaining({
            code: 'superseded-revision-missing',
            field: 'revision',
            documentPath: 'users/u1/external_plans/v5-service-integration/revisions/2',
        }));
        expect(firestore.writeBatch).not.toHaveBeenCalled();
    });

    it('fails closed when predecessor bytes do not match the header/path identity', async () => {
        firestore.getDoc
            .mockResolvedValueOnce({ exists: () => true, data: () => ({ revision: 2 }) })
            .mockResolvedValueOnce({ exists: () => true, data: () => v5Plan({ planId: 'different-plan', revision: 2 }) });

        const result = await new ExternalPlanService().import('u1', v5Plan({ revision: 3 }));

        expect(result.status).toBe('INVALID');
        if (result.status !== 'INVALID') throw new Error('unreachable');
        expect(result.issues).toContainEqual(expect.objectContaining({
            code: 'superseded-revision-invalid',
            field: 'revision',
            documentPath: 'users/u1/external_plans/v5-service-integration/revisions/2',
        }));
        expect(firestore.writeBatch).not.toHaveBeenCalled();
    });

    it('rejects implicit retirement when a newer v5 revision omits a previously materializable block id', async () => {
        firestore.getDoc
            .mockResolvedValueOnce({ exists: () => true, data: () => ({ revision: 2 }) })
            .mockResolvedValueOnce({ exists: () => true, data: () => v5Plan({ revision: 2 }) });

        const result = await new ExternalPlanService().import('u1', v5Plan({ revision: 3, intentBlocks: [] }));

        expect(result.status).toBe('INVALID');
        if (result.status !== 'INVALID') throw new Error('unreachable');
        expect(result.issues).toContainEqual(expect.objectContaining({
            code: 'intent-block-retirement-unsupported',
            field: 'intentBlocks.block-1',
        }));
        expect(firestore.writeBatch).not.toHaveBeenCalled();
    });

    it('rejects a schema downgrade that would silently strand v5 intent blocks', async () => {
        firestore.getDoc
            .mockResolvedValueOnce({ exists: () => true, data: () => ({ revision: 2 }) })
            .mockResolvedValueOnce({ exists: () => true, data: () => v5Plan({ revision: 2 }) });
        const downgraded = v5Plan({ schema: EXTERNAL_PLAN_SCHEMA_V4, revision: 3 }) as Record<string, unknown>;
        delete downgraded.intentBlocks;

        const result = await new ExternalPlanService().import('u1', downgraded);

        expect(result.status).toBe('INVALID');
        if (result.status !== 'INVALID') throw new Error('unreachable');
        expect(result.issues).toContainEqual(expect.objectContaining({
            code: 'intent-block-retirement-unsupported',
            field: 'schema',
        }));
        expect(firestore.writeBatch).not.toHaveBeenCalled();
    });
});