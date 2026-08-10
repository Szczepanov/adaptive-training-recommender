import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthoredPlanBlock } from '../engine/models';

const firestore = vi.hoisted(() => ({
    addDoc: vi.fn(), collection: vi.fn(), deleteDoc: vi.fn(), doc: vi.fn(), getDocs: vi.fn(), query: vi.fn(), setDoc: vi.fn(), where: vi.fn(),
}));

vi.mock('firebase/firestore', () => firestore);
vi.mock('../firebase', () => ({ getDb: vi.fn(() => ({})) }));

import { PlanBlockService } from './planBlockService';

const travel: Omit<AuthoredPlanBlock, 'id' | 'userId' | 'createdAt' | 'updatedAt'> = {
    eventId: 'road-race', phase: 'travel', startDate: '2026-08-19', endDate: '2026-08-22', volumeScale: 0.6, intensityScale: 0.5,
};

describe('PlanBlockService persistence shape', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        firestore.collection.mockReturnValue({ path: 'plan_blocks' });
        firestore.doc.mockReturnValue({ path: 'plan_blocks/trip-august' });
        firestore.addDoc.mockResolvedValue({ id: 'trip-august' });
        firestore.setDoc.mockResolvedValue(undefined);
    });

    it('stores the document id only in the Firestore path, not the payload', async () => {
        const service = new PlanBlockService();
        const created = await service.create('u1', travel);

        expect(created.id).toBe('trip-august');
        const payload = firestore.addDoc.mock.calls[0][1] as Record<string, unknown>;
        expect(payload).not.toHaveProperty('id');
        expect(payload).toMatchObject({ userId: 'u1', phase: 'travel', startDate: '2026-08-19' });
    });

    it('fails closed when persisted plan blocks are malformed', async () => {
        firestore.getDocs.mockResolvedValue({ docs: [{ id: 'bad', data: () => ({ userId: 'u1', phase: 'travel', startDate: '2026-08-22', endDate: '2026-08-19', volumeScale: 0.6, intensityScale: 0.5 }) }] });
        const state = await new PlanBlockService().getBlocksInRangeState('u1', '2026-08-01', '2026-08-31');
        expect(state.status).toBe('INVALID');
    });
});
