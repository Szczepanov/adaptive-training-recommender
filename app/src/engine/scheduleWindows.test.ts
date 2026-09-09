import { describe, expect, it } from 'vitest';
import type { ScheduleWindow, ScheduleWindowManifest } from './models';
import {
    resolveScheduleWindowsForDate,
    scheduleWindowDurationMinutes,
    scheduleWindowsOverlap,
    validateScheduleWindow,
    validateScheduleWindowManifest,
    validateScheduleWindowSet,
} from './scheduleWindows';

function makeWindow(overrides: Partial<ScheduleWindow> = {}): ScheduleWindow {
    return {
        id: 'w1',
        userId: 'u1',
        date: '2026-09-10',
        startLocal: '06:00',
        endLocal: '07:00',
        revision: 1,
        createdAt: '2026-09-01T00:00:00.000Z',
        updatedAt: '2026-09-01T00:00:00.000Z',
        ...overrides,
    };
}

function makeManifest(overrides: Partial<ScheduleWindowManifest> = {}): ScheduleWindowManifest {
    return {
        userId: 'u1',
        date: '2026-09-10',
        revision: 1,
        windows: [makeWindow()],
        createdAt: '2026-09-01T00:00:00.000Z',
        updatedAt: '2026-09-01T00:00:00.000Z',
        ...overrides,
    };
}

describe('validateScheduleWindow', () => {
    it('accepts a minimal valid window', () => {
        const result = validateScheduleWindow(makeWindow());
        expect(result.isValid).toBe(true);
    });

    it('accepts a window with label/equipment/environment', () => {
        const result = validateScheduleWindow(makeWindow({ label: 'AM', equipment: ['bike'], environment: 'outdoor' }));
        expect(result.isValid).toBe(true);
    });

    it('rejects a non-object payload', () => {
        expect(validateScheduleWindow(null).isValid).toBe(false);
        expect(validateScheduleWindow('nope').isValid).toBe(false);
    });

    it('rejects a missing/invalid date', () => {
        expect(validateScheduleWindow(makeWindow({ date: undefined as unknown as string })).isValid).toBe(false);
        expect(validateScheduleWindow(makeWindow({ date: '2026-13-40' })).isValid).toBe(false);
    });

    it.each(['6:00', '06:0', '24:00', '06:60', 'six am', ''])('rejects a malformed startLocal %s', (bad) => {
        const result = validateScheduleWindow(makeWindow({ startLocal: bad }));
        expect(result.isValid).toBe(false);
    });

    it('rejects a zero-duration window (start == end)', () => {
        const result = validateScheduleWindow(makeWindow({ startLocal: '06:00', endLocal: '06:00' }));
        expect(result.isValid).toBe(false);
    });

    it('rejects a cross-midnight (start after end) window rather than treating it as overnight', () => {
        const result = validateScheduleWindow(makeWindow({ startLocal: '22:00', endLocal: '02:00' }));
        expect(result.isValid).toBe(false);
    });

    it('rejects an oversized label', () => {
        const result = validateScheduleWindow(makeWindow({ label: 'x'.repeat(101) }));
        expect(result.isValid).toBe(false);
    });

    it('rejects an unknown environment', () => {
        const result = validateScheduleWindow(makeWindow({ environment: 'space' as unknown as ScheduleWindow['environment'] }));
        expect(result.isValid).toBe(false);
    });

    it('rejects an oversized equipment list', () => {
        const result = validateScheduleWindow(makeWindow({ equipment: Array.from({ length: 21 }, (_, i) => `item-${i}`) }));
        expect(result.isValid).toBe(false);
    });

    it('rejects a non-positive-integer revision', () => {
        expect(validateScheduleWindow(makeWindow({ revision: 0 })).isValid).toBe(false);
        expect(validateScheduleWindow(makeWindow({ revision: 1.5 })).isValid).toBe(false);
    });
});

describe('scheduleWindowsOverlap', () => {
    it('detects a genuine overlap', () => {
        expect(scheduleWindowsOverlap({ startLocal: '06:00', endLocal: '08:00' }, { startLocal: '07:00', endLocal: '09:00' })).toBe(true);
    });

    it('treats a shared boundary as non-overlapping (half-open)', () => {
        expect(scheduleWindowsOverlap({ startLocal: '06:00', endLocal: '08:00' }, { startLocal: '08:00', endLocal: '09:00' })).toBe(false);
    });

    it('detects full containment as overlap', () => {
        expect(scheduleWindowsOverlap({ startLocal: '06:00', endLocal: '12:00' }, { startLocal: '07:00', endLocal: '08:00' })).toBe(true);
    });

    it('reports no overlap for disjoint windows', () => {
        expect(scheduleWindowsOverlap({ startLocal: '06:00', endLocal: '07:00' }, { startLocal: '18:00', endLocal: '19:00' })).toBe(false);
    });
});

