import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UserGoal } from '../engine/models';

const firestore = vi.hoisted(() => {
    const deleteMarker = Symbol('delete-field');
    return {
        addDoc: vi.fn(),
        collection: vi.fn(),
        deleteDoc: vi.fn(),
        deleteField: vi.fn(() => deleteMarker),
        doc: vi.fn(),
        getDoc: vi.fn(),
        getDocs: vi.fn(),
        query: vi.fn(),
        setDoc: vi.fn(),
        where: vi.fn(),
        deleteMarker,
    };
});

vi.mock('firebase/firestore', () => firestore);
vi.mock('../firebase', () => ({ getDb: vi.fn(() => ({})) }));

import { GoalService } from './goalService';

const eventGoal: UserGoal & { id: string } = {
    id: 'goal-1',
    userId: 'u1',
    category: 'short-term',
    domain: 'endurance',
    title: 'Road race',
    priority: 5,
    status: 'active',
    targetDate: '2026-09-13',
    eventCategory: 'cycling_event',
    eventPreset: 'road_race',
    eventLifecycle: 'scheduled',
    schemaVersion: 1,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
};

describe('GoalService persistence shape', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        firestore.collection.mockReturnValue({ path: 'goals' });
        firestore.doc.mockReturnValue({ path: 'goal-1' });
        firestore.addDoc.mockResolvedValue({ id: 'goal-1' });
        firestore.setDoc.mockResolvedValue(undefined);
        firestore.getDoc.mockResolvedValue({
            exists: () => true,
            data: () => eventGoal,
            id: eventGoal.id,
        });
    });

    it('removes category and former event fields when a dated event becomes a plain dated goal', async () => {
        const service = new GoalService();
        await service.updateGoal('u1', eventGoal.id, {
            eventCategory: null,
            eventPreset: null,
            eventLifecycle: undefined,
        });

        const payload = firestore.setDoc.mock.calls[0][1] as Record<string, unknown>;
        expect(payload.category).toBe(firestore.deleteMarker);
        expect(payload.eventCategory).toBe(firestore.deleteMarker);
        expect(payload.eventPreset).toBe(firestore.deleteMarker);
        expect(payload.eventLifecycle).toBe(firestore.deleteMarker);
    });

    it('does not write a derived category for a newly created dated goal', async () => {
        const service = new GoalService();
        await service.createGoal('u1', eventGoal);

        const payload = firestore.addDoc.mock.calls[0][1] as Record<string, unknown>;
        expect(payload).not.toHaveProperty('category');
        expect(payload.eventCategory).toBe('cycling_event');
        expect(payload.eventPreset).toBe('road_race');
    });
});
