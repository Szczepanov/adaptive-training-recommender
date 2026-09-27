import type { DailySubjectiveCheckin } from './models';
import { addDaysToLocalDateString } from '../utils/localDate';
import { MECHANICAL_CONTINUITY_WINDOW_DAYS, type CheckinRecord } from './mechanicalProgression';

/** Reads structured subjective check-ins for the #804 mechanical capability owner. The
 * range is half-open `[startDateInclusive, endDateExclusive)`. */
export interface MechanicalCheckinHistoryProvider {
    getCheckins(
        userId: string,
        startDateInclusive: string,
        endDateExclusive: string,
    ): Promise<readonly DailySubjectiveCheckin[]>;
}

/** The inclusive `[start, end)` range the mechanical evaluator can consult for `date`:
 * every follow-up of an exposure inside the continuity window, plus `date` itself (today's
 * check-in carries the pain/illness gates and any post-exposure symptom report). */
export function mechanicalCheckinRange(date: string): { startDateInclusive: string; endDateExclusive: string } {
    return {
        startDateInclusive: addDaysToLocalDateString(date, -MECHANICAL_CONTINUITY_WINDOW_DAYS),
        endDateExclusive: addDaysToLocalDateString(date, 1),
    };
}

/** Pure adapter: one record per calendar date inside the mechanical range for `date`,
 * sorted ascending. A duplicate date keeps the latest-submitted check-in. */
export function toMechanicalCheckinRecords(
    checkins: readonly DailySubjectiveCheckin[],
    date: string,
): CheckinRecord[] {
    const { startDateInclusive, endDateExclusive } = mechanicalCheckinRange(date);
    const byDate = new Map<string, DailySubjectiveCheckin>();
    for (const checkin of checkins) {
        if (checkin.date < startDateInclusive || checkin.date >= endDateExclusive) continue;
        const existing = byDate.get(checkin.date);
        if (!existing || checkin.submittedAt > existing.submittedAt) byDate.set(checkin.date, checkin);
    }
    return [...byDate.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([checkinDate, checkin]) => ({ date: checkinDate, checkin }));
}

/** Orchestration-only read of the check-ins the mechanical evaluator needs for `date`.
 * Evaluators never call this: `rules.ts` and `planner.ts` resolve the records once and
 * pass them in. The Firestore provider is a lazily-imported default, mirroring
 * `trainingHistory.ts` providers. A failed read yields no records, which the evaluator
 * treats as missing follow-up evidence (progression held), never as a normal response. */
export async function resolveMechanicalCheckinHistory(
    userId: string,
    date: string,
    provider?: MechanicalCheckinHistoryProvider,
): Promise<CheckinRecord[]> {
    const { startDateInclusive, endDateExclusive } = mechanicalCheckinRange(date);
    try {
        const source = provider
            ?? (await import('./firestoreMechanicalCheckinHistory')).firestoreMechanicalCheckinHistoryProvider;
        return toMechanicalCheckinRecords(await source.getCheckins(userId, startDateInclusive, endDateExclusive), date);
    } catch (error: unknown) {
        console.warn('Mechanical check-in history unavailable; stage advancement is held:', error);
        return [];
    }
}
