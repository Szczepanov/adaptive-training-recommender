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
    const d = new Date(dateStr + 'T00:00:00');
    d.setDate(d.getDate() + days);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
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
