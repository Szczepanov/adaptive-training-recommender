import { describe, expect, it } from 'vitest';
import { csvField, formatCsvRow } from './csv';

describe('csvField', () => {
    it('returns empty string for null and undefined', () => {
        expect(csvField(null)).toBe('');
        expect(csvField(undefined)).toBe('');
    });

    it('returns plain text when no special characters exist', () => {
        expect(csvField('plain')).toBe('plain');
        expect(csvField('value_123')).toBe('value_123');
        expect(csvField(42)).toBe('42');
        expect(csvField(0)).toBe('0');
        expect(csvField(true)).toBe('true');
        expect(csvField(false)).toBe('false');
    });

    it('quotes strings containing commas', () => {
        expect(csvField('hello, world')).toBe('"hello, world"');
    });

    it('quotes and escapes strings containing double quotes', () => {
        expect(csvField('say "hello"')).toBe('"say ""hello"""');
    });

    it('quotes strings containing newlines and carriage returns', () => {
        expect(csvField("line 1\nline 2")).toBe('"line 1\nline 2"');
        expect(csvField("line 1\r\nline 2")).toBe('"line 1\r\nline 2"');
    });
});

describe('formatCsvRow', () => {
    it('formats a row with proper delimiters and quoting', () => {
        const row = formatCsvRow(['test', 123, 'a,b', 'with "quotes"', null, undefined]);
        expect(row).toBe('test,123,"a,b","with ""quotes""",,');
    });
});
