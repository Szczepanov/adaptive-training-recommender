import type { DataIssue, DataState } from '../../engine/dataState';
import type { SessionResponse } from '../../responses/models';
import { validateSessionResponse } from '../../responses/validation';

function invalid(documentPath: string, code: string, field?: string, message?: string): DataState<never> {
    const issue: DataIssue = {
        code,
        documentPath,
        ...(field ? { field } : {}),
        ...(message ? { message } : {}),
    };
    return { status: 'INVALID', issues: [issue] };
}

export function parseSessionResponseDocument(
    raw: unknown,
    documentPath: string,
): DataState<SessionResponse> {
    if (raw === undefined || raw === null) {
        return { status: 'MISSING' };
    }

    const validation = validateSessionResponse(raw);
    if (!validation.ok) {
        const first = validation.issues[0];
        return invalid(documentPath, 'invalid-session-response', first?.path, first?.message);
    }

    return {
        status: 'AVAILABLE',
        data: validation.value,
        revision: null,
    };
}
