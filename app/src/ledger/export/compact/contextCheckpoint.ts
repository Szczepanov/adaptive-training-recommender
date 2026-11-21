/**
 * The user-context checkpoint behind the compact unchanged-context abbreviation (spec 2c):
 * per-item content hashes and selection dates plus, per user-context name, the selection scope,
 * its lower date bound and whether the read was complete. Only hashes and comparison metadata,
 * never raw context text. Pure.
 */
import type {
    ContextRecord,
    LedgerCollection,
    LedgerExport,
    LedgerUserContext,
    LedgerValue,
} from '../schema.ts';
import { isLocalDate } from '../window.ts';

/**
 * Bump whenever the hash contract or the scope/completeness rules change: a stored checkpoint
 * of another (or no) version means full context. 1 = record-level `observedOn` is hashed;
 * 2 = per-item selection dates and per-collection lower bounds decide removal;
 * 3 = `coachingHistory.planRevisions` is included in the checkpoint.
 */
export const CHECKPOINT_FORMAT_VERSION = 3;

export interface CollectionCheckpoint {
    /** The selection that produced the items, e.g. `from:<window start>` or `all-active`. */
    scope: string;
    /** True only for a `measured` read with nothing truncated or omitted. */
    complete: boolean;
    /** The inclusive lower date bound of a date-windowed selection; absent when unbounded. */
    from?: string;
}

/** What one export's user context looks like, keyed as `userContextItemHashes`. */
export interface UserContextCheckpoint {
    formatVersion: number;
    itemHashes: Readonly<Record<string, string>>;
    /** Per item key, the date its collection's lower bound compares against. Items selected
     * without a date bound (active injuries, goals, constraints, single records) have none. */
    selectionDates: Readonly<Record<string, string>>;
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

/** Revision ids rendered on `morning` exports (latest by `importedAt` plus any referenced by placements/overrides). */
export function morningKeptRevisionIds(ledger: LedgerExport): ReadonlySet<string> {
    const items = ledger.coachingHistory.planRevisions.items;
    if (!items.length) return new Set();

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

    const kept = new Set<string>();
    for (const row of items) {
        const planId = row.fields.planId?.value;
        if (
            row.id === latestId
            || referencedRevisions.has(row.id)
            || (planId !== null && planId !== undefined && referencedPlans.has(String(planId)))
        ) {
            kept.add(row.id);
        }
    }
    return kept;
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
    const keptRevisions = ledger.purpose === 'morning' ? morningKeptRevisionIds(ledger) : null;
    for (const row of ledger.coachingHistory.planRevisions.items) {
        if (keptRevisions && !keptRevisions.has(row.id)) continue;
        hashes[`planRevisions/${row.id}`] = hashOf({ observedOn: row.observedOn, fields: row.fields });
    }
    return hashes;
}

/** The user-context name an item key belongs to. */
export function collectionOf(key: string): string {
    return key.split('/')[0];
}

type Scope = Pick<CollectionCheckpoint, 'scope' | 'from'>;

const windowed = (prefix: string) => (ledger: LedgerExport): Scope =>
    ({ scope: `${prefix}${ledger.window.startDate}`, from: ledger.window.startDate });
const fixed = (scope: string) => (): Scope => ({ scope });

/** Mirrors `buildUserContext`: dated items are bounded below by the window start, goals and
 * constraints are the active ones, injuries add resolutions since the window start. */
const SCOPES: Readonly<Record<ContextName, (ledger: LedgerExport) => Scope>> = {
    injuries: windowed('active+resolved-from:'),
    equipment: fixed('current'),
    environment: fixed('current'),
    guardrails: fixed('current'),
    travel: windowed('from:'),
    venueRestrictions: windowed('from:'),
    availability: windowed('from:'),
    preferences: fixed('current'),
    goals: fixed('all-active'),
    events: windowed('from:'),
    constraints: fixed('all-active'),
    trainingDislikes: fixed('current'),
};

const fieldDate = (field: string) => (row: ContextRecord): string | undefined => {
    const value = row.fields[field]?.value;
    return isLocalDate(value) ? value : undefined;
};

/**
 * The date each windowed collection's bound compares against in `buildUserContext`: travel and
 * intent-block events by end date (a goal event's end date is its target date), availability and
 * venue restrictions by date, a resolved injury by `resolvedAt`. An active injury has none.
 */
const SELECTION_DATES: Readonly<Partial<Record<ContextName, (row: ContextRecord) => string | undefined>>> = {
    injuries: fieldDate('resolvedAt'),
    travel: fieldDate('endDate'),
    venueRestrictions: fieldDate('date'),
    availability: fieldDate('date'),
    events: fieldDate('endDate'),
};

function selectionDates(ledger: LedgerExport): Record<string, string> {
    const dates: [string, string][] = [];
    for (const [name, context] of Object.entries(ledger.userContext) as [ContextName, ContextEntry][]) {
        const dateOf = SELECTION_DATES[name];
        if (!dateOf || !isCollection(context)) continue;
        for (const row of context.items) {
            const date = dateOf(row);
            if (date !== undefined) dates.push([`${name}/${row.id}`, date]);
        }
    }
    return Object.fromEntries(dates);
}

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
        if (scope) collections[name] = { ...scope(ledger), complete: isComplete(ledger, name, context) };
    }
    const revisions = ledger.coachingHistory.planRevisions;
    collections.planRevisions = {
        scope: ledger.purpose === 'morning' ? 'morning-active' : 'all',
        complete: revisions.state === 'measured' && revisions.droppedUndated === 0,
    };
    return {
        formatVersion: CHECKPOINT_FORMAT_VERSION,
        itemHashes: userContextItemHashes(ledger),
        selectionDates: selectionDates(ledger),
        collections,
    };
}

