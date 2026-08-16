import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addDaysToLocalDateString } from '../utils/localDate';
import type { DailySubjectiveCheckin } from './models';

const services = vi.hoisted(() => ({
    recovery: { getRecoverySnapshotState: vi.fn() },
    checkin: { getCheckinState: vi.fn(), getCheckinsInRangeState: vi.fn() },
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

function scoredCheckin(date: string, readiness = 7): DailySubjectiveCheckin {
    return {
        userId: 'u1', date,
        readiness, sleepQuality: 7, fatigue: 4, soreness: 3, mentalStress: 4, motivation: 7,
        painOrInjury: false, illnessSymptoms: false, unusuallyLimitedTime: false, alreadyTrainedToday: false,
        availability: { timeAvailableMin: 60, preferredModalityToday: null, indoorOnly: false },
        notes: null,
        submittedAt: `${date}T06:00:00Z`,
        dataQuality: { isComplete: true, missingFields: [] },
        schemaVersion: 1,
        createdAt: `${date}T06:00:00Z`, updatedAt: `${date}T06:00:00Z`,
    };
}

function matureHistory(asOfDate: string): DailySubjectiveCheckin[] {
    return Array.from({ length: 28 }, (_, index) => scoredCheckin(addDaysToLocalDateString(asOfDate, -(28 - index))));
}

describe('DecisionComposer training intent profile source', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        services.recovery.getRecoverySnapshotState.mockResolvedValue({ status: 'MISSING' });
        services.checkin.getCheckinState.mockResolvedValue({ status: 'MISSING' });
        services.checkin.getCheckinsInRangeState.mockResolvedValue({ status: 'MISSING' });
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

describe('DecisionComposer Phase 9.4 subjective baseline boundary', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        services.recovery.getRecoverySnapshotState.mockResolvedValue({ status: 'MISSING' });
        services.checkin.getCheckinState.mockResolvedValue({ status: 'MISSING' });
        services.goals.getActiveGoalsState.mockResolvedValue({ status: 'AVAILABLE', data: [], revision: null });
        services.settings.getTrainingSettingsState.mockResolvedValue({ status: 'AVAILABLE', data: settings, revision: null });
        services.preferences.getPreferencesState.mockResolvedValue({ status: 'MISSING' });
        services.intentProfile.getProfileState.mockResolvedValue({ status: 'MISSING' });
    });

    it('performs exactly one bounded history read ending at the decision date exclusively and computes a mature baseline', async () => {
        const date = '2026-08-10';
        services.checkin.getCheckinsInRangeState.mockResolvedValue({
            status: 'AVAILABLE', data: matureHistory(date), revision: 'history-r1',
        });

        const input = await new DecisionComposer().composeDailyDecisionInput('u1', date);

        expect(services.checkin.getCheckinsInRangeState).toHaveBeenCalledTimes(1);
        expect(services.checkin.getCheckinsInRangeState).toHaveBeenCalledWith('u1', '2026-07-13', date);
        expect(input.subjectiveBaseline).not.toBeNull();
        expect(input.subjectiveBaseline?.historyThroughDateExclusive).toBe(date);
        expect(input.subjectiveBaseline?.recentRecordedDays).toBe(7);
        expect(input.subjectiveBaseline?.longRecordedDays).toBe(28);
        expect(input.subjectiveHistoryState).toMatchObject({ status: 'AVAILABLE', revision: 'history-r1' });
    });

    it('does not let an unavailable history read block ordinary decision-input composition', async () => {
        services.checkin.getCheckinsInRangeState.mockResolvedValue({
            status: 'UNAVAILABLE', operation: 'read subjective check-in history', retryable: true,
        });
        const input = await new DecisionComposer().composeDailyDecisionInput('u1', '2026-08-10');
        expect(input.subjectiveBaseline).toBeNull();
        expect(input.subjectiveHistoryState.status).toBe('UNAVAILABLE');
        expect(input.trainingSettings.userId).toBe('u1');
    });

    it('uses valid rows while preserving row-level data-quality issues from the history service', async () => {
        const date = '2026-08-10';
        services.checkin.getCheckinsInRangeState.mockResolvedValue({
            status: 'AVAILABLE',
            data: matureHistory(date),
            revision: 'history-r2',
            issues: [{ code: 'invalid-checkin-field', documentPath: 'users/u1/daily_subjective_checkins/bad' }],
        });
        const input = await new DecisionComposer().composeDailyDecisionInput('u1', date);
        expect(input.subjectiveBaseline).not.toBeNull();
        expect(input.subjectiveHistoryState.status).toBe('AVAILABLE');
        if (input.subjectiveHistoryState.status === 'AVAILABLE') {
            expect(input.subjectiveHistoryState.issues).toHaveLength(1);
        }
    });

    it('returns no baseline for sparse valid history rather than fabricating a neutral baseline', async () => {
        const date = '2026-08-10';
        services.checkin.getCheckinsInRangeState.mockResolvedValue({
            status: 'AVAILABLE', data: [scoredCheckin(addDaysToLocalDateString(date, -1))], revision: 'sparse',
        });
        const input = await new DecisionComposer().composeDailyDecisionInput('u1', date);
        expect(input.subjectiveBaseline).toBeNull();
    });
});
