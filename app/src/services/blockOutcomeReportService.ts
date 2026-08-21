import type { DailyRecommendation } from '../engine/models';
import type { CompetitionOutcome } from '../observations/models';
import {
    deriveProgress,
    type CurrentObservation,
    type SeriesReliabilityEstimate,
} from '../observations/progress';
import type { SessionOutcome } from '../responses/outcome';
import { getLocalDateString } from '../utils/localDate';
import {
    deriveBlockProcessEvidence,
    type KeyRoleEvidence,
} from '../outcomes/blockProcessEvidence';
import { deriveBlockOutcome, type BlockOutcomeReport } from '../outcomes/blockOutcome';
import type { OutcomeEvaluationSnapshot } from '../outcomes/evaluationSpec';
import { derivePolicySegments } from '../outcomes/policySegments';

export interface CompletedSessionRef {
    id: string;
    date: string;
}

export interface BlockOutcomeReportInput {
    evaluation: OutcomeEvaluationSnapshot;
    /** Current immutable head revisions; deriveProgress excludes invalid/practice revisions. */
    observations: readonly CurrentObservation[];
    reliabilityEstimates?: readonly SeriesReliabilityEstimate[];
    /** Existing daily recommendation/adherence records for the report window. */
    recommendations: readonly DailyRecommendation[];
    /** Exact completed session/execution history, including unplanned completed work. */
    completedSessions: readonly CompletedSessionRef[];
    /** Existing M5.3 outcomes for completed/abandoned session executions. */
    sessionOutcomes: readonly SessionOutcome[];
    /** Exact occurrence IDs from the existing weekly-role coverage authority. */
    keyRoles: KeyRoleEvidence;
    /** Ecological evidence remains separate from protocol metric series. */
    ecologicalOutcomes: readonly CompetitionOutcome[];
}

function inPeriod(date: string, startDate: string, endDate: string): boolean {
    return date >= startDate && date <= endDate;
}

/**
 * OV5.2-OV6.1 composition boundary. This service performs no writes and owns no evidence;
 * callers load canonical records and this deterministic join derives a report from them.
 */
export class BlockOutcomeReportService {
    buildReport(input: BlockOutcomeReportInput): BlockOutcomeReport {
        const { evaluation } = input;
        if (evaluation.revision.status === 'draft') {
            throw new Error('Block report requires an activated/frozen evaluation revision');
        }
        const { startDate, endDate } = evaluation.revision;
        const recommendations = input.recommendations.filter(item => inPeriod(item.date, startDate, endDate));
        const completedSessions = input.completedSessions.filter(item => inPeriod(item.date, startDate, endDate));
        const sessionOutcomes = input.sessionOutcomes.filter(item => inPeriod(item.sourceSession.date, startDate, endDate));
        const ecologicalOutcomes = input.ecologicalOutcomes.filter(item => {
            const date = getLocalDateString(new Date(item.occurredAt));
            return inPeriod(date, startDate, endDate);
        });

        const metricProgress = evaluation.bindings.map(binding => deriveProgress(
            binding,
            input.observations,
            input.reliabilityEstimates ?? [],
        ));
        const process = deriveBlockProcessEvidence({
            recommendations,
            sessionOutcomes,
            keyRoles: input.keyRoles,
            completedSessions: { sessionIds: completedSessions.map(item => item.id) },
        });
        const policySegments = derivePolicySegments(recommendations, { startDate, endDate });

        return deriveBlockOutcome({
            evaluation,
            metricProgress,
            ecologicalOutcomes,
            process,
            policySegments,
        });
    }
}

export const blockOutcomeReportService = new BlockOutcomeReportService();
