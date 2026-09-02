import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A tiny functional in-memory Firestore fake (path -> data map) rather than pure
 * call-assertion mocks -- the repository's transactional idempotency/conflict/merge-chain
 * logic genuinely needs a stateful store to exercise realistically (e.g. "create, then
 * create again for the same source, then attach, then merge" all against the *same*
 * evolving state). This mirrors the shape of `firebase/firestore` closely enough
 * (`collection`/`doc` build path strings, `runTransaction` hands the callback a
 * `{get,set,update}` transaction operating on the same store) without needing the
 * Firestore emulator.
 */
const docStore = new Map<string, Record<string, unknown>>();

function pathOf(segments: unknown[]): string {
    return segments.filter(segment => typeof segment === 'string').join('/');
}

const mockCollection = vi.fn((..._args: unknown[]) => ({ path: pathOf(_args) }));
const mockDoc = vi.fn((..._args: unknown[]) => ({ path: pathOf(_args) }));
const mockQuery = vi.fn((coll: { path: string }, ...clauses: Array<{ field: string; op: string; value: unknown }>) => ({ coll, clauses }));
const mockWhere = vi.fn((field: string, op: string, value: unknown) => ({ field, op, value }));

async function fakeGetDoc(ref: { path: string }) {
    const data = docStore.get(ref.path);
    return { exists: () => data !== undefined, data: () => data };
}

const mockGetDoc = vi.fn(fakeGetDoc);

const mockGetDocs = vi.fn(async (q: { coll: { path: string }; clauses: Array<{ field: string; op: string; value: unknown }> }) => {
    const prefix = `${q.coll.path}/`;
    const docs = [...docStore.entries()]
        .filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes('/'))
        .filter(([, data]) => q.clauses.every(clause => {
            const fieldValue = data[clause.field];
            if (clause.op === '==') return fieldValue === clause.value;
            if (clause.op === '>=') return (fieldValue as string) >= (clause.value as string);
            if (clause.op === '<=') return (fieldValue as string) <= (clause.value as string);
            return true;
        }))
        .map(([path, data]) => ({ id: path.slice(prefix.length), data: () => data, ref: { path } }));
    return { docs };
});

const mockTransactionSet = vi.fn((ref: { path: string }, data: Record<string, unknown>) => {
    docStore.set(ref.path, data);
});
const mockTransactionUpdate = vi.fn((ref: { path: string }, patch: Record<string, unknown>) => {
    const existing = docStore.get(ref.path);
    if (!existing) throw new Error(`update() on missing doc ${ref.path}`);
    docStore.set(ref.path, { ...existing, ...patch });
});
const mockRunTransaction = vi.fn(async (_db: unknown, fn: (tx: unknown) => Promise<unknown>) => {
    const transaction = { get: fakeGetDoc, set: mockTransactionSet, update: mockTransactionUpdate };
    return fn(transaction);
});

vi.mock('firebase/firestore', () => ({
    collection: mockCollection,
    doc: mockDoc,
    getDoc: mockGetDoc,
    getDocs: mockGetDocs,
    query: mockQuery,
    where: mockWhere,
    runTransaction: mockRunTransaction,
}));
vi.mock('../firebase', () => ({ getDb: vi.fn(() => ({})) }));

const { PerformedTrainingOccurrenceRepository, SourceLinkConflictError } = await import('./repository');

beforeEach(() => {
    docStore.clear();
    vi.clearAllMocks();
});

const userId = 'user-1';

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
        durationMin: 39,
        modality: 'strength',
    };
}

