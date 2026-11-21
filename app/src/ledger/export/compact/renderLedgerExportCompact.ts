import { text } from '../markdownText.ts';
import type {
    ActivityCollection, ContextRecord, LedgerCollection, LedgerExport, LedgerRecord,
    LedgerValue, SourceState,
} from '../schema.ts';
import { PLACEMENT_FORWARD_DAYS } from '../window.ts';
import { collapsedLine, dominantSource, entryLines, type FieldEntry, groupLabel, missingLine } from './compactLines.ts';
import { derivedMetricLines } from './derivedLines.ts';
import { flagsSection } from './flagLines.ts';
import {
    contextDelta,
    isCurrentFormat,
    type PreviousContext,
    unchangedLines,
    userContextCheckpoint,
    userContextStates,
} from './previousContext.ts';
import { renderTodaySections } from './todaySections.ts';

export { flagsSection };

export interface CompactRenderOptions {
    previousContext?: PreviousContext;
}

/**
 * Phase 4 refresh export: the `planning` export is the one used to start a new chat, so it
 * never abbreviates user context against a chat checkpoint. A new chat has seen nothing.
 */
export function purposeAlwaysRendersFullContext(purpose: LedgerExport['purpose']): boolean {
    return purpose === 'planning';
}

/** Ids already rendered by an earlier section; later sections skip them. */
export type SkipIds = ReadonlySet<string>;
const NO_SKIP: SkipIds = new Set();
const NO_BASELINED: ReadonlySet<'recovery' | 'checkins'> = new Set();

interface RecordRenderOptions {
    stripUnsupportedMeta?: boolean;
    omitPlanRevisionHeaderFields?: boolean;
}

function isDefaultUnsupportedMeta(key: string, value: LedgerValue<unknown>): boolean {
    return (key === 'since' || key === 'revisions')
        && (value.value === null || value.value === undefined)
        && value.state === 'not_yet_supported'
        && value.source === 'ledger';
}

function recordEntries(row: LedgerRecord, stripUnsupportedMeta = false): FieldEntry[] {
    const entries: FieldEntry[] = Object.entries(row.fields);
    if ('since' in row && 'revisions' in row) {
        const context = row as ContextRecord;
        entries.push(['since', context.since], ['revisions', context.revisions]);
    }
    return stripUnsupportedMeta
        ? entries.filter(([key, value]) => !isDefaultUnsupportedMeta(key, value))
        : entries;
}

function isRedundantHeaderField(
    key: string,
    value: LedgerValue<unknown>,
    row: LedgerRecord,
    group: string | undefined,
    options?: RecordRenderOptions,
): boolean {
    if (value.state !== 'measured' || value.source !== group) return false;
    if (key === 'date' && row.observedOn && value.value === row.observedOn) return true;
    if (options?.omitPlanRevisionHeaderFields && (key === 'planId' || key === 'revision')) {
        const planId = row.fields.planId;
        const revision = row.fields.revision;
        return planId?.state === 'measured' && planId.source === group
            && revision?.state === 'measured' && revision.source === group
            && row.id === `${planId.value}@${revision.value}`;
    }
    return false;
}

function recordLines(row: LedgerRecord, group: string | undefined, options?: RecordRenderOptions): string[] {
    const entries = recordEntries(row, options?.stripUnsupportedMeta);
    const collapsed = collapsedLine(row.id, entries, group, row.observedOn);
    if (collapsed) return [collapsed];
    const visible = entries.filter(([key, value]) => !isRedundantHeaderField(key, value, row, group, options));
    const date = row.observedOn ? ` (${text(row.observedOn)})` : '';
    return [`#### ${text(row.id)}${date}`, ...entryLines(visible, group)];
}

const fieldSourceOf = (rows: LedgerCollection<LedgerRecord>) => dominantSource(rows.items.flatMap(row => Object.entries(row.fields)));

function isActivityCollection<T extends LedgerRecord>(rows: LedgerCollection<T>): rows is ActivityCollection<T> {
    return 'truncated' in rows && 'totalInWindow' in rows;
}

