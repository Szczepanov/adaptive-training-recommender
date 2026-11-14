import { describe, expect, it } from 'vitest';
import type { SessionDefinition, SessionEntry } from '../sessions/models';
import { performedSetCounts, plannedSetCount } from './ledgerSetCounts';

let seq = 0;
function entry(stepId: string, payload: SessionEntry['payload'], extra: Partial<SessionEntry> = {}): SessionEntry {
    seq += 1;
    return { id: `e${seq}`, executionId: 'exec-1', stepId, completedAt: 't', createdAt: 't', updatedAt: 't', payload, ...extra };
}
const rep = (stepId: string, isWarmup = false, extra: Partial<SessionEntry> = {}) =>
    entry(stepId, { kind: 'repetition', setIndex: 0, reps: 5, isWarmup }, extra);
const hold = (stepId: string, side: 'left' | 'right') => entry(stepId, { kind: 'duration', seconds: 30 }, { side });

const definition: SessionDefinition = {
    schemaVersion: 2, id: 'def', revision: 1, title: 'Strength', intent: 'training',
    blocks: [
        { id: 'warm', role: 'warmup', executionMode: 'sequential', steps: [
            { id: 'bike', kind: 'exercise', dose: { kind: 'duration', seconds: 300 } },
        ] },
        { id: 'main', role: 'main', executionMode: 'sequential', steps: [
            { id: 'squat', kind: 'exercise', dose: { kind: 'repetition', sets: 3, reps: 5 },
                alternatives: [{ id: 'alt', title: 'Leg press', exerciseRef: { kind: 'catalog', exerciseId: 'press' }, dose: { kind: 'repetition', sets: 4, reps: 8 } }] },
            { id: 'rest', kind: 'rest' },
            { id: 'plank', kind: 'exercise', laterality: 'per_side', dose: { kind: 'duration', seconds: 30, sets: 2 } },
        ] },
        { id: 'circuit', role: 'accessory', executionMode: 'circuit', rounds: 2, steps: [
            { id: 'curl', kind: 'exercise', dose: { kind: 'repetition', sets: 5, reps: 10 } },
        ] },
    ],
} as unknown as SessionDefinition;

describe('plannedSetCount', () => {
    it('sums prescribed exercise steps by their block-aware target, without alternatives or rest steps', () => {
        // bike 1 + squat 3 (alternative's 4 not summed) + plank 2 + curl 2 rounds (overrides 5 sets).
        expect(plannedSetCount(definition)).toBe(8);
    });
});

describe('performedSetCounts', () => {
    it('separates warm-ups and ignores deleted entries and recorded choices', () => {
        const entries = [
            rep('squat', true), rep('squat'), rep('squat'), rep('squat', false, { deletedAt: '2026-11-19T10:00:00Z' }),
            entry('squat', { kind: 'choice', choiceId: 'c', optionId: 'o' } as unknown as SessionEntry['payload']),
        ];
        expect(performedSetCounts([{ entries, definition }])).toEqual({ work: 2, warmup: 1 });
    });

    it('counts a left/right hold as one set only once both sides are logged', () => {
        const entries = [hold('plank', 'left'), hold('plank', 'right'), hold('plank', 'left')];
        expect(performedSetCounts([{ entries, definition }])).toEqual({ work: 1, warmup: 0 });
        // Without a resolvable definition the logged sides still pair.
        expect(performedSetCounts([{ entries, definition: null }])).toEqual({ work: 1, warmup: 0 });
    });

    it('counts work on an added, unplanned step and sums several executions', () => {
        const first = { entries: [rep('added'), rep('added')], definition };
        const second = { entries: [rep('squat')], definition: null };
        expect(performedSetCounts([first, second])).toEqual({ work: 3, warmup: 0 });
    });
});
