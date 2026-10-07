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
        const warmup = { ...entry('press', 1), payload: { kind: 'repetition' as const, setIndex: 1, reps: 5, isWarmup: true } };
        expect(projectSessionProgress(rotating, [warmup])).toMatchObject({ blockIndex: 0, stepIndex: 0 });
    });
    it('skips optional-only blocks and respects sequential block rounds', () => {
        const withOptional: SessionDefinition = { ...definition, blocks: [
            { ...definition.blocks[0], id: 'optional', steps: [{ ...definition.blocks[0].steps[0], id: 'optional-step', optional: true }] },
            { ...definition.blocks[0], rounds: 3, steps: [{ ...definition.blocks[0].steps[0], dose: { kind: 'repetition', sets: 1, reps: 5 } }, definition.blocks[0].steps[1]] },
        ] };
        expect(projectSessionProgress(withOptional, [entry('squat', 1)])).toMatchObject({ blockIndex: 1, stepIndex: 0 });
    });

    it('keeps an unpaired hold on the second rotating movement instead of restarting the rotation', () => {
        const holds: SessionDefinition = { ...definition, blocks: [{ ...definition.blocks[0], executionMode: 'alternating', rounds: 2,
            steps: definition.blocks[0].steps.map(step => ({ ...step, laterality: 'per_side', dose: { kind: 'duration', seconds: 30 } })),
        }] };
        const hold = (stepId: string, side: 'left' | 'right'): SessionEntry => ({ ...entry(stepId, 1, `${stepId}-${side}`), side, payload: { kind: 'duration', seconds: 30 } });
        expect(projectSessionProgress(holds, [hold('squat', 'left'), hold('squat', 'right'), hold('row', 'left')])).toMatchObject({ stepIndex: 1 });
    });

    it('keeps known manual optional or later-step work active until its dose is complete', () => {
        const manual: SessionDefinition = { ...definition, blocks: [{ ...definition.blocks[0], steps: [
            definition.blocks[0].steps[0], { ...definition.blocks[0].steps[1], optional: true, dose: { kind: 'repetition', sets: 3, reps: 8 } },
        ] }] };
        const performed = [entry('squat', 1), entry('squat', 2), entry('row', 1)];
        expect(projectSessionProgress(manual, performed, { blockIndex: 0, stepIndex: 1 })).toMatchObject({ stepIndex: 1, requiredWorkComplete: false });
        expect(projectSessionProgress(manual, performed)).toMatchObject({ requiredWorkComplete: true });
    });

    it('continues a manually chosen optional rotating group while required-only resume skips it', () => {
        const optional: SessionDefinition = { ...definition, blocks: [{ ...definition.blocks[0], executionMode: 'alternating', rounds: 3,
            steps: definition.blocks[0].steps.map(step => ({ ...step, optional: true })),
        }] };
        expect(projectSessionProgress(optional, [entry('squat', 1)], { blockIndex: 0, stepIndex: 0 })).toMatchObject({ stepIndex: 1, requiredWorkComplete: false });
        expect(projectSessionProgress(optional, [entry('squat', 1)])).toMatchObject({ requiredWorkComplete: true });
    });

});
