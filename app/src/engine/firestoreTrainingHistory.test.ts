import { describe, expect, it, vi } from 'vitest';
import type { StrengthSession } from './models';

const { activityService, recommendationService, strengthSessionService } = vi.hoisted(() => ({
    activityService: { getActivitiesInRange: vi.fn(async () => ({ status: 'AVAILABLE', revision: 'a', data: [] })) },
    recommendationService: { getRecommendationsInRange: vi.fn(async () => ({ status: 'AVAILABLE', revision: 'r', data: [] })) },
    strengthSessionService: { getSessionsInRange: vi.fn(async (): Promise<{ sessions: StrengthSession[]; invalidRecords: number }> => ({ sessions: [], invalidRecords: 0 })) },
}));

vi.mock('../services/activityService', () => ({ activityService }));
vi.mock('../services/recommendationService', () => ({ recommendationService }));
vi.mock('../services/strengthSessionService', () => ({ strengthSessionService }));

import { firestoreTrainingHistoryProvider, toManualTrainingDataState } from './firestoreTrainingHistory';

const session: StrengthSession = {
    userId: 'u1', sessionId: 's1', date: '2026-08-06', startedAt: '2026-08-06T18:00:00Z',
    updatedAt: '2026-08-06T18:45:00Z', state: 'completed', exercises: [], schemaVersion: 1,
};

describe('toManualTrainingDataState (S3.2)', () => {
    it('is AVAILABLE with usable sessions', () => {
        expect(toManualTrainingDataState('u1', { sessions: [session], invalidRecords: 0 })).toMatchObject({ status: 'AVAILABLE', data: [session] });
    });

    it('is MISSING when there are genuinely zero sessions and zero invalid records', () => {
        expect(toManualTrainingDataState('u1', { sessions: [], invalidRecords: 0 })).toEqual({ status: 'MISSING' });
    });

    it('is INVALID, not MISSING, when every record present was corrupt -- the exact conflation the failure contract forbids', () => {
        const state = toManualTrainingDataState('u1', { sessions: [], invalidRecords: 3 });
        expect(state.status).toBe('INVALID');
        expect(state).not.toEqual({ status: 'MISSING' });
    });

    it('prefers AVAILABLE over INVALID when some sessions are usable despite other corrupt records', () => {
        const state = toManualTrainingDataState('u1', { sessions: [session], invalidRecords: 2 });
        expect(state.status).toBe('AVAILABLE');
    });
});

describe('firestoreTrainingHistoryProvider.getSnapshot (S3.2)', () => {
    it('fetches strength sessions in the same parallel batch as activities and recommendations', async () => {
        await firestoreTrainingHistoryProvider.getSnapshot!('u1', '2026-08-07', 7);
        expect(strengthSessionService.getSessionsInRange).toHaveBeenCalledWith('u1', '2026-07-31', '2026-08-07');
    });

    it('has the selector off: the fetch happens but the returned snapshot is unaffected by real strength data', async () => {
        strengthSessionService.getSessionsInRange.mockResolvedValueOnce({ sessions: [session], invalidRecords: 0 });
        const snapshot = await firestoreTrainingHistoryProvider.getSnapshot!('u1', '2026-08-07', 7);
        expect(snapshot.sourceStates.manualTraining).toEqual({ status: 'MISSING' });
        expect(snapshot.exposures).toEqual([]);
    });
});
