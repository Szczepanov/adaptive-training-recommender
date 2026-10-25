import type { SourceKey, SourceReadInput } from './inputs.ts';
import { collection } from './ledgerValue.ts';
import type { LedgerCollection, LedgerState, LedgerWindow } from './schema.ts';
import { windowBounds, windowRows, type DateBounds, type PurposeBounds } from './window.ts';

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

interface Keyed {
    id: string;
    observedOn: string | null;
}

/** Orders by semantic date, then id, with plain code-unit comparison (locale-independent). */
export function byDateThenId<T extends Keyed>(items: readonly T[]): T[] {
    const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
    return [...items].sort((a, b) => compare(a.observedOn ?? '', b.observedOn ?? '') || compare(a.id, b.id));
}

export interface CollectSpec<R, T extends Keyed> {
    key: SourceKey;
    /** `undefined` = the source was not read. */
    records: readonly R[] | undefined;
    /** Selects the row date; present => rows are windowed and undated rows are counted. */
    dateOf?: (row: R) => string | null | undefined;
    /** Defaults to the export window. */
    bounds?: DateBounds;
    /** Row-level eligibility applied before windowing (e.g. active goals, non-merged). */
    include?: (row: R) => boolean;
    toItem: (row: R) => T;
}

/** Builds a deterministic collection whose state comes from its source read. */
export function collect<R, T extends Keyed>(context: BuildContext, spec: CollectSpec<R, T>): LedgerCollection<T> {
    const eligible = (spec.records ?? []).filter(spec.include ?? (() => true));
    const { rows, droppedUndated } = spec.dateOf
        ? windowRows(eligible, spec.dateOf, spec.bounds ?? windowBounds(context.window))
        : { rows: eligible, droppedUndated: 0 };
    return collection(
        spec.key,
        sourceState(context, spec.key, spec.records !== undefined),
        byDateThenId(rows.map(spec.toItem)),
        droppedUndated,
    );
}
