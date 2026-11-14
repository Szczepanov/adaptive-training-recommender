import type { ContextRecord, LedgerCollection, LedgerExport, LedgerState, LedgerValue } from '../schema.ts';
import { collectionOf, type PreviousContext, type UserContextCheckpoint } from './contextCheckpoint.ts';

export {
    CHECKPOINT_FORMAT_VERSION,
    isCurrentFormat,
    mergeCheckpoint,
    userContextCheckpoint,
    userContextItemHashes,
    type CollectionCheckpoint,
    type PreviousContext,
    type UserContextCheckpoint,
} from './contextCheckpoint.ts';

export interface ContextDelta {
    /** Keys present now whose hash equals the previous one, sorted. */
    unchanged: string[];
    /** Keys gone after a complete read in the checkpoint's own scope, sorted. */
    removed: string[];
    /** Keys gone while their collection's read is incomplete now, with why, sorted. */
    unreadable: Array<{ key: string; reason: string }>;
    /** Keys gone after a complete read in a different scope (a moving window), sorted. */
    outOfScope: string[];
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

type GoneKind = 'removed' | 'unreadable' | 'outOfScope';

function classifyGone(key: string, current: UserContextCheckpoint, previous: PreviousContext): GoneKind {
    const name = collectionOf(key);
    const now = current.collections[name];
    const before = previous.collections[name];
    if (now && !now.complete) return 'unreadable';
    if (now && before?.complete && before.scope === now.scope) return 'removed';
    return 'outOfScope';
}

/** Compares this export with the confirmed checkpoint. Removal needs a complete read in the
 * same scope; anything less is unknown or out of scope, never deletion (spec 2c). */
export function contextDelta(
    current: UserContextCheckpoint, previous: PreviousContext, states: Readonly<Record<string, LedgerState>>,
): ContextDelta {
    // A failed read is never abbreviated as unchanged, whatever its hash.
    const readable = (key: string) => states[collectionOf(key)] !== 'unavailable';
    const unchanged = Object.keys(current.itemHashes)
        .filter(key => readable(key) && previous.itemHashes[key] === current.itemHashes[key]).sort();
    const gone = Object.keys(previous.itemHashes).filter(key => !(key in current.itemHashes)).sort();
    const of = (kind: GoneKind) => gone.filter(key => classifyGone(key, current, previous) === kind);
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
