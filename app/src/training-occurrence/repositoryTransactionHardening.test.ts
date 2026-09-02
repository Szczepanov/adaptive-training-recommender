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

const {
    OccurrenceMergeConflictError,
    PerformedTrainingOccurrenceRepository,
    SourceLinkConflictError,
} = await import('./repository');
const { encodeSourceKeyForDocId } = await import('./sourceIdentity');

const userId = 'user-transaction-hardening';

function structuredFacts(executionId: string) {
    return {
        sourceRef: { kind: 'structured_execution' as const, executionId },
        localDate: '2026-08-26',
        startedAt: '2026-08-26T06:52:00.000Z',
        endedAt: '2026-08-26T07:32:00.000Z',
        durationMin: 40,
        modality: 'strength',
    };
}

function garminFacts(activityId: string) {
    return {
        sourceRef: { kind: 'provider_activity' as const, provider: 'garmin', activityId },
        localDate: '2026-08-26',
        startedAt: '2026-08-26T06:53:00.000Z',
        endedAt: '2026-08-26T07:30:00.000Z',
        durationMin: 37,
        modality: 'strength',
    };
}

function sourceLinkPath(sourceKey: string): string {
    return `users/${userId}/performedOccurrenceSourceLinks/${encodeSourceKeyForDocId(sourceKey)}`;
}

beforeEach(() => {
    docStore.clear();
    vi.clearAllMocks();
});

describe('transactional source-link hardening', () => {
    it('refuses to unlink when the source claim was already moved elsewhere', async () => {
        const repo = new PerformedTrainingOccurrenceRepository({} as never);
        const { occurrence } = await repo.createOrGetForSource(userId, structuredFacts('exec-1'));
        await repo.attachSource(userId, occurrence.performedOccurrenceId, garminFacts('act-1'), { state: 'matched' });

        const linkPath = sourceLinkPath('provider_activity:garmin:act-1');
        docStore.set(linkPath, { ...docStore.get(linkPath)!, performedOccurrenceId: 'pto-concurrent-owner' });

        await expect(repo.unlinkSource(
            userId,
            occurrence.performedOccurrenceId,
            'provider_activity:garmin:act-1',
            'athlete-1',
        )).rejects.toBeInstanceOf(SourceLinkConflictError);

        const rawOccurrence = docStore.get(`users/${userId}/performedTrainingOccurrences/${occurrence.performedOccurrenceId}`);
        expect((rawOccurrence?.sourceRefs as unknown[])).toHaveLength(2);
    });

    it('refuses to overwrite a loser source claim moved by a concurrent operation', async () => {
        const repo = new PerformedTrainingOccurrenceRepository({} as never);
        const { occurrence: survivor } = await repo.createOrGetForSource(userId, structuredFacts('exec-1'));
        const { occurrence: loser } = await repo.createOrGetForSource(userId, garminFacts('act-1'));

        const linkPath = sourceLinkPath('provider_activity:garmin:act-1');
        docStore.set(linkPath, { ...docStore.get(linkPath)!, performedOccurrenceId: 'pto-concurrent-owner' });

        await expect(repo.mergeOccurrences(
            userId,
            survivor.performedOccurrenceId,
            loser.performedOccurrenceId,
        )).rejects.toBeInstanceOf(SourceLinkConflictError);

        const rawLoser = docStore.get(`users/${userId}/performedTrainingOccurrences/${loser.performedOccurrenceId}`);
        expect(rawLoser?.status).toBe('active');
    });

    it('reports a conflict when an idempotent retry finds the loser merged into another survivor', async () => {
        const repo = new PerformedTrainingOccurrenceRepository({} as never);
        const { occurrence: requestedSurvivor } = await repo.createOrGetForSource(userId, structuredFacts('exec-1'));
        const { occurrence: actualSurvivor } = await repo.createOrGetForSource(userId, garminFacts('act-survivor'));
        const { occurrence: loser } = await repo.createOrGetForSource(userId, garminFacts('act-loser'));

        await repo.mergeOccurrences(userId, actualSurvivor.performedOccurrenceId, loser.performedOccurrenceId);

        await expect(repo.mergeOccurrences(
            userId,
            requestedSurvivor.performedOccurrenceId,
            loser.performedOccurrenceId,
        )).rejects.toBeInstanceOf(OccurrenceMergeConflictError);
    });

    it('enforces the one-structured-execution invariant at the repository boundary', async () => {
        const repo = new PerformedTrainingOccurrenceRepository({} as never);
        const { occurrence } = await repo.createOrGetForSource(userId, structuredFacts('exec-1'));

        await expect(repo.attachSource(
            userId,
            occurrence.performedOccurrenceId,
            structuredFacts('exec-2'),
            { state: 'matched' },
        )).rejects.toThrow('more than one structured execution');
    });

    it('fails closed when an encoded source-link document contains a different canonical source key', async () => {
        const repo = new PerformedTrainingOccurrenceRepository({} as never);
        await repo.createOrGetForSource(userId, garminFacts('act-1'));

        const linkPath = sourceLinkPath('provider_activity:garmin:act-1');
        docStore.set(linkPath, { ...docStore.get(linkPath)!, sourceKey: 'provider_activity:garmin:different' });

        await expect(repo.getBySourceKey(userId, 'provider_activity:garmin:act-1'))
            .rejects.toThrow('Source-link identity mismatch');
    });
});
