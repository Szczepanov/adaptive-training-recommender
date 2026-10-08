import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExecutionPrescription, SessionDefinition, SessionSourceRef } from './models';
import type { DataState } from '../engine/dataState';

const mocks = vi.hoisted(() => ({ getPrescription: vi.fn() }));
vi.mock('../services/executionPrescriptionService', () => ({
    executionPrescriptionService: { getPrescription: mocks.getPrescription },
}));

import { resolveSessionDefinition } from './sessionDefinitionResolver';
import { snapshotSessionDefinition } from './sessionDefinitionSnapshot';
import { hashSessionDefinition } from './sessionDefinitionHash';

const source: SessionSourceRef = { kind: 'unplanned_fixture', fixtureId: 'fixture-deleted-after-launch' };
const historical: SessionDefinition = {
    schemaVersion: 1,
    id: source.fixtureId,
    revision: 1,
    title: 'Historical pinned workout',
    intent: 'training',
    blocks: [{
        id: 'main',
        role: 'main',
        executionMode: 'sequential',
        steps: [{ id: 'step-1', kind: 'exercise', title: 'Historical movement', exerciseRef: { kind: 'unresolved_free_text', name: 'Historical movement' }, dose: { kind: 'repetition', sets: 2, reps: 5 } }],
    }],
};

function available(data: ExecutionPrescription): DataState<ExecutionPrescription> {
    return { status: 'AVAILABLE', data, revision: data.prescriptionHash };
}

describe('resolveSessionDefinition snapshot-first replay', () => {
    beforeEach(() => vi.clearAllMocks());

    it('replays self-contained pinned fixture bytes even after the live fixture is gone', async () => {
        const definitionHash = await hashSessionDefinition(historical);
        mocks.getPrescription.mockResolvedValue(available({
            schemaVersion: 1,
            prescriptionHash: 'rx-historical',
            sessionSource: source,
            definitionHash,
            blocks: historical.blocks,
            definitionSnapshot: snapshotSessionDefinition(historical),
            createdAt: '2026-10-05T10:00:00.000Z',
        }));

        const result = await resolveSessionDefinition('u1', source, 'rx-historical');
        expect(result).toEqual({ status: 'AVAILABLE', data: historical, revision: 'rx-historical' });
    });

    it('degrades a legacy fixture prescription instead of mixing it with current fixture bytes', async () => {
        mocks.getPrescription.mockResolvedValue(available({
            schemaVersion: 1,
            prescriptionHash: 'rx-legacy',
            sessionSource: source,
            definitionHash: await hashSessionDefinition(historical),
            blocks: historical.blocks,
            createdAt: '2026-09-01T10:00:00.000Z',
        }));

        const result = await resolveSessionDefinition('u1', source, 'rx-legacy');
        expect(result.status).toBe('INVALID');
        if (result.status === 'INVALID') {
            expect(result.issues[0]?.code).toBe('fixture-prescription-not-self-contained');
        }
    });

    it('fails closed when the snapshot does not match the pinned definition hash', async () => {
        mocks.getPrescription.mockResolvedValue(available({
            schemaVersion: 1,
            prescriptionHash: 'rx-tampered',
            sessionSource: source,
            definitionHash: 'not-the-snapshot-hash',
            blocks: historical.blocks,
            definitionSnapshot: snapshotSessionDefinition(historical),
            createdAt: '2026-10-05T10:00:00.000Z',
        }));

        const result = await resolveSessionDefinition('u1', source, 'rx-tampered');
        expect(result.status).toBe('INVALID');
        if (result.status === 'INVALID') {
            expect(result.issues[0]?.code).toBe('prescription-definition-hash-mismatch');
        }
    });
});
