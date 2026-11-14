import type { ContextRecord, LedgerCollection, LedgerExport, LedgerState, LedgerValue } from '../schema.ts';

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
    /** Keys in the previous export whose source is measured now and which no longer exist, sorted. */
    removed: string[];
    /** Keys in the previous export whose source cannot be read now, with that state, sorted. */
    unreadable: Array<{ key: string; state: LedgerState }>;
    /** Same keys as `unchanged`, for lookup. */
    unchangedKeys: ReadonlySet<string>;
}

/** State per user-context name (a collection, a single record or `trainingDislikes`). */
export function userContextStates(ledger: LedgerExport): Record<string, LedgerState> {
    const states: Record<string, LedgerState> = {};
    for (const [name, context] of Object.entries(ledger.userContext)) {
        if ('items' in context) states[name] = (context as LedgerCollection<ContextRecord>).state;
        else if ('fields' in context) {
            const fields = Object.values((context as ContextRecord).fields);
            states[name] = fields.some(field => field.state === 'measured') || !fields.length ? 'measured' : fields[0].state;
        } else states[name] = (context as LedgerValue<string[]>).state;
    }
    return states;
}

export function contextDelta(
    current: Record<string, string>, previous: PreviousContext, states: Readonly<Record<string, LedgerState>>,
): ContextDelta {
    const unchanged = Object.keys(current).filter(key => previous.itemHashes[key] === current[key]).sort();
    const gone = Object.keys(previous.itemHashes).filter(key => !(key in current)).sort();
    const stateOf = (key: string): LedgerState | undefined => states[key.split('/')[0]];
    const isReadable = (key: string) => stateOf(key) === 'measured';
    const unreadable = gone.filter(key => stateOf(key) !== undefined && !isReadable(key))
        .map(key => ({ key, state: stateOf(key) as LedgerState }));
    return {
        unchanged,
        removed: gone.filter(key => stateOf(key) === undefined || isReadable(key)),
        unreadable,
        unchangedKeys: new Set(unchanged),
    };
}

export function unchangedLines(delta: ContextDelta, previous: PreviousContext): string[] {
    return [
        ...(delta.unchanged.length
            ? [`unchanged since ${previous.exportedOn}: ${delta.unchanged.length} items (${delta.unchanged.join(', ')})`]
            : []),
        ...delta.removed.map(key => `removed: ${key}`),
        ...delta.unreadable.map(({ key, state }) => `not readable now: ${key} (${state})`),
    ];
}
