import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AssessmentAttempt, MetricObservationHead, MetricObservationRevision } from '../observations/models';
import type { OutcomeEvaluationSnapshot } from '../outcomes/evaluationSpec';
import { hashEvaluationContent } from '../outcomes/evaluationHash';
import { blockOutcomeReportToCsv, blockOutcomeReportToJson } from '../outcomes/blockOutcomeReport';

vi.mock('../firebase', () => ({ getDb: () => ({}) }));
import { BlockReviewService, BLOCK_REVIEW_MAX_ATTEMPTS, BLOCK_REVIEW_MAX_BLOCKS, BLOCK_REVIEW_MAX_EVALUATIONS } from './blockReviewService';

const metricId = 'cycling_tt_20m_mean_power_w';
const baselineKey = `baseline:${metricId}`;
const selection = { blockId: 'block', blockRevision: 1, evaluationId: 'eval', evaluationRevision: 1 };
const asOfDate = '2026-10-10';
function attempt(id: string, date: string, patch: Partial<AssessmentAttempt> = {}): AssessmentAttempt {
    return { id, protocolRef: { id: 'cycling-20m-tt', revision: 1 }, state: 'completed', purpose: 'checkpoint',
        startedAt: `${date}T08:00:00Z`, completedAt: `${date}T09:00:00Z`, ...patch };
}
function observation(id: string, date: string, value: number, patch: Partial<MetricObservationRevision> = {}) {
    const revision: MetricObservationRevision = { observationKey: `${id}:${metricId}`, revision: 1, metricId,
        value, unit: 'W', observedAt: `${date}T09:00:00Z`, source: 'manual', protocolRef: { id: 'cycling-20m-tt', revision: 1 },
        comparisonSeriesKey: 'series', comparisonCanonicalizationVersion: 'comparison-series-v1',
        assessmentAttemptId: id, validity: 'valid', context: { position: 'seated' }, createdAt: `${date}T09:00:00Z`, ...patch };
    const head: MetricObservationHead = { observationKey: revision.observationKey, assessmentAttemptId: id,
        metricId: revision.metricId, headRevision: revision.revision, createdAt: revision.createdAt, updatedAt: revision.createdAt };
    return { head, revision };
}
async function setup() {
    const evaluation: OutcomeEvaluationSnapshot = { revision: { id: 'eval', revision: 1, title: 'Explicit evaluation',
        startDate: '2026-08-01', endDate: '2026-08-31', status: 'active', activatedAt: '2026-07-30T09:00:00Z',
        contentHash: '', createdAt: '2026-07-29T09:00:00Z' }, bindings: [{ id: 'p20', metricId, protocolRef: { id: 'cycling-20m-tt', revision: 1 },
        role: 'primary', expectedDirection: { kind: 'higher_is_better' },
        baseline: { kind: 'declared_observation', observationId: baselineKey }, rationale: 'Explicit criterion' }] };
    evaluation.revision.contentHash = await hashEvaluationContent(evaluation);
    const block = { id: 'block', revision: 1, title: 'Block title', dateRange: { startDate: '2026-08-01', endDate: '2026-08-31' },
        objectives: [{ successCriteria: { evaluationRef: { id: 'eval', revision: 1, metricId } } }] };
    const document = { userId: 'u1', blockId: 'block', revision: 1, contentHash: 'block-hash', block };
    const rows = new Map<string, ReturnType<typeof observation>>([[baselineKey, observation('baseline', '2026-07-01', 200)]]);
    const parents = new Map<string, AssessmentAttempt>([['baseline', attempt('baseline', '2026-07-01', { purpose: 'baseline' })]]);
    const deps = {
        blocks: { listBlockIds: vi.fn().mockResolvedValue({ status: 'AVAILABLE', data: ['block'], revision: null }),
            getHeaderState: vi.fn().mockResolvedValue({ status: 'AVAILABLE', data: { revision: 1, contentHash: 'block-hash' }, revision: null }),
            getRevisionState: vi.fn().mockResolvedValue({ status: 'AVAILABLE', data: document, revision: '1' }) },
        evaluations: { getRevision: vi.fn().mockImplementation(async () => evaluation) },
        attempts: { listAttemptsForProtocolWithDiagnostics: vi.fn().mockResolvedValue({ attempts: [], unreadableCount: 0, truncated: false }),
            getAttempt: vi.fn().mockImplementation(async (_user: string, id: string) => parents.get(id) ?? null) },
        observations: { getHead: vi.fn().mockImplementation(async (_user: string, key: string) => rows.get(key)?.head ?? null),
            getRevision: vi.fn().mockImplementation(async (_user: string, key: string) => rows.get(key)?.revision ?? null) },
        protocols: { getRevision: vi.fn().mockResolvedValue({ id: 'cycling-20m-tt', revision: 1, metricIds: [metricId] }) },
        recommendations: { getRecommendationsInRange: vi.fn().mockResolvedValue({ status: 'AVAILABLE', data: [], revision: null }) },
        executions: { getExecutionHeadersInRange: vi.fn().mockResolvedValue({ executions: [], invalidRecords: 0, truncated: false }) },
        occurrences: { queryActiveInDateWindow: vi.fn().mockResolvedValue([]) },
        responses: { getResponse: vi.fn().mockResolvedValue({ status: 'MISSING' }) },
        checkins: { getCheckinState: vi.fn().mockResolvedValue({ status: 'MISSING' }) },
        competitions: { listOutcomesWithDiagnostics: vi.fn().mockResolvedValue({ outcomes: [], unreadableCount: 0, truncated: false }) },
    };
    const service = new BlockReviewService(deps as never);
    const add = (id: string, date: string, value: number, rowPatch: Partial<MetricObservationRevision> = {}, parentPatch: Partial<AssessmentAttempt> = {}) => {
        const row = observation(id, date, value, rowPatch); rows.set(row.revision.observationKey, row);
        parents.set(id, attempt(id, date, parentPatch));
        deps.attempts.listAttemptsForProtocolWithDiagnostics.mockResolvedValue({ attempts: [...parents.values()].filter(p => p.id !== 'baseline'), unreadableCount: 0, truncated: false });
    };
    return { service, deps, evaluation, block, document, rows, parents, add };
}

