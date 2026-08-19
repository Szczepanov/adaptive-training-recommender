import { describe, expect, it } from 'vitest';
import { diffSessionDefinitions, hasBehaviorChanges } from './sessionDefinitionDiff';
import type { SessionDefinition } from './models';

function definition(): SessionDefinition {
    return {
        schemaVersion: 1,
        id: 'sess-1',
        revision: 1,
        title: 'Lower body',
        intent: 'training',
        blocks: [
            {
                id: 'block-strength',
                role: 'main',
                executionMode: 'alternating',
                steps: [
                    {
                        id: 'step-squat',
                        kind: 'exercise',
                        title: 'Back squat',
                        exerciseRef: { kind: 'catalog', exerciseId: 'back_squat' },
                        dose: { kind: 'repetition', sets: 4, reps: 5 },
                        load: { kind: 'percent_one_rm', percent: 80 },
                        rest: 120,
                        laterality: 'bilateral',
                        optional: false,
                    },
                ],
                optionSets: [
                    {
                        id: 'choice-squat',
                        appliesAtStepId: 'step-squat',
                        trigger: { kind: 'athlete_observed', description: 'Warm-up sets felt heavy' },
                        options: [
                            { id: 'opt-normal', label: 'Continue as prescribed', actions: [] },
                            { id: 'opt-reduce', label: 'Reduce load', actions: [{ kind: 'reduce_load_percent', targetStepId: 'step-squat', percent: 10 }] },
                        ],
                    },
                ],
            },
        ],
    };
}

