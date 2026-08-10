import type { UserEvent } from './models';
import { addDaysToLocalDateString, getDayDiff } from '../utils/localDate';

export interface ResolvedTaper {
    startDate: string;
    endDate: string;
    durationDays: number;
}

function mondayOfRaceWeek(raceDate: string): string {
    const [year, month, day] = raceDate.split('-').map(Number);
    const sundayBasedDay = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
    return addDaysToLocalDateString(raceDate, -((sundayBasedDay + 6) % 7));
}

/** Resolves the only taper policy used by both periodization and authored plan blocks.
 * Cycling A events taper from race-week Monday, with a three-day minimum for races early
 * in the week. An authored start date has priority over every default. */
export function resolveEventTaper(event: UserEvent): ResolvedTaper | null {
    const raceDate = event.timing?.planningDate ?? event.date;
    const explicitStart = event.taper?.startDate;
    let startDate: string | null = explicitStart ?? null;

    if (!startDate && event.category === 'cycling_event' && event.priority === 'A') {
        const weekAligned = mondayOfRaceWeek(raceDate);
        const minimumThreeDays = addDaysToLocalDateString(raceDate, -3);
        startDate = weekAligned < minimumThreeDays ? weekAligned : minimumThreeDays;
    }
    if (!startDate) {
        const legacyDays = event.priority === 'A' ? 14 : event.priority === 'B' ? 5 : 0;
        startDate = legacyDays > 0 ? addDaysToLocalDateString(raceDate, -legacyDays) : null;
    }
    if (!startDate) return null;

    return {
        startDate,
        endDate: addDaysToLocalDateString(raceDate, -1),
        durationDays: getDayDiff(raceDate, startDate),
    };
}
