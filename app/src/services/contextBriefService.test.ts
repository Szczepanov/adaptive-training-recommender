import { beforeEach, describe, expect, it, vi } from 'vitest';

const services = vi.hoisted(() => ({
    getRecoverySnapshotState: vi.fn(),
    getCheckinsInRange: vi.fn(),
    getActivitiesInRange: vi.fn(),
    getRecommendationsInRange: vi.fn(),
    getTrainingSettingsState: vi.fn(),
    getPreferencesState: vi.fn(),
    getProfileState: vi.fn(),
}));

vi.mock('./recoverySnapshotService', () => ({ recoverySnapshotService: { getRecoverySnapshotState: services.getRecoverySnapshotState } }));
vi.mock('./checkinService', () => ({ checkinService: { getCheckinsInRange: services.getCheckinsInRange } }));
vi.mock('./activityService', () => ({ activityService: { getActivitiesInRange: services.getActivitiesInRange } }));
vi.mock('./recommendationService', () => ({ recommendationService: { getRecommendationsInRange: services.getRecommendationsInRange } }));
vi.mock('./trainingSettingsService', () => ({ trainingSettingsService: { getTrainingSettingsState: services.getTrainingSettingsState } }));
vi.mock('./preferencesService', () => ({ preferencesService: { getPreferencesState: services.getPreferencesState } }));
vi.mock('./trainingIntentProfileService', () => ({ trainingIntentProfileService: { getProfileState: services.getProfileState } }));

import { ContextBriefService } from './contextBriefService';

const AS_OF = '2026-08-15';

describe('ContextBriefService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        services.getRecoverySnapshotState.mockResolvedValue({ status: 'MISSING' });
        services.getCheckinsInRange.mockResolvedValue([]);
        services.getActivitiesInRange.mockResolvedValue({ status: 'AVAILABLE', data: [], revision: null });
        services.getRecommendationsInRange.mockResolvedValue({ status: 'AVAILABLE', data: [], revision: null });
        services.getTrainingSettingsState.mockResolvedValue({ status: 'MISSING' });
        services.getPreferencesState.mockResolvedValue({ status: 'MISSING' });
        services.getProfileState.mockResolvedValue({ status: 'MISSING' });
    });

    it('reads check-ins over a date range covering the full baseline, not just the window', async () => {
        await new ContextBriefService().build('u1', AS_OF, 14);
        // 28-day baseline ending 2026-08-15 starts on 2026-07-19, inclusive both ends.
        expect(services.getCheckinsInRange).toHaveBeenCalledWith('u1', '2026-07-19', AS_OF);
    });

    it('keeps the baseline strictly longer than the window for a long window', async () => {
        await new ContextBriefService().build('u1', AS_OF, 28);
        // windowDays * 2 = 56 days ending 2026-08-15.
        expect(services.getCheckinsInRange).toHaveBeenCalledWith('u1', '2026-06-21', AS_OF);
    });

    it('does not report missing snapshot days as a read failure', async () => {
        const result = await new ContextBriefService().build('u1', AS_OF, 14);
        expect(result.unavailableSources).not.toContain('recovery snapshots');
        expect(result.unavailableSources.join()).not.toContain('recovery snapshots');
    });

    it('reports unreadable snapshot days, which would otherwise render as absent data', async () => {
        services.getRecoverySnapshotState.mockResolvedValueOnce({ status: 'UNAVAILABLE', operation: 'read', retryable: true });
        services.getRecoverySnapshotState.mockResolvedValueOnce({ status: 'INVALID', issues: [] });
        const result = await new ContextBriefService().build('u1', AS_OF, 14);
        expect(result.unavailableSources).toContain('recovery snapshots (2 day(s) unreadable)');
    });

    it('reports a failed preferences read, because it owns a hard modality exclusion', async () => {
        services.getPreferencesState.mockResolvedValue({ status: 'UNAVAILABLE', operation: 'read preferences', retryable: true });
        const result = await new ContextBriefService().build('u1', AS_OF, 14);
        expect(result.unavailableSources).toContain('preferences (modality exclusions may be missing)');
    });

    it('treats an absent preferences document as configured-nothing, not as a failure', async () => {
        const result = await new ContextBriefService().build('u1', AS_OF, 14);
        expect(result.unavailableSources.join()).not.toContain('preferences');
    });

    it('still returns a brief when every source rejects', async () => {
        services.getRecoverySnapshotState.mockRejectedValue(new Error('offline'));
        services.getCheckinsInRange.mockRejectedValue(new Error('offline'));
        services.getActivitiesInRange.mockRejectedValue(new Error('offline'));
        services.getRecommendationsInRange.mockRejectedValue(new Error('offline'));
        services.getTrainingSettingsState.mockRejectedValue(new Error('offline'));
        services.getPreferencesState.mockRejectedValue(new Error('offline'));
        services.getProfileState.mockRejectedValue(new Error('offline'));

        const result = await new ContextBriefService().build('u1', AS_OF, 14);
        expect(result.text).toContain('# Training context brief');
        expect(result.unavailableSources).toContain('recovery snapshots');
        expect(result.unavailableSources).toContain('training settings');
        expect(result.text).toContain('Do not assume any equipment or absence of injury');
    });
});
