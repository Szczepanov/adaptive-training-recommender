import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EXTERNAL_PLAN_SCHEMA } from '../engine/models';
import fixture01 from '../sessions/fixtures/01-full-body-maintenance.json';

const firestore = vi.hoisted(() => {
    const committedDocs = new Map<string, unknown>();
    const transactions: Array<{
        set: ReturnType<typeof vi.fn>;
        get: ReturnType<typeof vi.fn>;
        stagedWrites: Array<{ path: string; data: unknown }>;
    }> = [];
    let transactionError: Error | null = null;

    return {
        collection: vi.fn(),
        doc: vi.fn(),
        getDoc: vi.fn((ref: { path: string }) => Promise.resolve({
            exists: () => committedDocs.has(ref.path),
            data: () => committedDocs.get(ref.path),
        })),
        getDocs: vi.fn(),
        query: vi.fn((ref: unknown) => ref),
        startAfter: vi.fn((cursor: unknown) => ({ startAfter: cursor })),
        orderBy: vi.fn(),
        limit: vi.fn((count: number) => ({ limit: count })),
        documentId: vi.fn(),
        setDoc: vi.fn((ref: { path: string }, data: unknown) => {
            committedDocs.set(ref.path, data);
        }),
        runTransaction: vi.fn(async (_db: unknown, callback: (transaction: {
            get: (ref: { path: string }) => Promise<{ exists: () => boolean; data: () => unknown }>;
            set: ReturnType<typeof vi.fn>;
        }) => Promise<unknown>) => {
            if (transactionError) {
                const error = transactionError;
                transactionError = null;
                throw error;
            }
            const stagedWrites: Array<{ path: string; data: unknown }> = [];
            const tx = {
                get: vi.fn(async (ref: { path: string }) => ({
                    exists: () => committedDocs.has(ref.path),
                    data: () => committedDocs.get(ref.path),
                })),
                set: vi.fn((ref: { path: string }, data: unknown) => stagedWrites.push({ path: ref.path, data })),
            };
            const result = await callback(tx);
            transactions.push({ set: tx.set, get: tx.get, stagedWrites });
            for (const write of stagedWrites) committedDocs.set(write.path, write.data);
            return result;
        }),
        transactions,
        failNextTransaction(error: Error) {
            transactionError = error;
        },
        committedDocs,
    };
});

vi.mock('firebase/firestore', () => firestore);
vi.mock('../firebase', () => ({ getDb: vi.fn(() => ({})) }));

import {
    computeContentHash,
    ExternalPlanService,
    PLACEMENT_HISTORY_MAX_SCANNED_EVENTS,
    PLACEMENT_HISTORY_PAGE_SIZE,
    PLACEMENT_HISTORY_TRUNCATED_OPERATION,
} from './externalPlanService';

function plan(overrides: Record<string, unknown> = {}) {
    return {
        schema: EXTERNAL_PLAN_SCHEMA,
        planId: 'autumn-block', revision: 1, title: '4-week block',
        startDate: '2026-08-17', weekCount: 4,
        sessions: [{
            id: 'w1-a', title: 'Threshold', priority: 'key',
            placement: { week: 1, preferredDay: 'tuesday', flexibility: 'preferred', ifMissed: 'drop' },
            gating: { modality: 'cycling', intensity: 'hard', durationMin: 60, durationMax: 75, environment: 'either', equipment: [] },
            prescription: { summary: '3x12.' },
        }],
        ...overrides,
    };
}

/** Records which document path each transactional read targeted, in order. */
function readPaths(): string[] {
    return firestore.transactions.flatMap(transaction => transaction.get.mock.calls.map(call => (call[0] as { path: string }).path));
}

/** Records which document path each write targeted, in order, across transactions. */
function writtenPaths(): string[] {
    const txPaths = firestore.transactions.flatMap(transaction => transaction.set.mock.calls.map(call => (call[0] as { path: string }).path));
    const setDocPaths = firestore.setDoc.mock.calls.map(call => (call[0] as { path: string }).path);
    return [...txPaths, ...setDocPaths];
}

