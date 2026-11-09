import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GarminWorkoutQueueService } from './garminWorkoutQueueService';
import type { CanonicalWorkoutExport } from '../utils/workoutJsonExport';

const mockOnSnapshot = vi.fn();
const mockSetDoc = vi.fn(async () => {});
const mockDoc = vi.fn((_db: unknown, path: string) => ({ path }));

vi.mock('firebase/firestore', () => ({
    doc: (...args: [unknown, string]) => mockDoc(...args),
    collection: vi.fn((_db, path) => ({ path })),
    setDoc: (...args: unknown[]) => mockSetDoc(...(args as [])),
    getDoc: vi.fn(async () => ({ exists: () => false })),
    onSnapshot: (...args: unknown[]) => mockOnSnapshot(...args),
}));

function queuePayload(overrides: Partial<CanonicalWorkoutExport> = {}): CanonicalWorkoutExport {
    return {
        schemaVersion: 'canonical_workout_v1',
        title: 'Threshold 3x12',
        workoutId: 's1',
        modality: 'cycling',
        targetDurationMin: 75,
        blocks: [],
        exportedAt: '2026-08-17T08:00:00Z',
        ...overrides,
    };
}

vi.mock('../firebase', () => ({
    getDb: vi.fn(() => ({})),
}));

describe('GarminWorkoutQueueService', () => {
    beforeEach(() => {
        mockSetDoc.mockClear();
        mockDoc.mockClear();
    });

    it('queues a workout in users/{userId}/garmin_workout_queue/{date}', async () => {
        const service = new GarminWorkoutQueueService();

        await expect(service.queueWorkout('user-1', '2026-08-17', queuePayload())).resolves.toBeUndefined();
        expect(mockSetDoc).toHaveBeenCalledTimes(1);
        expect(mockSetDoc).toHaveBeenCalledWith(
            { path: 'users/user-1/garmin_workout_queue/2026-08-17' },
            expect.objectContaining({ status: 'pending', syncedAt: null, error: null, workoutTitle: 'Threshold 3x12' }),
        );
    });

    // Issue #1202 (ADR-0053): validateQueuedWorkoutWrite runs before any Firestore call.
    it('rejects a queue entry with a malformed date before touching Firestore', async () => {
        const service = new GarminWorkoutQueueService();

        await expect(service.queueWorkout('user-1', '2026-8-17', queuePayload()))
            .rejects.toThrow('Invalid Garmin queue entry: date is required (YYYY-MM-DD)');
        expect(mockDoc).not.toHaveBeenCalled();
        expect(mockSetDoc).not.toHaveBeenCalled();
    });

    it('rejects a non-object (array) payload before touching Firestore', async () => {
        const service = new GarminWorkoutQueueService();
        const payload = [] as unknown as CanonicalWorkoutExport;

        await expect(service.queueWorkout('user-1', '2026-08-17', payload))
            .rejects.toThrow('payload must be a non-null object');
        expect(mockSetDoc).not.toHaveBeenCalled();
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
