import { describe, expect, it } from 'vitest';
import type { LedgerState, LedgerValue } from '../schema.ts';
import { collapsedLine, entryLines, formatNumber, formatValue, missingLine, type FieldEntry } from './compactLines.ts';

const absent = (state: LedgerState, source = 'athlete'): LedgerValue<unknown> => ({ value: null, source, state });
const measured = (value: unknown, source = 'athlete'): LedgerValue<unknown> => ({ value, source, state: 'measured' });

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

describe('formatNumber and formatValue', () => {
    it('shortens long floats while keeping integers exact and tiny non-zero numbers non-zero', () => {
        expect(formatNumber(77.650634765625)).toBe('77.7');
        expect(formatNumber(7.333333333333333)).toBe('7.3');
        expect(formatNumber(1.007516333980403)).toBe('1');
        expect(formatNumber(0)).toBe('0');
        expect(formatNumber(-0)).toBe('0');
        expect(formatNumber(80)).toBe('80');
        expect(formatNumber(-12)).toBe('-12');
        expect(formatNumber(0.04)).toBe('0.04');
        expect(formatNumber(-0.04)).toBe('-0.04');
        expect(formatNumber(0.004)).toBe('0.004');
    });

    it('shortens long hex hashes and leaves short hashes intact', () => {
        expect(formatValue('dde8183ef145aff4eb9299c4febf6df5e73985b9597308902fd11168e9e40a61'))
            .toBe('dde8183ef145…');
        expect(formatValue('sha256:24e6ff568f32feb5ff665541b0d53ca4960a18c6680fd295c66559761483a8ae'))
            .toBe('sha256:24e6ff568f32…');
        expect(formatValue('sha256:abc')).toBe('sha256:abc');
    });

    it('formats string arrays compactly and escapes hostile markdown', () => {
        expect(formatValue(['Cycling', 'Rowing'])).toBe('Cycling, Rowing');
        expect(formatValue([])).toBe('none');
        expect(formatValue(['Cycling', '## bad\n| [x](y)'])).toBe('Cycling, ## bad&#92;u000a&#124; &#91;x&#93;(y)');
    });
});

describe('activity segments in entryLines', () => {
    it('renders segments compactly, shows — for null power/HR, and escapes text', () => {
        const lines = entryLines([
            ['segments', measured([
                {
                    segmentIndex: 1, segmentType: 'unknown', durationSeconds: 181,
                    averagePowerWatts: 123.64, averageHrBpm: 107.44, maxHrBpm: 116, evidenceConfidence: 'low',
                },
                {
                    segmentIndex: 2, segmentType: 'work\n## bad', durationSeconds: 60,
                    averagePowerWatts: null, averageHrBpm: 107.4, maxHrBpm: null, evidenceConfidence: 'high|med',
                },
                {
                    segmentIndex: 3, segmentType: 'rest', durationSeconds: 30,
                    averagePowerWatts: null, averageHrBpm: null, maxHrBpm: null, evidenceConfidence: 'low',
                },
            ], 'garmin')],
        ], 'garmin');
        expect(lines).toEqual([
            'segments (3; #idx type dur power hr/maxHr conf):',
            '#1 unknown 181s 123.6W 107.4/116bpm low',
            '#2 work&#92;u000a## bad 60s —W 107.4/—bpm high&#124;med',
            '#3 rest 30s —W —bpm low',
        ]);
    });

    it('renders empty segments as none and preserves non-default provenance on the header', () => {
        expect(entryLines([['segments', measured([], 'garmin')]], 'garmin')).toEqual(['segments: none']);
        expect(entryLines([
            ['segments', {
                value: [{
                    segmentIndex: 0, segmentType: 'work', durationSeconds: 60,
                    averagePowerWatts: 250, averageHrBpm: null, maxHrBpm: 155, evidenceConfidence: 'high',
                }],
                source: 'manual',
                state: 'stale',
                observedOn: '2026-11-18',
            }],
        ], 'garmin')).toEqual([
            'segments (1; #idx type dur power hr/maxHr conf) (manual, stale, 2026-11-18):',
            '#0 work 60s 250W —/155bpm high',
        ]);
    });
});
