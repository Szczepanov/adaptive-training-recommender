/** Date-specific, offline TO4 counterfactual. Only the broad history rows/revision are swapped. */
import type {
    AuthoredPlanBlock,
    DailyReadiness,
    FixedActivity,
    Recommendation,
    ScheduleOverlay,
    TrainingIntentProfile,
    UserContext,
    UserEvent,
    UserPreferences,
} from '../engine/models';
import type { CapturedTrainingHistoryRequest } from '../engine/historyReplayCapture';
import type { CheckinRecord } from '../engine/mechanicalProgression';
import type { CompletedExposure, TrainingHistoryProvider } from '../engine/trainingHistory';
import type { TrainingHistorySnapshot } from '../engine/trainingHistorySnapshot';
import { eventStrengthSupportSessions, preparedPerformedFactsForCoverageSet } from '../engine/trainingIntent';
import { evaluateSameDayRecommendation } from '../engine/sameDayRecommendation';
import type { ExternalPlanContext, ExternalRestContext } from '../engine/rules';
import { computeContentHash } from '../engine/externalPlanHash';
import { evaluatePeriodizationPhase } from '../engine/periodization';
import { resolvePlanningContext } from '../engine/planningMode';
import { resolvePlanDefinitionForEvent } from '../engine/planSchedule';
import { addDaysToLocalDateString } from '../utils/localDate';
import { coverageSetFor, EVERGREEN_GENERAL_COVERAGE_SET } from '../workouts/event-plan';
import { workoutForTemplate } from '../workouts/prescription';
import {
    compareCompletedExposureSets,
    compareRecommendationOutputs,
    type ExposureComparison,
    type RecommendationDelta,
} from './historyCounterfactual';

export type RecommendationProjectionField =
    | 'verdict' | 'mode' | 'selectedTemplate' | 'prescription' | 'dose'
    | 'variant' | 'coverage' | 'sequence' | 'fatigue' | 'guardrails';

export type FieldClassification = 'expected' | 'explainable' | 'unresolved';

export interface RecommendationFieldAdjudication {
    field: RecommendationProjectionField;
    classification: FieldClassification;
    reasonCode: string;
    evidenceRefs: string[];
}

export interface RecommendationDateAdjudication {
    dateAlias: string;
    classification: 'unchanged' | FieldClassification;
    fields: RecommendationFieldAdjudication[];
}

/** The production Home snapshot shape, excluding only broad history rows and their revision. */
export type HistoricalHistorySnapshotBase = Omit<
    TrainingHistorySnapshot,
    'exposures' | 'revision'
>;

export interface HistoricalDecisionInputs {
    /** Must be the user id from the private export, not an evidence placeholder. */
    userId: string;
    exportedUserId: string;
    date: string;
    dateAlias: string;
    evaluatedAt: string;
    minimumSafetyCheckinStatus: string;
    normalRecommendationEligible: true;
    readiness: DailyReadiness;
    context: UserContext;
    events: UserEvent[];
    previousMode?: 'train' | 'modify' | 'recover';
    fixedActivities: FixedActivity[];
    authoredPlanBlocks: readonly AuthoredPlanBlock[];
    trainingIntentProfile: TrainingIntentProfile | null;
    preferences: UserPreferences | null;
    externalContext: ExternalPlanContext | null;
    externalRestContext: ExternalRestContext | null;
    scheduleOverlays: readonly ScheduleOverlay[];
    confirmedProgressionOverrides: ReadonlyMap<string, number>;
    /** Always present, including an explicitly hydrated empty array. */
    mechanicalCheckinHistory: readonly CheckinRecord[];
    /** Same prepared 7-day operational snapshot Home passes; contains common narrow facts. */
    preparedHistorySnapshot: HistoricalHistorySnapshotBase;
    capturedHistoryRequests?: readonly CapturedTrainingHistoryRequest[];
}

export interface HistoricalHistoryPass {
    useCapturedRevisions?: boolean;
    revision: string;
    digest: string;
    exposures: readonly CompletedExposure[];
    decisionInputDigest: string;
    experimentRevisionDigest: string;
    performedFactsDigest: string;
    mechanicalCheckinDigest: string;
}

