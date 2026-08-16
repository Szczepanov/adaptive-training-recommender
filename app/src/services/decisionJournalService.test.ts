import { beforeEach, describe, expect, it, vi } from 'vitest';

const DELETE_FIELD_SENTINEL = Symbol('deleteField');

const firestore = vi.hoisted(() => {
    return {
        collection: vi.fn(),
        deleteDoc: vi.fn(),
        deleteField: vi.fn(),
        doc: vi.fn(),
        getDoc: vi.fn(),
        getDocs: vi.fn(),
        orderBy: vi.fn(),
        query: vi.fn(),
        setDoc: vi.fn(),
        where: vi.fn(),
    };
});

vi.mock('firebase/firestore', () => firestore);
vi.mock('../firebase', () => ({ getDb: vi.fn(() => ({})) }));

import { DecisionJournalService } from './decisionJournalService';

const USER_ID = 'u1';
const DATE = '2026-08-16';

function missingDoc() {
    firestore.getDoc.mockResolvedValueOnce({ exists: () => false });
}

function existingDoc(data: Record<string, unknown>) {
    firestore.getDoc.mockResolvedValueOnce({ exists: () => true, data: () => data });
}

function failingRead() {
    firestore.getDoc.mockRejectedValueOnce(new Error('offline'));
}

describe('DecisionJournalService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        firestore.doc.mockReturnValue({ path: `users/${USER_ID}/decision_journal/${DATE}` });
        firestore.setDoc.mockResolvedValue(undefined);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (firestore.deleteField as any).mockReturnValue(DELETE_FIELD_SENTINEL);
    });

    describe('recordMorningEntry', () => {
        it('creates a new entry, locking sawEngineVerdictFirst from the given value and deleting absent optional fields', async () => {
            missingDoc();
            const service = new DecisionJournalService();
            const saved = await service.recordMorningEntry(USER_ID, DATE, {
                externalVerdict: 'proceed', sawEngineVerdictFirst: false,
            });

            expect(saved.sawEngineVerdictFirst).toBe(false);
            expect(firestore.setDoc).toHaveBeenCalledTimes(1);
            const payload = firestore.setDoc.mock.calls[0][1] as Record<string, unknown>;
            expect(payload.externalVerdict).toBe('proceed');
            expect(payload.externalNote).toBe(DELETE_FIELD_SENTINEL);
            expect(payload.actualVerdict).toBe(DELETE_FIELD_SENTINEL);
            expect(payload.sawEngineVerdictFirst).toBe(false);
        });

        it('never re-locks sawEngineVerdictFirst or createdAt on a second morning write, even if asked to', async () => {
            existingDoc({
                userId: USER_ID, date: DATE, externalVerdict: 'proceed', sawEngineVerdictFirst: false,
                createdAt: '2026-08-16T06:00:00Z', updatedAt: '2026-08-16T06:00:00Z', schemaVersion: 1,
            });
            const service = new DecisionJournalService();
            // Attempting to flip sawEngineVerdictFirst to true on a re-submission -- the
            // service must ignore this and keep the value locked at creation, mirroring the
            // immutability firestore.rules enforces server-side.
            const saved = await service.recordMorningEntry(USER_ID, DATE, {
                externalVerdict: 'scale', sawEngineVerdictFirst: true,
            });

            expect(saved.sawEngineVerdictFirst).toBe(false);
            expect(saved.createdAt).toBe('2026-08-16T06:00:00Z');
            const payload = firestore.setDoc.mock.calls[0][1] as Record<string, unknown>;
            expect(payload.sawEngineVerdictFirst).toBe(false);
            expect(payload.createdAt).toBe('2026-08-16T06:00:00Z');
        });

        it('carries a previously-recorded actualVerdict through an edited morning entry', async () => {
            existingDoc({
                userId: USER_ID, date: DATE, externalVerdict: 'proceed', sawEngineVerdictFirst: false,
                actualVerdict: 'skip', createdAt: '2026-08-16T06:00:00Z', updatedAt: '2026-08-16T20:00:00Z', schemaVersion: 1,
            });
            const service = new DecisionJournalService();
            const saved = await service.recordMorningEntry(USER_ID, DATE, {
                externalVerdict: 'defer', sawEngineVerdictFirst: false,
            });

            expect(saved.actualVerdict).toBe('skip');
            const payload = firestore.setDoc.mock.calls[0][1] as Record<string, unknown>;
            expect(payload.actualVerdict).toBe('skip');
        });

        it('rejects with a distinct error on a transient read failure, rather than treating it as "no entry" and re-deriving locked fields', async () => {
            failingRead();
            const service = new DecisionJournalService();
            await expect(service.recordMorningEntry(USER_ID, DATE, {
                externalVerdict: 'proceed', sawEngineVerdictFirst: true,
            })).rejects.toThrow(/could not confirm/i);
            // Must not have attempted a write built from re-derived (wrong) locked fields --
            // that write would only fail downstream against firestore.rules' immutability
            // guard with a confusing generic error.
            expect(firestore.setDoc).not.toHaveBeenCalled();
        });
    });

    describe('recordActualVerdict', () => {
        it('throws when no morning entry exists yet', async () => {
            missingDoc();
            const service = new DecisionJournalService();
            await expect(service.recordActualVerdict(USER_ID, DATE, 'scale')).rejects.toThrow(/record the morning verdict first/);
            expect(firestore.setDoc).not.toHaveBeenCalled();
        });

        it('rejects with a distinct error on a transient read failure, rather than claiming no entry exists', async () => {
            failingRead();
            const service = new DecisionJournalService();
            await expect(service.recordActualVerdict(USER_ID, DATE, 'scale')).rejects.toThrow(/could not confirm/i);
            expect(firestore.setDoc).not.toHaveBeenCalled();
        });

        it('records actualVerdict on an existing entry without disturbing sawEngineVerdictFirst or createdAt', async () => {
            existingDoc({
                userId: USER_ID, date: DATE, externalVerdict: 'proceed', sawEngineVerdictFirst: true,
                createdAt: '2026-08-16T06:00:00Z', updatedAt: '2026-08-16T06:00:00Z', schemaVersion: 1,
            });
            const service = new DecisionJournalService();
            const saved = await service.recordActualVerdict(USER_ID, DATE, 'scale');

            expect(saved.actualVerdict).toBe('scale');
            expect(saved.sawEngineVerdictFirst).toBe(true);
            expect(saved.createdAt).toBe('2026-08-16T06:00:00Z');
            const payload = firestore.setDoc.mock.calls[0][1] as Record<string, unknown>;
            expect(payload.actualVerdict).toBe('scale');
            expect(payload.createdAt).toBe('2026-08-16T06:00:00Z');
        });
    });

    describe('getEntry', () => {
        it('returns null for a document that does not exist', async () => {
            missingDoc();
            const service = new DecisionJournalService();
            expect(await service.getEntry(USER_ID, DATE)).toBeNull();
        });

        it('returns null for a document that fails validation rather than coercing it', async () => {
            existingDoc({ userId: USER_ID, date: DATE, externalVerdict: 'not-a-real-verdict' });
            const service = new DecisionJournalService();
            expect(await service.getEntry(USER_ID, DATE)).toBeNull();
        });
    });
});
