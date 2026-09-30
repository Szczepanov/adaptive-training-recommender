import type { DailyRecommendationWithVerdict } from '../engine/models';
import { getCanonicalRestTemplate } from '../engine/rules';
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
    recommendations: readonly DailyRecommendationWithVerdict[];
    executions: readonly { execution: SessionExecution; entries: readonly SessionEntry[] }[];
    performedOccurrences: readonly PerformedTrainingOccurrence[];
    /** PR-C M-0: authored session candidates on D, counted by hydration from the
     * archive-named revision (never today's active plan). Absent when no count
     * was computed; a missing count yields `unknown`, never "treat as one". */
    authoredSessionCountOnDate?: number;
    /** PR-C M-1/M-5/M-6: the `occurrenceId` from a same-date
     * `audit.authoredOccurrence`, attributed by hydration to the verified
     * pre-replace identity only. Set on exactly one candidate per replace day:
     * the archived revision's row. Absent everywhere else, including the
     * current revision's row on re-import days (M-6b). */
    replacedByOccurrenceId?: string;
    /** PR-C M-8: hydration could not verify what a same-date replace decision
     * replaced (archive listing failed, unparsable, or failed M-7). The row
     * degrades to `unknown` with a `replace-archive-unavailable` evidence note
     * instead of guessing -- set only when no verified attribution exists. */
    replaceArchiveUnavailable?: boolean;
}

function sameSource(left: ExternalPlanOccurrenceRef, right: ExternalPlanOccurrenceRef): boolean {
    return left.planId === right.planId && left.revision === right.revision
        && left.sessionId === right.sessionId && left.contentHash === right.contentHash;
}

function sourceOfOccurrence(occurrence: SessionOccurrence | undefined): ExternalPlanOccurrenceRef | undefined {
    return occurrence && isExternalPlanOccurrence(occurrence) ? occurrence.externalPlanRef : undefined;
}

