/** Layer 5: bounded coaching records and recorded placement history. */
import { hasRecordedPrevious, placementAsOf, placementBeforeHistory, type PlacementAssignment } from '../placementHistory.ts';
import { byDateThenId, collect, sourceState, type BuildContext } from './buildContext.ts';
import type { ChoiceOverrideInput, LedgerExportRecords, PlacementInput, PlanSessionContentInput } from './inputs.ts';
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
import { addDaysToLocalDateString } from '../../utils/localDate.ts';
import { classifyPlacementOutcome } from '../../derived/placements/placementOutcome.ts';
import { inBounds, isLocalDate, PLACEMENT_FORWARD_DAYS, warsawDateOf, windowBounds, type DateBounds } from './window.ts';

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

/** Authored content of the placement's session, or the reason it cannot be read. */
function sessionContent(row: FlatAssignment, records: LedgerExportRecords, context: BuildContext):
    { session?: PlanSessionContentInput; absent: LedgerState } {
    const revision = records.planRevisions?.find(item => item.planId === row.planId && item.revision === row.revision);
    // A revision that is not exported failed verification (invalid source) or could not be read.
    if (!revision?.sessions) {
        return { absent: revision && !revision.sessions ? 'unavailable'
            : context.sources.external_plan_revisions?.state === 'invalid' ? 'invalid' : 'unavailable' };
    }
    return { session: revision.sessions.find(item => item.id === row.sessionId), absent: 'not_recorded' };
}

/** Historical window plus the purpose's inclusive forward days (upcoming sessions). */
function placementBounds(context: BuildContext): DateBounds {
    return { from: context.window.startDate, to: addDaysToLocalDateString(context.window.endDate, PLACEMENT_FORWARD_DAYS[context.purpose]) };
}

const sameSession = (row: FlatAssignment) => (item: { planId: string; revision: number; sessionId: string }) =>
    item.planId === row.planId && item.revision === row.revision && item.sessionId === row.sessionId;

/** Placements, executions and links were all read completely, so absence can be asserted. */
function outcomeEvidenceComplete(records: LedgerExportRecords, context: BuildContext): boolean {
    return records.planExecutions !== undefined
        && sourceState(context, 'external_plan_placements', records.placements !== undefined || records.placementHistory !== undefined) === 'measured'
        && sourceState(context, 'planned_to_performed', records.plannedToPerformed !== undefined) === 'measured'
        // An unverified revision's executions cannot be matched by content hash.
        && sourceState(context, 'external_plan_revisions', records.planRevisions !== undefined) === 'measured'
        && sourceState(context, 'performed_training_occurrences', records.performedOccurrences !== undefined) === 'measured';
}

/** Every date this session was ever assigned in this revision, from its recorded history. */
function recordedDates(row: FlatAssignment, records: LedgerExportRecords): string[] {
    return (records.placementHistory ?? [])
        .filter(event => event.planId === row.planId && event.revision === row.revision)
        .flatMap(event => [...event.previous, ...event.assignments])
        .filter(item => item.sessionId === row.sessionId)
        .map(item => item.date);
}

/**
 * Whether the export's evidence reads can establish absence for this one placement. Executions
 * and links are read only inside the export window, so absence is unproven when:
 * - the placement is dated after the window end (a window that ends before the as-of date);
 * - the session was moved: the first move never records the authored date, so an attempt on that
 *   earlier date may lie outside the read (a recorded date before the window start says the same);
 * - the same plan session has a link or execution under another revision, or a newer revision of
 *   the plan was imported on or before the placement date, so the work may belong to that revision.
 */
function evidenceCoversPlacement(row: FlatAssignment, records: LedgerExportRecords, context: BuildContext): boolean {
    if (row.date > context.window.endDate) return false;
    const dates = recordedDates(row, records);
    if (dates.some(date => date < context.window.startDate)) return false;
    if (row.status === 'moved') return false;
    const otherRevision = (item: { planId: string; revision: number; sessionId: string }) =>
        item.planId === row.planId && item.sessionId === row.sessionId && item.revision !== row.revision;
    if ([...(records.plannedToPerformed ?? []), ...(records.planExecutions ?? []), ...(records.unverifiedPlanEvidence ?? [])]
        .some(otherRevision)) return false;
    return !(records.planRevisions ?? []).some(revision => revision.planId === row.planId && revision.revision > row.revision
        && (warsawDateOf(revision.importedAt) ?? '') <= row.date);
}

