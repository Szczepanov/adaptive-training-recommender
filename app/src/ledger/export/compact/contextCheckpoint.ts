/**
 * The user-context checkpoint behind the compact unchanged-context abbreviation (spec 2c):
 * per-item content hashes plus, per user-context name, the selection scope and whether the
 * read was complete. Only hashes and comparison metadata, never raw context text. Pure.
 */
import type {
    ContextRecord,
    LedgerCollection,
    LedgerExport,
    LedgerUserContext,
    LedgerValue,
} from '../schema.ts';

/**
 * Bump whenever the hash contract or the scope/completeness rules change: a stored checkpoint
 * of another (or no) version means full context. 1 = record-level `observedOn` is hashed.
 */
export const CHECKPOINT_FORMAT_VERSION = 1;

export interface CollectionCheckpoint {
    /** The selection that produced the items, e.g. `from:<window start>` or `all-active`. */
    scope: string;
    /** True only for a `measured` read with nothing truncated or omitted. */
    complete: boolean;
}

/** What one export's user context looks like, keyed as `userContextItemHashes`. */
export interface UserContextCheckpoint {
    formatVersion: number;
    itemHashes: Readonly<Record<string, string>>;
    collections: Readonly<Record<string, CollectionCheckpoint>>;
}

/** What the reader confirmed holding: a checkpoint plus the export's Warsaw date. */
export interface PreviousContext extends UserContextCheckpoint {
    exportedOn: string;
}

/** Export and read instants are the only keys excluded from hashing, wherever they appear. */
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

/** Redacted semantic content: leaves with state and source, `since`, `revisions` and the
 * record's semantic date (`observedOn`), which is the item's own date, not an export artifact. */
function recordHash(row: ContextRecord): string {
    return hashOf({ observedOn: row.observedOn, fields: row.fields, since: row.since, revisions: row.revisions });
}

type ContextName = keyof LedgerUserContext;
type ContextEntry = LedgerUserContext[ContextName];

function isCollection(context: ContextEntry): context is LedgerCollection<ContextRecord> {
    return 'items' in context;
}

function isRecord(context: ContextEntry): context is ContextRecord {
    return 'fields' in context;
}

/** `<collection>/<id>` for collection items, `<name>` for single records and `trainingDislikes`. */
export function userContextItemHashes(ledger: LedgerExport): Record<string, string> {
    const hashes: Record<string, string> = {};
    for (const [name, context] of Object.entries(ledger.userContext) as [ContextName, ContextEntry][]) {
        if (isCollection(context)) {
            for (const row of context.items) hashes[`${name}/${row.id}`] = recordHash(row);
        } else if (isRecord(context)) {
            hashes[name] = recordHash(context);
        } else {
            hashes[name] = hashOf(context);
        }
    }
    return hashes;
}

/** The user-context name an item key belongs to. */
export function collectionOf(key: string): string {
    return key.split('/')[0];
}

const fromWindowStart = (ledger: LedgerExport) => `from:${ledger.window.startDate}`;

/** Mirrors `buildUserContext`: dated items are bounded below by the window start, goals and
 * constraints are the active ones, injuries add resolutions since the window start. */
const SCOPES: Readonly<Record<ContextName, (ledger: LedgerExport) => string>> = {
    injuries: ledger => `active+resolved-from:${ledger.window.startDate}`,
    equipment: () => 'current',
    environment: () => 'current',
    guardrails: () => 'current',
    travel: fromWindowStart,
    venueRestrictions: fromWindowStart,
    availability: fromWindowStart,
    preferences: () => 'current',
    goals: () => 'all-active',
    events: fromWindowStart,
    constraints: () => 'all-active',
    trainingDislikes: () => 'current',
};

/** Single records carry no source key of their own; their read is the settings document's. */
const RECORD_SOURCES: Readonly<Partial<Record<ContextName, string>>> = {
    equipment: 'training_settings',
    environment: 'training_settings',
    guardrails: 'training_settings',
    preferences: 'preferences',
};

function isComplete(ledger: LedgerExport, name: ContextName, context: ContextEntry): boolean {
    if (isCollection(context)) {
        // No user-context collection carries `truncated` today; this guards future ones.
        const truncated = (context as { truncated?: boolean }).truncated === true;
        return context.state === 'measured' && context.droppedUndated === 0 && !truncated;
    }
    if (isRecord(context)) {
        const source = RECORD_SOURCES[name];
        return source !== undefined && ledger.sources.some(read => read.source === source && read.state === 'measured');
    }
    // A `not_yet_supported` value has no source to read: its state is fixed by the schema, so
    // nothing about it can be unread or omitted.
    const { state } = context as LedgerValue<unknown>;
    return state === 'measured' || state === 'not_yet_supported';
}

/** The checkpoint this export would store if the reader confirms it. */
export function userContextCheckpoint(ledger: LedgerExport): UserContextCheckpoint {
    const collections: Record<string, CollectionCheckpoint> = {};
    for (const [name, context] of Object.entries(ledger.userContext) as [ContextName, ContextEntry][]) {
        const scope = SCOPES[name];
        if (scope) collections[name] = { scope: scope(ledger), complete: isComplete(ledger, name, context) };
    }
    return { formatVersion: CHECKPOINT_FORMAT_VERSION, itemHashes: userContextItemHashes(ledger), collections };
}

export function isCurrentFormat<T extends { formatVersion?: unknown }>(checkpoint: T | undefined): checkpoint is T {
    return checkpoint?.formatVersion === CHECKPOINT_FORMAT_VERSION;
}

function hashesOf(hashes: Readonly<Record<string, string>>, name: string): [string, string][] {
    return Object.entries(hashes).filter(([key]) => collectionOf(key) === name);
}

/**
 * The checkpoint to store on confirmation. A complete read replaces its collection. An
 * incomplete one (failed, truncated or with omitted rows) keeps the prior hashes and
 * metadata for that collection, or stores nothing for it when there is no prior.
 */
export function mergeCheckpoint(
    stored: PreviousContext | undefined,
    current: UserContextCheckpoint,
    exportedOn: string,
): PreviousContext {
    const prior = isCurrentFormat(stored) ? stored : undefined;
    const itemHashes: [string, string][] = [];
    const collections: Record<string, CollectionCheckpoint> = {};
    for (const [name, meta] of Object.entries(current.collections)) {
        if (meta.complete) {
            itemHashes.push(...hashesOf(current.itemHashes, name));
            collections[name] = meta;
        } else if (prior?.collections[name]) {
            itemHashes.push(...hashesOf(prior.itemHashes, name));
            collections[name] = prior.collections[name];
        }
    }
    return {
        formatVersion: CHECKPOINT_FORMAT_VERSION,
        exportedOn,
        itemHashes: Object.fromEntries(itemHashes),
        collections,
    };
}
