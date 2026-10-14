import { isValidLocalDateString } from '../engine/blockIntent';
import type { DataState } from '../engine/dataState';
import type { DailyRecommendation, RegionTissueResponse } from '../engine/models';
import type { AssessmentAttempt, CompetitionOutcome } from '../observations/models';
import { isBenchmarkEligibleAttempt } from '../observations/assessmentEvidenceEligibility';
import { deriveProgress, type CurrentObservation } from '../observations/progress';
import { observationKeyFor } from '../observations/validation';
import { PHYSICAL_CAPITAL_PROTOCOL_REVISIONS } from '../observations/physicalCapitalProtocols';
import type { OutcomeEvaluationSnapshot } from '../outcomes/evaluationSpec';
import { assertValidOutcomeEvaluationSnapshot } from '../outcomes/evaluationSpec';
import { hashEvaluationContent } from '../outcomes/evaluationHash';
import type { BlockOutcomeReport, BlockReviewSource } from '../outcomes/blockOutcome';
import { deriveSessionOutcome, type SessionOutcome } from '../responses/outcome';
import type { ResponseWindow, SessionResponse } from '../responses/models';
import type { SessionExecution } from '../sessions/models';
import { compareCodeUnits } from '../utils/canonicalJson';
import { addDaysToLocalDateString, getDayDiff, getLocalDateString } from '../utils/localDate';
import { intentBlockService, type IntentBlockService, type IntentBlockRevisionDocument } from './intentBlockService';
import { outcomeEvaluationService, type OutcomeEvaluationService } from './outcomeEvaluationService';
import { assessmentAttemptService, type AssessmentAttemptService } from './assessmentAttemptService';
import { metricObservationService, type MetricObservationService } from './metricObservationService';
import { measurementProtocolService, type MeasurementProtocolService } from './measurementProtocolService';
import { recommendationService } from './recommendationService';
import { sessionExecutionService, type SessionExecutionService } from './sessionExecutionService';
import { competitionOutcomeService, COMPETITION_OUTCOME_MAX_SCANNED_RECORDS, type CompetitionOutcomeService } from './competitionOutcomeService';
import { checkinService } from './checkinService';
import { sessionResponseDocId, sessionResponseService, type SessionResponseService } from './sessionResponseService';
import { performedTrainingOccurrenceRepository, type PerformedTrainingOccurrenceRepository } from '../training-occurrence/repository';
import { blockOutcomeReportService, type BlockOutcomeReportService } from './blockOutcomeReportService';

export type { BlockReviewSource } from '../outcomes/blockOutcome';
export const BLOCK_REVIEW_READER_VERSION = 'block-review-reader-v1';
export const BLOCK_REVIEW_REPORT_VERSION = 'block-review-report-v1';
export const BLOCK_REVIEW_MAX_BLOCKS = 20;
export const BLOCK_REVIEW_MAX_EVALUATIONS = 20;
export const BLOCK_REVIEW_MAX_ATTEMPTS = 100;
export const BLOCK_REVIEW_MAX_RECORDS = 200;
export const BLOCK_REVIEW_MAX_PROCESS_DAYS = 180;
const TISSUE_LOOKAHEAD_DAYS = 7;

