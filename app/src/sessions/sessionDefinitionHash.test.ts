import { describe, expect, it } from 'vitest';
import type { SessionDefinition, ExecutionPrescription } from './models';
import {
    canonicalSessionDefinitionJson,
    hashSessionDefinition,
    hashExecutionPrescription,
} from './sessionDefinitionHash';

describe('Session Definition Canonical Hashing (M3.1 / ADR-0023)', () => {
    it('produces identical hashes regardless of object key order', async () => {
        const def1: SessionDefinition = {
            schemaVersion: 1,
            id: 'def-1',
            revision: 1,
            title: 'Test Session',
            intent: 'training',
            blocks: [
                {
                    id: 'b1',
                    role: 'main',
                    executionMode: 'sequential',
                    steps: [{ id: 's1', kind: 'exercise' }],
                },
            ],
        };

        // Reordered keys
        const def2 = {
            title: 'Test Session',
            blocks: [
                {
                    executionMode: 'sequential',
                    steps: [{ kind: 'exercise', id: 's1' }],
                    id: 'b1',
                    role: 'main',
                },
            ],
            intent: 'training',
            revision: 1,
            id: 'def-1',
            schemaVersion: 1,
        } as unknown as SessionDefinition;

        const hash1 = await hashSessionDefinition(def1);
        const hash2 = await hashSessionDefinition(def2);

        expect(hash1).toBe(hash2);
        expect(canonicalSessionDefinitionJson(def1)).toBe(canonicalSessionDefinitionJson(def2));
    });

    it('produces distinct hashes when material content changes', async () => {
        const baseDef: SessionDefinition = {
            schemaVersion: 1,
            id: 'def-1',
            revision: 1,
            title: 'Test Session',
            intent: 'training',
            blocks: [
                {
                    id: 'b1',
                    role: 'main',
                    executionMode: 'sequential',
                    steps: [{ id: 's1', kind: 'exercise', dose: { kind: 'repetition', sets: 3, reps: 10 } }],
                },
            ],
        };

        const changedDef: SessionDefinition = {
            ...baseDef,
            blocks: [
                {
                    id: 'b1',
                    role: 'main',
                    executionMode: 'sequential',
                    steps: [{ id: 's1', kind: 'exercise', dose: { kind: 'repetition', sets: 4, reps: 10 } }],
                },
            ],
        };

        const hash1 = await hashSessionDefinition(baseDef);
        const hash2 = await hashSessionDefinition(changedDef);

        expect(hash1).not.toBe(hash2);
    });

    it('does not treat source identity, revision, or placement as executable content', async () => {
        const base: SessionDefinition = {
            schemaVersion: 1, id: 'manual-a', revision: 1, title: 'Session', intent: 'training',
            blocks: [{ id: 'main', role: 'main', executionMode: 'sequential', steps: [] }],
        };
        const importedEquivalent: SessionDefinition = {
            ...base,
            id: 'external-plan-session-9',
            revision: 7,
            defaultScheduledDate: '2026-08-20',
        };
        await expect(hashSessionDefinition(base)).resolves.toBe(await hashSessionDefinition(importedEquivalent));
        await expect(hashSessionDefinition({
            ...base,
            userId: 'athlete', definitionId: base.id, contentHash: 'stored-hash', createdAt: '2026-08-18T10:00:00Z',
        } as SessionDefinition)).resolves.toBe(await hashSessionDefinition(base));
    });

    it('hashes execution prescriptions deterministically', async () => {
        const presc: ExecutionPrescription = {
            schemaVersion: 1,
            prescriptionHash: '',
            sessionSource: { kind: 'unplanned_fixture', fixtureId: 'fixture-1' },
            definitionHash: 'def-hash-123',
            blocks: [],
            createdAt: '2026-08-18T10:00:00Z',
        };

        const hash1 = await hashExecutionPrescription(presc);
        const hash2 = await hashExecutionPrescription({ ...presc });

        expect(hash1).toBe(hash2);
        expect(hash1).toMatch(/^[0-9a-f]{64}$/);
    });

    it('is stable after the calculated hash and provenance timestamp are attached', async () => {
        const draft: ExecutionPrescription = {
            schemaVersion: 1, prescriptionHash: '', sessionSource: { kind: 'unplanned_fixture', fixtureId: 'fixture-1' }, definitionHash: 'def-hash-123', blocks: [],
            createdAt: '2026-08-18T10:00:00Z',
        };
        const hash = await hashExecutionPrescription(draft);
        const persisted = { ...draft, prescriptionHash: hash, createdAt: '2026-08-19T12:00:00Z' };
        await expect(hashExecutionPrescription(persisted)).resolves.toBe(hash);
        await expect(hashExecutionPrescription({ ...persisted, userId: 'athlete' } as ExecutionPrescription))
            .resolves.toBe(hash);
    });
});
