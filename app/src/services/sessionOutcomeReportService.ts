/**
 * M5.3: builds the outcome/override evidence report over a date range, wiring together only
 * existing data surfaces (2026-08-19 cutline: report/export first, no new persistence, no
 * dedicated history UI). For each finished execution in range:
 *
 *  - `sessionResponseService.getResponsesForSource` (M5.1) for recorded facts;
 *  - the canonical check-in (`checkinService`, D-MRESP's sole tissue authority) for any
 *    `RegionTissueResponse` whose `sourceSessionRef` matches this execution -- discovered by
 *    scanning check-ins directly (see `tissueIndexInRange` below), never by way of whether a
 *    `SessionResponse` happens to exist;
 *  - `resolveSessionDefinition` (M3.1) + `comparePlannedVsPerformed` (M2.6) for the
 *    planned-vs-performed delta, when the execution's prescription binding still resolves.
 *
 * Every one of those already exists and is already tested; this module only sequences reads
 * and hands the result to the pure `deriveSessionOutcome` (`responses/outcome.ts`). Dependency
 * injection with singleton defaults matches `StrengthHistoryReadService`'s established
 * pattern (M2.7) so this composition is unit-testable without the Firestore emulator.
 */
import type { RegionTissueResponse } from '../engine/models';
import { addDaysToLocalDateString } from '../utils/localDate';
import { resolveSessionDefinition } from '../sessions/sessionDefinitionResolver';
import { comparePlannedVsPerformed } from '../sessions/performedComparison';
import { deriveSessionOutcome, type SessionOutcome } from '../responses/outcome';
import type { SessionResponseSourceRef } from '../responses/models';
import { checkinService, type CheckinService } from './checkinService';
import { sessionExecutionService, type SessionExecutionService } from './sessionExecutionService';
import { sessionResponseService, type SessionResponseService } from './sessionResponseService';

/** later_day answers land same-day and next_morning answers land the day after, but neither
 * window has an expiry (M5.2 never times one out), so a late answer must still be found. This
 * buffer is a bounded compromise, not a correctness guarantee for an answer recorded further
 * out than a week later. */
const TISSUE_LOOKAHEAD_DAYS = 7;

export class SessionOutcomeReportService {
    private readonly executionService: SessionExecutionService;
    private readonly responseService: SessionResponseService;
    private readonly checkins: CheckinService;

    constructor(
        executionService: SessionExecutionService = sessionExecutionService,
        responseService: SessionResponseService = sessionResponseService,
        checkins: CheckinService = checkinService,
    ) {
        this.executionService = executionService;
        this.responseService = responseService;
        this.checkins = checkins;
    }

    /**
     * Every execution-linked `RegionTissueResponse` in `[startDateInclusive, throughDateExclusive
     * + TISSUE_LOOKAHEAD_DAYS)`, indexed by the execution id its `sourceSessionRef` names --
     * scanned directly from check-ins, independent of whether any `SessionResponse` was ever
     * recorded for that execution. A manually-flagged tissue reaction (the pre-M5.1 check-in
     * flow M5.2 left unchanged for legacy `strength_sessions`, still reachable for `execution`
     * sources too) sets `sourceSessionRef` without necessarily creating a `SessionResponse`; a
     * discovery keyed off `SessionResponse.checkinRef.date` would silently miss it.
     */
    private async tissueIndexInRange(
        userId: string,
        startDateInclusive: string,
        throughDateExclusive: string,
    ): Promise<Map<string, RegionTissueResponse[]>> {
        const checkins = await this.checkins.getCheckinsInRange(
            userId, startDateInclusive, addDaysToLocalDateString(throughDateExclusive, TISSUE_LOOKAHEAD_DAYS),
        );
        const index = new Map<string, RegionTissueResponse[]>();
        for (const checkin of checkins) {
            if (!checkin.tissueResponses) continue;
            for (const region of Object.values(checkin.tissueResponses)) {
                if (region.sourceSessionRef?.kind !== 'execution') continue;
                const existing = index.get(region.sourceSessionRef.id) ?? [];
                existing.push(region);
                index.set(region.sourceSessionRef.id, existing);
            }
        }
        return index;
    }

    /**
     * @param startDateInclusive Warsaw-local `YYYY-MM-DD`.
     * @param throughDateExclusive Warsaw-local `YYYY-MM-DD`, matching
     *   `sessionExecutionService.getExecutionsInRange`'s own exclusive-end convention.
     */
    async buildReport(
        userId: string,
        startDateInclusive: string,
        throughDateExclusive: string,
    ): Promise<SessionOutcome[]> {
        const [{ executions }, tissueIndex] = await Promise.all([
            this.executionService.getExecutionsInRange(userId, startDateInclusive, throughDateExclusive),
            this.tissueIndexInRange(userId, startDateInclusive, throughDateExclusive),
        ]);
        // An in-progress execution has no outcome yet -- reporting one now would silently
        // read as 'unknown' every time, indistinguishable from a genuinely unanswered
        // follow-up. Excluding it here keeps that distinction meaningful.
        const finished = executions.filter(item => item.execution.state !== 'in_progress');

        const outcomes: SessionOutcome[] = [];
        for (const { execution, entries } of finished) {
            const sourceSession: SessionResponseSourceRef = {
                kind: 'execution', id: execution.executionId, date: execution.date,
            };
            const responses = await this.responseService.getResponsesForSource(userId, sourceSession);
            const tissueResponses = tissueIndex.get(execution.executionId) ?? [];

            let comparison: ReturnType<typeof comparePlannedVsPerformed> | undefined;
            if (execution.state === 'completed') {
                const definitionState = await resolveSessionDefinition(
                    userId, execution.sessionSource, execution.prescriptionHash,
                );
                if (definitionState.status === 'AVAILABLE') {
                    comparison = comparePlannedVsPerformed(definitionState.data, entries);
                }
            }

            outcomes.push(deriveSessionOutcome({
                sourceSession,
                responses,
                tissueResponses,
                ...(comparison ? { comparison } : {}),
            }));
        }

        return outcomes.sort((a, b) => (
            a.sourceSession.date.localeCompare(b.sourceSession.date)
            || a.sourceSession.id.localeCompare(b.sourceSession.id)
        ));
    }
}

export const sessionOutcomeReportService = new SessionOutcomeReportService();
