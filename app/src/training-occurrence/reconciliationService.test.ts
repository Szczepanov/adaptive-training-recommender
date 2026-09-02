import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PerformedTrainingOccurrence } from './models';

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

const { performedTrainingOccurrenceRepository: repo, SourceLinkConflictError } = await import('./repository');
const { sessionExecutionService } = await import('../services/sessionExecutionService');
const { activityService } = await import('../services/activityService');
const {
    reconcileSourceFacts,
    reconcileStructuredCompletion,
    reconcileGarminActivity,
    reconcileDateRangeForUser,
    structuredExecutionToFacts,
    garminActivityToFacts,
} = await import('./reconciliationService');
const { resetShadowReconciliationCounters, getShadowReconciliationCounters } = await import('./metrics');

function occurrence(overrides: Partial<PerformedTrainingOccurrence> = {}): PerformedTrainingOccurrence {
    return {
        schemaVersion: 1,
        performedOccurrenceId: 'pto-existing',
        userId: 'user-1',
        status: 'active',
        localDate: '2026-08-26',
        modality: 'strength',
        startedAt: '2026-08-26T06:52:00.000Z',
        endedAt: '2026-08-26T07:32:00.000Z',
        sourceRefs: [{ kind: 'provider_activity', provider: 'garmin', activityId: 'act-1' }],
        reconciliation: { state: 'single_source' },
        createdAt: '2026-08-26T06:52:00.000Z',
        updatedAt: '2026-08-26T06:52:00.000Z',
        ...overrides,
    };
}

