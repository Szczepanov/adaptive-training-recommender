import { text } from '../markdownText.ts';
import type {
    ActivityCollection, ContextRecord, DerivedMetric, LedgerCollection, LedgerExport, LedgerRecord,
    LedgerValue, SourceState,
} from '../schema.ts';
import { collapsedLine, dominantSource, entryLines, type FieldEntry, groupLabel } from './compactLines.ts';
import { flagsSection } from './flagLines.ts';
import { contextDelta, type PreviousContext, unchangedLines, userContextItemHashes, userContextStates } from './previousContext.ts';
import { renderTodaySections } from './todaySections.ts';

export { flagsSection };

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

function recordLines(row: LedgerRecord, group: string | undefined): string[] {
    const entries = recordEntries(row);
    const collapsed = collapsedLine(row.id, entries);
    const date = row.observedOn ? ` (${text(row.observedOn)})` : '';
    if (collapsed) return [`${collapsed}${date}`];
    return [`#### ${text(row.id)}${date}`, ...entryLines(entries, group)];
}

const fieldSourceOf = (rows: LedgerCollection<LedgerRecord>) => dominantSource(rows.items.flatMap(row => Object.entries(row.fields)));

export function collectionLines(name: string, rows: LedgerCollection<LedgerRecord>, skipIds: SkipIds = NO_SKIP): string[] {
    const items = rows.items.filter(row => !skipIds.has(row.id));
    const group = fieldSourceOf(rows);
    const dropped = [
        rows.droppedUndated > 0 ? `droppedUndated: ${rows.droppedUndated}` : '',
        (rows.droppedOutOfWindow ?? 0) > 0 ? `${text(name)} outside window: ${rows.droppedOutOfWindow}` : '',
    ].filter(Boolean);
    const truncation = 'truncated' in rows
        ? [`truncated: ${(rows as ActivityCollection<LedgerRecord>).truncated}; totalInWindow: ${(rows as ActivityCollection<LedgerRecord>).totalInWindow}; exported: ${rows.items.length}`]
        : [];
    if (!rows.items.length) {
        const source = rows.state === 'measured' ? '' : ` (${text(rows.source)})`;
        return [`${[`${text(name)}: ${text(rows.state)}, no rows`, ...dropped, ...truncation].join(', ')}${source}`, ''];
    }
    const meta = [rows.state === 'measured' ? '' : `state: ${text(rows.state)}`, ...dropped, ...truncation].filter(Boolean);
    if (!items.length) return [[`${text(name)}: ${rows.items.length} shown above`, ...meta].join('; '), ''];
    return [`### ${text(name)} (${groupLabel(rows.source, group)})`, ...meta, ...items.flatMap(row => recordLines(row, group)), ''];
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

function derivedLines(metric: DerivedMetric): string[] {
    const entries: FieldEntry[] = [['value', metric.value], ...Object.entries(metric.metrics ?? {})];
    const group = metric.value.source;
    return [
        `### ${text(metric.id)}${entries.some(([, value]) => value.value !== null && value.value !== undefined) ? ` (${groupLabel(undefined, group)})` : ''}`,
        `definition: ${text(metric.definition)}`,
        `window: ${text(metric.window)}${metric.inputs.length ? `; inputs: ${metric.inputs.map(text).join(', ')}` : ''}`,
        ...entryLines(entries, group),
    ];
}

export function derivedSection(ledger: LedgerExport): string[] {
    return ['## Derived', ...(ledger.derived.length ? ledger.derived.flatMap(derivedLines) : ['derived: none']), ''];
}

function singletonLines(name: string, row: ContextRecord): string[] {
    const entries = recordEntries(row);
    const collapsed = collapsedLine(name, entries);
    const group = dominantSource(Object.entries(row.fields));
    return collapsed ? [collapsed] : [`### ${text(name)} (${groupLabel(undefined, group)})`, ...entryLines(entries, group)];
}

export function userContextSection(ledger: LedgerExport, previous?: PreviousContext): string[] {
    const delta = previous ? contextDelta(userContextItemHashes(ledger), previous, userContextStates(ledger)) : null;
    const isUnchanged = (key: string) => delta?.unchangedKeys.has(key) ?? false;
    const body = Object.entries(ledger.userContext).flatMap(([name, context]): string[] => {
        if ('items' in context) {
            const rows = context as LedgerCollection<ContextRecord>;
            const skip = new Set(rows.items.filter(row => isUnchanged(`${name}/${row.id}`)).map(row => row.id));
            return collectionLines(name, rows, skip);
        }
        if (isUnchanged(name)) return [];
        if ('fields' in context) return singletonLines(name, context);
        return entryLines([[name, context as LedgerValue<unknown>]]);
    });
    const head = delta && previous ? unchangedLines(delta, previous) : [];
    return ['## User context', ...head, ...body, ''];
}

export function coachingHistorySection(ledger: LedgerExport, skipIds: SkipIds = NO_SKIP): string[] {
    const body = Object.entries(ledger.coachingHistory).flatMap(([name, rows]) => collectionLines(name, rows, skipIds));
    return ['## Coaching history', ...body];
}

function header(ledger: LedgerExport): string[] {
    return [
        `# Ledger update — ${text(ledger.asOfDate)} (${text(ledger.purpose)})`,
        `schema: ${text(ledger.schemaVersion)} · exportedAt ${text(ledger.exportedAt)}`,
        'states: measured unless noted; source shown per group',
        `window: ${text(ledger.window.startDate)}…${text(ledger.window.endDate)}`,
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
        ...derivedSection(ledger),
        ...userContextSection(ledger, options?.previousContext),
        ...coachingHistorySection(ledger, consumed),
    ];
    if (ledger.legacyEngine !== null) lines.push('', '## Legacy engine (opt-in opinions)', text(ledger.legacyEngine));
    return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
}
