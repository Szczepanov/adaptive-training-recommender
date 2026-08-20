/**
 * M5.3: builds the outcome/override evidence report over a date range, wiring together only
 * existing data surfaces (2026-08-19 cutline: report/export first, no new persistence, no
 * dedicated history UI). For each finished execution in range:
 *
 *  - `sessionResponseService.getResponsesForSource` (M5.1) for recorded facts;
 *  - the canonical check-in (`checkinService`, D-MRESP's sole tissue authority) for any
 *    `RegionTissueResponse` whose `sourceSessionRef` matches this execution;
 *  - `resolveSessionDefinition` (M3.1) + `comparePlannedVsPerformed` (M2.6) for the
 *    planned-vs-performed delta, when the execution's prescription binding still resolves.
 *
 * Every one of those already exists and is already tested; this module only sequences reads
 * and hands the result to the pure `deriveSessionOutcome` (`responses/outcome.ts`). Dependency
 * injection with singleton defaults matches `StrengthHistoryReadService`'s established
 * pattern (M2.7) so this composition is unit-testable without the Firestore emulator.
 */
import type { RegionTissueResponse } from '../engine/models';
import { resolveSessionDefinition } from '../sessions/sessionDefinitionResolver';
import { comparePlannedVsPerformed } from '../sessions/performedComparison';
import { deriveSessionOutcome, type SessionOutcome } from '../responses/outcome';
import type { SessionResponseSourceRef } from '../responses/models';
import { checkinService, type CheckinService } from './checkinService';
import { sessionExecutionService, type SessionExecutionService } from './sessionExecutionService';
import { sessionResponseService, type SessionResponseService } from './sessionResponseService';

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
     * @param startDateInclusive Warsaw-local `YYYY-MM-DD`.
     * @param throughDateExclusive Warsaw-local `YYYY-MM-DD`, matching
     *   `sessionExecutionService.getExecutionsInRange`'s own exclusive-end convention.
     */
    async buildReport(
        userId: string,
        startDateInclusive: string,
        throughDateExclusive: string,
    ): Promise<SessionOutcome[]> {
        const { executions } = await this.executionService.getExecutionsInRange(
            userId, startDateInclusive, throughDateExclusive,
        );
        // An in-progress execution has no outcome yet -- reporting one now would silently
        // read as 'unknown' every time, indistinguishable from a genuinely unanswered
        // follow-up. Excluding it here keeps that distinction meaningful.
        const finished = executions.filter(item => item.execution.state !== 'in_progress');

        const checkinCache = new Map<string, RegionTissueResponse[]>();
        const tissueResponsesForDate = async (date: string): Promise<RegionTissueResponse[]> => {
            if (!checkinCache.has(date)) {
                const checkin = await this.checkins.getCheckinByDate(userId, date);
                checkinCache.set(date, checkin?.tissueResponses ? Object.values(checkin.tissueResponses) : []);
            }
            return checkinCache.get(date) ?? [];
        };

        const outcomes: SessionOutcome[] = [];
        for (const { execution, entries } of finished) {
            const sourceSession: SessionResponseSourceRef = {
                kind: 'execution', id: execution.executionId, date: execution.date,
            };
            const responses = await this.responseService.getResponsesForSource(userId, sourceSession);

            const checkinDates = new Set(responses.map(response => response.checkinRef.date));
            const tissueResponses: RegionTissueResponse[] = [];
            for (const date of checkinDates) {
                const regions = await tissueResponsesForDate(date);
                for (const region of regions) {
                    if (region.sourceSessionRef?.kind === 'execution' && region.sourceSessionRef.id === execution.executionId) {
                        tissueResponses.push(region);
                    }
                }
            }

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
