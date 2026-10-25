/**
 * Layer 5 (`coachingHistory`, ADR-0052 D-COACHLOG). Plan revisions are immutable and backed;
 * the placement overlay is current-state only, so status/date history and override reasons
 * are reported `not_yet_supported` (OD3) rather than inferred.
 */
import { collect, type BuildContext } from './buildContext.ts';
import type { LedgerExportRecords, PlacementInput } from './inputs.ts';
import { fact, notYetSupported, record } from './ledgerValue.ts';
import type { LedgerCoachingHistory, LedgerValue, PLAN_REVISION_FIELDS } from './schema.ts';

const SOURCE = 'adaptive';
const OVERRIDE_STATUSES = ['dropped', 'moved'] as const;

function buildPlanRevisions(records: LedgerExportRecords, context: BuildContext) {
    return collect(context, 'external_plan_revisions', records.planRevisions, rows => rows.map(row => {
        const base = { source: SOURCE };
        const values: Record<typeof PLAN_REVISION_FIELDS[number], LedgerValue<unknown>> = {
            planId: fact(row.planId, base),
            revision: fact(row.revision, base),
            contentHash: fact(row.contentHash, base),
            importedAt: fact(row.importedAt, base),
            schemaVersion: fact(row.schemaVersion, base),
            authorRationale: fact(row.notes, { ...base, absent: 'not_recorded' }),
        };
        return record(`${row.planId}@${row.revision}`, null, values);
    }).sort((a, b) => a.id.localeCompare(b.id)));
}

function flattenAssignments(rows: readonly PlacementInput[]) {
    return rows.flatMap(row => row.assignments.map(assignment => ({ planId: row.planId, ...assignment })));
}

function buildPlacements(records: LedgerExportRecords, context: BuildContext) {
    return collect(context, 'external_plan_placements', records.placements, rows => flattenAssignments(rows)
        .map(row => {
            const base = { source: SOURCE, ...(row.date ? { observedOn: row.date } : {}) };
            return record(`${row.planId}:${row.assignmentId}`, row.date ?? null, {
                planId: fact(row.planId, base),
                status: fact(row.status, base),
                date: fact(row.date, base),
                statusHistory: notYetSupported(SOURCE),
            });
        }).sort((a, b) => a.id.localeCompare(b.id)));
}

function buildOverrides(records: LedgerExportRecords, context: BuildContext) {
    return collect(context, 'external_plan_placements', records.placements, rows => flattenAssignments(rows)
        .filter(row => (OVERRIDE_STATUSES as readonly string[]).includes(row.status))
        .map(row => {
            const base = { source: SOURCE, ...(row.date ? { observedOn: row.date } : {}) };
            return record(`${row.planId}:${row.assignmentId}`, row.date ?? null, {
                planId: fact(row.planId, base),
                kind: fact(row.status, base),
                date: fact(row.date, base),
                reason: notYetSupported(SOURCE),
            });
        }).sort((a, b) => a.id.localeCompare(b.id)));
}

function buildPlannedToPerformed(records: LedgerExportRecords, context: BuildContext) {
    return collect(context, 'planned_to_performed', records.plannedToPerformed, rows => rows.map(row => {
        const base = { source: SOURCE };
        return record(`${row.planId}:${row.placementRef}`, null, {
            planId: fact(row.planId, base),
            placementRef: fact(row.placementRef, base),
            performedOccurrenceRef: fact(row.performedOccurrenceId, base),
        });
    }).sort((a, b) => a.id.localeCompare(b.id)));
}

export function buildCoachingHistory(records: LedgerExportRecords, context: BuildContext): LedgerCoachingHistory {
    return {
        planRevisions: buildPlanRevisions(records, context),
        placements: buildPlacements(records, context),
        overrides: buildOverrides(records, context),
        plannedToPerformed: buildPlannedToPerformed(records, context),
    };
}
