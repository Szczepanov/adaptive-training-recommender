/**
 * #895 acceptance criterion 12 (action half): the helpers `DataView` hands to the list
 * call the repository with the identifiers and sticky manual decisions the reconciliation
 * sweep later honours. The repository is mocked; its own persistence is covered elsewhere.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const { unlinkSource, mergeOccurrences } = vi.hoisted(() => ({ unlinkSource: vi.fn(), mergeOccurrences: vi.fn() }));
vi.mock('../training-occurrence/repository', () => ({
    performedTrainingOccurrenceRepository: { unlinkSource, mergeOccurrences },
}));

import { linkCompletedWorkoutSources, unlinkCompletedWorkoutSource } from './completedWorkoutActions';

afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
});

describe('completedWorkoutActions', () => {
    it('unlink forwards user, occurrence, source key and actor to repository.unlinkSource', async () => {
        unlinkSource.mockResolvedValue({});
        await unlinkCompletedWorkoutSource('user-1', 'pto-matched', 'provider_activity:garmin:act-1', 'user-1');
        expect(unlinkSource).toHaveBeenCalledTimes(1);
        expect(unlinkSource).toHaveBeenCalledWith('user-1', 'pto-matched', 'provider_activity:garmin:act-1', 'user-1', 'manual diagnostic unlink from Activities');
        expect(mergeOccurrences).not.toHaveBeenCalled();
    });

    it('link merges the provider occurrence into the structured survivor with a matched state and a sticky link decision', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-08-26T08:00:00.000Z'));
        mergeOccurrences.mockResolvedValue({});
        await linkCompletedWorkoutSources('user-1', 'pto-1', 'pto-garmin', 'user-1');
        expect(mergeOccurrences).toHaveBeenCalledTimes(1);
        expect(mergeOccurrences).toHaveBeenCalledWith('user-1', 'pto-1', 'pto-garmin', {
            state: 'matched',
            linkedAt: '2026-08-26T08:00:00.000Z',
            manualDecision: {
                decision: 'link',
                actor: 'user-1',
                decidedAt: '2026-08-26T08:00:00.000Z',
                resultingState: 'matched',
                reason: 'manual link from Activities',
            },
        });
        expect(unlinkSource).not.toHaveBeenCalled();
    });

    it('propagates repository failures so DataView can log them instead of reporting success', async () => {
        unlinkSource.mockRejectedValue(new Error('denied'));
        await expect(unlinkCompletedWorkoutSource('user-1', 'pto-matched', 'k', 'user-1')).rejects.toThrow('denied');
        mergeOccurrences.mockRejectedValue(new Error('denied'));
        await expect(linkCompletedWorkoutSources('user-1', 'a', 'b', 'user-1')).rejects.toThrow('denied');
    });
});