describe('ExternalPlanService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        firestore.committedDocs.clear();
        firestore.transactions.length = 0;
        firestore.doc.mockImplementation((db: unknown, ...segments: string[]) => ({ path: segments.length ? segments.join('/') : `${(db as { path: string }).path}/event-${firestore.transactions.length}` }));
        firestore.collection.mockImplementation((_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }));
        firestore.getDoc.mockImplementation((ref: { path: string }) => Promise.resolve({
            exists: () => firestore.committedDocs.has(ref.path),
            data: () => firestore.committedDocs.get(ref.path),
        }));
        firestore.setDoc.mockImplementation((ref: { path: string }, data: unknown) => {
            firestore.committedDocs.set(ref.path, data);
            return Promise.resolve(undefined);
        });
    });

    it('rejects an import whose session id exceeds the persisted identity cap, writing nothing (#945)', async () => {
        const result = await new ExternalPlanService().import('u1', plan({
            sessions: [{ ...plan().sessions[0], id: 's'.repeat(65) }],
        }));

        expect(result).toMatchObject({ status: 'INVALID', issues: [{ field: 'sessions[0].id', code: 'schema-validation-failed' }] });
        expect(firestore.runTransaction).not.toHaveBeenCalled();
        expect(firestore.committedDocs.size).toBe(0);
    });

    it('writes revision, immutable activation and latest header atomically', async () => {
        const result = await new ExternalPlanService().import('u1', plan());

        expect(result).toMatchObject({ status: 'AVAILABLE' });
        expect(writtenPaths()).toEqual([
            'users/u1/external_plans/autumn-block/revisions/1',
            'users/u1/external_plans/autumn-block/activations/1',
            'users/u1/external_plans/autumn-block',
        ]);
        expect(firestore.runTransaction).toHaveBeenCalledTimes(1);
        expect(firestore.transactions).toHaveLength(1);
    });

    it('leaves no partial import when the transaction fails, and allows retry', async () => {
        firestore.failNextTransaction(new Error('network error during transaction'));

        const service = new ExternalPlanService();
        const failedResult = await service.import('u1', plan());

        expect(failedResult).toMatchObject({
            status: 'UNAVAILABLE',
            retryable: true,
        });
        expect(firestore.committedDocs.size).toBe(0);
        expect(firestore.transactions).toHaveLength(0);

        const retryResult = await service.import('u1', plan());
        expect(retryResult.status).toBe('AVAILABLE');

        expect(firestore.transactions).toHaveLength(1);
        expect(firestore.transactions[0].set).toHaveBeenCalledTimes(3);
        expect(firestore.transactions[0].stagedWrites.map(w => w.path)).toEqual([
            'users/u1/external_plans/autumn-block/revisions/1',
            'users/u1/external_plans/autumn-block/activations/1',
            'users/u1/external_plans/autumn-block',
        ]);
        expect(firestore.committedDocs.has('users/u1/external_plans/autumn-block/revisions/1')).toBe(true);
        expect(firestore.committedDocs.has('users/u1/external_plans/autumn-block/activations/1')).toBe(true);
        expect(firestore.committedDocs.has('users/u1/external_plans/autumn-block')).toBe(true);
        expect(firestore.committedDocs.size).toBe(3);
    });

    it('writes nothing at all when the plan does not satisfy the contract', async () => {
        const result = await new ExternalPlanService().import('u1', plan({ startDate: '2026-08-18' }));

        expect(result.status).toBe('INVALID');
        expect(firestore.runTransaction).not.toHaveBeenCalled();
        expect(firestore.setDoc).not.toHaveBeenCalled();
    });

    it('reports every field-level error rather than the first', async () => {
        const result = await new ExternalPlanService().import('u1', plan({ weekCount: 99, planId: 'Not A Slug' }));

        expect(result.status).toBe('INVALID');
        if (result.status !== 'INVALID') throw new Error('unreachable');
        expect(result.issues.map(issue => issue.field)).toEqual(expect.arrayContaining(['planId', 'weekCount']));
    });

    it('refuses a revision older than the stored one', async () => {
        firestore.committedDocs.set('users/u1/external_plans/autumn-block', { revision: 3 });

        const older = await new ExternalPlanService().import('u1', plan({ revision: 2 }));
        expect(older.status).toBe('INVALID');
        if (older.status !== 'INVALID') throw new Error('unreachable');
        expect(older.issues[0].code).toBe('revision-not-newer');
        expect(firestore.runTransaction).toHaveBeenCalledOnce();
        expect(firestore.setDoc).not.toHaveBeenCalled();
    });

    it('reports a commit denied because a concurrent newer revision landed as revision-not-newer', async () => {
        // The transaction read revision 1, but a concurrent import of revision 3 committed
        // first; rules then deny the stale header update and the SDK does not retry.
        firestore.committedDocs.set('users/u1/external_plans/autumn-block', { revision: 3 });
        firestore.failNextTransaction(Object.assign(new Error('denied'), { code: 'permission-denied' }));

        const result = await new ExternalPlanService().import('u1', plan({ revision: 2 }));

        expect(result).toEqual({
            status: 'INVALID',
            issues: [{ code: 'revision-not-newer', field: 'revision', documentPath: 'users/u1/external_plans/autumn-block' }],
        });
        expect(firestore.transactions).toHaveLength(0);
        expect(firestore.setDoc).not.toHaveBeenCalled();
    });

    it.each([
        ['no stored header', undefined],
        ['a stored header that is not newer', { revision: 2 }],
    ])('keeps a permission denial non-retryable when there is %s', async (_label, header) => {
        if (header) firestore.committedDocs.set('users/u1/external_plans/autumn-block', header);
        firestore.failNextTransaction(Object.assign(new Error('denied'), { code: 'permission-denied' }));

        const result = await new ExternalPlanService().import('u1', plan({ revision: 2 }));

        expect(result).toMatchObject({ status: 'UNAVAILABLE', operation: 'import external plan', retryable: false });
    });

    it('keeps the original denial when the header cannot be re-read', async () => {
        firestore.failNextTransaction(Object.assign(new Error('denied'), { code: 'permission-denied' }));
        firestore.getDoc.mockRejectedValueOnce(new Error('offline'));

        const result = await new ExternalPlanService().import('u1', plan({ revision: 2 }));

        expect(result).toMatchObject({ status: 'UNAVAILABLE', operation: 'import external plan', retryable: false, message: 'denied' });
        expect(firestore.getDoc).toHaveBeenCalledOnce();
    });

    it('does not re-read the header for a retryable transaction failure', async () => {
        firestore.committedDocs.set('users/u1/external_plans/autumn-block', { revision: 3 });
        firestore.failNextTransaction(new Error('network error during transaction'));

        const result = await new ExternalPlanService().import('u1', plan({ revision: 2 }));

        expect(result).toMatchObject({ status: 'UNAVAILABLE', retryable: true });
        expect(firestore.getDoc).not.toHaveBeenCalled();
    });

    it('allows a newer revision only after validating the immutable predecessor bytes', async () => {
        const predecessor = plan({ revision: 3 });
        const hash = await computeContentHash(predecessor as never);
        firestore.committedDocs.set('users/u1/external_plans/autumn-block', {
            userId: 'u1', planId: 'autumn-block', revision: 3, title: '4-week block', startDate: '2026-08-17',
            weekCount: 4, contentHash: hash, importedAt: '2026-08-17T00:00:00.000Z', supersededFrom: '2026-08-17', updatedAt: '2026-08-17T00:00:00.000Z',
        });
        firestore.committedDocs.set('users/u1/external_plans/autumn-block/revisions/3', predecessor);
        firestore.committedDocs.set('users/u1/external_plans/autumn-block/activations/3', {
            userId: 'u1', planId: 'autumn-block', revision: 3, contentHash: hash, effectiveFrom: '2026-08-17', activatedAt: '2026-08-17T00:00:00.000Z',
        });

        const newer = await new ExternalPlanService().import('u1', plan({ revision: 4 }));
        expect(newer.status).toBe('AVAILABLE');
    });

    it('records the supersession date on the header without touching earlier revisions', async () => {
        const result = await new ExternalPlanService().import('u1', plan({ revision: 1 }), '2026-08-20');

        expect(result.status).toBe('AVAILABLE');
        if (result.status !== 'AVAILABLE') throw new Error('unreachable');
        expect(result.data.header.supersededFrom).toBe('2026-08-20');
        // Only this revision's own document is written; prior revisions are immutable.
        expect(writtenPaths().filter(path => path.includes('/revisions/'))).toEqual(
            ['users/u1/external_plans/autumn-block/revisions/1'],
        );
        expect(writtenPaths()).toContain('users/u1/external_plans/autumn-block/activations/1');
    });

    it('supersedes forward only, touching nothing a previously adjudicated day depends on', async () => {
        const predecessor = plan({ revision: 1 });
        const hash = await computeContentHash(predecessor as never);
        firestore.committedDocs.set('users/u1/external_plans/autumn-block', {
            userId: 'u1', planId: 'autumn-block', revision: 1, title: '4-week block', startDate: '2026-08-17',
            weekCount: 4, contentHash: hash, importedAt: '2026-08-17T00:00:00.000Z', supersededFrom: '2026-08-17', updatedAt: '2026-08-17T00:00:00.000Z',
        });
        firestore.committedDocs.set('users/u1/external_plans/autumn-block/revisions/1', predecessor);
        firestore.committedDocs.set('users/u1/external_plans/autumn-block/activations/1', {
            userId: 'u1', planId: 'autumn-block', revision: 1, contentHash: hash, effectiveFrom: '2026-08-17', activatedAt: '2026-08-17T00:00:00.000Z',
        });

        const result = await new ExternalPlanService().import('u1', plan({ revision: 2 }), '2026-08-20');
        expect(result.status).toBe('AVAILABLE');

        // Two writes, both additive: the new revision and the header pointer. Nothing under
        // recommendations/ and no earlier revision is rewritten, so yesterday's persisted
        // recommendation and its audit are byte-identical after this import.
        expect(writtenPaths()).toEqual([
            'users/u1/external_plans/autumn-block/revisions/2',
            'users/u1/external_plans/autumn-block/activations/2',
            'users/u1/external_plans/autumn-block',
        ]);
        expect(writtenPaths().some(path => path.includes('/recommendations/'))).toBe(false);
        expect(writtenPaths().some(path => path.endsWith('/revisions/1'))).toBe(false);
    });

    it('materializes a provable legacy predecessor activation before a future successor', async () => {
        const predecessor = plan({ revision: 1 });
        const hash = await computeContentHash(predecessor as never);
        firestore.committedDocs.set('users/u1/external_plans/autumn-block', {
            userId: 'u1', planId: 'autumn-block', revision: 1, title: '4-week block', startDate: '2026-08-17',
            weekCount: 4, contentHash: hash, importedAt: '2026-08-17T00:00:00.000Z', supersededFrom: '2026-08-17', updatedAt: '2026-08-17T00:00:00.000Z',
        });
        firestore.committedDocs.set('users/u1/external_plans/autumn-block/revisions/1', predecessor);

        const result = await new ExternalPlanService().import('u1', plan({ revision: 2 }), '2026-08-20');
        expect(result.status).toBe('AVAILABLE');
        expect(writtenPaths()).toEqual([
            'users/u1/external_plans/autumn-block/activations/1',
            'users/u1/external_plans/autumn-block/revisions/2',
            'users/u1/external_plans/autumn-block/activations/2',
            'users/u1/external_plans/autumn-block',
        ]);
        expect(firestore.committedDocs.get('users/u1/external_plans/autumn-block/activations/1')).toMatchObject({
            revision: 1, effectiveFrom: '2026-08-17', contentHash: hash,
        });
    });

    it('allows a v6 successor to preserve materialized v5 intent blocks', async () => {
        const intentBlock = {
            id: 'block-1', startWeek: 1, startDay: 'monday', endWeek: 2, endDay: 'sunday',
            objectives: [{
                id: 'obj-1', sport: 'cycling', adaptationScope: 'zone2_aerobic', coverageKey: 'aerobic_volume',
                intent: 'maintain', priority: 'must_have',
                doseEnvelope: { min: 60, target: 90, max: 120, unit: 'minutes', floorSemantics: 'soft_floor' },
                knowledgeLineage: ['claim-1'], successCriteria: { minCompletedExposures: 2 },
            }],
            reviewCadenceDays: 14, nextReviewWeek: 2, nextReviewDay: 'sunday',
        };
        const predecessor = plan({
            schema: 'adaptive-training-recommender/external-plan@5', revision: 1, restDays: [], intentBlocks: [intentBlock],
            sessions: [{
                id: 'w1-a', title: 'Threshold', priority: 'key',
                placement: { week: 1, preferredDay: 'tuesday', flexibility: 'preferred', ifMissed: 'drop' },
                gating: { modality: 'cycling', intensity: 'hard', durationMin: 60, durationMax: 75, environment: 'either', equipment: [] },
                definition: fixture01,
            }],
        });
        const hash = await computeContentHash(predecessor as never);
        firestore.committedDocs.set('users/u1/external_plans/autumn-block', {
            userId: 'u1', planId: 'autumn-block', revision: 1, title: '4-week block', startDate: '2026-08-17',
            weekCount: 4, contentHash: hash, importedAt: '2026-08-17T00:00:00.000Z', supersededFrom: '2026-08-17', updatedAt: '2026-08-17T00:00:00.000Z',
        });
        firestore.committedDocs.set('users/u1/external_plans/autumn-block/revisions/1', predecessor);
        firestore.committedDocs.set('users/u1/external_plans/autumn-block/activations/1', {
            userId: 'u1', planId: 'autumn-block', revision: 1, contentHash: hash, effectiveFrom: '2026-08-17', activatedAt: '2026-08-17T00:00:00.000Z',
        });
        const successor = {
            ...predecessor,
            schema: 'adaptive-training-recommender/external-plan@6',
            revision: 2,
            sessions: predecessor.sessions.map((session: { id: string }) => ({ ...session, scaling: { reducible: false } })),
        };

        const result = await new ExternalPlanService().import('u1', successor, '2026-08-20');
        expect(result).toMatchObject({ status: 'AVAILABLE' });
    });

    it('re-validates a stored revision on read instead of trusting it', async () => {
        firestore.getDoc.mockResolvedValue({ exists: () => true, data: () => plan({ startDate: '2026-08-18' }) });

        const state = await new ExternalPlanService().getRevisionState('u1', 'autumn-block', 1);
        expect(state.status).toBe('INVALID');
    });

    it('reports a foreign-owned header as INVALID rather than returning it', async () => {
        firestore.getDoc.mockResolvedValue({ exists: () => true, data: () => ({ userId: 'someone-else', planId: 'autumn-block' }) });

        const state = await new ExternalPlanService().getHeaderState('u1', 'autumn-block');
        expect(state.status).toBe('INVALID');
        if (state.status !== 'INVALID') throw new Error('unreachable');
        expect(state.issues[0].code).toBe('owner-mismatch');
    });

    it('distinguishes a permission denial from a retryable outage', async () => {
        firestore.getDoc.mockRejectedValue(Object.assign(new Error('denied'), { code: 'permission-denied' }));
        const denied = await new ExternalPlanService().getHeaderState('u1', 'autumn-block');
        expect(denied).toMatchObject({ status: 'UNAVAILABLE', retryable: false });

        firestore.getDoc.mockRejectedValue(Object.assign(new Error('offline'), { code: 'unavailable' }));
        const offline = await new ExternalPlanService().getHeaderState('u1', 'autumn-block');
        expect(offline).toMatchObject({ status: 'UNAVAILABLE', retryable: true });
    });

    it('validates the placement overlay on read, the only part rules cannot inspect', async () => {
        // firestore.rules can bound the assignment list's size but cannot iterate it, so
        // without this the mutable half of the plan is validated at no layer at all.
        firestore.getDoc.mockResolvedValue({
            exists: () => true,
            data: () => ({ userId: 'u1', planId: 'autumn-block', revision: 1, updatedAt: 'now', assignments: [{ sessionId: 'a', date: 'not-a-date', status: 'planned' }] }),
        });

        const state = await new ExternalPlanService().getPlacementState('u1', 'autumn-block');
        expect(state.status).toBe('INVALID');
    });

    it('refuses to write an invalid placement overlay', async () => {
        await expect(new ExternalPlanService().savePlacement('u1', {
            planId: 'autumn-block', revision: 1,
            assignments: [{ sessionId: 'a', date: '2026-08-18', status: 'bogus' as never }],
        })).rejects.toThrow(/Invalid placement overlay/);
        expect(firestore.setDoc).not.toHaveBeenCalled();
    });

    it('atomically stores previous and new assignments and requires explicit successors', async () => {
        const service = new ExternalPlanService();
        const initial = { planId: 'autumn-block', revision: 1, assignments: [{ sessionId: 'a', date: '2026-08-18', status: 'planned' as const }] };
        await service.savePlacement('u1', initial);
        await service.savePlacement('u1', { ...initial, assignments: [{ ...initial.assignments[0], date: '2026-08-19', status: 'moved' }] });
        const event = firestore.transactions[1].stagedWrites.find(write => write.path.includes('/placement_history/'))?.data;
        expect(event).toMatchObject({ previous: initial.assignments, assignments: [{ sessionId: 'a', date: '2026-08-19', status: 'moved' }] });
        const superseded = { ...initial, assignments: [{ ...initial.assignments[0], status: 'superseded' as const }] };
        await expect(service.savePlacement('u1', superseded)).rejects.toThrow(/explicit successor/);
        await service.savePlacement('u1', superseded, { a: { revision: 2, sessionId: 'new-a' } });
        expect(firestore.transactions[2].stagedWrites.find(write => write.path.includes('/placement_history/'))?.data)
            .toMatchObject({ successors: { a: { revision: 2, sessionId: 'new-a' } } });
        await service.savePlacement('u1', { ...superseded, assignments: [...superseded.assignments,
            { sessionId: 'b', date: '2026-08-21', status: 'moved' }] });
        expect(firestore.transactions[3].stagedWrites.find(write => write.path.includes('/placement_history/'))?.data)
            .toMatchObject({ successors: { a: { revision: 2, sessionId: 'new-a' } } });
        await expect(service.savePlacement('u1', superseded, { a: { revision: 3, sessionId: 'other' } }))
            .rejects.toThrow(/Cannot replace/);
    });

    it('preserves unknown legacy successors across unrelated saves and history reads', async () => {
        const service = new ExternalPlanService();
        const path = 'users/u1/external_plans/autumn-block/revisions/1/placement/current';
        const old = { sessionId: 'a', date: '2026-08-18', status: 'superseded' as const };
        firestore.committedDocs.set(path, { userId: 'u1', planId: 'autumn-block', revision: 1,
            assignments: [old], updatedAt: '2026-08-18T10:00:00.000Z' });
        const saved = await service.savePlacement('u1', { planId: 'autumn-block', revision: 1,
            assignments: [old, { sessionId: 'b', date: '2026-08-21', status: 'moved' }] });
        expect(saved.successors).toEqual({});
        expect(await service.getPlacementState('u1', 'autumn-block', 1)).toMatchObject({ status: 'AVAILABLE', data: { successors: {} } });
        const event = firestore.transactions[0].stagedWrites.find(write => write.path.includes('/placement_history/'))!.data;
        firestore.getDocs.mockResolvedValue({ docs: [{ data: () => event }] });
        expect(await service.getPlacementHistoryState('u1', 'autumn-block', 1)).toMatchObject({ status: 'AVAILABLE', data: [{ successors: {} }] });
        await expect(service.savePlacement('u1', { planId: 'autumn-block', revision: 1,
            assignments: [{ ...old, date: '2026-08-19' }] })).rejects.toThrow(/explicit successor/);
    });

    it('dates history in Warsaw and leaves no partial writes on transaction failure', async () => {
        vi.useFakeTimers();
        try {
            vi.setSystemTime(new Date('2026-08-17T22:30:00.000Z'));
            const placement = { planId: 'autumn-block', revision: 1, assignments: [] };
            await new ExternalPlanService().savePlacement('u1', placement);
            expect(firestore.transactions[0].stagedWrites.find(write => write.path.includes('/placement_history/'))?.data)
                .toMatchObject({ changedOn: '2026-08-18' });
            firestore.failNextTransaction(new Error('offline'));
            await expect(new ExternalPlanService().savePlacement('u1', placement)).rejects.toThrow('offline');
            expect(firestore.transactions).toHaveLength(1);
        } finally {
            vi.useRealTimers();
        }
    });

    it('dates a change from its clamped recorded instant so a lagging clock cannot reorder history', async () => {
        vi.useFakeTimers();
        try {
            const path = 'users/u1/external_plans/autumn-block/revisions/1/placement/current';
            firestore.committedDocs.set(path, { userId: 'u1', planId: 'autumn-block', revision: 1,
                assignments: [], updatedAt: '2026-08-18T22:30:00.000Z' });
            vi.setSystemTime(new Date('2026-08-18T21:30:00.000Z'));
            await new ExternalPlanService().savePlacement('u1', { planId: 'autumn-block', revision: 1, assignments: [] });
            expect(firestore.transactions[0].stagedWrites.find(write => write.path.includes('/placement_history/'))?.data)
                .toMatchObject({ changedOn: '2026-08-19', recordedAt: '2026-08-18T22:30:00.001Z' });
        } finally {
            vi.useRealTimers();
        }
    });

    it('rejects two assignments claiming the same session', async () => {
        await expect(new ExternalPlanService().savePlacement('u1', {
            planId: 'autumn-block', revision: 1,
            assignments: [
                { sessionId: 'a', date: '2026-08-18', status: 'planned' },
                { sessionId: 'a', date: '2026-08-19', status: 'moved' },
            ],
        })).rejects.toThrow(/at most one assignment/);
    });

    it('rejects history with noncanonical timestamps before reconstructing order', async () => {
        firestore.getDocs.mockResolvedValue({ docs: [{ data: () => ({ userId: 'u1', planId: 'autumn-block', revision: 1,
            changedOn: '2026-08-18', recordedAt: 'invalid', previous: [], assignments: [], successors: {} }) }] });
        await expect(new ExternalPlanService().getPlacementHistoryState('u1', 'autumn-block', 1))
            .resolves.toMatchObject({ status: 'INVALID' });
    });

    describe('saving over a corrupt prior overlay (#1172)', () => {
        const scopedPath = 'users/u1/external_plans/autumn-block/revisions/1/placement/current';
        const legacyPath = 'users/u1/external_plans/autumn-block/placement/current';
        const next = { planId: 'autumn-block', revision: 1, assignments: [{ sessionId: 'a', date: '2026-08-19', status: 'moved' as const }] };
        const eventOf = (index = 0) => firestore.transactions[index].stagedWrites.find(write => write.path.includes('/placement_history/'))?.data;
        const currentOf = (index = 0) => firestore.transactions[index].stagedWrites.find(write => write.path === scopedPath)?.data;

        it.each([
            ['schema-invalid', { userId: 'u1', planId: 'autumn-block', revision: 1, assignments: [{ sessionId: 'a', date: 'bogus', status: 'planned' }], updatedAt: 'x' }, 'current-schema-invalid'],
            ['missing owner', { planId: 'autumn-block', revision: 1, assignments: [], updatedAt: '2026-08-18T10:00:00.000Z' }, 'current-schema-invalid'],
            ['not an object', 'garbage', 'current-schema-invalid'],
            ['wrong plan', { userId: 'u1', planId: 'other', revision: 1, assignments: [], updatedAt: '2026-08-18T10:00:00.000Z' }, 'current-identity-mismatch'],
            ['wrong revision', { userId: 'u1', planId: 'autumn-block', revision: 2, assignments: [], updatedAt: '2026-08-18T10:00:00.000Z' }, 'current-identity-mismatch'],
        ])('replaces a %s revision-scoped overlay and records the unknown prior state', async (_label, corrupt, reason) => {
            firestore.committedDocs.set(scopedPath, corrupt);
            const saved = await new ExternalPlanService().savePlacement('u1', next);
            expect(saved.assignments).toEqual(next.assignments);
            expect(currentOf()).toMatchObject({ userId: 'u1', assignments: next.assignments, successors: {} });
            expect(eventOf()).toMatchObject({ previous: [], previousState: 'invalid', previousStateReason: reason, assignments: next.assignments });
        });

        it.each([
            ['schema-invalid', { userId: 'u1', planId: 'autumn-block', revision: 1, assignments: 'nope', updatedAt: 'x' }, 'legacy-schema-invalid'],
            ['wrong plan', { userId: 'u1', planId: 'other', revision: 1, assignments: [], updatedAt: '2026-08-18T10:00:00.000Z' }, 'legacy-identity-mismatch'],
        ])('does not let a %s legacy overlay block a revision-scoped save', async (_label, corrupt, reason) => {
            firestore.committedDocs.set(legacyPath, corrupt);
            await new ExternalPlanService().savePlacement('u1', next);
            expect(currentOf()).toMatchObject({ assignments: next.assignments });
            expect(eventOf()).toMatchObject({ previous: [], previousState: 'invalid', previousStateReason: reason });
            expect(firestore.transactions[0].stagedWrites.map(write => write.path)).not.toContain(legacyPath);
        });

        it('records no marker for a valid legacy overlay of another revision', async () => {
            firestore.committedDocs.set(legacyPath, { userId: 'u1', planId: 'autumn-block', revision: 2, assignments: [], updatedAt: '2026-08-18T10:00:00.000Z' });
            await new ExternalPlanService().savePlacement('u1', next);
            const event = eventOf() as Record<string, unknown>;
            expect(event.previous).toEqual([]);
            expect(event).not.toHaveProperty('previousState');
            expect(event).not.toHaveProperty('previousStateReason');
        });

        it.each([
            ['current', scopedPath, { userId: 'u2', planId: 'autumn-block', revision: 1, assignments: [], updatedAt: '2026-08-18T10:00:00.000Z' }],
            ['corrupt current', scopedPath, { userId: 'u2', planId: 'autumn-block', revision: 1, assignments: 'nope' }],
            ['legacy', legacyPath, { userId: 'u2', planId: 'autumn-block', revision: 1, assignments: [], updatedAt: '2026-08-18T10:00:00.000Z' }],
        ])('still refuses to overwrite a %s overlay that claims another owner', async (_label, path, foreign) => {
            firestore.committedDocs.set(path, foreign);
            await expect(new ExternalPlanService().savePlacement('u1', next)).rejects.toThrow(/owner/);
            expect(firestore.transactions).toHaveLength(0);
        });

        it('retains no successor from a corrupt prior but still validates supplied successors', async () => {
            const superseded = { ...next, assignments: [{ sessionId: 'a', date: '2026-08-19', status: 'superseded' as const }] };
            firestore.committedDocs.set(scopedPath, { userId: 'u1', planId: 'autumn-block', revision: 1, assignments: superseded.assignments,
                successors: { a: { revision: 2, sessionId: 'kept' } }, updatedAt: '2026-08-18T10:00:00.000Z', junk: true });
            const service = new ExternalPlanService();
            await expect(service.savePlacement('u1', superseded)).rejects.toThrow(/explicit successor/);
            await expect(service.savePlacement('u1', superseded, { a: { revision: 1, sessionId: 'x' } })).rejects.toThrow(/explicit successor/);
            await service.savePlacement('u1', superseded, { a: { revision: 3, sessionId: 'new-a' } });
            expect(eventOf()).toMatchObject({ previousState: 'invalid', previous: [], successors: { a: { revision: 3, sessionId: 'new-a' } } });
            await expect(service.savePlacement('u1', superseded, { a: { revision: 4, sessionId: 'other' } })).rejects.toThrow(/Cannot replace/);
        });

        it('floors a repair event after the corrupt overlay updatedAt so it cannot sort first', async () => {
            vi.useFakeTimers();
            try {
                vi.setSystemTime(new Date('2026-08-18T21:30:00.000Z'));
                firestore.committedDocs.set(scopedPath, { userId: 'u1', planId: 'autumn-block', revision: 1, assignments: 'nope',
                    updatedAt: '2026-08-18T22:30:00.000Z' });
                await new ExternalPlanService().savePlacement('u1', next);
                expect(eventOf()).toMatchObject({ previousState: 'invalid', recordedAt: '2026-08-18T22:30:00.001Z', changedOn: '2026-08-19' });
                firestore.committedDocs.set(scopedPath, { userId: 'u1', planId: 'autumn-block', revision: 1, assignments: 'nope',
                    updatedAt: '2026-08-18T22:30:00Z' });
                await new ExternalPlanService().savePlacement('u1', next);
                expect(eventOf(1)).toMatchObject({ recordedAt: '2026-08-18T21:30:00.000Z' });
            } finally {
                vi.useRealTimers();
            }
        });

        it('accepts the marker on history reads and rejects a marker that carries previous assignments', async () => {
            firestore.committedDocs.set(scopedPath, 'garbage');
            const service = new ExternalPlanService();
            await service.savePlacement('u1', next);
            const event = eventOf() as Record<string, unknown>;
            firestore.getDocs.mockResolvedValue({ docs: [{ data: () => event }] });
            await expect(service.getPlacementHistoryState('u1', 'autumn-block', 1))
                .resolves.toMatchObject({ status: 'AVAILABLE', data: [{ previousState: 'invalid', previousStateReason: 'current-schema-invalid' }] });
            for (const tampered of [
                { ...event, previous: next.assignments },
                { ...event, previousStateReason: 'made-up' },
                { ...event, previousStateReason: undefined },
                { ...event, previousState: 'valid' },
                { ...event, previousState: undefined },
            ]) {
                firestore.getDocs.mockResolvedValue({ docs: [{ data: () => tampered }] });
                await expect(service.getPlacementHistoryState('u1', 'autumn-block', 1)).resolves.toMatchObject({ status: 'INVALID' });
            }
        });
    });

    describe('bounded placement history read (#1172)', () => {
        const event = (index: number) => ({ userId: 'u1', planId: 'autumn-block', revision: 1, changedOn: '2026-08-18',
            recordedAt: new Date(Date.UTC(2026, 7, 18, 10, 0, 0, index)).toISOString(), previous: [], assignments: [], successors: {} });

        /** Serves `total` stored events in document-id order, honouring each page's limit and cursor. */
        function storeEvents(total: number) {
            const docs = Array.from({ length: total }, (_, i) => ({ id: `e${String(i).padStart(5, '0')}`, data: () => event(i) }));
            firestore.query.mockImplementation((ref: unknown, ...constraints: Array<{ limit?: number; startAfter?: { id: string } }>) => ({ ref, constraints: constraints.filter(Boolean) }));
            firestore.getDocs.mockImplementation(async (request: { constraints: Array<{ limit?: number; startAfter?: { id: string } }> }) => {
                const size = request.constraints.find(item => item.limit !== undefined)!.limit!;
                const after = request.constraints.find(item => item.startAfter)?.startAfter;
                const from = after ? docs.findIndex(item => item.id === after.id) + 1 : 0;
                return { docs: docs.slice(from, from + size) };
            });
        }

        afterEach(() => { firestore.query.mockImplementation((ref: unknown) => ref); });

        it('pages through the whole history in document-id order', async () => {
            const total = PLACEMENT_HISTORY_PAGE_SIZE * 2 + 50;
            storeEvents(total);
            const state = await new ExternalPlanService().getPlacementHistoryState('u1', 'autumn-block', 1);
            expect(state).toMatchObject({ status: 'AVAILABLE' });
            if (state.status !== 'AVAILABLE') throw new Error('unreachable');
            expect(state.data).toHaveLength(total);
            expect(state.data.map(item => item.recordedAt)).toEqual(Array.from({ length: total }, (_, i) => event(i).recordedAt));
            expect(firestore.getDocs).toHaveBeenCalledTimes(3);
            expect(firestore.limit).toHaveBeenCalledWith(PLACEMENT_HISTORY_PAGE_SIZE);
            expect(firestore.documentId).toHaveBeenCalled();
        });

        it('reads exactly the hard bound as complete', async () => {
            storeEvents(PLACEMENT_HISTORY_MAX_SCANNED_EVENTS);
            const state = await new ExternalPlanService().getPlacementHistoryState('u1', 'autumn-block', 1);
            expect(state).toMatchObject({ status: 'AVAILABLE' });
            if (state.status !== 'AVAILABLE') throw new Error('unreachable');
            expect(state.data).toHaveLength(PLACEMENT_HISTORY_MAX_SCANNED_EVENTS);
        });

        it('reports a history beyond the hard bound as truncated, never partial data', async () => {
            expect(PLACEMENT_HISTORY_MAX_SCANNED_EVENTS).toBeGreaterThanOrEqual(PLACEMENT_HISTORY_PAGE_SIZE * 10);
            storeEvents(PLACEMENT_HISTORY_MAX_SCANNED_EVENTS + 1);
            const state = await new ExternalPlanService().getPlacementHistoryState('u1', 'autumn-block', 1);
            expect(state).toMatchObject({ status: 'UNAVAILABLE', retryable: false, operation: PLACEMENT_HISTORY_TRUNCATED_OPERATION });
            expect(state).not.toHaveProperty('data');
        });
    });

    it('rejects an activation whose payload revision disagrees with its document id', async () => {
        firestore.getDocs.mockResolvedValue({
            docs: [{
                id: '2',
                data: () => ({
                    userId: 'u1',
                    planId: 'autumn-block',
                    revision: 1,
                    contentHash: 'a'.repeat(64),
                    effectiveFrom: '2026-08-17',
                    activatedAt: '2026-08-16T10:00:00Z',
                }),
            }],
        });

        const state = await new ExternalPlanService().getActivationState('u1', 'autumn-block');
        expect(state.status).toBe('INVALID');
        if (state.status !== 'INVALID') throw new Error('unreachable');
        expect(state.issues).toEqual([{
            code: 'path-identity-mismatch',
            field: 'revision',
            documentPath: 'users/u1/external_plans/autumn-block/activations/2',
        }]);
    });

    it('distinguishes an inapplicable legacy overlay from corrupt revision-scoped placement', async () => {
        const legacyPath = 'users/u1/external_plans/autumn-block/placement/current';
        const scopedPath = 'users/u1/external_plans/autumn-block/revisions/2/placement/current';
        firestore.committedDocs.set(legacyPath, {
            userId: 'u1',
            planId: 'autumn-block',
            revision: 1,
            assignments: [],
            updatedAt: '2026-08-18T07:00:00Z',
        });

        const service = new ExternalPlanService();
        const legacyMismatch = await service.getPlacementState('u1', 'autumn-block', 2);
        expect(legacyMismatch.status).toBe('MISSING');

        firestore.committedDocs.set(scopedPath, {
            userId: 'u1',
            planId: 'autumn-block',
            revision: 1,
            assignments: [],
            updatedAt: '2026-08-18T07:00:00Z',
        });
        const scopedMismatch = await service.getPlacementState('u1', 'autumn-block', 2);
        expect(scopedMismatch.status).toBe('INVALID');
        if (scopedMismatch.status !== 'INVALID') throw new Error('unreachable');
        expect(scopedMismatch.issues).toEqual([{
            code: 'path-identity-mismatch',
            field: 'revision',
            documentPath: scopedPath,
        }]);
    });

    it('treats a byte-identical same-revision retry as idempotent, without new writes', async () => {
        const service = new ExternalPlanService();
        const first = await service.import('u1', plan(), '2026-08-17');
        expect(first.status).toBe('AVAILABLE');
        if (first.status !== 'AVAILABLE') throw new Error('unreachable');
        const writesAfterFirst = writtenPaths().length;

        const retry = await service.import('u1', plan(), '2026-08-17');
        expect(retry.status).toBe('AVAILABLE');
        if (retry.status !== 'AVAILABLE') throw new Error('unreachable');
        expect(retry.data.header).toEqual(first.data.header);
        // The idempotent retry stages no writes: header, revision bytes and activation
        // history are byte-identical, including importedAt.
        expect(writtenPaths().length).toBe(writesAfterFirst);
        expect(firestore.transactions[1].stagedWrites).toEqual([]);
    });

    it('fails closed when the same revision content is replayed with a different effective date', async () => {
        const service = new ExternalPlanService();
        const first = await service.import('u1', plan(), '2026-08-17');
        expect(first.status).toBe('AVAILABLE');

        const writesBefore = writtenPaths().length;
        const replay = await service.import('u1', plan(), '2026-08-20');
        expect(replay.status).toBe('INVALID');
        if (replay.status !== 'INVALID') throw new Error('unreachable');
        expect(replay.issues[0].code).toBe('immutable-activation-conflict');
        expect(replay.issues[0].documentPath).toBe('users/u1/external_plans/autumn-block/activations/1');
        expect(writtenPaths().length).toBe(writesBefore);
    });

    it('pins the immutable-revision conflict for same-revision content that differs', async () => {
        const service = new ExternalPlanService();
        const first = await service.import('u1', plan(), '2026-08-17');
        expect(first.status).toBe('AVAILABLE');

        const edited = plan();
        edited.sessions[0].title = 'Threshold (edited)';
        const conflict = await service.import('u1', edited, '2026-08-17');
        expect(conflict.status).toBe('INVALID');
        if (conflict.status !== 'INVALID') throw new Error('unreachable');
        expect(conflict.issues[0].code).toBe('immutable-revision-conflict');
    });

    it('rejects a successor whose effective date regresses before the predecessor activation', async () => {
        const predecessor = plan({ revision: 1 });
        const hash = await computeContentHash(predecessor as never);
        firestore.committedDocs.set('users/u1/external_plans/autumn-block', {
            userId: 'u1', planId: 'autumn-block', revision: 1, title: '4-week block', startDate: '2026-08-17',
            weekCount: 4, contentHash: hash, importedAt: '2026-08-17T00:00:00.000Z', supersededFrom: '2026-08-20', updatedAt: '2026-08-17T00:00:00.000Z',
        });
        firestore.committedDocs.set('users/u1/external_plans/autumn-block/revisions/1', predecessor);
        firestore.committedDocs.set('users/u1/external_plans/autumn-block/activations/1', {
            userId: 'u1', planId: 'autumn-block', revision: 1, contentHash: hash, effectiveFrom: '2026-08-20', activatedAt: '2026-08-17T00:00:00.000Z',
        });

        const writesBefore = writtenPaths().length;
        const result = await new ExternalPlanService().import('u1', plan({ revision: 2 }), '2026-08-18');
        expect(result.status).toBe('INVALID');
        if (result.status !== 'INVALID') throw new Error('unreachable');
        expect(result.issues[0].code).toBe('activation-date-regression');
        expect(writtenPaths().length).toBe(writesBefore);
    });

    it('rejects a conflicting same-revision successor replay and covers the transaction contention read-set', async () => {
        const predecessor = plan({ revision: 1 });
        const hash = await computeContentHash(predecessor as never);
        firestore.committedDocs.set('users/u1/external_plans/autumn-block', {
            userId: 'u1', planId: 'autumn-block', revision: 1, title: '4-week block', startDate: '2026-08-17',
            weekCount: 4, contentHash: hash, importedAt: '2026-08-17T00:00:00.000Z', supersededFrom: '2026-08-17', updatedAt: '2026-08-17T00:00:00.000Z',
        });
        firestore.committedDocs.set('users/u1/external_plans/autumn-block/revisions/1', predecessor);
        firestore.committedDocs.set('users/u1/external_plans/autumn-block/activations/1', {
            userId: 'u1', planId: 'autumn-block', revision: 1, contentHash: hash, effectiveFrom: '2026-08-17', activatedAt: '2026-08-17T00:00:00.000Z',
        });

        const service = new ExternalPlanService();
        // This unit double executes the imports serially; it does not pretend to emulate
        // Firestore contention. The second call pins the losing replay contract, while the
        // read-set assertion below proves the production transaction reads every document
        // whose concurrent mutation must trigger Firestore's retry semantics.
        const first = await service.import('u1', plan({ revision: 2 }), '2026-08-20');
        expect(first.status).toBe('AVAILABLE');
        const second = await service.import('u1', plan({ revision: 2 }), '2026-08-24');
        expect(second.status).toBe('INVALID');
        if (second.status !== 'INVALID') throw new Error('unreachable');
        expect(second.issues[0].code).toBe('immutable-activation-conflict');

        const latest = firestore.committedDocs.get('users/u1/external_plans/autumn-block') as { supersededFrom: string };
        expect(latest.supersededFrom).toBe('2026-08-20');
        // The transaction read-set covers header + revision + activation, which is the
        // precondition for Firestore's retry-on-contention semantics in production.
        expect(readPaths()).toEqual(expect.arrayContaining([
            'users/u1/external_plans/autumn-block',
            'users/u1/external_plans/autumn-block/revisions/2',
            'users/u1/external_plans/autumn-block/activations/2',
        ]));
    });

    it('fails closed when legacy history cannot prove the claimed activation date', async () => {
        const predecessor = plan({ revision: 1 });
        const hash = await computeContentHash(predecessor as never);
        firestore.committedDocs.set('users/u1/external_plans/autumn-block', {
            userId: 'u1', planId: 'autumn-block', revision: 1, title: '4-week block', startDate: '2026-08-17',
            weekCount: 4, contentHash: hash, importedAt: '2026-08-17T00:00:00.000Z', supersededFrom: '2026-08-17', updatedAt: '2026-08-17T00:00:00.000Z',
        });
        firestore.committedDocs.set('users/u1/external_plans/autumn-block/revisions/1', predecessor);

        const writesBefore = writtenPaths().length;
        const result = await new ExternalPlanService().import('u1', plan(), '2026-08-20');
        expect(result.status).toBe('INVALID');
        if (result.status !== 'INVALID') throw new Error('unreachable');
        expect(result.issues[0].code).toBe('activation-history-unavailable');
        expect(writtenPaths().length).toBe(writesBefore);
    });
});

describe('computeContentHash', () => {
    it('is stable across key ordering, so a Firestore round-trip does not change it', async () => {
        const ordered = plan();
        const reordered = { sessions: ordered.sessions, weekCount: 4, startDate: '2026-08-17', title: '4-week block', revision: 1, planId: 'autumn-block', schema: EXTERNAL_PLAN_SCHEMA };

        expect(await computeContentHash(reordered as never)).toBe(await computeContentHash(ordered as never));
    });

    it('changes when any session content changes, which is what makes replay verifiable', async () => {
        const edited = plan();
        edited.sessions[0].title = 'Threshold (edited)';

        expect(await computeContentHash(edited as never)).not.toBe(await computeContentHash(plan() as never));
    });
});
