/**
 * Utility for formatting local dates in specific timezones (default Europe/Warsaw).
 * Prevents UTC off-by-one errors near midnight when generating calendar date strings (YYYY-MM-DD).
 */

export function getLocalDateString(dateInput: Date = new Date(), timezone: string = 'Europe/Warsaw'): string {
    try {
        const formatter = new Intl.DateTimeFormat('en-CA', {
            timeZone: timezone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
        });
        return formatter.format(dateInput); // en-CA locale formats as YYYY-MM-DD
    } catch {
        // Fallback if Intl or timezone is unsupported in browser environment
        const year = dateInput.getFullYear();
        const month = String(dateInput.getMonth() + 1).padStart(2, '0');
        const day = String(dateInput.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }
}

/**
 * Calendar-day arithmetic on an already-local YYYY-MM-DD string -- pure date-string
 * arithmetic, no timezone instant involved, so it can't reintroduce a UTC-boundary bug
 * for a date that's already a correct local calendar date. `days` may be negative.
 */
export function addDaysToLocalDateString(dateStr: string, days: number): string {
    const [yearPart, monthPart, dayPart] = dateStr.split('-').map(Number);
    const d = new Date(Date.UTC(yearPart, monthPart - 1, dayPart));
    d.setUTCDate(d.getUTCDate() + days);
    const year = d.getUTCFullYear();
    const month = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

/**
 * Calendar-day subtraction on an already-local YYYY-MM-DD string, matching the pattern
 * rules.ts's getTomorrowDateString uses -- pure date-string arithmetic, no timezone
 * instant involved, so it can't reintroduce a UTC-boundary bug for a date that's
 * already a correct local calendar date.
 */
export function getPreviousLocalDateString(dateStr: string): string {
    return addDaysToLocalDateString(dateStr, -1);
}

/**
 * Computes calendar day difference between two Warsaw-local date strings: (dateStrA - dateStrB).
 * Uses calendar components (year, month, day) in UTC midnights so DST transitions (23h or 25h days)
 * do not cause rounding errors in day calculation.
 */
export function getDayDiff(dateStrA: string, dateStrB: string): number {
    // Parse the YYYY-MM-DD components directly rather than through `new Date(dateStr +
    // 'T00:00:00')` (which parses in the runtime's local timezone) -- Date.UTC on the
    // literal components is exact and has no host-timezone or DST dependency at all,
    // rather than merely "correct because we happen to read the same local components
    // back out".
    const toUtcMidnight = (dateStr: string): number => {
        const [year, month, day] = dateStr.split('-').map(Number);
        return Date.UTC(year, month - 1, day);
    };
    const utcA = toUtcMidnight(dateStrA);
    const utcB = toUtcMidnight(dateStrB);
    return Math.round((utcA - utcB) / (24 * 60 * 60 * 1000));
}
