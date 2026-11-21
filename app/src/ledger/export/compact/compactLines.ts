import { text } from '../markdownText.ts';
import type { LedgerValue } from '../schema.ts';

export type FieldEntry = readonly [string, LedgerValue<unknown>];

function isMissing(value: LedgerValue<unknown>): boolean {
    return value.value === null || value.value === undefined;
}

/** The source most fields of a group share; ties go to the first seen. Undefined for an empty group. */
export function dominantSource(entries: readonly FieldEntry[]): string | undefined {
    const counts = new Map<string, number>();
    for (const [, value] of entries) counts.set(value.source, (counts.get(value.source) ?? 0) + 1);
    let best: string | undefined;
    for (const [source, count] of counts) if (best === undefined || count > (counts.get(best) ?? 0)) best = source;
    return best;
}

/** Group provenance printed once on a group line: `collection; field-source` (either may be absent). */
export function groupLabel(collection: string | undefined, fieldSource: string | undefined): string {
    return [collection ? text(collection) : '', fieldSource ? text(fieldSource) : ''].filter(Boolean).join('; ');
}

/** ` (source X)` only when a value's source differs from its group's. */
export function sourceTag(value: LedgerValue<unknown>, group: string | undefined): string {
    return group !== undefined && value.source !== group ? ` (source ${text(value.source)})` : '';
}

/** Shorten floats while keeping integers exact and tiny non-zero values non-zero. */
export function formatNumber(value: number): string {
    if (!Number.isFinite(value) || Number.isInteger(value)) return Object.is(value, -0) ? '0' : String(value);
    if (Math.abs(value) >= 0.1) {
        const rounded = Math.round(value * 10) / 10;
        return String(rounded === 0 ? 0 : rounded);
    }
    const rounded = Math.round(value * 100) / 100;
    if (rounded !== 0) return String(rounded);
    return String(Number(value.toPrecision(1)));
}

const LONG_HEX_HASH = /^(sha256:)?([0-9a-f]{40,})$/i;

/** Compact formatting for numbers, long hex hashes, and string arrays, always Markdown-safe. */
export function formatValue(value: unknown): string {
    if (typeof value === 'number') return formatNumber(value);
    if (typeof value === 'string') {
        const match = LONG_HEX_HASH.exec(value);
        if (match) return text(`${match[1] ?? ''}${match[2].slice(0, 12)}…`);
    }
    if (Array.isArray(value) && value.every(item => typeof item === 'string')) {
        return value.length === 0 ? 'none' : value.map(item => text(item)).join(', ');
    }
    return text(value);
}

/**
 * Provenance suffix for a value: the source when it differs from `group`, the state when not
 * measured, and the observed date of a stale value. Without a group the source accompanies every
 * non-measured state.
 */
export function fieldProvenance(value: LedgerValue<unknown>, group?: string): string {
    const notes = [
        group === undefined ? (value.state === 'measured' ? '' : text(value.source)) : (value.source === group ? '' : text(value.source)),
        value.state === 'measured' ? '' : text(value.state),
        value.state === 'stale' && value.observedOn ? text(value.observedOn) : '',
    ].filter(Boolean);
    // A lone source exception reads `(source X)`; with a state alongside it is `(X, state)`.
    const lone = notes.length === 1 && value.state === 'measured';
    return notes.length ? ` (${lone ? 'source ' : ''}${notes.join(', ')})` : '';
}

/**
 * `key: value unit` with the exceptions to the group default: the source when it differs from
 * `group`, the state when not measured, and the observed date of a stale value. Without a group the
 * source accompanies every non-measured state.
 */
export function fieldLine(name: string, value: LedgerValue<unknown>, group?: string): string {
    const unit = value.unit ? ` ${text(value.unit)}` : '';
    const provenance = fieldProvenance(value, group);
    // I3 (ADR-0003): a snapshot's totalSteps is the previous completed day, not the record's date.
    const semantic = name === 'totalSteps' && !isMissing(value) ? ' (D-1)' : '';
    return `${text(name)}: ${formatValue(value.value)}${unit}${semantic}${provenance}`;
}