export type HistoricalDateInput =
    | { status: 'not_applicable'; reasonCode: string; dateAlias?: string }
    | { status: 'not_replayable'; reasonCodes: readonly string[]; dateAlias?: string }
    | {
        status: 'replayable';
        inputs: HistoricalDecisionInputs;
        live: HistoricalHistoryPass;
        canonical: HistoricalHistoryPass;
    };

export interface BoundRecommendationReviewLabel {
    recordsSha256: string;
    sourceCommit: string;
    sourceTreeSha256: string;
    policyVersion: string;
    dateAlias: string;
    field: RecommendationProjectionField;
    nonHistoryInputDigest: string;
    liveHistoryDigest: string;
    canonicalHistoryDigest: string;
    classification: FieldClassification;
    reasonCode: string;
    evidenceRefs: string[];
}

export interface HistoryCounterfactualSeriesOptions {
    dates: readonly string[];
    inputForDate(date: string): HistoricalDateInput | Promise<HistoricalDateInput>;
    recordsSha256: string;
    sourceCommit: string;
    sourceTreeSha256: string;
    policyVersion: string;
    reviewLabels?: readonly BoundRecommendationReviewLabel[];
}

export interface HistoricalReplayProvenance {
    recordsSha256: string;
    sourceCommit: string;
    sourceTreeSha256: string;
    policyVersion: string;
}

export interface HistoricalReplayDigests {
    decisionInputDigest: string;
    experimentRevisionDigest: string;
    performedFactsDigest: string;
    mechanicalCheckinDigest: string;
}

export type DecisionProjection = Record<RecommendationProjectionField, unknown>;

export interface CounterfactualEvaluation {
    dateAlias: string;
    nonHistoryInputDigest: string;
    experimentRevisionDigest: string;
    performedFactsDigest: string;
    mechanicalCheckinDigest: string;
    liveHistoryDigest: string;
    canonicalHistoryDigest: string;
    live: DecisionProjection;
    canonical: DecisionProjection;
    providerRequests: readonly string[];
    historyDeltas: ExposureComparison;
    delta: RecommendationDelta;
    adjudication: RecommendationDateAdjudication;
}

export interface CounterfactualDateResult {
    dateAlias: string;
    status: 'not_applicable' | 'not_replayable' | 'compared';
    reasonCode?: string;
    reasonCodes?: readonly string[];
    evaluation?: CounterfactualEvaluation;
}

export interface CounterfactualSeries {
    referenceSource: 'historical-user-scoped-inputs-v2';
    evaluations: CounterfactualEvaluation[];
    dates: CounterfactualDateResult[];
    candidateDates: number;
    evaluatedDates: number;
    notApplicableDates: number;
    notReplayableDates: number;
    changedDates: number;
    expectedDates: number;
    explainableDates: number;
    unresolvedDates: number;
    changedFieldCounts: Record<string, number>;
    notReplayableByReason: Record<string, number>;
    classificationReasonCounts: Record<string, number>;
}

const FIXED_GENERATED_AT = '1970-01-01T00:00:00.000Z';
const FIELDS: readonly RecommendationProjectionField[] = [
    'verdict', 'mode', 'selectedTemplate', 'prescription', 'dose', 'variant', 'coverage', 'sequence', 'fatigue', 'guardrails',
];

function stableJson(value: unknown): string {
    if (value instanceof Map) {
        return stableJson(Object.fromEntries([...value.entries()].sort(([left], [right]) => String(left).localeCompare(String(right)))));
    }
    if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right))
            .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`).join(',')}}`;
    }
    return JSON.stringify(value) ?? 'null';
}

async function digest(value: unknown): Promise<string> {
    return computeContentHash({ schema: 'to4-historical-counterfactual-v2', value: JSON.parse(stableJson(value)) });
}

