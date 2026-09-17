import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CompetitionOutcome } from '../observations/models';

const firestore = vi.hoisted(() => ({
    doc: vi.fn(),
    getDoc: vi.fn(),
    runTransaction: vi.fn(),
    transactionGet: vi.fn(),
    transactionSet: vi.fn(),
}));

vi.mock('firebase/firestore', () => ({
    doc: firestore.doc,
    getDoc: firestore.getDoc,
    runTransaction: firestore.runTransaction,
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
