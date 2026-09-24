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

    it('does not count warm-up sets toward completedSets/isComplete or tonnage, but keeps them visible (ADR-0021 D-SETLOG)', () => {
        const definition: SessionDefinition = {
            schemaVersion: 1,
            id: 'test-def-warmup',
            revision: 1,
            title: 'Squat',
            intent: 'training',
            blocks: [
                {
                    id: 'b1',
                    role: 'main',
                    executionMode: 'sequential',
                    steps: [
                        {
                            id: 'step-squat',
                            kind: 'exercise',
                            exerciseRef: { kind: 'catalog', exerciseId: 'back_squat' },
                            dose: { kind: 'repetition', sets: 3, reps: 5 },
                        },
                    ],
                },
            ],
        };
        const entry = (id: string, setIndex: number, weightKg: number, isWarmup?: boolean): SessionEntry => ({
            id,
            executionId: 'exec-1',
            stepId: 'step-squat',
            completedAt: `2026-08-18T10:0${setIndex}:00Z`,
            createdAt: `2026-08-18T10:0${setIndex}:00Z`,
            updatedAt: `2026-08-18T10:0${setIndex}:00Z`,
            payload: { kind: 'repetition', setIndex, reps: 5, weightKg, ...(isWarmup === undefined ? {} : { isWarmup }) },
        });
        const warmup = entry('w1', 0, 60, true);
        const work = [entry('e1', 1, 100), entry('e2', 2, 100, false)];

        const partial = comparePlannedVsPerformed(definition, [warmup, ...work]);
        expect(partial.stepComparisons[0]).toMatchObject({ targetSets: 3, completedSets: 2, isComplete: false });
        expect(partial.stepComparisons[0].entries.map(e => e.id)).toEqual(['w1', 'e1', 'e2']);
        expect(partial.completedStepsCount).toBe(0);
        expect(partial.missingRequiredStepsCount).toBe(1);
        expect(partial.summary.totalReps).toBe(15); // warm-up reps are still real reps
        expect(partial.summary.totalTonnageKg).toBe(1000); // 2 work sets x 5 x 100 kg; warm-up excluded

        const complete = comparePlannedVsPerformed(definition, [warmup, ...work, entry('e3', 3, 100)]);
        expect(complete.stepComparisons[0]).toMatchObject({ completedSets: 3, isComplete: true });
        expect(complete.completedStepsCount).toBe(1);
        expect(complete.missingRequiredStepsCount).toBe(0);
    });

    it('excludes a recorded athlete choice (D-MCHOICE) from set/step completion accounting', () => {
        const definition: SessionDefinition = {
            schemaVersion: 1,
            id: 'test-def-choice',
            revision: 1,
            title: 'Squat with choice',
            intent: 'training',
            blocks: [
                {
                    id: 'b1',
                    role: 'main',
                    executionMode: 'sequential',
                    steps: [
                        {
                            id: 'step-squat',
                            kind: 'exercise',
                            exerciseRef: { kind: 'catalog', exerciseId: 'back_squat' },
                            dose: { kind: 'repetition', sets: 2, reps: 5 },
                        },
                    ],
                },
            ],
        };

        const entries: SessionEntry[] = [
            {
                id: 'choice-1',
                executionId: 'exec-1',
                stepId: 'step-squat',
                selectedOptionId: 'opt-continue',
                completedAt: '2026-08-18T10:00:00Z',
                createdAt: '2026-08-18T10:00:00Z',
                updatedAt: '2026-08-18T10:00:00Z',
                payload: { kind: 'choice', choiceId: 'choice-1', optionId: 'opt-continue' },
            },
        ];

        const comparison = comparePlannedVsPerformed(definition, entries);

        expect(comparison.stepComparisons[0].completedSets).toBe(0);
        expect(comparison.stepComparisons[0].entries).toEqual([]);
        expect(comparison.completedStepsCount).toBe(0);
        expect(comparison.missingRequiredStepsCount).toBe(1);
    });
});
