import { beforeEach, describe, expect, it, vi } from 'vitest';

const docStore = new Map<string, Record<string, unknown>>();

function pathOf(segments: unknown[]): string {
    return segments.filter(segment => typeof segment === 'string').join('/');
}

const mockCollection = vi.fn((...args: unknown[]) => ({ path: pathOf(args) }));
const mockDoc = vi.fn((...args: unknown[]) => ({ path: pathOf(args) }));
const mockGetDoc = vi.fn(async (ref: { path: string }) => {
    const data = docStore.get(ref.path);
    return { exists: () => data !== undefined, data: () => data };
});
const mockTransactionSet = vi.fn((ref: { path: string }, data: Record<string, unknown>) => {
    docStore.set(ref.path, data);
});
const mockTransactionUpdate = vi.fn((ref: { path: string }, patch: Record<string, unknown>) => {
    const existing = docStore.get(ref.path);
    if (!existing) throw new Error(`update() on missing doc ${ref.path}`);
    docStore.set(ref.path, { ...existing, ...patch });
});
const mockRunTransaction = vi.fn(async (_db: unknown, fn: (tx: unknown) => Promise<unknown>) => fn({
    get: async (ref: { path: string }) => {
        const data = docStore.get(ref.path);
        return { exists: () => data !== undefined, data: () => data };
    },
    set: mockTransactionSet,
    update: mockTransactionUpdate,
}));

vi.mock('firebase/firestore', () => ({
    collection: mockCollection,
    doc: mockDoc,
    getDoc: mockGetDoc,
    getDocs: vi.fn(),
    query: vi.fn(),
    where: vi.fn(),
    runTransaction: mockRunTransaction,
}));
vi.mock('../firebase', () => ({ getDb: vi.fn(() => ({})) }));

const { PerformedTrainingOccurrenceRepository } = await import('./repository');
const { filterCandidates } = await import('./reconciliationCandidates');

const userId = 'user-hardening';

function structuredFacts(executionId = 'exec-1') {
    return {
        sourceRef: { kind: 'structured_execution' as const, executionId },
        localDate: '2026-08-26',
        startedAt: '2026-08-26T06:52:00.000Z',
        endedAt: '2026-08-26T07:32:00.000Z',
        durationMin: 40,
        modality: 'strength',
    };
}

function garminFacts(activityId = 'act-1') {
    return {
        sourceRef: { kind: 'provider_activity' as const, provider: 'garmin', activityId },
        localDate: '2026-08-26',
        startedAt: '2026-08-26T06:53:00.000Z',
        endedAt: '2026-08-26T07:30:00.000Z',
        durationMin: 37,
        modality: 'strength',
    };
}

beforeEach(() => {
    docStore.clear();
    vi.clearAllMocks();
});

describe('manual reconciliation hardening', () => {
    it('stores a manual unlink symmetrically and keeps the detached occurrence rebuildable', async () => {
        const repo = new PerformedTrainingOccurrenceRepository({} as never);
        const { occurrence: target } = await repo.createOrGetForSource(userId, structuredFacts());
        await repo.attachSource(userId, target.performedOccurrenceId, garminFacts(), { state: 'matched' });

        const { survivor, detached } = await repo.unlinkSource(
            userId,
            target.performedOccurrenceId,
            'provider_activity:garmin:act-1',
            'athlete-1',
            'not the same workout',
        );

        expect(survivor.reconciliation.excludedSourceKeys).toContain('provider_activity:garmin:act-1');
        expect(detached.reconciliation.excludedSourceKeys).toContain('structured_execution:exec-1');
        expect(detached.localDate).toBe('2026-08-26');
        expect(detached.startedAt).toBe(structuredFacts().startedAt);

        expect(filterCandidates(structuredFacts(), [detached])).toEqual([]);
        expect(filterCandidates(garminFacts(), [survivor])).toEqual([]);
    });

    it('does not erase an earlier manual exclusion when another source is later attached', async () => {
        const repo = new PerformedTrainingOccurrenceRepository({} as never);
        const { occurrence: target } = await repo.createOrGetForSource(userId, structuredFacts());
        await repo.attachSource(userId, target.performedOccurrenceId, garminFacts('act-rejected'), { state: 'matched' });
        const { survivor } = await repo.unlinkSource(
            userId,
            target.performedOccurrenceId,
            'provider_activity:garmin:act-rejected',
            'athlete-1',
        );

        const updated = await repo.attachSource(userId, survivor.performedOccurrenceId, garminFacts('act-good'), {
            state: 'matched',
            matcherVersion: 'matcher-v1',
            confidence: 0.95,
        });

        expect(updated.reconciliation.state).toBe('matched');
        expect(updated.reconciliation.excludedSourceKeys).toContain('provider_activity:garmin:act-rejected');
        expect(updated.reconciliation.manualDecision?.decision).toBe('unlink');
    });
});

describe('merge authority hardening', () => {
    it('keeps deterministic survivor identity while promoting structured projection authority', async () => {
        const repo = new PerformedTrainingOccurrenceRepository({} as never);
        const { occurrence: providerSurvivor } = await repo.createOrGetForSource(userId, garminFacts());
        const { occurrence: structuredLoser } = await repo.createOrGetForSource(userId, structuredFacts());

        const merged = await repo.mergeOccurrences(
            userId,
            providerSurvivor.performedOccurrenceId,
            structuredLoser.performedOccurrenceId,
            { state: 'matched', matcherVersion: 'matcher-v1', policyVersion: 'policy-v1', confidence: 0.99 },
        );

        expect(merged.performedOccurrenceId).toBe(providerSurvivor.performedOccurrenceId);
        expect(merged.startedAt).toBe(structuredFacts().startedAt);
        expect(merged.endedAt).toBe(structuredFacts().endedAt);
        expect(merged.sourceRefs).toEqual(expect.arrayContaining([
            garminFacts().sourceRef,
            structuredFacts().sourceRef,
        ]));
    });
});
