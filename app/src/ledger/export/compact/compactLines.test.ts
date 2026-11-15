import { describe, expect, it } from 'vitest';
import type { LedgerState, LedgerValue } from '../schema.ts';
import { collapsedLine, entryLines, missingLine, type FieldEntry } from './compactLines.ts';

const absent = (state: LedgerState, source = 'athlete'): LedgerValue<unknown> => ({ value: null, source, state });

describe('missingLine', () => {
    it('groups names by state and omits the group source', () => {
        const entries: FieldEntry[] = [['a', absent('not_recorded')], ['b', absent('not_recorded')], ['c', absent('missing')]];
        expect(missingLine(entries, 'athlete')).toBe('missing: a, b (not_recorded); c (missing)');
    });

    it('keeps a source that differs from the group source in the state label', () => {
        const entries: FieldEntry[] = [['a', absent('not_recorded')], ['b', absent('not_recorded', 'garmin')]];
        expect(missingLine(entries, 'athlete')).toBe('missing: a (not_recorded); b (not_recorded, garmin)');
    });

    it('carries the group through entryLines', () => {
        const entries: FieldEntry[] = [['x', { value: 1, source: 'athlete', state: 'measured' }], ['y', absent('missing', 'garmin')]];
        expect(entryLines(entries, 'athlete')).toEqual(['x: 1', 'missing: y (missing, garmin)']);
    });
});

describe('collapsedLine', () => {
    it('names every absent field grouped by state', () => {
        const entries: FieldEntry[] = [['a', absent('not_recorded')], ['b', absent('not_recorded')], ['c', absent('missing')]];
        expect(collapsedLine('row-1', entries, 'athlete')).toBe('row-1: missing 3 fields — a, b (not_recorded); c (missing)');
    });

    it('keeps a differing source on a collapsed record', () => {
        const entries: FieldEntry[] = [['a', absent('not_recorded')], ['b', absent('unavailable', 'garmin')]];
        expect(collapsedLine('row-2', entries, 'athlete')).toBe('row-2: missing 2 fields — a (not_recorded); b (unavailable, garmin)');
    });

    it('does not collapse a record with a present or measured-null field', () => {
        expect(collapsedLine('r', [['a', absent('not_recorded')], ['b', { value: 2, source: 'athlete', state: 'measured' }]], 'athlete')).toBeNull();
        expect(collapsedLine('r', [['a', absent('measured')]], 'athlete')).toBeNull();
    });
});
