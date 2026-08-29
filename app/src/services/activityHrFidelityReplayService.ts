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
    /** A source failure is not rendered as empty activity history. */
    unavailableSources: string[];
}

/** Read-only I/O wrapper around HRF7's deterministic replay journal. */
export class ActivityHrFidelityReplayService {
    async build(userId: string, startDate: string, endDateInclusive: string): Promise<ActivityHrFidelityReplayResult> {
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
                unavailableSources: [],
            };
        }
        return {
            report: null,
            startDate,
            endDate: endDateInclusive,
            unavailableSources: [state.status === 'INVALID' ? 'activities (invalid record)' : 'activities'],
        };
    }
}

export const activityHrFidelityReplayService = new ActivityHrFidelityReplayService();
