import { addDaysToLocalDateString } from '../../../utils/localDate.ts';
import { text } from '../markdownText.ts';
import type {
    ActivityCollection, ContextRecord, DerivedMetric, LedgerCollection, LedgerExport, LedgerFlag, LedgerRecord,
    LedgerValue, SourceState,
} from '../schema.ts';
import { collapsedLine, entryLines, type FieldEntry } from './compactLines.ts';
import type { PreviousContext } from './previousContext.ts';
import { renderTodaySections } from './todaySections.ts';

export interface CompactRenderOptions {
    previousContext?: PreviousContext;
}

/** Ids already rendered by an earlier section; later sections skip them. */
export type SkipIds = ReadonlySet<string>;
const NO_SKIP: SkipIds = new Set();

function recordEntries(row: LedgerRecord): FieldEntry[] {
    const entries: FieldEntry[] = Object.entries(row.fields);
    if ('since' in row && 'revisions' in row) {
        const context = row as ContextRecord;
        entries.push(['since', context.since], ['revisions', context.revisions]);
    }
    return entries;
}

function recordLines(row: LedgerRecord): string[] {
    const entries = recordEntries(row);
    const collapsed = collapsedLine(row.id, entries);
    const date = row.observedOn ? ` (${text(row.observedOn)})` : '';
    if (collapsed) return [`${collapsed}${date}`];
    return [`#### ${text(row.id)}${date}`, ...entryLines(entries)];
}