/** Hashes values at the replay boundary; pass metadata cannot assert parity on its own. */
export async function computeHistoricalReplayDigests(
    inputs: HistoricalDecisionInputs,
    provenance: HistoricalReplayProvenance,
): Promise<HistoricalReplayDigests> {
    const [decisionInputDigest, experimentRevisionDigest, performedFactsDigest, mechanicalCheckinDigest] = await Promise.all([
        digest({
            userId: inputs.userId,
            exportedUserId: inputs.exportedUserId,
            date: inputs.date,
            minimumSafetyCheckinStatus: inputs.minimumSafetyCheckinStatus,
            normalRecommendationEligible: inputs.normalRecommendationEligible,
            readiness: inputs.readiness,
            context: inputs.context,
            events: inputs.events,
            previousMode: inputs.previousMode,
            fixedActivities: inputs.fixedActivities,
            authoredPlanBlocks: inputs.authoredPlanBlocks,
            trainingIntentProfile: inputs.trainingIntentProfile,
            preferences: inputs.preferences,
            externalContext: inputs.externalContext,
            externalRestContext: inputs.externalRestContext,
            scheduleOverlays: inputs.scheduleOverlays,
            confirmedProgressionOverrides: inputs.confirmedProgressionOverrides,
            mechanicalCheckinHistory: inputs.mechanicalCheckinHistory,
            capturedHistoryRequests: inputs.capturedHistoryRequests?.map(request => request.kind === 'snapshot'
                ? { ...request, snapshot: { ...request.snapshot, exposures: undefined, revision: undefined } }
                : { ...request, exposures: undefined }),
            preparedHistorySnapshot: {
                throughDateExclusive: inputs.preparedHistorySnapshot.throughDateExclusive,
                windowDays: inputs.preparedHistorySnapshot.windowDays,
                completedEvents: inputs.preparedHistorySnapshot.completedEvents,
                sourceStates: inputs.preparedHistorySnapshot.sourceStates,
                performedTrainingFacts: inputs.preparedHistorySnapshot.performedTrainingFacts,
                athleteStateEvidence: inputs.preparedHistorySnapshot.athleteStateEvidence,
            },
        }),
        digest({
            sourceCommit: provenance.sourceCommit,
            sourceTreeSha256: provenance.sourceTreeSha256,
            policyVersion: provenance.policyVersion,
            recordsSha256: provenance.recordsSha256,
            evaluatedAt: inputs.evaluatedAt,
            exportSchemaVersion: 2,
            replayImplementationVersion: 'to4-historical-counterfactual-v2',
            classifierVersion: 'recommendation-field-labels-v1',
            evaluatedAtConvention: 'persisted-audit-or-fixed-date-local-noon-v1',
        }),
        digest(inputs.preparedHistorySnapshot.performedTrainingFacts),
        digest(inputs.mechanicalCheckinHistory),
    ]);
    return { decisionInputDigest, experimentRevisionDigest, performedFactsDigest, mechanicalCheckinDigest };
}

export async function computeHistoricalHistoryDigest(
    revision: string,
    exposures: readonly CompletedExposure[],
): Promise<string> {
    return digest({ revision, exposures });
}

function windowed(exposures: readonly CompletedExposure[], throughDateExclusive: string, windowDays: number): CompletedExposure[] {
    const start = addDaysToLocalDateString(throughDateExclusive, -windowDays);
    return exposures.filter(exposure => exposure.date >= start && exposure.date < throughDateExclusive);
}

function snapshotFor(
    inputs: HistoricalDecisionInputs,
    pass: HistoricalHistoryPass,
    windowDays: number,
): TrainingHistorySnapshot {
    return {
        ...inputs.preparedHistorySnapshot,
        throughDateExclusive: inputs.date,
        windowDays,
        exposures: windowed(pass.exposures, inputs.date, windowDays),
        generatedAt: inputs.preparedHistorySnapshot.generatedAt,
        revision: pass.revision,
    };
}

