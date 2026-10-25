/** Per-purpose information bounds (OD1/OD2) and window resolution. Pure date-string arithmetic. */
import { addDaysToLocalDateString, getDayDiff, getLocalDateString } from '../../utils/localDate.ts';
import type { LedgerPurpose, LedgerWindow } from './schema.ts';

export interface PurposeBounds {
    /** Preset window length in days, inclusive of `asOfDate`. */
    days: number;
    /** Provider activity detail rows kept (newest first). */
    activityCap: number;
    /** Segments kept per activity. */
    segmentCap: number;
    /** When true, segment detail is kept only for D-1 sessions (the morning handoff). */
    segmentDetailOnlyDMinus1: boolean;
}

/**
 * Mirrors today's caps (`docs/architecture/context-brief-contract.md` "Information bounds",
 * `engine/contextBriefActivityTelemetry.ts` PLANNING_DETAIL_MAX_ACTIVITIES = 12,
 * DIAGNOSTIC_DETAIL_MAX_ACTIVITIES = 30, QUALITY_DETAIL_MAX_RESPONSE_SEGMENTS = 20 and the
 * 100-lap diagnostic cap). morning = today + D-1 with six rows; planning = 14 days;
 * diagnostic = caller-selected window (default 14 days).
 */
export const PURPOSE_BOUNDS: Readonly<Record<LedgerPurpose, PurposeBounds>> = {
    morning: { days: 2, activityCap: 6, segmentCap: 20, segmentDetailOnlyDMinus1: true },
    planning: { days: 14, activityCap: 12, segmentCap: 20, segmentDetailOnlyDMinus1: false },
    diagnostic: { days: 14, activityCap: 30, segmentCap: 100, segmentDetailOnlyDMinus1: false },
};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** A real calendar date: well-formed and unchanged by a round trip (rejects 2026-02-30). */
export function isLocalDate(value: unknown): value is string {
    return typeof value === 'string' && DATE_PATTERN.test(value) && addDaysToLocalDateString(value, 0) === value;
}

export function assertLocalDate(value: string, label: string): void {
    if (!isLocalDate(value)) throw new Error(`${label} must be a YYYY-MM-DD calendar date, got "${value}"`);
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

/** Inclusive date bounds; an omitted `to` is open-ended (forward-looking user context). */
export interface DateBounds {
    from: string;
    to?: string;
}

export function windowBounds(window: LedgerWindow): DateBounds {
    return { from: window.startDate, to: window.endDate };
}

/** An undated or unparsable date is never "in" a window. */
export function inBounds(date: unknown, bounds: DateBounds): boolean {
    return isLocalDate(date) && date >= bounds.from && (bounds.to === undefined || date <= bounds.to);
}

export interface WindowedRows<R> {
    rows: R[];
    /** Rows with no usable calendar date; reported, not silently omitted. */
    droppedUndated: number;
}

export function windowRows<R>(
    rows: readonly R[],
    dateOf: (row: R) => string | null | undefined,
    bounds: DateBounds,
): WindowedRows<R> {
    const dated = rows.filter(row => isLocalDate(dateOf(row)));
    return {
        rows: dated.filter(row => inBounds(dateOf(row), bounds)),
        droppedUndated: rows.length - dated.length,
    };
}

/** Warsaw calendar date of an absolute instant (I2); null when the instant does not parse. */
export function warsawDateOf(instant: string | undefined): string | null {
    if (!instant) return null;
    const parsed = new Date(instant);
    return Number.isNaN(parsed.getTime()) ? null : getLocalDateString(parsed);
}
