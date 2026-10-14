import { describe, expect, it, vi } from 'vitest';
import type { OutcomeEvaluationSnapshot } from '../outcomes/evaluationSpec';
import { hashEvaluationContent } from '../outcomes/evaluationHash';

vi.mock('../firebase', () => ({ getDb: () => ({}) }));
import { BlockReviewService } from './blockReviewService';

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function createFixture() {
    const metricId = 'cycling_tt_20m_mean_power_w';
    const asOfDate = '2026-08-15';
    const selection = { blockId: 'block-1', blockRevision: 1, evaluationId: 'eval-1', evaluationRevision: 1 };

    const evaluation: OutcomeEvaluationSnapshot = {
        revision: {
            id: 'eval-1', revision: 1, title: 'Perf Evaluation',
            startDate: '2026-08-01', endDate: '2026-08-10', status: 'active',
            activatedAt: '2026-07-30T09:00:00Z', contentHash: '', createdAt: '2026-07-29T09:00:00Z',
        },
        bindings: [{
            id: 'p20', metricId, role: 'primary', expectedDirection: { kind: 'higher_is_better' },
            baseline: { kind: 'declared_observation', observationId: `baseline:${metricId}` }, rationale: 'Perf test',
        }],
    };
    evaluation.revision.contentHash = await hashEvaluationContent(evaluation);

    const block = {
        id: 'block-1', revision: 1, title: 'Block title',
        dateRange: { startDate: '2026-08-01', endDate: '2026-08-10' },
        objectives: [{ successCriteria: { evaluationRef: { id: 'eval-1', revision: 1, metricId } } }],
    };
    const document = { userId: 'user-1', blockId: 'block-1', revision: 1, contentHash: 'block-hash', block };

    const mockExecutions = [
        { executionId: 'ex-1', date: '2026-08-02', state: 'completed', completedAt: '2026-08-02T10:00:00Z', updatedAt: '2026-08-02T10:00:00Z' },
        { executionId: 'ex-2', date: '2026-08-05', state: 'completed', completedAt: '2026-08-05T10:00:00Z', updatedAt: '2026-08-05T10:00:00Z' },
    ];

    const deps = {
        blocks: {
            listBlockIds: vi.fn().mockResolvedValue({ status: 'AVAILABLE', data: ['block-1'], revision: null }),
            getHeaderState: vi.fn().mockResolvedValue({ status: 'AVAILABLE', data: { revision: 1, contentHash: 'block-hash' }, revision: null }),
            getRevisionState: vi.fn().mockResolvedValue({ status: 'AVAILABLE', data: document, revision: '1' }),
        },
        evaluations: { getRevision: vi.fn().mockImplementation(async () => evaluation) },
        attempts: { listAttemptsForProtocolWithDiagnostics: vi.fn().mockResolvedValue({ attempts: [], unreadableCount: 0, truncated: false }), getAttempt: vi.fn().mockResolvedValue(null) },
        observations: { getHead: vi.fn().mockResolvedValue(null), getRevision: vi.fn().mockResolvedValue(null) },
        protocols: { getRevision: vi.fn().mockResolvedValue({ id: 'cycling-20m-tt', revision: 1, metricIds: [metricId] }) },
        recommendations: {
            getRecommendationsInRange: vi.fn().mockImplementation(async () => {
                await delay(15);
                return { status: 'AVAILABLE', data: [], revision: null };
            }),
        },
        executions: {
            getExecutionHeadersInRange: vi.fn().mockImplementation(async () => {
                await delay(15);
                return { executions: mockExecutions, invalidRecords: 0, truncated: false };
            }),
        },
        occurrences: {
            queryActiveInDateWindow: vi.fn().mockImplementation(async () => {
                await delay(15);
                return [];
            }),
        },
        responses: {
            getResponse: vi.fn().mockImplementation(async () => {
                await delay(10);
                return { status: 'MISSING' };
            }),
        },
        checkins: {
            getCheckinState: vi.fn().mockImplementation(async () => {
                await delay(10);
                return { status: 'MISSING' };
            }),
        },
        competitions: {
            listOutcomesWithDiagnostics: vi.fn().mockImplementation(async () => {
                await delay(15);
                return { outcomes: [], unreadableCount: 0, truncated: false };
            }),
        },
    };

    const service = new BlockReviewService(deps as never);
    return { service, selection, asOfDate };
}

describe('BlockReviewService performance benchmark', () => {
    it('measures loadReview wall-clock latency', async () => {
        const { service, selection, asOfDate } = await createFixture();
        const start = performance.now();
        const result = await service.loadReview('user-1', selection, asOfDate);
        const elapsed = performance.now() - start;
        expect(result).toBeDefined();
        console.log(`[PERF BENCHMARK] loadReview took ${elapsed.toFixed(2)}ms`);
    }, 10_000);
});
