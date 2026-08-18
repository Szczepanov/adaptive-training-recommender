import type { DataIssue, DataState } from '../../engine/dataState';
import type { SessionDefinition, SessionOccurrence } from '../../sessions/models';
import { validateSessionDefinition, validateSessionOccurrence } from '../../sessions/validation';

function invalid(documentPath: string, code: string, field?: string, message?: string): DataState<never> {
    const issue: DataIssue = {
        code,
        documentPath,
        ...(field ? { field } : {}),
        ...(message ? { message } : {}),
    };
    return { status: 'INVALID', issues: [issue] };
}

export function parseSessionDefinitionDocument(
    raw: unknown,
    documentPath: string,
): DataState<SessionDefinition> {
    if (raw === undefined || raw === null) {
        return { status: 'MISSING' };
    }

    const validation = validateSessionDefinition(raw);
    if (!validation.ok) {
        const first = validation.issues[0];
        return invalid(documentPath, 'invalid-session-definition', first?.path, first?.message);
    }

    return {
        status: 'AVAILABLE',
        data: validation.value,
        revision: null,
    };
}

export function parseSessionOccurrenceDocument(
    raw: unknown,
    documentPath: string,
): DataState<SessionOccurrence> {
    if (raw === undefined || raw === null) {
        return { status: 'MISSING' };
    }

    const validation = validateSessionOccurrence(raw);
    if (!validation.ok) {
        const first = validation.issues[0];
        return invalid(documentPath, 'invalid-session-occurrence', first?.path, first?.message);
    }

    return {
        status: 'AVAILABLE',
        data: validation.value,
        revision: null,
    };
}