function renderCollection<T extends LedgerRecord>(
    name: string,
    rows: LedgerCollection<T>,
    skipIds: SkipIds,
    skipped: string,
    renderBody: (items: T[], group: string | undefined) => string[],
    skippedLine?: string,
): string[] {
    const items = rows.items.filter(row => !skipIds.has(row.id));
    const group = fieldSourceOf(rows);
    const dropped = [
        rows.droppedUndated > 0 ? `droppedUndated: ${rows.droppedUndated}` : '',
        (rows.droppedOutOfWindow ?? 0) > 0 ? `${text(name)} outside window: ${rows.droppedOutOfWindow}` : '',
    ].filter(Boolean);
    const truncation = isActivityCollection(rows)
        ? [`truncated: ${rows.truncated}; totalInWindow: ${rows.totalInWindow}; exported: ${rows.items.length}`]
        : [];
    if (!rows.items.length) {
        const source = rows.state === 'measured' ? '' : ` (${text(rows.source)})`;
        return [`${[`${text(name)}: ${text(rows.state)}, no rows`, ...dropped, ...truncation].join(', ')}${source}`, ''];
    }
    const meta = [rows.state === 'measured' ? '' : `state: ${text(rows.state)}`, ...dropped, ...truncation].filter(Boolean);
    if (!items.length) return [[skippedLine ?? `${text(name)}: ${rows.items.length} ${skipped}`, ...meta].join('; '), ''];
    return [`### ${text(name)} (${groupLabel(rows.source, group)})`, ...meta, ...renderBody(items, group), ''];
}

/** `skipped` names where skipped rows are: `shown above` for rows a Today section printed,
 * `unchanged (listed above)` for user-context rows named on the `unchanged since` line. */
export function collectionLines(
    name: string, rows: LedgerCollection<LedgerRecord>, skipIds: SkipIds = NO_SKIP, skipped = 'shown above',
    options?: RecordRenderOptions,
): string[] {
    return renderCollection(name, rows, skipIds, skipped,
        (items, group) => items.flatMap(row => recordLines(row, group, options)));
}

function sourceSection(sources: SourceState[]): string[] {
    const open = sources.filter(source => source.state !== 'measured');
    const body = open.length
        ? open.map(source => [
            `${text(source.source)}: ${text(source.state)}`,
            source.newestObservedOn ? `newestObservedOn ${text(source.newestObservedOn)}` : '',
            source.reason ? `reason ${text(source.reason)}` : '',
        ].filter(Boolean).join('; '))
        : ['sources: all measured'];
    return ['## Sources', ...body, ''];
}

export function factsSection(ledger: LedgerExport, skipIds: SkipIds = NO_SKIP): string[] {
    return ['## Facts', ...Object.entries(ledger.facts).flatMap(([name, rows]) => collectionLines(name, rows, skipIds))];
}

export function derivedSection(
    ledger: LedgerExport,
    baselinedCollections: ReadonlySet<'recovery' | 'checkins'> = NO_BASELINED,
): string[] {
    return [
        '## Derived',
        ...(ledger.derived.length ? ledger.derived.flatMap(metric => derivedMetricLines(metric, baselinedCollections)) : ['derived: none']),
        '',
    ];
}

function singletonLines(name: string, row: ContextRecord, stripUnsupportedMeta: boolean): string[] {
    const entries = recordEntries(row, stripUnsupportedMeta);
    const group = dominantSource(Object.entries(row.fields));
    const collapsed = collapsedLine(name, entries, group);
    // The heading names the group source even when the record collapses (source per group).
    const heading = `### ${text(name)} (${groupLabel(undefined, group)})`;
    return collapsed ? [heading, collapsed] : [heading, ...entryLines(entries, group)];
}

const codeUnitCompare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

interface CompactWindow {
    date: string;
    start: string;
    end: string;
    missing: string | null;
}

const STANDARD_WINDOW_KEYS: ReadonlySet<string> = new Set(['date', 'kind', 'startLocal', 'endLocal']);

