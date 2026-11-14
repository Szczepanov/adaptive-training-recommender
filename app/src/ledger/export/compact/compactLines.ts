import { text } from '../markdownText.ts';
import type { LedgerValue } from '../schema.ts';

export type FieldEntry = readonly [string, LedgerValue<unknown>];

function isMissing(value: LedgerValue<unknown>): boolean {
    return value.value === null || value.value === undefined;
}

/** `key: value unit`, plus ` (source, state)` when not measured (stale keeps its observed date). */
export function fieldLine(name: string, value: LedgerValue<unknown>): string {
    const unit = value.unit ? ` ${text(value.unit)}` : '';
    const provenance = value.state === 'measured'
        ? ''
        : ` (${text(value.source)}, ${text(value.state)}${value.state === 'stale' && value.observedOn ? `, ${text(value.observedOn)}` : ''})`;
    return `${text(name)}: ${text(value.value)}${unit}${provenance}`;
}

export function missingLine(entries: readonly FieldEntry[]): string | null {
    const missing = entries.filter(([, value]) => isMissing(value));
    return missing.length
        ? `missing: ${missing.map(([name, value]) => `${text(name)} (${text(value.state)}${value.state === 'measured' ? ', null' : ''})`).join(', ')}`
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
export function entryLines(entries: readonly FieldEntry[]): string[] {
    const lines = entries.filter(([, value]) => !isMissing(value)).map(([name, value]) => fieldLine(name, value));
    const missing = missingLine(entries);
    if (missing) lines.push(missing);
    return lines;
}
