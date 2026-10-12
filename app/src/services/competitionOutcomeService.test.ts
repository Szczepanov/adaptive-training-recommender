import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CompetitionOutcome } from '../observations/models';
import type { OutcomeEvaluationSnapshot } from '../outcomes/evaluationSpec';

const firestore = vi.hoisted(() => ({
    doc: vi.fn(),
    getDoc: vi.fn(),
    collection: vi.fn(), getDocs: vi.fn(), documentId: vi.fn(), limit: vi.fn(), orderBy: vi.fn(), query: vi.fn(),
    where: vi.fn(), startAfter: vi.fn(),
    runTransaction: vi.fn(),
    transactionGet: vi.fn(),
    transactionSet: vi.fn(),
}));

vi.mock('firebase/firestore', () => ({
    doc: firestore.doc,
    getDoc: firestore.getDoc,
    runTransaction: firestore.runTransaction,
    collection: firestore.collection, getDocs: firestore.getDocs, documentId: firestore.documentId,
    limit: firestore.limit, orderBy: firestore.orderBy, query: firestore.query,
    where: firestore.where, startAfter: firestore.startAfter,
}));

vi.mock('../firebase', () => ({
    getDb: vi.fn(() => ({ id: 'mock-db' })),
}));

import { CompetitionOutcomeService, competitionOutcomeService } from './competitionOutcomeService';

const validOutcome: CompetitionOutcome = {
    id: 'race-1',
    sport: 'cycling',
    occurredAt: '2026-08-20T10:00:00.000Z',
    source: 'manual',
    result: { completed: true, placing: 5, fieldSize: 50 },
    metrics: { avg_power_w: 280 },
    context: { course: 'circuit-a' },
    createdAt: '2026-08-21T06:00:00.000Z',
};

