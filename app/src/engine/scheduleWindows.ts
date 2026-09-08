/* eslint-disable @typescript-eslint/no-explicit-any -- untrusted raw input, matching engine/validation.ts's own convention */
/**
 * ADR-0036 D-WINDOW (H4): the athlete's versioned schedule -- pure validation and
 * same-date resolution for `ScheduleWindow` (`engine/models.ts`). This module owns the
 * structural contract only: stable window id, Warsaw-local date, local start/end,
 * optional label, and applicable equipment/environment restrictions. It never resolves
 * a plan's `intraday` request (`sessions/externalPlanV4.ts`) against these windows --
 * that intersection is D-PLACEMENT's job, layered on top of this file.
 *
 * Recurring availability ("Recurring availability is resolved to dated instances by the
 * app", D-WINDOW) is intentionally out of scope for this first PR: only already-dated
 * window instances are modeled and persisted here. A future PR can add a template that
 * resolves to `ScheduleWindow` instances without changing this file's contract, since
 * every downstream consumer only ever sees resolved, dated windows.
 */
import type { ScheduleWindow, TrainingEnvironment } from './models';
import { isValidDate, type ValidationError, type ValidationResult } from './validationCore';

const TRAINING_ENVIRONMENTS: TrainingEnvironment[] = ['indoor', 'outdoor', 'either'];
const HHMM_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const MAX_LABEL_LENGTH = 100;
const MAX_EQUIPMENT_ITEMS = 20;
const MAX_EQUIPMENT_ITEM_LENGTH = 50;

/** Minutes since midnight for an already-pattern-validated `HH:mm` string. */
function minutesFromHHmm(value: string): number {
    const [hours, minutes] = value.split(':').map(Number);
    return hours * 60 + minutes;
}

/** True when two same-date windows share any minute. Half-open on both ends: a window
 * ending at 12:00 does not conflict with one starting at 12:00. */
export function scheduleWindowsOverlap(
    left: Pick<ScheduleWindow, 'startLocal' | 'endLocal'>,
    right: Pick<ScheduleWindow, 'startLocal' | 'endLocal'>,
): boolean {
    return minutesFromHHmm(left.startLocal) < minutesFromHHmm(right.endLocal)
        && minutesFromHHmm(right.startLocal) < minutesFromHHmm(left.endLocal);
}

/**
 * Validates one untrusted `ScheduleWindow` document in isolation. Cross-window overlap
 * (which needs every window for the date at once) is a separate check --
 * `validateScheduleWindowSet` below -- the same split `externalPlanV4.ts` uses between
 * per-session and cross-session validation.
 */