/** Export-only derived outcome of a past placement; today and later are `not_applicable`. */
function placementOutcome(row: FlatAssignment, records: LedgerExportRecords, context: BuildContext, evidenceComplete: boolean) {
    const outcome = classifyPlacementOutcome({
        assignedDate: row.date,
        asOfDate: context.asOfDate,
        status: row.removed ? null : row.status,
        evidenceComplete: evidenceComplete && evidenceCoversPlacement(row, records, context),
        linked: (records.plannedToPerformed ?? []).some(sameSession(row)),
        unverifiedEvidence: (records.unverifiedPlanEvidence ?? []).some(sameSession(row)),
        executions: (records.planExecutions ?? []).filter(sameSession(row)),
    });
    return fact(outcome, { source: SOURCE, observedOn: row.date, absent: 'not_applicable' });
}

function buildPlacements(flat: FlatAssignment[] | undefined, records: LedgerExportRecords, context: BuildContext) {
    const evidenceComplete = outcomeEvidenceComplete(records, context);
    const result = collect(context, {
        key: 'external_plan_placements',
        records: flat,
        dateOf: row => row.date,
        bounds: placementBounds(context),
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
            const { session, absent } = sessionContent(row, records, context);
            const content = { ...base, absent };
            const notes = session?.stepNotes?.filter(note => note.trim() !== '');
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
                title: fact(session?.title, content),
                priority: fact(session?.priority, content),
                summary: fact(session?.summary, content),
                stepNotes: fact(notes?.length ? [...notes] : null, content),
                fallback: fact(session?.fallback, content),
                outcome: placementOutcome(row, records, context, evidenceComplete),
            };
            return record(assignmentId(row), row.date, values);
        },
    });
    const dated = (flat ?? []).filter(row => isLocalDate(row.date)).length;
    return { ...result, droppedOutOfWindow: dated - result.items.length };
}

function buildChoiceOverrides(records: LedgerExportRecords, context: BuildContext) {
    return collect(context, {
        key: 'performed_training_occurrences',
        records: records.choiceOverrides,
        dateOf: row => row.date,
        toItem: (row: ChoiceOverrideInput) => {
            const base = { source: SOURCE, observedOn: row.date };
            const values: Record<typeof OVERRIDE_FIELDS[number], LedgerValue<unknown>> = {
                planId: fact(row.planId, { ...base, absent: 'not_applicable' }),
                sessionId: fact(row.sessionId, { ...base, absent: 'not_applicable' }),
                kind: fact(row.kind, { ...base, absent: row.kindState ?? 'missing' }),
                date: fact(row.date, base),
                reason: fact(row.reason, { ...base, absent: 'not_recorded' }),
                step: fact(row.step, { ...base, absent: row.stepState ?? (row.kind === null ? row.kindState ?? 'missing' : 'missing') }),
                replacement: fact(row.replacement, {
                    ...base,
                    absent: row.kind === 'swapped' ? row.replacementState ?? 'missing' : row.kind === null ? row.kindState ?? 'missing' : 'not_applicable',
                }),
                executionState: fact(row.executionState, base),
            };
            return record(`choice:${row.id}`, row.date, values);
        },
    });
}

/** Placement drops/moves plus in-session swaps/omissions. The collection's state is the worse of
 * the placement read and the execution read, so a failed read of either is never a clean list. */
function buildOverrides(flat: FlatAssignment[] | undefined, records: LedgerExportRecords, context: BuildContext) {
    const placements = buildPlacementOverrides(flat, context);
    const choices = buildChoiceOverrides(records, context);
    return {
        ...placements,
        // Both reads feed this collection; naming only one would blame the wrong read on failure.
        source: `${placements.source} + ${choices.source}`,
        state: worstState([placements.state, choices.state]),
        items: byDateThenId([...placements.items, ...choices.items]),
        droppedUndated: placements.droppedUndated + choices.droppedUndated,
    };
}

function buildPlacementOverrides(flat: FlatAssignment[] | undefined, context: BuildContext) {
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
                step: fact(null, { ...base, absent: 'not_applicable' }),
                replacement: fact(null, { ...base, absent: 'not_applicable' }),
                executionState: fact(null, { ...base, absent: 'not_applicable' }),
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
    // An exported placement keeps its revision header, including a future one on an older revision.
    const referenced = new Set((flat ?? []).filter(row => inBounds(row.date, placementBounds(context)))
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
        overrides: buildOverrides(flat, records, placementContext),
        plannedToPerformed: buildPlannedToPerformed(records, context),
    };
}
