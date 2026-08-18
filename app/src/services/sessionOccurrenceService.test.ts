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
});
