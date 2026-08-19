import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionResponse } from '../responses/models';

const firestore = vi.hoisted(() => ({
    doc: vi.fn(),
    setDoc: vi.fn(),
    updateDoc: vi.fn(),
    getDoc: vi.fn(),
    collection: vi.fn(),
    query: vi.fn(),
    where: vi.fn(),
    getDocs: vi.fn(),
}));

vi.mock('firebase/firestore', () => firestore);
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
        firestore.setDoc.mockResolvedValue(undefined);
        firestore.updateDoc.mockResolvedValue(undefined);
        firestore.collection.mockReturnValue({ path: 'session_responses' });
        firestore.query.mockReturnValue({});
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

        const [, payload] = firestore.setDoc.mock.calls[0];
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

    it('updateResponseFacts patches only the non-tissue facts and bumps updatedAt, via updateDoc not setDoc', async () => {
        const service = new SessionResponseService();
        await service.updateResponseFacts('u1', 'resp-1', { sessionRpe: 8, note: 'heavier than expected' }, '2026-08-19T00:00:00.000Z');

        expect(firestore.setDoc).not.toHaveBeenCalled();
        const [, patch] = firestore.updateDoc.mock.calls[0];
        expect(patch).toEqual({ sessionRpe: 8, note: 'heavier than expected', updatedAt: '2026-08-19T00:00:00.000Z' });
    });

    it('getResponsesForSource filters by sourceSession.kind client-side after the single-field query', async () => {
        firestore.getDocs.mockResolvedValue({
            docs: [
                { data: () => responseDoc({ responseId: 'r1', window: 'immediate' }), ref: { path: 'x' } },
                // Same sourceSession.id, different kind -- must not be returned for an
                // 'execution' query (the id alone isn't a unique cross-collection key).
                { data: () => responseDoc({ responseId: 'r2', sourceSession: { kind: 'strength', id: 'exec-1', date: '2026-08-18' } }), ref: { path: 'x' } },
                { data: () => responseDoc({ responseId: 'r3', window: 'next_morning' }), ref: { path: 'x' } },
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
                { data: () => responseDoc({ responseId: 'r2', window: 'next_morning' }), ref: { path: 'x' } },
            ],
        });
        const service = new SessionResponseService();
        const result = await service.getResponseForWindow('u1', { kind: 'execution', id: 'exec-1' }, 'next_morning');
        expect(result?.responseId).toBe('r2');
    });
});
