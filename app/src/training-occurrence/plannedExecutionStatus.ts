import type { DailyRecommendation } from '../engine/models';
import type { ExternalPlanOccurrenceRef, SessionEntry, SessionExecution, SessionOccurrence } from '../sessions/models';
import { isExternalPlanOccurrence } from '../sessions/models';
import type { PerformedTrainingOccurrence } from './models';

export type PlannedExecutionStatus = {
    date: string;
    authored:
        | { kind: 'session'; source: ExternalPlanOccurrenceRef }
        | { kind: 'rest'; planId: string; revision: number; restDirectiveId: string }
        | { kind: 'none' }
        | { kind: 'unknown'; reason: string };
    placement: 'as_authored' | 'intentionally_moved' | 'unknown';
    adjudication: 'as_authored' | 'app_dose_modified' | 'gate_replaced' | 'not_adjudicated' | 'unknown';
    athleteDisposition: 'accepted' | 'manually_replaced' | 'explicitly_skipped' | 'none' | 'unknown';
    performance: 'completed' | 'partial_or_abandoned' | 'none_observed' | 'not_applicable' | 'unknown';
    occurrenceId?: string;
    performedOccurrenceId?: string;
    executionId?: string;
    prescriptionHash?: string;
    evidence: string[];
};

export interface PlannedExecutionStatusInput {
    date: string;
    authored: PlannedExecutionStatus['authored'];
    authoredDate?: string;
    placementConfirmedMoved?: boolean;
    occurrenceId?: string;
    occurrencesReadable: boolean;
    executionsReadable: boolean;
    performedReadable: boolean;
    occurrences: readonly SessionOccurrence[];
    recommendations: readonly DailyRecommendation[];
    executions: readonly { execution: SessionExecution; entries: readonly SessionEntry[] }[];
    performedOccurrences: readonly PerformedTrainingOccurrence[];
}

function sameSource(left: ExternalPlanOccurrenceRef, right: ExternalPlanOccurrenceRef): boolean {
    return left.planId === right.planId && left.revision === right.revision
        && left.sessionId === right.sessionId && left.contentHash === right.contentHash;
}

function sourceOfOccurrence(occurrence: SessionOccurrence | undefined): ExternalPlanOccurrenceRef | undefined {
    return occurrence && isExternalPlanOccurrence(occurrence) ? occurrence.externalPlanRef : undefined;
}

