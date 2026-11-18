/**
 * Per-set detail for the Completed Workout card (training-occurrence plan, "Activity-detail
 * read model" / acceptance criteria 4-7): what was prescribed for each step, what was
 * actually logged set by set, and the performed rest that followed each set.
 *
 * Pure: the caller (`activitiesReadModelService.ts`) supplies the resolved definition, the
 * logged entries and the durable rest events. Prescribed and performed rest stay separate
 * fields -- performed rest comes only from an explicit `SessionRestEvent`, never from the
 * gap between two `completedAt` values (see `sessions/restEventTiming.ts`).
 */
import type {
    ExerciseRef,
    RangeOrNumber,
    RestEndReason,
    SessionDefinition,
    SessionEffort,
    SessionEntry,
    SessionEntryPayload,
    SessionLoad,
    SessionRestEvent,
    SessionStep,
} from '../sessions/models';
import { resolveEffectiveChoiceEntries } from '../sessions/choiceResolution';
import { exerciseRefKey, exerciseRefName, stepName } from '../sessions/stepDisplay';

export interface PrescribedStepTarget {
    sets: number;
    reps?: RangeOrNumber;
    seconds?: RangeOrNumber;
    meters?: RangeOrNumber;
    load?: SessionLoad;
    effort?: SessionEffort;
    restSeconds?: RangeOrNumber;
    tempo?: string;
    notes?: string;
}

/** An athlete's recorded choice (e.g. an exercise substitution) attached to the step it applies to.
 * Every live choice event is kept, not only the effective one: work performed under an earlier
 * choice keeps its `governingChoiceEntryId`, and a later correction must not relabel it (#1261). */
export interface StepChoiceDetail {
    /** The choice event's own entry id, which performed sets reference as their governing choice. */
    choiceEntryId: string;
    choiceId: string;
    optionId: string;
    optionLabel?: string;
    reason?: string;
    completedAt: string;
    /** The earlier choice event this one corrects (an explicit append-only D-MCHOICE edge). */
    supersedesChoiceEntryId?: string;
    /** The later live choice event that explicitly corrects this one. A non-effective event
     * without it was never corrected: it is history that did not gain authority (an unlinked
     * second event or a losing fork), not a superseded choice. */
    supersededByChoiceEntryId?: string;
    /** True for the event that governs the choice now (`resolveEffectiveChoiceEntries`). */
    effective: boolean;
}

export interface PerformedRestDetail {
    prescribedSeconds?: number;
    actualSeconds: number;
    endReason: RestEndReason;
}

export interface PerformedSetRow {
    entryId: string;
    /** 1-based within its warm-up or work series, in completion order. */
    setNumber: number;
    isWarmup: boolean;
    completedAt: string;
    payload: SessionEntryPayload;
    /** Actual performed exercise identity, which may differ from the authored step after a swap. */
    exerciseRef?: ExerciseRef;
    /** The performed rest that started when this set was completed, when one was recorded. */
    rest?: PerformedRestDetail;
    /** The choice event that governed this set when it was performed. It stays pointed at that
     * event even after a later correction. */
    governingChoiceEntryId?: string;
    /** The option that governing choice selected, as stamped on the set. */
    selectedOptionId?: string;
    /** Left or right for a per-side hold, carry or set; absent for bilateral work. */
    side?: 'left' | 'right';
}

export interface StructuredStepDetail {
    stepId: string;
    /** The authored exercise. Sets carry the performed one (see `performedExerciseRef`). */
    exerciseRef?: ExerciseRef;
    /** What was actually performed: the swapped-in exercise name(s) when the athlete swapped,
     * else the authored step name. */
    title: string;
    /** The authored step name, present only when the performed exercise differs from it. */
    plannedTitle?: string;
    /** The single performed exercise when it differs from the authored one. */
    performedExerciseRef?: ExerciseRef;
    /** Work logged against a step the saved definition does not contain -- an exercise the
     * athlete added during the session. It has no prescription (`prescribed.sets` is 0). */
    unplanned?: true;
    /** A non-exercise step (gate, transition, ...) kept only because the athlete recorded a
     * choice against it. It has no prescription (`prescribed.sets` is 0), so it must never read
     * as missed work. */
    choiceOnly?: true;
    isOptional: boolean;
    prescribed: PrescribedStepTarget;
    sets: PerformedSetRow[];
    choices?: StepChoiceDetail[];
}

