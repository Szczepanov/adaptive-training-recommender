import { describe, expect, it } from 'vitest';
import type { SessionBlock, SessionEntry } from './models';
import { getGroupProgress, isRotatingExecutionMode, targetEntriesForGroupStep } from './groupProgression';

const block = (executionMode: SessionBlock['executionMode'], rounds?: number): SessionBlock => ({
    id: 'main',
    role: 'main',
    executionMode,
    ...(rounds === undefined ? {} : { rounds }),
    steps: [
        { id: 'press', kind: 'exercise', dose: { kind: 'repetition', sets: 3, reps: 5 } },
        { id: 'row', kind: 'exercise', dose: { kind: 'repetition', sets: 3, reps: 8 } },
    ],
});

const entry = (stepId: string, id = stepId): SessionEntry => ({
    id,
    executionId: 'exec',
    stepId,
    completedAt: '2026-08-18T10:00:00.000Z',
    createdAt: '2026-08-18T10:00:00.000Z',
    updatedAt: '2026-08-18T10:00:00.000Z',
    payload: { kind: 'repetition', setIndex: 1, reps: 5 },
});

describe('group progression', () => {
    it('only enables rotation for circuit, superset, and alternating blocks', () => {
        expect(isRotatingExecutionMode('sequential')).toBe(false);
        expect(isRotatingExecutionMode('density')).toBe(false);
        expect(isRotatingExecutionMode('circuit')).toBe(true);
        expect(isRotatingExecutionMode('superset')).toBe(true);
        expect(isRotatingExecutionMode('alternating')).toBe(true);
    });

    it('rotates an alternating pair after each logged set', () => {
        const group = block('alternating');
        expect(getGroupProgress(group, [], 0)).toMatchObject({ completedRounds: 0, totalRounds: 3, nextStepIndex: 1 });
        expect(getGroupProgress(group, [entry('press')], 0)).toMatchObject({ completedRounds: 0, nextStepIndex: 1 });
        expect(getGroupProgress(group, [entry('press'), entry('row')], 1)).toMatchObject({ completedRounds: 1, nextStepIndex: 0 });
    });

    it.each(['circuit', 'superset'] as const)('uses the same balanced rotation for a %s', executionMode => {
        const group = block(executionMode);
        const state = getGroupProgress(group, [entry('press'), entry('row')], 1);
        expect(state).toMatchObject({ mode: executionMode, completedRounds: 1, totalRounds: 3, nextStepIndex: 0 });
    });

    it('uses explicit block rounds and does not make an optional movement block completion', () => {
        const group: SessionBlock = {
            ...block('circuit', 2),
            steps: [
                ...block('circuit', 2).steps,
                { id: 'optional', kind: 'exercise', optional: true, dose: { kind: 'repetition', sets: 5, reps: 10 } },
            ],
        };
        const completed = [entry('press', 'p1'), entry('press', 'p2'), entry('row', 'r1'), entry('row', 'r2')];

        expect(targetEntriesForGroupStep(group, group.steps[0])).toBe(2);
        expect(getGroupProgress(group, completed, 1)).toMatchObject({ completedRounds: 2, totalRounds: 2, isComplete: true, nextStepIndex: null });
    });
});
