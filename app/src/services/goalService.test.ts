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

    // ADR-0012 Task 2.3 (EventTiming) -- timing follows the same event-only-field rules
    // as eventCategory/eventPreset/eventLifecycle above.
    it('persists a valid timing object on a newly created dated event goal', async () => {
        const service = new GoalService();
        const timing = { earliestDate: '2026-09-05', latestDate: '2026-09-20', planningDate: '2026-09-05' };
        await service.createGoal('u1', { ...eventGoal, timing });

        const payload = firestore.addDoc.mock.calls[0][1] as Record<string, unknown>;
        expect(payload.timing).toEqual(timing);
    });

    it('persists and clears an authored event taper with the other event-only fields', async () => {
        const service = new GoalService();
        await service.createGoal('u1', { ...eventGoal, taper: { startDate: '2026-09-07' } });
        expect((firestore.addDoc.mock.calls[0][1] as Record<string, unknown>).taper).toEqual({ startDate: '2026-09-07' });

        firestore.getDoc.mockResolvedValue({
            exists: () => true, data: () => ({ ...eventGoal, taper: { startDate: '2026-09-07' } }), id: eventGoal.id,
        });
        await service.updateGoal('u1', eventGoal.id, { taper: null });
        expect((firestore.setDoc.mock.calls.at(-1)![1] as Record<string, unknown>).taper).toBe(firestore.deleteMarker);
    });

    it('removes timing when a dated event becomes a plain dated goal', async () => {
        const service = new GoalService();
        const timing = { earliestDate: '2026-09-05', latestDate: '2026-09-20', planningDate: '2026-09-05' };
        firestore.getDoc.mockResolvedValue({
            exists: () => true,
            data: () => ({ ...eventGoal, timing }),
            id: eventGoal.id,
        });

        // A caller clearing event status must also clear timing explicitly, same as
        // eventCategory/eventPreset/eventLifecycle -- validateGoal rejects a merge that
        // would otherwise leave timing dangling with no dated event category (see
        // 'rejects timing without a dated event category' in validation.test.ts).
        await service.updateGoal('u1', eventGoal.id, {
            eventCategory: null,
            eventPreset: null,
            eventLifecycle: undefined,
            timing: null,
        });

        const payload = firestore.setDoc.mock.calls[0][1] as Record<string, unknown>;
        expect(payload.timing).toBe(firestore.deleteMarker);
    });

    it('rejects an update that clears eventCategory while leaving a stale timing object behind', async () => {
        const service = new GoalService();
        const timing = { earliestDate: '2026-09-05', latestDate: '2026-09-20', planningDate: '2026-09-05' };
        firestore.getDoc.mockResolvedValue({
            exists: () => true,
            data: () => ({ ...eventGoal, timing }),
            id: eventGoal.id,
        });

        await expect(service.updateGoal('u1', eventGoal.id, {
            eventCategory: null,
            eventPreset: null,
            eventLifecycle: undefined,
        })).rejects.toThrow(/timing/);
    });

    it('clears timing on an update when explicitly unset while the goal stays a dated event', async () => {
        const service = new GoalService();
        const timing = { earliestDate: '2026-09-05', latestDate: '2026-09-20', planningDate: '2026-09-05' };
        firestore.getDoc.mockResolvedValue({
            exists: () => true,
            data: () => ({ ...eventGoal, timing }),
            id: eventGoal.id,
        });

        await service.updateGoal('u1', eventGoal.id, { timing: null });

        const payload = firestore.setDoc.mock.calls[0][1] as Record<string, unknown>;
        expect(payload.timing).toBe(firestore.deleteMarker);
    });
});
