import type { SourceKey, SourceReadInput } from './inputs.ts';
import { collection } from './ledgerValue.ts';
import type { LedgerCollection, LedgerState, LedgerWindow } from './schema.ts';
import type { PurposeBounds } from './window.ts';

/** Shared, read-only context for the layer builders. */
export interface BuildContext {
    asOfDate: string;
    window: LedgerWindow;
    bounds: PurposeBounds;
    sources: Partial<Record<SourceKey, SourceReadInput>>;
}

/** An unread source is `unavailable`; a read one reports its recorded state, default `measured`. */
export function sourceState(
    context: BuildContext,
    key: SourceKey,
    provided: boolean,
): LedgerState {
    if (!provided) return 'unavailable';
    return context.sources[key]?.state ?? 'measured';
}

/** Builds a collection whose state comes from its source read; `undefined` records = not read. */
export function collect<R, T>(
    context: BuildContext,
    key: SourceKey,
    records: readonly R[] | undefined,
    toItems: (rows: readonly R[]) => T[],
): LedgerCollection<T> {
    return collection(key, sourceState(context, key, records !== undefined), toItems(records ?? []));
}

export function byIdThenDate<T extends { id: string; observedOn: string | null }>(items: T[]): T[] {
    return [...items].sort((a, b) =>
        (a.observedOn ?? '').localeCompare(b.observedOn ?? '') || a.id.localeCompare(b.id));
}