beforeEach(() => vi.clearAllMocks());
describe('BlockReviewService frozen selection', () => {
    it('lists only explicit refs from validated current intent revisions with bounded reads', async () => {
        const { service, deps } = await setup();
        const listed = await service.listReviews('u1', asOfDate);
        expect(listed.selections).toEqual([{ ...selection, title: 'Block title', startDate: '2026-08-01', endDate: '2026-08-31' }]);
        expect(deps.blocks.listBlockIds).toHaveBeenCalledWith('u1', BLOCK_REVIEW_MAX_BLOCKS);
        expect(deps.evaluations.getRevision).toHaveBeenCalledWith('u1', 'eval', 1);
    });
    it('loads intent blocks concurrently', async () => {
        const { service, deps } = await setup();
        let release!: () => void;
        const headersReady = new Promise<void>(resolve => { release = resolve; });
        deps.blocks.listBlockIds.mockResolvedValue({ status: 'AVAILABLE', data: ['block', 'block-2'], revision: null });
        deps.blocks.getHeaderState.mockImplementation(() => headersReady.then(() => ({
            status: 'AVAILABLE' as const, data: { revision: 1, contentHash: 'block-hash' }, revision: null,
        })));

        const reviewsPromise = service.listReviews('u1', asOfDate);
        await Promise.resolve();
        expect(deps.blocks.getHeaderState).toHaveBeenCalledTimes(2);
        release();

        await reviewsPromise;
    });
    it('does not infer an evaluation from the title or objective vocabulary', async () => {
        const { service, block, deps } = await setup();
        block.objectives = [];
        expect((await service.listReviews('u1', asOfDate)).selections).toEqual([]);
        expect(deps.evaluations.getRevision).not.toHaveBeenCalled();
    });
    it('distinguishes an unreadable block list from an empty missing source', async () => {
        const { service, deps } = await setup();
        deps.blocks.listBlockIds.mockResolvedValue({ status: 'UNAVAILABLE', operation: 'read', retryable: true });
        const unreadable = await service.listReviews('u1', asOfDate);
        expect(unreadable.selections).toEqual([]);
        expect(unreadable.limitations).toContain('intent_blocks:unreadable');
        deps.blocks.listBlockIds.mockResolvedValue({ status: 'MISSING' });
        const missing = await service.listReviews('u1', asOfDate);
        expect(missing.sources).toContainEqual({ source: 'intent_blocks', status: 'missing', recordCount: 0 });
        expect(missing.limitations).not.toContain('intent_blocks:unreadable');
    });
    it('lists missing/corrupt exact refs for inspection but refuses a report or export', async () => {
        const { service, deps, evaluation } = await setup();
        deps.evaluations.getRevision.mockResolvedValueOnce(null);
        const list = await service.listReviews('u1', asOfDate);
        expect(list.selections).toHaveLength(1);
        expect(list.limitations).toContain('evaluation:eval@1:missing');
        evaluation.revision.contentHash = 'forged';
        expect((await service.listReviews('u1', asOfDate)).selections).toHaveLength(1);
        const read = await service.loadReview('u1', selection, asOfDate);
        expect(read.report).toBeUndefined(); expect(read.evaluation).toBeUndefined();
        expect(read.sources).toContainEqual({ source: 'evaluation', status: 'unreadable', recordCount: 0 });
    });
    it('caps distinct evaluation references globally and reuses exact-revision reads', async () => {
        const { service, block, deps } = await setup();
        block.objectives = Array.from({ length: BLOCK_REVIEW_MAX_EVALUATIONS + 1 }, (_, i) => ({ successCriteria: { evaluationRef: { id: `e${i}`, revision: 1, metricId } } }));
        deps.evaluations.getRevision.mockResolvedValue(null);
        const list = await service.listReviews('u1', asOfDate);
        expect(deps.evaluations.getRevision).toHaveBeenCalledTimes(BLOCK_REVIEW_MAX_EVALUATIONS);
        expect(list.sources).toContainEqual({ source: 'evaluation_refs', status: 'truncated', recordCount: BLOCK_REVIEW_MAX_EVALUATIONS });
        expect(list.selections).toHaveLength(BLOCK_REVIEW_MAX_EVALUATIONS);
    });
    it('rejects a moved intent head, hash mismatch, and a non-bound selection', async () => {
        const { service, deps } = await setup();
        expect((await service.loadReview('u1', { ...selection, blockRevision: 2 }, asOfDate)).report).toBeUndefined();
        deps.blocks.getHeaderState.mockResolvedValueOnce({ status: 'AVAILABLE', data: { revision: 1, contentHash: 'wrong' }, revision: null });
        expect((await service.loadReview('u1', selection, asOfDate)).report).toBeUndefined();
        const unbound = await service.loadReview('u1', { ...selection, evaluationRevision: 2 }, asOfDate);
        expect(unbound.sources).toContainEqual({ source: 'evaluation_binding', status: 'unsupported', recordCount: 0 });
    });
});

