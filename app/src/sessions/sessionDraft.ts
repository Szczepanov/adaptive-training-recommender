import type { SessionBlock, SessionChoice, SessionChoiceAction, SessionOption, SessionStep, StepAlternative } from './models';

/**
 * Sets `summary` to the trimmed authored value, or removes the key entirely when the field
 * has been cleared. The definition being built may already carry a `summary` inherited from
 * a spread base definition (when editing a saved revision); deleting the key -- rather than
 * merely skipping an overwrite -- is what stops that stale value from surviving into the
 * saved revision.
 */
export function withResolvedSummary<T extends { summary?: string }>(definition: T, rawSummary: string): T {
    const trimmed = rawSummary.trim();
    if (trimmed) {
        definition.summary = trimmed;
    } else {
        delete definition.summary;
    }
    return definition;
}

/** Moves an item without changing the identity of any item in the collection. */
export function moveDraftItem<T>(items: readonly T[], fromIndex: number, toIndex: number): T[] {
    if (fromIndex < 0 || toIndex < 0 || fromIndex >= items.length || toIndex >= items.length || fromIndex === toIndex) {
        return [...items];
    }
    const next = [...items];
    const [item] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, item);
    return next;
}

function remapAction(action: SessionChoiceAction, stepIds: ReadonlyMap<string, string>, blockId: string): SessionChoiceAction {
    if ('targetStepId' in action) {
        return { ...action, targetStepId: stepIds.get(action.targetStepId) ?? action.targetStepId } as SessionChoiceAction;
    }
    if (action.kind === 'end_block') return { ...action, targetBlockId: blockId };
    return { ...action };
}

function cloneChoice(choice: SessionChoice, stepIds: ReadonlyMap<string, string>, blockId: string): SessionChoice {
    return {
        ...choice,
        id: `${choice.id}-copy`,
        appliesAtStepId: stepIds.get(choice.appliesAtStepId) ?? choice.appliesAtStepId,
        options: choice.options.map(option => ({
            ...option,
            id: `${option.id}-copy`,
            actions: option.actions.map(action => remapAction(action, stepIds, blockId)),
        })),
    };
}

/**
 * Duplicates a block with fresh structural ids and remaps choices that point inside it.
 * The original block and its ids remain untouched, which keeps already entered draft data stable.
 */
export function duplicateDraftBlock(block: SessionBlock, createId: (prefix: 'block' | 'step') => string): SessionBlock {
    const blockId = createId('block');
    const stepIds = new Map(block.steps.map(step => [step.id, createId('step')]));
    return {
        ...block,
        id: blockId,
        title: block.title ? `${block.title} (copy)` : 'Block (copy)',
        steps: block.steps.map(step => ({ ...step, id: stepIds.get(step.id)! })),
        ...(block.optionSets ? { optionSets: block.optionSets.map(choice => cloneChoice(choice, stepIds, blockId)) } : {}),
    };
}

export function duplicateDraftStep(step: SessionStep, createId: (prefix: 'step') => string): SessionStep {
    return { ...step, id: createId('step'), title: step.title ? `${step.title} (copy)` : 'Movement (copy)' };
}

/**
 * M3.8 bounded hardening: default factories for authored option sets, used by the manual
 * builder's choice editor. A new choice always starts with one no-op "continue as prescribed"
 * option so an author can add branches incrementally without an ever-invalid interim state.
 */
export function createDraftChoice(appliesAtStepId: string, createId: (prefix: 'choice' | 'option') => string): SessionChoice {
    return {
        id: createId('choice'),
        appliesAtStepId,
        trigger: { kind: 'athlete_observed', description: '' },
        options: [{ id: createId('option'), label: 'Continue as prescribed', actions: [] }],
    };
}

export function createDraftOption(createId: (prefix: 'option') => string): SessionOption {
    return { id: createId('option'), label: 'New option', actions: [] };
}

export function createDraftAlternative(exerciseId: string | undefined, title: string, createId: (prefix: 'alt') => string): StepAlternative {
    return {
        id: createId('alt'),
        title,
        exerciseRef: exerciseId ? { kind: 'catalog', exerciseId } : { kind: 'unresolved_free_text', name: title },
    };
}

/** A blank default action for a newly added action row, given the block/step it lives on --
 * `end_block`/`select_alternative` need an in-scope target to stay structurally valid the
 * moment they're added, not just once the author fills every field in. */
export function createDraftAction(
    kind: SessionChoiceAction['kind'],
    context: { stepId: string; blockId: string; firstAlternativeId?: string },
): SessionChoiceAction {
    switch (kind) {
        case 'select_alternative': return { kind, targetStepId: context.stepId, alternativeId: context.firstAlternativeId ?? '' };
        case 'reduce_load_percent': return { kind, targetStepId: context.stepId, percent: 10 };
        case 'reduce_sets': return { kind, targetStepId: context.stepId, sets: 1 };
        case 'reduce_reps': return { kind, targetStepId: context.stepId, reps: 1 };
        case 'omit_step': return { kind, targetStepId: context.stepId };
        case 'end_block': return { kind, targetBlockId: context.blockId };
        case 'end_session': return { kind };
    }
}
