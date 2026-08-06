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