export interface BlockReviewSelection {
    blockId: string;
    blockRevision: number;
    evaluationId: string;
    evaluationRevision: number;
    title?: string;
    startDate?: string;
    endDate?: string;
}
export interface BlockReviewResult {
    selection: BlockReviewSelection;
    asOfDate: string;
    evaluation?: OutcomeEvaluationSnapshot;
    report?: BlockOutcomeReport;
    sources: BlockReviewSource[];
    limitations: string[];
}
export interface BlockReviewList {
    selections: BlockReviewSelection[];
    sources: BlockReviewSource[];
    limitations: string[];
}
interface BlockReviewDependencies {
    blocks: Pick<IntentBlockService, 'listBlockIds' | 'getHeaderState' | 'getRevisionState'>;
    evaluations: Pick<OutcomeEvaluationService, 'getRevision'>;
    attempts: Pick<AssessmentAttemptService, 'listAttemptsForProtocolWithDiagnostics' | 'getAttempt'>;
    observations: Pick<MetricObservationService, 'getHead' | 'getRevision'>;
    protocols: Pick<MeasurementProtocolService, 'getRevision'>;
    recommendations: Pick<typeof recommendationService, 'getRecommendationsInRange'>;
    executions: Pick<SessionExecutionService, 'getExecutionHeadersInRange'>;
    responses: Pick<SessionResponseService, 'getResponse'>;
    checkins: Pick<typeof checkinService, 'getCheckinState'>;
    competitions: Pick<CompetitionOutcomeService, 'listOutcomesWithDiagnostics'>;
    occurrences: Pick<PerformedTrainingOccurrenceRepository, 'queryActiveInDateWindow'>;
    reports: Pick<BlockOutcomeReportService, 'buildReport'>;
}
const defaults: BlockReviewDependencies = {
    blocks: intentBlockService, evaluations: outcomeEvaluationService, attempts: assessmentAttemptService,
    observations: metricObservationService, protocols: measurementProtocolService, recommendations: recommendationService,
    executions: sessionExecutionService, responses: sessionResponseService, checkins: checkinService,
    competitions: competitionOutcomeService, occurrences: performedTrainingOccurrenceRepository, reports: blockOutcomeReportService,
};
function source(sourceName: string, count = 0, unreadableCount = 0, truncated = false): BlockReviewSource {
    return { source: sourceName, status: truncated ? 'truncated' : unreadableCount ? 'unreadable' : count ? 'available' : 'missing',
        recordCount: count, ...(unreadableCount ? { unreadableCount } : {}) };
}
function stateSource<T>(name: string, state: DataState<T>, count = 1): BlockReviewSource {
    if (state.status === 'INVALID' && state.issues.some(issue => issue.code === 'recommendation-history-truncated')) {
        return { source: name, status: 'truncated', recordCount: 0 };
    }
    return state.status === 'AVAILABLE' ? source(name, count, state.issues?.length ?? 0)
        : { source: name, status: state.status === 'MISSING' ? 'missing' : 'unreadable', recordCount: 0 };
}
function dateOf(timestamp: string): string { return getLocalDateString(new Date(timestamp)); }
function eligible(attempt: AssessmentAttempt, asOfDate: string): boolean {
    return isBenchmarkEligibleAttempt(attempt) && attempt.completedAt !== undefined && dateOf(attempt.completedAt) <= asOfDate;
}
function finish(result: BlockReviewResult): BlockReviewResult {
    result.sources.sort((a, b) => compareCodeUnits(a.source, b.source));
    result.limitations = [...new Set([...result.limitations, ...result.sources
        .filter(s => s.status === 'unreadable' || s.status === 'unsupported' || s.status === 'truncated')
        .map(s => `${s.source}:${s.status}`)])].sort(compareCodeUnits);
    return result;
}

/** Read-only, bounded assembly over canonical stores. It never changes recommendation authority. */
export class BlockReviewService {
    private readonly deps: BlockReviewDependencies;
    constructor(dependencies: Partial<BlockReviewDependencies> = {}) { this.deps = { ...defaults, ...dependencies }; }

    private async loadBlock(userId: string, blockId: string, revision?: number): Promise<DataState<IntentBlockRevisionDocument>> {
        const header = await this.deps.blocks.getHeaderState(userId, blockId);
        if (header.status !== 'AVAILABLE') return header;
        if (revision !== undefined && header.data.revision !== revision) return { status: 'INVALID', issues: [{ code: 'block-head-moved', documentPath: `users/${userId}/intent_blocks/${blockId}` }] };
        const stored = await this.deps.blocks.getRevisionState(userId, blockId, header.data.revision);
        if (stored.status === 'AVAILABLE' && stored.data.contentHash !== header.data.contentHash) {
            return { status: 'INVALID', issues: [{ code: 'block-head-hash-mismatch', documentPath: `users/${userId}/intent_blocks/${blockId}` }] };
        }
        return stored;
    }

    private async loadEvaluation(userId: string, id: string, revision: number, asOfDate: string): Promise<OutcomeEvaluationSnapshot | null> {
        const evaluation = await this.deps.evaluations.getRevision(userId, id, revision);
        if (!evaluation) return null;
        assertValidOutcomeEvaluationSnapshot(evaluation);
        if (evaluation.revision.id !== id || evaluation.revision.revision !== revision
            || evaluation.revision.status === 'draft' || !evaluation.revision.activatedAt
            || dateOf(evaluation.revision.activatedAt) > asOfDate
            || await hashEvaluationContent(evaluation) !== evaluation.revision.contentHash) {
            throw new Error('Frozen evaluation identity or hash is invalid');
        }
        return evaluation;
    }

