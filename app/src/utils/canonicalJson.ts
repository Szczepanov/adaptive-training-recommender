export type JsonPrimitive = string | number | boolean | null;
export type CanonicalJson = JsonPrimitive | CanonicalJson[] | { [key: string]: CanonicalJson };

export function compareCodeUnits(left: string, right: string): number {
    return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Deterministic, byte-stable JSON value normalization.
 * Recursively sorts object keys by JavaScript UTF-16 code-unit order while preserving array element order.
 * Undefined object properties are omitted.
 */
export function canonicalizeJson(value: unknown): CanonicalJson {
    if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        return value;
    }
    if (Array.isArray(value)) {
        return value.map(canonicalizeJson);
    }
    if (typeof value !== 'object') {
        throw new Error(`Unsupported JSON value: ${typeof value}`);
    }

    const entries = Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => compareCodeUnits(left, right));
    return Object.fromEntries(entries.map(([key, item]) => [key, canonicalizeJson(item)]));
}
