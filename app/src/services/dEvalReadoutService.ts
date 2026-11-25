/**
 * Strictly read-only ADR-0052 D-EVAL readout service (#1284, #962).
 *
 * Fetches bounded user-scoped records from Firestore, verifies external-plan content hashes,
 * assembles `DEvalBlockInput` (`assembleDEvalBlockInput`), evaluates C1-C4 (`evaluateDEvalBlock`),
 * and renders the §7 Markdown report (`renderDEvalResultMarkdown`). Never writes or migrates data.
 */

import { computeContentHash } from '../engine/externalPlanHash';
import type { DataState } from '../engine/dataState';
import { impliedDate } from '../engine/externalPlacement';
import {
    assembleDEvalBlockInput,
    type DEvalRawExecution,
    type DEvalRawLedgerData,
    type DEvalRawPlanIssue,
    type DEvalRawPlanRevision,
    type DEvalRawPlacementOverlay,
    type DEvalSourceReadState,
} from '../derived/eval/dEvalAssembly';
import { classifyObservationTimestampAtCutoff } from '../derived/eval/dEvalC2';
import {
    DEVAL_GOAL_BOUND_PROTOCOLS,
    DEVAL_MIN_BLOCK_DAYS,
    isLocalCalendarDate,
    parseUtcTimestampMs,
} from '../derived/eval/dEvalCriteria';
import {
    evaluateDEvalBlock,
    renderDEvalResultMarkdown,
    type DEvalBlockInput,
    type DEvalBlockResult,
    type DEvalRollbackUsage,
} from '../derived/eval/dEvalReadout';
import type { DEvalC3InjuryInput } from '../derived/eval/dEvalC3';
import { PLACEMENT_HISTORY_TRUNCATED_OPERATION, type PlacementEvent } from '../ledger/placementHistory';
import type { AssessmentAttempt, MetricObservationRevision } from '../observations/models';
import type { AnyExternalTrainingPlan } from '../sessions/externalPlanV2';
import { PHYSICAL_CAPITAL_PROTOCOL_REVISIONS } from '../observations/physicalCapitalProtocols';
import type { CurrentObservation } from '../observations/progress';
import { addDaysToLocalDateString, getLocalDateString } from '../utils/localDate';
import { planEndDate } from './activeExternalPlanService';
import { activityOverrideService, type ActivityOverrideService } from './activityOverrideService';
import { activityService, type ActivityService } from './activityService';
import { assessmentAttemptService, type AssessmentAttemptService } from './assessmentAttemptService';
import { checkinService, type CheckinService } from './checkinService';
import { externalPlanService, type ExternalPlanService } from './externalPlanService';
import { flagEvaluationRepository } from './flagEvaluationPersistence';
import { healthAnomalyOutcomeRepository, type HealthAnomalyOutcomeRepository } from './healthAnomalyOutcomeService';
import { metricObservationService, type MetricObservationService } from './metricObservationService';
import { preferencesService, type PreferencesService } from './preferencesService';
import {
    performedTrainingOccurrenceRepository,
    type PerformedTrainingOccurrenceRepository,
} from '../training-occurrence/repository';
import { sessionExecutionService, type SessionExecutionService } from './sessionExecutionService';
import { sessionResponseService, type SessionResponseService } from './sessionResponseService';
import { trainingSettingsService, type TrainingSettingsService } from './trainingSettingsService';

export const EXECUTION_HEADER_MAX_RECORDS = 1000;
export const ASSESSMENT_ATTEMPT_MAX_RECORDS = 500;
export const HEALTH_ANOMALY_OUTCOME_MAX_RECORDS = 500;
export const OBSERVATION_HISTORY_READ_CONCURRENCY = 4;