    async listReviews(userId: string, asOfDate: string): Promise<BlockReviewList> {
        if (!isValidLocalDateString(asOfDate)) throw new Error('asOfDate must be a Warsaw calendar date');
        const ids = await this.deps.blocks.listBlockIds(userId, BLOCK_REVIEW_MAX_BLOCKS);
        const sources = [stateSource('intent_blocks', ids, ids.status === 'AVAILABLE' ? ids.data.length : 0)];
        const limitations: string[] = [];
        const selections: BlockReviewSelection[] = [];
        const evaluationCache = new Map<string, { evaluation: OutcomeEvaluationSnapshot | null; unreadable: boolean }>();
        if (ids.status === 'AVAILABLE') {
            if (ids.issues?.length) { sources[0].status = 'truncated'; limitations.push('intent_blocks:truncated'); }
            const storedBlocks = await Promise.all(ids.data.map(blockId => this.loadBlock(userId, blockId)));
            for (let i = 0; i < ids.data.length; i++) {
                const blockId = ids.data[i];
                const stored = storedBlocks[i];
                sources.push(stateSource(`block:${blockId}`, stored));
                if (stored.status !== 'AVAILABLE' || stored.data.block.dateRange.startDate > asOfDate) continue;
                const refs = stored.data.block.objectives.flatMap(o => o.successCriteria.evaluationRef ? [o.successCriteria.evaluationRef] : []);
                for (const ref of refs.filter((r, i) => refs.findIndex(other => other.id === r.id && other.revision === r.revision) === i)) {
                    const name = `evaluation:${ref.id}@${ref.revision}`;
                    if (!evaluationCache.has(name) && evaluationCache.size >= BLOCK_REVIEW_MAX_EVALUATIONS) {
                        sources.push({ source: 'evaluation_refs', status: 'truncated', recordCount: evaluationCache.size });
                        continue;
                    }
                    const selection: BlockReviewSelection = { blockId, blockRevision: stored.data.revision,
                        evaluationId: ref.id, evaluationRevision: ref.revision, title: stored.data.block.title ?? blockId,
                        startDate: stored.data.block.dateRange.startDate, endDate: stored.data.block.dateRange.endDate };
                    try {
                        if (!evaluationCache.has(name)) {
                            try { evaluationCache.set(name, { evaluation: await this.loadEvaluation(userId, ref.id, ref.revision, asOfDate), unreadable: false }); }
                            catch { evaluationCache.set(name, { evaluation: null, unreadable: true }); }
                        }
                        const cached = evaluationCache.get(name)!;
                        if (cached.unreadable) throw new Error('Evaluation unreadable');
                        const evaluation = cached.evaluation;
                        sources.push(source(name, evaluation ? 1 : 0));
                        const matchingRefs = refs.filter(r => r.id === ref.id && r.revision === ref.revision);
                        if (!evaluation || matchingRefs.some(r => !evaluation.bindings.some(b => b.metricId === r.metricId))) {
                            if (evaluation) sources[sources.length - 1].status = 'unreadable';
                        } else {
                            selection.title = stored.data.block.title ?? evaluation.revision.title;
                            selection.startDate = evaluation.revision.startDate; selection.endDate = evaluation.revision.endDate;
                        }
                    } catch { sources.push({ source: name, status: 'unreadable', recordCount: 0 }); }
                    selections.push(selection);
                }
            }
        }
        const uniqueSources = [...new Map(sources.map(s => [s.source, s])).values()].sort((a, b) => compareCodeUnits(a.source, b.source));
        limitations.push(...uniqueSources.filter(s => s.status !== 'available'
            && !(s.source === 'intent_blocks' && s.status === 'missing')).map(s => `${s.source}:${s.status}`));
        return { selections, sources: uniqueSources, limitations: [...new Set(limitations)].sort(compareCodeUnits) };
    }