describe('diffSessionDefinitions', () => {
    it('reports no rows for an identical definition', () => {
        expect(diffSessionDefinitions(definition(), definition())).toEqual([]);
    });

    it('flags laterality change bilateral to per-side as behavior-changing', () => {
        const next = structuredClone(definition());
        next.blocks[0].steps[0].laterality = 'per_side';
        const rows = diffSessionDefinitions(definition(), next);
        const row = rows.find(r => r.id === 'block-strength/step-squat');
        expect(row?.behaviorChanging).toBe(true);
        expect(row?.detail).toContain('laterality bilateral → per_side');
    });

    it('flags laterality change per-side to bilateral as behavior-changing (reverse direction)', () => {
        const before = structuredClone(definition());
        before.blocks[0].steps[0].laterality = 'per_side';
        const after = structuredClone(before);
        after.blocks[0].steps[0].laterality = 'bilateral';
        const rows = diffSessionDefinitions(before, after);
        const row = rows.find(r => r.id === 'block-strength/step-squat');
        expect(row?.behaviorChanging).toBe(true);
        expect(row?.detail).toContain('laterality per_side → bilateral');
    });

    it('flags optional to required as behavior-changing', () => {
        const next = structuredClone(definition());
        next.blocks[0].steps[0].optional = true;
        const rows = diffSessionDefinitions(definition(), next);
        const row = rows.find(r => r.id === 'block-strength/step-squat');
        expect(row?.behaviorChanging).toBe(true);
        expect(row?.detail).toContain('required → optional');
    });

    it('flags a choice action swap (end_block to reduce_load_percent) as behavior-changing', () => {
        const next = structuredClone(definition());
        next.blocks[0].optionSets![0].options[1].actions = [{ kind: 'end_block', targetBlockId: 'block-strength' }];
        const rows = diffSessionDefinitions(definition(), next);
        const row = rows.find(r => r.scope === 'option');
        expect(row?.behaviorChanging).toBe(true);
        expect(row?.detail).toContain('reduce load 10%');
        expect(row?.detail).toContain('end block');
    });

    it('treats title/notes/trigger wording changes as cosmetic only', () => {
        const next = structuredClone(definition());
        next.title = 'Lower body v2';
        next.blocks[0].optionSets![0].trigger.description = 'Warm-ups felt heavy today';
        const rows = diffSessionDefinitions(definition(), next);
        expect(rows.every(row => !row.behaviorChanging)).toBe(true);
        expect(hasBehaviorChanges(rows)).toBe(false);
    });

    it('flags dose and load changes with readable before/after values', () => {
        const next = structuredClone(definition());
        next.blocks[0].steps[0].dose = { kind: 'repetition', sets: 3, reps: 8 };
        next.blocks[0].steps[0].load = { kind: 'percent_one_rm', percent: 70 };
        const rows = diffSessionDefinitions(definition(), next);
        const row = rows.find(r => r.id === 'block-strength/step-squat');
        expect(row?.behaviorChanging).toBe(true);
        expect(row?.detail).toContain('dose 4 × 5 reps → 3 × 8 reps');
        expect(row?.detail).toContain('load 80% 1RM → 70% 1RM');
    });

    it('flags a removed step and a new block as behavior-changing', () => {
        const before = definition();
        const after = structuredClone(before);
        after.blocks[0].steps = [];
        after.blocks.push({ id: 'block-cooldown', role: 'cooldown', executionMode: 'sequential', steps: [] });
        const rows = diffSessionDefinitions(before, after);
        expect(rows.some(r => r.change === 'removed' && r.scope === 'step' && r.behaviorChanging)).toBe(true);
        expect(rows.some(r => r.change === 'added' && r.scope === 'block' && r.behaviorChanging)).toBe(true);
    });

    it('flags an added step and a removed block as behavior-changing (reverse direction)', () => {
        const before = structuredClone(definition());
        before.blocks.push({ id: 'block-cooldown', role: 'cooldown', executionMode: 'sequential', steps: [] });
        const after = structuredClone(before);
        after.blocks[0].steps.push({
            id: 'step-lunge', kind: 'exercise', title: 'Lunge',
            exerciseRef: { kind: 'catalog', exerciseId: 'lunge' },
            dose: { kind: 'repetition', sets: 3, reps: 10 },
        });
        after.blocks = after.blocks.filter(block => block.id !== 'block-cooldown');
        const rows = diffSessionDefinitions(before, after);
        expect(rows.some(r => r.change === 'added' && r.scope === 'step' && r.behaviorChanging)).toBe(true);
        expect(rows.some(r => r.change === 'removed' && r.scope === 'block' && r.behaviorChanging)).toBe(true);
    });

    it('does not report anything when only field order/undefined-vs-absent differ', () => {
        const before = definition();
        const after = structuredClone(before);
        expect(diffSessionDefinitions(before, after)).toEqual([]);
    });

    it('treats structurally identical dose/load objects with reordered keys as unchanged (sameJson canonicalization)', () => {
        const before = definition();
        const after = structuredClone(before);
        // Same fields, different insertion order -- a real risk given the import flow
        // regenerates full plan JSON from an LLM on each revision.
        after.blocks[0].steps[0].load = { percent: 80, kind: 'percent_one_rm' } as typeof after.blocks[0]['steps'][0]['load'];
        expect(diffSessionDefinitions(before, after)).toEqual([]);
    });

    it('includes distance dose set counts, so a sets-only change is not silently identical text', () => {
        const before = structuredClone(definition());
        before.blocks[0].steps[0].dose = { kind: 'distance', sets: 3, meters: 400 };
        const after = structuredClone(before);
        after.blocks[0].steps[0].dose = { kind: 'distance', sets: 4, meters: 400 };
        const rows = diffSessionDefinitions(before, after);
        const row = rows.find(r => r.id === 'block-strength/step-squat');
        expect(row?.behaviorChanging).toBe(true);
        expect(row?.detail).toContain('dose 3 × 400 m → 4 × 400 m');
    });

    it('does not fabricate a distance value when none is set', () => {
        const before = structuredClone(definition());
        before.blocks[0].steps[0].dose = { kind: 'distance', sets: 2 };
        const after = structuredClone(before);
        after.blocks[0].steps[0].dose = { kind: 'distance', sets: 3 };
        const rows = diffSessionDefinitions(before, after);
        const row = rows.find(r => r.id === 'block-strength/step-squat');
        expect(row?.detail).toContain('dose 2 × no distance set → 3 × no distance set');
    });

    it('flags a same-membership step reorder as behavior-changing, distinct from add/remove', () => {
        const before = structuredClone(definition());
        before.blocks[0].steps.push({
            id: 'step-lunge', kind: 'exercise', title: 'Lunge',
            exerciseRef: { kind: 'catalog', exerciseId: 'lunge' },
            dose: { kind: 'repetition', sets: 3, reps: 10 },
        });
        const after = structuredClone(before);
        after.blocks[0].steps.reverse();
        const rows = diffSessionDefinitions(before, after);
        const row = rows.find(r => r.scope === 'block' && r.detail.includes('step order changed'));
        expect(row?.behaviorChanging).toBe(true);
        expect(rows.some(r => r.change === 'added' || r.change === 'removed')).toBe(false);
    });

    it('flags a same-membership block reorder as behavior-changing, distinct from add/remove', () => {
        const before = structuredClone(definition());
        before.blocks.push({ id: 'block-cooldown', role: 'cooldown', executionMode: 'sequential', steps: [] });
        const after = structuredClone(before);
        after.blocks.reverse();
        const rows = diffSessionDefinitions(before, after);
        const row = rows.find(r => r.scope === 'session' && r.detail === 'Block order changed.');
        expect(row?.behaviorChanging).toBe(true);
        expect(rows.some(r => r.change === 'added' || r.change === 'removed')).toBe(false);
    });

    it('does not report a reorder when block/step order is unchanged', () => {
        const before = definition();
        const after = structuredClone(before);
        expect(diffSessionDefinitions(before, after).some(r => r.detail.includes('order changed'))).toBe(false);
    });
});
