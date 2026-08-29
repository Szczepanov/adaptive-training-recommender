import {
    runActivityHrFidelityShadowReplay,
    type ActivityHrFidelityShadowReport,
} from '../engine/activityHrFidelityReplay';
import { addDaysToLocalDateString } from '../utils/localDate';
import { activityService } from './activityService';

export interface ActivityHrFidelityReplayResult {
    report: ActivityHrFidelityShadowReport | null;
    startDate: string;
    endDate: string;
    /** Caller-supplied range problems are distinct from source availability. */
    inputIssues: string[];
    /** A source failure is not rendered as empty activity history. */
    unavailableSources: string[];
}

function localDateKey(value: string): number | null {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const key = Date.UTC(year, month - 1, day);
    const date = new Date(key);
    if (
        date.getUTCFullYear() !== year
        || date.getUTCMonth() !== month - 1
        || date.getUTCDate() !== day
    ) return null;
    return key;
}

/** Read-only I/O wrapper around HRF7's deterministic replay journal. */
export class ActivityHrFidelityReplayService {
    async build(userId: string, startDate: string, endDateInclusive: string): Promise<ActivityHrFidelityReplayResult> {
        const startKey = localDateKey(startDate);
        const endKey = localDateKey(endDateInclusive);
        if (startKey === null || endKey === null || startKey > endKey) {
            return {
                report: null,
                startDate,
                endDate: endDateInclusive,
                inputIssues: ['Replay range must use valid YYYY-MM-DD dates with startDate <= endDateInclusive.'],
                unavailableSources: [],
            };
        }

        const state = await activityService.getActivitiesInRange(
            userId,
            startDate,
            addDaysToLocalDateString(endDateInclusive, 1),
        );
        if (state.status === 'AVAILABLE') {
            return {
                report: runActivityHrFidelityShadowReplay(state.data),
                startDate,
                endDate: endDateInclusive,
                inputIssues: [],
                unavailableSources: [],
            };
        }
        return {
            report: null,
            startDate,
            endDate: endDateInclusive,
            inputIssues: [],
            unavailableSources: [state.status === 'INVALID' ? 'activities (invalid record)' : 'activities'],
        };
    }
}

export const activityHrFidelityReplayService = new ActivityHrFidelityReplayService();