async function mapWithConcurrency<T, R>(
    items: readonly T[],
    concurrency: number,
    fn: (item: T) => Promise<R>,
): Promise<R[]> {
    const results = new Array<R>(items.length);
    let nextIndex = 0;
    const workerCount = Math.min(Math.max(1, concurrency), items.length);
    await Promise.all(Array.from({ length: workerCount }, async () => {
        while (nextIndex < items.length) {
            const index = nextIndex;
            nextIndex += 1;
            results[index] = await fn(items[index]!);
        }
    }));
    return results;
}

export interface DEvalReadoutRequest {
    blockStartDate: string;
    blockEndDate: string;
    asOfDate: string;
    asOfTimestamp?: string | null;
    includeBaseline?: boolean;
    criteriaCommit?: string | null;
    phase2Commit?: string | null;
    rollbackState: DEvalRollbackUsage;
    rollbackReason?: string | null;
    rollbackAtDate?: string | null;
}

export interface DEvalReadoutOutput {
    input: DEvalBlockInput;
    result: DEvalBlockResult;
    markdown: string;
}

export interface DEvalReadoutDependencies {
    flags: Pick<typeof flagEvaluationRepository, 'getInRangeState'>;
    checkins: Pick<CheckinService, 'getCheckinsInRangeState'>;
    occurrences: Pick<PerformedTrainingOccurrenceRepository, 'queryActiveInDateWindow'>;
    executions: Pick<SessionExecutionService, 'getExecutionHeadersInRange'>;
    responses: Pick<SessionResponseService, 'getResponsesInRangeState'>;
    activities: Pick<ActivityService, 'getActivitiesInRange'>;
    activityOverrides: Pick<ActivityOverrideService, 'getOverridesSinceState'>;
    trainingSettings: Pick<TrainingSettingsService, 'peekTrainingSettingsState'>;
    preferences: Pick<PreferencesService, 'getPreferencesState'>;
    healthAnomalyOutcomes: Pick<HealthAnomalyOutcomeRepository, 'listForUserWithDiagnostics'>;
    externalPlans: Pick<
        ExternalPlanService,
        'listPlanIds' | 'getHeaderState' | 'getActivationState' | 'getPlacementState' | 'getPlacementHistoryState' | 'getRevisionState'
    >;
    attempts: Pick<AssessmentAttemptService, 'listAttemptsForProtocolWithDiagnostics'>;
    observations: Pick<
        MetricObservationService,
        'listCurrentObservationsForMetricWithDiagnostics' | 'listRevisionsForObservationWithDiagnostics'
    >;
}

const DEFAULT_DEPS: DEvalReadoutDependencies = {
    flags: flagEvaluationRepository,
    checkins: checkinService,
    occurrences: performedTrainingOccurrenceRepository,
    executions: sessionExecutionService,
    responses: sessionResponseService,
    activities: activityService,
    activityOverrides: activityOverrideService,
    trainingSettings: trainingSettingsService,
    preferences: preferencesService,
    healthAnomalyOutcomes: healthAnomalyOutcomeRepository,
    externalPlans: externalPlanService,
    attempts: assessmentAttemptService,
    observations: metricObservationService,
};

function stateFromDataState<T>(result: DataState<T>): DEvalSourceReadState {
    if (result.status === 'AVAILABLE') return 'measured';
    if (result.status === 'MISSING') return 'missing';
    if (result.status === 'INVALID') return 'invalid';
    return 'unavailable';
}

function minDate(a: string, b: string): string {
    return a <= b ? a : b;
}

function goalBoundMetricIds(): string[] {
    const selectedIds = new Set(DEVAL_GOAL_BOUND_PROTOCOLS.map(p => p.protocolId));
    const historicalMetrics = PHYSICAL_CAPITAL_PROTOCOL_REVISIONS
        .filter(protocol => selectedIds.has(protocol.id))
        .flatMap(protocol => protocol.metricIds);
    return [...new Set([
        ...DEVAL_GOAL_BOUND_PROTOCOLS.flatMap(protocol => protocol.metricIds),
        ...historicalMetrics,
    ])];
}

export class DEvalReadoutService {
    private readonly deps: DEvalReadoutDependencies;
    private readonly today: () => string;

