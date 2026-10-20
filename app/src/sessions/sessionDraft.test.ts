import { describe, expect, it } from 'vitest';
import { componentPatternsForStep, relaxUnevidencedRequirements } from './compositionStamping';
import type { SessionBlock, SessionDefinition, SessionStep, StepAlternative } from './models';
import { validateSessionDefinition } from './validation';
import {
    createDraftAction,
    createDraftAlternative,
    withAlternativeExercise,
    withStepMovement,
    createDraftChoice,
    createDraftOption,
    duplicateDraftBlock,
    duplicateDraftStep,
    moveDraftItem,
    withResolvedSummary,
} from './sessionDraft';

describe('withResolvedSummary', () => {
    it('removes an inherited summary when the authored field is cleared', () => {
        // Mirrors a `...baseDefinition` spread ahead of this call in ManualSessionBuilder:
        // a revision being edited can already carry a summary from the saved definition.
        const definition = { title: 'Custom workout', summary: 'Old summary from a saved revision' };

        const result = withResolvedSummary(definition, '   ');

        expect('summary' in result).toBe(false);
    });

    it('sets the trimmed authored summary when provided', () => {
        const definition: { title: string; summary?: string } = { title: 'Custom workout' };

        const result = withResolvedSummary(definition, '  Heavy squat day  ');

        expect(result.summary).toBe('Heavy squat day');
    });
});

describe('manual session draft operations', () => {
    it('reorders blocks and steps without changing their identities', () => {
        const first = { id: 'first' };
        const second = { id: 'second' };
        expect(moveDraftItem([first, second], 0, 1)).toEqual([second, first]);
        expect(moveDraftItem([first, second], 0, 1)[1]).toBe(first);
        expect(moveDraftItem([first, second], -1, 1)).toEqual([first, second]);
    });

    it('duplicates a block with fresh ids and remapped in-block choices', () => {
        const block: SessionBlock = {
            id: 'main', role: 'main', executionMode: 'sequential', title: 'Main',
            steps: [{ id: 'squat', kind: 'exercise' }, { id: 'row', kind: 'exercise' }],
            optionSets: [{
                id: 'choice', appliesAtStepId: 'squat', trigger: { kind: 'athlete_observed', description: 'How does it feel?' },
                options: [{ id: 'reduce', label: 'Reduce', actions: [{ kind: 'reduce_sets', targetStepId: 'squat', sets: 2 }] }],
            }],
        };
        let sequence = 0;
        const copy = duplicateDraftBlock(block, prefix => `${prefix}-${++sequence}`);

        expect(copy.id).toBe('block-1');
        expect(copy.steps.map(step => step.id)).toEqual(['step-2', 'step-3']);
        expect(copy.optionSets?.[0].appliesAtStepId).toBe('step-2');
        expect(copy.optionSets?.[0].options[0].actions[0]).toEqual({ kind: 'reduce_sets', targetStepId: 'step-2', sets: 2 });
        expect(block.steps.map(step => step.id)).toEqual(['squat', 'row']);
    });

    it('duplicates a movement with a new id while retaining its prescription', () => {
        const copy = duplicateDraftStep({ id: 'press', kind: 'exercise', title: 'Press', dose: { kind: 'repetition', sets: 3, reps: 8 } }, () => 'step-copy');
        expect(copy).toMatchObject({ id: 'step-copy', title: 'Press (copy)', dose: { kind: 'repetition', sets: 3, reps: 8 } });
    });

    it('creates a new authored choice with one no-op continue option (M3.8)', () => {
        let sequence = 0;
        const choice = createDraftChoice('squat', prefix => `${prefix}-${++sequence}`);
        expect(choice).toEqual({
            id: 'choice-1',
            appliesAtStepId: 'squat',
            trigger: { kind: 'athlete_observed', description: '' },
            options: [{ id: 'option-2', label: 'Continue as prescribed', actions: [] }],
        });
    });

    it('creates a new blank option', () => {
        const option = createDraftOption(() => 'option-x');
        expect(option).toEqual({ id: 'option-x', label: 'New option', actions: [] });
    });

    it('creates a catalog alternative when an exercise id is given, free text otherwise', () => {
        expect(createDraftAlternative('goblet_squat', 'Goblet Squat', () => 'alt-1')).toEqual({
            id: 'alt-1', title: 'Goblet Squat', exerciseRef: { kind: 'catalog', exerciseId: 'goblet_squat' },
            compositionPatterns: ['knee_dominant_bilateral'],
        });
        expect(createDraftAlternative(undefined, 'Custom sub', () => 'alt-2')).toStrictEqual({
            id: 'alt-2', title: 'Custom sub', exerciseRef: { kind: 'unresolved_free_text', name: 'Custom sub' },
        });
    });

    it('keeps catalog composition tags on a draft alternative so a choice switch can stamp them (#813)', () => {
        expect(createDraftAlternative('split_squat', 'Split Squat', () => 'alt-3').compositionPatterns).toEqual(['unilateral_lower_body']);
        expect(createDraftAlternative(undefined, 'Split Squat', () => 'alt-4')).not.toHaveProperty('compositionPatterns');
    });

    it('creates a structurally valid default action for every action kind, scoped to the authoring step/block', () => {
        const context = { stepId: 'squat', blockId: 'block-main', firstAlternativeId: 'alt-goblet' };
        expect(createDraftAction('select_alternative', context)).toEqual({ kind: 'select_alternative', targetStepId: 'squat', alternativeId: 'alt-goblet' });
        expect(createDraftAction('reduce_load_percent', context)).toEqual({ kind: 'reduce_load_percent', targetStepId: 'squat', percent: 10 });
        expect(createDraftAction('reduce_sets', context)).toEqual({ kind: 'reduce_sets', targetStepId: 'squat', sets: 1 });
        expect(createDraftAction('reduce_reps', context)).toEqual({ kind: 'reduce_reps', targetStepId: 'squat', reps: 1 });
        expect(createDraftAction('omit_step', context)).toEqual({ kind: 'omit_step', targetStepId: 'squat' });
        expect(createDraftAction('end_block', context)).toEqual({ kind: 'end_block', targetBlockId: 'block-main' });
        expect(createDraftAction('end_session', context)).toEqual({ kind: 'end_session' });
    });

    it('defaults select_alternative to an empty alternativeId when the step has no alternatives yet', () => {
        expect(createDraftAction('select_alternative', { stepId: 'squat', blockId: 'block-main' }))
            .toEqual({ kind: 'select_alternative', targetStepId: 'squat', alternativeId: '' });
    });
});