    async loadReview(userId: string, selection: BlockReviewSelection, asOfDate: string): Promise<BlockReviewResult> {
        if (!isValidLocalDateString(asOfDate)) throw new Error('asOfDate must be a Warsaw calendar date');
        const result: BlockReviewResult = { selection, asOfDate, sources: [], limitations: [] };
        const block = await this.loadBlock(userId, selection.blockId, selection.blockRevision);
        result.sources.push(stateSource('intent_block', block));
        if (block.status !== 'AVAILABLE') return finish(result);
        const refs = block.data.block.objectives.flatMap(o => o.successCriteria.evaluationRef ? [o.successCriteria.evaluationRef] : [])
            .filter(ref => ref.id === selection.evaluationId && ref.revision === selection.evaluationRevision);
        if (!refs.length) {
            result.sources.push({ source: 'evaluation_binding', status: 'unsupported', recordCount: 0 });
            return finish(result);
        }
        let evaluation: OutcomeEvaluationSnapshot | null;
        try { evaluation = await this.loadEvaluation(userId, selection.evaluationId, selection.evaluationRevision, asOfDate); }
        catch { result.sources.push({ source: 'evaluation', status: 'unreadable', recordCount: 0 }); return finish(result); }
        result.sources.push(source('evaluation', evaluation ? 1 : 0));
        if (!evaluation) return finish(result);
        if (refs.some(ref => !evaluation.bindings.some(b => b.metricId === ref.metricId))) {
            result.sources.push({ source: 'evaluation_binding', status: 'unreadable', recordCount: 0 }); return finish(result);
        }
        result.evaluation = evaluation;
        const observationsByBinding: Record<string, CurrentObservation[]> = {};
        const attempts = new Map<string, AssessmentAttempt>();
        const attemptLists = new Map<string, Awaited<ReturnType<AssessmentAttemptService['listAttemptsForProtocolWithDiagnostics']>> | null>();
        const defaultWindow = { startDate: '0001-01-01', endDate: asOfDate };
        for (const binding of evaluation.bindings) {
            const name = `assessment:${binding.id}`;
            observationsByBinding[binding.id] = [];
            if (!binding.protocolRef) { result.sources.push({ source: name, status: 'unsupported', recordCount: 0 }); continue; }
            try {
                const ref = binding.protocolRef;
                const protocol = await this.deps.protocols.getRevision(userId, ref.id, ref.revision)
                    ?? PHYSICAL_CAPITAL_PROTOCOL_REVISIONS.find(p => p.id === ref.id && p.revision === ref.revision);
                if (!protocol || !protocol.metricIds.includes(binding.metricId)) {
                    result.sources.push({ source: name, status: 'unsupported', recordCount: 0 }); continue;
                }
                if (!attemptLists.has(ref.id)) {
                    try { attemptLists.set(ref.id, await this.deps.attempts.listAttemptsForProtocolWithDiagnostics(userId, ref.id, BLOCK_REVIEW_MAX_ATTEMPTS)); }
                    catch { attemptLists.set(ref.id, null); }
                }
                const listed = attemptLists.get(ref.id);
                let unreadable = listed?.unreadableCount ?? 0;
                if (listed?.attempts.some(a => a.protocolRef.revision !== ref.revision)) {
                    result.limitations.push(`excluded_protocol_revisions:${binding.id}`);
                }
                const selectedAttempts = (listed?.attempts ?? []).filter(a => a.protocolRef.id === ref.id && a.protocolRef.revision === ref.revision && eligible(a, asOfDate));
                const targetWindow = binding.targetObservationWindow ?? defaultWindow;
                const read = async (key: string, declared = false): Promise<void> => {
                    try {
                        const head = await this.deps.observations.getHead(userId, key);
                        if (!head) { if (declared) result.limitations.push(`declared_baseline_missing:${binding.id}`); return; }
                        const revision = await this.deps.observations.getRevision(userId, key, head.headRevision);
                        if (!revision || revision.observationKey !== key || revision.revision !== head.headRevision
                            || revision.metricId !== binding.metricId || head.metricId !== binding.metricId
                            || head.assessmentAttemptId !== revision.assessmentAttemptId) throw new Error('Head identity mismatch');
                        const parent = selectedAttempts.find(a => a.id === revision.assessmentAttemptId)
                            ?? (declared ? await this.deps.attempts.getAttempt(userId, revision.assessmentAttemptId) : null);
                        if (!parent) { if (declared) result.limitations.push(`declared_baseline_parent_missing:${binding.id}`); return; }
                        if (parent.id !== revision.assessmentAttemptId || parent.protocolRef.id !== revision.protocolRef.id
                            || parent.protocolRef.revision !== revision.protocolRef.revision) throw new Error('Parent identity mismatch');
                        if (revision.protocolRef.id !== ref.id || revision.protocolRef.revision !== ref.revision) {
                            result.limitations.push(`incompatible_protocol:${binding.id}:${key}`); return;
                        }
                        if (!eligible(parent, asOfDate) || dateOf(revision.observedAt) > asOfDate || revision.validity !== 'valid') return;
                        const date = dateOf(revision.observedAt);
                        const inBaseline = binding.baseline.kind === 'declared_observation' ? key === binding.baseline.observationId
                            : date >= binding.baseline.window.startDate && date <= binding.baseline.window.endDate;
                        if (!inBaseline && !(date >= targetWindow.startDate && date <= targetWindow.endDate)) return;
                        attempts.set(parent.id, parent);
                        if (!observationsByBinding[binding.id].some(o => o.revision.observationKey === key)) observationsByBinding[binding.id].push({ head, revision });
                    } catch { unreadable++; }
                };
                if (binding.baseline.kind === 'declared_observation') await read(binding.baseline.observationId, true);
                for (const attempt of selectedAttempts) await read(observationKeyFor(attempt.id, binding.metricId));
                result.sources.push(listed ? source(name, observationsByBinding[binding.id].length, unreadable, listed.truncated)
                    : { source: name, status: 'unreadable', recordCount: observationsByBinding[binding.id].length, unreadableCount: unreadable });
            } catch { result.sources.push({ source: name, status: 'unreadable', recordCount: 0 }); }
        }
        const processEnd = evaluation.revision.endDate < asOfDate ? evaluation.revision.endDate : asOfDate;
        let recommendations: DailyRecommendation[] = [];
        let executions: SessionExecution[] = [];
        let completedSessions: { id: string; date: string }[] = [];
        let ecologicalOutcomes: CompetitionOutcome[] = [];
        let sessionOutcomes: SessionOutcome[] = [];
        const start = evaluation.revision.startDate;
        const through = addDaysToLocalDateString(processEnd, 1);
        const fetchCompetitions = async (): Promise<void> => {
            try {
                const read = await this.deps.competitions.listOutcomesWithDiagnostics(userId, evaluation, asOfDate, 100);
                ecologicalOutcomes = read.outcomes.filter(o => dateOf(o.occurredAt) <= asOfDate);
                if (read.scanLimitReached) result.limitations.push(`ecological_outcomes:scan_limit_${COMPETITION_OUTCOME_MAX_SCANNED_RECORDS}`);
                result.sources.push(source('ecological_outcomes', ecologicalOutcomes.length, read.unreadableCount, read.truncated));
            } catch { result.sources.push({ source: 'ecological_outcomes', status: 'unreadable', recordCount: 0 }); }
        };

        if (processEnd < start || getDayDiff(processEnd, start) >= BLOCK_REVIEW_MAX_PROCESS_DAYS) {
            result.sources.push({ source: 'process_window', status: 'truncated', recordCount: 0 });
            await fetchCompetitions();
        } else {
            const fetchRecommendations = async (): Promise<void> => {
                try {
                    const state = await this.deps.recommendations.getRecommendationsInRange(userId, start, through, BLOCK_REVIEW_MAX_RECORDS);
                    result.sources.push(stateSource('recommendations', state, state.status === 'AVAILABLE' ? state.data.length : 0));
                    if (state.status === 'AVAILABLE') recommendations = state.data;
                } catch { result.sources.push({ source: 'recommendations', status: 'unreadable', recordCount: 0 }); }
            };

            const fetchExecutions = async (): Promise<void> => {
                try {
                    const read = await this.deps.executions.getExecutionHeadersInRange(userId, start, through, BLOCK_REVIEW_MAX_RECORDS);
                    executions = read.executions.filter(e => e.state !== 'in_progress'
                        && dateOf(e.completedAt ?? e.updatedAt) <= asOfDate);
                    result.sources.push(source('executions', executions.length, read.invalidRecords, read.truncated));
                } catch { result.sources.push({ source: 'executions', status: 'unreadable', recordCount: 0 }); }
            };

            const fetchOccurrences = async (): Promise<Awaited<ReturnType<PerformedTrainingOccurrenceRepository['queryActiveInDateWindow']>> | null> => {
                try {
                    return await this.deps.occurrences.queryActiveInDateWindow(userId, start, processEnd, BLOCK_REVIEW_MAX_RECORDS);
                } catch (error) {
                    result.sources.push({ source: 'performed_occurrences', status: String(error).includes('truncated') ? 'truncated' : 'unreadable', recordCount: 0 });
                    return null;
                }
            };

            const [, , occurrences] = await Promise.all([
                fetchRecommendations(),
                fetchExecutions(),
                fetchOccurrences(),
                fetchCompetitions(),
            ]);

            if (occurrences !== null) {
                const completedExecutionIds = new Set(executions.filter(e => e.state === 'completed').map(e => e.executionId));
                completedSessions = occurrences.filter(o => o.localDate && (!o.endedAt || dateOf(o.endedAt) <= asOfDate)
                    && (o.sourceRefs.some(ref => ref.kind === 'provider_activity')
                        || o.sourceRefs.some(ref => ref.kind === 'structured_execution' && completedExecutionIds.has(ref.executionId))))
                    .map(o => ({ id: o.performedOccurrenceId, date: o.localDate! }));
                if (occurrences.some(o => o.reconciliation.state === 'ambiguous')) result.limitations.push('performed_occurrences:ambiguous_reconciliation');
                result.sources.push(source('performed_occurrences', completedSessions.length));
            }

            sessionOutcomes = await this.loadResponses(userId, executions, start, processEnd, asOfDate, result);
        }
        result.sources.push({ source: 'weekly_roles', status: 'unsupported', recordCount: 0 });
        result.limitations.push('weekly_roles:no_frozen_occurrence_binding', 'reliability:no_series_estimate_reader', 'performed_comparison:not_loaded',
            `tissue_followup_bound:${TISSUE_LOOKAHEAD_DAYS}_days`);
        finish(result);
        const observations = [...new Map(Object.values(observationsByBinding).flat().map(o => [o.revision.observationKey, o])).values()]
            .sort((a, b) => compareCodeUnits(a.revision.observationKey, b.revision.observationKey));
        const incompleteBindings = new Set(evaluation.bindings.filter(binding => result.sources.some(s =>
            s.source === `assessment:${binding.id}` && ['unreadable', 'truncated', 'unsupported'].includes(s.status))).map(b => b.id));
        const safeObservationsByBinding = Object.fromEntries(Object.entries(observationsByBinding)
            .map(([id, rows]) => [id, incompleteBindings.has(id) ? [] : rows]));
        const bindingProgress = evaluation.bindings.map(binding => {
            const progress = deriveProgress(binding.targetObservationWindow ? binding : { ...binding, targetObservationWindow: defaultWindow }, safeObservationsByBinding[binding.id]);
            return { bindingId: binding.id, metricId: binding.metricId, frozenBinding: binding,
                ...(binding.protocolRef ? { protocolRef: binding.protocolRef } : {}),
                progress: incompleteBindings.has(binding.id) ? { ...progress, reasons: ['assessment_source_incomplete'] } : progress };
        });
        const report = this.deps.reports.buildReport({ evaluation, observations, observationsByBinding: safeObservationsByBinding,
            defaultTargetObservationWindow: defaultWindow, assessmentAttempts: [...attempts.values()], recommendations,
            completedSessions, sessionOutcomes, ecologicalOutcomes, keyRoles: { plannedOccurrenceIds: [], completedOccurrenceIds: [] } });
        const incomplete = result.sources.some(s => ['unreadable', 'unsupported', 'truncated'].includes(s.status));
        result.report = { ...report,
            metricProgress: bindingProgress.map(b => b.progress).sort((a, b) => compareCodeUnits(a.metricId, b.metricId)
                || compareCodeUnits(a.baselineObservationId ?? '', b.baselineObservationId ?? '')
                || compareCodeUnits(a.latestObservationId ?? '', b.latestObservationId ?? '')),
            ...(incomplete ? { verdict: 'insufficient_evidence' as const, reasons: [...report.reasons, 'review_sources_incomplete'] } : {}),
            reviewProvenance: { readerVersion: BLOCK_REVIEW_READER_VERSION, reportVersion: BLOCK_REVIEW_REPORT_VERSION,
                asOfDate, blockRef: { id: block.data.blockId, revision: block.data.revision, contentHash: block.data.contentHash },
                sources: result.sources, limitations: result.limitations,
                bindings: bindingProgress,
                observations: observations.map(o => ({ observationId: o.revision.observationKey, revision: o.revision.revision,
                    assessmentAttemptId: o.revision.assessmentAttemptId, protocolId: o.revision.protocolRef.id,
                    protocolRevision: o.revision.protocolRef.revision, metricId: o.revision.metricId,
                    comparisonSeriesKey: o.revision.comparisonSeriesKey, comparisonCanonicalizationVersion: o.revision.comparisonCanonicalizationVersion,
                    canonicalRevision: o.revision })),
                assessmentAttempts: [...attempts.values()].sort((a, b) => compareCodeUnits(a.id, b.id)),
                performedOccurrenceIds: completedSessions.map(s => s.id).sort(compareCodeUnits),
            } };
        return result;
    }

