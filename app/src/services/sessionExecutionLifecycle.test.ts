import { beforeEach, describe, expect, it, vi } from 'vitest';

const firestore = vi.hoisted(() => ({
    doc: vi.fn(),
    getDoc: vi.fn(),
    setDoc: vi.fn(),
    getDocFromCache: vi.fn(),
    onSnapshot: vi.fn(),
    waitForPendingWrites: vi.fn(),
    collection: vi.fn(),
    getDocs: vi.fn(),
    query: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    runTransaction: vi.fn(),
    writeBatch: vi.fn(),
}));

vi.mock('firebase/firestore', () => firestore);
vi.mock('../firebase', () => ({ getDb: vi.fn(() => ({})) }));

import { SessionExecutionService } from './sessionExecutionService';
import type { SessionExecution } from '../sessions/models';

const USER_ID = 'u1';
const EXECUTION_ID = 'exec-1';

function execution(overrides: Partial<SessionExecution> = {}): SessionExecution {
    return {
        userId: USER_ID,
        executionId: EXECUTION_ID,
        sessionSource: { kind: 'unplanned_fixture', fixtureId: 'fixture-1' },
        prescriptionHash: 'rx-1',
        date: '2026-10-05',
        startedAt: '2026-10-05T10:00:00.000Z',
        updatedAt: '2026-10-05T10:00:00.000Z',
        state: 'in_progress',
        schemaVersion: 1,
        ...overrides,
    };
}

function snapshot(data: SessionExecution) {
    return {
        exists: () => true,
        data: () => data,
        ref: { path: `users/${USER_ID}/session_executions/${EXECUTION_ID}` },
    };
}

function batch() {
    return {
        set: vi.fn(),
        commit: vi.fn().mockResolvedValue(undefined),
    };
}

describe('SessionExecutionService terminal lifecycle', () => {
    let service: SessionExecutionService;

    beforeEach(() => {
        vi.clearAllMocks();
        service = new SessionExecutionService();
        firestore.doc.mockImplementation((_db: unknown, ...segments: string[]) => ({
            id: segments[segments.length - 1],
            path: segments.join('/'),
        }));
        firestore.collection.mockReturnValue({ tag: 'collection' });
        firestore.query.mockReturnValue({ tag: 'query' });
        firestore.getDocs.mockResolvedValue({ docs: [] });
        firestore.getDocFromCache.mockRejectedValue(new Error('not cached'));
        firestore.waitForPendingWrites.mockResolvedValue(undefined);
    });

    it('returns explicit already_completed without issuing a second terminal write', async () => {
        const completed = execution({
            state: 'completed',
            completedAt: '2026-10-05T11:00:00.000Z',
            updatedAt: '2026-10-05T11:00:00.000Z',
        });
        firestore.getDoc.mockResolvedValue(snapshot(completed));
        const writer = batch();
        firestore.writeBatch.mockReturnValue(writer);

        await expect(service.transitionExecutionTerminal(USER_ID, EXECUTION_ID, 'completed'))
            .resolves.toEqual({ status: 'already_completed', execution: completed });
        expect(firestore.writeBatch).not.toHaveBeenCalled();
        expect(writer.commit).not.toHaveBeenCalled();
    });

    it('returns explicit already_abandoned when completion loses to an existing abandon winner', async () => {
        const abandoned = execution({ state: 'abandoned', updatedAt: '2026-10-05T11:00:00.000Z' });
        firestore.getDoc.mockResolvedValue(snapshot(abandoned));

        await expect(service.transitionExecutionTerminal(USER_ID, EXECUTION_ID, 'completed'))
            .resolves.toEqual({ status: 'already_abandoned', execution: abandoned });
    });

    it('commits terminal completion and winner-only sibling writes atomically', async () => {
        firestore.getDoc.mockResolvedValue(snapshot(execution()));
        const writer = batch();
        firestore.writeBatch.mockReturnValue(writer);
        const winnerWrites = vi.fn(async (ownedBatch, terminalExecution) => {
            ownedBatch.set({ path: 'preferences/profile' }, { derived: terminalExecution.state });
        });
        const evidence = {
            submittedAt: '2026-10-05T11:00:00.000Z',
            sessionRpe: 8,
            completedFraction: 1,
        };

        const result = await service.transitionExecutionTerminal(
            USER_ID,
            EXECUTION_ID,
            'completed',
            { sessionRpe: 8, notes: 'done', completionEvidence: evidence },
            winnerWrites,
        );

        expect(result.status).toBe('transitioned');
        expect(result.execution).toMatchObject({
            state: 'completed',
            sessionRpe: 8,
            notes: 'done',
            completionEvidence: evidence,
        });
        expect(winnerWrites).toHaveBeenCalledOnce();
        expect(writer.set).toHaveBeenCalledTimes(2);
        expect(writer.commit).toHaveBeenCalledOnce();
    });

    it('classifies a rejected racing write as idempotent only after a fresh persisted read proves the winner', async () => {
        const completed = execution({
            state: 'completed',
            completedAt: '2026-10-05T11:00:00.000Z',
            updatedAt: '2026-10-05T11:00:00.000Z',
        });
        firestore.getDoc
            .mockResolvedValueOnce(snapshot(execution()))
            .mockResolvedValueOnce(snapshot(completed));
        const writer = batch();
        writer.commit.mockRejectedValueOnce(Object.assign(new Error('rule rejected loser'), { code: 'permission-denied' }));
        firestore.writeBatch.mockReturnValue(writer);

        await expect(service.transitionExecutionTerminal(USER_ID, EXECUTION_ID, 'abandoned'))
            .resolves.toEqual({ status: 'already_completed', execution: completed });
    });

    it('preserves the original write error when a fresh read does not prove a terminal winner', async () => {
        firestore.getDoc.mockResolvedValue(snapshot(execution()));
        const writer = batch();
        const failure = Object.assign(new Error('network failure'), { code: 'unavailable' });
        writer.commit.mockRejectedValueOnce(failure);
        firestore.writeBatch.mockReturnValue(writer);

        await expect(service.transitionExecutionTerminal(USER_ID, EXECUTION_ID, 'completed')).rejects.toBe(failure);
    });
});