function prescribedTarget(step: SessionStep): PrescribedStepTarget {
    const dose = step.dose;
    let sets = 1;
    const target: Omit<PrescribedStepTarget, 'sets'> = {};
    if (dose?.kind === 'repetition') {
        sets = dose.sets;
        target.reps = dose.reps;
    } else if (dose?.kind === 'duration') {
        sets = dose.sets ?? 1;
        target.seconds = dose.seconds;
    } else if (dose?.kind === 'distance') {
        sets = dose.sets ?? 1;
        const meters = dose.meters ?? dose.metres;
        if (meters !== undefined) target.meters = meters;
    }
    if (step.load) target.load = step.load;
    if (step.effort) target.effort = step.effort;
    if (step.rest !== undefined) target.restSeconds = step.rest;
    if (step.tempo) target.tempo = step.tempo;
    if (step.notes) target.notes = step.notes;
    return { sets, ...target };
}

function isWarmupPayload(payload: SessionEntryPayload): boolean {
    return payload.kind === 'repetition' && payload.isWarmup === true;
}

/** Steps with neither a prescription, logged work nor a recorded choice (e.g. a pure `transition`/`rest`
 * step nobody logged against) are omitted -- they carry nothing to compare. */
export function buildStructuredStepDetails(
    definition: SessionDefinition,
    entries: readonly SessionEntry[],
    restEvents: readonly SessionRestEvent[],
): StructuredStepDetail[] {
    const restByEntryId = new Map<string, PerformedRestDetail>();
    for (const event of restEvents) {
        restByEntryId.set(event.afterEntryId, {
            ...(event.prescribedSeconds !== undefined ? { prescribedSeconds: event.prescribedSeconds } : {}),
            actualSeconds: event.actualSeconds,
            endReason: event.endReason,
        });
    }

    const choicesByStepId = collectChoices(definition, entries).byStepId;
    const entriesByStepId = new Map<string, SessionEntry[]>();
    for (const entry of entries) {
        // A recorded athlete choice is not performed work (mirrors comparePlannedVsPerformed).
        if (entry.deletedAt || !entry.stepId || entry.payload.kind === 'choice') continue;
        const list = entriesByStepId.get(entry.stepId) ?? [];
        list.push(entry);
        entriesByStepId.set(entry.stepId, list);
    }

    const details: StructuredStepDetail[] = [];
    const definedStepIds = new Set<string>();
    for (const block of definition.blocks) {
        for (const step of block.steps) {
            definedStepIds.add(step.id);
            const stepEntries = sortedByCompletion(entriesByStepId.get(step.id) ?? []);
            const hasChoice = choicesByStepId.has(step.id);
            if (step.kind !== 'exercise' && stepEntries.length === 0 && !hasChoice) continue;
            const choiceOnly = step.kind !== 'exercise' && stepEntries.length === 0;
            details.push({
                stepId: step.id,
                ...(step.exerciseRef ? { exerciseRef: step.exerciseRef } : {}),
                ...performedIdentity(step, stepEntries),
                isOptional: !!step.optional,
                ...(choiceOnly ? { choiceOnly: true as const } : {}),
                prescribed: choiceOnly ? { sets: 0 } : prescribedTarget(step),
                sets: toSetRows(stepEntries, restByEntryId),
                ...choicesField(choicesByStepId.get(step.id)),
            });
        }
    }
    for (const [stepId, stepEntries] of entriesByStepId) {
        if (definedStepIds.has(stepId)) continue;
        details.push({
            ...unplannedStepDetail(stepId, sortedByCompletion(stepEntries), restByEntryId),
            ...choicesField(choicesByStepId.get(stepId)),
        });
    }
    // A choice recorded against a step that is neither defined nor logged is still a recorded
    // fact; it is kept as a choice-only row rather than dropped.
    for (const [stepId, choices] of choicesByStepId) {
        if (definedStepIds.has(stepId) || entriesByStepId.has(stepId)) continue;
        details.push({
            stepId, title: 'Added step', isOptional: true, choiceOnly: true, prescribed: { sets: 0 }, sets: [],
            ...choicesField(choices),
        });
    }
    return details;
}

function choicesField(choices: readonly StepChoiceDetail[] | undefined): { choices?: StepChoiceDetail[] } {
    return choices && choices.length > 0 ? { choices: [...choices] } : {};
}