function asCompactScheduleWindow(row: ContextRecord, group: string | undefined, stripUnsupportedMeta: boolean): CompactWindow | null {
    if (!row.observedOn) return null;
    const { date, kind, startLocal, endLocal } = row.fields;
    if (kind?.state !== 'measured' || kind.source !== group || kind.value !== 'schedule_window') return null;
    if (startLocal?.state !== 'measured' || startLocal.source !== group || typeof startLocal.value !== 'string' || !startLocal.value) return null;
    if (endLocal?.state !== 'measured' || endLocal.source !== group || typeof endLocal.value !== 'string' || !endLocal.value) return null;
    if (date && (date.state !== 'measured' || date.source !== group || date.value !== row.observedOn)) return null;
    const entries = recordEntries(row, stripUnsupportedMeta);
    const hasExtraValue = entries.some(([key, value]) => !STANDARD_WINDOW_KEYS.has(key) && value.value !== null && value.value !== undefined);
    if (hasExtraValue) return null;
    const missing = missingLine(entries, group);
    return {
        date: row.observedOn,
        start: startLocal.value,
        end: endLocal.value,
        missing: missing ? missing.slice('missing: '.length) : null,
    };
}

function availabilityLines(rows: LedgerCollection<ContextRecord>, skipIds: SkipIds, stripUnsupportedMeta: boolean): string[] {
    return renderCollection('availability', rows, skipIds, 'unchanged (listed above)', (items, group) => {
        const compact: CompactWindow[] = [];
        const rest: ContextRecord[] = [];
        for (const row of items) {
            const win = asCompactScheduleWindow(row, group, stripUnsupportedMeta);
            if (win) compact.push(win);
            else rest.push(row);
        }

        const byDate = new Map<string, CompactWindow[]>();
        const missingGroups = new Map<string, string[]>();
        for (const win of compact) {
            byDate.set(win.date, [...(byDate.get(win.date) ?? []), win]);
            if (win.missing) missingGroups.set(win.missing, [...(missingGroups.get(win.missing) ?? []), win.date]);
        }

        const compactLines = [...byDate.keys()].sort(codeUnitCompare).map(date => {
            const windows = byDate.get(date)!.sort((a, b) => codeUnitCompare(a.start, b.start) || codeUnitCompare(a.end, b.end));
            return `${text(date)}: ${windows.map(win => `${text(win.start)}–${text(win.end)}`).join(', ')}`;
        });
        const [[onlySummary, onlyDates]] = missingGroups.size === 1 ? [...missingGroups] : [['', []]];
        if (missingGroups.size === 1 && onlyDates.length === compact.length) {
            compactLines.push(`schedule_window missing: ${onlySummary}`);
        } else if (missingGroups.size >= 1) {
            for (const [summary, dates] of missingGroups) {
                compactLines.push(`schedule_window missing (${[...new Set(dates)].sort(codeUnitCompare).map(text).join(', ')}): ${summary}`);
            }
        }
        return [...compactLines, ...rest.flatMap(row => recordLines(row, group, { stripUnsupportedMeta }))];
    });
}

function metaMatches(a: LedgerValue<unknown>, b: LedgerValue<unknown>): boolean {
    return a.state === b.state && a.source === b.source && a.value === b.value;
}

function isDuplicateGoalEvent(goal: ContextRecord, event: ContextRecord, eventsGroup: string | undefined): boolean {
    const { title, startDate, endDate, lifecycle } = event.fields;
    if (![title, startDate, endDate, lifecycle].every(field => field?.state === 'measured' && field.source === eventsGroup)) {
        return false;
    }
    const goalTitle = goal.fields.title;
    const goalDate = goal.fields.targetDate;
    const goalLifecycle = goal.fields.eventLifecycle;
    if (goalTitle?.state !== 'measured' || goalTitle.value !== title.value) return false;
    if (goalDate?.state !== 'measured' || goalDate.value !== startDate.value || goalDate.value !== endDate.value) return false;
    if (event.observedOn !== goalDate.value) return false;
    const expectedLifecycle = goalLifecycle?.state === 'measured' && goalLifecycle.value !== null
        ? goalLifecycle.value
        : (goalLifecycle?.state === 'not_recorded' ? 'scheduled' : null);
    if (expectedLifecycle === null || lifecycle.value !== expectedLifecycle) return false;
    return metaMatches(goal.since, event.since) && metaMatches(goal.revisions, event.revisions);
}

