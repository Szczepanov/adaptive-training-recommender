import { describe, expect, it } from 'vitest';
import type { SessionDefinition, SessionEntry, SessionRestEvent } from '../sessions/models';
import { buildStructuredStepDetails } from './structuredSetDetail';

const definition: SessionDefinition = {
    schemaVersion: 1,
    id: 'w-1',
    revision: 1,
    title: 'Heavy Squat Day',
    intent: 'training',
    blocks: [{
        id: 'b1',
        role: 'main',
        steps: [
            {
                id: 'squat',
                kind: 'exercise',
                title: 'Back Squat',
                dose: { kind: 'repetition', sets: 3, reps: 5 },
                load: { kind: 'mass', kg: 100 },
                effort: { rir: 2 },
                rest: 180,
            },
            { id: 'walk', kind: 'transition' },
            { id: 'plank', kind: 'exercise', title: 'Plank', dose: { kind: 'duration', sets: 2, seconds: 45 }, optional: true },
        ],
    }],
} as SessionDefinition;

function repEntry(id: string, completedAt: string, reps: number, weightKg: number, isWarmup = false): SessionEntry {
    return {
        id,
        executionId: 'exec-1',
        stepId: 'squat',
        completedAt,
        createdAt: completedAt,
        updatedAt: completedAt,
        payload: { kind: 'repetition', setIndex: 0, reps, weightKg, ...(isWarmup ? { isWarmup: true } : {}) },
    };
}

function restEvent(afterEntryId: string, actualSeconds: number, prescribedSeconds?: number): SessionRestEvent {
    return {
        id: `rest-${afterEntryId}`,
        executionId: 'exec-1',
        afterEntryId,
        startedAt: '2026-08-26T07:00:00.000Z',
        endedAt: '2026-08-26T07:03:00.000Z',
        actualSeconds,
        endReason: 'next_set_started',
        ...(prescribedSeconds !== undefined ? { prescribedSeconds } : {}),
        createdAt: '2026-08-26T07:03:00.000Z',
        updatedAt: '2026-08-26T07:03:00.000Z',
    };
}

describe('buildStructuredStepDetails', () => {
    it('keeps the prescription, numbers warm-up and work sets separately, and attaches performed rest', () => {
        const entries = [
            repEntry('e-work-2', '2026-08-26T07:10:00.000Z', 5, 100),
            repEntry('e-warm-1', '2026-08-26T07:00:00.000Z', 5, 60, true),
            repEntry('e-work-1', '2026-08-26T07:05:00.000Z', 4, 100),
        ];
        const [squat] = buildStructuredStepDetails(definition, entries, [restEvent('e-work-1', 205, 180)]);

        expect(squat.title).toBe('Back Squat');
        expect(squat.prescribed).toEqual({
            sets: 3,
            reps: 5,
            load: { kind: 'mass', kg: 100 },
            effort: { rir: 2 },
            restSeconds: 180,
        });
        expect(squat.sets.map(set => [set.entryId, set.isWarmup, set.setNumber])).toEqual([
            ['e-warm-1', true, 1],
            ['e-work-1', false, 1],
            ['e-work-2', false, 2],
        ]);
        expect(squat.sets[1].rest).toEqual({ prescribedSeconds: 180, actualSeconds: 205, endReason: 'next_set_started' });
        expect(squat.sets[0].rest).toBeUndefined();
    });

    it('omits unlogged non-exercise steps but keeps unlogged exercise steps as missed prescriptions', () => {
        const details = buildStructuredStepDetails(definition, [], []);

        expect(details.map(step => step.stepId)).toEqual(['squat', 'plank']);
        expect(details[1]).toMatchObject({ isOptional: true, prescribed: { sets: 2, seconds: 45 }, sets: [] });
    });

    it('never counts a recorded athlete choice as a performed set', () => {
        const choice: SessionEntry = {
            id: 'choice-1',
            executionId: 'exec-1',
            stepId: 'squat',
            completedAt: '2026-08-26T07:00:00.000Z',
            createdAt: '2026-08-26T07:00:00.000Z',
            updatedAt: '2026-08-26T07:00:00.000Z',
            payload: { kind: 'choice', choiceId: 'c', optionId: 'o' },
        };
        const [squat] = buildStructuredStepDetails(definition, [choice], []);
        expect(squat.sets).toEqual([]);
    });
});