/** `state` (`, null` for a measured null) plus the field's source when it differs from `group`. */
function missingStateLabel(value: LedgerValue<unknown>, group: string | undefined): string {
    const source = group !== undefined && value.source !== group ? `, ${text(value.source)}` : '';
    return `${text(value.state)}${value.state === 'measured' ? ', null' : ''}${source}`;
}

/** `a, b (not_recorded); c (missing, garmin)`: absent names grouped by state label, first-seen order. */
function missingGroups(entries: readonly FieldEntry[], group: string | undefined): string | null {
    const groups = new Map<string, string[]>();
    for (const [name, value] of entries.filter(([, entry]) => isMissing(entry))) {
        const label = missingStateLabel(value, group);
        groups.set(label, [...(groups.get(label) ?? []), text(name)]);
    }
    return groups.size ? [...groups].map(([label, names]) => `${names.join(', ')} (${label})`).join('; ') : null;
}

/** `missing: a, b (not_recorded); c (missing)`; a source differing from `group` joins its state label. */
export function missingLine(entries: readonly FieldEntry[], group?: string): string | null {
    const groups = missingGroups(entries, group);
    return groups ? `missing: ${groups}` : null;
}

/**
 * Every field absent and none measured: `<id> (<date>): missing <n> fields — a, b (not_recorded)`,
 * naming the fields grouped as in `missingLine`.
 */
export function collapsedLine(id: string, entries: readonly FieldEntry[], group?: string, date?: string | null): string | null {
    if (!entries.length || !entries.every(([, value]) => isMissing(value) && value.state !== 'measured')) return null;
    const dated = date ? ` (${text(date)})` : '';
    return `${text(id)}${dated}: missing ${entries.length} fields — ${missingGroups(entries, group)}`;
}

interface SegmentLike {
    segmentIndex: unknown;
    segmentType: unknown;
    durationSeconds: unknown;
    averagePowerWatts?: unknown;
    averageHrBpm?: unknown;
    maxHrBpm?: unknown;
    evidenceConfidence: unknown;
}

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

function isSegmentRecord(item: unknown): item is SegmentLike {
    return typeof item === 'object' && item !== null
        && 'segmentIndex' in item
        && 'segmentType' in item
        && 'durationSeconds' in item
        && 'evidenceConfidence' in item;
}

function formatSegmentLine(segment: SegmentLike): string {
    const index = isFiniteNumber(segment.segmentIndex) ? formatNumber(segment.segmentIndex) : text(segment.segmentIndex);
    const kind = text(segment.segmentType);
    const duration = isFiniteNumber(segment.durationSeconds)
        ? `${formatNumber(segment.durationSeconds)}s`
        : `${text(segment.durationSeconds)}s`;
    const power = isFiniteNumber(segment.averagePowerWatts)
        ? `${formatNumber(segment.averagePowerWatts)}W`
        : '—W';
    const hasAvgHr = isFiniteNumber(segment.averageHrBpm);
    const hasMaxHr = isFiniteNumber(segment.maxHrBpm);
    const hr = !hasAvgHr && !hasMaxHr
        ? '—bpm'
        : `${hasAvgHr ? formatNumber(segment.averageHrBpm as number) : '—'}/${hasMaxHr ? formatNumber(segment.maxHrBpm as number) : '—'}bpm`;
    const confidence = text(segment.evidenceConfidence);
    return `#${index} ${kind} ${duration} ${power} ${hr} ${confidence}`;
}

function fieldLines(name: string, value: LedgerValue<unknown>, group?: string): string[] {
    if (name === 'segments' && Array.isArray(value.value) && value.value.length > 0 && value.value.every(isSegmentRecord)) {
        const provenance = fieldProvenance(value, group);
        return [
            `segments (${value.value.length}; #idx type dur power hr/maxHr conf)${provenance}:`,
            ...value.value.map(formatSegmentLine),
        ];
    }
    return [fieldLine(name, value, group)];
}

/** Present fields first, then one `missing:` line; never prints 0 or false for an absent value. */
export function entryLines(entries: readonly FieldEntry[], group?: string): string[] {
    const lines = entries.filter(([, value]) => !isMissing(value)).flatMap(([name, value]) => fieldLines(name, value, group));
    const missing = missingLine(entries, group);
    if (missing) lines.push(missing);
    return lines;
}
