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

function validEntry(overrides: Record<string, unknown> = {}) {
    return {
        userId: USER_ID, date: DATE, externalVerdict: 'proceed', sawEngineVerdictFirst: false,
        createdAt: '2026-08-16T06:00:00Z', updatedAt: '2026-08-16T06:00:00Z', schemaVersion: 1,
        ...overrides,
    };
}

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
        firestore.getDocs.mockResolvedValue({ docs: [] });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (firestore.deleteField as any).mockReturnValue(DELETE_FIELD_SENTINEL);
    });

    describe('recordMorningEntry', () => {
        it('creates a new entry with explicit schemaVersion and locks the observed anchoring flag', async () => {
            missingDoc();
            const service = new DecisionJournalService();
            const saved = await service.recordMorningEntry(USER_ID, DATE, {
                externalVerdict: 'proceed', sawEngineVerdictFirst: false,
            });

            expect(saved.sawEngineVerdictFirst).toBe(false);
            expect(saved.schemaVersion).toBe(1);
            expect(firestore.setDoc).toHaveBeenCalledTimes(1);
            const payload = firestore.setDoc.mock.calls[0][1] as Record<string, unknown>;
            expect(payload.externalVerdict).toBe('proceed');
            expect(payload.externalNote).toBe(DELETE_FIELD_SENTINEL);
            expect(payload.actualVerdict).toBe(DELETE_FIELD_SENTINEL);
            expect(payload.sawEngineVerdictFirst).toBe(false);
            expect(payload.schemaVersion).toBe(1);
        });

        it('rejects a second morning write so a blind verdict cannot be rewritten after reveal', async () => {
            existingDoc(validEntry());
            const service = new DecisionJournalService();

            await expect(service.recordMorningEntry(USER_ID, DATE, {
                externalVerdict: 'scale', sawEngineVerdictFirst: true,
            })).rejects.toThrow(/already recorded.*cannot be rewritten/i);

            expect(firestore.setDoc).not.toHaveBeenCalled();
        });

        it('rejects an invalid existing document instead of treating it as a missing day and overwriting evidence', async () => {
            existingDoc({ ...validEntry(), schemaVersion: 99 });
            const service = new DecisionJournalService();
            await expect(service.recordMorningEntry(USER_ID, DATE, {
                externalVerdict: 'proceed', sawEngineVerdictFirst: false,
            })).rejects.toThrow(/stored decision journal entry is invalid/i);
            expect(firestore.setDoc).not.toHaveBeenCalled();
        });

        it('rejects a note beyond the Firestore 2000-character contract before attempting a write', async () => {
            missingDoc();
            const service = new DecisionJournalService();
            await expect(service.recordMorningEntry(USER_ID, DATE, {
                externalVerdict: 'proceed', externalNote: 'x'.repeat(2001), sawEngineVerdictFirst: false,
            })).rejects.toThrow(/2000 characters/i);
            expect(firestore.setDoc).not.toHaveBeenCalled();
        });

        it('rejects with a distinct error on a transient read failure rather than treating it as no entry', async () => {
            failingRead();
            const service = new DecisionJournalService();
            await expect(service.recordMorningEntry(USER_ID, DATE, {
                externalVerdict: 'proceed', sawEngineVerdictFirst: true,
            })).rejects.toThrow(/could not confirm/i);
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

        it('rejects with a distinct error on a transient read failure rather than claiming no entry exists', async () => {
            failingRead();
            const service = new DecisionJournalService();
            await expect(service.recordActualVerdict(USER_ID, DATE, 'scale')).rejects.toThrow(/could not confirm/i);
            expect(firestore.setDoc).not.toHaveBeenCalled();
        });

        it('rejects an invalid stored morning entry rather than mutating malformed evidence', async () => {
            existingDoc({ ...validEntry(), surprise: true });
            const service = new DecisionJournalService();
            await expect(service.recordActualVerdict(USER_ID, DATE, 'scale')).rejects.toThrow(/stored decision journal entry is invalid/i);
            expect(firestore.setDoc).not.toHaveBeenCalled();
        });

        it('records actualVerdict on an existing entry without disturbing the immutable morning observation', async () => {
            existingDoc(validEntry({ externalNote: 'blind note' }));
            const service = new DecisionJournalService();
            const saved = await service.recordActualVerdict(USER_ID, DATE, 'scale');

            expect(saved.actualVerdict).toBe('scale');
            expect(saved.externalVerdict).toBe('proceed');
            expect(saved.externalNote).toBe('blind note');
            expect(saved.sawEngineVerdictFirst).toBe(false);
            expect(saved.createdAt).toBe('2026-08-16T06:00:00Z');
            const payload = firestore.setDoc.mock.calls[0][1] as Record<string, unknown>;
            expect(payload.actualVerdict).toBe('scale');
            expect(payload.externalVerdict).toBe('proceed');
            expect(payload.externalNote).toBe('blind note');
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
            existingDoc({ ...validEntry(), externalVerdict: 'not-a-real-verdict' });
            const service = new DecisionJournalService();
            expect(await service.getEntry(USER_ID, DATE)).toBeNull();
        });
    });

    describe('getEntriesInRange', () => {
        it('returns invalid-record count separately from valid evidence', async () => {
            firestore.getDocs.mockResolvedValueOnce({ docs: [
                { id: DATE, ref: { path: `users/${USER_ID}/decision_journal/${DATE}` }, data: () => validEntry() },
                { id: '2026-08-17', ref: { path: `users/${USER_ID}/decision_journal/2026-08-17` }, data: () => ({ ...validEntry(), date: '2026-08-17', schemaVersion: 99 }) },
            ] });
            const result = await new DecisionJournalService().getEntriesInRange(USER_ID, DATE, '2026-08-17');
            expect(result.entries).toHaveLength(1);
            expect(result.invalidRecords).toBe(1);
        });
    });
});
