import { beforeEach, describe, expect, it, vi } from 'vitest';

const services = vi.hoisted(() => ({
    getRecoverySnapshotState: vi.fn(),
    getCheckinsInRange: vi.fn(),
    getActivitiesInRange: vi.fn(),
    getRecommendationsInRange: vi.fn(),
    getTrainingSettingsState: vi.fn(),
    peekTrainingSettingsState: vi.fn(),
    getPreferencesState: vi.fn(),
    getProfileState: vi.fn(),
    getActiveGoalsState: vi.fn(),
    getFixedActivitiesInRangeState: vi.fn(),
    getActivePlanState: vi.fn(),
}));

vi.mock('./recoverySnapshotService', () => ({ recoverySnapshotService: { getRecoverySnapshotState: services.getRecoverySnapshotState } }));
vi.mock('./checkinService', () => ({ checkinService: { getCheckinsInRange: services.getCheckinsInRange } }));
vi.mock('./activityService', () => ({ activityService: { getActivitiesInRange: services.getActivitiesInRange } }));
vi.mock('./recommendationService', () => ({ recommendationService: { getRecommendationsInRange: services.getRecommendationsInRange } }));
vi.mock('./trainingSettingsService', () => ({ trainingSettingsService: {
    getTrainingSettingsState: services.getTrainingSettingsState,
    peekTrainingSettingsState: services.peekTrainingSettingsState,
} }));
vi.mock('./preferencesService', () => ({ preferencesService: { getPreferencesState: services.getPreferencesState } }));
vi.mock('./trainingIntentProfileService', () => ({ trainingIntentProfileService: { getProfileState: services.getProfileState } }));
vi.mock('./goalService', () => ({ goalService: { getActiveGoalsState: services.getActiveGoalsState } }));
vi.mock('./fixedActivityService', () => ({ fixedActivityService: { getActivitiesInRangeState: services.getFixedActivitiesInRangeState } }));
vi.mock('./activeExternalPlanService', () => ({ activeExternalPlanService: { getActivePlanState: services.getActivePlanState } }));

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
        services.peekTrainingSettingsState.mockResolvedValue({ status: 'MISSING' });
        services.getPreferencesState.mockResolvedValue({ status: 'MISSING' });
        services.getProfileState.mockResolvedValue({ status: 'MISSING' });
        services.getActiveGoalsState.mockResolvedValue({ status: 'MISSING' });
        services.getFixedActivitiesInRangeState.mockResolvedValue({ status: 'AVAILABLE', data: [], revision: null });
        services.getActivePlanState.mockResolvedValue({ status: 'MISSING' });
    });

    it('reads check-ins over a date range covering the full baseline, inclusive of asOfDate', async () => {
        await new ContextBriefService().build('u1', AS_OF, 14);
        // 28-day baseline ending 2026-08-15 starts on 2026-07-19; throughExclusive is 2026-08-16.
        expect(services.getCheckinsInRange).toHaveBeenCalledWith('u1', '2026-07-19', '2026-08-16');
    });

    it('keeps the baseline strictly longer than the window for a long window', async () => {
        await new ContextBriefService().build('u1', AS_OF, 28);
        // windowDays * 2 = 56 days ending 2026-08-15 (starts 2026-06-21; throughExclusive 2026-08-16).
        expect(services.getCheckinsInRange).toHaveBeenCalledWith('u1', '2026-06-21', '2026-08-16');
    });

    it('reads fixed commitments and resolves active imported sessions across the next seven days', async () => {
        await new ContextBriefService().build('u1', AS_OF, 14);

        expect(services.getFixedActivitiesInRangeState).toHaveBeenCalledWith('u1', '2026-08-15', '2026-08-21');
        expect(services.getActivePlanState).toHaveBeenCalledTimes(7);
        expect(services.getActivePlanState).toHaveBeenNthCalledWith(1, 'u1', '2026-08-15', []);
        expect(services.getActivePlanState).toHaveBeenNthCalledWith(7, 'u1', '2026-08-21', []);
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
        expect(result.text).toContain('DATA INCOMPLETE');
        expect(result.text).toContain('recovery snapshots (2 day(s) unreadable)');
    });

    it('omits malformed range-query check-ins instead of treating them as valid history', async () => {
        services.getCheckinsInRange.mockResolvedValue([{
            userId: 'u1',
            date: AS_OF,
            readiness: 'not-a-number',
        }]);

        const result = await new ContextBriefService().build('u1', AS_OF, 14);

        expect(result.unavailableSources).toContain('subjective check-ins (1 invalid record(s) omitted)');
        expect(result.text).toContain('No check-ins in this window.');
        expect(result.text).toContain('means "unknown", not "none"');
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

    it('reports unreadable goals instead of silently turning them into no goals', async () => {
        services.getActiveGoalsState.mockResolvedValue({ status: 'UNAVAILABLE', operation: 'read goals', retryable: true });
        const result = await new ContextBriefService().build('u1', AS_OF, 14);

        expect(result.unavailableSources).toContain('active goals');
        expect(result.text).toContain('active goals');
    });

    it('fails closed on external placement when fixed-activity occupancy cannot be read', async () => {
        services.getFixedActivitiesInRangeState.mockResolvedValue({ status: 'UNAVAILABLE', operation: 'read fixed activities', retryable: true });
        const result = await new ContextBriefService().build('u1', AS_OF, 14);

        expect(services.getActivePlanState).not.toHaveBeenCalled();
        expect(result.unavailableSources).toContain('future fixed activities');
        expect(result.unavailableSources).toContain('external plan schedule (fixed-activity occupancy unavailable)');
        expect(result.text).toContain('fixed-activity occupancy unavailable');
    });

    it('renders an imported future session into the copied handoff', async () => {
        services.getActivePlanState.mockImplementation(async (_userId: string, date: string) => {
            if (date !== '2026-08-17') return { status: 'MISSING' };
            return {
                status: 'AVAILABLE',
                data: {
                    header: { planId: 'p1', title: 'Race prep', revision: 2 },
                    placed: [{
                        date,
                        status: 'planned',
                        moved: false,
                        session: {
                            id: 's1',
                            title: 'Threshold quality',
                            priority: 'key',
                            placement: { flexibility: 'preferred' },
                            gating: { modality: 'cycling', intensity: 'hard', durationMin: 60, durationMax: 75 },
                        },
                    }],
                },
            };
        });

        const result = await new ContextBriefService().build('u1', AS_OF, 14);
        expect(result.text).toContain('2026-08-17 | Imported plan: Race prep | Threshold quality | 60–75 min · hard | key · preferred');
    });

    it('still returns a brief when every source rejects', async () => {
        services.getRecoverySnapshotState.mockRejectedValue(new Error('offline'));
        services.getCheckinsInRange.mockRejectedValue(new Error('offline'));
        services.getActivitiesInRange.mockRejectedValue(new Error('offline'));
        services.getRecommendationsInRange.mockRejectedValue(new Error('offline'));
        services.getTrainingSettingsState.mockRejectedValue(new Error('offline'));
        services.peekTrainingSettingsState.mockRejectedValue(new Error('offline'));
        services.getPreferencesState.mockRejectedValue(new Error('offline'));
        services.getProfileState.mockRejectedValue(new Error('offline'));
        services.getActiveGoalsState.mockRejectedValue(new Error('offline'));
        services.getFixedActivitiesInRangeState.mockRejectedValue(new Error('offline'));

        const result = await new ContextBriefService().build('u1', AS_OF, 14);
        expect(result.text).toContain('# Training context brief');
        expect(result.unavailableSources).toContain('recovery snapshots');
        expect(result.unavailableSources).toContain('training settings');
        expect(result.text).toContain('Do not assume any equipment or absence of injury');
        expect(result.text).toContain('DATA INCOMPLETE');
    });

    it('never writes a training settings profile as a side effect of being read', async () => {
        await new ContextBriefService().build('u1', AS_OF, 14);
        // getTrainingSettingsState migrates a missing profile into existence with setDoc.
        // The brief is presented to the athlete as read-only, so it must peek instead --
        // opening a tab must not create data.
        expect(services.peekTrainingSettingsState).toHaveBeenCalledWith('u1');
        expect(services.getTrainingSettingsState).not.toHaveBeenCalled();
    });
});
