/**
 * Ledger export Phase 3B (`docs/plans/2026-11-14-ledger-export-ai-content.md`, G3): swaps and
 * omissions the athlete chose during a session, as `coachingHistory.overrides` rows.
 *
 * Pure. Only the effective event of each choice's correction chain counts, so a corrected choice
 * is never a second override. Each choice is resolved against the definition pinned for that run
 * (`resolvePinned`): `select_alternative` is a swap and `omit_step` an omission. Other actions
 * (load, sets or reps reductions, ending a block or the session) are not overrides. A choice that
 * cannot be resolved keeps explicit missingness instead of being guessed or dropped.
 */
import type { ChoiceOverrideInput } from '../ledger/export/inputs';
import type { LedgerState } from '../ledger/export/schema';
import type { NormalizedExecutionRecord } from '../sessions/legacyStrengthAdapter';
import type { SessionChoiceAction, SessionDefinition, SessionStep } from '../sessions/models';
import { resolveEffectiveChoiceEntries } from '../sessions/choiceResolution';
import { exerciseRefName, stepName } from '../sessions/stepDisplay';

export type PinnedDefinition = { definition: SessionDefinition } | { state: LedgerState };

type ChoiceEntry = ReturnType<typeof resolveEffectiveChoiceEntries>[number];

function findStep(definition: SessionDefinition, stepId: string): SessionStep | undefined {
    return definition.blocks.flatMap(block => block.steps).find(step => step.id === stepId);
}

function actionRow(
    base: Omit<ChoiceOverrideInput, 'id' | 'kind'>,
    id: string,
    action: SessionChoiceAction,
    definition: SessionDefinition,
): ChoiceOverrideInput | null {
    if (action.kind !== 'select_alternative' && action.kind !== 'omit_step') return null;
    const step = findStep(definition, action.targetStepId);
    const stepField = step ? { step: stepName(step) } : { stepState: 'invalid' as const };
    if (action.kind === 'omit_step') return { ...base, id, kind: 'omitted', ...stepField };
    const alternative = step?.alternatives?.find(item => item.id === action.alternativeId);
    const replacement = alternative ? { replacement: alternative.title || exerciseRefName(alternative.exerciseRef) } : { replacementState: 'invalid' as const };
    return { ...base, id, kind: 'swapped', ...stepField, ...replacement };
}

function choiceRows(row: NormalizedExecutionRecord, entry: ChoiceEntry, pinned: PinnedDefinition): ChoiceOverrideInput[] {
    const { execution } = row;
    const source = execution.sessionSource;
    const reason = entry.payload.reason?.trim();
    const base: Omit<ChoiceOverrideInput, 'id' | 'kind'> = {
        date: execution.date,
        executionState: execution.state,
        ...(source.kind === 'external_plan' ? { planId: source.planId, sessionId: source.sessionId } : {}),
        ...(reason ? { reason } : {}),
    };
    const id = `${execution.executionId}:${entry.id}`;
    if (!('definition' in pinned)) return [{ ...base, id, kind: null, kindState: pinned.state }];
    const option = pinned.definition.blocks.flatMap(block => block.optionSets ?? [])
        .find(set => set.id === entry.payload.choiceId)?.options.find(item => item.id === entry.payload.optionId);
    // The pinned definition does not contain the recorded option: never guess what it did.
    if (!option) return [{ ...base, id, kind: null, kindState: 'invalid' }];
    return option.actions.flatMap((action, index) => {
        const resolved = actionRow(base, `${id}:${index}`, action, pinned.definition);
        return resolved ? [resolved] : [];
    });
}

/** True when the run has at least one live choice entry (skips a pinned-definition read otherwise). */
export function hasLiveChoice(row: NormalizedExecutionRecord): boolean {
    return row.entries.some(entry => !entry.deletedAt && entry.payload.kind === 'choice');
}

/** Override rows for one execution's effective choices, resolved against its pinned definition. */
export function choiceOverridesForExecution(row: NormalizedExecutionRecord, pinned: PinnedDefinition): ChoiceOverrideInput[] {
    const live = row.entries.filter(entry => !entry.deletedAt);
    return resolveEffectiveChoiceEntries(live).flatMap(entry => choiceRows(row, entry, pinned));
}