describe('validateScheduleWindowSet', () => {
    it('accepts an empty set', () => {
        expect(validateScheduleWindowSet([])).toEqual([]);
    });

    it('accepts multiple non-overlapping same-date windows (AM/PM)', () => {
        const am = makeWindow({ id: 'am', startLocal: '06:00', endLocal: '07:00' });
        const pm = makeWindow({ id: 'pm', startLocal: '17:00', endLocal: '18:00' });
        expect(validateScheduleWindowSet([am, pm])).toEqual([]);
    });

    it('flags an overlapping pair on the same date', () => {
        const first = makeWindow({ id: 'a', startLocal: '06:00', endLocal: '08:00' });
        const second = makeWindow({ id: 'b', startLocal: '07:00', endLocal: '09:00' });
        const errors = validateScheduleWindowSet([first, second]);
        expect(errors).toHaveLength(1);
        expect(errors[0].message).toContain('Overlapping schedule windows');
    });

    it('does not compare windows across different dates', () => {
        const first = makeWindow({ id: 'a', date: '2026-09-10', startLocal: '06:00', endLocal: '08:00' });
        const second = makeWindow({ id: 'b', date: '2026-09-11', startLocal: '07:00', endLocal: '09:00' });
        expect(validateScheduleWindowSet([first, second])).toEqual([]);
    });

    it('flags duplicate stable ids', () => {
        expect(validateScheduleWindowSet([makeWindow({ id: 'same' }), makeWindow({ id: 'same', startLocal: '17:00', endLocal: '18:00' })]))
            .toEqual([expect.objectContaining({ message: 'Duplicate schedule window id: same' })]);
    });
});

describe('validateScheduleWindowManifest', () => {
    it('accepts a bounded manifest with non-overlapping same-date windows', () => {
        const manifest = makeManifest({
            windows: [makeWindow({ id: 'am' }), makeWindow({ id: 'pm', startLocal: '17:00', endLocal: '18:00' })],
        });
        expect(validateScheduleWindowManifest(manifest).isValid).toBe(true);
    });

    it('rejects an overlapping manifest even when every individual window is valid', () => {
        const result = validateScheduleWindowManifest(makeManifest({
            windows: [makeWindow({ id: 'first', endLocal: '08:00' }), makeWindow({ id: 'second', startLocal: '07:00', endLocal: '09:00' })],
        }));
        expect(result.isValid).toBe(false);
        expect(result.errors.some(error => error.message.includes('Overlapping schedule windows'))).toBe(true);
    });

    it('rejects a window that does not belong to the manifest date or user', () => {
        expect(validateScheduleWindowManifest(makeManifest({ windows: [makeWindow({ userId: 'other-user' })] })).isValid).toBe(false);
        expect(validateScheduleWindowManifest(makeManifest({ windows: [makeWindow({ date: '2026-09-11' })] })).isValid).toBe(false);
    });

    it('rejects more than the rule-verifiable maximum of eight windows', () => {
        const windows = Array.from({ length: 9 }, (_, index) => makeWindow({
            id: `w-${index}`,
            startLocal: `${String(index).padStart(2, '0')}:00`,
            endLocal: `${String(index + 1).padStart(2, '0')}:00`,
        }));
        expect(validateScheduleWindowManifest(makeManifest({ windows })).isValid).toBe(false);
    });
});

describe('resolveScheduleWindowsForDate', () => {
    it('returns [] for a date with no windows -- the supported legacy single-slot case', () => {
        expect(resolveScheduleWindowsForDate('2026-09-10', [])).toEqual([]);
        const other = makeWindow({ date: '2026-09-11' });
        expect(resolveScheduleWindowsForDate('2026-09-10', [other])).toEqual([]);
    });

    it('returns only the requested date, ordered by start time regardless of input order', () => {
        const pm = makeWindow({ id: 'pm', date: '2026-09-10', startLocal: '17:00', endLocal: '18:00' });
        const am = makeWindow({ id: 'am', date: '2026-09-10', startLocal: '06:00', endLocal: '07:00' });
        const otherDate = makeWindow({ id: 'other', date: '2026-09-11' });
        const resolved = resolveScheduleWindowsForDate('2026-09-10', [pm, am, otherDate]);
        expect(resolved.map(w => w.id)).toEqual(['am', 'pm']);
    });
});

describe('scheduleWindowDurationMinutes', () => {
    it('computes elapsed minutes for a same-day window', () => {
        expect(scheduleWindowDurationMinutes({ startLocal: '06:00', endLocal: '07:30' })).toBe(90);
    });
});
