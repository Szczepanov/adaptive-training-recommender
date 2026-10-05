/**
 * Derives the athlete-facing effective view of a `SessionDefinition` from recorded
 * `choice` entries (D-MCHOICE). Nothing here evaluates a condition automatically (C4) --
 * every action folded in below traces back to a specific `SessionEntry` the athlete
 * created by tapping an authored option.
 *
 * ADR-0010 replay requires the persisted definition/prescription bytes to stay exact, so
 * this is pure derivation, never mutation of stored state -- the same discipline
 * `groupProgression.ts` already applies to rotation state. The returned `definition` keeps
 * the exact block/step array shape and order of the input: only fields are overwritten in
 * place, because `useSessionRunner`'s `activeBlockIndex`/`activeStepIndex` are raw array
 * indices that must stay valid across a reload.
 */
import type {
    SessionBlock,
    SessionChoiceAction,
    SessionDefinition,
    SessionEntry,
    SessionStep,
    RangeOrNumber,
} from './models';


export type ChoiceSessionEntry = SessionEntry & {
    payload: { kind: 'choice'; choiceId: string; optionId: string; reason?: string };
};

function compareChoiceEntries(a: ChoiceSessionEntry, b: ChoiceSessionEntry): number {
    return a.completedAt.localeCompare(b.completedAt)
        || a.createdAt.localeCompare(b.createdAt)
        || a.id.localeCompare(b.id);
}

/**
 * Resolve one effective append-only event per authored choice.
 *
 * A later event has correction authority only when it is reachable from the canonical
 * root through explicit `supersedesChoiceEntryId` edges. A second unlinked event with the
 * same `choiceId` is therefore retained as history but cannot silently replace the choice
 * that governed execution. This deliberately rejects the old "later timestamp wins"
 * behavior.
 *
 * A malformed/concurrent fork cannot be represented as INVALID by this pure view helper,
 * so replay picks the stable earliest terminal head by completedAt/createdAt/id. All
 * clients observing the same event set therefore resolve the same branch independent of
 * Firestore return order, while no arrival order gains authority.
 */
export function resolveEffectiveChoiceEntries(entries: readonly SessionEntry[]): ChoiceSessionEntry[] {
    const choiceEntries = entries
        .filter((entry): entry is ChoiceSessionEntry => entry.payload.kind === 'choice')
        .slice()
        .sort(compareChoiceEntries);
    const byChoiceId = new Map<string, ChoiceSessionEntry[]>();
    for (const entry of choiceEntries) {
        const group = byChoiceId.get(entry.payload.choiceId) ?? [];
        group.push(entry);
        byChoiceId.set(entry.payload.choiceId, group);
    }

    const effective: ChoiceSessionEntry[] = [];
    for (const group of byChoiceId.values()) {
        const byId = new Map(group.map(entry => [entry.id, entry]));
        const children = new Map<string, ChoiceSessionEntry[]>();

        for (const entry of group) {
            const parentId = entry.supersedesChoiceEntryId;
            if (!parentId) continue;
            const parent = byId.get(parentId);
            // Service + rules reject these shapes for new writes. Historical malformed
            // edges remain readable but cannot grant correction authority.
            if (!parent || parent.id === entry.id || parent.payload.choiceId !== entry.payload.choiceId) continue;
            const siblings = children.get(parentId) ?? [];
            siblings.push(entry);
            children.set(parentId, siblings);
        }

        const roots = group
            .filter(entry => {
                const parentId = entry.supersedesChoiceEntryId;
                if (!parentId) return true;
                const parent = byId.get(parentId);
                return !parent || parent.id === entry.id || parent.payload.choiceId !== entry.payload.choiceId;
            })
            .slice()
            .sort(compareChoiceEntries);

        // Multiple unlinked roots are not a correction relationship. Anchor replay on the
        // stable earliest root instead of silently treating a later write as authoritative.
        // A cycle has no root; anchor it the same deterministic way and do not invent one.
        const root = roots[0] ?? group[0];
        const reachable = new Map<string, ChoiceSessionEntry>([[root.id, root]]);
        const queue: ChoiceSessionEntry[] = [root];
        while (queue.length > 0) {
            const current = queue.shift()!;
            const next = (children.get(current.id) ?? []).slice().sort(compareChoiceEntries);
            for (const child of next) {
                if (reachable.has(child.id)) continue;
                reachable.set(child.id, child);
                queue.push(child);
            }
        }

        const terminals = [...reachable.values()]
            .filter(entry => !(children.get(entry.id) ?? []).some(child => reachable.has(child.id)))
            .sort(compareChoiceEntries);
        effective.push(terminals[0] ?? root);
    }

    return effective.sort(compareChoiceEntries);
}

export interface EffectiveSessionView {
    /** Same shape/order as the input; step fields overridden by recorded choices. */
    definition: SessionDefinition;
    /** Blocks force-ended by an `end_block` choice -- a navigation shortcut only; the
     * actual completion accounting is carried entirely by the `optional` override above. */
    endedBlockIds: ReadonlySet<string>;
    /** True once any recorded choice fired `end_session`. Navigation shortcut only. */
    sessionEnded: boolean;
}

