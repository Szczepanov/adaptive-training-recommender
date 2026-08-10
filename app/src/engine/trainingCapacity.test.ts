import { describe, expect, it } from 'vitest';
import type { TrainingIntentProfile, UserPreferences } from './models';
import { resolveTrainingCapacity } from './trainingCapacity';

const profile: TrainingIntentProfile = {
    userId: 'u1', planningMode: 'evergreen', priorities: ['health'], weeklyCommitment: { minSessions: 2, targetSessions: 3, maxSessions: 4 }, organizationPreference: 'auto', schemaVersion: 1, createdAt: '', updatedAt: '',
};
const preferences = (weekday: number, weekend: number): UserPreferences => ({
    userId: 'u1', preferredRecoveryStyle: 'mixed', defaultWeekdayTimeMin: weekday, defaultWeekendTimeMin: weekend, preferredTimeOfDay: 'flexible', preferredModalities: [], deprioritizedModalities: [], avoidedModalities: [], explanationVerbosity: 'detailed', conservativeBias: false, preferredUnits: { distance: 'km', weight: 'kg', temperature: 'celsius' }, schemaVersion: 1, createdAt: '', updatedAt: '',
});

describe('training capacity', () => {
    it('produces different usable-minute capacity for equal session commitments', () => {
        const availability = [{ date: '2026-08-10', maxTimeMinutes: 120 }, { date: '2026-08-15', maxTimeMinutes: 120 }];
        const short = resolveTrainingCapacity(profile.weeklyCommitment, preferences(30, 45), availability);
        const long = resolveTrainingCapacity(profile.weeklyCommitment, preferences(60, 90), availability);
        expect(short.estimatedTargetWeeklyMinutes).toBe(75);
        expect(long.estimatedTargetWeeklyMinutes).toBe(150);
        expect(short.minSessions).toBe(long.minSessions);
    });

    it('excludes missing or non-positive time rather than creating a zero-minute session', () => {
        const capacity = resolveTrainingCapacity(profile.weeklyCommitment, preferences(45, 60), [
            { date: '2026-08-10', maxTimeMinutes: 0 }, { date: '2026-08-11', maxTimeMinutes: null },
        ]);
        expect(capacity.usableWindows).toEqual([]);
        expect(capacity.warnings.map(warning => warning.code)).toEqual(['time_capacity_unavailable', 'time_capacity_unavailable']);
    });
});