    constructor(deps: DEvalReadoutDependencies = DEFAULT_DEPS, today: () => string = () => getLocalDateString()) {
        this.deps = deps;
        this.today = today;
    }

    async run(userId: string, request: DEvalReadoutRequest): Promise<DEvalReadoutOutput> {
        if (!userId.trim() || userId.includes('/')) {
            throw new Error('A user-scoped D-EVAL readout requires a valid user id');
        }
        if (
            !isLocalCalendarDate(request.blockStartDate)
            || !isLocalCalendarDate(request.blockEndDate)
            || !isLocalCalendarDate(request.asOfDate)
            || request.blockStartDate > request.blockEndDate
        ) {
            throw new Error('Invalid D-EVAL calendar dates or blockStartDate > blockEndDate');
        }
        if (request.asOfDate > this.today()) {
            throw new Error('The D-EVAL as-of date cannot be in the future');
        }
        if (request.asOfTimestamp != null) {
            const asOfMs = parseUtcTimestampMs(request.asOfTimestamp);
            if (asOfMs === null) {
                throw new Error('Invalid D-EVAL asOfTimestamp; expected an ISO-8601 timestamp with UTC offset');
            }
            if (getLocalDateString(new Date(asOfMs)) !== request.asOfDate) {
                throw new Error('D-EVAL asOfTimestamp must fall on the same Europe/Warsaw calendar date as asOfDate');
            }
        }

        const baselineStart = addDaysToLocalDateString(request.blockStartDate, -DEVAL_MIN_BLOCK_DAYS);
        const effectiveBlockEnd = minDate(request.blockEndDate, request.asOfDate);
        const perfStart = addDaysToLocalDateString(baselineStart, -1);
        const c3EndInclusive = minDate(request.asOfDate, addDaysToLocalDateString(request.blockEndDate, 4));
        const perfThrough = addDaysToLocalDateString(c3EndInclusive, 1);

        const [
            flagsRead,
            checkinsRead,
            occurrencesRead,
            executionsRead,
            responsesRead,
            activitiesRead,
            overridesRead,
            settingsRead,
            preferencesRead,
            outcomesRead,
            assessmentsRead,
        ] = await Promise.all([
            effectiveBlockEnd >= baselineStart
                ? this.deps.flags.getInRangeState(userId, baselineStart, effectiveBlockEnd)
                    .catch((): DataState<never> => ({ status: 'UNAVAILABLE', operation: 'read flags', retryable: true }))
                : Promise.resolve<DataState<[]>>({ status: 'AVAILABLE', data: [], revision: '0' }),
            c3EndInclusive >= baselineStart
                ? this.deps.checkins.getCheckinsInRangeState(userId, baselineStart, addDaysToLocalDateString(c3EndInclusive, 1))
                    .catch((): DataState<never> => ({ status: 'UNAVAILABLE', operation: 'read checkins', retryable: true }))
                : Promise.resolve<DataState<[]>>({ status: 'AVAILABLE', data: [], revision: null }),
            c3EndInclusive >= perfStart
                ? this.deps.occurrences.queryActiveInDateWindow(userId, perfStart, c3EndInclusive)
                    .then(data => ({ ok: true as const, data }))
                    .catch(() => ({ ok: false as const, data: [] }))
                : Promise.resolve({ ok: true as const, data: [] }),
            c3EndInclusive >= perfStart
                ? this.deps.executions.getExecutionHeadersInRange(userId, perfStart, perfThrough, EXECUTION_HEADER_MAX_RECORDS)
                    .then(res => ({ ok: true as const, ...res }))
                    .catch(() => ({ ok: false as const, executions: [], invalidRecords: 0, truncated: false }))
                : Promise.resolve({ ok: true as const, executions: [], invalidRecords: 0, truncated: false }),
            c3EndInclusive >= perfStart
                ? this.deps.responses.getResponsesInRangeState(userId, perfStart, perfThrough)
                    .catch((): DataState<never> => ({ status: 'UNAVAILABLE', operation: 'read responses', retryable: true }))
                : Promise.resolve<DataState<[]>>({ status: 'AVAILABLE', data: [], revision: null }),
            effectiveBlockEnd >= request.blockStartDate
                ? this.deps.activities.getActivitiesInRange(userId, request.blockStartDate, addDaysToLocalDateString(effectiveBlockEnd, 1))
                    .catch((): DataState<never> => ({ status: 'UNAVAILABLE', operation: 'read activities', retryable: true }))
                : Promise.resolve<DataState<[]>>({ status: 'AVAILABLE', data: [], revision: null }),
            effectiveBlockEnd >= request.blockStartDate
                ? this.deps.activityOverrides.getOverridesSinceState(userId, request.blockStartDate, effectiveBlockEnd)
                    .catch((): DataState<never> => ({ status: 'UNAVAILABLE', operation: 'read overrides', retryable: true }))
                : Promise.resolve<DataState<Record<string, never>>>({ status: 'AVAILABLE', data: {}, revision: null }),
            this.deps.trainingSettings.peekTrainingSettingsState(userId)
                .catch((): DataState<never> => ({ status: 'UNAVAILABLE', operation: 'read training settings', retryable: true })),
            this.deps.preferences.getPreferencesState(userId)
                .catch((): DataState<never> => ({ status: 'UNAVAILABLE', operation: 'read preferences', retryable: true })),
            this.deps.healthAnomalyOutcomes.listForUserWithDiagnostics(userId, HEALTH_ANOMALY_OUTCOME_MAX_RECORDS)
                .then(res => ({ ok: true as const, ...res }))
                .catch(() => ({ ok: false as const, outcomes: [], unreadableCount: 0, truncated: false })),
            this.readAssessments(userId, request.asOfDate, request.asOfTimestamp ?? null),
        ]);

        const rawExecutions: DEvalRawExecution[] = executionsRead.executions.map(exec => ({
            executionId: exec.executionId,
            state: exec.state,
            date: exec.date,
            startedAt: exec.startedAt,
            completedAt: exec.completedAt,
            executedDefinition: exec.executedDefinition,
            completionEvidence: exec.completionEvidence
                ? { completedFraction: exec.completionEvidence.completedFraction }
                : undefined,
            sessionSource: exec.sessionSource,
        }));

        const plansRead = await this.readPlans(userId, rawExecutions, perfStart, c3EndInclusive);

        const checkinsHasIssues = checkinsRead.status === 'AVAILABLE' && Boolean(checkinsRead.issues?.length);
        const checkinsState: DEvalSourceReadState = checkinsHasIssues
            ? 'invalid'
            : stateFromDataState(checkinsRead);

        const overridesHaveIssues = overridesRead.status === 'AVAILABLE' && Boolean(overridesRead.issues?.length);

        const executionsState: DEvalSourceReadState = !executionsRead.ok
            ? 'unavailable'
            : executionsRead.invalidRecords > 0
                ? 'invalid'
                : executionsRead.truncated
                    ? 'unavailable'
                    : 'measured';

        const healthAnomalyOutcomesState: DEvalSourceReadState = !outcomesRead.ok || outcomesRead.truncated
            ? 'unavailable'
            : outcomesRead.unreadableCount > 0
                ? 'invalid'
                : 'measured';

        const injuries: DEvalC3InjuryInput[] = settingsRead.status === 'AVAILABLE'
            ? [...(settingsRead.data.injuries ?? []), ...(settingsRead.data.injuryHistory ?? [])]
            : [];

        const raw: DEvalRawLedgerData = {
            externalPlansState: plansRead.state,
            planRevisions: plansRead.planRevisions,
            placements: plansRead.placements,
            placementHistory: plansRead.placementHistory,
            planIssues: plansRead.planIssues,

            occurrencesState: occurrencesRead.ok ? 'measured' : 'unavailable',
            performedOccurrences: occurrencesRead.data,
            executionsState,
            executions: rawExecutions,
            responsesState: stateFromDataState(responsesRead),
            responses: responsesRead.status === 'AVAILABLE' ? responsesRead.data : [],

            activitiesState: stateFromDataState(activitiesRead),
            activities: activitiesRead.status === 'AVAILABLE' ? activitiesRead.data : [],
            activityOverridesState: overridesHaveIssues ? 'invalid' : stateFromDataState(overridesRead),
            activityOverrides: overridesRead.status === 'AVAILABLE' ? overridesRead.data : {},

            flagEvaluationsState: stateFromDataState(flagsRead),
            flagEvaluations: flagsRead.status === 'AVAILABLE' ? flagsRead.data : [],

            checkinsState,
            checkins: checkinsRead.status === 'AVAILABLE' ? checkinsRead.data : [],
            trainingSettingsState: stateFromDataState(settingsRead),
            injuries,
            healthAnomalyOutcomesState,
            healthAnomalyOutcomes: outcomesRead.outcomes,

            observationsState: assessmentsRead.observationsState,
            observations: assessmentsRead.observations,
            unreadableObservationsCount: assessmentsRead.unreadableObservationsCount,
            incompleteObservationMetricIds: assessmentsRead.incompleteObservationMetricIds,
            attemptsState: assessmentsRead.attemptsState,
            attempts: assessmentsRead.attempts,
            unreadableAttemptsCount: assessmentsRead.unreadableAttemptsCount,
            attemptsTruncated: assessmentsRead.attemptsTruncated,

            preferencesState: stateFromDataState(preferencesRead),
            engineRecommendationsEnabled: preferencesRead.status === 'AVAILABLE'
                ? preferencesRead.data.engineRecommendationsEnabled ?? null
                : null,
        };

        const input = assembleDEvalBlockInput(raw, request);
        const result = evaluateDEvalBlock(input);
        const markdown = renderDEvalResultMarkdown(result);
        return { input, result, markdown };
    }