function scaleRangeOrNumber(value: RangeOrNumber, factor: number): RangeOrNumber {
    if (typeof value === 'number') return value * factor;
    return { min: value.min * factor, max: value.max * factor };
}

function applyReduceLoadPercent(step: SessionStep, percent: number): void {
    const load = step.load;
    if (!load) return;
    const factor = 1 - percent / 100;
    if (load.kind === 'mass') {
        step.load = { ...load, kg: scaleRangeOrNumber(load.kg, factor) };
    } else if (load.kind === 'percent_max' || load.kind === 'percent_one_rm') {
        step.load = { ...load, percent: load.percent * factor };
    } else if (load.kind === 'relative_step') {
        step.load = { ...load, percent: load.percent * factor };
    }
    // bodyweight / band / descriptive / unloaded carry no numeric field to scale -- the
    // choice is still legitimately recorded, it just has no visible load effect.
}

function applyReduceSets(step: SessionStep, sets: number): void {
    if (step.dose?.kind === 'repetition') {
        step.dose = { ...step.dose, sets };
    } else if ((step.dose?.kind === 'duration' || step.dose?.kind === 'distance') && step.dose.sets !== undefined) {
        step.dose = { ...step.dose, sets };
    }
}

function applyReduceReps(step: SessionStep, reps: number): void {
    if (step.dose?.kind === 'repetition') {
        step.dose = { ...step.dose, reps };
    }
}

function applySelectAlternative(step: SessionStep, alternativeId: string): void {
    const alternative = step.alternatives?.find(candidate => candidate.id === alternativeId);
    if (!alternative) return;
    step.exerciseRef = alternative.exerciseRef;
    step.title = alternative.title;
    if (alternative.dose) step.dose = alternative.dose;
    if (alternative.load) step.load = alternative.load;
    step.compositionPatterns = alternative.compositionPatterns;
    step.degradedComposition = alternative.degradedComposition;
    step.resolutionNote = `Substituted via athlete choice: ${alternative.title}`;
}

function findOption(definition: SessionDefinition, choiceId: string, optionId: string) {
    for (const block of definition.blocks) {
        const choice = block.optionSets?.find(candidate => candidate.id === choiceId);
        if (!choice) continue;
        return choice.options.find(candidate => candidate.id === optionId) ?? null;
    }
    return null;
}

export function resolveEffectiveSession(
    definition: SessionDefinition,
    entries: readonly SessionEntry[],
): EffectiveSessionView {
    const choiceEntries = resolveEffectiveChoiceEntries(entries);

    if (choiceEntries.length === 0) {
        return { definition, endedBlockIds: new Set(), sessionEnded: false };
    }

    // Deep-clone only what might be overwritten (blocks/steps), preserving array
    // identity/order/length so index-based navigation state stays valid.
    const blocks: SessionBlock[] = definition.blocks.map(block => ({
        ...block,
        steps: block.steps.map(step => ({ ...step })),
    }));
    const stepsById = new Map<string, SessionStep>();
    for (const block of blocks) {
        for (const step of block.steps) stepsById.set(step.id, step);
    }
    const blocksById = new Map<string, SessionBlock>(blocks.map(block => [block.id, block]));

    const endedBlockIds = new Set<string>();
    let sessionEnded = false;

    const omitStep = (stepId: string | undefined) => {
        const step = stepId ? stepsById.get(stepId) : undefined;
        if (step) step.optional = true;
    };

    for (const entry of choiceEntries) {
        const option = findOption(definition, entry.payload.choiceId, entry.payload.optionId);
        if (!option) continue;

        for (const action of option.actions as SessionChoiceAction[]) {
            if (action.kind === 'select_alternative') {
                const step = stepsById.get(action.targetStepId);
                if (step) applySelectAlternative(step, action.alternativeId);
            } else if (action.kind === 'reduce_load_percent') {
                const step = stepsById.get(action.targetStepId);
                if (step) applyReduceLoadPercent(step, action.percent);
            } else if (action.kind === 'reduce_sets') {
                const step = stepsById.get(action.targetStepId);
                if (step) applyReduceSets(step, action.sets);
            } else if (action.kind === 'reduce_reps') {
                const step = stepsById.get(action.targetStepId);
                if (step) applyReduceReps(step, action.reps);
            } else if (action.kind === 'omit_step') {
                omitStep(action.targetStepId);
            } else if (action.kind === 'end_block') {
                const block = blocksById.get(action.targetBlockId);
                if (block) {
                    endedBlockIds.add(block.id);
                    for (const step of block.steps) step.optional = true;
                }
            } else if (action.kind === 'end_session') {
                sessionEnded = true;
                for (const block of blocks) {
                    for (const step of block.steps) step.optional = true;
                }
            }
        }
    }

    return {
        definition: { ...definition, blocks },
        endedBlockIds,
        sessionEnded,
    };
}
