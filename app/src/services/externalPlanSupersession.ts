/**
 * #1172: the placement change a revision import writes on the previous revision for each
 * session the new revision explicitly declares it replaces (`replacesSessionId`).
 *
 * Pure. Only declared sessions change: each becomes `superseded` on the date it already held
 * (its moved date, or its authored default date when it had no assignment). Every other
 * assignment is kept as it was. Nothing is inferred for undeclared sessions.
 */
import type { ExternalPlacementAssignment, ExternalTrainingPlan } from '../engine/models';
import { impliedDate } from '../engine/externalPlacement';
import type { AnyExternalTrainingPlan } from '../sessions/externalPlanV2';
import type { SessionReplacement } from '../sessions/externalPlanReplacements';
import type { PlacementEvent } from '../ledger/placementHistory';

export type SupersessionIssueCode = 'replaced-session-completed';

export type SupersessionChange =
    | { ok: true; assignments: ExternalPlacementAssignment[]; successors: PlacementEvent['successors'] }
    | { ok: false; code: SupersessionIssueCode; field: string };

export function supersedeDeclaredSessions(
    previousPlan: AnyExternalTrainingPlan,
    previousAssignments: readonly ExternalPlacementAssignment[],
    declarations: readonly SessionReplacement[],
    newRevision: number,
): SupersessionChange {
    const byId = new Map(previousAssignments.map(item => [item.sessionId, item]));
    // A completed session is performed history; superseding it would overwrite that record.
    const completed = declarations.find(item => byId.get(item.replacesSessionId)?.status === 'completed');
    if (completed) return { ok: false, code: 'replaced-session-completed', field: `sessions[${completed.index}].replacesSessionId` };

    const replaced = new Set(declarations.map(item => item.replacesSessionId));
    const kept = previousAssignments.map(item => replaced.has(item.sessionId) ? { ...item, status: 'superseded' as const } : item);
    const added = declarations.filter(item => !byId.has(item.replacesSessionId)).flatMap(item => {
        const session = previousPlan.sessions.find(candidate => candidate.id === item.replacesSessionId);
        return session ? [{
            sessionId: item.replacesSessionId,
            date: impliedDate(previousPlan as ExternalTrainingPlan, session as ExternalTrainingPlan['sessions'][number]),
            status: 'superseded' as const,
        }] : [];
    });
    const successors = Object.fromEntries(declarations.map(item => [item.replacesSessionId,
        { revision: newRevision, sessionId: item.sessionId }]));
    return { ok: true, assignments: [...kept, ...added], successors };
}
