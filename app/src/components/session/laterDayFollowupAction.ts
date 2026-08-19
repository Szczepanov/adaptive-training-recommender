import type { SessionResponseSourceRef } from '../../responses/models';
import { sessionResponseService, type SessionResponseService } from '../../services/sessionResponseService';

export interface LaterDayFollowupTarget {
    sourceSession: SessionResponseSourceRef;
    occurrenceId?: string;
    /** Warsaw-local date the session happened on -- this window's own `date` and the
     * check-in it references are both this same day (M5.2: `later_day` is a same-day
     * follow-up, distinct from the next-morning tissue prompt). */
    date: string;
    title: string;
}

export async function recordLaterDayFollowup(
    userId: string,
    target: LaterDayFollowupTarget,
    unexpectedFatigue: boolean,
    service: SessionResponseService = sessionResponseService,
): Promise<void> {
    await service.recordResponse(
        userId,
        target.sourceSession,
        'later_day',
        target.date,
        target.date,
        { unexpectedFatigue },
        target.occurrenceId,
    );
}