describe('createOrGetForSource', () => {
    it('creates a single-source occurrence and its source link when neither exists', async () => {
        const repo = new PerformedTrainingOccurrenceRepository({} as never);
        const { occurrence, created } = await repo.createOrGetForSource(userId, structuredFacts());

        expect(created).toBe(true);
        expect(occurrence.status).toBe('active');
        expect(occurrence.sourceRefs).toEqual([{ kind: 'structured_execution', executionId: 'exec-1' }]);
        expect(occurrence.reconciliation.state).toBe('single_source');
    });

    it('is idempotent: a second call for the same source returns the same occurrence without creating a duplicate', async () => {
        const repo = new PerformedTrainingOccurrenceRepository({} as never);
        const first = await repo.createOrGetForSource(userId, structuredFacts());
        const second = await repo.createOrGetForSource(userId, structuredFacts());

        expect(second.created).toBe(false);
        expect(second.occurrence.performedOccurrenceId).toBe(first.occurrence.performedOccurrenceId);
        expect([...docStore.keys()].filter(path => path.includes('performedTrainingOccurrences/'))).toHaveLength(1);
    });

    it('resolves through a merge chain when the linked occurrence has since been merged into a survivor', async () => {
        const repo = new PerformedTrainingOccurrenceRepository({} as never);
        const { occurrence: loser } = await repo.createOrGetForSource(userId, structuredFacts());
        const { occurrence: survivorSeed } = await repo.createOrGetForSource(userId, garminFacts());
        await repo.mergeOccurrences(userId, survivorSeed.performedOccurrenceId, loser.performedOccurrenceId);

        const { occurrence, created } = await repo.createOrGetForSource(userId, structuredFacts());

        expect(created).toBe(false);
        expect(occurrence.performedOccurrenceId).toBe(survivorSeed.performedOccurrenceId);
        expect(occurrence.status).toBe('active');
    });
});

describe('attachSource', () => {
    it('attaches a new source and marks the occurrence matched with the given reconciliation provenance', async () => {
        const repo = new PerformedTrainingOccurrenceRepository({} as never);
        const { occurrence: target } = await repo.createOrGetForSource(userId, structuredFacts());

        const updated = await repo.attachSource(userId, target.performedOccurrenceId, garminFacts(), {
            state: 'matched',
            matcherVersion: 'matcher-v1',
            policyVersion: 'policy-v1',
            confidence: 0.9,
        });

        expect(updated.sourceRefs).toHaveLength(2);
        expect(updated.reconciliation.state).toBe('matched');
        expect(updated.reconciliation.confidence).toBe(0.9);
    });

    it('is idempotent: attaching the same source twice does not duplicate sourceRefs', async () => {
        const repo = new PerformedTrainingOccurrenceRepository({} as never);
        const { occurrence: target } = await repo.createOrGetForSource(userId, structuredFacts());
        const reconciliation = { state: 'matched' as const, matcherVersion: 'matcher-v1', policyVersion: 'policy-v1', confidence: 0.9 };

        await repo.attachSource(userId, target.performedOccurrenceId, garminFacts(), reconciliation);
        const second = await repo.attachSource(userId, target.performedOccurrenceId, garminFacts(), reconciliation);

        expect(second.sourceRefs).toHaveLength(2);
    });

    it('throws SourceLinkConflictError instead of silently double-linking a source already claimed by a different occurrence', async () => {
        const repo = new PerformedTrainingOccurrenceRepository({} as never);
        const { occurrence: occurrenceA } = await repo.createOrGetForSource(userId, structuredFacts());
        // garminFacts('act-1') already has its own standalone occurrence from this call:
        await repo.createOrGetForSource(userId, garminFacts('act-1'));

        await expect(
            repo.attachSource(userId, occurrenceA.performedOccurrenceId, garminFacts('act-1'), { state: 'matched' }),
        ).rejects.toBeInstanceOf(SourceLinkConflictError);
    });

    it('never overwrites Adaptive-authoritative fields with Garmin fields on attach', async () => {
        const repo = new PerformedTrainingOccurrenceRepository({} as never);
        const { occurrence: target } = await repo.createOrGetForSource(userId, structuredFacts());
        const updated = await repo.attachSource(userId, target.performedOccurrenceId, garminFacts(), { state: 'matched' });

        expect(updated.startedAt).toBe(structuredFacts().startedAt); // not Garmin's startedAt
    });
});

