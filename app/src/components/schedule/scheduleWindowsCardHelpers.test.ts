import { describe, expect, it } from 'vitest';
import { dateLabel, groupByDate } from './scheduleWindowsCardHelpers';
import type { ScheduleWindowWithId } from '../../services/scheduleWindowService';

function window(overrides: Partial<ScheduleWindowWithId> = {}): ScheduleWindowWithId {
    return {
        id: 'w1',
        userId: 'user-1',
        date: '2026-08-17',
        startLocal: '07:00',
        endLocal: '08:00',
        revision: 1,
        createdAt: '2026-08-17T00:00:00.000Z',
        updatedAt: '2026-08-17T00:00:00.000Z',
        ...overrides,
    };
}

describe('dateLabel', () => {
    it('formats a canonical date as a short weekday/month/day label', () => {
        // 2026-08-17 is a Monday.
        expect(dateLabel('2026-08-17')).toBe('Mon, Aug 17');
    });

    it('is stable regardless of the runner\'s local timezone -- always resolved in UTC', () => {
        // A date near a DST boundary would shift weekday under a naive local-time parse.
        expect(dateLabel('2026-11-01')).toBe('Sun, Nov 1');
    });
});

describe('groupByDate', () => {
    it('groups windows by date, sorted by date then by start time within a date', () => {
        const groups = groupByDate([
            window({ id: 'pm', date: '2026-08-17', startLocal: '17:00', endLocal: '18:00' }),
            window({ id: 'am', date: '2026-08-17', startLocal: '07:00', endLocal: '08:00' }),
            window({ id: 'earlier-day', date: '2026-08-16', startLocal: '09:00', endLocal: '10:00' }),
        ]);

        expect(groups.map(g => g.date)).toEqual(['2026-08-16', '2026-08-17']);
        expect(groups[1].windows.map(w => w.id)).toEqual(['am', 'pm']);
    });

    it('returns an empty list for no windows', () => {
        expect(groupByDate([])).toEqual([]);
    });

    it('keeps each date\'s own windows independent -- two dates with one window each stay separate groups', () => {
        const groups = groupByDate([
            window({ id: 'a', date: '2026-08-17' }),
            window({ id: 'b', date: '2026-08-18' }),
        ]);
        expect(groups).toHaveLength(2);
        expect(groups[0].windows).toHaveLength(1);
        expect(groups[1].windows).toHaveLength(1);
    });
});