function inMemoryHistoryProvider(
    inputs: HistoricalDecisionInputs,
    pass: HistoricalHistoryPass,
): { provider: TrainingHistoryProvider; requests: string[] } {
    const requests: string[] = [];
    let capturedIndex = 0;
    const capturedRequest = (kind: CapturedTrainingHistoryRequest['kind'], throughDateExclusive: string, windowDays: number) => {
        if (!inputs.capturedHistoryRequests) return undefined;
        const request = inputs.capturedHistoryRequests[capturedIndex++];
        if (!request || request.kind !== kind || request.throughDateExclusive !== throughDateExclusive
            || request.windowDays !== windowDays) throw new Error('captured_history_request_mismatch');
        return request;
    };
    const snapshot = (throughDateExclusive: string, windowDays: number): TrainingHistorySnapshot => {
        requests.push(`snapshot:${throughDateExclusive}:${windowDays}`);
        const captured = capturedRequest('snapshot', throughDateExclusive, windowDays);
        return {
            ...(captured?.kind === 'snapshot' ? captured.snapshot : inputs.preparedHistorySnapshot),
            throughDateExclusive,
            windowDays,
            exposures: windowed(pass.exposures, throughDateExclusive, windowDays),
            generatedAt: captured?.kind === 'snapshot' ? captured.snapshot.generatedAt : inputs.evaluatedAt || FIXED_GENERATED_AT,
            revision: pass.useCapturedRevisions && captured?.kind === 'snapshot' ? captured.snapshot.revision : pass.revision,
        };
    };
    return {
        provider: {
            reconstruct: async (userId, throughDateExclusive, windowDays) => {
                if (userId !== inputs.exportedUserId) throw new Error('history_provider_user_mismatch');
                requests.push(`reconstruct:${throughDateExclusive}:${windowDays}`);
                capturedRequest('reconstruct', throughDateExclusive, windowDays);
                return windowed(pass.exposures, throughDateExclusive, windowDays);
            },
            getSnapshot: async (userId, throughDateExclusive, windowDays) => {
                if (userId !== inputs.exportedUserId) throw new Error('history_provider_user_mismatch');
                return snapshot(throughDateExclusive, windowDays);
            },
        },
        requests,
    };
}

function rounded(value: unknown): unknown {
    if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value * 1e6) / 1e6 : value;
    if (Array.isArray(value)) return value.map(rounded);
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value as Record<string, unknown>)
            .filter(([, child]) => child !== undefined)
            .map(([key, child]) => [key, rounded(child)]));
    }
    return value ?? null;
}

/** Decision-relevant, non-narrative projection; rationale prose is intentionally excluded. */
export function projectRecommendation(recommendation: Recommendation): DecisionProjection {
    const trace = recommendation.decisionTrace;
    const ranked = [...(trace?.candidateScores ?? [])]
        .sort((left, right) => right.utilityScore - left.utilityScore || left.templateId.localeCompare(right.templateId));
    return rounded({
        verdict: recommendation.externalVerdict?.decision ?? null,
        mode: recommendation.mode,
        selectedTemplate: recommendation.template.id,
        prescription: { workoutId: workoutForTemplate(recommendation.template.id)?.id ?? null },
        dose: { planned: recommendation.plannedDose ?? null, execution: recommendation.executionDose ?? null, active: recommendation.activeDose ?? null },
        variant: recommendation.adjustment ?? null,
        coverage: trace?.calibration?.activeObjectives ?? null,
        sequence: ranked.slice(0, 5).map(candidate => ({ templateId: candidate.templateId, utilityScore: candidate.utilityScore })),
        fatigue: trace?.calibration?.fatigue ?? null,
        guardrails: {
            safety: recommendation.envelopes?.safety ?? null,
            plan: recommendation.envelopes?.plan ?? null,
            excludedReasons: [...new Set(ranked.flatMap(candidate => candidate.excludedReasons))].sort(),
        },
    }) as DecisionProjection;
}

async function evaluate(inputs: HistoricalDecisionInputs, pass: HistoricalHistoryPass): Promise<{
    projection: DecisionProjection;
    providerRequests: string[];
}> {
    const history = inMemoryHistoryProvider(inputs, pass);
    const recommendation = await evaluateSameDayRecommendation({
        userId: inputs.userId,
        readiness: inputs.readiness,
        context: inputs.context,
        events: inputs.events,
        date: inputs.date,
        previousMode: inputs.previousMode,
        historyProvider: history.provider,
        preparedHistorySnapshot: snapshotFor(inputs, pass, inputs.preparedHistorySnapshot.windowDays),
        fixedActivities: inputs.fixedActivities,
        authoredPlanBlocks: inputs.authoredPlanBlocks,
        trainingIntentProfile: inputs.trainingIntentProfile,
        preferences: inputs.preferences,
        externalPlan: inputs.externalContext,
        externalRest: inputs.externalRestContext,
        scheduleOverlays: inputs.scheduleOverlays,
        confirmedProgressionOverrides: inputs.confirmedProgressionOverrides,
        mechanicalCheckinHistory: inputs.mechanicalCheckinHistory,
    });
    if (inputs.capturedHistoryRequests && history.requests.length !== inputs.capturedHistoryRequests.length) {
        throw new Error('captured_history_requests_not_consumed');
    }
    return { projection: projectRecommendation(recommendation), providerRequests: history.requests };
}