describe('bounded block review ecological listing', () => {
    const evaluation: OutcomeEvaluationSnapshot = { revision: { id: 'eval', revision: 1, contentHash: 'hash',
        title: 'Block', status: 'active', activatedAt: '2026-08-01T08:00:00Z', createdAt: '2026-08-01T08:00:00Z',
        startDate: '2026-08-20', endDate: '2026-08-21' }, bindings: [] };
    const evaluationRef = { id: 'eval', revision: 1, contentHash: 'hash' };
    const row = (outcome: CompetitionOutcome) => ({ id: outcome.id, data: () => outcome });
    beforeEach(() => { vi.clearAllMocks(); firestore.getDocs.mockReset(); });

    it('caps scoped outcomes and preserves unreadable records and a matching sentinel', async () => {
        firestore.getDocs.mockResolvedValueOnce({ docs: [
            row(validOutcome), { id: 'wrong', data: () => validOutcome }, row({ ...validOutcome, id: 'race-2' }),
        ] }).mockResolvedValueOnce({ docs: [row({ ...validOutcome, id: 'race-3' })] });
        const read = await new CompetitionOutcomeService({} as never).listOutcomesWithDiagnostics('u1', evaluation, '2026-08-21', 2);
        expect(read).toMatchObject({ outcomes: [validOutcome, { ...validOutcome, id: 'race-2' }], unreadableCount: 1, truncated: true });
        expect(firestore.limit).toHaveBeenCalledWith(3);
    });
    it('finds scoped outcomes after more than 100 unrelated records without counting them as evidence', async () => {
        const unrelated = Array.from({ length: 101 }, (_, index) => row({ ...validOutcome, id: `a-${index}`,
            evaluationRef: { ...evaluationRef, id: 'other' } }));
        const matching = { ...validOutcome, id: 'z-matching', evaluationRef };
        firestore.getDocs.mockResolvedValueOnce({ docs: unrelated }).mockResolvedValueOnce({ docs: [row(matching)] });
        const read = await new CompetitionOutcomeService({} as never).listOutcomesWithDiagnostics('u1', evaluation, '2026-08-21');
        expect(read).toMatchObject({ outcomes: [matching], unreadableCount: 0, truncated: false });
        expect(firestore.startAfter).toHaveBeenCalledWith(unrelated.at(-1));
        expect(firestore.getDocs).toHaveBeenCalledTimes(2);
    });
    it('preserves Warsaw windows, exact revision/hash and existing legacy/event binding semantics', async () => {
        const eventEvaluation = { ...evaluation, revision: { ...evaluation.revision, sourceRef: { kind: 'event' as const, id: 'event' } } };
        const matching = { ...validOutcome, id: 'linked', eventRef: 'event', evaluationRef };
        const legacy = { ...validOutcome, id: 'legacy', eventRef: 'event', occurredAt: '2026-08-20T00:30:00+02:00' };
        firestore.getDocs.mockResolvedValueOnce({ docs: [matching, legacy,
            { ...matching, id: 'revision', evaluationRef: { ...evaluationRef, revision: 2 } },
            { ...matching, id: 'hash', evaluationRef: { ...evaluationRef, contentHash: 'other' } },
            { ...matching, id: 'event', eventRef: 'other' }, { ...validOutcome, id: 'unlinked' },
            { ...legacy, id: 'before', occurredAt: '2026-08-19T21:30:00Z' },
            { ...legacy, id: 'future', occurredAt: '2026-08-20T22:30:00Z' },
        ].map(row) });
        const read = await new CompetitionOutcomeService({} as never).listOutcomesWithDiagnostics('u1', eventEvaluation, '2026-08-20');
        expect(read.outcomes).toEqual([matching, legacy]);
        expect(read.truncated).toBe(false);
        expect(firestore.where).toHaveBeenCalledWith('eventRef', '==', 'event');
    });
    it('reports an exhausted scan budget rather than a complete empty scope', async () => {
        const unrelated = Array.from({ length: 201 }, (_, index) => row({ ...validOutcome, id: `a-${index}`,
            occurredAt: '2025-08-20T10:00:00Z' }));
        firestore.getDocs.mockResolvedValueOnce({ docs: unrelated.slice(0, 101) }).mockResolvedValueOnce({ docs: unrelated.slice(101) });
        const read = await new CompetitionOutcomeService({} as never).listOutcomesWithDiagnostics('u1', evaluation, '2026-08-21');
        expect(read).toMatchObject({ outcomes: [], unreadableCount: 0, truncated: true, scanLimitReached: true });
        expect(firestore.getDocs).toHaveBeenCalledTimes(2);
        expect(firestore.limit.mock.calls.map(([count]) => count)).toEqual([101, 100]);
    });
    it('does not read a future evaluation period', async () => {
        const read = await new CompetitionOutcomeService({} as never).listOutcomesWithDiagnostics('u1', evaluation, '2026-08-19');
        expect(read).toMatchObject({ outcomes: [], unreadableCount: 0, truncated: false });
        expect(firestore.getDocs).not.toHaveBeenCalled();
    });
    it('proves completeness when exactly the scan budget exists and the final sentinel is empty', async () => {
        const unrelated = Array.from({ length: 200 }, (_, index) => row({ ...validOutcome, id: `a-${index}`,
            occurredAt: '2025-08-20T10:00:00Z' }));
        firestore.getDocs.mockResolvedValueOnce({ docs: unrelated.slice(0, 100) })
            .mockResolvedValueOnce({ docs: unrelated.slice(100) }).mockResolvedValueOnce({ docs: [] });
        const read = await new CompetitionOutcomeService({} as never).listOutcomesWithDiagnostics('u1', evaluation, '2026-08-21', 99);
        expect(read).toEqual({ outcomes: [], unreadableCount: 0, truncated: false });
        expect(firestore.limit.mock.calls.map(([count]) => count)).toEqual([100, 100, 1]);
    });
});

function snapshot<T>(value: T | null) {
    return value === null
        ? { exists: () => false, data: () => undefined }
        : { exists: () => true, data: () => value };
}

