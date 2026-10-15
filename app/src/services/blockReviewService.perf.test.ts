import { describe, expect, it, vi } from 'vitest';
import type { AssessmentAttempt, MetricObservationHead, MetricObservationRevision } from '../observations/models';
import type { OutcomeEvaluationSnapshot } from '../outcomes/evaluationSpec';
import { hashEvaluationContent } from '../outcomes/evaluationHash';

vi.mock('../firebase', () => ({ getDb: () => ({}) }));
import { BlockReviewService } from './blockReviewService';

const metricId = 'cycling_tt_20m_mean_power_w';
const baselineKey = `baseline:${metricId}`;
const selection = { blockId: 'block', blockRevision: 1, evaluationId: 'eval', evaluationRevision: 1 };
const asOfDate = '2026-10-10';

function attempt(id: string, date: string): AssessmentAttempt {
    return {
        id,
        protocolRef: { id: 'cycling-20m-tt', revision: 1 },
        state: 'completed',
        purpose: 'checkpoint',
        startedAt: `${date}T08:00:00Z`,
        completedAt: `${date}T09:00:00Z`,
    };
}

function observation(id: string, date: string, value: number) {
    const revision: MetricObservationRevision = {
        observationKey: `${id}:${metricId}`,
        revision: 1,
        metricId,
        value,
        unit: 'W',
        observedAt: `${date}T09:00:00Z`,
        source: 'manual',
        protocolRef: { id: 'cycling-20m-tt', revision: 1 },
        comparisonSeriesKey: 'series',
        comparisonCanonicalizationVersion: 'comparison-series-v1',
        assessmentAttemptId: id,
        validity: 'valid',
        context: { position: 'seated' },
        createdAt: `${date}T09:00:00Z`,
    };
    const head: MetricObservationHead = {
        observationKey: revision.observationKey,
        assessmentAttemptId: id,
        metricId: revision.metricId,
        headRevision: revision.revision,
        createdAt: revision.createdAt,
        updatedAt: revision.createdAt,
    };
    return { head, revision };
}

describe('BlockReviewService observation read concurrency benchmark', () => {
    it('measures loadReview performance when reading observations for multiple selected attempts', async () => {
        const evaluation: OutcomeEvaluationSnapshot = {
            revision: {
                id: 'eval',
                revision: 1,
                title: 'Explicit evaluation',
                startDate: '2026-08-01',
                endDate: '2026-08-31',
                status: 'active',
                activatedAt: '2026-07-30T09:00:00Z',
                contentHash: '',
                createdAt: '2026-07-29T09:00:00Z',
            },
            bindings: [
                {
                    id: 'p20',
                    metricId,
                    protocolRef: { id: 'cycling-20m-tt', revision: 1 },
                    role: 'primary',
                    expectedDirection: { kind: 'higher_is_better' },
                    baseline: { kind: 'declared_observation', observationId: baselineKey },
                    rationale: 'Explicit criterion',
                },
            ],
        };
        evaluation.revision.contentHash = await hashEvaluationContent(evaluation);

        const block = {
            id: 'block',
            revision: 1,
            title: 'Block title',
            dateRange: { startDate: '2026-08-01', endDate: '2026-08-31' },
            objectives: [{ successCriteria: { evaluationRef: { id: 'eval', revision: 1, metricId } } }],
        };
        const document = { userId: 'u1', blockId: 'block', revision: 1, contentHash: 'block-hash', block };

        const rows = new Map<string, ReturnType<typeof observation>>([
            [baselineKey, observation('baseline', '2026-07-01', 200)],
        ]);
        const parents = new Map<string, AssessmentAttempt>([
            ['baseline', attempt('baseline', '2026-07-01')],
        ]);

        const simulatedAsyncDelay = 2; // 2ms artificial delay per async getHead/getRevision call

        const deps = {
            blocks: {
                listBlockIds: vi.fn().mockResolvedValue({ status: 'AVAILABLE', data: ['block'], revision: null }),
                getHeaderState: vi.fn().mockResolvedValue({ status: 'AVAILABLE', data: { revision: 1, contentHash: 'block-hash' }, revision: null }),
                getRevisionState: vi.fn().mockResolvedValue({ status: 'AVAILABLE', data: document, revision: '1' }),
            },
            evaluations: {
                getRevision: vi.fn().mockImplementation(async () => evaluation),
            },
            attempts: {
                listAttemptsForProtocolWithDiagnostics: vi.fn().mockImplementation(async () => ({
                    attempts: [...parents.values()].filter(p => p.id !== 'baseline'),
                    unreadableCount: 0,
                    truncated: false,
                })),
                getAttempt: vi.fn().mockImplementation(async (_user: string, id: string) => parents.get(id) ?? null),
            },
            observations: {
                getHead: vi.fn().mockImplementation(async (_user: string, key: string) => {
                    await new Promise(r => setTimeout(r, simulatedAsyncDelay));
                    return rows.get(key)?.head ?? null;
                }),
                getRevision: vi.fn().mockImplementation(async (_user: string, key: string) => {
                    await new Promise(r => setTimeout(r, simulatedAsyncDelay));
                    return rows.get(key)?.revision ?? null;
                }),
            },
            protocols: {
                getRevision: vi.fn().mockResolvedValue({ id: 'cycling-20m-tt', revision: 1, metricIds: [metricId] }),
            },
            recommendations: { getRecommendationsInRange: vi.fn().mockResolvedValue({ status: 'AVAILABLE', data: [], revision: null }) },
            executions: { getExecutionHeadersInRange: vi.fn().mockResolvedValue({ executions: [], invalidRecords: 0, truncated: false }) },
            occurrences: { queryActiveInDateWindow: vi.fn().mockResolvedValue([]) },
            responses: { getResponse: vi.fn().mockResolvedValue({ status: 'MISSING' }) },
            checkins: { getCheckinState: vi.fn().mockResolvedValue({ status: 'MISSING' }) },
            competitions: { listOutcomesWithDiagnostics: vi.fn().mockResolvedValue({ outcomes: [], unreadableCount: 0, truncated: false }) },
            reports: {
                buildReport: vi.fn().mockReturnValue({
                    evaluationRef: { id: 'eval', revision: 1, contentHash: evaluation.revision.contentHash },
                    verdict: 'insufficient_evidence',
                    reasons: [],
                    metricProgress: [],
                    process: { completedSessionCount: 0, sourceIds: { sessionIds: [] } },
                    policySegments: [],
                }),
            },
        };

        // Populate 20 attempts
        const ATTEMPT_COUNT = 20;
        for (let i = 0; i < ATTEMPT_COUNT; i++) {
            const id = `att-${i}`;
            const row = observation(id, '2026-08-15', 250 + i);
            rows.set(row.revision.observationKey, row);
            parents.set(id, attempt(id, '2026-08-15'));
        }

        const service = new BlockReviewService(deps as never);

        const startTime = performance.now();
        const result = await service.loadReview('u1', selection, asOfDate);
        const durationMs = performance.now() - startTime;

        expect(result.report).toBeDefined();
        console.log(`[Perf Benchmark] loadReview with ${ATTEMPT_COUNT} attempts took ${durationMs.toFixed(2)}ms`);
    });
});
