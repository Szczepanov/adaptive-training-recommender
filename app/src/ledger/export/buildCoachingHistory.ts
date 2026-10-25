/**
 * Layer 5 (`coachingHistory`, ADR-0052 D-COACHLOG). Placements, overrides and links are
 * bounded to the export window. Plan revisions are immutable and backed: only those an
 * in-window placement references, plus each plan's latest revision, are exported. The
 * placement overlay is current-state only, so status/date history and override reasons are
 * `not_yet_supported` (OD3) rather than inferred.
 */
import { collect, type BuildContext } from './buildContext.ts';
import type { LedgerExportRecords, PlacementInput } from './inputs.ts';
import { fact, notYetSupported, record } from './ledgerValue.ts';
import type {
    LedgerCoachingHistory,
    LedgerValue,
    OVERRIDE_FIELDS,
    PLACEMENT_FIELDS,
    PLAN_REVISION_FIELDS,
    PLANNED_TO_PERFORMED_FIELDS,
} from './schema.ts';
import { inBounds, warsawDateOf, windowBounds } from './window.ts';

const SOURCE = 'adaptive';
const OVERRIDE_STATUSES: readonly string[] = ['dropped', 'moved'];

interface FlatAssignment {
    planId: string;
    revision: number;
    sessionId: string;
    date: string;
    status: PlacementInput['assignments'][number]['status'];
}

function flatten(rows: readonly PlacementInput[] | undefined): FlatAssignment[] | undefined {
    return rows?.flatMap(row => row.assignments.map(assignment => ({
        planId: row.planId,
        revision: row.revision,
        ...assignment,
    })));
}

const assignmentId = (row: FlatAssignment): string => `${row.planId}@${row.revision}:${row.sessionId}`;

function buildPlacements(flat: FlatAssignment[] | undefined, context: BuildContext) {
    return collect(context, {
        key: 'external_plan_placements',
        records: flat,
        dateOf: row => row.date,
        toItem: row => {
            const base = { source: SOURCE, observedOn: row.date };
            const values: Record<typeof PLACEMENT_FIELDS[number], LedgerValue<unknown>> = {
                planId: fact(row.planId, base),
                revision: fact(row.revision, base),
                sessionId: fact(row.sessionId, base),
                status: fact(row.status, base),
                date: fact(row.date, base),
                statusHistory: notYetSupported(SOURCE),
            };
            return record(assignmentId(row), row.date, values);
        },
    });
}

function buildOverrides(flat: FlatAssignment[] | undefined, context: BuildContext) {
    return collect(context, {
        key: 'external_plan_placements',
        records: flat,
        include: row => OVERRIDE_STATUSES.includes(row.status),
        dateOf: row => row.date,
        toItem: row => {
            const base = { source: SOURCE, observedOn: row.date };
            const values: Record<typeof OVERRIDE_FIELDS[number], LedgerValue<unknown>> = {
                planId: fact(row.planId, base),
                sessionId: fact(row.sessionId, base),
                kind: fact(row.status, base),
                date: fact(row.date, base),
                reason: notYetSupported(SOURCE),
            };
            return record(assignmentId(row), row.date, values);
        },
    });
}

function buildPlannedToPerformed(records: LedgerExportRecords, context: BuildContext) {
    return collect(context, {
        key: 'planned_to_performed',
        records: records.plannedToPerformed,
        dateOf: row => row.date,
        toItem: row => {
            const base = { source: SOURCE, observedOn: row.date };
            const values: Record<typeof PLANNED_TO_PERFORMED_FIELDS[number], LedgerValue<unknown>> = {
                planId: fact(row.planId, base),
                sessionId: fact(row.sessionId, base),
                date: fact(row.date, base),
                performedOccurrenceRef: fact(row.performedOccurrenceId, base),
            };
            return record(`${row.planId}:${row.sessionId}`, row.date, values);
        },
    });
}

function buildPlanRevisions(
    records: LedgerExportRecords,
    flat: FlatAssignment[] | undefined,
    context: BuildContext,
) {
    const bounds = windowBounds(context.window);
    const referenced = new Set((flat ?? []).filter(row => inBounds(row.date, bounds))
        .map(row => `${row.planId}@${row.revision}`));
    const latest = new Map<string, number>();
    for (const row of records.planRevisions ?? []) {
        latest.set(row.planId, Math.max(latest.get(row.planId) ?? row.revision, row.revision));
    }
    return collect(context, {
        key: 'external_plan_revisions',
        records: records.planRevisions,
        include: row => referenced.has(`${row.planId}@${row.revision}`) || latest.get(row.planId) === row.revision,
        toItem: row => {
            const date = warsawDateOf(row.importedAt) ?? undefined;
            const base = { source: SOURCE, observedOn: date };
            const values: Record<typeof PLAN_REVISION_FIELDS[number], LedgerValue<unknown>> = {
                planId: fact(row.planId, base),
                revision: fact(row.revision, base),
                contentHash: fact(row.contentHash, base),
                importedAt: fact(row.importedAt, base),
                schema: fact(row.schema, base),
                authorRationale: fact(row.notes, { ...base, absent: 'not_recorded' }),
            };
            return record(`${row.planId}@${row.revision}`, date ?? null, values);
        },
    });
}

export function buildCoachingHistory(records: LedgerExportRecords, context: BuildContext): LedgerCoachingHistory {
    const flat = flatten(records.placements);
    return {
        planRevisions: buildPlanRevisions(records, flat, context),
        placements: buildPlacements(flat, context),
        overrides: buildOverrides(flat, context),
        plannedToPerformed: buildPlannedToPerformed(records, context),
    };
}
