import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hashSessionDefinition } from '../sessions/sessionDefinitionHash';
import type { SessionDefinition } from '../sessions/models';

const firestore = vi.hoisted(() => ({
    getDoc: vi.fn(),
    setDoc: vi.fn(),
    getDocs: vi.fn(),
    batchSet: vi.fn(),
    batchCommit: vi.fn(),
}));

vi.mock('firebase/firestore', () => ({
    doc: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
    collection: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
    getDoc: firestore.getDoc,
    setDoc: firestore.setDoc,
    getDocs: firestore.getDocs,
    writeBatch: () => ({ set: firestore.batchSet, commit: firestore.batchCommit }),
}));

vi.mock('../firebase', () => ({ getDb: () => ({}) }));

import { SessionDefinitionService } from './sessionDefinitionService';

const definition: SessionDefinition = {
    schemaVersion: 1,
    id: 'custom-1',
    revision: 1,
    title: 'Upper-Body Strength Maintenance',
    intent: 'training',
    blocks: [{ id: 'main', role: 'main', executionMode: 'sequential', steps: [] }],
};

function revisionDocument(contentHash: string) {
    return {
        ...definition,
        userId: 'user-1',
        definitionId: definition.id,
        contentHash,
        createdAt: '2026-08-28T10:00:00.000Z',
    };
}

describe('SessionDefinitionService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        firestore.batchCommit.mockResolvedValue(undefined);
    });

    it('reads a persisted custom definition through its metadata envelope and verifies its hash', async () => {
        firestore.getDoc.mockResolvedValue({
            exists: () => true,
            data: () => revisionDocument(awaitedHash),
        });
        const service = new SessionDefinitionService({} as never);

        const result = await service.getDefinitionRevision('user-1', definition.id, 1);

        expect(result).toMatchObject({ status: 'AVAILABLE', data: definition, revision: '1' });
    });

    it('fails closed when persisted content no longer matches its claimed hash', async () => {
        firestore.getDoc.mockResolvedValue({
            exists: () => true,
            data: () => revisionDocument('a'.repeat(64)),
        });
        const service = new SessionDefinitionService({} as never);

        await expect(service.getDefinitionRevision('user-1', definition.id, 1)).resolves.toMatchObject({
            status: 'INVALID', issues: [{ code: 'session-definition-hash-mismatch' }],
        });
    });

    // Issue #1202: movementComposition is part of the schema, so validateSessionDefinition
    // accepts it and saveDefinitionRevision keeps it in the batched revision payload. The rules
    // side (the revision key allow-list) is covered in firestoreRules.emulator.test.ts.
    it('keeps a valid movementComposition contract in the batched revision payload', async () => {
        firestore.getDoc.mockResolvedValue({ exists: () => false });
        const service = new SessionDefinitionService({} as never);
        const movementComposition: SessionDefinition['movementComposition'] = [
            { id: 'push', pattern: 'upper_push', stepIds: ['s1'], status: 'relaxed', reason: 'not evidenced' },
        ];

        await service.saveDefinitionRevision('user-1', { ...definition, movementComposition });

        const [, revisionPayload] = firestore.batchSet.mock.calls[0];
        expect(revisionPayload.movementComposition).toEqual(movementComposition);
    });

    it('writes the immutable revision and mutable header in one batch', async () => {
        firestore.getDoc.mockResolvedValue({ exists: () => false });
        const service = new SessionDefinitionService({} as never);

        const saved = await service.saveDefinitionRevision('user-1', definition);

        expect(saved.header).toMatchObject({ definitionId: definition.id, latestRevision: 1, status: 'active' });
        expect(saved.contentHash).toBe(awaitedHash);
        expect(firestore.batchSet).toHaveBeenCalledTimes(2);
        expect(firestore.batchCommit).toHaveBeenCalledTimes(1);
    });

    // Issue #1202: the rules no longer check schemaVersion, intent or the blocks type on a
    // revision, so saveDefinitionRevision must refuse them before the batch is built.
    it.each([
        ['an unknown intent', { intent: 'strength' }, /^intent: Invalid or missing session intent/m],
        ['schemaVersion 2', { schemaVersion: 2 }, /^schemaVersion: Expected schemaVersion 1/m],
        ['a non-list blocks value', { blocks: {} }, /^blocks: blocks must be an array/m],
    ])('rejects %s without writing', async (_label, override, message) => {
        firestore.getDoc.mockResolvedValue({ exists: () => false });
        const service = new SessionDefinitionService({} as never);
        await expect(service.saveDefinitionRevision('user-1', { ...definition, ...override } as never)).rejects.toThrow(message);
        expect(firestore.batchSet).not.toHaveBeenCalled();
        expect(firestore.batchCommit).not.toHaveBeenCalled();
    });

    it('archives and restores only the header, leaving revisions untouched', async () => {
        const activeHeader = {
            userId: 'user-1', definitionId: definition.id, title: definition.title,
            latestRevision: 1, status: 'active',
            createdAt: '2026-08-28T10:00:00.000Z', updatedAt: '2026-08-28T10:00:00.000Z',
        };
        firestore.getDoc.mockResolvedValueOnce({ exists: () => true, data: () => activeHeader });
        const service = new SessionDefinitionService({} as never);

        const archived = await service.setDefinitionArchived('user-1', definition.id, true);
        expect(archived).toMatchObject({ status: 'archived', archivedAt: expect.any(String) });
        expect(firestore.setDoc).toHaveBeenLastCalledWith(expect.anything(), archived);

        firestore.getDoc.mockResolvedValueOnce({ exists: () => true, data: () => archived });
        const restored = await service.setDefinitionArchived('user-1', definition.id, false);
        expect(restored).toMatchObject({ status: 'active' });
        expect(restored).not.toHaveProperty('archivedAt');
        expect(firestore.setDoc).toHaveBeenLastCalledWith(expect.anything(), restored);
    });
});

const awaitedHash = await hashSessionDefinition(definition);