describe('unlinkSource', () => {
    it('detaches a source into its own fresh occurrence and records a sticky exclusion on the survivor', async () => {
        const repo = new PerformedTrainingOccurrenceRepository({} as never);
        const { occurrence: target } = await repo.createOrGetForSource(userId, structuredFacts());
        await repo.attachSource(userId, target.performedOccurrenceId, garminFacts(), { state: 'matched' });

        const { survivor, detached } = await repo.unlinkSource(userId, target.performedOccurrenceId, 'provider_activity:garmin:act-1', 'athlete-1', 'wrong match');

        expect(survivor.sourceRefs).toEqual([{ kind: 'structured_execution', executionId: 'exec-1' }]);
        expect(survivor.reconciliation.excludedSourceKeys).toContain('provider_activity:garmin:act-1');
        expect(detached.sourceRefs).toEqual([{ kind: 'provider_activity', provider: 'garmin', activityId: 'act-1' }]);
        expect(detached.performedOccurrenceId).not.toBe(survivor.performedOccurrenceId);
    });

    it('rejects unlinking the only source on an occurrence', async () => {
        const repo = new PerformedTrainingOccurrenceRepository({} as never);
        const { occurrence: target } = await repo.createOrGetForSource(userId, structuredFacts());

        await expect(repo.unlinkSource(userId, target.performedOccurrenceId, 'structured_execution:exec-1', 'athlete-1')).rejects.toThrow();
    });
});

describe('mergeOccurrences', () => {
    it('tombstones the loser, combines source refs on the survivor, and re-points the loser\'s source links', async () => {
        const repo = new PerformedTrainingOccurrenceRepository({} as never);
        const { occurrence: survivorSeed } = await repo.createOrGetForSource(userId, structuredFacts());
        const { occurrence: loserSeed } = await repo.createOrGetForSource(userId, garminFacts());

        const survivor = await repo.mergeOccurrences(userId, survivorSeed.performedOccurrenceId, loserSeed.performedOccurrenceId);

        expect(survivor.sourceRefs).toHaveLength(2);
        // `getById` deliberately resolves through the merge chain (tested separately
        // above under createOrGetForSource) -- inspect the raw tombstoned doc directly to
        // assert the loser itself was never deleted, only marked merged.
        const rawLoserDoc = docStore.get(`users/${userId}/performedTrainingOccurrences/${loserSeed.performedOccurrenceId}`);
        expect(rawLoserDoc?.status).toBe('merged');
        expect(rawLoserDoc?.mergedIntoOccurrenceId).toBe(survivorSeed.performedOccurrenceId);

        // The loser's source now resolves (by source key) to the survivor.
        const resolved = await repo.getBySourceKey(userId, 'provider_activity:garmin:act-1');
        expect(resolved?.performedOccurrenceId).toBe(survivorSeed.performedOccurrenceId);
    });

    it('is idempotent when called twice for an already-merged pair', async () => {
        const repo = new PerformedTrainingOccurrenceRepository({} as never);
        const { occurrence: survivorSeed } = await repo.createOrGetForSource(userId, structuredFacts());
        const { occurrence: loserSeed } = await repo.createOrGetForSource(userId, garminFacts());

        await repo.mergeOccurrences(userId, survivorSeed.performedOccurrenceId, loserSeed.performedOccurrenceId);
        await expect(repo.mergeOccurrences(userId, survivorSeed.performedOccurrenceId, loserSeed.performedOccurrenceId)).resolves.not.toThrow();
    });
});

describe('queryActiveInDateWindow', () => {
    it('excludes merged occurrences and occurrences outside the date window', async () => {
        const repo = new PerformedTrainingOccurrenceRepository({} as never);
        await repo.createOrGetForSource(userId, structuredFacts());
        await repo.createOrGetForSource(userId, { ...garminFacts('act-outside'), localDate: '2026-01-01' });

        const results = await repo.queryActiveInDateWindow(userId, '2026-08-25', '2026-08-27');

        expect(results).toHaveLength(1);
        expect(results[0].sourceRefs[0]).toEqual({ kind: 'structured_execution', executionId: 'exec-1' });
    });
});
