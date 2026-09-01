import { describe, expect, it } from 'vitest';
import { resolveWorkoutPrescription } from '../workouts/prescription';
import type { Recommendation } from '../engine/models';
import {
    adaptCatalogPrescriptionToSessionDefinition,
    createExecutionPrescriptionFromCatalog,
} from './catalogSessionAdapter';
import { validateSessionDefinition } from './validation';

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

describe('Catalog Session Adapter (M3.1 / ADR-0023)', () => {
    it('adapts a catalog strength workout prescription into a valid SessionDefinition', () => {
        const presc = makeTestPrescription('str_full_01');
        expect(presc).not.toBeNull();

        const sessionDef = adaptCatalogPrescriptionToSessionDefinition(presc);

        expect(sessionDef.id).toBe('strength_full_body_maintenance_01');
        expect(sessionDef.schemaVersion).toBe(1);
        expect(sessionDef.intent).toBe('training');
        expect(sessionDef.dominantModality).toBe('strength');
        expect(sessionDef.blocks.length).toBeGreaterThan(0);
        const firstStep = sessionDef.blocks[0].steps[0];
        expect(firstStep.exerciseRef).toEqual({ kind: 'catalog', exerciseId: presc.adjustedBlocks[0].steps[0].exerciseId });
        expect(firstStep.rest).toBe(presc.adjustedBlocks[0].steps[0].restAfterSec);
        expect(sessionDef.blocks.map(block => block.role)).toEqual(['warmup', 'main', 'main', 'accessory']);
        const ramp = sessionDef.blocks[0].steps.find(step => step.id === 'full_warmup_clean_ramp');
        expect(ramp?.load).toEqual({ kind: 'descriptive', display: 'Empty bar, then light rehearsal load' });

        const validation = validateSessionDefinition(sessionDef);
        expect(validation.ok).toBe(true);
    });

    it('generates an ExecutionPrescription with valid prescriptionHash', async () => {
        const presc = makeTestPrescription('str_upper_01');
        expect(presc).not.toBeNull();

        const execPresc = await createExecutionPrescriptionFromCatalog(presc, 'def-hash-xyz');

        expect(execPresc.schemaVersion).toBe(1);
        expect(execPresc.definitionHash).toBe('def-hash-xyz');
        expect(execPresc.prescriptionHash).toMatch(/^[0-9a-f]{64}$/);
        expect(execPresc.blocks.length).toBeGreaterThan(0);
    });

    it('hashes the explicit catalog ramp load into a new execution prescription', async () => {
        const presc = makeTestPrescription('str_full_01');
        const original = await createExecutionPrescriptionFromCatalog(presc, 'def-hash-xyz');
        const changed = structuredClone(presc);
        const step = changed.adjustedBlocks[0].steps.find(item => item.id === 'full_warmup_clean_ramp');
        if (!step) throw new Error('Missing primary warm-up ramp');
        step.load = { kind: 'descriptive', display: 'Different ramp instruction' };
        const changedExecution = await createExecutionPrescriptionFromCatalog(changed, 'def-hash-xyz');

        expect(changedExecution.prescriptionHash).not.toBe(original.prescriptionHash);
    });
});
