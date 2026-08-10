import type { TrainingIntentProfile, UserPreferences } from './models';

export interface AvailabilityWindow {
    date: string;
    /** Already resolved by the schedule/fixed-activity authority. */
    maxTimeMinutes: number | null;
}

export interface ResolvedAvailabilityWindow {
    date: string;
    availableMinutes: number;
}

export interface CapacityWarning {
    code: 'time_capacity_unavailable';
    message: string;
    date: string;
}

export interface ResolvedTrainingCapacity {
    minSessions: number;
    targetSessions: number;
    maxSessions: number;
    weekdayMinutes: number | null;
    weekendMinutes: number | null;
    usableWindows: ResolvedAvailabilityWindow[];
    estimatedTargetWeeklyMinutes: number;
    warnings: CapacityWarning[];
}

function isWeekend(date: string): boolean {
    const [year, month, day] = date.split('-').map(Number);
    const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
    return weekday === 0 || weekday === 6;
}

function validDuration(value: number): value is number {
    return Number.isFinite(value) && value > 0;
}

/** Combines the two existing owners only: the profile determines how many sessions may
 * be packed, preferences determine per-day duration, and schedule windows determine
 * whether a date is actually usable. */
export function resolveTrainingCapacity(
    commitment: TrainingIntentProfile['weeklyCommitment'],
    preferences: UserPreferences,
    availability: readonly AvailabilityWindow[],
): ResolvedTrainingCapacity {
    const weekdayMinutes = validDuration(preferences.defaultWeekdayTimeMin) ? preferences.defaultWeekdayTimeMin : null;
    const weekendMinutes = validDuration(preferences.defaultWeekendTimeMin) ? preferences.defaultWeekendTimeMin : null;
    const warnings: CapacityWarning[] = [];
    const usableWindows = availability.flatMap(window => {
        const configuredDuration = isWeekend(window.date) ? weekendMinutes : weekdayMinutes;
        if (configuredDuration === null || !validDuration(window.maxTimeMinutes ?? Number.NaN)) {
            warnings.push({ code: 'time_capacity_unavailable', date: window.date, message: 'No positive, validated time capacity is available for this date.' });
            return [];
        }
        const availableMinutes = Math.min(configuredDuration, window.maxTimeMinutes!);
        return availableMinutes > 0 ? [{ date: window.date, availableMinutes }] : [];
    });
    return {
        ...commitment, weekdayMinutes, weekendMinutes, usableWindows,
        estimatedTargetWeeklyMinutes: usableWindows.reduce((total, window) => total + window.availableMinutes, 0),
        warnings,
    };
}
