import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PerformedTrainingOccurrence, ReconciliationProvenance } from './models';

vi.mock('./repository', async () => {
    const actual = await vi.importActual<typeof import('./repository')>('./repository');
    return {
        ...actual,
        performedTrainingOccurrenceRepository: {
            getBySourceKey: vi.fn(),
            queryActiveInDateWindow: vi.fn(),
            createOrGetForSource: vi.fn(),
            attachSource: vi.fn(),
            mergeOccurrences: vi.fn(),
        },
    };
});
vi.mock('../services/sessionExecutionService', () => ({
    sessionExecutionService: { getExecutionsInRange: vi.fn() },
}));
vi.mock('../services/activityService', () => ({
    activityService: { getActivitiesInRange: vi.fn() },
}));

const { performedTrainingOccurrenceRepository: repo } = await import('./repository');
const { sessionExecutionService } = await import('../services/sessionExecutionService');
const { activityService } = await import('../services/activityService');
const { reconcileSourceFacts, reconcileDateRangeForUser } = await import('./reconciliationService');
const { getShadowReconciliationCounters, resetShadowReconciliationCounters } = await import('./metrics');

function providerOccurrence(
    id: string,
    startedAt: string,
    reconciliation: ReconciliationProvenance = { state: 'single_source' },
): PerformedTrainingOccurrence {
    return {
        schemaVersion: 1,
        performedOccurrenceId: id,
        userId: 'user-ambiguity',
        status: 'active',
        localDate: '2026-08-26',
        modality: 'strength',
        startedAt,
        endedAt: '2026-08-26T07:32:00.000Z',
        sourceRefs: [{ kind: 'provider_activity', provider: 'garmin', activityId: `activity-${id}` }],
        reconciliation,
        createdAt: startedAt,
        updatedAt: startedAt,
    };
}

const structuredFacts = {
    sourceRef: { kind: 'structured_execution' as const, executionId: 'exec-ambiguous' },
    localDate: '2026-08-26',
    startedAt: '2026-08-26T06:52:30.000Z',
    endedAt: '2026-08-26T07:32:00.000Z',
    durationMin: 40,
    modality: 'strength',
};

beforeEach(() => {
    vi.clearAllMocks();
    resetShadowReconciliationCounters();
});

describe('durable ambiguity', () => {
    it('persists ambiguous state atomically when two plausible candidates compete', async () => {
        const candidateA = providerOccurrence('pto-a', '2026-08-26T06:52:00.000Z');
        const candidateB = providerOccurrence('pto-b', '2026-08-26T06:53:00.000Z');
        vi.mocked(repo.getBySourceKey).mockResolvedValue(null);
        vi.mocked(repo.queryActiveInDateWindow).mockResolvedValue([candidateA, candidateB]);
        vi.mocked(repo.createOrGetForSource).mockImplementation(async (_userId, _facts, reconciliation) => ({
            occurrence: {
                ...providerOccurrence('pto-new', structuredFacts.startedAt, reconciliation),
                sourceRefs: [structuredFacts.sourceRef],
            },
            created: true,
        }));

        const result = await reconcileSourceFacts('user-ambiguity', structuredFacts);

        expect(result.outcome).toBe('ambiguous');
        expect(result.occurrence?.reconciliation.state).toBe('ambiguous');
        expect(repo.createOrGetForSource).toHaveBeenCalledWith(
            'user-ambiguity',
            structuredFacts,
            expect.objectContaining({ state: 'ambiguous', matcherVersion: expect.any(String), policyVersion: expect.any(String) }),
        );
        expect(repo.attachSource).not.toHaveBeenCalled();
        expect(getShadowReconciliationCounters()['training_occurrence.ambiguous']).toBe(1);
    });

    it('reports already_linked when another caller wins the transactional create race', async () => {
        const concurrentlyOwned = providerOccurrence('pto-winner', structuredFacts.startedAt, { state: 'matched' });
        vi.mocked(repo.getBySourceKey).mockResolvedValue(null);
        vi.mocked(repo.queryActiveInDateWindow).mockResolvedValue([]);
        vi.mocked(repo.createOrGetForSource).mockResolvedValue({ occurrence: concurrentlyOwned, created: false });

        const result = await reconcileSourceFacts('user-ambiguity', structuredFacts);

        expect(result.outcome).toBe('already_linked');
        expect(result.occurrence).toBe(concurrentlyOwned);
        expect(getShadowReconciliationCounters()['training_occurrence.single_source']).toBeUndefined();
    });

    it('never feeds a persisted ambiguous occurrence into the automatic duplicate sweep', async () => {
        const ambiguous = providerOccurrence('pto-ambiguous', '2026-08-26T06:52:00.000Z', { state: 'ambiguous' });
        const single = providerOccurrence('pto-single', '2026-08-26T06:52:30.000Z');
        vi.mocked(sessionExecutionService.getExecutionsInRange).mockResolvedValue({ executions: [], invalidRecords: 0 });
        vi.mocked(activityService.getActivitiesInRange).mockResolvedValue({ status: 'AVAILABLE', data: [], revision: null });
        vi.mocked(repo.queryActiveInDateWindow).mockResolvedValue([ambiguous, single]);

        await reconcileDateRangeForUser('user-ambiguity', '2026-08-25', '2026-08-28');

        expect(repo.mergeOccurrences).not.toHaveBeenCalled();
    });
});