    private async loadResponses(userId: string, executions: readonly SessionExecution[], startDate: string,
        endDate: string, asOfDate: string, result: BlockReviewResult): Promise<SessionOutcome[]> {
        const tissueByExecution = new Map<string, RegionTissueResponse[]>();
        let unreadable = 0;
        let readCount = 0;
        const end = addDaysToLocalDateString(endDate, TISSUE_LOOKAHEAD_DAYS);
        const checkinEnd = end < asOfDate ? end : asOfDate;
        // shortcut: follow-ups beyond seven days require an explicit bounded linkage reader.
        const checkinDates: string[] = [];
        for (let date = startDate; date <= checkinEnd; date = addDaysToLocalDateString(date, 1)) {
            checkinDates.push(date);
        }

        const checkinStates = await Promise.all(
            checkinDates.map(async date => {
                try {
                    return await this.deps.checkins.getCheckinState(userId, date);
                } catch {
                    return null;
                }
            })
        );

        for (const state of checkinStates) {
            if (!state) {
                unreadable++;
            } else if (state.status === 'AVAILABLE') {
                readCount++;
                for (const tissue of Object.values(state.data.tissueResponses ?? {})) {
                    if (tissue.sourceSessionRef?.kind !== 'execution') continue;
                    const items = tissueByExecution.get(tissue.sourceSessionRef.id) ?? [];
                    items.push(tissue); tissueByExecution.set(tissue.sourceSessionRef.id, items);
                }
            } else if (state.status !== 'MISSING') unreadable++;
        }

        const outcomes: SessionOutcome[] = [];
        const windows = ['immediate', 'later_day', 'next_morning'] as ResponseWindow[];

        for (const execution of executions) {
            const sourceSession = { kind: 'execution' as const, id: execution.executionId, date: execution.date };
            const responseStates = await Promise.all(
                windows.map(async window => {
                    try {
                        return { window, state: await this.deps.responses.getResponse(userId, sessionResponseDocId(sourceSession, window)) };
                    } catch {
                        return { window, state: null };
                    }
                })
            );

            const responses: SessionResponse[] = [];
            for (const { window, state } of responseStates) {
                if (!state) {
                    unreadable++;
                } else if (state.status === 'AVAILABLE') {
                    const r = state.data;
                    if (r.userId !== userId || r.sourceSession.kind !== 'execution' || r.sourceSession.id !== execution.executionId
                        || r.sourceSession.date !== execution.date || r.window !== window) { unreadable++; continue; }
                    if (r.date <= asOfDate && dateOf(r.createdAt) <= asOfDate) { responses.push(r); readCount++; }
                } else if (state.status !== 'MISSING') unreadable++;
            }
            outcomes.push(deriveSessionOutcome({ sourceSession, responses, tissueResponses: tissueByExecution.get(execution.executionId) ?? [] }));
        }
        result.sources.push(source('session_responses', readCount, unreadable));
        return outcomes;
    }
}
export const blockReviewService = new BlockReviewService();
