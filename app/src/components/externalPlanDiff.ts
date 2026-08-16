import type { ExternalTrainingPlan } from '../engine/models';

export interface PlanDiffRow {
    sessionId: string;
    change: 'added' | 'removed' | 'changed';
    detail: string;
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
        if (!sameStructuredValue(old.prescription, session.prescription)) changes.push('the prescription changed');
        if (changes.length > 0) rows.push({ sessionId: id, change: 'changed', detail: `“${session.title}”: ${changes.join('; ')}.` });
    }

    return rows;
}
