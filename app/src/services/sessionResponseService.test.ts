import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionResponse } from '../responses/models';

const firestore = vi.hoisted(() => ({
    doc: vi.fn(),
    updateDoc: vi.fn(),
    getDoc: vi.fn(),
    collection: vi.fn(),
    query: vi.fn(),
    where: vi.fn(),
    getDocs: vi.fn(),
    runTransaction: vi.fn(),
    transactionGet: vi.fn(),
    transactionSet: vi.fn(),
    transactionUpdate: vi.fn(),
}));

vi.mock('firebase/firestore', () => ({
    doc: firestore.doc,
    updateDoc: firestore.updateDoc,
    getDoc: firestore.getDoc,
    collection: firestore.collection,
    query: firestore.query,
    where: firestore.where,
    getDocs: firestore.getDocs,
    runTransaction: firestore.runTransaction,
}));
vi.mock('../firebase', () => ({ getDb: vi.fn(() => ({})) }));

import { SessionResponseService } from './sessionResponseService';

function responseDoc(overrides: Partial<SessionResponse> = {}): SessionResponse {
    return {
        userId: 'u1',
        responseId: 'resp-1',
        sourceSession: { kind: 'execution', id: 'exec-1', date: '2026-08-18' },
        window: 'immediate',
        date: '2026-08-18',
        checkinRef: { date: '2026-08-18' },
        createdAt: '2026-08-18T10:45:00.000Z',
        updatedAt: '2026-08-18T10:45:00.000Z',
        ...overrides,
    };
}

