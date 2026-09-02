import type { DataIssue, DataState } from '../../engine/dataState';
import type { SessionExecution, SessionEntry, SessionRestEvent } from '../../sessions/models';
import { validateSessionExecution, validateSessionEntry, validateSessionRestEvent } from '../../sessions/validation';

function invalid(documentPath: string, code: string, field?: string, message?: string): DataState<never> {
    const issue: DataIssue = {
        code,
        documentPath,
        ...(field ? { field } : {}),
        ...(message ? { message } : {}),
    };
    return { status: 'INVALID', issues: [issue] };
}

export function parseSessionExecutionDocument(
    raw: unknown,
    documentPath: string,
): DataState<SessionExecution> {
    if (raw === undefined || raw === null) {
        return { status: 'MISSING' };
    }

    const validation = validateSessionExecution(raw);
    if (!validation.ok) {
        const first = validation.issues[0];
        return invalid(documentPath, 'invalid-session-execution', first?.path, first?.message);
    }

    return {
        status: 'AVAILABLE',
        data: validation.value,
        revision: null,
    };
}

export function parseSessionEntryDocument(
    raw: unknown,
    documentPath: string,
): DataState<SessionEntry> {
    if (raw === undefined || raw === null) {
        return { status: 'MISSING' };
    }

    const validation = validateSessionEntry(raw);
    if (!validation.ok) {
        const first = validation.issues[0];
        return invalid(documentPath, 'invalid-session-entry', first?.path, first?.message);
    }

    return {
        status: 'AVAILABLE',
        data: validation.value,
        revision: null,
    };
}

export function parseSessionRestEventDocument(
    raw: unknown,
    documentPath: string,
): DataState<SessionRestEvent> {
    if (raw === undefined || raw === null) {
        return { status: 'MISSING' };
    }

    const validation = validateSessionRestEvent(raw);
    if (!validation.ok) {
        const first = validation.issues[0];
        return invalid(documentPath, 'invalid-session-rest-event', first?.path, first?.message);
    }

    return {
        status: 'AVAILABLE',
        data: validation.value,
        revision: null,
    };
}
