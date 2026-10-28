/**
 * #1172: athlete-facing copy for declared session replacements (`replacesSessionId`).
 * The field name stays in the copy because the fix is an edit to the pasted plan JSON.
 */
import type { DataIssue } from '../engine/dataState';
import type { AnyExternalTrainingPlan } from '../sessions/externalPlanV2';
import type { SessionReplacementIssue } from '../sessions/externalPlanReplacements';

const titleOf = (plan: AnyExternalTrainingPlan | null | undefined, id: string): string =>
    plan?.sessions.find(session => session.id === id)?.title ?? id;

export function describeReplacementIssue(issue: SessionReplacementIssue, plan: AnyExternalTrainingPlan,
    previousPlan: AnyExternalTrainingPlan | null | undefined): string {
    const title = titleOf(plan, issue.sessionId);
    switch (issue.code) {
        case 'replaced-session-not-found':
            return `${title} says it replaces session “${issue.replacesSessionId}”, but revision ${previousPlan?.revision ?? 'the previous revision'} has no session with that id. Correct or remove replacesSessionId for ${title}.`;
        case 'replacement-previous-revision-missing':
            return `${title} says it replaces session “${issue.replacesSessionId}”, but this plan has no earlier revision to replace from. Remove replacesSessionId for ${title}.`;
        case 'replaced-session-before-effective-date':
            return `${title} would replace ${titleOf(previousPlan, issue.replacesSessionId)} before this revision takes effect. Choose an earlier effective date or remove replacesSessionId for ${title}.`;
        case 'replaced-session-completed':
            return `${title} would replace ${titleOf(previousPlan, issue.replacesSessionId)}, which is already completed. A completed session cannot be replaced. Remove replacesSessionId for ${title}.`;
    }
}

/** Resolves the declaring session from an issue field such as `sessions[0].replacesSessionId`. */
function declarationAt(plan: AnyExternalTrainingPlan, field: string | undefined): { sessionId: string; replacesSessionId: string } | null {
    const index = /^sessions\[(\d+)\]\.replacesSessionId$/.exec(field ?? '')?.[1];
    const session = index === undefined ? undefined : plan.sessions[Number(index)] as { id: string; replacesSessionId?: string } | undefined;
    return session?.replacesSessionId ? { sessionId: session.id, replacesSessionId: session.replacesSessionId } : null;
}

const REPLACEMENT_CODES: readonly string[] = ['replacement-previous-revision-missing', 'replaced-session-not-found', 'replaced-session-completed', 'replaced-session-before-effective-date'];

/** Copy for the replacement issues an import rejected; other issue codes are left to the caller. */
export function describeImportRejection(issues: readonly DataIssue[], plan: AnyExternalTrainingPlan,
    previousPlan: AnyExternalTrainingPlan | null | undefined): string[] {
    return issues.flatMap(issue => {
        if (issue.code === 'replaced-placement-owner-mismatch') {
            return ['The earlier revision’s saved moves belong to another account, so its replaced sessions cannot be marked. Nothing was stored.'];
        }
        const declaration = declarationAt(plan, issue.field);
        if (!declaration) return [];
        if (issue.code === 'replaced-session-successor-conflict') {
            return [`${titleOf(previousPlan, declaration.replacesSessionId)} is already marked as replaced by a different session. Nothing was stored.`];
        }
        return REPLACEMENT_CODES.includes(issue.code)
            ? [describeReplacementIssue({ code: issue.code as SessionReplacementIssue['code'], field: issue.field ?? '', ...declaration }, plan, previousPlan)]
            : [];
    });
}
