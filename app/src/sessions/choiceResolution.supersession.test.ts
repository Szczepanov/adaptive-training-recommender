import { describe, expect, it } from 'vitest';
import type { SessionDefinition, SessionEntry } from './models';
import { resolveEffectiveChoiceEntries, resolveEffectiveSession } from './choiceResolution';

const definition: SessionDefinition = {
    schemaVersion: 1, id: 'def-1', revision: 1, title: 'Choice replay', intent: 'training',
    blocks: [{ id: 'b1', role: 'main', executionMode: 'sequential', optionSets: [{
        id: 'c1', appliesAtStepId: 's1', trigger: { kind: 'athlete_observed', description: 'Choose' }, options: [
            { id: 'normal', label: 'Normal', actions: [] },
            { id: 'lighter', label: 'Lighter', actions: [{ kind: 'reduce_load_percent', targetStepId: 's1', percent: 10 }] },
            { id: 'fewer', label: 'Fewer sets', actions: [{ kind: 'reduce_sets', targetStepId: 's1', sets: 2 }] },
            { id: 'shorter', label: 'Fewer reps', actions: [{ kind: 'reduce_reps', targetStepId: 's1', reps: 3 }] },
        ],
    }], steps: [{ id: 's1', kind: 'exercise', exerciseRef: { kind: 'catalog', exerciseId: 'back_squat' }, dose: { kind: 'repetition', sets: 3, reps: 5 }, load: { kind: 'mass', kg: 100 } }] }],
};

function choice(id: string, optionId: string, at: string, supersedesChoiceEntryId?: string): SessionEntry {
    return { id, executionId: 'exec-1', stepId: 's1', selectedOptionId: optionId, ...(supersedesChoiceEntryId ? { supersedesChoiceEntryId } : {}), completedAt: at, createdAt: at, updatedAt: at, payload: { kind: 'choice', choiceId: 'c1', optionId } };
}

describe('choice supersession replay', () => {
    it('replaces a superseded choice effect instead of stacking corrections', () => {
        const original = choice('a', 'lighter', '2026-10-05T08:00:00.000Z');
        const correction = choice('b', 'normal', '2026-10-05T08:01:00.000Z', 'a');
        expect(resolveEffectiveChoiceEntries([original, correction]).map(e => e.id)).toEqual(['b']);
        expect(resolveEffectiveSession(definition, [original, correction]).definition.blocks[0].steps[0].load).toEqual({ kind: 'mass', kg: 100 });
    });

    it('replays a correction chain identically regardless of input order', () => {
        const a = choice('a', 'lighter', '2026-10-05T08:00:00.000Z');
        const b = choice('b', 'fewer', '2026-10-05T08:01:00.000Z', 'a');
        const c = choice('c', 'shorter', '2026-10-05T08:02:00.000Z', 'b');
        const expected = resolveEffectiveSession(definition, [a, b, c]);
        for (const entries of [[c, a, b], [b, c, a], [c, b, a]]) expect(resolveEffectiveSession(definition, entries)).toEqual(expected);
        expect(expected.definition.blocks[0].steps[0].load).toEqual({ kind: 'mass', kg: 100 });
        expect(expected.definition.blocks[0].steps[0].dose).toEqual({ kind: 'repetition', sets: 3, reps: 3 });
    });

    it('uses id as a stable tie-break for concurrent correction heads', () => {
        const root = choice('a', 'lighter', '2026-10-05T08:00:00.000Z');
        const b = choice('b', 'fewer', '2026-10-05T08:01:00.000Z', 'a');
        const c = choice('c', 'shorter', '2026-10-05T08:01:00.000Z', 'a');
        expect(resolveEffectiveChoiceEntries([c, root, b]).map(e => e.id)).toEqual(['c']);
        expect(resolveEffectiveChoiceEntries([b, c, root]).map(e => e.id)).toEqual(['c']);
    });

    it('keeps legacy choice events without supersession readable', () => {
        const legacy = choice('legacy', 'lighter', '2026-10-05T08:00:00.000Z');
        expect(resolveEffectiveChoiceEntries([legacy])).toEqual([legacy]);
    });
});