describe('CompetitionOutcomeService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        firestore.doc.mockImplementation((_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }));
        firestore.runTransaction.mockImplementation(async (_db: unknown, update: (transaction: {
            get: typeof firestore.transactionGet;
            set: typeof firestore.transactionSet;
        }) => Promise<unknown>) => update({
            get: firestore.transactionGet,
            set: firestore.transactionSet,
        }));
    });

    describe('createOutcome', () => {
        it('creates and returns valid competition outcome atomically when it does not exist', async () => {
            firestore.transactionGet.mockResolvedValueOnce(snapshot(null));
            const service = new CompetitionOutcomeService();

            const result = await service.createOutcome('user-1', validOutcome);

            expect(result).toEqual(validOutcome);
            expect(firestore.doc).toHaveBeenCalledWith(
                expect.anything(),
                'users',
                'user-1',
                'competition_outcomes',
                'race-1',
            );
            expect(firestore.runTransaction).toHaveBeenCalledOnce();
            expect(firestore.transactionGet).toHaveBeenCalledWith(
                { path: 'users/user-1/competition_outcomes/race-1' },
            );
            expect(firestore.transactionSet).toHaveBeenCalledWith(
                { path: 'users/user-1/competition_outcomes/race-1' },
                validOutcome,
            );
        });

        it('throws an error if the outcome already exists', async () => {
            firestore.transactionGet.mockResolvedValueOnce(snapshot(validOutcome));
            const service = new CompetitionOutcomeService();

            await expect(service.createOutcome('user-1', validOutcome)).rejects.toThrow(
                'Competition outcome race-1 already exists',
            );
            expect(firestore.transactionSet).not.toHaveBeenCalled();
        });

        it('surfaces the same already-exists error when a transaction retry observes a concurrent create', async () => {
            firestore.runTransaction.mockImplementationOnce(async (_db: unknown, update: (transaction: {
                get: () => Promise<ReturnType<typeof snapshot<CompetitionOutcome>>>;
                set: typeof firestore.transactionSet;
            }) => Promise<unknown>) => {
                await update({
                    get: vi.fn().mockResolvedValueOnce(snapshot(null)),
                    set: firestore.transactionSet,
                });
                return update({
                    get: vi.fn().mockResolvedValueOnce(snapshot(validOutcome)),
                    set: firestore.transactionSet,
                });
            });
            const service = new CompetitionOutcomeService();

            await expect(service.createOutcome('user-1', validOutcome)).rejects.toThrow(
                'Competition outcome race-1 already exists',
            );
        });

        it('throws an error if outcome validation fails', async () => {
            const invalidOutcome = { ...validOutcome, sport: 'invalid-sport' as never };
            const service = new CompetitionOutcomeService();

            await expect(service.createOutcome('user-1', invalidOutcome)).rejects.toThrow(
                /Unsupported competition sport/,
            );
            expect(firestore.runTransaction).not.toHaveBeenCalled();
        });
    });

    describe('getOutcome', () => {
        it('returns null when document does not exist', async () => {
            firestore.getDoc.mockResolvedValueOnce(snapshot(null));
            const service = new CompetitionOutcomeService();

            const result = await service.getOutcome('user-1', 'race-1');

            expect(result).toBeNull();
            expect(firestore.doc).toHaveBeenCalledWith(
                expect.anything(),
                'users',
                'user-1',
                'competition_outcomes',
                'race-1',
            );
        });

        it('returns valid competition outcome when document exists and ID matches', async () => {
            firestore.getDoc.mockResolvedValueOnce(snapshot(validOutcome));
            const service = new CompetitionOutcomeService();

            const result = await service.getOutcome('user-1', 'race-1');

            expect(result).toEqual(validOutcome);
        });

        it('throws an error if retrieved outcome has ID mismatch', async () => {
            const mismatchedOutcome = { ...validOutcome, id: 'race-2' };
            firestore.getDoc.mockResolvedValueOnce(snapshot(mismatchedOutcome));
            const service = new CompetitionOutcomeService();

            await expect(service.getOutcome('user-1', 'race-1')).rejects.toThrow(
                'Competition outcome path mismatch for race-1',
            );
        });

        it('throws an error if retrieved outcome fail validation', async () => {
            const invalidStoredOutcome = { ...validOutcome, occurredAt: 'invalid-date' };
            firestore.getDoc.mockResolvedValueOnce(snapshot(invalidStoredOutcome));
            const service = new CompetitionOutcomeService();

            await expect(service.getOutcome('user-1', 'race-1')).rejects.toThrow(
                /must be a valid timestamp/,
            );
        });
    });

    describe('exported singleton instance', () => {
        it('provides exported competitionOutcomeService singleton instance', () => {
            expect(competitionOutcomeService).toBeInstanceOf(CompetitionOutcomeService);
        });
    });
});
