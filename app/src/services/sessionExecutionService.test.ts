import { beforeEach, describe, expect, it, vi } from 'vitest';

const firestore = vi.hoisted(() => ({
    collection: vi.fn(), doc: vi.fn(), getDoc: vi.fn(), getDocs: vi.fn(),
    query: vi.fn(), where: vi.fn(), orderBy: vi.fn(), setDoc: vi.fn(), deleteDoc: vi.fn(),
}));

vi.mock('firebase/firestore', () => firestore);
vi.mock('../firebase', () => ({ getDb: vi.fn(() => ({})) }));

import { SessionExecutionService } from './sessionExecutionService';

const userId = 'u1';
const executionId = 'exec-1';

function execution(overrides: Record<string, unknown> = {}) {
    return {
        userId, executionId, date: '2026-08-19', state: 'completed',
        startedAt: '2026-08-19T08:00:00Z', completedAt: '2026-08-19T09:00:00Z', updatedAt: '2026-08-19T09:00:00Z',
        sessionSource: { kind: 'unplanned_fixture', fixtureId: 'fixture-1' }, schemaVersion: 1,
        ...overrides,
    };
}

function entry(overrides: Record<string, unknown> = {}) {
    return {
        id: 'entry-1', executionId, completedAt: '2026-08-19T08:30:00Z',
        createdAt: '2026-08-19T08:30:00Z', updatedAt: '2026-08-19T08:30:00Z',
        payload: { kind: 'repetition', setIndex: 1, reps: 5, weightKg: 100 },
        ...overrides,
    };
}

describe('SessionExecutionService history reads', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        firestore.collection.mockReturnValue({});
        firestore.query.mockReturnValue({});
        firestore.where.mockReturnValue({});
        firestore.orderBy.mockReturnValue({});
    });

    it('counts invalid headers and invalid or cross-linked child entries', async () => {
        firestore.getDocs
            .mockResolvedValueOnce({ docs: [
                { id: executionId, data: () => execution(), ref: { path: `users/${userId}/session_executions/${executionId}` } },
                { id: 'doc-id-mismatch', data: () => execution(), ref: { path: `users/${userId}/session_executions/doc-id-mismatch` } },
            ] })
            .mockResolvedValueOnce({ docs: [
                { data: () => entry(), ref: { path: `users/${userId}/session_executions/${executionId}/entries/entry-1` } },
                { data: () => entry({ executionId: 'other-execution' }), ref: { path: `users/${userId}/session_executions/${executionId}/entries/cross-linked` } },
                { data: () => entry({ payload: undefined }), ref: { path: `users/${userId}/session_executions/${executionId}/entries/invalid` } },
            ] });

        const result = await new SessionExecutionService().getExecutionsInRange(userId, '2026-08-01', '2026-08-20');

        expect(result.executions).toHaveLength(1);
        expect(result.executions[0].entries).toHaveLength(1);
        expect(result.invalidRecords).toBe(3);
    });
});
