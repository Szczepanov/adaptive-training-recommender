/**
 * M3.7: fine-grained content diff between two revisions of the same `SessionDefinition`.
 *
 * `externalPlanDiff.ts` already flags placement/gating/objective/scaling changes at the
 * plan-session envelope level; this module is the "the session content changed" line's
 * replacement for `external-plan@2` sessions (and any other two `SessionDefinition`
 * revisions worth comparing) -- it names *what* changed inside `blocks`, not just that
 * something did.
 *
 * Every row is tagged `behaviorChanging`. That distinguishes changes that alter what the
 * athlete is asked to do or how the runner behaves (dose, load, laterality, optional vs
 * required, an authored choice's actions, ...) from purely cosmetic text (title, notes,
 * a choice's trigger wording). The preview surfaces both, but only behavior-changing rows
 * need to block casual confirmation.
 */
import type {
    RangeOrNumber,
    SessionBlock,
    SessionChoice,
    SessionChoiceAction,
    SessionDefinition,
    SessionDose,
    SessionEffort,
    SessionLoad,
    SessionOption,
    SessionQuality,
    SessionStep,
} from './models';

export interface SessionContentDiffRow {
    scope: 'session' | 'block' | 'step' | 'choice' | 'option';
    id: string;
    change: 'added' | 'removed' | 'changed';
    behaviorChanging: boolean;
    detail: string;
}

function formatRangeOrNumber(value: RangeOrNumber): string {
    return typeof value === 'number' ? String(value) : `${value.min}–${value.max}`;
}

