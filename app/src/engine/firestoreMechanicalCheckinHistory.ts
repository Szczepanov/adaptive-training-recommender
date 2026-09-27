import type { MechanicalCheckinHistoryProvider } from './mechanicalCheckinHistory';
import { checkinService } from '../services/checkinService';

/** Default live provider for mechanical check-in history. It reuses the validated range
 * reader: documents that fail ownership/date/schema parsing are excluded, so a corrupt
 * follow-up can only hold progression, never fabricate a normal tissue response. An
 * unavailable read is raised, so the orchestration boundary reports it as a failed read
 * rather than as an athlete who skipped check-ins. */
export const firestoreMechanicalCheckinHistoryProvider: MechanicalCheckinHistoryProvider = {
    async getCheckins(userId, startDateInclusive, endDateExclusive) {
        const state = await checkinService.getCheckinsInRangeState(userId, startDateInclusive, endDateExclusive);
        if (state.status === 'UNAVAILABLE') throw new Error(`Failed to ${state.operation}`);
        return state.status === 'AVAILABLE' ? state.data : [];
    },
};
