import type { StrengthSession } from '../engine/models';
import { adaptNormalizedExecutionToStrengthSession } from '../sessions/legacyStrengthAdapter';
import { sessionExecutionService } from './sessionExecutionService';
import { strengthSessionService } from './strengthSessionService';

export interface StrengthHistoryReadResult {
    sessions: StrengthSession[];
    invalidRecords: number;
}

export class StrengthHistoryReadService {
    private readonly legacyService: typeof strengthSessionService;
    private readonly executionService: typeof sessionExecutionService;

    constructor(
        legacyService = strengthSessionService,
        executionService = sessionExecutionService,
    ) {
        this.legacyService = legacyService;
        this.executionService = executionService;
    }

    /**
     * Unified range read across legacy ADR-0021 strength_sessions and modern
     * ADR-0023 session_executions subcollections (M2.7).
     *
     * Sessions containing repetition entries are adapted to the canonical StrengthSession
     * model so overload history, 1RM writeback, and training history ingestion can
     * operate uniformly without requiring Firestore bulk migration.
     */
    async getSessionsInRange(
        userId: string,
        startDateInclusive: string,
        throughDateExclusive: string,
    ): Promise<StrengthHistoryReadResult> {
        const [legacyResult, executionResult] = await Promise.all([
            this.legacyService.getSessionsInRange(userId, startDateInclusive, throughDateExclusive),
            this.executionService.getExecutionsInRange(userId, startDateInclusive, throughDateExclusive),
        ]);

        const sessionMap = new Map<string, StrengthSession>();

        // 1. Ingest legacy strength sessions
        for (const session of legacyResult.sessions) {
            sessionMap.set(session.sessionId, session);
        }

        // 2. Ingest modern execution records containing repetition entries
        for (const record of executionResult.executions) {
            const adapted = adaptNormalizedExecutionToStrengthSession(record);
            if (adapted.exercises.length > 0) {
                sessionMap.set(adapted.sessionId, adapted);
            }
        }

        const mergedSessions = Array.from(sessionMap.values()).sort(
            (a, b) =>
                a.date.localeCompare(b.date) ||
                a.startedAt.localeCompare(b.startedAt) ||
                a.sessionId.localeCompare(b.sessionId),
        );

        return {
            sessions: mergedSessions,
            invalidRecords: legacyResult.invalidRecords + executionResult.invalidRecords,
        };
    }
}

export const strengthHistoryReadService = new StrengthHistoryReadService();