    private async resolveObservationAtCutoff(
        userId: string,
        obs: CurrentObservation,
        asOfDate: string,
        asOfMs: number | null,
    ): Promise<
        | { status: 'resolved'; observation: CurrentObservation }
        | { status: 'absent_at_cutoff' }
        | { status: 'incomplete'; failedRead: boolean; unreadableCount: number }
    > {
        const currentRel = classifyObservationTimestampAtCutoff(obs.revision.createdAt, asOfDate, asOfMs);
        if (currentRel === 'known') {
            return { status: 'resolved', observation: obs };
        }
        if (currentRel === 'invalid') {
            return { status: 'incomplete', failedRead: false, unreadableCount: 1 };
        }
        if (obs.head.headRevision === 1) {
            return { status: 'absent_at_cutoff' };
        }

        let historyRead: { revisions: MetricObservationRevision[]; unreadableCount: number };
        try {
            historyRead = await this.deps.observations.listRevisionsForObservationWithDiagnostics(
                userId,
                obs.head.observationKey,
            );
        } catch {
            return { status: 'incomplete', failedRead: true, unreadableCount: 0 };
        }

        if (historyRead.unreadableCount > 0) {
            return { status: 'incomplete', failedRead: false, unreadableCount: historyRead.unreadableCount };
        }

        const sorted = [...historyRead.revisions].sort((a, b) => a.revision - b.revision);
        if (sorted.length < obs.head.headRevision) {
            return { status: 'incomplete', failedRead: false, unreadableCount: 1 };
        }

        let prevMs = -Infinity;
        let selected: MetricObservationRevision | null = null;
        for (let i = 0; i < sorted.length; i += 1) {
            const rev = sorted[i]!;
            if (
                rev.revision !== i + 1
                || rev.observationKey !== obs.head.observationKey
                || rev.metricId !== obs.head.metricId
                || rev.assessmentAttemptId !== obs.head.assessmentAttemptId
            ) {
                return { status: 'incomplete', failedRead: false, unreadableCount: 1 };
            }
            const createdMs = parseUtcTimestampMs(rev.createdAt);
            if (createdMs === null || createdMs < prevMs) {
                return { status: 'incomplete', failedRead: false, unreadableCount: 1 };
            }
            prevMs = createdMs;
            if (classifyObservationTimestampAtCutoff(rev.createdAt, asOfDate, asOfMs) === 'known') {
                selected = rev;
            }
        }

        if (!selected) {
            return { status: 'absent_at_cutoff' };
        }

        return {
            status: 'resolved',
            observation: {
                head: {
                    ...obs.head,
                    headRevision: selected.revision,
                    updatedAt: selected.createdAt,
                },
                revision: selected,
            },
        };
    }

