import type {
    SessionDefinition,
    SessionEntry,
    RepetitionEntryPayload,
    DurationEntryPayload,
    DistanceEntryPayload,
} from './models';
import { countsTowardPrescribedSets } from './workSets';

export interface StepComparison {
    stepId: string;
    blockId: string;
    stepTitle: string;
    isOptional: boolean;
    targetSets: number;
    /** Work sets only: warm-up sets never count toward the prescription (ADR-0021 D-SETLOG). */
    completedSets: number;
    isComplete: boolean;
    /** Every performed entry for the step, warm-ups included (they stay visible, flagged by
     * `isWarmup`); recorded choices excluded. */
    entries: SessionEntry[];
}

export interface PerformedSessionComparison {
    definitionId: string;
    revision: number;
    title: string;
    totalPlannedSteps: number;
    completedStepsCount: number;
    missingRequiredStepsCount: number;
    stepComparisons: StepComparison[];
    summary: {
        /** All performed reps, warm-ups included -- they are real reps. */
        totalReps: number;
        /** Work sets only: warm-ups are excluded from tonnage (ADR-0021 D-SETLOG). */
        totalTonnageKg: number;
        totalDurationSeconds: number;
        totalDistanceMeters: number;
    };
}

export function comparePlannedVsPerformed(
    definition: SessionDefinition,
    entries: readonly SessionEntry[],
): PerformedSessionComparison {
    const entriesByStepId = new Map<string, SessionEntry[]>();
    for (const entry of entries) {
        // A recorded athlete choice (D-MCHOICE) shares a step's entries subcollection but
        // is not performed work -- it must never count toward set/step completion.
        if (entry.stepId && entry.payload.kind !== 'choice') {
            const list = entriesByStepId.get(entry.stepId) ?? [];
            list.push(entry);
            entriesByStepId.set(entry.stepId, list);
        }
    }

    const stepComparisons: StepComparison[] = [];
    let totalPlannedSteps = 0;
    let completedStepsCount = 0;
    let missingRequiredStepsCount = 0;

    let totalReps = 0;
    let totalTonnageKg = 0;
    let totalDurationSeconds = 0;
    let totalDistanceMeters = 0;

    for (const block of definition.blocks) {
        for (const step of block.steps) {
            totalPlannedSteps++;
            const stepEntries = entriesByStepId.get(step.id) ?? [];
            const isOptional = !!step.optional;

            let targetSets = 1;
            if (step.dose?.kind === 'repetition') {
                targetSets = step.dose.sets;
            } else if (step.dose?.kind === 'duration' && step.dose.sets) {
                targetSets = step.dose.sets;
            } else if (step.dose?.kind === 'distance' && step.dose.sets) {
                targetSets = step.dose.sets;
            }

            const completedSets = stepEntries.filter(countsTowardPrescribedSets).length;
            const isComplete = completedSets >= targetSets;

            if (isComplete) {
                completedStepsCount++;
            } else if (!isOptional) {
                missingRequiredStepsCount++;
            }

            // Accumulate summary metrics
            for (const entry of stepEntries) {
                const payload = entry.payload;
                if (payload.kind === 'repetition') {
                    const rep = payload as RepetitionEntryPayload;
                    totalReps += rep.reps;
                    if (!rep.isWarmup && rep.weightKg && rep.weightKg > 0) {
                        totalTonnageKg += rep.weightKg * rep.reps;
                    }
                } else if (payload.kind === 'duration') {
                    const dur = payload as DurationEntryPayload;
                    totalDurationSeconds += dur.seconds;
                } else if (payload.kind === 'distance' || payload.kind === 'sprint') {
                    const dist = payload as DistanceEntryPayload;
                    totalDistanceMeters += dist.meters;
                }
            }

            const stepTitle = step.title || (step.exerciseRef?.kind === 'catalog' ? step.exerciseRef.exerciseId : (step.exerciseRef?.kind === 'unresolved_free_text' ? step.exerciseRef.name : step.id));

            stepComparisons.push({
                stepId: step.id,
                blockId: block.id,
                stepTitle,
                isOptional,
                targetSets,
                completedSets,
                isComplete,
                entries: stepEntries,
            });
        }
    }

    return {
        definitionId: definition.id,
        revision: definition.revision,
        title: definition.title,
        totalPlannedSteps,
        completedStepsCount,
        missingRequiredStepsCount,
        stepComparisons,
        summary: {
            totalReps,
            totalTonnageKg,
            totalDurationSeconds,
            totalDistanceMeters,
        },
    };
}
