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

    it('pairs a left/right carry on an added step the definition does not know', () => {
        const carry = (side: 'left' | 'right') => entry('added-carry', { kind: 'distance', meters: 20, loadKg: 24 }, { side });
        const entries = [carry('left'), carry('right'), carry('left'), carry('right')];
        expect(performedSetCounts([{ entries, definition }])).toEqual({ work: 2, warmup: 0 });
    });

    it('counts work on an added, unplanned step and sums performed work across executions', () => {
        const first = { entries: [rep('added'), rep('added')], definition };
        const second = { entries: [rep('squat')], definition: null };
        expect(performedSetCounts([first, second])).toEqual({ work: 3, warmup: 0 });
    });

    it('counts against the effective definition: a chosen per-side duration alternative pairs its holds', () => {
        const withChoice = {
            ...definition,
            blocks: [{ id: 'core', role: 'main', executionMode: 'sequential',
                optionSets: [{ id: 'swap', prompt: 'Swap?', options: [
                    { id: 'hold', label: 'Hold instead', actions: [{ kind: 'select_alternative', targetStepId: 'pallof', alternativeId: 'iso' }] },
                ] }],
                steps: [{ id: 'pallof', kind: 'exercise', laterality: 'per_side', dose: { kind: 'repetition', sets: 2, reps: 10 },
                    alternatives: [{ id: 'iso', title: 'Pallof hold', exerciseRef: { kind: 'catalog', exerciseId: 'pallof-hold' }, dose: { kind: 'duration', seconds: 30, sets: 2 } }] }] }],
        } as unknown as SessionDefinition;
        const choice = entry('pallof', { kind: 'choice', choiceId: 'swap', optionId: 'hold' } as unknown as SessionEntry['payload']);
        const holds = [hold('pallof', 'left'), hold('pallof', 'right'), hold('pallof', 'left'), hold('pallof', 'right')];
        expect(performedSetCounts([{ entries: [choice, ...holds], definition: withChoice }])).toEqual({ work: 2, warmup: 0 });
        // Choice-free: the pinned repetition dose counts every logged entry, as before.
        expect(performedSetCounts([{ entries: holds, definition: withChoice }])).toEqual({ work: 4, warmup: 0 });
    });
});

describe('performedSetCounts mixed sided kinds on an unknown step', () => {
    it('pairs holds and carries independently, whatever the entry order', () => {
        const carry = (side: 'left' | 'right') => entry('added-x', { kind: 'distance', meters: 20 }, { side });
        const hold = (side: 'left' | 'right') => entry('added-x', { kind: 'duration', seconds: 30 }, { side });
        const carryFirst = [carry('left'), carry('right'), hold('left'), hold('right'), hold('left'), hold('right')];
        const holdFirst = [hold('left'), hold('right'), hold('left'), hold('right'), carry('left'), carry('right')];
        expect(performedSetCounts([{ entries: carryFirst, definition: null }]).work).toBe(3);
        expect(performedSetCounts([{ entries: holdFirst, definition: null }]).work).toBe(3);
    });
});