    private async readAssessments(
        userId: string,
        asOfDate: string,
        asOfTimestamp: string | null,
    ): Promise<{
        attemptsState: DEvalSourceReadState;
        attempts: AssessmentAttempt[];
        unreadableAttemptsCount: number;
        attemptsTruncated: boolean;
        observationsState: DEvalSourceReadState;
        observations: CurrentObservation[];
        unreadableObservationsCount: number;
        incompleteObservationMetricIds: string[];
    }> {
        const protocolIds = DEVAL_GOAL_BOUND_PROTOCOLS.map(protocol => protocol.protocolId);
        const selectedProtocolIds = new Set(protocolIds);
        const metricIds = goalBoundMetricIds();
        const asOfMs = parseUtcTimestampMs(asOfTimestamp);

        const [attemptResults, observationResults] = await Promise.all([
            Promise.all(
                protocolIds.map(protocolId =>
                    this.deps.attempts.listAttemptsForProtocolWithDiagnostics(
                        userId,
                        protocolId,
                        ASSESSMENT_ATTEMPT_MAX_RECORDS,
                    )
                        .then(res => ({ ok: true as const, ...res }))
                        .catch(() => ({ ok: false as const, attempts: [], unreadableCount: 0, truncated: false })),
                ),
            ),
            Promise.all(
                metricIds.map(metricId =>
                    this.deps.observations.listCurrentObservationsForMetricWithDiagnostics(userId, metricId)
                        .then(res => ({ ok: true as const, metricId, ...res }))
                        .catch(() => ({ ok: false as const, metricId, observations: [], unreadableCount: 0 })),
                ),
            ),
        ]);

        const attemptMap = new Map<string, AssessmentAttempt>();
        let unreadableAttemptsCount = 0;
        let attemptsTruncated = false;
        let attemptsFailed = false;
        for (const res of attemptResults) {
            if (!res.ok) {
                attemptsFailed = true;
                continue;
            }
            unreadableAttemptsCount += res.unreadableCount;
            if (res.truncated) attemptsTruncated = true;
            for (const attempt of res.attempts) {
                attemptMap.set(attempt.id, attempt);
            }
        }

        const obsMap = new Map<string, CurrentObservation>();
        const incompleteObservationMetricIds = new Set<string>();
        let unreadableObservationsCount = 0;
        let observationsFailed = false;
        for (const res of observationResults) {
            if (!res.ok) {
                observationsFailed = true;
                incompleteObservationMetricIds.add(res.metricId);
                continue;
            }
            unreadableObservationsCount += res.unreadableCount;
            if (res.unreadableCount > 0) {
                incompleteObservationMetricIds.add(res.metricId);
            }
            const relevantObs = res.observations.filter(obs => selectedProtocolIds.has(obs.revision.protocolRef.id));
            const resolvedObs = await mapWithConcurrency(
                relevantObs,
                OBSERVATION_HISTORY_READ_CONCURRENCY,
                obs => this.resolveObservationAtCutoff(userId, obs, asOfDate, asOfMs),
            );
            for (const outcome of resolvedObs) {
                if (outcome.status === 'resolved') {
                    obsMap.set(outcome.observation.revision.observationKey, outcome.observation);
                } else if (outcome.status === 'incomplete') {
                    if (outcome.failedRead) observationsFailed = true;
                    unreadableObservationsCount += outcome.unreadableCount;
                    incompleteObservationMetricIds.add(res.metricId);
                }
            }
        }

        const attemptsState: DEvalSourceReadState = attemptsFailed || attemptsTruncated
            ? 'unavailable'
            : unreadableAttemptsCount > 0
                ? 'invalid'
                : 'measured';

        const observationsState: DEvalSourceReadState = observationsFailed
            ? 'unavailable'
            : unreadableObservationsCount > 0
                ? 'invalid'
                : 'measured';

        return {
            attemptsState,
            attempts: [...attemptMap.values()],
            unreadableAttemptsCount,
            attemptsTruncated,
            observationsState,
            observations: [...obsMap.values()],
            unreadableObservationsCount,
            incompleteObservationMetricIds: [...incompleteObservationMetricIds].sort(),
        };
    }