describe('BlockReviewService assessment evidence', () => {
    it('keeps squat and bench separate even when the metric and supplied series key coincide', async () => {
        const s = await setup();
        const strengthMetric = 'strength_1rm_kg';
        const subjects = [
            { id: 'bench', protocol: 'strength-bench-press-1rm', baseline: 80, post: 85 },
            { id: 'squat', protocol: 'strength-back-squat-1rm', baseline: 140, post: 150 },
        ];
        s.evaluation.bindings = subjects.map(subject => ({ id: subject.id, metricId: strengthMetric,
            role: 'primary', expectedDirection: { kind: 'higher_is_better' }, rationale: 'Exact strength protocol',
            protocolRef: { id: subject.protocol, revision: 1 },
            baseline: { kind: 'declared_observation', observationId: `${subject.id}-baseline:${strengthMetric}` } }));
        s.evaluation.revision.contentHash = await hashEvaluationContent(s.evaluation);
        s.block.objectives[0].successCriteria.evaluationRef.metricId = strengthMetric;
        for (const subject of subjects) {
            const protocolRef = { id: subject.protocol, revision: 1 };
            for (const [suffix, date, value] of [['baseline', '2026-07-01', subject.baseline], ['post', '2026-09-02', subject.post]] as const) {
                const id = `${subject.id}-${suffix}`;
                const row = observation(id, date, value, { metricId: strengthMetric, unit: 'kg', protocolRef,
                    observationKey: `${id}:${strengthMetric}` });
                s.rows.set(row.revision.observationKey, row);
                s.parents.set(id, attempt(id, date, { protocolRef }));
            }
        }
        s.deps.protocols.getRevision.mockImplementation(async (_user: string, id: string) => ({ id, revision: 1, metricIds: [strengthMetric] }));
        s.deps.attempts.listAttemptsForProtocolWithDiagnostics.mockImplementation(async (_user: string, id: string) => ({
            attempts: [...s.parents.values()].filter(parent => parent.protocolRef.id === id), unreadableCount: 0, truncated: false,
        }));
        const report = (await s.service.loadReview('u1', selection, asOfDate)).report!;
        expect(report.reviewProvenance?.bindings.map(binding => [binding.bindingId, binding.progress.absoluteChange])).toEqual([
            ['bench', 5], ['squat', 10],
        ]);
        expect(blockOutcomeReportToCsv(report)).toContain('strength-bench-press-1rm');
        expect(blockOutcomeReportToCsv(report)).toContain('strength-back-squat-1rm');
    });
    it('reads a declared baseline directly outside the block, retaining baseline-only evidence', async () => {
        const { service, deps } = await setup();
        const read = await service.loadReview('u1', selection, asOfDate);
        expect(deps.observations.getHead).toHaveBeenCalledWith('u1', baselineKey);
        expect(deps.attempts.getAttempt).toHaveBeenCalledWith('u1', 'baseline');
        expect(deps.attempts.listAttemptsForProtocolWithDiagnostics).toHaveBeenCalledWith('u1', 'cycling-20m-tt', BLOCK_REVIEW_MAX_ATTEMPTS);
        expect(read.report?.metricProgress[0]).toMatchObject({ baselineObservationId: baselineKey, status: 'insufficient_evidence' });
        expect(read.report?.metricProgress[0].latestObservationId).toBeUndefined();
    });
    it('accepts a compatible post-block repeat more than 28 days later through asOf, without inventing reliability', async () => {
        const { service, add } = await setup(); add('post', '2026-10-03', 220);
        const read = await service.loadReview('u1', selection, asOfDate);
        expect(read.report?.metricProgress[0]).toMatchObject({ baselineObservationId: baselineKey,
            latestObservationId: `post:${metricId}`, absoluteChange: 20, percentChange: 10, comparable: true, status: 'insufficient_evidence' });
        expect(read.report?.metricProgress[0].reasons).toContain('no_reliability_estimate');
    });
    it('honors frozen target windows, while excluding future observations and future completions', async () => {
        const { service, add, evaluation } = await setup();
        evaluation.bindings = [{ ...evaluation.bindings[0], targetObservationWindow: { startDate: '2026-09-01', endDate: '2026-09-30' } }];
        evaluation.revision.contentHash = await hashEvaluationContent(evaluation);
        add('inside', '2026-09-02', 210); add('outside', '2026-10-03', 220);
        add('future', '2026-10-11', 250); add('future-completion', '2026-09-09', 240, {}, { completedAt: '2026-10-11T10:00:00Z' });
        expect((await service.loadReview('u1', selection, asOfDate)).report?.metricProgress[0].latestObservationId).toBe(`inside:${metricId}`);
    });
    it.each(['familiarization', 'abandoned', 'in_progress', 'unknown_parent', 'invalid_head'] as const)('excludes %s evidence', async kind => {
        const { service, add, rows, parents } = await setup();
        if (kind === 'familiarization') add('bad', '2026-09-02', 250, {}, { purpose: 'familiarization' });
        else if (kind === 'abandoned' || kind === 'in_progress') add('bad', '2026-09-02', 250, {}, { state: kind, completedAt: undefined });
        else if (kind === 'unknown_parent') { parents.delete('baseline'); }
        else { rows.get(baselineKey)!.revision.validity = 'invalid'; }
        const report = (await service.loadReview('u1', selection, asOfDate)).report;
        expect(report?.metricProgress[0].latestObservationId).toBeUndefined();
        expect(report?.metricProgress[0].absoluteChange).toBeUndefined();
    });
    it('uses current correction only and fails closed on a head/revision mismatch', async () => {
        const { service, rows, add } = await setup(); add('post', '2026-09-02', 220);
        const baseline = rows.get(baselineKey)!;
        baseline.head.headRevision = 2; baseline.revision = { ...baseline.revision, revision: 2, value: 205 };
        const valid = await service.loadReview('u1', selection, asOfDate);
        expect(valid.report?.metricProgress[0].absoluteChange).toBe(15);
        expect(valid.report?.reviewProvenance?.observations[0].revision).toBe(2);
        baseline.head.headRevision = 3;
        const invalid = await service.loadReview('u1', selection, asOfDate);
        expect(invalid.report?.metricProgress[0].absoluteChange).toBeUndefined();
        expect(invalid.report?.metricProgress[0].reasons).toEqual(['assessment_source_incomplete']);
    });
    it('keeps incompatible context non-comparable and does not bridge protocol revisions', async () => {
        const { service, add } = await setup();
        add('context', '2026-09-02', 220, { comparisonSeriesKey: 'different' });
        expect((await service.loadReview('u1', selection, asOfDate)).report?.metricProgress[0].status).toBe('non_comparable');
        add('revision2', '2026-09-03', 250, { protocolRef: { id: 'cycling-20m-tt', revision: 2 } }, { protocolRef: { id: 'cycling-20m-tt', revision: 2 } });
        const read = await service.loadReview('u1', selection, asOfDate);
        expect(read.report?.metricProgress[0].absoluteChange).toBeUndefined();
        expect(read.limitations).toContain('excluded_protocol_revisions:p20');
    });
    it('selects a baseline from the frozen window rather than the global earliest test', async () => {
        const { service, add, evaluation } = await setup();
        evaluation.bindings = [{ ...evaluation.bindings[0], baseline: { kind: 'first_valid_in_window',
            window: { startDate: '2026-08-01', endDate: '2026-08-05' }, selection: 'earliest_valid' } }];
        evaluation.revision.contentHash = await hashEvaluationContent(evaluation);
        add('window', '2026-08-02', 210); add('post', '2026-09-02', 220);
        expect((await service.loadReview('u1', selection, asOfDate)).report?.metricProgress[0]).toMatchObject({ baselineObservationId: `window:${metricId}`, absoluteChange: 10 });
    });
    it.each(['truncated', 'unreadable'] as const)('withholds comparison numbers for an %s sample while retaining canonical fetched evidence', async state => {
        const { service, add, deps, parents } = await setup(); add('post', '2026-09-02', 220);
        deps.attempts.listAttemptsForProtocolWithDiagnostics.mockResolvedValue({ attempts: [...parents.values()], unreadableCount: state === 'unreadable' ? 1 : 0, truncated: state === 'truncated' });
        const read = await service.loadReview('u1', selection, asOfDate);
        expect(read.report?.metricProgress[0]).toMatchObject({ comparable: false, status: 'insufficient_evidence', reasons: ['assessment_source_incomplete'] });
        expect(read.report?.metricProgress[0].baselineObservationId).toBeUndefined();
        expect(read.report?.metricProgress[0].absoluteChange).toBeUndefined();
        expect(read.report?.reviewProvenance?.observations).toHaveLength(2);
        expect(read.report?.verdict).toBe('insufficient_evidence');
    });
    it('surfaces missing protocol identity as unsupported, and transport failures as unreadable', async () => {
        const { service, evaluation, deps } = await setup();
        evaluation.bindings = evaluation.bindings.map(binding => ({ ...binding, protocolRef: undefined }));
        evaluation.revision.contentHash = await hashEvaluationContent(evaluation);
        const unsupported = await service.loadReview('u1', selection, asOfDate);
        expect(unsupported.sources).toContainEqual({ source: 'assessment:p20', status: 'unsupported', recordCount: 0 });
        evaluation.bindings = [{ ...evaluation.bindings[0], protocolRef: { id: 'cycling-20m-tt', revision: 1 } }];
        evaluation.revision.contentHash = await hashEvaluationContent(evaluation);
        deps.attempts.listAttemptsForProtocolWithDiagnostics.mockRejectedValue(new Error('offline'));
        const unavailable = await service.loadReview('u1', selection, asOfDate);
        expect(unavailable.sources.find(s => s.source === 'assessment:p20')?.status).toBe('unreadable');
    });
});

