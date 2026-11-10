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
import { exerciseRefKey, exerciseRefName, stepName } from '../sessions/stepDisplay';

export interface PrescribedStepTarget {
    sets: number;
    reps?: RangeOrNumber;
    seconds?: RangeOrNumber;
    meters?: RangeOrNumber;
    load?: SessionLoad;
    effort?: SessionEffort;
    restSeconds?: RangeOrNumber;
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
    isOptional: boolean;
    prescribed: PrescribedStepTarget;
    sets: PerformedSetRow[];
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
    return { sets, ...target };
}

function isWarmupPayload(payload: SessionEntryPayload): boolean {
    return payload.kind === 'repetition' && payload.isWarmup === true;
}

/** Steps with neither a prescription nor logged work (e.g. a pure `transition`/`rest`
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

    const entriesByStepId = new Map<string, SessionEntry[]>();
    for (const entry of entries) {
        // A recorded athlete choice is not performed work (mirrors comparePlannedVsPerformed).
        if (!entry.stepId || entry.payload.kind === 'choice') continue;
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
            if (step.kind !== 'exercise' && stepEntries.length === 0) continue;
            details.push({
                stepId: step.id,
                ...(step.exerciseRef ? { exerciseRef: step.exerciseRef } : {}),
                ...performedIdentity(step, stepEntries),
                isOptional: !!step.optional,
                prescribed: prescribedTarget(step),
                sets: toSetRows(stepEntries, restByEntryId),
            });
        }
    }
    for (const [stepId, stepEntries] of entriesByStepId) {
        if (definedStepIds.has(stepId)) continue;
        details.push(unplannedStepDetail(stepId, sortedByCompletion(stepEntries), restByEntryId));
    }
    return details;
}

function sortedByCompletion(entries: readonly SessionEntry[]): SessionEntry[] {
    return [...entries].sort((a, b) => a.completedAt.localeCompare(b.completedAt) || a.id.localeCompare(b.id));
}

function toSetRows(entries: readonly SessionEntry[], restByEntryId: ReadonlyMap<string, PerformedRestDetail>): PerformedSetRow[] {
    let warmupCount = 0;
    let workCount = 0;
    return entries.map((entry): PerformedSetRow => {
        const isWarmup = isWarmupPayload(entry.payload);
        const setNumber = isWarmup ? ++warmupCount : ++workCount;
        const rest = restByEntryId.get(entry.id);
        return {
            entryId: entry.id,
            setNumber,
            isWarmup,
            completedAt: entry.completedAt,
            payload: entry.payload,
            ...(entry.exerciseRef ? { exerciseRef: entry.exerciseRef } : {}),
            ...(rest ? { rest } : {}),
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
