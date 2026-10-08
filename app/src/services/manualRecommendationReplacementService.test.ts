import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExternalPlanSessionOccurrence, ManualOccurrenceRef } from '../sessions/models';
import type { DailyRecommendation } from '../engine/models';

const firestore = vi.hoisted(() => ({
    doc: vi.fn((...parts: string[]) => ({ path: parts.slice(1).join('/') })),
    runTransaction: vi.fn(),
}));
const parsers = vi.hoisted(() => ({
    parseDailyRecommendation: vi.fn(),
    parseSessionOccurrenceDocument: vi.fn(),
}));

vi.mock('firebase/firestore', () => firestore);
vi.mock('../firebase', () => ({ getDb: vi.fn(() => ({})) }));
vi.mock('../persistence/parsers/trainingHistory', () => ({
    parseDailyRecommendation: parsers.parseDailyRecommendation,
}));
vi.mock('../persistence/parsers/sessionDefinition', () => ({
    parseSessionOccurrenceDocument: parsers.parseSessionOccurrenceDocument,
}));

import { ManualRecommendationReplacementService } from './manualRecommendationReplacementService';

const definitionRef: ManualOccurrenceRef = {
    definitionId: 'manual-def',
    revision: 3,
    contentHash: 'm'.repeat(64),
};

const externalOccurrence: ExternalPlanSessionOccurrence = {
    userId: 'u1',
    occurrenceId: 'occ-external-1',
    date: '2026-10-05',
    authority: 'external_plan',
    externalPlanRef: {
        planId: 'coach-plan',
        revision: 7,
        sessionId: 'am-ride',
        contentHash: 'e'.repeat(64),
    },
    state: 'scheduled',
    placementOrder: 0,
    windowBinding: {
        windowId: 'am',
        bundleId: 'two-a-day',
        order: 0,
        boundStartLocal: '06:00',
        boundEndLocal: '07:30',
        startInstant: '2026-10-05T04:00:00.000Z',
        endInstant: '2026-10-05T05:30:00.000Z',
    },
    createdAt: '2026-10-05T03:30:00.000Z',
    updatedAt: '2026-10-05T03:30:00.000Z',
};

type Snapshot = { exists: () => boolean; data: () => unknown };
type FakeTransaction = {
    get: ReturnType<typeof vi.fn>;
    set: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
};
type TransactionCallback = (transaction: FakeTransaction) => unknown;

function snapshot(data?: unknown): Snapshot {
    return {
        exists: () => data !== undefined,
        data: () => data,
    };
}