describe('manual movement edits keep catalog composition (#813)', () => {
    const step: SessionStep = { id: 'uni', kind: 'exercise', title: 'New exercise', exerciseRef: { kind: 'unresolved_free_text', name: 'New exercise' }, dose: { kind: 'repetition', sets: 3, reps: 8 } };

    it('stamps the catalog tags when the movement of a step is picked, and clears them for custom', () => {
        const picked = withStepMovement(step, 'split_squat');
        expect(picked).toMatchObject({ exerciseRef: { kind: 'catalog', exerciseId: 'split_squat' }, compositionPatterns: ['unilateral_lower_body'] });
        expect(picked.resolutionNote).toBeUndefined();
        const custom = withStepMovement({ ...picked, degradedComposition: { pattern: 'unilateral_lower_body', reason: 'old' } }, '__custom__');
        expect(custom).toMatchObject({ title: picked.title, exerciseRef: { kind: 'unresolved_free_text', name: picked.title } });
        expect(custom.compositionPatterns).toBeUndefined();
        expect(custom.degradedComposition).toBeUndefined();
        expect(custom.resolutionNote).toContain('Custom movement');
    });

    it('keeps a JSON-imported alternative stamp on rename and replaces it on a new movement', () => {
        const imported: StepAlternative = { id: 'alt', title: 'Bulgarian split squat', exerciseRef: { kind: 'unresolved_free_text', name: 'Bulgarian split squat' }, compositionPatterns: ['unilateral_lower_body'] };
        expect(withAlternativeExercise(imported, undefined, 'BSS').compositionPatterns).toEqual(['unilateral_lower_body']);
        const repicked = withAlternativeExercise(imported, 'goblet_squat', 'Goblet Squat');
        expect(repicked.compositionPatterns).toEqual(['knee_dominant_bilateral']);
        expect(withAlternativeExercise(repicked, 'goblet_squat', 'Goblet squat (heels up)').compositionPatterns).toEqual(['knee_dominant_bilateral']);
    });

    it('keeps an edited template with a required component valid', () => {
        const required: SessionStep = { ...withStepMovement(step, 'split_squat'), alternatives: [createDraftAlternative('goblet_squat', 'Goblet Squat', () => 'alt-g', ['unilateral_lower_body'])] };
        const template = {
            schemaVersion: 1, id: 'tpl', revision: 2, title: 'Template', intent: 'training', dominantModality: 'strength', duration: { min: 30, max: 30 },
            blocks: [{ id: 'b1', title: 'Main', role: 'main', executionMode: 'sequential', steps: [required] }],
            movementComposition: [{ id: 'req', pattern: 'unilateral_lower_body', status: 'required', stepIds: ['uni'] }],
        } as SessionDefinition;
        const components = componentPatternsForStep(template.movementComposition, 'uni');
        const asEdited = (steps: SessionStep[]): SessionDefinition => {
            const blocks = [{ ...template.blocks[0], steps }];
            return { ...template, blocks, movementComposition: relaxUnevidencedRequirements(template.movementComposition!, blocks) };
        };
        const issues = (definition: SessionDefinition) => {
            const result = validateSessionDefinition(definition);
            return result.ok ? [] : result.issues;
        };
        expect(issues(asEdited([required]))).toEqual([]);

        // Re-picking another non-preserving alternative keeps an explicit degradation.
        const repickedAlt = withAlternativeExercise(required.alternatives![0], 'front_squat', 'Front Squat', components);
        expect(repickedAlt.degradedComposition?.pattern).toBe('unilateral_lower_body');
        expect(issues(asEdited([{ ...required, alternatives: [repickedAlt] }]))).toEqual([]);

        // A free-text alternative added to the step also declares the degradation.
        const added = createDraftAlternative(undefined, 'Alternative movement', () => 'alt-new', components);
        expect(issues(asEdited([{ ...required, alternatives: [...required.alternatives!, added] }]))).toEqual([]);

        // Changing the movement of the required step relaxes the requirement instead of blocking review.
        const changed = asEdited([withStepMovement(required, 'goblet_squat')]);
        expect(changed.movementComposition?.[0].status).toBe('relaxed');
        expect(issues(changed)).toEqual([]);
    });
});