export function validateScheduleWindow(raw: any): ValidationResult<ScheduleWindow> {
    const errors: ValidationError[] = [];

    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return { isValid: false, errors: [{ field: 'window', message: 'Schedule window must be an object' }] };
    }
    if (!raw.userId || typeof raw.userId !== 'string') {
        errors.push({ field: 'userId', message: 'User ID is required' });
    }
    if (!raw.date || typeof raw.date !== 'string' || !isValidDate(raw.date)) {
        errors.push({ field: 'date', message: 'Date must be a valid date (YYYY-MM-DD)' });
    }

    const startValid = typeof raw.startLocal === 'string' && HHMM_PATTERN.test(raw.startLocal);
    const endValid = typeof raw.endLocal === 'string' && HHMM_PATTERN.test(raw.endLocal);
    if (!startValid) errors.push({ field: 'startLocal', message: 'startLocal must be HH:mm' });
    if (!endValid) errors.push({ field: 'endLocal', message: 'endLocal must be HH:mm' });
    // Zero-length and cross-midnight intervals are both rejected: an overnight opening
    // must be split into two same-day windows at midnight (D-WINDOW).
    if (startValid && endValid && minutesFromHHmm(raw.startLocal) >= minutesFromHHmm(raw.endLocal)) {
        errors.push({ field: 'endLocal', message: 'endLocal must be strictly after startLocal (same-day, positive duration)' });
    }

    if (raw.label !== undefined) {
        if (typeof raw.label !== 'string' || raw.label.length === 0) {
            errors.push({ field: 'label', message: 'label must be a non-empty string when present' });
        } else if (raw.label.length > MAX_LABEL_LENGTH) {
            errors.push({ field: 'label', message: `label must be at most ${MAX_LABEL_LENGTH} characters` });
        }
    }

    if (raw.equipment !== undefined) {
        if (!Array.isArray(raw.equipment) || raw.equipment.length > MAX_EQUIPMENT_ITEMS) {
            errors.push({ field: 'equipment', message: `equipment must be a list of at most ${MAX_EQUIPMENT_ITEMS} items` });
        } else if (raw.equipment.some((item: unknown) => typeof item !== 'string' || item.length > MAX_EQUIPMENT_ITEM_LENGTH)) {
            errors.push({ field: 'equipment', message: `Every equipment item must be a string of at most ${MAX_EQUIPMENT_ITEM_LENGTH} characters` });
        }
    }

    if (raw.environment !== undefined && !TRAINING_ENVIRONMENTS.includes(raw.environment)) {
        errors.push({ field: 'environment', message: `environment must be one of: ${TRAINING_ENVIRONMENTS.join(', ')}` });
    }

    if (!Number.isInteger(raw.revision) || raw.revision < 1) {
        errors.push({ field: 'revision', message: 'revision must be a positive integer' });
    }
    if (!raw.createdAt || typeof raw.createdAt !== 'string') {
        errors.push({ field: 'createdAt', message: 'createdAt is required' });
    }
    if (!raw.updatedAt || typeof raw.updatedAt !== 'string') {
        errors.push({ field: 'updatedAt', message: 'updatedAt is required' });
    }

    if (errors.length > 0) return { isValid: false, errors };
    return { isValid: true, errors: [], data: raw as ScheduleWindow };
}

/**
 * Cross-window validation for one date's set of windows (already individually valid).
 * Enforces D-WINDOW's "same-date, positive-duration and non-overlapping" -- this is the
 * boundary D-PLACEMENT relies on to never see two overlapping windows for one date.
 */
export function validateScheduleWindowSet(windows: readonly ScheduleWindow[]): ValidationError[] {
    const errors: ValidationError[] = [];
    const byDate = new Map<string, ScheduleWindow[]>();
    for (const window of windows) {
        const list = byDate.get(window.date) ?? [];
        list.push(window);
        byDate.set(window.date, list);
    }
    for (const sameDateWindows of byDate.values()) {
        const sorted = [...sameDateWindows].sort((a, b) => minutesFromHHmm(a.startLocal) - minutesFromHHmm(b.startLocal));
        for (let i = 1; i < sorted.length; i += 1) {
            if (scheduleWindowsOverlap(sorted[i - 1], sorted[i])) {
                errors.push({
                    field: `windows[${sorted[i - 1].id}, ${sorted[i].id}]`,
                    message: `Overlapping schedule windows on ${sorted[i].date}: ${sorted[i - 1].id} and ${sorted[i].id}`,
                });
            }
        }
    }
    return errors;
}

/**
 * Resolves the windows applicable to one Warsaw-local date, ordered by start time.
 *
 * An empty result is the supported legacy case (D-WINDOW: "Legacy date-only availability
 * remains one untimed slot with current behavior; missing metadata never creates an AM
 * and PM pair") -- callers must keep today's single full-day-budget behavior rather than
 * treating `[]` as "no availability at all". This function performs no cross-window
 * validation of its own; callers that persist multiple windows for the same date should
 * run `validateScheduleWindowSet` first so resolution never has to silently choose which
 * of two overlapping windows wins.
 */
export function resolveScheduleWindowsForDate(
    date: string,
    windows: readonly ScheduleWindow[],
): ScheduleWindow[] {
    return windows
        .filter(window => window.date === date)
        .sort((a, b) => minutesFromHHmm(a.startLocal) - minutesFromHHmm(b.startLocal));
}

/** Window duration in minutes. Assumes an already-validated window (positive, same-day). */
export function scheduleWindowDurationMinutes(window: Pick<ScheduleWindow, 'startLocal' | 'endLocal'>): number {
    return minutesFromHHmm(window.endLocal) - minutesFromHHmm(window.startLocal);
}
