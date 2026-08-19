/**
 * Pure validator for `SessionResponse` (M5.1). Self-contained like `sessions/validation.ts`
 * rather than importing its helpers -- `responses/` is its own distinct-lifecycle domain
 * (D-MRECORDS), and the date/object checks are a few lines each.
 */
import type { ResponseWindow, SessionResponse } from './models';

export interface ValidationIssue {
    path: string;
    message: string;
}

export type ValidationResult<T> =
    | { ok: true; value: T; issues?: never }
    | { ok: false; issues: ValidationIssue[]; value?: never };

const RESPONSE_WINDOWS: ResponseWindow[] = ['immediate', 'later_day', 'next_morning'];
const SOURCE_KINDS = ['strength', 'execution'];
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const RESPONSE_KEYS = [
    'userId', 'responseId', 'sourceSession', 'occurrenceId', 'window', 'date', 'checkinRef',
    'sessionRpe', 'completedFraction', 'unexpectedFatigue', 'techniqueNote', 'note', 'createdAt', 'updatedAt',
];

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isValidCalendarDate(value: unknown): value is string {
    if (typeof value !== 'string' || !DATE_REGEX.test(value)) return false;
    const [year, month, day] = value.split('-').map(Number);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

export function validateSessionResponse(raw: unknown): ValidationResult<SessionResponse> {
    const issues: ValidationIssue[] = [];
    if (!isObject(raw)) return { ok: false, issues: [{ path: '', message: 'Expected object' }] };

    if (typeof raw.userId !== 'string' || raw.userId.length === 0) issues.push({ path: 'userId', message: 'Missing userId' });
    if (typeof raw.responseId !== 'string' || raw.responseId.length === 0) issues.push({ path: 'responseId', message: 'Missing responseId' });

    if (!isObject(raw.sourceSession)
        || !SOURCE_KINDS.includes(String(raw.sourceSession.kind))
        || typeof raw.sourceSession.id !== 'string' || raw.sourceSession.id.length === 0
        || !isValidCalendarDate(raw.sourceSession.date)) {
        issues.push({ path: 'sourceSession', message: 'Invalid sourceSession: expected { kind: strength|execution, id, date }' });
    }

    if (raw.occurrenceId !== undefined && (typeof raw.occurrenceId !== 'string' || raw.occurrenceId.length === 0)) {
        issues.push({ path: 'occurrenceId', message: 'occurrenceId must be a non-empty string when present' });
    }

    if (!RESPONSE_WINDOWS.includes(raw.window as ResponseWindow)) {
        issues.push({ path: 'window', message: `Invalid window: ${String(raw.window)}` });
    }

    if (!isValidCalendarDate(raw.date)) issues.push({ path: 'date', message: 'date must be a YYYY-MM-DD string' });

    if (!isObject(raw.checkinRef) || !isValidCalendarDate(raw.checkinRef.date)) {
        issues.push({ path: 'checkinRef', message: 'Invalid checkinRef: expected { date }' });
    }

    if (raw.sessionRpe !== undefined && (typeof raw.sessionRpe !== 'number' || raw.sessionRpe < 0 || raw.sessionRpe > 10)) {
        issues.push({ path: 'sessionRpe', message: 'sessionRpe must be a number between 0 and 10' });
    }
    if (raw.completedFraction !== undefined && (typeof raw.completedFraction !== 'number' || raw.completedFraction < 0 || raw.completedFraction > 1)) {
        issues.push({ path: 'completedFraction', message: 'completedFraction must be a number between 0 and 1' });
    }
    if (raw.unexpectedFatigue !== undefined && typeof raw.unexpectedFatigue !== 'boolean') {
        issues.push({ path: 'unexpectedFatigue', message: 'unexpectedFatigue must be boolean' });
    }
    if (raw.techniqueNote !== undefined && typeof raw.techniqueNote !== 'string') {
        issues.push({ path: 'techniqueNote', message: 'techniqueNote must be a string' });
    }
    if (raw.note !== undefined && typeof raw.note !== 'string') {
        issues.push({ path: 'note', message: 'note must be a string' });
    }

    if (typeof raw.createdAt !== 'string' || raw.createdAt.length === 0) issues.push({ path: 'createdAt', message: 'Missing createdAt' });
    if (typeof raw.updatedAt !== 'string' || raw.updatedAt.length === 0) issues.push({ path: 'updatedAt', message: 'Missing updatedAt' });

    const extra = Object.keys(raw).filter(key => !RESPONSE_KEYS.includes(key));
    for (const key of extra) issues.push({ path: key, message: `Unrecognized field: ${key}` });

    if (issues.length > 0) return { ok: false, issues };
    return { ok: true, value: raw as unknown as SessionResponse };
}
