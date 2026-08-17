import { describe, expect, it, vi } from 'vitest';
import { GarminWorkoutQueueService } from './garminWorkoutQueueService';
import type { CanonicalWorkoutExport } from '../utils/workoutJsonExport';

const mockOnSnapshot = vi.fn();

vi.mock('firebase/firestore', () => ({
    doc: vi.fn((_db, path) => ({ path })),
    collection: vi.fn((_db, path) => ({ path })),
    setDoc: vi.fn(async () => {}),
    getDoc: vi.fn(async () => ({ exists: () => false })),
    onSnapshot: (...args: unknown[]) => mockOnSnapshot(...args),
}));

vi.mock('../firebase', () => ({
    getDb: vi.fn(() => ({})),
}));

describe('GarminWorkoutQueueService', () => {
    it('queues a workout in users/{userId}/garmin_workout_queue/{date}', async () => {
        const service = new GarminWorkoutQueueService();
        const payload: CanonicalWorkoutExport = {
            schemaVersion: 'canonical_workout_v1',
            title: 'Threshold 3x12',
            workoutId: 's1',
            modality: 'cycling',
            targetDurationMin: 75,
            blocks: [],
            exportedAt: '2026-08-17T08:00:00Z',
        };

        await expect(service.queueWorkout('user-1', '2026-08-17', payload)).resolves.not.toThrow();
    });

    it('subscribes to queue item snapshots and invokes onUpdate callback', () => {
        const service = new GarminWorkoutQueueService();
        const onUpdate = vi.fn();
        const unsubscribe = vi.fn();

        mockOnSnapshot.mockImplementation((_ref, callback) => {
            callback({
                exists: () => true,
                data: () => ({
                    userId: 'user-1',
                    date: '2026-08-17',
                    workoutTitle: 'Sweet Spot',
                    status: 'pending',
                }),
            });
            return unsubscribe;
        });

        const unsub = service.subscribeToQueueItem('user-1', '2026-08-17', onUpdate);
        expect(onUpdate).toHaveBeenCalledWith(
            expect.objectContaining({
                workoutTitle: 'Sweet Spot',
                status: 'pending',
            })
        );
        expect(unsub).toBe(unsubscribe);
    });

    it('handles non-existent snapshot in subscribeToQueueItem', () => {
        const service = new GarminWorkoutQueueService();
        const onUpdate = vi.fn();

        mockOnSnapshot.mockImplementation((_ref, callback) => {
            callback({
                exists: () => false,
            });
            return vi.fn();
        });

        service.subscribeToQueueItem('user-1', '2026-08-17', onUpdate);
        expect(onUpdate).toHaveBeenCalledWith(null);
    });

    it('subscribes to user queue collection snapshots and invokes onUpdate callback', () => {
        const service = new GarminWorkoutQueueService();
        const onUpdate = vi.fn();
        const unsubscribe = vi.fn();

        mockOnSnapshot.mockImplementation((_ref, callback) => {
            callback({
                forEach: (fn: (doc: { exists: () => boolean; data: () => unknown }) => void) => {
                    fn({
                        exists: () => true,
                        data: () => ({
                            userId: 'user-1',
                            date: '2026-08-19',
                            workoutTitle: 'VO2 30/15',
                            status: 'pending',
                        }),
                    });
                },
            });
            return unsubscribe;
        });

        const unsub = service.subscribeToUserQueue('user-1', onUpdate);
        expect(onUpdate).toHaveBeenCalledWith([
            expect.objectContaining({
                workoutTitle: 'VO2 30/15',
                status: 'pending',
            }),
        ]);
        expect(unsub).toBe(unsubscribe);
    });
});


