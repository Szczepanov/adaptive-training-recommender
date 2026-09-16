import type { ScheduleWindowWithId } from '../../services/scheduleWindowService';

/** Format a canonical YYYY-MM-DD in UTC so local timezone offsets cannot shift its weekday,
 * mirroring `WeekAheadStrip.tsx`'s own formatter. */
const WEEKDAY_FORMATTER = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
export function dateLabel(dateStr: string): string {
    return WEEKDAY_FORMATTER.format(new Date(dateStr + 'T00:00:00Z'));
}

export interface DateGroup {
    date: string;
    windows: ScheduleWindowWithId[];
}

/** Pure grouping/sorting -- no component state involved. Kept in its own module (not
 * `ScheduleWindowsCard.tsx`) so that file only exports the component itself, satisfying
 * `react-refresh/only-export-components`. */
export function groupByDate(windows: readonly ScheduleWindowWithId[]): DateGroup[] {
    const byDate = new Map<string, ScheduleWindowWithId[]>();
    for (const window of windows) {
        const group = byDate.get(window.date) ?? [];
        group.push(window);
        byDate.set(window.date, group);
    }
    return [...byDate.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([date, dateWindows]) => ({
            date,
            windows: [...dateWindows].sort((left, right) => left.startLocal.localeCompare(right.startLocal)),
        }));
}
