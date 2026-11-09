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
const FACT_KEYS = ['sessionRpe', 'completedFraction', 'unexpectedFatigue', 'techniqueNote', 'note'];
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

function isNumberInRange(value: unknown, min: number, max: number): boolean {
    // Number.isFinite also rejects NaN, which `value < min || value > max` lets through and
    // which the former Firestore range check (`>= min && <= max`) rejected.
    return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

/**
 * Per-field checks on the non-tissue session facts. Shared by the full-document validator
 * and {@link validateSessionResponseFacts}, which guards the partial fact updates.
 */
function collectFactIssues(raw: Record<string, unknown>, issues: ValidationIssue[]): void {
    if (raw.sessionRpe !== undefined && !isNumberInRange(raw.sessionRpe, 0, 10)) {
        issues.push({ path: 'sessionRpe', message: 'sessionRpe must be a number between 0 and 10' });
    }
    if (raw.completedFraction !== undefined && !isNumberInRange(raw.completedFraction, 0, 1)) {
        issues.push({ path: 'completedFraction', message: 'completedFraction must be a number between 0 and 1' });
    }
    if (raw.unexpectedFatigue !== undefined && typeof raw.unexpectedFatigue !== 'boolean') {
        issues.push({ path: 'unexpectedFatigue', message: 'unexpectedFatigue must be boolean' });
    }
    // 2000-char cap mirrors firestore.rules' size() <= 2000 check, so a too-long note fails
    // here rather than surfacing as an unexplained permission-denied at write time.
    if (raw.techniqueNote !== undefined && (typeof raw.techniqueNote !== 'string' || raw.techniqueNote.length > 2000)) {
        issues.push({ path: 'techniqueNote', message: 'techniqueNote must be a string of at most 2000 characters' });
    }
    if (raw.note !== undefined && (typeof raw.note !== 'string' || raw.note.length > 2000)) {
        issues.push({ path: 'note', message: 'note must be a string of at most 2000 characters' });
    }
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

    if (!isValidCalendarDate(raw.date)) {
        issues.push({ path: 'date', message: 'date must be a YYYY-MM-DD string' });
    } else if (isObject(raw.sourceSession) && isValidCalendarDate(raw.sourceSession.date)) {
        // `date` equals sourceSession.date for `immediate` and the same-day `later_day`
        // follow-up, and must be later for `next_morning` (models.ts's own documented
        // invariant). ISO YYYY-MM-DD strings compare lexicographically the same as
        // chronologically. This check is the sole owner since #1202 (ADR-0053).
        const sourceDate = raw.sourceSession.date;
        if (raw.window === 'immediate' && raw.date !== sourceDate) {
            issues.push({ path: 'date', message: 'date must equal sourceSession.date for an immediate-window response' });
        } else if (raw.window === 'later_day' && raw.date !== sourceDate) {
            issues.push({ path: 'date', message: 'date must equal sourceSession.date for a later_day response' });
        } else if (raw.window === 'next_morning' && raw.date <= sourceDate) {
            issues.push({ path: 'date', message: 'date must be strictly later than sourceSession.date for a next_morning response' });
        }
    }

    if (!isObject(raw.checkinRef) || !isValidCalendarDate(raw.checkinRef.date)) {
        issues.push({ path: 'checkinRef', message: 'Invalid checkinRef: expected { date }' });
    }

    collectFactIssues(raw, issues);

    if (typeof raw.createdAt !== 'string' || raw.createdAt.length === 0) issues.push({ path: 'createdAt', message: 'Missing createdAt' });
    if (typeof raw.updatedAt !== 'string' || raw.updatedAt.length === 0) issues.push({ path: 'updatedAt', message: 'Missing updatedAt' });

    const extra = Object.keys(raw).filter(key => !RESPONSE_KEYS.includes(key));
    for (const key of extra) issues.push({ path: key, message: `Unrecognized field: ${key}` });

    if (issues.length > 0) return { ok: false, issues };
    return { ok: true, value: raw as unknown as SessionResponse };
}

/**
 * Validates a partial fact update (`updateResponseFacts` and the raced-create update in
 * `recordOrUpdateResponse`). Only the five non-tissue facts may appear: provenance fields
 * are immutable and never part of a patch. The cross-field window/date checks need no
 * re-run here, because a patch cannot touch `sourceSession`, `window` or `date`, and the
 * Firestore rules keep those three equal to the stored, create-validated values.
 */
export function validateSessionResponseFacts(raw: unknown): ValidationResult<Record<string, unknown>> {
    if (!isObject(raw)) return { ok: false, issues: [{ path: '', message: 'Expected object' }] };
    const issues: ValidationIssue[] = [];
    for (const key of Object.keys(raw)) {
        if (!FACT_KEYS.includes(key)) issues.push({ path: key, message: `Not a revisable session fact: ${key}` });
    }
    collectFactIssues(raw, issues);
    if (issues.length > 0) return { ok: false, issues };
    return { ok: true, value: raw };
}

function formatIssues(issues: ValidationIssue[]): string {
    return issues.map(issue => (issue.path ? `${issue.path}: ${issue.message}` : issue.message)).join('; ');
}

/**
 * Write-path guard (issue #1202, ADR-0053): `SessionResponseService` calls this before every
 * full-document create. It owns the value checks the Firestore rules no longer make.
 */
export function assertValidSessionResponse(raw: unknown): asserts raw is SessionResponse {
    const result = validateSessionResponse(raw);
    if (!result.ok) throw new Error(`Invalid session response: ${formatIssues(result.issues)}`);
}

/** Write-path guard for a partial fact update; see {@link validateSessionResponseFacts}. */
export function assertValidSessionResponseFacts(raw: unknown): void {
    const result = validateSessionResponseFacts(raw);
    if (!result.ok) throw new Error(`Invalid session response facts: ${formatIssues(result.issues)}`);
}