describe('BlockReviewService exports and process joins', () => {
    it('loads independent process sources concurrently', async () => {
        const { service, deps } = await setup();
        let release!: () => void;
        const readsReady = new Promise<void>(resolve => { release = resolve; });
        deps.recommendations.getRecommendationsInRange.mockImplementation(() => readsReady.then(() => ({ status: 'AVAILABLE', data: [], revision: null })));
        deps.executions.getExecutionHeadersInRange.mockImplementation(() => readsReady.then(() => ({ executions: [], invalidRecords: 0, truncated: false })));
        deps.occurrences.queryActiveInDateWindow.mockImplementation(() => readsReady.then(() => []));
        deps.competitions.listOutcomesWithDiagnostics.mockImplementation(() => readsReady.then(() => ({ outcomes: [], unreadableCount: 0, truncated: false })));

        const reviewPromise = service.loadReview('u1', selection, asOfDate);
        await vi.waitFor(() => expect(deps.recommendations.getRecommendationsInRange).toHaveBeenCalledTimes(1));
        expect(deps.executions.getExecutionHeadersInRange).toHaveBeenCalledTimes(1);
        expect(deps.occurrences.queryActiveInDateWindow).toHaveBeenCalledTimes(1);
        expect(deps.competitions.listOutcomesWithDiagnostics).toHaveBeenCalledTimes(1);
        release();

        await reviewPromise;
    });
    it('passes the exact evaluation and as-of scope to the bounded ecological reader', async () => {
        const { service, deps, evaluation } = await setup();
        deps.competitions.listOutcomesWithDiagnostics.mockResolvedValue({ outcomes: [], unreadableCount: 0,
            truncated: true, scanLimitReached: true });
        const read = await service.loadReview('u1', selection, asOfDate);
        expect(deps.competitions.listOutcomesWithDiagnostics).toHaveBeenCalledWith('u1', evaluation, asOfDate, 100);
        expect(read.sources.find(s => s.source === 'ecological_outcomes')?.status).toBe('truncated');
        expect(read.report?.reviewProvenance?.limitations).toContain('ecological_outcomes:scan_limit_200');
    });
    it('preserves multiple historical policy contexts and explicitly unknown records without attribution', async () => {
        const s = await setup();
        s.deps.recommendations.getRecommendationsInRange.mockResolvedValue({ status: 'AVAILABLE', revision: null,
            data: ['2026-08-01', '2026-08-02', '2026-08-03'].map((date, index) => ({ date, revision: 1, category: 'Rest',
                createdAt: `${date}T08:00:00Z`, updatedAt: `${date}T08:00:00Z`,
                adherence: { respondedAt: null, followed: null, skipped: false },
                recommendationAudit: index === 1 ? undefined : { policyVersion: `policy-${index / 2}` },
            })) });
        const report = (await s.service.loadReview('u1', selection, asOfDate)).report!;
        expect(report.policySegments.map(segment => segment.policyVersion)).toEqual(['policy-0', 'unknown', 'policy-1']);
        expect(blockOutcomeReportToCsv(report)).toContain('policy-0');
        expect(blockOutcomeReportToCsv(report)).toContain('policy-1');
        expect(blockOutcomeReportToJson(report)).toContain('"planningMode":"unknown"');
    });
    it('exports frozen criteria and complete canonical provenance deterministically without a new truth store', async () => {
        const { service, add, evaluation } = await setup(); add('post', '2026-09-02', 220);
        const first = (await service.loadReview('u1', selection, asOfDate)).report!;
        const second = (await service.loadReview('u1', selection, asOfDate)).report!;
        expect(blockOutcomeReportToJson(first)).toBe(blockOutcomeReportToJson(second));
        expect(blockOutcomeReportToCsv(first)).toBe(blockOutcomeReportToCsv(second));
        expect(first.reviewProvenance?.bindings[0].frozenBinding).toEqual(evaluation.bindings[0]);
        expect(first.reviewProvenance?.observations[0].canonicalRevision).toMatchObject({ value: 200, unit: 'W', context: { position: 'seated' } });
        expect(first.reviewProvenance?.assessmentAttempts).toHaveLength(2);
        expect(first.evaluationRef.contentHash).toBe(evaluation.revision.contentHash);
        expect(blockOutcomeReportToCsv(first)).toContain('comparisonSeriesKey');
        expect(blockOutcomeReportToCsv(first)).toContain('block-review-reader-v1');
        expect(first.reviewProvenance?.sources.find(s => s.source === 'weekly_roles')?.status).toBe('unsupported');
        expect(first.verdict).toBe('insufficient_evidence');
    });
    it('joins bounded canonical occurrences and response facts by exact execution source identity', async () => {
        const { service, deps } = await setup();
        const execution = { executionId: 'ex', date: '2026-08-05', state: 'completed', completedAt: '2026-08-05T12:00:00Z', updatedAt: '2026-08-05T12:00:00Z' };
        deps.executions.getExecutionHeadersInRange.mockResolvedValue({ executions: [execution], invalidRecords: 0, truncated: false });
        deps.occurrences.queryActiveInDateWindow.mockResolvedValue([{ performedOccurrenceId: 'canonical', localDate: '2026-08-05',
            sourceRefs: [{ kind: 'structured_execution', executionId: 'ex' }], reconciliation: { state: 'single_source' } }]);
        deps.responses.getResponse.mockImplementation(async (_user: string, id: string) => id.endsWith('later_day') ? { status: 'AVAILABLE', revision: null, data: {
            userId: 'u1', responseId: id, sourceSession: { kind: 'execution', id: 'ex', date: '2026-08-05' },
            window: 'later_day', date: '2026-08-05', createdAt: '2026-08-05T18:00:00Z', unexpectedFatigue: false,
        } } : { status: 'MISSING' });
        const read = await service.loadReview('u1', selection, asOfDate);
        expect(read.report?.process.completedSessionCount).toBe(1);
        expect(read.report?.reviewProvenance?.performedOccurrenceIds).toEqual(['canonical']);
        expect(read.report?.process.sourceIds.sessionIds).toEqual(['canonical', 'ex']);
        expect(deps.responses.getResponse).toHaveBeenCalledTimes(3);
        expect(read.report?.policySegments.some(s => s.policyVersion === 'unknown')).toBe(true);
    });
    it('surfaces process truncation/invalid rows and never presents their empty counts as complete', async () => {
        const { service, deps } = await setup();
        deps.executions.getExecutionHeadersInRange.mockResolvedValue({ executions: [], invalidRecords: 1, truncated: true });
        deps.recommendations.getRecommendationsInRange.mockResolvedValue({ status: 'UNAVAILABLE', operation: 'read', retryable: true });
        const read = await service.loadReview('u1', selection, asOfDate);
        expect(read.sources.find(s => s.source === 'executions')?.status).toBe('truncated');
        expect(read.sources.find(s => s.source === 'recommendations')?.status).toBe('unreadable');
        expect(read.report?.reasons).toContain('review_sources_incomplete');
    });
    it('preserves the bounded recommendation reader truncation diagnostic', async () => {
        const { service, deps } = await setup();
        deps.recommendations.getRecommendationsInRange.mockResolvedValue({ status: 'INVALID',
            issues: [{ code: 'recommendation-history-truncated', documentPath: 'users/u1/recommendations' }] });
        const read = await service.loadReview('u1', selection, asOfDate);
        expect(read.sources.find(s => s.source === 'recommendations')?.status).toBe('truncated');
        expect(read.report?.reviewProvenance?.limitations).toContain('recommendations:truncated');
        expect(read.report?.reasons).toContain('review_sources_incomplete');
    });
});
