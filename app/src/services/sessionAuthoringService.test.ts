import { describe, expect, it, vi } from 'vitest';
import type { Recommendation } from '../engine/models';

const services = vi.hoisted(() => ({
    prescription: { savePrescription: vi.fn().mockResolvedValue(undefined) },
    occurrence: { saveOccurrence: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('./executionPrescriptionService', () => ({ executionPrescriptionService: services.prescription }));
vi.mock('./sessionOccurrenceService', () => ({ sessionOccurrenceService: services.occurrence }));

import { resolveWorkoutPrescription } from '../workouts/prescription';
import { prepareAuthoredOccurrenceLaunch, prepareCatalogSessionLaunch } from './sessionAuthoringService';
import type { SessionDefinition } from '../sessions/models';

function makeTestPrescription(templateId: string) {
    const rec = {
        date: '2026-08-18',
        template: {
            id: templateId,
            name: 'Full Body Maintenance',
            modality: 'strength',
            role: 'anchor',
            category: 'full_body_strength',
            durationMin: 45,
            durationMax: 60,
        },
    } as unknown as Recommendation;

    return resolveWorkoutPrescription(rec, 'test-user', '2026-08-18')!;
}

describe('prepareCatalogSessionLaunch (M3.1/M3.4)', () => {
    it('saves a write-once prescription and returns a catalog binding with no occurrence', async () => {
        const presc = makeTestPrescription('str_full_01');
        const launch = await prepareCatalogSessionLaunch('u1', presc);

        expect(launch.binding.sessionSource).toEqual({
            kind: 'catalog', workoutId: presc.workoutId, catalogVersion: String(presc.workoutVersion),
        });
        expect(launch.binding.occurrenceId).toBeUndefined();
        expect(launch.binding.prescriptionHash).toMatch(/^[0-9a-f]{64}$/);
        expect(services.occurrence.saveOccurrence).not.toHaveBeenCalled();
        expect(services.prescription.savePrescription).toHaveBeenCalledTimes(1);
        const [, saved] = services.prescription.savePrescription.mock.calls[0];
        expect(saved.prescriptionHash).toBe(launch.binding.prescriptionHash);
        expect(saved.sessionSource).toEqual(launch.binding.sessionSource);
        expect(saved.blocks).toEqual(launch.definition.blocks);
    });

    it('is idempotent: composing the same prescription twice produces the same hash', async () => {
        const presc = makeTestPrescription('str_upper_01');
        const first = await prepareCatalogSessionLaunch('u1', presc);
        const second = await prepareCatalogSessionLaunch('u1', presc);
        expect(second.binding.prescriptionHash).toBe(first.binding.prescriptionHash);
    });
});

describe('prepareAuthoredOccurrenceLaunch (M3.3)', () => {
    it('stores a distinct content-addressed prescription while retaining the source definition hash', async () => {
        const source = {
            kind: 'manual' as const,
            definitionId: 'manual-1',
            revision: 2,
            contentHash: 'a'.repeat(64),
        };
        const definition: SessionDefinition = {
            schemaVersion: 1,
            id: 'manual-1',
            revision: 2,
            title: 'Scaled strength',
            intent: 'training',
            blocks: [{ id: 'main', role: 'main', executionMode: 'sequential', steps: [
                { id: 'squat', kind: 'exercise', exerciseRef: { kind: 'catalog', exerciseId: 'squat' }, dose: { kind: 'repetition', sets: 3, reps: 5 } },
            ] }],
        };

        const launch = await prepareAuthoredOccurrenceLaunch('u1', source, 'occ-1', definition, '2026-08-19T00:00:00.000Z');

        expect(launch.binding).toMatchObject({ sessionSource: source, occurrenceId: 'occ-1' });
        expect(launch.binding.prescriptionHash).toMatch(/^[0-9a-f]{64}$/);
        expect(launch.binding.prescriptionHash).not.toBe(source.contentHash);
        const lastSave = services.prescription.savePrescription.mock.calls.at(-1);
        expect(lastSave).toBeDefined();
        const saved = lastSave![1];
        expect(saved.sessionSource).toEqual(source);
        expect(saved.definitionHash).toBe(source.contentHash);
        expect(saved.blocks).toEqual(definition.blocks);
    });
});