const structuredFacts = {
    sourceRef: { kind: 'structured_execution' as const, executionId: 'exec-1' },
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

describe('reconcileSourceFacts', () => {
    it('structured-first: no candidates yet -> creates a single-source occurrence', async () => {
        vi.mocked(repo.getBySourceKey).mockResolvedValue(null);
        vi.mocked(repo.queryActiveInDateWindow).mockResolvedValue([]);
        vi.mocked(repo.createOrGetForSource).mockResolvedValue({ occurrence: occurrence({ sourceRefs: [structuredFacts.sourceRef], reconciliation: { state: 'single_source' } }), created: true });

        const result = await reconcileSourceFacts('user-1', structuredFacts);

        expect(result.outcome).toBe('created_single_source');
        expect(repo.attachSource).not.toHaveBeenCalled();
        expect(getShadowReconciliationCounters()['training_occurrence.single_source']).toBe(1);
    });

    it('Garmin-first, structured arrives later and clears auto-link -> attaches to the existing Garmin-only occurrence', async () => {
        const garminOnly = occurrence();
        vi.mocked(repo.getBySourceKey).mockResolvedValue(null);
        vi.mocked(repo.queryActiveInDateWindow).mockResolvedValue([garminOnly]);
        vi.mocked(repo.attachSource).mockResolvedValue({ ...garminOnly, sourceRefs: [...garminOnly.sourceRefs, structuredFacts.sourceRef], reconciliation: { state: 'matched' } });

        const result = await reconcileSourceFacts('user-1', structuredFacts);

        expect(result.outcome).toBe('attached_auto_link');
        expect(repo.createOrGetForSource).not.toHaveBeenCalled();
        expect(repo.attachSource).toHaveBeenCalledWith('user-1', garminOnly.performedOccurrenceId, structuredFacts, expect.objectContaining({ state: 'matched' }));
        expect(getShadowReconciliationCounters()['training_occurrence.matched']).toBe(1);
    });

    it('repeated event: already linked -> returns the existing occurrence without touching create/attach', async () => {
        const existing = occurrence({ sourceRefs: [structuredFacts.sourceRef] });
        vi.mocked(repo.getBySourceKey).mockResolvedValue(existing);

        const result = await reconcileSourceFacts('user-1', structuredFacts);

        expect(result.outcome).toBe('already_linked');
        expect(result.occurrence).toBe(existing);
        expect(repo.queryActiveInDateWindow).not.toHaveBeenCalled();
        expect(repo.createOrGetForSource).not.toHaveBeenCalled();
        expect(repo.attachSource).not.toHaveBeenCalled();
    });

    it('same-day two strength sessions with comparable duration/timing -> stays ambiguous, does not auto-link', async () => {
        const candidateA = occurrence({ performedOccurrenceId: 'pto-a', startedAt: '2026-08-26T06:00:00.000Z', endedAt: '2026-08-26T06:40:00.000Z' });
        const candidateB = occurrence({ performedOccurrenceId: 'pto-b', startedAt: '2026-08-26T18:00:00.000Z', endedAt: '2026-08-26T18:40:00.000Z' });
        vi.mocked(repo.getBySourceKey).mockResolvedValue(null);
        vi.mocked(repo.queryActiveInDateWindow).mockResolvedValue([candidateA, candidateB]);
        vi.mocked(repo.createOrGetForSource).mockResolvedValue({ occurrence: occurrence({ performedOccurrenceId: 'pto-new' }), created: true });

        // Two candidates with the SAME local date but far apart in time -- neither should
        // individually clear auto-link (both lack real temporal proximity), so the
        // decision is ambiguous/no_match, never a same-day accidental merge.
        const facts = { ...structuredFacts, startedAt: '2026-08-26T12:00:00.000Z', endedAt: '2026-08-26T12:40:00.000Z' };
        const result = await reconcileSourceFacts('user-1', facts);

        expect(result.outcome).not.toBe('attached_auto_link');
        expect(repo.attachSource).not.toHaveBeenCalled();
    });

    it('modality mismatch -> never auto-links even with a same-day, close-timing candidate', async () => {
        const cyclingCandidate = occurrence({ modality: 'cycling', startedAt: structuredFacts.startedAt, endedAt: structuredFacts.endedAt });
        vi.mocked(repo.getBySourceKey).mockResolvedValue(null);
        vi.mocked(repo.queryActiveInDateWindow).mockResolvedValue([cyclingCandidate]);
        vi.mocked(repo.createOrGetForSource).mockResolvedValue({ occurrence: occurrence({ performedOccurrenceId: 'pto-new' }), created: true });

        const result = await reconcileSourceFacts('user-1', structuredFacts); // modality: 'strength'

        expect(result.outcome).not.toBe('attached_auto_link');
        expect(repo.attachSource).not.toHaveBeenCalled();
    });

    it('manual-unlink sticky: excluded candidate is never re-proposed even when it would otherwise score highly', async () => {
        const excluded = occurrence({ reconciliation: { state: 'single_source', excludedSourceKeys: ['structured_execution:exec-1'] } });
        vi.mocked(repo.getBySourceKey).mockResolvedValue(null);
        vi.mocked(repo.queryActiveInDateWindow).mockResolvedValue([excluded]);
        vi.mocked(repo.createOrGetForSource).mockResolvedValue({ occurrence: occurrence({ performedOccurrenceId: 'pto-new' }), created: true });

        const result = await reconcileSourceFacts('user-1', structuredFacts);

        expect(result.outcome).toBe('created_single_source');
        expect(repo.attachSource).not.toHaveBeenCalled();
    });

    it('source-link conflict on attach converges onto whoever legitimately owns the source instead of erroring', async () => {
        const target = occurrence();
        const resolvedElsewhere = occurrence({ performedOccurrenceId: 'pto-elsewhere' });
        vi.mocked(repo.getBySourceKey)
            .mockResolvedValueOnce(null) // initial "already linked?" check
            .mockResolvedValueOnce(resolvedElsewhere); // post-conflict re-resolve
        vi.mocked(repo.queryActiveInDateWindow).mockResolvedValue([target]);
        vi.mocked(repo.attachSource).mockRejectedValue(new SourceLinkConflictError('structured_execution:exec-1', 'pto-elsewhere', target.performedOccurrenceId));

        const result = await reconcileSourceFacts('user-1', structuredFacts);

        expect(result.outcome).toBe('already_linked');
        expect(result.occurrence?.performedOccurrenceId).toBe('pto-elsewhere');
        expect(getShadowReconciliationCounters()['training_occurrence.source_link_conflict']).toBe(1);
    });
});

describe('structuredExecutionToFacts / garminActivityToFacts', () => {
    it('computes structured duration from startedAt/completedAt', () => {
        const facts = structuredExecutionToFacts({
            executionId: 'exec-2',
            date: '2026-08-26',
            startedAt: '2026-08-26T06:00:00.000Z',
            completedAt: '2026-08-26T06:40:00.000Z',
        });
        expect(facts.durationMin).toBe(40);
        expect(facts.endedAt).toBe('2026-08-26T06:40:00.000Z');
    });

    it('leaves duration null for a still-in-progress execution', () => {
        const facts = structuredExecutionToFacts({ executionId: 'exec-3', date: '2026-08-26', startedAt: '2026-08-26T06:00:00.000Z' });
        expect(facts.durationMin).toBeNull();
    });

    it('derives modality from Garmin activity type', () => {
        const facts = garminActivityToFacts({
            activityId: 'act-2',
            date: '2026-08-26',
            type: 'strength_training',
            durationMin: 40,
            trainingEffectAerobic: null,
            trainingEffectAnaerobic: null,
            averageHr: null,
            activityTrainingLoad: null,
            intensityTag: 'moderate',
        });
        expect(facts.modality).toBe('strength');
    });
});

describe('reconcileStructuredCompletion / reconcileGarminActivity', () => {
    it('reconcileStructuredCompletion delegates through reconcileSourceFacts', async () => {
        vi.mocked(repo.getBySourceKey).mockResolvedValue(occurrence());
        const result = await reconcileStructuredCompletion('user-1', {
            executionId: 'exec-1',
            date: '2026-08-26',
            startedAt: '2026-08-26T06:00:00.000Z',
            completedAt: '2026-08-26T06:40:00.000Z',
        });
        expect(result.outcome).toBe('already_linked');
    });

    it('reconcileGarminActivity delegates through reconcileSourceFacts', async () => {
        vi.mocked(repo.getBySourceKey).mockResolvedValue(occurrence());
        const result = await reconcileGarminActivity('user-1', {
            activityId: 'act-1',
            date: '2026-08-26',
            type: 'strength_training',
            durationMin: 40,
            trainingEffectAerobic: null,
            trainingEffectAnaerobic: null,
            averageHr: null,
            activityTrainingLoad: null,
            intensityTag: 'moderate',
        });
        expect(result.outcome).toBe('already_linked');
    });
});

describe('reconcileDateRangeForUser', () => {
    it('reconciles only completed executions and every fetched activity, skipping already-linked sources', async () => {
        vi.mocked(sessionExecutionService.getExecutionsInRange).mockResolvedValue({
            executions: [
                { execution: { executionId: 'exec-done', date: '2026-08-26', startedAt: '2026-08-26T06:00:00.000Z', completedAt: '2026-08-26T06:40:00.000Z', state: 'completed', userId: 'user-1', sessionSource: { kind: 'catalog', workoutId: 'w', catalogVersion: '1' }, updatedAt: '2026-08-26T06:40:00.000Z', schemaVersion: 1 }, entries: [] },
                { execution: { executionId: 'exec-inprogress', date: '2026-08-26', startedAt: '2026-08-26T06:00:00.000Z', state: 'in_progress', userId: 'user-1', sessionSource: { kind: 'catalog', workoutId: 'w', catalogVersion: '1' }, updatedAt: '2026-08-26T06:00:00.000Z', schemaVersion: 1 }, entries: [] },
            ],
            invalidRecords: 0,
        });
        vi.mocked(activityService.getActivitiesInRange).mockResolvedValue({
            status: 'AVAILABLE',
            data: [{ activityId: 'act-1', date: '2026-08-26', type: 'strength_training', durationMin: 40, trainingEffectAerobic: null, trainingEffectAnaerobic: null, averageHr: null, activityTrainingLoad: null, intensityTag: 'moderate' }],
            revision: null,
        });
        vi.mocked(repo.getBySourceKey).mockResolvedValue(occurrence()); // pretend every source is already linked
        vi.mocked(repo.queryActiveInDateWindow).mockResolvedValue([]);

        const summary = await reconcileDateRangeForUser('user-1', '2026-08-25', '2026-08-27');

        expect(summary.executionsProcessed).toBe(2);
        expect(summary.activitiesProcessed).toBe(1);
        // Only the completed execution and the activity should have triggered a
        // getBySourceKey lookup -- the in_progress execution must never be reconciled.
        expect(vi.mocked(repo.getBySourceKey).mock.calls.map(call => call[1])).toEqual([
            'structured_execution:exec-done',
            'provider_activity:garmin:act-1',
        ]);
    });
});
