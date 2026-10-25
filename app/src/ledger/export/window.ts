/** Per-purpose information bounds (OD1/OD2) and window resolution. Pure date-string arithmetic. */
import { addDaysToLocalDateString, getDayDiff, getLocalDateString } from '../../utils/localDate.ts';
import type { LedgerPurpose, LedgerWindow } from './schema.ts';

export interface PurposeBounds {
    /** Preset window length in days, inclusive of `asOfDate`. */
    days: number;
    /** Provider activity detail rows kept (newest first); `null` = uncapped (diagnostic only). */
    activityCap: number | null;
    /** Segments kept per activity; `null` = uncapped (diagnostic only). */
    segmentCap: number | null;
}

/** morning = today + D-1, planning = 14 days, diagnostic = caller-selected (default 14). */
export const PURPOSE_BOUNDS: Readonly<Record<LedgerPurpose, PurposeBounds>> = {
    morning: { days: 2, activityCap: 12, segmentCap: 20 },
    planning: { days: 14, activityCap: 12, segmentCap: 20 },
    diagnostic: { days: 14, activityCap: null, segmentCap: null },
};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function assertLocalDate(value: string, label: string): void {
    if (!DATE_PATTERN.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
        throw new Error(`${label} must be a YYYY-MM-DD calendar date, got "${value}"`);
    }
}

function windowOf(startDate: string, endDate: string): LedgerWindow {
    return { startDate, endDate, days: getDayDiff(endDate, startDate) + 1 };
}

export function resolveWindow(
    purpose: LedgerPurpose,
    asOfDate: string,
    requested?: { startDate: string; endDate: string },
): LedgerWindow {
    assertLocalDate(asOfDate, 'asOfDate');
    const preset = windowOf(addDaysToLocalDateString(asOfDate, 1 - PURPOSE_BOUNDS[purpose].days), asOfDate);
    if (!requested) return preset;
    assertLocalDate(requested.startDate, 'window.startDate');
    assertLocalDate(requested.endDate, 'window.endDate');
    if (requested.startDate > requested.endDate) throw new Error('window.startDate must not follow window.endDate');
    if (purpose === 'diagnostic') return windowOf(requested.startDate, requested.endDate);
    const start = requested.startDate > preset.startDate ? requested.startDate : preset.startDate;
    const end = requested.endDate < preset.endDate ? requested.endDate : preset.endDate;
    return start > end ? preset : windowOf(start, end);
}

export function inWindow(date: string | null | undefined, window: LedgerWindow): boolean {
    return !date || (date >= window.startDate && date <= window.endDate);
}

/** Warsaw calendar date of an absolute instant (I2); null when the instant does not parse. */
export function warsawDateOf(instant: string | undefined): string | null {
    if (!instant) return null;
    const parsed = new Date(instant);
    return Number.isNaN(parsed.getTime()) ? null : getLocalDateString(parsed);
}
