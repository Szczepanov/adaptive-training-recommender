/** Small pure constructors for state-bearing export values. */
import type {
    ContextRecord,
    LedgerCollection,
    LedgerRecord,
    LedgerState,
    LedgerValue,
} from './schema.ts';

interface FactOptions {
    source: string;
    unit?: string;
    observedOn?: string;
    /** State used when the value is absent (null/undefined). */
    absent?: LedgerState;
    /** State used when the value is present. */
    present?: LedgerState;
}

/** A present value is `measured` (a zero stays 0); an absent one is never a bare null. */
export function fact<T>(value: T | null | undefined, options: FactOptions): LedgerValue<T> {
    const hasValue = value !== null && value !== undefined;
    return {
        value: hasValue ? value : null,
        ...(options.unit === undefined ? {} : { unit: options.unit }),
        source: options.source,
        state: hasValue ? (options.present ?? 'measured') : (options.absent ?? 'missing'),
        ...(options.observedOn === undefined ? {} : { observedOn: options.observedOn }),
    };
}

/** Inclusive physiological/scale range; `minExclusive` makes the lower bound strict (HR > 0). */
export interface ValueRange {
    min?: number;
    max?: number;
    minExclusive?: boolean;
}

function inRange(value: number, range: ValueRange): boolean {
    if (!Number.isFinite(value)) return false;
    if (range.min !== undefined && (range.minExclusive ? value <= range.min : value < range.min)) return false;
    return range.max === undefined || value <= range.max;
}

/** Like `fact`, but a present value outside its range is `invalid` with no value retained. */
export function rangedFact(
    value: number | null | undefined,
    range: ValueRange,
    options: FactOptions,
): LedgerValue<number> {
    if (value === null || value === undefined || inRange(value, range)) return fact(value, options);
    return fact<number>(null, { ...options, absent: 'invalid' });
}

/** Least to most severe. A combined collection reports the worst state of its sources. */
export const STATE_SEVERITY: readonly LedgerState[] = [
    'measured',
    'not_applicable',
    'not_collected',
    'stale',
    'not_recorded',
    'missing',
    'not_yet_supported',
    'invalid',
    'unavailable',
];

export function worstState(states: readonly LedgerState[]): LedgerState {
    return states.reduce<LedgerState>(
        (worst, state) => (STATE_SEVERITY.indexOf(state) > STATE_SEVERITY.indexOf(worst) ? state : worst),
        'measured',
    );
}

/** The export promises the field, no backing record exists yet (ADR-0052 D-EXPORT). */
export function notYetSupported<T>(source = 'ledger'): LedgerValue<T> {
    return { value: null, source, state: 'not_yet_supported' };
}

export function record<F extends string>(
    id: string,
    observedOn: string | null,
    fields: Record<F, LedgerValue<unknown>>,
): LedgerRecord<F> {
    return { id, observedOn, fields };
}

export function contextRecord<F extends string>(
    base: LedgerRecord<F>,
    since: LedgerValue<string> = notYetSupported(),
): ContextRecord<F> {
    return { ...base, since, revisions: notYetSupported() };
}

/** Builds a field map for a closed key list, so no promised key can be forgotten. */
export function fieldMap<F extends string>(
    keys: readonly F[],
    build: (key: F) => LedgerValue<unknown>,
): Record<F, LedgerValue<unknown>> {
    return Object.fromEntries(keys.map(key => [key, build(key)])) as Record<F, LedgerValue<unknown>>;
}

export function collection<T>(
    source: string,
    state: LedgerState,
    items: T[],
    droppedUndated = 0,
): LedgerCollection<T> {
    return { state, source, items, droppedUndated };
}

/**
 * Applies a source-level read state to a value: `measured` leaves it alone, `stale` keeps the
 * dated value, any other state means the value cannot be trusted and is withheld.
 */
export function withSourceState<T>(value: LedgerValue<T>, state: LedgerState): LedgerValue<T> {
    if (state === 'measured' || value.state === 'not_yet_supported') return value;
    if (state === 'stale') return value.value === null ? value : { ...value, state: 'stale' };
    return { ...value, value: null, state };
}
