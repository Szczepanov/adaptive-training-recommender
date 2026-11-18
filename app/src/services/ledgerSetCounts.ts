/**
 * Phase 2b validated set counts for one performed occurrence (ledger export service side).
 * Planned sets come from the pinned prescription's resolved definition; work and warm-up sets
 * come from live structured entries, counted against the effective (choice-resolved) definition the
 * runner used. Linked provider work is never counted.
 */
import { resolveEffectiveSession } from '../sessions/choiceResolution';
import { targetEntriesForGroupStep } from '../sessions/groupProgression';
import type { SessionDefinition, SessionEntry, SessionStep } from '../sessions/models';
import { completedPrescribedSets, countsTowardPrescribedSets, isWarmupEntry } from '../sessions/workSets';

/** Prescribed exercise steps, block-aware (rounds override a step's sets); alternatives are never summed. */
export function plannedSetCount(definition: SessionDefinition): number {
    return definition.blocks.reduce((sum, block) => sum + block.steps
        .filter(step => step.kind === 'exercise')
        .reduce((blockSum, step) => blockSum + targetEntriesForGroupStep(block, step), 0), 0);
}

/** Without the definition, logged left/right holds and carries still pair into one set. */
function inferredStep(stepId: string, entries: readonly SessionEntry[]): SessionStep {
    const sided = entries.find(entry => (entry.payload.kind === 'duration' || entry.payload.kind === 'distance')
        && (entry.side === 'left' || entry.side === 'right'));
    if (sided?.payload.kind === 'duration') {
        return { id: stepId, kind: 'exercise', laterality: 'per_side', dose: { kind: 'duration', seconds: 0 } };
    }
    if (sided?.payload.kind === 'distance') {
        return { id: stepId, kind: 'exercise', laterality: 'per_side', dose: { kind: 'distance', meters: 0 } };
    }
    return { id: stepId, kind: 'exercise' };
}

function workSetCount(entries: readonly SessionEntry[], definition: SessionDefinition | null): number {
    const steps = new Map((definition?.blocks ?? []).flatMap(block => block.steps.map(step => [step.id, step] as const)));
    const byStep = new Map<string, SessionEntry[]>();
    for (const entry of entries.filter(countsTowardPrescribedSets)) {
        const key = entry.stepId ?? `entry:${entry.id}`;
        byStep.set(key, [...(byStep.get(key) ?? []), { ...entry, stepId: key }]);
    }
    return [...byStep].reduce((sum, [stepId, stepEntries]) => {
        const step = steps.get(stepId);
        if (step) return sum + completedPrescribedSets(step, stepEntries);
        // Unknown step (added, or unresolved definition): a mid-session swap can leave holds and
        // carries under one step id, so pair each payload kind on its own -- order-independent.
        const byKind = new Map<string, SessionEntry[]>();
        for (const entry of stepEntries) byKind.set(entry.payload.kind, [...(byKind.get(entry.payload.kind) ?? []), entry]);
        return sum + [...byKind.values()].reduce((kindSum, kindEntries) =>
            kindSum + completedPrescribedSets(inferredStep(stepId, kindEntries), kindEntries), 0);
    }, 0);
}

export interface ExecutionSetInput {
    /** Every stored entry of one linked execution (deleted and choice entries are filtered here). */
    entries: readonly SessionEntry[];
    /** The resolved pinned definition, or null when it could not be resolved. */
    definition: SessionDefinition | null;
}

export function performedSetCounts(executions: readonly ExecutionSetInput[]): { work: number; warmup: number } {
    return executions.reduce((totals, { entries, definition }) => {
        const live = entries.filter(entry => !entry.deletedAt);
        // Same view as `useSessionRunner`: a selected alternative can change dose and pairing.
        const effective = definition ? resolveEffectiveSession(definition, live).definition : null;
        return {
            work: totals.work + workSetCount(live, effective),
            warmup: totals.warmup + live.filter(isWarmupEntry).length,
        };
    }, { work: 0, warmup: 0 });
}
