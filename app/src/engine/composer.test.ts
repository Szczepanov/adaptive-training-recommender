import { beforeEach, describe, expect, it, vi } from 'vitest';

const services = vi.hoisted(() => ({
    recovery: { getRecoverySnapshotState: vi.fn() },
    checkin: { getCheckinState: vi.fn() },
    goals: { getActiveGoalsState: vi.fn() },
    settings: { getTrainingSettingsState: vi.fn() },
    preferences: { getPreferencesState: vi.fn() },
    intentProfile: { getProfileState: vi.fn() },
}));
vi.mock('../services/recoverySnapshotService', () => ({ recoverySnapshotService: services.recovery }));
vi.mock('../services/checkinService', () => ({ checkinService: services.checkin }));
vi.mock('../services/goalService', () => ({ goalService: services.goals }));
vi.mock('../services/trainingSettingsService', () => ({ trainingSettingsService: services.settings }));
vi.mock('../services/preferencesService', () => ({ preferencesService: services.preferences }));
vi.mock('../services/trainingIntentProfileService', () => ({ trainingIntentProfileService: services.intentProfile }));

import { DecisionComposer } from './composer';

const settings = {
    userId: 'u1', schemaVersion: 2,
    equipment: { free_weights: true, cable_machine: false, treadmill: false, indoor_bike: false, pullup_bar: false },
    guardrails: { avoid_high_impact: false, avoid_heavy_lower_body: false, avoid_overhead_pressing: false, avoid_heavy_spinal_loading: false },
    defaults: { weekdayMaxMinutes: 60, weekendMaxMinutes: 90, environment: 'either' }, preferences: { preferActiveRecovery: false },
    migration: { legacyReviewed: true, migratedAt: null }, createdAt: '', updatedAt: '',
};

describe('DecisionComposer training intent profile source', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        services.recovery.getRecoverySnapshotState.mockResolvedValue({ status: 'MISSING' });
        services.checkin.getCheckinState.mockResolvedValue({ status: 'MISSING' });
        services.goals.getActiveGoalsState.mockResolvedValue({ status: 'AVAILABLE', data: [], revision: null });
        services.settings.getTrainingSettingsState.mockResolvedValue({ status: 'AVAILABLE', data: settings, revision: null });
        services.preferences.getPreferencesState.mockResolvedValue({ status: 'MISSING' });
    });

    it('preserves a missing profile as a supported compatibility input', async () => {
        services.intentProfile.getProfileState.mockResolvedValue({ status: 'MISSING' });
        const input = await new DecisionComposer().composeDailyDecisionInput('u1', '2026-08-10');
        expect(input.trainingIntentProfile).toBeNull();
        expect(input.sourceStates?.trainingIntentProfile).toEqual({ status: 'MISSING' });
    });

    it('carries a validated available profile without merging execution preferences into it', async () => {
        services.intentProfile.getProfileState.mockResolvedValue({
            status: 'AVAILABLE', revision: 'updated', data: {
                userId: 'u1', planningMode: 'evergreen', priorities: ['health'],
                weeklyCommitment: { minSessions: 2, targetSessions: 3, maxSessions: 4 },
                organizationPreference: 'auto', schemaVersion: 1, createdAt: '', updatedAt: 'updated',
            },
        });
        const input = await new DecisionComposer().composeDailyDecisionInput('u1', '2026-08-10');
        expect(input.trainingIntentProfile).toMatchObject({ planningMode: 'evergreen', priorities: ['health'] });
        expect(input.sourceStates?.trainingIntentProfile).toEqual({ status: 'AVAILABLE', revision: 'updated' });
    });
});