describe('ManualRecommendationReplacementService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        parsers.parseDailyRecommendation.mockReturnValue({
            status: 'AVAILABLE',
            data: { primarySession: { occurrenceId: externalOccurrence.occurrenceId } },
        });
        parsers.parseSessionOccurrenceDocument.mockReturnValue({
            status: 'AVAILABLE',
            data: externalOccurrence,
        });
    });

    it('schedules replacement intent without retiring the primary before adjudication', async () => {
        const writes = new Map<string, unknown>();
        const deletes: string[] = [];
        const tx: FakeTransaction = {
            get: vi.fn(async (ref: { path: string }) => {
                if (ref.path.endsWith(`/daily_recommendations/${externalOccurrence.date}`)) {
                    return snapshot({ recommendation: true });
                }
                if (ref.path.endsWith(`/session_occurrences/${externalOccurrence.occurrenceId}`)) {
                    return snapshot({ occurrence: true });
                }
                if (ref.path.includes('/session_execution_locks/')) return snapshot();
                if (ref.path.includes('/session_occurrence_windows/')) {
                    return snapshot({ occurrenceId: externalOccurrence.occurrenceId });
                }
                return snapshot();
            }),
            set: vi.fn((ref: { path: string }, value: unknown) => writes.set(ref.path, value)),
            delete: vi.fn((ref: { path: string }) => deletes.push(ref.path)),
        };
        firestore.runTransaction.mockImplementation(async (_db: unknown, cb: TransactionCallback) => cb(tx));

        const service = new ManualRecommendationReplacementService({} as never);
        const replacement = await service.replaceRecommendationOccurrence(
            'u1',
            externalOccurrence.date,
            definitionRef,
            '2026-10-05T05:00:00.000Z',
        );

        expect(replacement.authority).toBe('replace_recommendation');
        expect(replacement.state).toBe('scheduled');
        expect(replacement.occurrenceId).not.toBe(externalOccurrence.occurrenceId);
        expect(writes.has(`users/u1/session_occurrences/${externalOccurrence.occurrenceId}`)).toBe(false);
        expect([...writes.values()]).toContainEqual(
            expect.objectContaining({ occurrenceId: replacement.occurrenceId, authority: 'replace_recommendation' }),
        );
        expect(writes.size).toBe(1);
        expect(deletes).toHaveLength(0);
    });

    it('fails closed instead of superseding an occurrence that has already started', async () => {
        parsers.parseSessionOccurrenceDocument.mockReturnValue({
            status: 'AVAILABLE',
            data: { ...externalOccurrence, state: 'active' },
        });
        const tx: FakeTransaction = {
            get: vi.fn(async (ref: { path: string }) => ref.path.includes('/daily_recommendations/')
                ? snapshot({ recommendation: true })
                : snapshot({ occurrence: true })),
            set: vi.fn(),
            delete: vi.fn(),
        };
        firestore.runTransaction.mockImplementation(async (_db: unknown, cb: TransactionCallback) => cb(tx));

        const service = new ManualRecommendationReplacementService({} as never);
        await expect(service.replaceRecommendationOccurrence('u1', externalOccurrence.date, definitionRef))
            .rejects.toThrow("already 'active'");
        expect(tx.set).not.toHaveBeenCalled();
        expect(tx.delete).not.toHaveBeenCalled();
    });

    it('does not guess a displaced external occurrence when the saved recommendation has no primary binding', async () => {
        parsers.parseDailyRecommendation.mockReturnValue({ status: 'AVAILABLE', data: {} });
        const tx: FakeTransaction = {
            get: vi.fn(async () => snapshot({ recommendation: true })),
            set: vi.fn(),
            delete: vi.fn(),
        };
        firestore.runTransaction.mockImplementation(async (_db: unknown, cb: TransactionCallback) => cb(tx));

        const service = new ManualRecommendationReplacementService({} as never);
        const replacement = await service.replaceRecommendationOccurrence('u1', externalOccurrence.date, definitionRef);

        expect(replacement.authority).toBe('replace_recommendation');
        expect(tx.get).toHaveBeenCalledTimes(1);
        expect(tx.delete).not.toHaveBeenCalled();
        expect(tx.set).toHaveBeenCalledTimes(1);
    });

    function transferFixture(state: string = 'scheduled', owner = externalOccurrence.occurrenceId, hasExecution = false) {
        const replacement = {
            ...externalOccurrence, occurrenceId: 'occ-manual', authority: 'replace_recommendation',
            definitionRef, state: 'scheduled',
        };
        const binding = {
            occurrenceId: replacement.occurrenceId, prescriptionHash: 'p'.repeat(64),
            sessionSource: { kind: 'manual', ...definitionRef },
        };
        const accepted = {
            primarySession: binding, updatedAt: '2026-10-05T05:00:00Z',
            recommendationAudit: { authoredOccurrence: { occurrenceId: replacement.occurrenceId, decision: 'proceed' }, primarySession: binding },
        } as DailyRecommendation;
        parsers.parseSessionOccurrenceDocument.mockImplementation((raw: unknown) => ({ status: 'AVAILABLE', data: raw }));
        const tx: FakeTransaction = {
            get: vi.fn(async (ref: { path: string }) => {
                if (ref.path.includes('/session_execution_locks/')) return snapshot(hasExecution ? { executionId: 'exec-primary' } : undefined);
                if (ref.path.endsWith('/occ-manual')) return snapshot(replacement);
                if (ref.path.endsWith(`/${externalOccurrence.occurrenceId}`)) return snapshot({ ...externalOccurrence, state });
                return snapshot({ occurrenceId: owner });
            }),
            set: vi.fn(), delete: vi.fn(),
        };
        const prior = { primarySession: { occurrenceId: externalOccurrence.occurrenceId } } as DailyRecommendation;
        return { tx, prior, accepted };
    }

    it('supersedes the exact scheduled primary and releases its window in the recommendation transaction', async () => {
        const { tx, prior, accepted } = transferFixture();
        await new ManualRecommendationReplacementService({} as never).transferAuthorityInTransaction(
            tx as never, 'u1', externalOccurrence.date, prior, accepted,
        );
        expect(tx.set).toHaveBeenCalledWith(
            { path: `users/u1/session_occurrences/${externalOccurrence.occurrenceId}` },
            expect.objectContaining({ state: 'superseded', externalPlanRef: externalOccurrence.externalPlanRef }),
        );
        expect(tx.delete).toHaveBeenCalledWith({ path: 'users/u1/session_occurrence_windows/win-2026-10-05-am' });
    });

    it.each(['active', 'completed', 'abandoned'])('refuses to transfer already %s history without writes', async state => {
        const { tx, prior, accepted } = transferFixture(state);
        await expect(new ManualRecommendationReplacementService({} as never).transferAuthorityInTransaction(
            tx as never, 'u1', externalOccurrence.date, prior, accepted,
        )).rejects.toThrow(`already '${state}'`);
        expect(tx.set).not.toHaveBeenCalled();
        expect(tx.delete).not.toHaveBeenCalled();
    });

    it('refuses an unowned window and mismatched accepted authority without writes', async () => {
        const { tx, prior, accepted } = transferFixture('scheduled', 'someone-else');
        const service = new ManualRecommendationReplacementService({} as never);
        await expect(service.transferAuthorityInTransaction(tx as never, 'u1', externalOccurrence.date, prior, accepted))
            .rejects.toThrow('owned by another occurrence');
        await expect(service.transferAuthorityInTransaction(tx as never, 'u1', externalOccurrence.date, prior, {
            ...accepted, primarySession: { ...accepted.primarySession!, occurrenceId: 'unrelated' },
        })).rejects.toThrow('no exact accepted manual authority');
        expect(tx.set).not.toHaveBeenCalled();
        expect(tx.delete).not.toHaveBeenCalled();
    });

    it('refuses launch-first history even if the occurrence lifecycle is still scheduled', async () => {
        const { tx, prior, accepted } = transferFixture('scheduled', externalOccurrence.occurrenceId, true);
        await expect(new ManualRecommendationReplacementService({} as never).transferAuthorityInTransaction(
            tx as never, 'u1', externalOccurrence.date, prior, accepted,
        )).rejects.toThrow('already has an execution');
        expect(tx.set).not.toHaveBeenCalled();
        expect(tx.delete).not.toHaveBeenCalled();
    });
});
