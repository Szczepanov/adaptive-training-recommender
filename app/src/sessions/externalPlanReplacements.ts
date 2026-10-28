/**
 * #1172: explicit session replacement across plan revisions.
 *
 * A v6 session may declare `replacesSessionId`: the id of the session in the immediately
 * previous stored revision of the same plan that it replaces. Activation then marks that
 * earlier session `superseded` and records the link in its placement history. A link is only
 * ever what the coach declared; nothing here infers one from titles, dates or similarity.
 *
 * Shape checks run in the v6 schema validator. Checks that need the previous revision run at
 * import and preflight, where that revision is known.
 */
import { EXTERNAL_PLAN_SESSION_ID_MAX_CHARS, type ValidationError } from '../engine/validation';

export interface SessionReplacement {
    /** The declaring session in the new revision. */
    sessionId: string;
    /** The replaced session in the previous revision. */
    replacesSessionId: string;
    /** Index of the declaring session, for error paths. */
    index: number;
}

/** `replaced-session-completed` needs the previous revision's placement, so only import and
 * preflight raise it; the other two need only the previous revision itself. */
export type SessionReplacementIssueCode = 'replacement-previous-revision-missing' | 'replaced-session-not-found' | 'replaced-session-completed';

export interface SessionReplacementIssue {
    code: SessionReplacementIssueCode;
    field: string;
    sessionId: string;
    replacesSessionId: string;
}

const fieldPath = (index: number): string => `sessions[${index}].replacesSessionId`;

function sessionRecords(sessions: unknown): { index: number; id: unknown; replaces: unknown; declared: boolean }[] {
    if (!Array.isArray(sessions)) return [];
    return sessions.flatMap((item: unknown, index: number) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
        const record = item as { id?: unknown; replacesSessionId?: unknown };
        return [{ index, id: record.id, replaces: record.replacesSessionId, declared: 'replacesSessionId' in record }];
    });
}

/**
 * Schema-level rules: a declaration is a non-empty id within the persisted identity bound, no
 * two sessions replace the same earlier session, and a declaration may not name a different
 * session that this revision itself keeps. The last rule also rules out swap cycles. A session
 * may name its own id: the same id in the previous revision.
 */
export function validateReplacementDeclarations(sessions: unknown): ValidationError[] {
    const records = sessionRecords(sessions);
    const ownIds = new Set(records.map(record => record.id).filter((id): id is string => typeof id === 'string'));
    const claimed = new Set<string>();
    const errors: ValidationError[] = [];
    for (const record of records) {
        if (!record.declared) continue;
        const field = fieldPath(record.index);
        if (typeof record.replaces !== 'string' || record.replaces.length === 0) {
            errors.push({ field, message: 'replacesSessionId must be a non-empty session id' });
            continue;
        }
        if (record.replaces.length > EXTERNAL_PLAN_SESSION_ID_MAX_CHARS) {
            errors.push({ field, message: `replacesSessionId must be at most ${EXTERNAL_PLAN_SESSION_ID_MAX_CHARS} characters` });
            continue;
        }
        if (claimed.has(record.replaces)) {
            errors.push({ field, message: `Another session already replaces ${record.replaces}` });
        }
        claimed.add(record.replaces);
        if (record.replaces !== record.id && ownIds.has(record.replaces)) {
            errors.push({ field, message: `replacesSessionId cannot name ${record.replaces}, which this revision also keeps` });
        }
    }
    return errors;
}

/** The explicit declarations of a validated plan, in authored order. */
export function declaredSessionReplacements(plan: { sessions: readonly unknown[] }): SessionReplacement[] {
    return sessionRecords(plan.sessions).flatMap(record => typeof record.id === 'string'
        && typeof record.replaces === 'string' && record.replaces.length > 0
        ? [{ sessionId: record.id, replacesSessionId: record.replaces, index: record.index }]
        : []);
}

/** Checks each declaration against the previous stored revision of the same plan. */
export function validateReplacementsAgainstPrevious(
    plan: { planId: string; sessions: readonly unknown[] },
    previous: { planId: string; sessions: readonly { id: string }[] } | null,
): SessionReplacementIssue[] {
    const declarations = declaredSessionReplacements(plan);
    if (declarations.length === 0) return [];
    const previousIds = previous && previous.planId === plan.planId ? new Set(previous.sessions.map(item => item.id)) : null;
    return declarations.flatMap(({ sessionId, replacesSessionId, index }): SessionReplacementIssue[] => {
        const base = { field: fieldPath(index), sessionId, replacesSessionId };
        if (!previousIds) return [{ code: 'replacement-previous-revision-missing', ...base }];
        return previousIds.has(replacesSessionId) ? [] : [{ code: 'replaced-session-not-found', ...base }];
    });
}
