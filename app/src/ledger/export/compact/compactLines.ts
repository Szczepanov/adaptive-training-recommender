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

/**
 * `key: value unit` with the exceptions to the group default: the source when it differs from
 * `group`, the state when not measured, and the observed date of a stale value. Without a group the
 * source accompanies every non-measured state.
 */
export function fieldLine(name: string, value: LedgerValue<unknown>, group?: string): string {
    const unit = value.unit ? ` ${text(value.unit)}` : '';
    const notes = [
        group === undefined ? (value.state === 'measured' ? '' : text(value.source)) : (value.source === group ? '' : text(value.source)),
        value.state === 'measured' ? '' : text(value.state),
        value.state === 'stale' && value.observedOn ? text(value.observedOn) : '',
    ].filter(Boolean);
    // A lone source exception reads `(source X)`; with a state alongside it is `(X, state)`.
    const lone = notes.length === 1 && value.state === 'measured';
    const provenance = notes.length ? ` (${lone ? 'source ' : ''}${notes.join(', ')})` : '';
    // I3 (ADR-0003): a snapshot's totalSteps is the previous completed day, not the record's date.
    const semantic = name === 'totalSteps' && !isMissing(value) ? ' (D-1)' : '';
    return `${text(name)}: ${text(value.value)}${unit}${semantic}${provenance}`;
}

const missingStateLabel = (value: LedgerValue<unknown>) => `${text(value.state)}${value.state === 'measured' ? ', null' : ''}`;

/** `missing: a, b (not_recorded); c (missing)`: names grouped by state, states in first-seen order. */
export function missingLine(entries: readonly FieldEntry[]): string | null {
    const groups = new Map<string, string[]>();
    for (const [name, value] of entries.filter(([, entry]) => isMissing(entry))) {
        const label = missingStateLabel(value);
        groups.set(label, [...(groups.get(label) ?? []), text(name)]);
    }
    return groups.size
        ? `missing: ${[...groups].map(([label, names]) => `${names.join(', ')} (${label})`).join('; ')}`
        : null;
}

/** Every field absent and none measured: one explicit line instead of a long missing list. */
export function collapsedLine(id: string, entries: readonly FieldEntry[]): string | null {
    if (!entries.length || !entries.every(([, value]) => isMissing(value) && value.state !== 'measured')) return null;
    const counts = new Map<string, number>();
    for (const [, value] of entries) counts.set(value.state, (counts.get(value.state) ?? 0) + 1);
    const summary = [...counts].map(([state, count]) => `${text(state)} x${count}`).join(', ');
    return `${text(id)}: missing ${entries.length} fields (${summary})`;
}

/** Present fields first, then one `missing:` line; never prints 0 or false for an absent value. */
export function entryLines(entries: readonly FieldEntry[], group?: string): string[] {
    const lines = entries.filter(([, value]) => !isMissing(value)).map(([name, value]) => fieldLine(name, value, group));
    const missing = missingLine(entries);
    if (missing) lines.push(missing);
    return lines;
}
