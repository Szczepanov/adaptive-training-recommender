import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../services/activityService', () => ({ activityService: { getActivitiesInRange: vi.fn() } }));
vi.mock('../services/recommendationService', () => ({ recommendationService: { getRecommendationsInRange: vi.fn() } }));
vi.mock('./activitiesReadModelService', async () => {
    const actual = await vi.importActual<typeof import('./activitiesReadModelService')>('./activitiesReadModelService');
    return { ...actual, getCompletedWorkoutsInRange: vi.fn() };
});

const { activityService } = await import('../services/activityService');
const { recommendationService } = await import('../services/recommendationService');
const { getCompletedWorkoutsInRange } = await import('./activitiesReadModelService');
const { computeHistoryShadowDiffForUser } = await import('./historyShadowService');

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCompletedWorkoutsInRange).mockResolvedValue([]);
});

describe('computeHistoryShadowDiffForUser', () => {
    it('returns null when the activities source is unavailable, matching buildTrainingHistorySnapshot\'s required-source contract', async () => {
        vi.mocked(activityService.getActivitiesInRange).mockResolvedValue({ status: 'UNAVAILABLE', operation: 'x', retryable: true });
        vi.mocked(recommendationService.getRecommendationsInRange).mockResolvedValue({ status: 'AVAILABLE', data: [], revision: null });

        const diff = await computeHistoryShadowDiffForUser('user-1', '2026-08-20', '2026-08-27');

        expect(diff).toBeNull();
    });

    it('returns null when the recommendations source is unavailable', async () => {
        vi.mocked(activityService.getActivitiesInRange).mockResolvedValue({ status: 'AVAILABLE', data: [], revision: null });
        vi.mocked(recommendationService.getRecommendationsInRange).mockResolvedValue({ status: 'INVALID', issues: [] });

        const diff = await computeHistoryShadowDiffForUser('user-1', '2026-08-20', '2026-08-27');

        expect(diff).toBeNull();
    });

    it('computes a real diff when both sources are available', async () => {
        vi.mocked(activityService.getActivitiesInRange).mockResolvedValue({
            status: 'AVAILABLE',
            data: [{ activityId: 'a1', date: '2026-08-26', type: 'strength_training', durationMin: 40, trainingEffectAerobic: 3, trainingEffectAnaerobic: 0, averageHr: 120, activityTrainingLoad: 80, intensityTag: 'hard' }],
            revision: null,
        });
        vi.mocked(recommendationService.getRecommendationsInRange).mockResolvedValue({ status: 'AVAILABLE', data: [], revision: null });
        vi.mocked(getCompletedWorkoutsInRange).mockResolvedValue([{
            performedOccurrenceId: 'pto-1',
            sourceBadge: { hasStructured: false, hasProvider: true, providers: ['garmin'] },
            reconciliation: { state: 'single_source' },
            garminExerciseSetsAreDiagnosticOnly: false,
        }]);

        const diff = await computeHistoryShadowDiffForUser('user-1', '2026-08-20', '2026-08-27');

        expect(diff).not.toBeNull();
        expect(diff?.liveExposureCount).toBe(1);
        expect(diff?.canonicalExposureCount).toBe(1);
    });

    it('reads Activities exactly once and hands the identical snapshot to canonical hydration -- no independent second read to diverge on', async () => {
        const widenedActivities = [
            { activityId: 'in-range', date: '2026-08-26', type: 'strength_training', durationMin: 40, trainingEffectAerobic: 3, trainingEffectAnaerobic: 0, averageHr: 120, activityTrainingLoad: 80, intensityTag: 'hard' },
            // Outside the caller's exact range, but inside the widened hydration window --
            // must reach canonical hydration (it needs adjacent-day coverage) while being
            // excluded from the live pipeline's exact-range input.
            { activityId: 'adjacent-day', date: '2026-08-19', type: 'strength_training', durationMin: 40, trainingEffectAerobic: 3, trainingEffectAnaerobic: 0, averageHr: 120, activityTrainingLoad: 80, intensityTag: 'hard' },
        ];
        vi.mocked(activityService.getActivitiesInRange).mockResolvedValue({ status: 'AVAILABLE', data: widenedActivities, revision: null });
        vi.mocked(recommendationService.getRecommendationsInRange).mockResolvedValue({ status: 'AVAILABLE', data: [], revision: null });

        await computeHistoryShadowDiffForUser('user-1', '2026-08-20', '2026-08-27');

        expect(activityService.getActivitiesInRange).toHaveBeenCalledTimes(1);
        expect(activityService.getActivitiesInRange).toHaveBeenCalledWith('user-1', '2026-08-19', '2026-08-28');
        expect(getCompletedWorkoutsInRange).toHaveBeenCalledWith('user-1', '2026-08-20', '2026-08-27', widenedActivities);
    });
});
