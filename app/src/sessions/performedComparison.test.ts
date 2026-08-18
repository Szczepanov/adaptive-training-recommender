import { describe, expect, it } from 'vitest';
import type { SessionDefinition, SessionEntry } from './models';
import { comparePlannedVsPerformed } from './performedComparison';

describe('Performed Session Comparison (M2.6 / ADR-0023)', () => {
    it('compares planned definition against performed entries accurately', () => {
        const definition: SessionDefinition = {
            schemaVersion: 1,
            id: 'test-def',
            revision: 1,
            title: 'Bench & Plank',
            intent: 'training',
            blocks: [
                {
                    id: 'b1',
                    role: 'main',
                    executionMode: 'sequential',
                    steps: [
                        {
                            id: 'step-bench',
                            kind: 'exercise',
                            exerciseRef: { kind: 'catalog', exerciseId: 'bench_press' },
                            dose: { kind: 'repetition', sets: 2, reps: 5 },
                            optional: false,
                        },
                        {
                            id: 'step-plank',
                            kind: 'exercise',
                            exerciseRef: { kind: 'catalog', exerciseId: 'plank' },
                            dose: { kind: 'duration', sets: 1, seconds: 60 },
                            optional: true,
                        },
                    ],
                },
            ],
        };

        const entries: SessionEntry[] = [
            {
                id: 'e1',
                executionId: 'exec-1',
                stepId: 'step-bench',
                completedAt: '2026-08-18T10:05:00Z',
                createdAt: '2026-08-18T10:05:00Z',
                updatedAt: '2026-08-18T10:05:00Z',
                payload: { kind: 'repetition', setIndex: 1, reps: 5, weightKg: 80 },
            },
            {
                id: 'e2',
                executionId: 'exec-1',
                stepId: 'step-bench',
                completedAt: '2026-08-18T10:10:00Z',
                createdAt: '2026-08-18T10:10:00Z',
                updatedAt: '2026-08-18T10:10:00Z',
                payload: { kind: 'repetition', setIndex: 2, reps: 5, weightKg: 80 },
            },
        ];

        const comparison = comparePlannedVsPerformed(definition, entries);

        expect(comparison.totalPlannedSteps).toBe(2);
        expect(comparison.completedStepsCount).toBe(1); // Bench completed (2 sets), Plank omitted (0 sets)
        expect(comparison.missingRequiredStepsCount).toBe(0); // Plank was optional
        expect(comparison.summary.totalReps).toBe(10);
        expect(comparison.summary.totalTonnageKg).toBe(800); // 10 * 80kg
    });
});
