import type { ContextRecord, LedgerCollection, LedgerExport, LedgerState, LedgerValue } from '../schema.ts';
import { collectionOf, type PreviousContext, type UserContextCheckpoint } from './contextCheckpoint.ts';

export {
    CHECKPOINT_FORMAT_VERSION,
    collectionOf,
    isCurrentFormat,
    mergeCheckpoint,
    morningKeptRevisionIds,
    morningOmittedRevisionKeys,
    userContextCheckpoint,
    userContextItemHashes,
    type CollectionCheckpoint,
    type PreviousContext,
    type UserContextCheckpoint,
} from './contextCheckpoint.ts';

export interface ContextDelta {
    /** Keys present now whose hash equals the previous one, sorted. */
    unchanged: string[];
    /** Keys gone after a complete read while still within the current selection, sorted. */
    removed: string[];
    /** Keys gone while their collection's read is incomplete now, with why, sorted. */
    unreadable: Array<{ key: string; reason: string }>;
    /** Keys gone after a complete read whose selection date fell before the window start, sorted. */
    outOfScope: string[];
    /** Same keys as `unchanged`, for lookup. */
    unchangedKeys: ReadonlySet<string>;
}

/** State per user-context name (a collection, a single record or `trainingDislikes`) plus `planRevisions`. */
export function userContextStates(ledger: LedgerExport): Record<string, LedgerState> {
    const states: Record<string, LedgerState> = {};
    for (const [name, context] of Object.entries(ledger.userContext)) {
        if ('items' in context) states[name] = (context as LedgerCollection<ContextRecord>).state;
        else if ('fields' in context) {
            const fields = Object.values((context as ContextRecord).fields);
            states[name] = fields.some(field => field.state === 'measured') || !fields.length ? 'measured' : fields[0].state;
        } else states[name] = (context as LedgerValue<string[]>).state;
    }
    states.planRevisions = ledger.coachingHistory.planRevisions.state;
    return states;
}

type GoneKind = 'removed' | 'unreadable' | 'outOfScope';

/**
 * An absent key under a complete read is removed when it would still be selected now: the same
 * scope, or a date-windowed collection whose bound moved and the key's stored selection date is
 * on or after the new lower bound (a key with no selection date was not date-bounded). A key
 * dated before the new bound left by date: out of scope.
 */
function classifyGone(
    key: string,
    current: UserContextCheckpoint,
    previous: PreviousContext,
    omittedExistingKeys?: ReadonlySet<string>,
): GoneKind {
    const name = collectionOf(key);
    const now = current.collections[name];
    const before = previous.collections[name];
    if (now && !now.complete) return 'unreadable';
    if (!now || !before?.complete) return 'outOfScope';
    if (omittedExistingKeys?.has(key)) return 'outOfScope';
    if (before.scope === now.scope) return 'removed';
    if (now.from === undefined) return 'outOfScope';
    const date = previous.selectionDates[key];
    return date === undefined || date >= now.from ? 'removed' : 'outOfScope';
}

/** Compares this export with the confirmed checkpoint. Removal needs a complete read and a key
 * still within the current selection; anything less is unknown or out of scope (spec 2c). */
export function contextDelta(
    current: UserContextCheckpoint,
    previous: PreviousContext,
    states: Readonly<Record<string, LedgerState>>,
    omittedExistingKeys?: ReadonlySet<string>,
): ContextDelta {
    // A failed read is never abbreviated as unchanged, whatever its hash.
    const readable = (key: string) => states[collectionOf(key)] !== 'unavailable';
    const unchanged = Object.keys(current.itemHashes)
        .filter(key => readable(key) && previous.itemHashes[key] === current.itemHashes[key]).sort();
    const gone = Object.keys(previous.itemHashes).filter(key => !(key in current.itemHashes)).sort();
    const of = (kind: GoneKind) => gone.filter(key => classifyGone(key, current, previous, omittedExistingKeys) === kind);
    const reasonOf = (key: string) => {
        const state = states[collectionOf(key)];
        return state && state !== 'measured' ? state : 'incomplete';
    };
    return {
        unchanged,
        removed: of('removed'),
        unreadable: of('unreadable').map(key => ({ key, reason: reasonOf(key) })),
        outOfScope: of('outOfScope'),
        unchangedKeys: new Set(unchanged),
    };
}

export function filterDelta(delta: ContextDelta, predicate: (key: string) => boolean): ContextDelta {
    const unchanged = delta.unchanged.filter(predicate);
    return {
        unchanged,
        removed: delta.removed.filter(predicate),
        unreadable: delta.unreadable.filter(({ key }) => predicate(key)),
        outOfScope: delta.outOfScope.filter(predicate),
        unchangedKeys: new Set(unchanged),
    };
}

export function unchangedLines(delta: ContextDelta, previous: PreviousContext): string[] {
    return [
        ...(delta.unchanged.length
            ? [`unchanged since ${previous.exportedOn}: ${delta.unchanged.length} items (${delta.unchanged.join(', ')})`]
            : []),
        ...delta.removed.map(key => `removed: ${key}`),
        ...delta.unreadable.map(({ key, reason }) => `not readable now: ${key} (${reason})`),
        ...delta.outOfScope.map(key => `out of scope now: ${key}`),
    ];
}
