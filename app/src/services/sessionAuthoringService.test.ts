import { describe, expect, it, vi } from 'vitest';
import type { Recommendation } from '../engine/models';

const services = vi.hoisted(() => ({
    prescription: { savePrescription: vi.fn().mockResolvedValue(undefined) },
    occurrence: { saveOccurrence: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('./executionPrescriptionService', () => ({ executionPrescriptionService: services.prescription }));
vi.mock('./sessionOccurrenceService', () => ({ sessionOccurrenceService: services.occurrence }));

import { resolveWorkoutPrescription } from '../workouts/prescription';
import { prepareCatalogSessionLaunch } from './sessionAuthoringService';

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
        expect(saved.blocks).toEqual(launch.definition.blocks);
    });

    it('is idempotent: composing the same prescription twice produces the same hash', async () => {
        const presc = makeTestPrescription('str_upper_01');
        const first = await prepareCatalogSessionLaunch('u1', presc);
        const second = await prepareCatalogSessionLaunch('u1', presc);
        expect(second.binding.prescriptionHash).toBe(first.binding.prescriptionHash);
    });
});