function eventsLines(
    rows: LedgerCollection<ContextRecord>,
    unchangedSkip: SkipIds,
    dedupedGoalEventIds: SkipIds,
    stripUnsupportedMeta: boolean,
): string[] {
    if (!dedupedGoalEventIds.size) {
        return collectionLines('events', rows, unchangedSkip, 'unchanged (listed above)', { stripUnsupportedMeta });
    }
    const combinedSkip = new Set([...unchangedSkip, ...dedupedGoalEventIds]);
    const summary = unchangedSkip.size > 0
        ? `${unchangedSkip.size} unchanged (listed above); ${dedupedGoalEventIds.size} shown in goals above`
        : `${dedupedGoalEventIds.size} shown in goals above`;
    return renderCollection(
        'events',
        rows,
        combinedSkip,
        summary,
        (items, group) => [
            `${dedupedGoalEventIds.size} goal event${dedupedGoalEventIds.size === 1 ? '' : 's'} shown in goals above`,
            ...items.flatMap(row => recordLines(row, group, { stripUnsupportedMeta })),
        ],
        `events: ${summary}`,
    );
}

function hasRecordDefaultUnsupportedMeta(row: ContextRecord): boolean {
    return isDefaultUnsupportedMeta('since', row.since) || isDefaultUnsupportedMeta('revisions', row.revisions);
}

/** A checkpoint of another (or no) format version means full context. */
export function userContextSection(ledger: LedgerExport, checkpoint?: PreviousContext): string[] {
    const previous = isCurrentFormat(checkpoint) ? checkpoint : undefined;
    const delta = previous ? contextDelta(userContextCheckpoint(ledger), previous, userContextStates(ledger)) : null;
    const isUnchanged = (key: string) => delta?.unchangedKeys.has(key) ?? false;

    const renderedGoals = new Map(
        ledger.userContext.goals.items.filter(row => !isUnchanged(`goals/${row.id}`)).map(row => [row.id, row]),
    );
    const eventsGroup = fieldSourceOf(ledger.userContext.events);
    const dedupedGoalEventIds = new Set<string>();
    for (const event of ledger.userContext.events.items) {
        if (isUnchanged(`events/${event.id}`) || !event.id.startsWith('goal-')) continue;
        const goal = renderedGoals.get(event.id.slice('goal-'.length));
        if (goal && isDuplicateGoalEvent(goal, event, eventsGroup)) dedupedGoalEventIds.add(event.id);
    }

    const liftUnsupportedMeta = Object.entries(ledger.userContext).some(([name, context]) => {
        if ('items' in context) {
            return (context as LedgerCollection<ContextRecord>).items.some(row =>
                !isUnchanged(`${name}/${row.id}`)
                && !(name === 'events' && dedupedGoalEventIds.has(row.id))
                && hasRecordDefaultUnsupportedMeta(row));
        }
        if ('fields' in context) return !isUnchanged(name) && hasRecordDefaultUnsupportedMeta(context);
        return false;
    });

    const body = Object.entries(ledger.userContext).flatMap(([name, context]): string[] => {
        if ('items' in context) {
            const rows = context as LedgerCollection<ContextRecord>;
            const skip = new Set(rows.items.filter(row => isUnchanged(`${name}/${row.id}`)).map(row => row.id));
            if (name === 'availability') return availabilityLines(rows, skip, liftUnsupportedMeta);
            if (name === 'events') return eventsLines(rows, skip, dedupedGoalEventIds, liftUnsupportedMeta);
            return collectionLines(name, rows, skip, 'unchanged (listed above)', { stripUnsupportedMeta: liftUnsupportedMeta });
        }
        if (isUnchanged(name)) return [];
        if ('fields' in context) return singletonLines(name, context, liftUnsupportedMeta);
        return entryLines([[name, context as LedgerValue<unknown>]]);
    });
    const head = delta && previous ? unchangedLines(delta, previous) : [];
    const metaNote = liftUnsupportedMeta ? ['note: since, revisions are not_yet_supported (ledger) unless noted'] : [];
    return ['## User context', ...head, ...metaNote, ...body, ''];
}