/** Exact-identity projection for #893 and reusable by broader execution reconciliation.
 *
 * Pure by construction: every input (including `authoredSessionCountOnDate` and
 * `replacedByOccurrenceId`) is caller-supplied data. No Firestore, no clock, no
 * title matching, no mode-fallback verdict, no historical-readiness rerun. The
 * only reads beyond these inputs happen at the hydration boundary
 * (`contextBriefService.ts`), which loads the pre-replace archive revision. */
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
    // PR-C G-1: the adjudicator's exact persisted decision, read from the saved
    // `engineVerdict` field only. Never the `resolveEngineShadowVerdict(mode)`
    // legacy fallback: it maps `recover` to `defer` and would fabricate gate
    // replacements on pre-verdict documents (G-1b). `advisory` event days and
    // `proceed`/`scale` are excluded by construction (G-2 keeps withheld scale,
    // binding failures and future non-rest shapes at `unknown`).
    const verdict = recommendation?.engineVerdict;
    const gatedVerdict = verdict === 'defer' || verdict === 'skip';
    const restTemplate = recommendation !== undefined
        && recommendation.templateId === getCanonicalRestTemplate().id;
    const gateReplaced = recommendation !== undefined && gatedVerdict && restTemplate;
    // `advisory` is not an adjudicated executable outcome. Keep it unknown even
    // when an exact primary binding happens to exist (for example on an event-day
    // recommendation), rather than falling through to `as_authored`.
    const unsupportedVerdict = verdict === 'advisory';
    const verdictTemplateDisagree = recommendation !== undefined && gatedVerdict !== restTemplate;
    // PR-C M-1/M-4/M-6: a same-date `audit.authoredOccurrence` attributed to this
    // candidate's verified pre-replace identity. Set by hydration on exactly one
    // row per replace day, so sibling-revision rows keep their normal result.
    const replaceAttribution = source !== undefined && input.replacedByOccurrenceId !== undefined
        ? input.replacedByOccurrenceId
        : undefined;
    // M-1: exactly one authored candidate on D (counted from the archive-named
    // revision), a saved replace decision, and no exact external execution. An
    // execution of the authored occurrence itself always wins over the replace
    // label: the replacement workout is a different identity and must never
    // flip this back, nor may this label ever claim `completed` (M-2).
    const manuallyReplaced = replaceAttribution !== undefined
        && input.authoredSessionCountOnDate === 1
        && executionRecord === undefined;
    // M-1 singleton scope: on multi-candidate days (or a missing count) the
    // saved recommendation cannot say which session was primary, so the athlete
    // dimension stays `unknown` rather than guessing.
    const replaceBlocksNormalAthlete = replaceAttribution !== undefined
        && (input.authoredSessionCountOnDate !== 1 || executionRecord === undefined);
    return {
        date: input.date,
        authored: input.authored,
        placement: unknown || !source || !input.authoredDate
            ? 'unknown'
            : input.date !== input.authoredDate
                ? input.placementConfirmedMoved ? 'intentionally_moved' : 'unknown'
                : exactOccurrence ? 'as_authored' : 'unknown',
        adjudication: unknown ? 'unknown'
            : !recommendation
                // M-4: the lookup finds no matching `audit.externalPlan`, but a
                // decision was saved and later overwritten (the archive keeps the
                // earlier audit). `not_adjudicated` would claim no decision exists.
                // M-8: an unverifiable replace degrades the same way, with a note.
                ? (replaceAttribution !== undefined || input.replaceArchiveUnavailable ? 'unknown' : 'not_adjudicated')
                // G-3: `gate_replaced` describes the latest persisted decision on
                // D, independent of execution: a gated day with an exact completed
                // execution still reads `gate_replaced` here, with acceptance and
                // completion carried by the other two dimensions.
                : gateReplaced ? 'gate_replaced'
                    : unsupportedVerdict || verdictTemplateDisagree ? 'unknown'
                        : !exactPrimary ? 'unknown' : auditedScale ? 'app_dose_modified' : 'as_authored',
        athleteDisposition: unknown ? 'unknown'
            : exactOccurrence?.state === 'skipped' ? 'explicitly_skipped'
                : exactOccurrence?.state === 'superseded' ? 'unknown'
                    : manuallyReplaced ? 'manually_replaced'
                        : replaceBlocksNormalAthlete ? 'unknown'
                            : exactOccurrence?.state === 'completed' || execution ? 'accepted'
                                // M-8: a known replace means `none` would misstate
                                // the day; identity-bound execution still stands.
                                : input.replaceArchiveUnavailable ? 'unknown' : 'none',
        performance: unknown ? 'unknown'
            : input.authored.kind === 'rest' || input.authored.kind === 'none' ? 'not_applicable'
                // M-2: the replacement workout is not the authored session's
                // completion. `none_observed` only on an explicit terminal
                // no-performance state of the authored occurrence, else `unknown`.
                : manuallyReplaced
                    ? (exactOccurrence?.state === 'missed' || exactOccurrence?.state === 'skipped' ? 'none_observed' : 'unknown')
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
            // M-4: the row is auditable without claiming completion — the
            // decision that was overwritten plus the manual authority.
            ...(replaceAttribution !== undefined
                ? [`recommendation:${input.date}`, `replaced-by:${replaceAttribution}`]
                : []),
            // M-8: row-scoped archive failure marker; never a section-wide null.
            ...(replaceAttribution === undefined && input.replaceArchiveUnavailable
                ? ['replace-archive-unavailable']
                : []),
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

const ROUND_TRIP_MAX_ROWS = 20;
const ROUND_TRIP_MAX_IDENTIFIER_CHARS = 96;
const ROUND_TRIP_IDENTIFIER_PREFIX_CHARS = 64;
const ROUND_TRIP_IDENTIFIER_SUFFIX_CHARS = ROUND_TRIP_MAX_IDENTIFIER_CHARS - ROUND_TRIP_IDENTIFIER_PREFIX_CHARS - 1;
const ROUND_TRIP_MAX_OBSERVED_WORK_IDS = 5;

function renderRoundTripIdentifier(value: string): string {
    const oneLine = value.replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim();
    if (oneLine.length <= ROUND_TRIP_MAX_IDENTIFIER_CHARS) return oneLine;
    return `${oneLine.slice(0, ROUND_TRIP_IDENTIFIER_PREFIX_CHARS)}…${oneLine.slice(-ROUND_TRIP_IDENTIFIER_SUFFIX_CHARS)}`;
}

function plannedExecutionStatusSortKey(status: PlannedExecutionStatus): string {
    const authored = status.authored.kind === 'session'
        ? ['session', status.authored.source.planId, String(status.authored.source.revision).padStart(10, '0'),
            status.authored.source.sessionId, status.authored.source.contentHash].join('\u0001')
        : status.authored.kind === 'rest'
            ? ['rest', status.authored.planId, String(status.authored.revision).padStart(10, '0'),
                status.authored.restDirectiveId].join('\u0001')
            : status.authored.kind === 'unknown'
                ? ['unknown', status.authored.reason].join('\u0001')
                : 'none';
    return [
        status.date,
        authored,
        status.occurrenceId ?? '',
        status.executionId ?? '',
        status.performedOccurrenceId ?? '',
        status.prescriptionHash ?? '',
        [...status.evidence].sort().join('\u0001'),
    ].join('\u0000');
}

export function renderPlannedExecutionStatuses(
    statuses: readonly PlannedExecutionStatus[] | null | undefined,
    heading = '## External-plan execution round trip',
): string[] {
    if (statuses === undefined) return [];
    if (statuses === null) return [heading, '', 'Round-trip records are unknown because one or more sources could not be read.'];
    if (statuses.length === 0) return [heading, '', 'No exact external-plan occurrence records were available in this window. Missing activity is not treated as a missed session.'];
    const label = (value: string) => value.replaceAll('_', ' ');
    const sorted = [...statuses].sort((left, right) =>
        plannedExecutionStatusSortKey(left).localeCompare(plannedExecutionStatusSortKey(right)));
    // A planning handoff prioritizes the most recent records while preserving
    // chronological display. Per-row identifiers and observed-work detail are
    // bounded below so the section remains finite even with malformed/legacy data.
    const visible = sorted.length > ROUND_TRIP_MAX_ROWS
        ? sorted.slice(sorted.length - ROUND_TRIP_MAX_ROWS)
        : sorted;
    const rows = visible.map(status => {
        const authored = status.authored.kind === 'session'
            ? `${renderRoundTripIdentifier(status.authored.source.planId)} r${status.authored.source.revision}/${renderRoundTripIdentifier(status.authored.source.sessionId)}`
            : status.authored.kind === 'rest'
                ? `${renderRoundTripIdentifier(status.authored.planId)} r${status.authored.revision} rest/${renderRoundTripIdentifier(status.authored.restDirectiveId)}`
                : status.authored.kind;
        const observedWorkIds = [...new Set(status.evidence
            .filter(item => item.startsWith('observed-work:'))
            .map(item => item.slice('observed-work:'.length)))]
            .sort();
        const visibleObservedWork = observedWorkIds
            .slice(0, ROUND_TRIP_MAX_OBSERVED_WORK_IDS)
            .map(renderRoundTripIdentifier);
        const omittedObservedWork = observedWorkIds.length - visibleObservedWork.length;
        const workNote = visibleObservedWork.length > 0
            ? ` Authored rest/no session; observed work: ${visibleObservedWork.join(', ')}${omittedObservedWork > 0
                ? `; ${omittedObservedWork} additional observed-work ids omitted`
                : ''}.`
            : '';
        const replacedBy = [...new Set(status.evidence
            .filter(item => item.startsWith('replaced-by:'))
            .map(item => item.slice('replaced-by:'.length)))]
            .sort()
            .map(item => `replaced by occurrence ${renderRoundTripIdentifier(item)}`);
        const archiveFailure = status.evidence.includes('replace-archive-unavailable')
            ? ['replacement source unavailable (archive read failed)']
            : [];
        const provenance = [
            status.occurrenceId && `occurrence ${renderRoundTripIdentifier(status.occurrenceId)}`,
            status.executionId && `execution ${renderRoundTripIdentifier(status.executionId)}`,
            status.performedOccurrenceId && `performed ${renderRoundTripIdentifier(status.performedOccurrenceId)}`,
            status.prescriptionHash && `prescription ${renderRoundTripIdentifier(status.prescriptionHash)}`,
            ...replacedBy,
            ...archiveFailure,
        ].filter((item): item is string => typeof item === 'string').join('; ');
        return `- ${status.date} ${authored}: placement ${label(status.placement)}; adjudication ${label(status.adjudication)}; athlete ${label(status.athleteDisposition)}; performance ${label(status.performance)}${provenance ? `; ${provenance}` : ''}.${workNote}`;
    });
    if (statuses.length > ROUND_TRIP_MAX_ROWS) {
        rows.push(`- ${statuses.length - ROUND_TRIP_MAX_ROWS} earlier records omitted from this bounded section.`);
    }
    return [heading, '', ...rows];
}
