// M3.6: a plan may be either schema version; every field compared below except the final
// content check is identical on v1 and v2 sessions. M3.7 replaces the content check's
// coarse "changed"/"unchanged" with a fine-grained per-field diff for v2 sessions (whose
// content is a normalized `SessionDefinition`); v1's flat `ExternalPrescription` keeps the
// coarse check since it has no comparable block/step structure to diff.
import { isV2Session, type AnyExternalTrainingPlan as ExternalTrainingPlan } from '../sessions/externalPlanV2';
import { diffSessionDefinitions, hasBehaviorChanges, type SessionContentDiffRow } from '../sessions/sessionDefinitionDiff';

export interface PlanDiffRow {
    sessionId: string;
    change: 'added' | 'removed' | 'changed';
    detail: string;
    /** Fine-grained content diff, present only when both revisions are `external-plan@2`
     * sessions. Absence does not mean nothing changed -- see `detail` for the coarse v1
     * fallback line ("the session content changed"). */
    contentChanges?: SessionContentDiffRow[];
}

function sameStringSet(left: readonly string[] | undefined, right: readonly string[] | undefined): boolean {
    return JSON.stringify([...(left ?? [])].sort()) === JSON.stringify([...(right ?? [])].sort());
}

function sameStructuredValue(left: unknown, right: unknown): boolean {
    return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

/**
 * What actually differs between the stored revision and the pasted one.
 *
 * The comparison is by stable session id and includes every field that can change
 * placement, feasibility, adjudication, objective credit, event semantics or the
 * prescription the athlete will execute. Pure metadata ordering (e.g. equipment/objective
 * array order) is intentionally ignored.
 */
export function diffPlans(previous: ExternalTrainingPlan, next: ExternalTrainingPlan): PlanDiffRow[] {
    const before = new Map(previous.sessions.map(session => [session.id, session]));
    const after = new Map(next.sessions.map(session => [session.id, session]));
    const rows: PlanDiffRow[] = [];

    for (const [id, session] of before) {
        if (!after.has(id)) rows.push({ sessionId: id, change: 'removed', detail: `“${session.title}” is no longer in the plan.` });
    }
    for (const [id, session] of after) {
        const old = before.get(id);
        if (!old) {
            rows.push({ sessionId: id, change: 'added', detail: `“${session.title}” is new (week ${session.placement.week}).` });
            continue;
        }
        const changes: string[] = [];
        if (old.title !== session.title) changes.push(`renamed from “${old.title}”`);
        if (old.priority !== session.priority) changes.push(`priority ${old.priority} → ${session.priority}`);
        if (old.placement.week !== session.placement.week) changes.push(`moved from week ${old.placement.week} to ${session.placement.week}`);
        if (old.placement.preferredDay !== session.placement.preferredDay) {
            changes.push(`preferred day ${old.placement.preferredDay ?? 'none'} → ${session.placement.preferredDay ?? 'none'}`);
        }
        if (old.placement.flexibility !== session.placement.flexibility) {
            changes.push(`flexibility ${old.placement.flexibility} → ${session.placement.flexibility}`);
        }
        if (old.placement.ifMissed !== session.placement.ifMissed) {
            changes.push(`missed-session policy ${old.placement.ifMissed} → ${session.placement.ifMissed}`);
        }
        if (old.gating.intensity !== session.gating.intensity) changes.push(`intensity ${old.gating.intensity} → ${session.gating.intensity}`);
        if (old.gating.modality !== session.gating.modality) changes.push(`modality ${old.gating.modality} → ${session.gating.modality}`);
        if (old.gating.durationMin !== session.gating.durationMin || old.gating.durationMax !== session.gating.durationMax) {
            changes.push(`duration ${old.gating.durationMin}–${old.gating.durationMax} → ${session.gating.durationMin}–${session.gating.durationMax} min`);
        }
        if (old.gating.environment !== session.gating.environment) {
            changes.push(`environment ${old.gating.environment} → ${session.gating.environment}`);
        }
        if (!sameStringSet(old.gating.equipment, session.gating.equipment)) changes.push('required equipment changed');
        if (!sameStringSet(old.objectives, session.objectives)) changes.push('objective tags changed');
        if (!sameStructuredValue(old.scaling, session.scaling)) changes.push('scaling / fallback policy changed');
        if (Boolean(old.isEvent) !== Boolean(session.isEvent)) changes.push(session.isEvent ? 'now marked as an event' : 'no longer marked as an event');

        let contentChanges: SessionContentDiffRow[] | undefined;
        if (isV2Session(old) && isV2Session(session)) {
            // Fine-grained per-field content diff (M3.7): what changed inside blocks/steps/
            // choices, not just that something did.
            contentChanges = diffSessionDefinitions(old.definition, session.definition);
            if (contentChanges.length > 0) {
                changes.push(hasBehaviorChanges(contentChanges) ? 'the session content changed (see below)' : 'session wording changed (see below)');
            }
        } else {
            // v1's flat `ExternalPrescription` has no comparable block/step structure --
            // this stays a coarse "changed"/"unchanged" content comparison.
            const oldContent = isV2Session(old) ? old.definition : old.prescription;
            const newContent = isV2Session(session) ? session.definition : session.prescription;
            if (!sameStructuredValue(oldContent, newContent)) changes.push('the session content changed');
        }

        if (changes.length > 0) {
            rows.push({
                sessionId: id,
                change: 'changed',
                detail: `“${session.title}”: ${changes.join('; ')}.`,
                ...(contentChanges && contentChanges.length > 0 ? { contentChanges } : {}),
            });
        }
    }

    return rows;
}
