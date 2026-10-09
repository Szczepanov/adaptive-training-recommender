import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { sha256Hex } from './sha256';

describe('synchronous bounded SHA-256 identity', () => {
    it.each(['', 'abc', 'x'.repeat(55), 'x'.repeat(56), 'x'.repeat(64), 'x'.repeat(16 * 1024), '\u03bb\ud83c\udfcb'])('matches platform SHA-256 for input %#', value => {
        expect(sha256Hex(value)).toBe(createHash('sha256').update(value).digest('hex'));
    });
});
