import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
    validateQueuedWorkoutContract,
    validateCatalogWorkoutStructure,
    validateCanonicalWorkoutExportContract,
} from './workoutExportContract';
import { WORKOUTS } from '../workouts/catalog';

// Read (not `import ... .json`) so this shared cross-language fixture -- which lives
// outside app/'s tsconfig `include` -- doesn't need `resolveJsonModule` or a rootDir
// carve-out just to be loaded by a test.
const fixturePath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../tests/fixtures/contracts/workout_export.json',
);
const sharedFixture = JSON.parse(readFileSync(fixturePath, 'utf-8')) as {
    queueEntry: Record<string, unknown> & { payload: Record<string, unknown> };
};
const workoutPayload = sharedFixture.queueEntry.payload;

describe('WorkoutExportContract', () => {
    it('validates the real GarminQueuedWorkout document shape end-to-end, including the nested payload (status: pending|synced|failed, no workoutId field)', () => {
        const result = validateQueuedWorkoutContract(sharedFixture.queueEntry);
        expect(result.errors).toEqual([]);
        expect(result.valid).toBe(true);

        // Guard the enum this contract encodes: the wire type only ever holds
        // these three statuses (garminWorkoutQueueService.ts), not 'in_flight'/'completed'.
        const wrongEnum = { ...sharedFixture.queueEntry, status: 'in_flight' };
        expect(validateQueuedWorkoutContract(wrongEnum).valid).toBe(false);
    });

    it('validates the real CanonicalWorkoutExport wire shape crossing into workout_export.py', () => {
        const result = validateCanonicalWorkoutExportContract(workoutPayload);
        expect(result.errors).toEqual([]);
        expect(result.valid).toBe(true);
    });

    it('rejects a step with no durationSeconds/repetitions instead of letting it silently sync as a fabricated 300s block', () => {
        const broken = {
            ...workoutPayload,
            blocks: [
                {
                    id: 'main',
                    name: 'Main',
                    role: 'main',
                    steps: [{ id: 's1', name: 'Undated step', targets: ['300 W'] }],
                },
            ],
        };
        const result = validateCanonicalWorkoutExportContract(broken);
        expect(result.valid).toBe(false);
        expect(result.errors.some((e) => e.includes('durationSeconds or repetitions'))).toBe(true);
    });

    it('rejects the legacy durationSec/target-object shape (the field names workout_export.py does NOT read)', () => {
        const legacyShape = {
            schemaVersion: 'canonical_workout_v1',
            title: 'Legacy Shape',
            workoutId: 'legacy',
            modality: 'cycling',
            blocks: [
                {
                    id: 'b1',
                    role: 'main',
                    steps: [{ id: 's1', name: 'Step', durationSec: 600, target: { type: 'power', watts: 200 } }],
                },
            ],
        };
        const result = validateCanonicalWorkoutExportContract(legacyShape);
        expect(result.valid).toBe(false);
    });

    it('verifies every workout in the static catalog satisfies catalog authoring structure', () => {
        expect(WORKOUTS.length).toBeGreaterThan(0);
        for (const workout of WORKOUTS) {
            const result = validateCatalogWorkoutStructure(workout);
            expect(result.valid, 'Workout ' + workout.id + ' failed catalog structure contract: ' + result.errors.join(', ')).toBe(true);
        }
    });
});
