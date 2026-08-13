/**
 * Structural equality for JSON-like values, matching Firestore's map-equality
 * semantics: object/map key order is irrelevant, array order is not, and a
 * missing key is equivalent to a key whose value is `undefined`.
 *
 * Deliberately NOT `JSON.stringify(a) === JSON.stringify(b)`: Firestore returns
 * map fields in sorted key order regardless of the order they were written in,
 * so a value that survives an unmodified round-trip through Firestore can still
 * produce a different JSON string than the freshly-constructed value it came
 * from. Comparisons that gate persistence decisions (e.g. "did the recommended
 * prescription actually change?") must not be fooled by that.
 */
export function deepEqual(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (a === null || b === null || a === undefined || b === undefined) return a === b;
    if (typeof a !== 'object' || typeof b !== 'object') return false;

    if (Array.isArray(a) || Array.isArray(b)) {
        if (!Array.isArray(a) || !Array.isArray(b)) return false;
        if (a.length !== b.length) return false;
        return a.every((item, index) => deepEqual(item, b[index]));
    }

    const aRecord = a as Record<string, unknown>;
    const bRecord = b as Record<string, unknown>;
    const aKeys = Object.keys(aRecord).filter(key => aRecord[key] !== undefined);
    const bKeys = Object.keys(bRecord).filter(key => bRecord[key] !== undefined);
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every(key => Object.prototype.hasOwnProperty.call(bRecord, key) && deepEqual(aRecord[key], bRecord[key]));
}
