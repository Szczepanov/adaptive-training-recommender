import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StrengthSession } from './models';

const { activityService, recommendationService, strengthHistoryReadService } = vi.hoisted(() => ({
    activityService: { getActivitiesInRange: vi.fn(async () => ({ status: 'AVAILABLE' as const, revision: 'a', data: [] })) },
    recommendationService: { getRecommendationsInRange: vi.fn(async () => ({ status: 'AVAILABLE' as const, revision: 'r', data: [] })) },
    strengthHistoryReadService: { getSessionsInRange: vi.fn(async (): Promise<{ sessions: StrengthSession[]; invalidRecords: number }> => ({ sessions: [], invalidRecords: 0 })) },
}));

vi.mock('../services/activityService', () => ({ activityService }));
vi.mock('../services/recommendationService', () => ({ recommendationService }));
vi.mock('../services/strengthHistoryReadService', () => ({ strengthHistoryReadService }));

import {
    firestoreTrainingHistoryProvider,
    getFirestoreTrainingHistorySnapshot,
    toManualTrainingDataState,
} from './firestoreTrainingHistory';

const session: StrengthSession = {
    userId: 'u1', sessionId: 's1', date: '2026-08-06', startedAt: '2026-08-06T18:00:00Z',
    completedAt: '2026-08-06T18:45:00Z', updatedAt: '2026-08-06T18:45:00Z', state: 'completed',
    exercises: [{ exerciseId: 'front_squat', sets: [{ setIndex: 1, weightKg: 80, reps: 5, isWarmup: false, completedAt: '2026-08-06T18:15:00Z', gauge: { scale: 'rir', value: 2 } }] }],
    schemaVersion: 1,
};

describe('manual training DataState', () => {
    it('uses stable session identity as well as timestamps in the revision', () => {
        expect(toManualTrainingDataState('u1', { sessions: [session], invalidRecords: 0 })).toMatchObject({
            status: 'AVAILABLE', revision: 's1:2026-08-06T18:45:00Z', data: [session],
        });
    });

    it('distinguishes genuine absence from any corrupt record', () => {
        expect(toManualTrainingDataState('u1', { sessions: [], invalidRecords: 0 })).toEqual({ status: 'MISSING' });
        expect(toManualTrainingDataState('u1', { sessions: [session], invalidRecords: 1 })).toMatchObject({ status: 'INVALID' });
    });
});

describe('Firestore training history manual source', () => {
    beforeEach(() => vi.clearAllMocks());

    it('does not issue the manual Firestore read in the production default-off path', async () => {
        const snapshot = await firestoreTrainingHistoryProvider.getSnapshot!('u1', '2026-08-07', 7);
        expect(strengthHistoryReadService.getSessionsInRange).not.toHaveBeenCalled();
        expect(snapshot.sourceStates.manualTraining).toEqual({ status: 'MISSING' });
    });

    it('reads the exact exclusive window and includes strength only when explicitly enabled', async () => {
        strengthHistoryReadService.getSessionsInRange.mockResolvedValueOnce({ sessions: [session], invalidRecords: 0 });
        const snapshot = await getFirestoreTrainingHistorySnapshot('u1', '2026-08-07', 7, 'included');
        expect(strengthHistoryReadService.getSessionsInRange).toHaveBeenCalledWith('u1', '2026-07-31', '2026-08-07');
        expect(snapshot.exposures).toHaveLength(1);
        expect(snapshot.sourceStates.manualTraining.status).toBe('AVAILABLE');
    });

    it('turns a failed manual query into an unavailable source that blocks enabled planning', async () => {
        strengthHistoryReadService.getSessionsInRange.mockRejectedValueOnce(new Error('offline'));
        await expect(getFirestoreTrainingHistorySnapshot('u1', '2026-08-07', 7, 'included'))
            .rejects.toMatchObject({ source: 'manualTraining', state: { status: 'UNAVAILABLE' } });
    });
});
