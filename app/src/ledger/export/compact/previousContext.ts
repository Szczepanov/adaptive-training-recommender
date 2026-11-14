import type { ContextRecord, LedgerCollection, LedgerExport, LedgerValue } from '../schema.ts';

/** What the reader already holds from an earlier export: the item hashes, keyed as `userContextItemHashes`. */
export interface PreviousContext {
    exportedOn: string;
    itemHashes: Readonly<Record<string, string>>;
}

/** Volatile keys excluded from hashing wherever they appear. */
const VOLATILE_KEYS: ReadonlySet<string> = new Set(['readAt', 'exportedAt']);

function canonical(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') {
        const out: Record<string, unknown> = {};
        for (const key of Object.keys(value).sort()) {
            if (!VOLATILE_KEYS.has(key)) out[key] = canonical((value as Record<string, unknown>)[key]);
        }
        return out;
    }
    return value;
}

/** 32-bit FNV-1a over UTF-16 code units, 8 hex chars. Deterministic and browser-safe; not cryptographic. */
function fnv1a(input: string): string {
    let hash = 0x811c9dc5;
    for (let i = 0; i < input.length; i++) {
        hash = Math.imul(hash ^ input.charCodeAt(i), 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, '0');
}

function hashOf(value: unknown): string {
    return fnv1a(JSON.stringify(canonical(value)));
}

function recordHash(row: ContextRecord): string {
    return hashOf({ fields: row.fields, since: row.since, revisions: row.revisions });
}

/** `<collection>/<id>` for collection items, `<name>` for single records and `trainingDislikes`. */
export function userContextItemHashes(ledger: LedgerExport): Record<string, string> {
    const hashes: Record<string, string> = {};
    for (const [name, context] of Object.entries(ledger.userContext)) {
        if ('items' in context) {
            for (const row of (context as LedgerCollection<ContextRecord>).items) hashes[`${name}/${row.id}`] = recordHash(row);
        } else if ('fields' in context) {
            hashes[name] = recordHash(context as ContextRecord);
        } else {
            hashes[name] = hashOf(context as LedgerValue<string[]>);
        }
    }
    return hashes;
}

export interface ContextDelta {
    /** Keys present now whose hash equals the previous one, sorted. */
    unchanged: string[];
    /** Keys in the previous export that no longer exist, sorted. */
    removed: string[];
    /** Same keys as `unchanged`, for lookup. */
    unchangedKeys: ReadonlySet<string>;
}

export function contextDelta(current: Record<string, string>, previous: PreviousContext): ContextDelta {
    const unchanged = Object.keys(current).filter(key => previous.itemHashes[key] === current[key]).sort();
    const removed = Object.keys(previous.itemHashes).filter(key => !(key in current)).sort();
    return { unchanged, removed, unchangedKeys: new Set(unchanged) };
}

export function unchangedLines(delta: ContextDelta, previous: PreviousContext): string[] {
    return [
        ...(delta.unchanged.length
            ? [`unchanged since ${previous.exportedOn}: ${delta.unchanged.length} items (${delta.unchanged.join(', ')})`]
            : []),
        ...delta.removed.map(key => `removed: ${key}`),
    ];
}