async function assertPassParity(
    inputs: HistoricalDecisionInputs,
    live: HistoricalHistoryPass,
    canonical: HistoricalHistoryPass,
    provenance: HistoricalReplayProvenance,
): Promise<{ liveHistoryDigest: string; canonicalHistoryDigest: string }> {
    if (!inputs.userId || inputs.userId !== inputs.exportedUserId || inputs.userId === 'training-occurrence-evidence') {
        throw new Error('real_exported_user_id_required');
    }
    if (inputs.normalRecommendationEligible !== true) throw new Error('normal_recommendation_gate_not_proven');
    if (!Array.isArray(inputs.mechanicalCheckinHistory)) throw new Error('mechanical_checkin_history_not_hydrated');
    if (!inputs.preparedHistorySnapshot.performedTrainingFacts) throw new Error('performed_training_facts_not_prepared');
    const eventPeriodization = evaluatePeriodizationPhase(inputs.events, inputs.date);
    const planningContext = resolvePlanningContext(inputs.trainingIntentProfile, eventPeriodization, inputs.date);
    const periodization = planningContext.mode === 'event_directed'
        ? eventPeriodization
        : evaluatePeriodizationPhase([], inputs.date);
    const strengthSupportSessions = eventStrengthSupportSessions(planningContext, inputs.trainingIntentProfile);
    const planDefinition = resolvePlanDefinitionForEvent(
        periodization.focusEvent, inputs.authoredPlanBlocks, strengthSupportSessions,
    );
    const expectedDescriptor = planDefinition
        ? coverageSetFor(planDefinition.coverageSetId)
        : EVERGREEN_GENERAL_COVERAGE_SET;
    const facts = preparedPerformedFactsForCoverageSet(
        inputs.preparedHistorySnapshot.performedTrainingFacts,
        expectedDescriptor.id,
    );
    if (!facts || facts.asOfDate !== inputs.date) throw new Error('performed_training_facts_scope_mismatch');
    if (inputs.preparedHistorySnapshot.throughDateExclusive !== inputs.date
        || inputs.preparedHistorySnapshot.windowDays !== 7) {
        throw new Error('prepared_operational_snapshot_shape_mismatch');
    }
    // Since non-history call arguments are shared, this guards accidental mutable changes during evaluation.
    if (!inputs.date || !inputs.dateAlias || !inputs.evaluatedAt) throw new Error('historical_input_provenance_missing');
    const expected = await computeHistoricalReplayDigests(inputs, provenance);
    for (const field of ['decisionInputDigest', 'experimentRevisionDigest', 'performedFactsDigest', 'mechanicalCheckinDigest'] as const) {
        if (live[field] !== expected[field] || canonical[field] !== expected[field]) throw new Error(`${field}_mismatch`);
    }
    const [liveHistoryDigest, canonicalHistoryDigest] = await Promise.all([
        computeHistoricalHistoryDigest(live.revision, live.exposures),
        computeHistoricalHistoryDigest(canonical.revision, canonical.exposures),
    ]);
    if (live.digest !== liveHistoryDigest) throw new Error('liveHistoryDigest_mismatch');
    if (canonical.digest !== canonicalHistoryDigest) throw new Error('canonicalHistoryDigest_mismatch');
    return { liveHistoryDigest, canonicalHistoryDigest };
}

