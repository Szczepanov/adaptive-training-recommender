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
import { stepName } from '../sessions/stepDisplay';

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
    /** The performed rest that started when this set was completed, when one was recorded. */
    rest?: PerformedRestDetail;
}

export interface StructuredStepDetail {
    stepId: string;
    title: string;
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
    for (const block of definition.blocks) {
        for (const step of block.steps) {
            const stepEntries = [...(entriesByStepId.get(step.id) ?? [])]
                .sort((a, b) => a.completedAt.localeCompare(b.completedAt) || a.id.localeCompare(b.id));
            if (step.kind !== 'exercise' && stepEntries.length === 0) continue;

            let warmupCount = 0;
            let workCount = 0;
            const sets = stepEntries.map((entry): PerformedSetRow => {
                const isWarmup = isWarmupPayload(entry.payload);
                const setNumber = isWarmup ? ++warmupCount : ++workCount;
                const rest = restByEntryId.get(entry.id);
                return {
                    entryId: entry.id,
                    setNumber,
                    isWarmup,
                    completedAt: entry.completedAt,
                    payload: entry.payload,
                    ...(rest ? { rest } : {}),
                };
            });

            details.push({
                stepId: step.id,
                title: stepName(step),
                isOptional: !!step.optional,
                prescribed: prescribedTarget(step),
                sets,
            });
        }
    }
    return details;
}
