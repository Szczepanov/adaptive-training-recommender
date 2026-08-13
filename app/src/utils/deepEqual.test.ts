import { describe, expect, it } from 'vitest';
import { deepEqual } from './deepEqual';

describe('deepEqual', () => {
    it('treats objects with re-ordered keys as equal (the Firestore round-trip case)', () => {
        const a = { id: '1', name: 'x', nested: { b: 2, a: 1 } };
        const b = { nested: { a: 1, b: 2 }, name: 'x', id: '1' };
        expect(deepEqual(a, b)).toBe(true);
    });

    it('is order-sensitive for arrays', () => {
        expect(deepEqual([1, 2], [2, 1])).toBe(false);
        expect(deepEqual([{ a: 1 }, { b: 2 }], [{ b: 2 }, { a: 1 }])).toBe(false);
    });

    it('treats a missing key as equal to an explicit undefined value', () => {
        expect(deepEqual({ a: 1 }, { a: 1, b: undefined })).toBe(true);
    });

    it('detects an actual value difference nested inside matching keys', () => {
        expect(deepEqual({ a: { b: 1 } }, { a: { b: 2 } })).toBe(false);
    });

    it('treats null and undefined as distinct from each other and from missing', () => {
        expect(deepEqual(null, undefined)).toBe(false);
        expect(deepEqual({ a: null }, { a: undefined })).toBe(false);
    });

    it('handles primitives and top-level null/undefined', () => {
        expect(deepEqual(1, 1)).toBe(true);
        expect(deepEqual('a', 'b')).toBe(false);
        expect(deepEqual(null, null)).toBe(true);
    });
});
