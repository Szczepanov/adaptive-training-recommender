/** Layer 5: bounded coaching records and recorded placement history. */
import { hasRecordedPrevious, placementAsOf, placementBeforeHistory, type PlacementAssignment } from '../placementHistory.ts';
import { collect, sourceState, type BuildContext } from './buildContext.ts';
import type { LedgerExportRecords, PlacementInput } from './inputs.ts';
import { fact, notYetSupported, record, worstState } from './ledgerValue.ts';
import type { LedgerState } from './schema.ts';
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
    removed?: boolean;
}

function flatten(rows: readonly PlacementInput[] | undefined): FlatAssignment[] | undefined {
    return rows?.flatMap(row => row.assignments.map(assignment => ({
        planId: row.planId,
        revision: row.revision,
        ...assignment,
    })));
}

const assignmentId = (row: FlatAssignment): string => `${row.planId}@${row.revision}:${row.sessionId}`;

function buildPlacements(flat: FlatAssignment[] | undefined, records: LedgerExportRecords, context: BuildContext) {
    return collect(context, {
        key: 'external_plan_placements',
        records: flat,
        dateOf: row => row.date,
        toItem: row => {
            const base = { source: SOURCE, observedOn: row.date };
            const history = records.placementHistory?.filter(event => event.planId === row.planId && event.revision === row.revision
                && event.changedOn <= context.asOfDate && (!hasRecordedPrevious(event)
                    || event.previous.some(item => item.sessionId === row.sessionId)
                    || event.assignments.some(item => item.sessionId === row.sessionId)))
                .sort((a, b) => a.changedOn.localeCompare(b.changedOn) || a.recordedAt.localeCompare(b.recordedAt))
                // A change over a corrupt overlay says the prior state is unknown, not that it was empty.
                .map(event => ({ changedOn: event.changedOn, recordedAt: event.recordedAt,
                    previousState: hasRecordedPrevious(event) ? 'recorded' : 'invalid',
                    previousStateReason: event.previousStateReason ?? null,
                    previous: event.previous.find(item => item.sessionId === row.sessionId) ?? null,
                    assignment: event.assignments.find(item => item.sessionId === row.sessionId) ?? null,
                    successor: event.successors[row.sessionId] ?? null }));
            const values: Record<typeof PLACEMENT_FIELDS[number], LedgerValue<unknown>> = {
                planId: fact(row.planId, base),
                revision: fact(row.revision, base),
                sessionId: fact(row.sessionId, base),
                status: fact(row.removed ? null : row.status, { ...base, absent: 'not_recorded' }),
                date: fact(row.removed ? null : row.date, { ...base, absent: 'not_recorded' }),
                // A revision whose history exceeded the bounded scan has unknown, not absent, history.
                statusHistory: records.placementHistoryUnavailable?.some(item => item.planId === row.planId && item.revision === row.revision)
                    ? fact(null, { ...base, absent: 'unavailable' })
                    : history?.length ? fact(history, base) : notYetSupported(SOURCE),
            };
            return record(assignmentId(row), row.date, values);
        },
    });
}

function buildOverrides(flat: FlatAssignment[] | undefined, context: BuildContext) {
    return collect(context, {
        key: 'external_plan_placements',
        records: flat,
        include: row => !row.removed && OVERRIDE_STATUSES.includes(row.status),
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
                revision: fact(row.revision, base),
                sessionId: fact(row.sessionId, base),
                date: fact(row.date, base),
                performedOccurrenceRef: fact(row.performedOccurrenceId, base),
            };
            return record(`${row.planId}@${row.revision}:${row.sessionId}:${row.performedOccurrenceId}`, row.date, values);
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
    for (const link of records.plannedToPerformed ?? []) {
        if (inBounds(link.date, bounds)) referenced.add(`${link.planId}@${link.revision}`);
    }
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

/** Degrades the placement collections when a revision's as-of state cannot be reconstructed. */
function withPlacementState(context: BuildContext, state: LedgerState): BuildContext {
    const key = 'external_plan_placements';
    const current = context.sources[key];
    return { ...context, sources: { ...context.sources,
        [key]: { readAt: current?.readAt ?? null, ...current, state: worstState([sourceState(context, key, true), state]) } } };
}

export function buildCoachingHistory(records: LedgerExportRecords, context: BuildContext): LedgerCoachingHistory {
    const placements = [...(records.placements ?? [])];
    const groups = new Map<string, NonNullable<LedgerExportRecords['placementHistory']>[number][]>();
    for (const event of records.placementHistory ?? []) {
        const key = `${event.planId}@${event.revision}`;
        groups.set(key, [...(groups.get(key) ?? []), event]);
    }
    let unknownBeforeHistory = false;
    for (const events of groups.values()) {
        const { planId, revision } = events[0];
        const index = placements.findIndex(row => row.planId === planId && row.revision === revision);
        // An as-of date before the first recorded change falls back to that change's `previous`
        // snapshot rather than dropping the revision's placements.
        // That snapshot is unknown when the first change replaced a corrupt overlay.
        const assignments = placementAsOf(events, context.asOfDate) ?? placementBeforeHistory(events);
        if (!assignments) unknownBeforeHistory = true;
        if (index >= 0) placements.splice(index, 1);
        if (assignments) placements.push({ planId, revision, assignments });
    }
    // A revision whose history exceeded the bounded scan can only show its current overlay. That
    // overlay is the as-of state only if it was last written on or before the as-of date.
    let unknownTruncatedOverlay = false;
    for (const truncated of records.placementHistoryUnavailable ?? []) {
        const index = placements.findIndex(row => row.planId === truncated.planId && row.revision === truncated.revision);
        if (index < 0) continue;
        const writtenOn = warsawDateOf(placements[index].updatedAt ?? '');
        if (writtenOn && writtenOn <= context.asOfDate) continue;
        placements.splice(index, 1);
        unknownTruncatedOverlay = true;
    }
    const flat = records.placements === undefined && records.placementHistory === undefined ? undefined : flatten(placements);
    for (const events of groups.values()) {
        const ordered = events.filter(event => event.changedOn <= context.asOfDate)
            .sort((a, b) => a.changedOn.localeCompare(b.changedOn) || a.recordedAt.localeCompare(b.recordedAt));
        const removed = new Map<string, FlatAssignment>();
        let known: readonly PlacementAssignment[] = [];
        for (const event of ordered) {
            // Over a corrupt overlay, removals are judged against the last recorded snapshot.
            for (const previous of hasRecordedPrevious(event) ? event.previous : known) {
                if (!event.assignments.some(item => item.sessionId === previous.sessionId)) {
                    removed.set(previous.sessionId, { planId: event.planId, revision: event.revision, ...previous, removed: true });
                }
            }
            for (const assignment of event.assignments) removed.delete(assignment.sessionId);
            known = event.assignments;
        }
        flat?.push(...removed.values());
    }
    const placementState: LedgerState = worstState([unknownBeforeHistory ? 'invalid' : 'measured',
        unknownTruncatedOverlay ? 'unavailable' : 'measured']);
    const placementContext = placementState === 'measured' ? context : withPlacementState(context, placementState);
    return {
        planRevisions: buildPlanRevisions(records, flat, context),
        placements: buildPlacements(flat, records, placementContext),
        overrides: buildOverrides(flat, placementContext),
        plannedToPerformed: buildPlannedToPerformed(records, context),
    };
}
