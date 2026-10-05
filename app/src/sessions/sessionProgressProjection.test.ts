import { describe, expect, it } from 'vitest';
import type { SessionDefinition, SessionEntry } from './models';
import { projectSessionProgress } from './sessionProgressProjection';

const at = '2026-10-05T10:00:00.000Z';
const definition: SessionDefinition = {
    schemaVersion: 1,
    id: 'resume-fixture',
    revision: 1,
    title: 'Resume fixture',
    intent: 'training',
    blocks: [
        {
            id: 'main',
            role: 'main',
            executionMode: 'sequential',
            steps: [
                { id: 'squat', kind: 'exercise', dose: { kind: 'repetition', sets: 2, reps: 5 } },
                { id: 'row', kind: 'exercise', dose: { kind: 'repetition', sets: 1, reps: 8 } },
            ],
        },
    ],
};

function entry(stepId: string, setIndex: number, id = `${stepId}-${setIndex}`): SessionEntry {
    return {
        id,
        executionId: 'exec-1',
        stepId,
        completedAt: at,
        createdAt: at,
        updatedAt: at,
        payload: { kind: 'repetition', setIndex, reps: 5 },
    };
}

describe('projectSessionProgress', () => {
    it('returns the first incomplete prescribed step from persisted performed evidence', () => {
        expect(projectSessionProgress(definition, [])).toMatchObject({ blockIndex: 0, stepIndex: 0, sessionEnded: false });
        expect(projectSessionProgress(definition, [entry('squat', 1)])).toMatchObject({ stepIndex: 0 });
        expect(projectSessionProgress(definition, [entry('squat', 1), entry('squat', 2)])).toMatchObject({ stepIndex: 1 });
    });

    it('does not count warm-up sets toward resumed work-set progress', () => {
        const warmup: SessionEntry = {
            ...entry('squat', 1, 'warmup'),
            payload: { kind: 'repetition', setIndex: 1, reps: 5, isWarmup: true },
        };
        expect(projectSessionProgress(definition, [warmup])).toMatchObject({ stepIndex: 0 });
    });

    it('uses rotating-group progression rather than sequential set totals', () => {
        const rotating: SessionDefinition = {
            ...definition,
            blocks: [{
                id: 'pair',
                role: 'main',
                executionMode: 'alternating',
                rounds: 1,
                steps: [
                    { id: 'press', kind: 'exercise', dose: { kind: 'repetition', sets: 1, reps: 5 } },
                    { id: 'pull', kind: 'exercise', dose: { kind: 'repetition', sets: 1, reps: 5 } },
                ],
            }],
        };
        expect(projectSessionProgress(rotating, [])).toMatchObject({ blockIndex: 0, stepIndex: 0 });
        expect(projectSessionProgress(rotating, [entry('press', 1)])).toMatchObject({ blockIndex: 0, stepIndex: 1 });
    });
});