function planRevisionsLines(ledger: LedgerExport, skipIds: SkipIds): string[] {
    const rows = ledger.coachingHistory.planRevisions;
    const options: RecordRenderOptions = { omitPlanRevisionHeaderFields: true };
    return renderCollection('planRevisions', rows, skipIds, 'shown above', (items, group) => {
        if (ledger.purpose !== 'morning') {
            return items.flatMap(row => recordLines(row, group, options));
        }

        const referencedRevisions = new Set<string>();
        const referencedPlans = new Set<string>();
        for (const row of [...ledger.coachingHistory.placements.items, ...ledger.coachingHistory.plannedToPerformed.items]) {
            const planId = row.fields.planId?.value;
            const revision = row.fields.revision?.value;
            if (planId !== null && planId !== undefined && revision !== null && revision !== undefined) {
                referencedRevisions.add(`${planId}@${revision}`);
            }
        }
        for (const row of ledger.coachingHistory.overrides.items) {
            const planId = row.fields.planId?.value;
            if (planId === null || planId === undefined) continue;
            const match = /^(.+)@(\d+):/.exec(row.id);
            if (match && match[1] === String(planId)) referencedRevisions.add(`${match[1]}@${match[2]}`);
            else referencedPlans.add(String(planId));
        }

        let latestId: string | null = null;
        let latestImportedAt = '';
        for (const row of items) {
            const importedAt = typeof row.fields.importedAt?.value === 'string' ? row.fields.importedAt.value : '';
            if (latestId === null || (importedAt !== '' ? importedAt >= latestImportedAt : latestImportedAt === '')) {
                latestId = row.id;
                if (importedAt !== '') latestImportedAt = importedAt;
            }
        }

        const kept: LedgerRecord[] = [];
        const older: LedgerRecord[] = [];
        for (const row of items) {
            const planId = row.fields.planId?.value;
            const isKept = row.id === latestId
                || referencedRevisions.has(row.id)
                || (planId !== null && planId !== undefined && referencedPlans.has(String(planId)));
            if (isKept) kept.push(row);
            else older.push(row);
        }

        const olderLines = older.length
            ? [`older revisions (${older.length}): ${older.map(row => {
                const date = row.observedOn ?? (typeof row.fields.importedAt?.value === 'string' ? row.fields.importedAt.value : null);
                return date ? `${text(row.id)} (${text(date)})` : text(row.id);
            }).join(', ')}`]
            : [];

        return [...kept.flatMap(row => recordLines(row, group, options)), ...olderLines];
    });
}

export function coachingHistorySection(ledger: LedgerExport, skipIds: SkipIds = NO_SKIP): string[] {
    const body = Object.entries(ledger.coachingHistory).flatMap(([name, rows]) => (
        name === 'planRevisions' ? planRevisionsLines(ledger, skipIds) : collectionLines(name, rows, skipIds)
    ));
    return ['## Coaching history', ...body];
}

function header(ledger: LedgerExport): string[] {
    return [
        `# Ledger update — ${text(ledger.asOfDate)} (${text(ledger.purpose)})`,
        `schema: ${text(ledger.schemaVersion)} · exportedAt ${text(ledger.exportedAt)}`,
        'states: measured unless noted; source shown per group',
        `window: ${text(ledger.window.startDate)}…${text(ledger.window.endDate)}`,
        ...(purposeAlwaysRendersFullContext(ledger.purpose)
            ? [`use: refresh export for starting a new chat — full user context, upcoming sessions for the next ${PLACEMENT_FORWARD_DAYS[ledger.purpose]} days`]
            : []),
        '',
    ];
}

/** Pure presentation of recorded ledger data, compact for pasting into a long-lived chat. */
export function renderLedgerExportCompact(ledger: LedgerExport, options?: CompactRenderOptions): string {
    const today = renderTodaySections(ledger);
    const consumed = today.consumedIds;
    const lines = [
        ...header(ledger),
        ...today.lines,
        ...sourceSection(ledger.sources),
        ...flagsSection(ledger),
        ...factsSection(ledger, consumed),
        ...derivedSection(ledger, today.baselinedCollections),
        ...userContextSection(ledger, purposeAlwaysRendersFullContext(ledger.purpose) ? undefined : options?.previousContext),
        ...coachingHistorySection(ledger, consumed),
    ];
    if (ledger.legacyEngine !== null) lines.push('', '## Legacy engine (opt-in opinions)', text(ledger.legacyEngine));
    return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
}
