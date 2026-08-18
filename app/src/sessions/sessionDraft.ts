import type { SessionBlock, SessionChoice, SessionChoiceAction, SessionStep } from './models';

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
