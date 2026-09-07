import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionOccurrence } from '../sessions/models';

const firestore = vi.hoisted(() => ({
    doc: vi.fn(),
    setDoc: vi.fn(),
    getDoc: vi.fn(),
    collection: vi.fn(),
    query: vi.fn(),
    where: vi.fn(),
    getDocs: vi.fn(),
    runTransaction: vi.fn(),
}));

vi.mock('firebase/firestore', () => firestore);
vi.mock('../firebase', () => ({ getDb: vi.fn(() => ({})) }));

import { SessionOccurrenceService } from './sessionOccurrenceService';

const definitionRef: SessionOccurrence['definitionRef'] = {
    definitionId: 'def-1', revision: 1, contentHash: 'a'.repeat(64),
};

function occurrenceDoc(overrides: Partial<SessionOccurrence>): SessionOccurrence {
    return {
        userId: 'u1', occurrenceId: 'occ-1', date: '2026-08-18',
        authority: 'schedule', definitionRef, state: 'scheduled',
        createdAt: '2026-08-18T00:00:00Z', updatedAt: '2026-08-18T00:00:00Z',
        ...overrides,
    };
}

describe('SessionOccurrenceService authority methods (M3.3)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        firestore.doc.mockReturnValue({ path: 'session_occurrences/x' });
        firestore.setDoc.mockResolvedValue(undefined);
        firestore.collection.mockReturnValue({ path: 'session_occurrences' });
        firestore.query.mockReturnValue({});
    });

    it('scheduleOccurrence saves a scheduled occurrence with schedule authority', async () => {
        const service = new SessionOccurrenceService();
        const result = await service.scheduleOccurrence('u1', '2026-08-20', definitionRef);

        expect(result.authority).toBe('schedule');
        expect(result.state).toBe('scheduled');
        const [, payload] = firestore.setDoc.mock.calls[0];
        expect(payload.authority).toBe('schedule');
        expect(payload.date).toBe('2026-08-20');
        expect(payload.definitionRef).toEqual(definitionRef);
    });

    it('replaceRecommendationOccurrence saves with replace_recommendation authority', async () => {
        const service = new SessionOccurrenceService();
        const result = await service.replaceRecommendationOccurrence('u1', '2026-08-18', definitionRef);
        expect(result.authority).toBe('replace_recommendation');
        expect(firestore.setDoc.mock.calls[0][1].authority).toBe('replace_recommendation');
    });

    it('addAdditionalSessionOccurrence saves with additional_session authority and an optional placementOrder', async () => {
        const service = new SessionOccurrenceService();
        const result = await service.addAdditionalSessionOccurrence('u1', '2026-08-18', definitionRef, 2);
        expect(result.authority).toBe('additional_session');
        expect(result.placementOrder).toBe(2);
        expect(firestore.setDoc.mock.calls[0][1].placementOrder).toBe(2);
    });

    it('each authority method produces a distinct occurrenceId', async () => {
        const service = new SessionOccurrenceService();
        const a = await service.scheduleOccurrence('u1', '2026-08-20', definitionRef);
        const b = await service.scheduleOccurrence('u1', '2026-08-21', definitionRef);
        expect(a.occurrenceId).not.toBe(b.occurrenceId);
    });

    it('getReplaceOccurrenceForDate returns only an active replace_recommendation occurrence', async () => {
        firestore.getDocs.mockResolvedValue({
            docs: [
                { data: () => occurrenceDoc({ occurrenceId: 'occ-a', authority: 'schedule' }), ref: { path: 'x' } },
                { data: () => occurrenceDoc({ occurrenceId: 'occ-b', authority: 'replace_recommendation', state: 'superseded' }), ref: { path: 'x' } },
                { data: () => occurrenceDoc({ occurrenceId: 'occ-c', authority: 'replace_recommendation', state: 'active' }), ref: { path: 'x' } },
            ],
        });
        const service = new SessionOccurrenceService();
        const result = await service.getReplaceOccurrenceForDate('u1', '2026-08-18');
        expect(result?.occurrenceId).toBe('occ-c');
    });

    it('getReplaceOccurrenceForDate returns null when nothing is replacing today', async () => {
        firestore.getDocs.mockResolvedValue({
            docs: [{ data: () => occurrenceDoc({ authority: 'schedule' }), ref: { path: 'x' } }],
        });
        const service = new SessionOccurrenceService();
        expect(await service.getReplaceOccurrenceForDate('u1', '2026-08-18')).toBeNull();
    });

    it('fails closed instead of choosing by query order when replacement authority is ambiguous', async () => {
        firestore.getDocs.mockResolvedValue({
            docs: [
                { data: () => occurrenceDoc({ occurrenceId: 'occ-b', authority: 'replace_recommendation', state: 'scheduled' }), ref: { path: 'x' } },
                { data: () => occurrenceDoc({ occurrenceId: 'occ-a', authority: 'replace_recommendation', state: 'active' }), ref: { path: 'x' } },
            ],
        });
        const service = new SessionOccurrenceService();
        await expect(service.getReplaceOccurrenceForDate('u1', '2026-08-18')).rejects.toThrow('authority is ambiguous');
    });

    it('getAdditionalOccurrencesForDate returns only active additional_session occurrences', async () => {
        firestore.getDocs.mockResolvedValue({
            docs: [
                { data: () => occurrenceDoc({ occurrenceId: 'occ-a', authority: 'additional_session', state: 'scheduled' }), ref: { path: 'x' } },
                { data: () => occurrenceDoc({ occurrenceId: 'occ-b', authority: 'additional_session', state: 'completed' }), ref: { path: 'x' } },
                { data: () => occurrenceDoc({ occurrenceId: 'occ-c', authority: 'replace_recommendation', state: 'active' }), ref: { path: 'x' } },
            ],
        });
        const service = new SessionOccurrenceService();
        const result = await service.getAdditionalOccurrencesForDate('u1', '2026-08-18');
        expect(result.map(item => item.occurrenceId)).toEqual(['occ-a']);
    });

    it('orders additional occurrences by placementOrder and occurrenceId', async () => {
        firestore.getDocs.mockResolvedValue({
            docs: [
                { data: () => occurrenceDoc({ occurrenceId: 'occ-z', authority: 'additional_session', placementOrder: 1 }), ref: { path: 'x' } },
                { data: () => occurrenceDoc({ occurrenceId: 'occ-b', authority: 'additional_session', placementOrder: 0 }), ref: { path: 'x' } },
                { data: () => occurrenceDoc({ occurrenceId: 'occ-a', authority: 'additional_session', placementOrder: 0 }), ref: { path: 'x' } },
            ],
        });
        const service = new SessionOccurrenceService();
        const result = await service.getAdditionalOccurrencesForDate('u1', '2026-08-18');
        expect(result.map(item => item.occurrenceId)).toEqual(['occ-a', 'occ-b', 'occ-z']);
    });

    describe('claimOccurrenceLaunch (ADR-0036 D-REASSESS)', () => {
        it('successfully claims a scheduled occurrence and transitions state to active', async () => {
            const scheduled = occurrenceDoc({ occurrenceId: 'occ-1', state: 'scheduled' });
            const mockTx = {
                get: vi.fn().mockResolvedValue({
                    exists: () => true,
                    data: () => scheduled,
                }),
                set: vi.fn(),
            };
            firestore.runTransaction.mockImplementation(async (_db, cb) => cb(mockTx));

            const service = new SessionOccurrenceService();
            const result = await service.claimOccurrenceLaunch('u1', 'occ-1', '2026-08-18T10:00:00Z');

            expect(result.state).toBe('active');
            expect(result.updatedAt).toBe('2026-08-18T10:00:00Z');
            expect(mockTx.set).toHaveBeenCalledWith(
                expect.objectContaining({ path: 'session_occurrences/x' }),
                expect.objectContaining({ state: 'active', updatedAt: '2026-08-18T10:00:00Z' }),
            );
        });

        it('throws when occurrence does not exist', async () => {
            const mockTx = {
                get: vi.fn().mockResolvedValue({
                    exists: () => false,
                    data: () => null,
                }),
                set: vi.fn(),
            };
            firestore.runTransaction.mockImplementation(async (_db, cb) => cb(mockTx));

            const service = new SessionOccurrenceService();
            await expect(service.claimOccurrenceLaunch('u1', 'occ-missing')).rejects.toThrow(
                'Occurrence occ-missing not found.',
            );
            expect(mockTx.set).not.toHaveBeenCalled();
        });

        it('throws when occurrence state is not scheduled', async () => {
            const active = occurrenceDoc({ occurrenceId: 'occ-1', state: 'active' });
            const mockTx = {
                get: vi.fn().mockResolvedValue({
                    exists: () => true,
                    data: () => active,
                }),
                set: vi.fn(),
            };
            firestore.runTransaction.mockImplementation(async (_db, cb) => cb(mockTx));

            const service = new SessionOccurrenceService();
            await expect(service.claimOccurrenceLaunch('u1', 'occ-1')).rejects.toThrow(
                "Occurrence occ-1 cannot be claimed; state is 'active', expected 'scheduled'.",
            );
            expect(mockTx.set).not.toHaveBeenCalled();
        });

        it('throws when occurrence document cannot be parsed', async () => {
            const mockTx = {
                get: vi.fn().mockResolvedValue({
                    exists: () => true,
                    data: () => ({ invalid: 'document' }),
                }),
                set: vi.fn(),
            };
            firestore.runTransaction.mockImplementation(async (_db, cb) => cb(mockTx));

            const service = new SessionOccurrenceService();
            await expect(service.claimOccurrenceLaunch('u1', 'occ-1')).rejects.toThrow(
                'Occurrence occ-1 could not be parsed',
            );
            expect(mockTx.set).not.toHaveBeenCalled();
        });

        it('executes onBeforeClaim hook atomically before claiming occurrence', async () => {
            const scheduled = occurrenceDoc({ occurrenceId: 'occ-1', state: 'scheduled' });
            const mockTx = {
                get: vi.fn().mockResolvedValue({
                    exists: () => true,
                    data: () => scheduled,
                }),
                set: vi.fn(),
            };
            firestore.runTransaction.mockImplementation(async (_db, cb) => cb(mockTx));

            const onBeforeClaim = vi.fn().mockResolvedValue(undefined);
            const service = new SessionOccurrenceService();
            const result = await service.claimOccurrenceLaunch('u1', 'occ-1', {
                now: '2026-08-18T10:00:00Z',
                onBeforeClaim,
            });

            expect(onBeforeClaim).toHaveBeenCalledWith(mockTx, expect.objectContaining({ occurrenceId: 'occ-1', state: 'scheduled' }));
            expect(result.state).toBe('active');
            expect(mockTx.set).toHaveBeenCalledTimes(1);
        });

        it('aborts transaction and does not set occurrence when onBeforeClaim fails', async () => {
            const scheduled = occurrenceDoc({ occurrenceId: 'occ-1', state: 'scheduled' });
            const mockTx = {
                get: vi.fn().mockResolvedValue({
                    exists: () => true,
                    data: () => scheduled,
                }),
                set: vi.fn(),
            };
            firestore.runTransaction.mockImplementation(async (_db, cb) => cb(mockTx));

            const onBeforeClaim = vi.fn().mockRejectedValue(new Error('Revision mismatch'));
            const service = new SessionOccurrenceService();
            await expect(
                service.claimOccurrenceLaunch('u1', 'occ-1', { onBeforeClaim }),
            ).rejects.toThrow('Revision mismatch');

            expect(mockTx.set).not.toHaveBeenCalled();
        });
    });
});
