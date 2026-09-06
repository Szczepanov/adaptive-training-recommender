import { beforeEach, describe, expect, it, vi } from 'vitest';
import fixture01 from '../sessions/fixtures/01-full-body-maintenance.json';
import { EXTERNAL_PLAN_SCHEMA_V4 } from '../sessions/externalPlanV4';

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

function v4Plan(overrides: Record<string, unknown> = {}) {
    return {
        schema: EXTERNAL_PLAN_SCHEMA_V4,
        planId: 'v4-service-integration',
        revision: 2,
        title: 'V4 service integration',
        startDate: '2026-08-17',
        weekCount: 2,
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
            intraday: {
                window: { startLocal: '07:00', endLocal: '08:00' },
                bundleId: 'monday-double',
                order: 0,
            },
        }],
        restDays: [],
        ...overrides,
    };
}

describe('ExternalPlanService external-plan@4 integration', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        firestore.doc.mockImplementation((_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }));
        firestore.collection.mockImplementation((_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }));
        firestore.getDoc.mockResolvedValue({ exists: () => false });
        firestore.setDoc.mockResolvedValue(undefined);
        firestore.batch.commit.mockResolvedValue(undefined);
    });

    it('dispatches v4 validation on import and persists the immutable v4 bytes', async () => {
        const raw = v4Plan();
        const result = await new ExternalPlanService().import('u1', raw);

        expect(result.status).toBe('AVAILABLE');
        if (result.status !== 'AVAILABLE') throw new Error('unreachable');
        expect(result.data.plan.schema).toBe(EXTERNAL_PLAN_SCHEMA_V4);
        expect(result.data.plan.sessions[0]).toMatchObject({
            id: 'am',
            intraday: { bundleId: 'monday-double', order: 0 },
        });
        expect(firestore.batch.set.mock.calls[0][1]).toEqual(raw);
    });

    it('dispatches v4 validation when immutable revision bytes are read back', async () => {
        firestore.getDoc.mockResolvedValue({ exists: () => true, data: () => v4Plan() });

        const state = await new ExternalPlanService().getRevisionState('u1', 'v4-service-integration', 2);

        expect(state.status).toBe('AVAILABLE');
        if (state.status !== 'AVAILABLE') throw new Error('unreachable');
        expect(state.data.schema).toBe(EXTERNAL_PLAN_SCHEMA_V4);
        expect(state.data.sessions[0]).toMatchObject({
            id: 'am',
            intraday: { window: { startLocal: '07:00', endLocal: '08:00' } },
        });
    });

    it('rejects malformed v4 bytes through the service instead of writing a partial import', async () => {
        const malformed = v4Plan({
            sessions: [{
                ...v4Plan().sessions[0],
                intraday: { bundleId: 'monday-double', order: 0 },
            }],
        });

        const result = await new ExternalPlanService().import('u1', malformed);

        expect(result.status).toBe('INVALID');
        expect(firestore.batch.set).not.toHaveBeenCalled();
        expect(firestore.setDoc).not.toHaveBeenCalled();
    });

    it('includes intraday placement bytes in the immutable content hash', async () => {
        const original = v4Plan();
        const moved = v4Plan({
            sessions: [{
                ...v4Plan().sessions[0],
                intraday: {
                    window: { startLocal: '08:00', endLocal: '09:00' },
                    bundleId: 'monday-double',
                    order: 0,
                },
            }],
        });

        expect(await computeContentHash(original)).not.toBe(await computeContentHash(moved));
    });

    it('accepts a newer v4 revision when a lower revision is already active', async () => {
        firestore.getDoc.mockResolvedValue({ exists: () => true, data: () => ({ revision: 1 }) });

        const result = await new ExternalPlanService().import('u1', v4Plan({ revision: 2 }));

        expect(result.status).toBe('AVAILABLE');
    });
});
