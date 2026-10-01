import { describe, expect, it } from 'vitest';
import { canonicalizeJson } from './canonicalJson';

describe('canonicalizeJson', () => {
    it('sorts object keys deterministically', () => {
        const objA = { z: 1, b: 2, a: 3 };
        const objB = { a: 3, z: 1, b: 2 };
        expect(JSON.stringify(canonicalizeJson(objA))).toBe(JSON.stringify(canonicalizeJson(objB)));
        expect(JSON.stringify(canonicalizeJson(objA))).toBe('{"a":3,"b":2,"z":1}');
    });

    it('preserves array order while sorting nested objects', () => {
        const input = [{ y: 1, x: 2 }, { b: 3, a: 4 }];
        expect(JSON.stringify(canonicalizeJson(input))).toBe('[{"x":2,"y":1},{"a":4,"b":3}]');
    });

    it('omits undefined properties', () => {
        const input = { a: 1, b: undefined, c: null };
        expect(canonicalizeJson(input)).toEqual({ a: 1, c: null });
    });

    it('handles nested objects recursively', () => {
        const input = { z: { b: 2, a: 1 }, a: { y: 2, x: 1 } };
        expect(JSON.stringify(canonicalizeJson(input))).toBe('{"a":{"x":1,"y":2},"z":{"a":1,"b":2}}');
    });
});