/** Choices with no step: the entry carries no `stepId` and its option set is not anchored at a
 * step. They are reported at session level rather than attached to an invented step. */
export function buildSessionLevelChoices(
    definition: SessionDefinition,
    entries: readonly SessionEntry[],
): StepChoiceDetail[] {
    return collectChoices(definition, entries).sessionLevel;
}

/** Live choice entries keyed by the step they apply to: the entry's own step, else the step the
 * matching option set is anchored at. Choices that resolve to no step are session-level. */
function collectChoices(
    definition: SessionDefinition,
    entries: readonly SessionEntry[],
): { byStepId: Map<string, StepChoiceDetail[]>; sessionLevel: StepChoiceDetail[] } {
    const optionSets = definition.blocks.flatMap(block => block.optionSets ?? []);
    const byStepId = new Map<string, StepChoiceDetail[]>();
    const sessionLevel: StepChoiceDetail[] = [];
    const live = entries.filter(entry => !entry.deletedAt);
    // Only the effective entry of each correction chain governs the session now; the others
    // stay as history so earlier performed work keeps the choice it was done under.
    const effectiveIds = new Set(resolveEffectiveChoiceEntries(live).map(entry => entry.id));
    const choiceEntries = sortedByCompletion(live.filter(entry => entry.payload.kind === 'choice'));
    const supersededBy = supersessionEdges(choiceEntries);
    for (const entry of choiceEntries) {
        if (entry.payload.kind !== 'choice') continue;
        const payload = entry.payload;
        const optionSet = optionSets.find(set => set.id === payload.choiceId);
        const optionLabel = optionSet?.options.find(option => option.id === payload.optionId)?.label;
        const detail: StepChoiceDetail = {
            choiceEntryId: entry.id,
            choiceId: payload.choiceId,
            optionId: payload.optionId,
            ...(optionLabel !== undefined ? { optionLabel } : {}),
            ...(payload.reason !== undefined ? { reason: payload.reason } : {}),
            completedAt: entry.completedAt,
            ...(entry.supersedesChoiceEntryId ? { supersedesChoiceEntryId: entry.supersedesChoiceEntryId } : {}),
            ...(supersededBy.has(entry.id) ? { supersededByChoiceEntryId: supersededBy.get(entry.id) } : {}),
            effective: effectiveIds.has(entry.id),
        };
        const stepId = entry.stepId ?? optionSet?.appliesAtStepId;
        if (stepId) byStepId.set(stepId, [...(byStepId.get(stepId) ?? []), detail]);
        else sessionLevel.push(detail);
    }
    return { byStepId, sessionLevel };
}

/** Corrected entry id -> the first (by completion) live entry whose valid edge corrects it. The
 * edge must point at a different entry of the same `choiceId`, as `resolveEffectiveChoiceEntries` requires. */
function supersessionEdges(choiceEntries: readonly SessionEntry[]): Map<string, string> {
    const byId = new Map(choiceEntries.map(entry => [entry.id, entry]));
    const edges = new Map<string, string>();
    for (const entry of choiceEntries) {
        const parent = entry.supersedesChoiceEntryId ? byId.get(entry.supersedesChoiceEntryId) : undefined;
        if (!parent || parent.id === entry.id || edges.has(parent.id)) continue;
        if (parent.payload.kind !== 'choice' || entry.payload.kind !== 'choice') continue;
        if (parent.payload.choiceId !== entry.payload.choiceId) continue;
        edges.set(parent.id, entry.id);
    }
    return edges;
}

function sortedByCompletion(entries: readonly SessionEntry[]): SessionEntry[] {
    return [...entries].sort((a, b) => a.completedAt.localeCompare(b.completedAt) || a.id.localeCompare(b.id));
}

/** The left/right halves of one per-side hold or carry set share a set number. */
function pairKey(entry: SessionEntry, isWarmup: boolean): string | null {
    if (isWarmup || (entry.side !== 'left' && entry.side !== 'right')) return null;
    if (entry.payload.kind !== 'duration' && entry.payload.kind !== 'distance') return null;
    const ref = entry.exerciseRef;
    const exercise = !ref ? '' : ref.kind === 'catalog' ? ref.exerciseId : ref.name;
    return `${entry.payload.kind}|${exercise}`;
}