function validateReviewLabels(labels: readonly BoundRecommendationReviewLabel[], options: HistoryCounterfactualSeriesOptions): void {
    const seen = new Set<string>();
    for (const label of labels) {
        if (!label || typeof label !== 'object') throw new Error('invalid_recommendation_label:unknown');
        const key = `${label.dateAlias}:${label.field}`;
        if (seen.has(key)) throw new Error(`duplicate_recommendation_label:${key}`);
        seen.add(key);
        if (!/^[0-9a-f]{64}$/.test(label.recordsSha256)
            || label.recordsSha256 !== options.recordsSha256
            || !label.sourceCommit || label.sourceCommit !== options.sourceCommit
            || !/^[0-9a-f]{64}$/.test(label.sourceTreeSha256)
            || label.sourceTreeSha256 !== options.sourceTreeSha256
            || !label.policyVersion || label.policyVersion !== options.policyVersion
            || !/^D\d{3,}$/.test(label.dateAlias)
            || !FIELDS.includes(label.field)
            || !/^[0-9a-f]{64}$/.test(label.nonHistoryInputDigest)
            || !/^[0-9a-f]{64}$/.test(label.liveHistoryDigest)
            || !/^[0-9a-f]{64}$/.test(label.canonicalHistoryDigest)
            || !['expected', 'explainable', 'unresolved'].includes(label.classification)
            || !/^[a-z][a-z0-9_]{0,79}$/.test(label.reasonCode)
            || !Array.isArray(label.evidenceRefs) || label.evidenceRefs.length === 0
            || label.evidenceRefs.some(ref => typeof ref !== 'string' || !/^[a-z][a-z0-9_:-]{0,99}$/.test(ref))) {
            throw new Error(`invalid_recommendation_label:${key}`);
        }
    }
}

function bindAdjudication(
    changedFields: readonly string[],
    dateAlias: string,
    nonHistoryInputDigest: string,
    historyDeltas: ExposureComparison,
    options: HistoryCounterfactualSeriesOptions,
    liveHistoryDigest: string,
    canonicalHistoryDigest: string,
): RecommendationDateAdjudication {
    const labels = (options.reviewLabels ?? []).filter(label => label.dateAlias === dateAlias);
    const changed = new Set(changedFields);
    for (const label of labels) {
        if (!changed.has(label.field)
            || label.recordsSha256 !== options.recordsSha256
            || label.sourceCommit !== options.sourceCommit
            || label.sourceTreeSha256 !== options.sourceTreeSha256
            || label.policyVersion !== options.policyVersion
            || label.nonHistoryInputDigest !== nonHistoryInputDigest
            || label.liveHistoryDigest !== liveHistoryDigest
            || label.canonicalHistoryDigest !== canonicalHistoryDigest) {
            throw new Error(`stale_or_unmatched_recommendation_label:${dateAlias}:${label.field}`);
        }
    }
    const historyChanged = historyDeltas.countDelta !== 0
        || historyDeltas.perOccurrence.some(row => row.status !== 'matched'
            || Object.values(row).some(value => value === true)
            || Object.values(row.costDelta ?? {}).some(value => value !== 0)
            || Object.values(row.stimulusDelta ?? {}).some(value => value !== 0));
    const fields = changedFields.map((rawField): RecommendationFieldAdjudication => {
        if (!FIELDS.includes(rawField as RecommendationProjectionField)) throw new Error(`unknown_recommendation_projection_field:${rawField}`);
        const field = rawField as RecommendationProjectionField;
        const label = labels.find(item => item.field === field);
        if (label) return {
            field,
            classification: label.classification,
            reasonCode: label.reasonCode,
            evidenceRefs: [...label.evidenceRefs],
        };
        return {
            field,
            classification: 'unresolved',
            reasonCode: historyChanged ? 'history_delta_requires_review' : 'no_history_delta_explains_change',
            evidenceRefs: historyChanged ? ['history-comparison', `output-field:${field}`] : [`output-field:${field}`],
        };
    });
    const classifications = fields.map(field => field.classification);
    const classification = fields.length === 0 ? 'unchanged'
        : classifications.includes('unresolved') ? 'unresolved'
            : classifications.includes('explainable') ? 'explainable' : 'expected';
    return { dateAlias, classification, fields };
}

function recordCount(target: Record<string, number>, reason: string): void {
    target[reason] = (target[reason] ?? 0) + 1;
}