    private async readPlans(
        userId: string,
        executions: readonly DEvalRawExecution[],
        windowStart: string,
        windowEnd: string,
    ): Promise<{
        state: DEvalSourceReadState;
        planRevisions: DEvalRawPlanRevision[];
        placements: DEvalRawPlacementOverlay[];
        placementHistory: PlacementEvent[];
        planIssues: DEvalRawPlanIssue[];
    }> {
        const planRevisions: DEvalRawPlanRevision[] = [];
        const placements: DEvalRawPlacementOverlay[] = [];
        const placementHistory: PlacementEvent[] = [];
        const planIssues: DEvalRawPlanIssue[] = [];
        let overallState: DEvalSourceReadState = 'measured';

        const mergeFailure = (status: 'INVALID' | 'UNAVAILABLE') => {
            if (status === 'INVALID') overallState = 'invalid';
            else if (overallState !== 'invalid') overallState = 'unavailable';
        };

        try {
            const ids = await this.deps.externalPlans.listPlanIds(userId);
            if (ids.status !== 'AVAILABLE') {
                return {
                    state: ids.status === 'INVALID' ? 'invalid' : 'unavailable',
                    planRevisions,
                    placements,
                    placementHistory,
                    planIssues,
                };
            }

            for (const planId of [...ids.data].sort()) {
                const [header, activations, legacy] = await Promise.all([
                    this.deps.externalPlans.getHeaderState(userId, planId),
                    this.deps.externalPlans.getActivationState(userId, planId),
                    this.deps.externalPlans.getPlacementState(userId, planId),
                ]);

                if (header.status !== 'AVAILABLE') {
                    mergeFailure(header.status === 'INVALID' ? 'INVALID' : 'UNAVAILABLE');
                    planIssues.push({ planId, reason: header.status === 'INVALID' ? 'placement_invalid' : 'placement_unavailable' });
                    continue;
                }

                if (legacy.status === 'INVALID' || legacy.status === 'UNAVAILABLE') {
                    mergeFailure(legacy.status);
                    planIssues.push({
                        planId,
                        reason: legacy.status === 'INVALID' ? 'placement_invalid' : 'placement_unavailable',
                    });
                }

                const placedLegacyRevisions = legacy.status === 'AVAILABLE' && legacy.data.assignments.some(
                    a => a.date >= windowStart && a.date <= windowEnd,
                )
                    ? [legacy.data.revision]
                    : [];

                const execRefs = new Set(
                    executions
                        .filter(exec => exec.sessionSource.kind === 'external_plan' && exec.sessionSource.planId === planId && exec.sessionSource.revision !== undefined)
                        .map(exec => exec.sessionSource.revision!),
                );

                if (activations.status !== 'AVAILABLE') {
                    mergeFailure(activations.status === 'INVALID' ? 'INVALID' : 'UNAVAILABLE');
                }

                const revisions = new Set<number>([
                    header.data.revision,
                    ...execRefs,
                    ...(activations.status === 'AVAILABLE' ? activations.data.map(a => a.revision) : []),
                    ...placedLegacyRevisions,
                ]);

                for (const revision of [...revisions].sort((a, b) => a - b)) {
                    const [plan, placement, history] = await Promise.all([
                        this.deps.externalPlans.getRevisionState(userId, planId, revision),
                        this.deps.externalPlans.getPlacementState(userId, planId, revision),
                        this.deps.externalPlans.getPlacementHistoryState(userId, planId, revision),
                    ]);

                    if (history.status === 'AVAILABLE') {
                        placementHistory.push(...history.data);
                    } else if (history.status === 'UNAVAILABLE' && history.operation === PLACEMENT_HISTORY_TRUNCATED_OPERATION) {
                        planIssues.push({ planId, revision, reason: 'history_truncated' });
                    } else if (history.status !== 'MISSING') {
                        planIssues.push({
                            planId,
                            revision,
                            reason: history.status === 'INVALID' ? 'history_invalid' : 'history_unavailable',
                        });
                        mergeFailure(history.status === 'INVALID' ? 'INVALID' : 'UNAVAILABLE');
                    }

                    if (placement.status === 'AVAILABLE') {
                        placements.push({
                            planId: placement.data.planId,
                            revision: placement.data.revision,
                            updatedAt: placement.data.updatedAt,
                            assignments: placement.data.assignments,
                            successors: placement.data.successors,
                        });
                    } else if (placement.status !== 'MISSING') {
                        planIssues.push({
                            planId,
                            revision,
                            reason: placement.status === 'INVALID' ? 'placement_invalid' : 'placement_unavailable',
                        });
                        mergeFailure(placement.status === 'INVALID' ? 'INVALID' : 'UNAVAILABLE');
                    }

                    if (plan.status !== 'AVAILABLE') {
                        planIssues.push({ planId, revision, reason: 'unverified_revision' });
                        mergeFailure(plan.status === 'INVALID' ? 'INVALID' : 'UNAVAILABLE');
                        continue;
                    }

                    const activation = activations.status === 'AVAILABLE'
                        ? activations.data.find(a => a.revision === revision)
                        : undefined;
                    const expectedHash = revision === header.data.revision ? header.data.contentHash : activation?.contentHash;
                    const importedAt = revision === header.data.revision ? header.data.importedAt : activation?.activatedAt;

                    if (!expectedHash || !importedAt || parseUtcTimestampMs(importedAt) === null || (await computeContentHash(plan.data)) !== expectedHash) {
                        planIssues.push({ planId, revision, reason: 'unverified_revision' });
                        // With a recorded hash it may have governed dates in the window, so which sessions
                        // were planned is unknown. A legacy-overlay revision never governed on its own.
                        if (expectedHash) mergeFailure('INVALID');
                        continue;
                    }

                    const revisionPlan = plan.data as AnyExternalTrainingPlan;

                    planRevisions.push({
                        planId,
                        revision,
                        contentHash: expectedHash,
                        importedAt,
                        horizon: {
                            effectiveFrom: activation?.effectiveFrom ?? header.data.supersededFrom ?? revisionPlan.startDate,
                            startDate: revisionPlan.startDate,
                            endDate: planEndDate(revisionPlan),
                        },
                        sessions: revisionPlan.sessions.map(session => ({
                            id: session.id,
                            authoredDate: impliedDate(revisionPlan, session),
                            floating: session.placement.flexibility !== 'fixed' && !session.placement.preferredDay,
                            gating: session.gating ? { intensity: session.gating.intensity } : undefined,
                        })),
                    });
                }
            }
        } catch {
            overallState = 'unavailable';
        }

        return { state: overallState, planRevisions, placements, placementHistory, planIssues };
    }
}

export const dEvalReadoutService = new DEvalReadoutService();
