import { describe, expect, it, vi } from 'vitest';
import { GarminWorkoutQueueService } from './garminWorkoutQueueService';
import type { CanonicalWorkoutExport } from '../utils/workoutJsonExport';

vi.mock('firebase/firestore', () => ({
    doc: vi.fn((_db, path) => ({ path })),
    setDoc: vi.fn(async () => {}),
    getDoc: vi.fn(async () => ({ exists: () => false })),
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
});