/** Exact-identity projection for #893 and reusable by broader execution reconciliation. */
export function projectPlannedExecutionStatus(input: PlannedExecutionStatusInput): PlannedExecutionStatus {
    const authoredSource = input.authored.kind === 'session' ? input.authored.source : undefined;
    const unknown = input.authored.kind === 'unknown' || !input.occurrencesReadable
        || !input.executionsReadable || !input.performedReadable;
    const occurrence = input.occurrenceId
        ? input.occurrences.find(item => item.occurrenceId === input.occurrenceId && item.date === input.date)
        : authoredSource
            ? input.occurrences.find(item => isExternalPlanOccurrence(item)
                && sameSource(item.externalPlanRef, authoredSource) && item.date === input.date)
            : undefined;
    const source = authoredSource;
    const occurrenceSource = sourceOfOccurrence(occurrence);
    const exactOccurrence = source && occurrenceSource && sameSource(source, occurrenceSource) ? occurrence : undefined;
    const executionRecord = exactOccurrence && source
        ? input.executions.find(item => item.execution.occurrenceId === exactOccurrence.occurrenceId
            && item.execution.sessionSource.kind === 'external_plan'
            && sameSource(item.execution.sessionSource, source))
        : undefined;
    const execution = executionRecord?.execution;
    const recommendation = source
        ? input.recommendations.find(item => item.date === input.date
            && item.recommendationAudit?.externalPlan !== undefined
            && sameSource(item.recommendationAudit.externalPlan, source))
        : undefined;
    const performed = execution
        ? input.performedOccurrences.find(item => item.status === 'active'
            && item.sourceRefs.some(ref => ref.kind === 'structured_execution'
                && ref.executionId === execution.executionId
                && (ref.sessionOccurrenceId === undefined || ref.sessionOccurrenceId === exactOccurrence?.occurrenceId)
                && (ref.prescriptionHash === undefined || ref.prescriptionHash === execution.prescriptionHash)))
        : undefined;

    const primarySession = recommendation?.recommendationAudit?.primarySession;
    const primarySource = primarySession?.sessionSource;
    const exactPrimary = exactOccurrence !== undefined && Boolean(primarySession?.occurrenceId)
        && primarySource?.kind === 'external_plan' && source !== undefined
        && sameSource(primarySource, source) && primarySession?.occurrenceId === exactOccurrence?.occurrenceId
        && (!execution?.prescriptionHash || primarySession?.prescriptionHash === execution.prescriptionHash);
    const auditedScale = recommendation?.recommendationAudit?.plannedDose !== undefined
        && recommendation.recommendationAudit.executionDose !== undefined
        && (recommendation.recommendationAudit.plannedDose.volume !== recommendation.recommendationAudit.executionDose.volume
            || recommendation.recommendationAudit.plannedDose.intensity !== recommendation.recommendationAudit.executionDose.intensity);
    return {
        date: input.date,
        authored: input.authored,
        placement: unknown || !source || !input.authoredDate
            ? 'unknown'
            : input.date !== input.authoredDate
                ? input.placementConfirmedMoved ? 'intentionally_moved' : 'unknown'
                : exactOccurrence ? 'as_authored' : 'unknown',
        adjudication: unknown ? 'unknown'
            : !recommendation ? 'not_adjudicated'
                : !exactPrimary ? 'unknown' : auditedScale ? 'app_dose_modified' : 'as_authored',
        athleteDisposition: unknown ? 'unknown'
            : exactOccurrence?.state === 'skipped' ? 'explicitly_skipped'
                : exactOccurrence?.state === 'superseded' ? 'unknown'
                    : exactOccurrence?.state === 'completed' || execution ? 'accepted' : 'none',
        performance: unknown ? 'unknown'
            : input.authored.kind === 'rest' || input.authored.kind === 'none' ? 'not_applicable'
                : execution?.state === 'completed' ? performed ? 'completed' : 'unknown'
                    : execution?.state === 'abandoned' || (execution?.state === 'in_progress' && (executionRecord?.entries.length ?? 0) > 0) ? 'partial_or_abandoned'
                        : exactOccurrence?.state === 'missed' || exactOccurrence?.state === 'skipped'
                            ? 'none_observed' : 'unknown',
        ...(exactOccurrence ? { occurrenceId: exactOccurrence.occurrenceId } : {}),
        ...(performed ? { performedOccurrenceId: performed.performedOccurrenceId } : {}),
        ...(execution ? { executionId: execution.executionId } : {}),
        ...(execution?.prescriptionHash ? { prescriptionHash: execution.prescriptionHash } : {}),
        evidence: [
            ...(exactOccurrence ? [`occurrence:${exactOccurrence.occurrenceId}`] : []),
            ...(recommendation ? [`recommendation:${recommendation.date}`] : []),
            ...(execution ? [`execution:${execution.executionId}`] : []),
        ...(performed ? [`performed:${performed.performedOccurrenceId}`] : []),
        ...(input.authored.kind === 'rest' || input.authored.kind === 'none'
            ? input.performedOccurrences.filter(item => item.status === 'active' && item.localDate === input.date)
                .map(item => `observed-work:${item.performedOccurrenceId}`)
            : []),
        ...(unknown ? ['one or more source reads unavailable or authored identity unknown'] : []),
        ],
    };
}

export function renderPlannedExecutionStatuses(
    statuses: readonly PlannedExecutionStatus[] | null | undefined,
    heading = '## External-plan execution round trip',
): string[] {
    if (statuses === undefined) return [];
    if (statuses === null) return [heading, '', 'Round-trip records are unknown because one or more sources could not be read.'];
    if (statuses.length === 0) return [heading, '', 'No exact external-plan occurrence records were available in this window. Missing activity is not treated as a missed session.'];
    const label = (value: string) => value.replaceAll('_', ' ');
    const rows = [...statuses]
        .sort((left, right) => left.date.localeCompare(right.date)
            || (left.authored.kind === 'session' && right.authored.kind === 'session'
                ? left.authored.source.sessionId.localeCompare(right.authored.source.sessionId)
                : left.authored.kind.localeCompare(right.authored.kind))
            || (left.occurrenceId ?? '').localeCompare(right.occurrenceId ?? ''))
        .slice(0, 20)
        .map(status => {
            const authored = status.authored.kind === 'session'
                ? `${status.authored.source.planId} r${status.authored.source.revision}/${status.authored.source.sessionId}`
                : status.authored.kind === 'rest'
                    ? `${status.authored.planId} r${status.authored.revision} rest/${status.authored.restDirectiveId}`
                    : status.authored.kind;
            const unexpectedWork = status.evidence.filter(item => item.startsWith('observed-work:'));
            const workNote = unexpectedWork.length > 0 ? ` Authored rest/no session; observed work: ${unexpectedWork.map(item => item.slice('observed-work:'.length)).join(', ')}.` : '';
            const provenance = [status.occurrenceId && `occurrence ${status.occurrenceId}`, status.executionId && `execution ${status.executionId}`, status.performedOccurrenceId && `performed ${status.performedOccurrenceId}`, status.prescriptionHash && `prescription ${status.prescriptionHash}`].filter(Boolean).join('; ');
            return `- ${status.date} ${authored}: placement ${label(status.placement)}; adjudication ${label(status.adjudication)}; athlete ${label(status.athleteDisposition)}; performance ${label(status.performance)}${provenance ? `; ${provenance}` : ''}.${workNote}`;
        });
    if (statuses.length > 20) rows.push(`- ${statuses.length - 20} additional records omitted from this bounded section.`);
    return [heading, '', ...rows];
}
