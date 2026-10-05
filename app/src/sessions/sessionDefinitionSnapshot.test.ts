import { describe, expect, it } from 'vitest';
import type { SessionDefinition, SessionSourceRef } from './models';
import { definitionFromSnapshot, snapshotSessionDefinition } from './sessionDefinitionSnapshot';
import { hashSessionDefinition } from './sessionDefinitionHash';

const original: SessionDefinition = {
    schemaVersion: 1,
    id: 'fixture-1',
    revision: 1,
    title: 'Pinned title',
    summary: 'Pinned summary',
    intent: 'training',
    modalities: ['Strength'],
    dominantModality: 'Strength',
    duration: { min: 40, max: 50 },
    sessionTargets: [{ kind: 'duration', targetMinutes: 45 }],
    prohibitedAdditions: ['No extra conditioning'],
    blocks: [{
        id: 'main',
        role: 'main',
        executionMode: 'sequential',
        steps: [{ id: 'squat', kind: 'exercise', title: 'Squat', dose: { kind: 'repetition', sets: 3, reps: 5 } }],
    }],
};

describe('session definition snapshot', () => {
    it('reconstructs the exact hash-covered executable bytes without live source data', async () => {
        const source: SessionSourceRef = { kind: 'unplanned_fixture', fixtureId: original.id };
        const reconstructed = definitionFromSnapshot(snapshotSessionDefinition(original), source);
        expect(reconstructed).toEqual(original);
        expect(await hashSessionDefinition(reconstructed)).toBe(await hashSessionDefinition(original));
    });

    it('gets identity only from the immutable source ref, not from mutable snapshot fields', () => {
        const manualSource: SessionSourceRef = {
            kind: 'manual', definitionId: 'manual-9', revision: 4, contentHash: 'abc',
        };
        const reconstructed = definitionFromSnapshot(snapshotSessionDefinition(original), manualSource);
        expect(reconstructed.id).toBe('manual-9');
        expect(reconstructed.revision).toBe(4);
        expect(reconstructed.title).toBe('Pinned title');
    });
});