export function collectionLines(name: string, rows: LedgerCollection<LedgerRecord>, skipIds: SkipIds = NO_SKIP): string[] {
    const items = rows.items.filter(row => !skipIds.has(row.id));
    const dropped = [
        rows.droppedUndated > 0 ? `droppedUndated: ${rows.droppedUndated}` : '',
        (rows.droppedOutOfWindow ?? 0) > 0 ? `droppedOutOfWindow: ${rows.droppedOutOfWindow}` : '',
    ].filter(Boolean);
    if (!rows.items.length) return [[`${text(name)}: ${text(rows.state)}, no rows`, ...dropped].join(', '), ''];
    if (!items.length) return [];
    const meta = [
        rows.state === 'measured' ? '' : `state: ${text(rows.state)}; source: ${text(rows.source)}`,
        ...dropped,
    ].filter(Boolean);
    if ('truncated' in rows) {
        const activities = rows as ActivityCollection<LedgerRecord>;
        meta.push(`truncated: ${activities.truncated}; totalInWindow: ${activities.totalInWindow}; exported: ${rows.items.length}`);
    }
    return [`### ${text(name)}`, ...meta, ...items.flatMap(recordLines), ''];
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

function dateRange(dates: string[]): string {
    return dates.length === 1 ? text(dates[0]) : `${text(dates[0])}…${text(dates[dates.length - 1])}`;
}

function flagLabel(flag: LedgerFlag): string {
    if (flag.active === false) return flag.state === 'measured' ? 'inactive' : `inactive (${flag.state})`;
    return `unknown (${flag.state})`;
}

function activeFlagLines(flag: LedgerFlag): string[] {
    const entries: FieldEntry[] = flag.inputs.map(input => [input.name, input.value]);
    return [
        `#### ${text(flag.id)} (${text(flag.observedOn)})`,
        ...(flag.state === 'measured' ? [] : [`state: ${text(flag.state)}`]),
        ...(flag.sessionRef ? [`sessionRef: ${text(flag.sessionRef)}`] : []),
        `threshold: ${text(flag.threshold)}`,
        ...entryLines(entries),
    ];
}

/**
 * Non-active flags: one line per run of calendar-consecutive dates sharing a label. A gap day or
 * an active evaluation of the same id between two dates ends the run, so a range never implies
 * days that were not evaluated.
 */
function inactiveFlagLines(flags: LedgerFlag[]): string[] {
    const lines: string[] = [];
    for (const id of new Set(flags.map(flag => flag.id))) {
        const own = flags.filter(flag => flag.id === id).sort((a, b) => a.observedOn.localeCompare(b.observedOn));
        let run: string[] = [];
        let label = '';
        const flush = () => {
            if (run.length) lines.push(`${text(id)}: ${text(label)} ${dateRange(run)}`);
            run = [];
        };
        for (const flag of own) {
            if (flag.active === true) { flush(); continue; }
            const next = flagLabel(flag);
            const last = run[run.length - 1];
            if (next !== label || (last !== undefined && addDaysToLocalDateString(last, 1) !== flag.observedOn)) flush();
            label = next;
            run.push(flag.observedOn);
        }
        flush();
    }
    return lines;
}

export function flagsSection(ledger: LedgerExport): string[] {
    if (!ledger.flags.length) return ['## Flags', 'flags: none evaluated', ''];
    const active = ledger.flags.filter(flag => flag.active === true);
    return ['## Flags', ...active.flatMap(activeFlagLines), ...inactiveFlagLines(ledger.flags), ''];
}

export function factsSection(ledger: LedgerExport, skipIds: SkipIds = NO_SKIP): string[] {
    return ['## Facts', ...Object.entries(ledger.facts).flatMap(([name, rows]) => collectionLines(name, rows, skipIds))];
}

function derivedLines(metric: DerivedMetric): string[] {
    const entries: FieldEntry[] = [['value', metric.value], ...Object.entries(metric.metrics ?? {})];
    return [
        `### ${text(metric.id)}`,
        `definition: ${text(metric.definition)}`,
        `window: ${text(metric.window)}${metric.inputs.length ? `; inputs: ${metric.inputs.map(text).join(', ')}` : ''}`,
        ...entryLines(entries),
    ];
}

export function derivedSection(ledger: LedgerExport): string[] {
    return ['## Derived', ...(ledger.derived.length ? ledger.derived.flatMap(derivedLines) : ['derived: none']), ''];
}

function singletonLines(name: string, row: ContextRecord): string[] {
    const entries = recordEntries(row);
    const collapsed = collapsedLine(name, entries);
    return collapsed ? [collapsed] : [`### ${text(name)}`, ...entryLines(entries)];
}

export function userContextSection(ledger: LedgerExport): string[] {
    const body = Object.entries(ledger.userContext).flatMap(([name, context]): string[] => {
        if ('items' in context) return collectionLines(name, context);
        if ('fields' in context) return singletonLines(name, context);
        return entryLines([[name, context as LedgerValue<unknown>]]);
    });
    return ['## User context', ...body, ''];
}

export function coachingHistorySection(ledger: LedgerExport, skipIds: SkipIds = NO_SKIP): string[] {
    const body = Object.entries(ledger.coachingHistory).flatMap(([name, rows]) => collectionLines(name, rows, skipIds));
    return ['## Coaching history', ...body];
}

function header(ledger: LedgerExport): string[] {
    return [
        `# Ledger update — ${text(ledger.asOfDate)} (${text(ledger.purpose)})`,
        `schema: ${text(ledger.schemaVersion)} · exportedAt ${text(ledger.exportedAt)}`,
        `window: ${text(ledger.window.startDate)}…${text(ledger.window.endDate)}`,
        '',
    ];
}

/** Pure presentation of recorded ledger data, compact for pasting into a long-lived chat. */
export function renderLedgerExportCompact(ledger: LedgerExport, options?: CompactRenderOptions): string {
    void options; // Task 4 consumes previousContext.
    const today = renderTodaySections(ledger);
    const consumed = today.consumedIds;
    const lines = [
        ...header(ledger),
        ...today.lines,
        ...sourceSection(ledger.sources),
        ...flagsSection(ledger),
        ...factsSection(ledger, consumed),
        ...derivedSection(ledger),
        ...userContextSection(ledger),
        ...coachingHistorySection(ledger, consumed),
    ];
    if (ledger.legacyEngine !== null) lines.push('', '## Legacy engine (opt-in opinions)', text(ledger.legacyEngine));
    return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
}