describe('SessionResponseService (M5.1)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        firestore.doc.mockReturnValue({ path: 'session_responses/x' });
        firestore.updateDoc.mockResolvedValue(undefined);
        firestore.collection.mockReturnValue({ path: 'session_responses' });
        firestore.query.mockReturnValue({});
        firestore.getDoc.mockResolvedValue({ exists: () => false });
        firestore.transactionGet.mockResolvedValue({ exists: () => false });
        firestore.runTransaction.mockImplementation(async (_db, callback) => callback({
            get: firestore.transactionGet,
            set: firestore.transactionSet,
            update: firestore.transactionUpdate,
        }));
    });

    it('recordResponse persists linkage and only the non-tissue facts supplied', async () => {
        const service = new SessionResponseService();
        const result = await service.recordResponse(
            'u1',
            { kind: 'execution', id: 'exec-1', date: '2026-08-18' },
            'immediate',
            '2026-08-18',
            '2026-08-18',
            { sessionRpe: 7 },
        );

        expect(result.sourceSession).toEqual({ kind: 'execution', id: 'exec-1', date: '2026-08-18' });
        expect(result.window).toBe('immediate');
        expect(result.checkinRef).toEqual({ date: '2026-08-18' });
        expect(result.sessionRpe).toBe(7);
        expect(result.completedFraction).toBeUndefined();
        expect(result.createdAt).toBe(result.updatedAt);

        const [, payload] = firestore.transactionSet.mock.calls[0];
        expect(payload).not.toHaveProperty('completedFraction');
        expect(payload).not.toHaveProperty('unexpectedFatigue');
    });

    it('recordResponse omits occurrenceId when the source execution carries no selection authority', async () => {
        const service = new SessionResponseService();
        const result = await service.recordResponse(
            'u1', { kind: 'execution', id: 'exec-1', date: '2026-08-18' }, 'immediate', '2026-08-18', '2026-08-18', {},
        );
        expect(result).not.toHaveProperty('occurrenceId');
    });

    it('recordResponse includes occurrenceId when supplied', async () => {
        const service = new SessionResponseService();
        const result = await service.recordResponse(
            'u1', { kind: 'execution', id: 'exec-1', date: '2026-08-18' }, 'immediate', '2026-08-18', '2026-08-18', {}, 'occ-1',
        );
        expect(result.occurrenceId).toBe('occ-1');
    });

    it('each recorded response gets a distinct responseId', async () => {
        const service = new SessionResponseService();
        const a = await service.recordResponse('u1', { kind: 'execution', id: 'exec-1', date: '2026-08-18' }, 'immediate', '2026-08-18', '2026-08-18', {});
        const b = await service.recordResponse('u1', { kind: 'execution', id: 'exec-1', date: '2026-08-18' }, 'later_day', '2026-08-18', '2026-08-18', {});
        expect(a.responseId).not.toBe(b.responseId);
    });

    it('recordResponse rejects a concurrent second create for the same (sourceSession, window)', async () => {
        firestore.transactionGet.mockResolvedValue({ exists: () => true });
        const service = new SessionResponseService();
        await expect(service.recordResponse(
            'u1', { kind: 'execution', id: 'exec-1', date: '2026-08-18' }, 'immediate', '2026-08-18', '2026-08-18', {},
        )).rejects.toThrow(/already exists/);
        expect(firestore.transactionSet).not.toHaveBeenCalled();
    });

    it('recordResponse derives a deterministic id from (sourceSession, window) so a retry targets the same document', async () => {
        const service = new SessionResponseService();
        const source = { kind: 'execution' as const, id: 'exec-1', date: '2026-08-18' };
        const a = await service.recordResponse('u1', source, 'immediate', '2026-08-18', '2026-08-18', {});
        firestore.transactionGet.mockResolvedValueOnce({ exists: () => true });
        await expect(service.recordResponse('u1', source, 'immediate', '2026-08-18', '2026-08-18', {})).rejects.toThrow();
        expect(a.responseId).toBe(`resp-${source.kind}-${source.id}-immediate`);
    });

    it('updateResponseFacts patches only the non-tissue facts and bumps updatedAt', async () => {
        const service = new SessionResponseService();
        await service.updateResponseFacts('u1', 'resp-1', { sessionRpe: 8, note: undefined }, '2026-08-19T00:00:00.000Z');

        const [, patch] = firestore.updateDoc.mock.calls[0];
        expect(patch).toEqual({ sessionRpe: 8, updatedAt: '2026-08-19T00:00:00.000Z' });
        expect(patch).not.toHaveProperty('note');
    });

    it('getResponsesForSource filters by sourceSession.kind client-side after the single-field query', async () => {
        firestore.getDocs.mockResolvedValue({
            docs: [
                { data: () => responseDoc({ responseId: 'r1', window: 'immediate' }), ref: { path: 'x' } },
                { data: () => responseDoc({ responseId: 'r2', sourceSession: { kind: 'strength', id: 'exec-1', date: '2026-08-18' } }), ref: { path: 'x' } },
                { data: () => responseDoc({ responseId: 'r3', window: 'next_morning', date: '2026-08-19' }), ref: { path: 'x' } },
            ],
        });
        const service = new SessionResponseService();
        const result = await service.getResponsesForSource('u1', { kind: 'execution', id: 'exec-1' });
        expect(result.map(r => r.responseId)).toEqual(['r1', 'r3']);
    });

    it('getResponseForWindow returns null (never fabricated) when that window was never answered', async () => {
        firestore.getDocs.mockResolvedValue({
            docs: [{ data: () => responseDoc({ window: 'immediate' }), ref: { path: 'x' } }],
        });
        const service = new SessionResponseService();
        const result = await service.getResponseForWindow('u1', { kind: 'execution', id: 'exec-1' }, 'next_morning');
        expect(result).toBeNull();
    });

    it('getResponseForWindow returns the matching response when it exists', async () => {
        firestore.getDocs.mockResolvedValue({
            docs: [
                { data: () => responseDoc({ responseId: 'r1', window: 'immediate' }), ref: { path: 'x' } },
                { data: () => responseDoc({ responseId: 'r2', window: 'next_morning', date: '2026-08-19' }), ref: { path: 'x' } },
            ],
        });
        const service = new SessionResponseService();
        const result = await service.getResponseForWindow('u1', { kind: 'execution', id: 'exec-1' }, 'next_morning');
        expect(result?.responseId).toBe('r2');
    });

    it('recordOrUpdateResponse creates the immediate response when no answer exists', async () => {
        firestore.getDocs.mockResolvedValue({ docs: [] });
        const service = new SessionResponseService();

        await service.recordOrUpdateResponse(
            'u1',
            { kind: 'execution', id: 'exec-1', date: '2026-08-18' },
            'immediate',
            '2026-08-18',
            '2026-08-18',
            { sessionRpe: 8, completedFraction: 0.75, unexpectedFatigue: true, note: 'heavy' },
            'occ-1',
            '2026-08-18T11:00:00.000Z',
        );

        expect(firestore.transactionSet).toHaveBeenCalledOnce();
        expect(firestore.transactionUpdate).not.toHaveBeenCalled();
        expect(firestore.updateDoc).not.toHaveBeenCalled();
    });

    it('recordOrUpdateResponse revises an existing canonical-reader response instead of creating a duplicate', async () => {
        firestore.getDocs.mockResolvedValue({
            docs: [{ data: () => responseDoc({ responseId: 'resp-existing' }), ref: { path: 'x' } }],
        });
        const service = new SessionResponseService();

        await service.recordOrUpdateResponse(
            'u1',
            { kind: 'execution', id: 'exec-1', date: '2026-08-18' },
            'immediate',
            '2026-08-18',
            '2026-08-18',
            { completedFraction: 0.5, unexpectedFatigue: false },
            undefined,
            '2026-08-18T11:05:00.000Z',
        );

        expect(firestore.runTransaction).not.toHaveBeenCalled();
        expect(firestore.updateDoc).toHaveBeenCalledWith(
            expect.anything(),
            { completedFraction: 0.5, unexpectedFatigue: false, updatedAt: '2026-08-18T11:05:00.000Z' },
        );
    });

    it('recordOrUpdateResponse transactionally updates a deterministic response created after the query read', async () => {
        firestore.getDocs.mockResolvedValue({ docs: [] });
        firestore.transactionGet.mockResolvedValue({ exists: () => true });
        const service = new SessionResponseService();

        await service.recordOrUpdateResponse(
            'u1',
            { kind: 'execution', id: 'exec-1', date: '2026-08-18' },
            'immediate',
            '2026-08-18',
            '2026-08-18',
            { sessionRpe: 9, note: undefined },
            'occ-1',
            '2026-08-18T11:06:00.000Z',
        );

        expect(firestore.transactionSet).not.toHaveBeenCalled();
        expect(firestore.transactionUpdate).toHaveBeenCalledWith(
            expect.anything(),
            { sessionRpe: 9, updatedAt: '2026-08-18T11:06:00.000Z' },
        );
    });
});