function toSetRows(entries: readonly SessionEntry[], restByEntryId: ReadonlyMap<string, PerformedRestDetail>): PerformedSetRow[] {
    let warmupCount = 0;
    let workCount = 0;
    // Per pair key: set numbers still waiting for their other side, oldest first, by side.
    const openHalves = new Map<string, { left: number[]; right: number[] }>();
    return entries.map((entry): PerformedSetRow => {
        const isWarmup = isWarmupPayload(entry.payload);
        const key = pairKey(entry, isWarmup);
        let setNumber: number;
        if (key && (entry.side === 'left' || entry.side === 'right')) {
            const open = openHalves.get(key) ?? { left: [], right: [] };
            const other = entry.side === 'left' ? 'right' : 'left';
            const [partner, ...rest] = open[other];
            // Completes the oldest set still missing this side, or opens a new set number.
            setNumber = partner ?? ++workCount;
            openHalves.set(key, partner !== undefined
                ? { ...open, [other]: rest }
                : { ...open, [entry.side]: [...open[entry.side], setNumber] });
        } else {
            setNumber = isWarmup ? ++warmupCount : ++workCount;
        }
        const rest = restByEntryId.get(entry.id);
        return {
            entryId: entry.id,
            setNumber,
            isWarmup,
            completedAt: entry.completedAt,
            payload: entry.payload,
            ...(entry.exerciseRef ? { exerciseRef: entry.exerciseRef } : {}),
            ...(rest ? { rest } : {}),
            ...(entry.governingChoiceEntryId ? { governingChoiceEntryId: entry.governingChoiceEntryId } : {}),
            ...(entry.selectedOptionId ? { selectedOptionId: entry.selectedOptionId } : {}),
            ...(entry.side === 'left' || entry.side === 'right' ? { side: entry.side } : {}),
        };
    });
}

/** Distinct performed exercises in the order they were first logged. */
function distinctPerformedRefs(entries: readonly SessionEntry[]): ExerciseRef[] {
    const seen = new Map<string, ExerciseRef>();
    for (const entry of entries) {
        if (entry.exerciseRef && !seen.has(exerciseRefKey(entry.exerciseRef))) {
            seen.set(exerciseRefKey(entry.exerciseRef), entry.exerciseRef);
        }
    }
    return [...seen.values()];
}

const AUTHORED_KEY = 'authored';

/** A mid-session swap is stored on each logged set (`entry.exerciseRef`), never on the saved
 * definition, so the summary must name the step after what was performed. */
function performedIdentity(
    step: SessionStep,
    entries: readonly SessionEntry[],
): Pick<StructuredStepDetail, 'title' | 'plannedTitle' | 'performedExerciseRef'> {
    const plannedTitle = stepName(step);
    const authoredKey = step.exerciseRef ? exerciseRefKey(step.exerciseRef) : AUTHORED_KEY;
    // A set without its own reference was performed as authored (sets logged before a swap).
    const performed = new Map<string, { name: string; ref?: ExerciseRef }>();
    for (const entry of entries) {
        const key = entry.exerciseRef ? exerciseRefKey(entry.exerciseRef) : authoredKey;
        if (performed.has(key)) continue;
        performed.set(key, key === authoredKey
            ? { name: plannedTitle, ...(step.exerciseRef ? { ref: step.exerciseRef } : {}) }
            : { name: exerciseRefName(entry.exerciseRef!), ref: entry.exerciseRef });
    }
    if (performed.size === 0 || (performed.size === 1 && performed.has(authoredKey))) {
        return { title: plannedTitle };
    }
    const identities = [...performed.values()];
    const single = identities.length === 1 ? identities[0].ref : undefined;
    return {
        title: identities.map(identity => identity.name).join(' / '),
        plannedTitle,
        ...(single ? { performedExerciseRef: single } : {}),
    };
}

function unplannedStepDetail(
    stepId: string,
    entries: readonly SessionEntry[],
    restByEntryId: ReadonlyMap<string, PerformedRestDetail>,
): StructuredStepDetail {
    const performed = distinctPerformedRefs(entries);
    return {
        stepId,
        ...(performed.length === 1 ? { exerciseRef: performed[0] } : {}),
        title: performed.length > 0 ? performed.map(exerciseRefName).join(' / ') : 'Added exercise',
        unplanned: true,
        isOptional: true,
        prescribed: { sets: 0 },
        sets: toSetRows(entries, restByEntryId),
    };
}