function sameJson(left: unknown, right: unknown): boolean {
    return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function sameStringSet(left: readonly string[] | undefined, right: readonly string[] | undefined): boolean {
    return JSON.stringify([...(left ?? [])].sort()) === JSON.stringify([...(right ?? [])].sort());
}

function formatDose(dose: SessionDose | undefined): string {
    if (!dose) return 'no prescribed dose';
    switch (dose.kind) {
        case 'repetition': return `${dose.sets} × ${formatRangeOrNumber(dose.reps)} reps`;
        case 'duration': return `${dose.sets ?? 1} × ${formatRangeOrNumber(dose.seconds)} s`;
        case 'distance': return `${formatRangeOrNumber(dose.meters ?? dose.metres ?? 0)} m`;
        case 'checkoff': return `${dose.rounds ?? 1} rounds`;
    }
}

function formatLoad(load: SessionLoad | undefined): string {
    if (!load) return 'no prescribed load';
    switch (load.kind) {
        case 'bodyweight': return 'bodyweight';
        case 'mass': return `${formatRangeOrNumber(load.kg)} kg`;
        case 'band': return `${load.bandColor} band`;
        case 'percent_max': return `${load.percent}% max`;
        case 'percent_one_rm': return `${load.percent}% 1RM`;
        case 'relative_step': return `${load.percent}% of ${load.stepId}`;
        case 'descriptive': return load.display ?? load.description ?? 'descriptive load';
        case 'unloaded': return 'unloaded';
    }
}

function formatEffort(effort: SessionEffort | undefined): string {
    if (!effort) return 'none';
    const parts: string[] = [];
    if (effort.target !== undefined) parts.push(`${effort.kind ?? 'target'} ${formatRangeOrNumber(effort.target)}`);
    if (effort.rpe !== undefined) parts.push(`RPE ${formatRangeOrNumber(effort.rpe)}`);
    if (effort.rir !== undefined) parts.push(`${formatRangeOrNumber(effort.rir)} RIR`);
    return parts.length > 0 ? parts.join(', ') : 'none';
}

function formatQuality(quality: SessionQuality | undefined): string {
    if (!quality) return 'none';
    const parts: string[] = [];
    if (quality.maxLossPercent !== undefined) parts.push(`max loss ${quality.maxLossPercent}%`);
    if (quality.velocityLossPercentCap !== undefined) parts.push(`velocity loss cap ${quality.velocityLossPercentCap}%`);
    if (quality.technicalStop) parts.push('technical stop');
    return parts.length > 0 ? parts.join(', ') : 'none';
}

function formatAction(action: SessionChoiceAction): string {
    switch (action.kind) {
        case 'select_alternative': return `use alternative ${action.alternativeId}`;
        case 'reduce_load_percent': return `reduce load ${action.percent}%`;
        case 'reduce_sets': return `reduce to ${action.sets} sets`;
        case 'reduce_reps': return `reduce to ${action.reps} reps`;
        case 'omit_step': return 'omit step';
        case 'end_block': return 'end block';
        case 'end_session': return 'end session';
    }
}

function formatActions(actions: readonly SessionChoiceAction[]): string {
    return actions.length > 0 ? actions.map(formatAction).join(' + ') : 'no effect';
}

function byId<T extends { id: string }>(items: readonly T[] | undefined): Map<string, T> {
    return new Map((items ?? []).map(item => [item.id, item]));
}

function diffOptions(blockId: string, choiceId: string, before: readonly SessionOption[], after: readonly SessionOption[]): SessionContentDiffRow[] {
    const rows: SessionContentDiffRow[] = [];
    const beforeById = byId(before);
    const afterById = byId(after);
    for (const [id, option] of beforeById) {
        if (!afterById.has(id)) {
            rows.push({ scope: 'option', id: `${blockId}/${choiceId}/${id}`, change: 'removed', behaviorChanging: true, detail: `Choice option "${option.label}" was removed.` });
        }
    }
    for (const [id, option] of afterById) {
        const old = beforeById.get(id);
        if (!old) {
            rows.push({ scope: 'option', id: `${blockId}/${choiceId}/${id}`, change: 'added', behaviorChanging: true, detail: `Choice option "${option.label}" is new (${formatActions(option.actions)}).` });
            continue;
        }
        const changes: string[] = [];
        let behaviorChanging = false;
        if (old.label !== option.label) changes.push(`renamed from "${old.label}"`);
        if (!sameJson(old.actions, option.actions)) {
            changes.push(`actions ${formatActions(old.actions)} → ${formatActions(option.actions)}`);
            behaviorChanging = true;
        }
        if (changes.length > 0) {
            rows.push({ scope: 'option', id: `${blockId}/${choiceId}/${id}`, change: 'changed', behaviorChanging, detail: `Choice option "${option.label}": ${changes.join('; ')}.` });
        }
    }
    return rows;
}

function diffChoices(blockId: string, before: readonly SessionChoice[] | undefined, after: readonly SessionChoice[] | undefined): SessionContentDiffRow[] {
    const rows: SessionContentDiffRow[] = [];
    const beforeById = byId(before);
    const afterById = byId(after);
    for (const [id, choice] of beforeById) {
        if (!afterById.has(id)) {
            rows.push({ scope: 'choice', id: `${blockId}/${id}`, change: 'removed', behaviorChanging: true, detail: `Authored choice "${choice.trigger.description}" was removed.` });
        }
    }
    for (const [id, choice] of afterById) {
        const old = beforeById.get(id);
        if (!old) {
            rows.push({ scope: 'choice', id: `${blockId}/${id}`, change: 'added', behaviorChanging: true, detail: `Authored choice "${choice.trigger.description}" is new.` });
            continue;
        }
        if (old.trigger.description !== choice.trigger.description) {
            rows.push({ scope: 'choice', id: `${blockId}/${id}`, change: 'changed', behaviorChanging: false, detail: `Choice wording changed from "${old.trigger.description}" to "${choice.trigger.description}".` });
        }
        if (old.appliesAtStepId !== choice.appliesAtStepId) {
            rows.push({ scope: 'choice', id: `${blockId}/${id}`, change: 'changed', behaviorChanging: true, detail: `Choice "${choice.trigger.description}" now applies at a different step.` });
        }
        rows.push(...diffOptions(blockId, id, old.options, choice.options));
    }
    return rows;
}

function diffStep(blockId: string, before: SessionStep, after: SessionStep): SessionContentDiffRow | null {
    const changes: string[] = [];
    let behaviorChanging = false;

    if (!sameJson(before.exerciseRef, after.exerciseRef)) {
        changes.push('movement changed');
        behaviorChanging = true;
    }
    if (!sameJson(before.dose, after.dose)) {
        changes.push(`dose ${formatDose(before.dose)} → ${formatDose(after.dose)}`);
        behaviorChanging = true;
    }
    if (!sameJson(before.load, after.load)) {
        changes.push(`load ${formatLoad(before.load)} → ${formatLoad(after.load)}`);
        behaviorChanging = true;
    }
    if (!sameJson(before.effort, after.effort)) {
        changes.push(`effort ${formatEffort(before.effort)} → ${formatEffort(after.effort)}`);
        behaviorChanging = true;
    }
    if (!sameJson(before.quality, after.quality)) {
        changes.push(`quality gauge ${formatQuality(before.quality)} → ${formatQuality(after.quality)}`);
        behaviorChanging = true;
    }
    if (!sameJson(before.rest, after.rest)) {
        changes.push(`rest ${before.rest !== undefined ? formatRangeOrNumber(before.rest) : 'none'} → ${after.rest !== undefined ? formatRangeOrNumber(after.rest) : 'none'} s`);
        behaviorChanging = true;
    }
    if (before.tempo !== after.tempo) {
        changes.push(`tempo ${before.tempo ?? 'none'} → ${after.tempo ?? 'none'}`);
        behaviorChanging = true;
    }
    if (before.laterality !== after.laterality) {
        changes.push(`laterality ${before.laterality ?? 'bilateral'} → ${after.laterality ?? 'bilateral'}`);
        behaviorChanging = true;
    }
    if (Boolean(before.optional) !== Boolean(after.optional)) {
        changes.push(after.optional ? 'required → optional' : 'optional → required');
        behaviorChanging = true;
    }
    if (!sameJson(before.alternatives, after.alternatives)) {
        changes.push('authored alternatives changed');
        behaviorChanging = true;
    }
    if (!sameStringSet(before.stopConditions, after.stopConditions)) {
        changes.push('stop conditions changed');
        behaviorChanging = true;
    }
    if ((before.title ?? '') !== (after.title ?? '')) {
        changes.push(`title changed`);
    }
    if ((before.notes ?? '') !== (after.notes ?? '')) {
        changes.push('notes changed');
    }

    if (changes.length === 0) return null;
    const label = after.title ?? before.title ?? after.id;
    return { scope: 'step', id: `${blockId}/${after.id}`, change: 'changed', behaviorChanging, detail: `Step "${label}": ${changes.join('; ')}.` };
}

function diffBlock(before: SessionBlock, after: SessionBlock): SessionContentDiffRow[] {
    const rows: SessionContentDiffRow[] = [];
    const blockLabel = after.title ?? before.title ?? after.id;
    const headerChanges: string[] = [];
    if (before.role !== after.role) headerChanges.push(`role ${before.role} → ${after.role}`);
    if (before.executionMode !== after.executionMode) headerChanges.push(`execution mode ${before.executionMode} → ${after.executionMode}`);
    if (!sameJson(before.rounds, after.rounds)) {
        headerChanges.push(`rounds ${before.rounds !== undefined ? formatRangeOrNumber(before.rounds) : 'none'} → ${after.rounds !== undefined ? formatRangeOrNumber(after.rounds) : 'none'}`);
    }
    if (headerChanges.length > 0) {
        rows.push({ scope: 'block', id: after.id, change: 'changed', behaviorChanging: true, detail: `Block "${blockLabel}": ${headerChanges.join('; ')}.` });
    }
    if ((before.title ?? '') !== (after.title ?? '')) {
        rows.push({ scope: 'block', id: after.id, change: 'changed', behaviorChanging: false, detail: `Block "${blockLabel}" was renamed from "${before.title ?? before.id}".` });
    }

    const beforeSteps = byId(before.steps);
    const afterSteps = byId(after.steps);
    for (const [id, step] of beforeSteps) {
        if (!afterSteps.has(id)) {
            rows.push({ scope: 'step', id: `${after.id}/${id}`, change: 'removed', behaviorChanging: true, detail: `Step "${step.title ?? id}" was removed from "${blockLabel}".` });
        }
    }
    for (const [id, step] of afterSteps) {
        const old = beforeSteps.get(id);
        if (!old) {
            rows.push({ scope: 'step', id: `${after.id}/${id}`, change: 'added', behaviorChanging: true, detail: `Step "${step.title ?? id}" is new in "${blockLabel}" (${formatDose(step.dose)}).` });
            continue;
        }
        const stepRow = diffStep(after.id, old, step);
        if (stepRow) rows.push(stepRow);
    }

    rows.push(...diffChoices(after.id, before.optionSets, after.optionSets));
    return rows;
}

/**
 * What changed between two revisions of the same session's executable content, at block,
 * step and authored-choice granularity. Order follows the `after` definition's block/step
 * order so the reader can scan top to bottom alongside the preview.
 */
export function diffSessionDefinitions(previous: SessionDefinition, next: SessionDefinition): SessionContentDiffRow[] {
    const rows: SessionContentDiffRow[] = [];

    const headerChanges: string[] = [];
    if (previous.intent !== next.intent) headerChanges.push(`intent ${previous.intent} → ${next.intent}`);
    if ((previous.dominantModality ?? '') !== (next.dominantModality ?? '')) {
        headerChanges.push(`dominant modality ${previous.dominantModality ?? 'none'} → ${next.dominantModality ?? 'none'}`);
    }
    if (!sameStringSet(previous.modalities, next.modalities)) headerChanges.push('modalities changed');
    if (!sameJson(previous.duration, next.duration)) {
        const from = previous.duration ? `${previous.duration.min}–${previous.duration.max}` : 'none';
        const to = next.duration ? `${next.duration.min}–${next.duration.max}` : 'none';
        headerChanges.push(`duration ${from} → ${to} min`);
    }
    if (!sameStringSet(previous.prohibitedAdditions, next.prohibitedAdditions)) headerChanges.push('prohibited additions changed');
    if (!sameJson(previous.companionSessions, next.companionSessions)) headerChanges.push('companion sessions changed');
    if (headerChanges.length > 0) {
        rows.push({ scope: 'session', id: next.id, change: 'changed', behaviorChanging: true, detail: `Session: ${headerChanges.join('; ')}.` });
    }
    if ((previous.title ?? '') !== (next.title ?? '') || (previous.summary ?? '') !== (next.summary ?? '')) {
        rows.push({ scope: 'session', id: next.id, change: 'changed', behaviorChanging: false, detail: 'Title or summary text changed.' });
    }

    const beforeBlocks = byId(previous.blocks);
    const afterBlocks = byId(next.blocks);
    for (const [id, block] of beforeBlocks) {
        if (!afterBlocks.has(id)) {
            rows.push({ scope: 'block', id, change: 'removed', behaviorChanging: true, detail: `Block "${block.title ?? id}" was removed.` });
        }
    }
    for (const [id, block] of afterBlocks) {
        const old = beforeBlocks.get(id);
        if (!old) {
            rows.push({ scope: 'block', id, change: 'added', behaviorChanging: true, detail: `Block "${block.title ?? id}" is new (${block.steps.length} step${block.steps.length === 1 ? '' : 's'}).` });
            continue;
        }
        rows.push(...diffBlock(old, block));
    }

    return rows;
}

/** True when at least one row would change what the athlete is asked to do -- not just
 * wording. Callers use this to decide whether a diff needs explicit acknowledgement before
 * import can proceed, versus a purely informational note. */
export function hasBehaviorChanges(rows: readonly SessionContentDiffRow[]): boolean {
    return rows.some(row => row.behaviorChanging);
}
