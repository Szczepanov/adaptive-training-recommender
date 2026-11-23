/**
 * Ledger export Phase 3B (`docs/plans/2026-11-14-ledger-export-ai-content.md`, G3): swaps and
 * omissions the athlete chose during a session, as `coachingHistory.overrides` rows.
 *
 * Pure. Only the effective event of each choice's correction chain counts, so a corrected choice
 * is never a second override, and its row id comes from the chain's root entry, so a correction that
 * only changes the reason keeps the same row. A superseded choice that still governed live performed
 * entries (`governingChoiceEntryId`) is also reported, with `correctedLater: true`, because the work it
 * shaped was really done. Each choice is resolved against the definition pinned for that run
 * (`resolvePinned`): `select_alternative` is a swap, and `omit_step`, `end_block` and `end_session`
 * are omissions, because the runner applies all three by making the affected steps optional. Load,
 * set or rep reductions are not overrides. A choice that cannot be resolved keeps explicit
 * missingness instead of being guessed or dropped.
 */
import type { ChoiceOverrideInput } from '../ledger/export/inputs';
import type { LedgerState } from '../ledger/export/schema';
import type { NormalizedExecutionRecord } from '../sessions/legacyStrengthAdapter';
import type { SessionChoiceAction, SessionDefinition, SessionEntry, SessionStep } from '../sessions/models';
import { resolveEffectiveChoiceEntries, type ChoiceSessionEntry } from '../sessions/choiceResolution';
import { exerciseRefName, stepName } from '../sessions/stepDisplay';

export type PinnedDefinition = { definition: SessionDefinition } | { state: LedgerState };


function findStep(definition: SessionDefinition, stepId: string): SessionStep | undefined {
    return definition.blocks.flatMap(block => block.steps).find(step => step.id === stepId);
}

function actionRow(
    base: Omit<ChoiceOverrideInput, 'id' | 'kind'>,
    id: string,
    action: SessionChoiceAction,
    definition: SessionDefinition,
): ChoiceOverrideInput | null {
    if (action.kind === 'end_session') return { ...base, id, kind: 'omitted', step: 'rest of session' };
    if (action.kind === 'end_block') {
        const block = definition.blocks.find(item => item.id === action.targetBlockId);
        const step = block ? { step: `rest of block: ${block.title?.trim() || block.id}` } : { stepState: 'invalid' as const };
        return { ...base, id, kind: 'omitted', ...step };
    }
    if (action.kind !== 'select_alternative' && action.kind !== 'omit_step') return null;
    const step = findStep(definition, action.targetStepId);
    const stepField = step ? { step: stepName(step) } : { stepState: 'invalid' as const };
    if (action.kind === 'omit_step') return { ...base, id, kind: 'omitted', ...stepField };
    const alternative = step?.alternatives?.find(item => item.id === action.alternativeId);
    const replacement = alternative ? { replacement: alternative.title || exerciseRefName(alternative.exerciseRef) } : { replacementState: 'invalid' as const };
    return { ...base, id, kind: 'swapped', ...stepField, ...replacement };
}

/** The first entry of `entry`'s `supersedesChoiceEntryId` chain among the same choice's live entries. */
function chainRoot(entry: ChoiceSessionEntry, live: readonly SessionEntry[]): string {
    const byId = new Map(live.flatMap(item => (item.payload.kind === 'choice' && item.payload.choiceId === entry.payload.choiceId ? [[item.id, item]] : [])));
    const seen = new Set<string>([entry.id]);
    let current: SessionEntry = entry;
    for (;;) {
        const parent = current.supersedesChoiceEntryId ? byId.get(current.supersedesChoiceEntryId) : undefined;
        if (!parent || seen.has(parent.id)) return current.id;
        seen.add(parent.id);
        current = parent;
    }
}

function choiceRows(
    row: NormalizedExecutionRecord, entry: ChoiceSessionEntry, pinned: PinnedDefinition, idPrefix: string, correctedLater: boolean,
): ChoiceOverrideInput[] {
    const { execution } = row;
    const source = execution.sessionSource;
    const reason = entry.payload.reason?.trim();
    const base: Omit<ChoiceOverrideInput, 'id' | 'kind'> = {
        date: execution.date,
        executionState: execution.state,
        ...(source.kind === 'external_plan' ? { planId: source.planId, sessionId: source.sessionId } : {}),
        ...(reason ? { reason } : {}),
        correctedLater,
    };
    const id = `${execution.executionId}:${idPrefix}`;
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
    const effective = resolveEffectiveChoiceEntries(live);
    const effectiveIds = new Set(effective.map(entry => entry.id));
    const governing = new Set(live.flatMap(entry => (entry.payload.kind !== 'choice' && entry.governingChoiceEntryId ? [entry.governingChoiceEntryId] : [])));
    const supersededGoverning = live.filter((entry): entry is ChoiceSessionEntry =>
        entry.payload.kind === 'choice' && governing.has(entry.id) && !effectiveIds.has(entry.id));
    return [...supersededGoverning, ...effective]
        .sort((a, b) => a.completedAt.localeCompare(b.completedAt) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
        .flatMap(entry => {
            const root = chainRoot(entry, live);
            return effectiveIds.has(entry.id)
                ? choiceRows(row, entry, pinned, root, false)
                : choiceRows(row, entry, pinned, `${root}@${entry.id}`, true);
        });
}
