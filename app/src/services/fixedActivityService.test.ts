import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FixedActivity } from '../engine/models';

const firestore = vi.hoisted(() => {
    return {
        addDoc: vi.fn(),
        collection: vi.fn(),
        deleteField: vi.fn(() => 'delete-field-marker'),
        deleteDoc: vi.fn(),
        doc: vi.fn(),
        getDoc: vi.fn(),
        getDocs: vi.fn(),
        query: vi.fn(),
        setDoc: vi.fn(),
        where: vi.fn(),
    };
});

vi.mock('firebase/firestore', () => firestore);
vi.mock('../firebase', () => ({ getDb: vi.fn(() => ({})) }));

import { FixedActivityService } from './fixedActivityService';

const validActivity: Omit<FixedActivity, 'id' | 'userId' | 'createdAt' | 'updatedAt'> = {
    title: 'Evening Football',
    date: '2026-08-12',
    durationMin: 90,
    fixed: true,
    environment: 'outdoor',
    equipment: ['cleats'],
    expectedStimulus: { aerobicEndurance: 0.6, repeatedSurges: 0.4 },
    expectedCost: { systemic: 0.8, lowerBody: 0.5 },
    isCompleted: false,
};

describe('FixedActivityService persistence shape', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        firestore.collection.mockReturnValue({ path: 'fixed_activities' });
        firestore.doc.mockReturnValue({ path: 'fixed_activities/activity-1' });
        firestore.addDoc.mockResolvedValue({ id: 'activity-1' });
        firestore.setDoc.mockResolvedValue(undefined);
        firestore.getDoc.mockResolvedValue({
            exists: () => true,
            data: () => ({ ...validActivity, userId: 'u1', createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z' }),
            id: 'activity-1',
        });
    });

    it('creates a valid activity and returns it with the generated document id, but without an id field in the stored payload', async () => {
        const service = new FixedActivityService();
        const result = await service.createActivity('u1', validActivity);

        expect(result.id).toBe('activity-1');
        const payload = firestore.addDoc.mock.calls[0][1] as Record<string, unknown>;
        expect(payload).not.toHaveProperty('id');
        expect(payload.userId).toBe('u1');
        expect(payload.fixed).toBe(true);
        expect(payload.environment).toBe('outdoor');
    });

    it('rejects creating an activity with an out-of-range expectedCost value', async () => {
        const service = new FixedActivityService();
        await expect(service.createActivity('u1', {
            ...validActivity,
            expectedCost: { systemic: 1.5 },
        })).rejects.toThrow(/Validation failed/);
        expect(firestore.addDoc).not.toHaveBeenCalled();
    });

    it('rejects creating an activity missing the required fixed field', async () => {
        const service = new FixedActivityService();
        const withoutFixed: Record<string, unknown> = { ...validActivity };
        delete withoutFixed.fixed;
        await expect(service.createActivity('u1', withoutFixed as typeof validActivity)).rejects.toThrow(/Validation failed/);
    });

    it('markCompleted merges isCompleted true while preserving createdAt', async () => {
        const service = new FixedActivityService();
        await service.markCompleted('u1', 'activity-1');

        const payload = firestore.setDoc.mock.calls[0][1] as Record<string, unknown>;
        expect(payload.isCompleted).toBe(true);
        expect(payload.createdAt).toBe('2026-08-01T00:00:00.000Z');
    });

    it('flags a malformed persisted document as INVALID rather than silently dropping it', async () => {
        firestore.getDocs.mockResolvedValue({
            docs: [
                { id: 'bad-1', data: () => ({ ...validActivity, userId: 'u1', durationMin: -5, createdAt: 'x', updatedAt: 'x' }) },
            ],
        });
        const service = new FixedActivityService();
        const state = await service.getActivitiesInRangeState('u1', '2026-08-01', '2026-08-31');
        expect(state.status).toBe('INVALID');
    });

    it('reads valid activities within range for the correct owner', async () => {
        firestore.getDocs.mockResolvedValue({
            docs: [
                { id: 'activity-1', data: () => ({ ...validActivity, userId: 'u1', createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z' }) },
            ],
        });
        const service = new FixedActivityService();
        const state = await service.getActivitiesInRangeState('u1', '2026-08-01', '2026-08-31');
        expect(state.status).toBe('AVAILABLE');
        if (state.status === 'AVAILABLE') {
            expect(state.data).toHaveLength(1);
            expect(state.data[0].title).toBe('Evening Football');
        }
    });

    it('keeps a schema-valid activity available when its catalog identity is stale', async () => {
        firestore.getDocs.mockResolvedValue({
            docs: [
                { id: 'stale-identity', data: () => ({ ...validActivity, templateId: 'removed_template', userId: 'u1', createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z' }) },
            ],
        });
        const service = new FixedActivityService();
        const state = await service.getActivitiesInRangeState('u1', '2026-08-01', '2026-08-31');

        expect(state.status).toBe('AVAILABLE');
        if (state.status === 'AVAILABLE') {
            expect(state.data).toHaveLength(1);
            expect(state.data[0]).not.toHaveProperty('templateId');
            expect(state.issues).toEqual([expect.objectContaining({ code: 'catalog-identity-unresolved' })]);
        }
    });

    it('listAll drops a malformed persisted document rather than surfacing it to UI callers', async () => {
        firestore.getDocs.mockResolvedValue({
            docs: [
                { id: 'good-1', data: () => ({ ...validActivity, userId: 'u1', createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z' }) },
                { id: 'bad-1', data: () => ({ ...validActivity, userId: 'u1', durationMin: -5, createdAt: 'x', updatedAt: 'x' }) },
            ],
        });
        const service = new FixedActivityService();
        const result = await service.listAll('u1');
        expect(result).toHaveLength(1);
        expect(result[0].id).toBe('good-1');
    });

    it('getActivity returns null for a malformed persisted document instead of an unvalidated cast', async () => {
        firestore.getDoc.mockResolvedValue({
            exists: () => true,
            data: () => ({ ...validActivity, userId: 'u1', durationMin: -5, createdAt: 'x', updatedAt: 'x' }),
            id: 'bad-1',
        });
        const service = new FixedActivityService();
        const result = await service.getActivity('u1', 'bad-1');
        expect(result).toBeNull();
    });

    it('getActivity returns null for a valid but differently-owned document rather than trusting the doc path alone', async () => {
        firestore.getDoc.mockResolvedValue({
            exists: () => true,
            data: () => ({ ...validActivity, userId: 'someone-else', createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z' }),
            id: 'activity-1',
        });
        const service = new FixedActivityService();
        const result = await service.getActivity('u1', 'activity-1');
        expect(result).toBeNull();
    });

    it('returns an identity-stripped activity so an update can repair a stale catalog reference', async () => {
        firestore.getDoc.mockResolvedValue({
            exists: () => true,
            data: () => ({ ...validActivity, templateId: 'removed_template', userId: 'u1', createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z' }),
            id: 'activity-1',
        });
        const service = new FixedActivityService();

        const result = await service.getActivity('u1', 'activity-1');
        expect(result).not.toBeNull();
        expect(result).not.toHaveProperty('templateId');
    });

    it('deletes explicitly cleared catalog identity fields during merge updates', async () => {
        firestore.getDoc.mockResolvedValue({
            exists: () => true,
            data: () => ({ ...validActivity, templateId: 'end_easy_01', userId: 'u1', createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z' }),
            id: 'activity-1',
        });
        const service = new FixedActivityService();

        const result = await service.updateActivity('u1', 'activity-1', { templateId: null });
        const payload = firestore.setDoc.mock.calls[0][1] as Record<string, unknown>;
        expect(result).not.toHaveProperty('templateId');
        expect(payload.templateId).toBe('delete-field-marker');
    });
});