/** Runs current-policy historical-context comparisons for each candidate date. */
export async function runHistoryCounterfactualSeries(options: HistoryCounterfactualSeriesOptions): Promise<CounterfactualSeries> {
    const dates: CounterfactualDateResult[] = [];
    const evaluations: CounterfactualEvaluation[] = [];
    const changedFieldCounts: Record<string, number> = {};
    const notReplayableByReason: Record<string, number> = {};
    const classificationReasonCounts: Record<string, number> = {};
    const appliedLabels = new Set<BoundRecommendationReviewLabel>();
    const sortedDates = [...new Set(options.dates)].sort();
    validateReviewLabels(options.reviewLabels ?? [], options);

    for (let index = 0; index < sortedDates.length; index += 1) {
        const date = sortedDates[index];
        // Provenance/data gaps are explicit HistoricalDateInput states. Unexpected assembler
        // exceptions are pipeline failures and must not be disguised as ordinary missing history.
        const resolved = await options.inputForDate(date);
        if (resolved.status === 'not_applicable') {
            dates.push({ dateAlias: resolved.dateAlias ?? `date-${String(index + 1).padStart(3, '0')}`, status: resolved.status, reasonCode: resolved.reasonCode });
            continue;
        }
        if (resolved.status === 'not_replayable') {
            const dateAlias = resolved.dateAlias ?? `date-${String(index + 1).padStart(3, '0')}`;
            dates.push({ dateAlias, status: resolved.status, reasonCodes: [...resolved.reasonCodes].sort() });
            for (const reason of new Set(resolved.reasonCodes)) recordCount(notReplayableByReason, reason);
            continue;
        }

        const { inputs, live, canonical } = resolved;
        if (inputs.date !== date) throw new Error('historical_date_mismatch');
        const { liveHistoryDigest, canonicalHistoryDigest } = await assertPassParity(inputs, live, canonical, options);
        const [liveResult, canonicalResult] = await Promise.all([evaluate(inputs, live), evaluate(inputs, canonical)]);
        if (stableJson(liveResult.providerRequests) !== stableJson(canonicalResult.providerRequests)) {
            throw new Error('history_provider_window_parity_mismatch');
        }
        const liveProjection = liveResult.projection;
        const canonicalProjection = canonicalResult.projection;
        const delta = compareRecommendationOutputs(liveProjection, canonicalProjection);
        const historyDeltas = compareCompletedExposureSets(live.exposures, canonical.exposures);
        for (const label of options.reviewLabels ?? []) if (label.dateAlias === inputs.dateAlias) appliedLabels.add(label);
        const adjudication = bindAdjudication(
            delta.changedFields, inputs.dateAlias, live.decisionInputDigest, historyDeltas, options, liveHistoryDigest, canonicalHistoryDigest,
        );
        for (const field of delta.changedFields) recordCount(changedFieldCounts, field);
        for (const field of adjudication.fields) recordCount(classificationReasonCounts, field.reasonCode);
        const evaluation: CounterfactualEvaluation = {
            dateAlias: inputs.dateAlias,
            nonHistoryInputDigest: live.decisionInputDigest,
            experimentRevisionDigest: live.experimentRevisionDigest,
            performedFactsDigest: live.performedFactsDigest,
            mechanicalCheckinDigest: live.mechanicalCheckinDigest,
            liveHistoryDigest,
            canonicalHistoryDigest,
            live: liveProjection,
            canonical: canonicalProjection,
            providerRequests: liveResult.providerRequests,
            historyDeltas,
            delta,
            adjudication,
        };
        evaluations.push(evaluation);
        dates.push({ dateAlias: inputs.dateAlias, status: 'compared', evaluation });
    }

    if ((options.reviewLabels ?? []).some(label => !appliedLabels.has(label))) {
        throw new Error('stale_or_unmatched_recommendation_label');
    }

    const changed = evaluations.filter(row => row.delta.changedFields.length > 0);
    return {
        referenceSource: 'historical-user-scoped-inputs-v2',
        evaluations,
        dates,
        candidateDates: sortedDates.length,
        evaluatedDates: evaluations.length,
        notApplicableDates: dates.filter(row => row.status === 'not_applicable').length,
        notReplayableDates: dates.filter(row => row.status === 'not_replayable').length,
        changedDates: changed.length,
        expectedDates: changed.filter(row => row.adjudication.classification === 'expected').length,
        explainableDates: changed.filter(row => row.adjudication.classification === 'explainable').length,
        unresolvedDates: changed.filter(row => row.adjudication.classification === 'unresolved').length,
        changedFieldCounts,
        notReplayableByReason,
        classificationReasonCounts,
    };
}