export function isCurrentFormat<T extends { formatVersion?: unknown }>(checkpoint: T | undefined): checkpoint is T {
    return checkpoint?.formatVersion === CHECKPOINT_FORMAT_VERSION;
}

/** The entries of one user-context name in a key-indexed map (hashes or selection dates). */
function entriesOf(map: Readonly<Record<string, string>>, name: string): [string, string][] {
    return Object.entries(map).filter(([key]) => collectionOf(key) === name);
}

/**
 * The checkpoint to store on confirmation. A complete read replaces its collection, so a key
 * gone out of scope is dropped after being reported once. An incomplete one (failed, truncated
 * or with omitted rows) keeps the prior metadata and the prior entries of absent items, takes the
 * current hash and date (or lack of one) of every item present now (it was printed in full), and stores nothing
 * for the collection when there is no prior.
 */
export function mergeCheckpoint(
    stored: PreviousContext | undefined,
    current: UserContextCheckpoint,
    exportedOn: string,
): PreviousContext {
    const prior = isCurrentFormat(stored) ? stored : undefined;
    const itemHashes: [string, string][] = [];
    const dates: [string, string][] = [];
    const collections: Record<string, CollectionCheckpoint> = {};
    for (const [name, meta] of Object.entries(current.collections)) {
        if (meta.complete) {
            itemHashes.push(...entriesOf(current.itemHashes, name));
            dates.push(...entriesOf(current.selectionDates, name));
            collections[name] = meta;
        } else if (prior?.collections[name]) {
            // Later entries win in `Object.fromEntries`: present items overwrite their prior hash.
            // A present item's date is the current one, including none: a prior date is kept
            // only for an item absent now, or a reopened item would inherit a stale bound.
            const present = new Set(Object.keys(current.itemHashes));
            itemHashes.push(...entriesOf(prior.itemHashes, name), ...entriesOf(current.itemHashes, name));
            dates.push(
                ...entriesOf(prior.selectionDates, name).filter(([key]) => !present.has(key)),
                ...entriesOf(current.selectionDates, name),
            );
            collections[name] = prior.collections[name];
        }
    }
    return {
        formatVersion: CHECKPOINT_FORMAT_VERSION,
        exportedOn,
        itemHashes: Object.fromEntries(itemHashes),
        selectionDates: Object.fromEntries(dates),
        collections,
    };
}
