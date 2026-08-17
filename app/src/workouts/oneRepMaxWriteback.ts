import type { LoggedExercise, StrengthSession } from '../engine/models';
import type { TargetSource } from './models';
import { estimateOneRepMax, type OneRepMaxEstimate } from './oneRepMax';

/**
 * Write-back ownership for a derived 1RM (S2.2, ADR-0021 D-1RMSRC). `targetSources` exists,
 * in its own words, so a Garmin refresh can never replace a coach target; this module joins
 * that same mechanism as an additional source rather than bypassing it. ADR-0021's own text
 * is exact and is followed literally: "A derived estimate may populate a target whose source
 * is absent or already `derived`. It may never overwrite `manual` or `coach`." Writability
 * turns on the SOURCE alone, not on whether a value already exists -- an existing value with
 * no recorded source is writable, matching the ADR, not protected by an unstated inference
 * about who might have entered it.
 */

export interface OneRepMaxWritebackResult {
    updated: boolean;
    estimatedOneRmKg: number;
    source: TargetSource;
    computedAt?: string;
    /** Present only when `updated` is false -- why the existing value was left alone. */
    reason?: string;
}

/** `existingSource` is the *only* determinant of writability -- not whether a value already
 *  exists, and not how the new estimate compares to it. This is self-calibration, not a
 *  personal-record tracker: a derived value replaces a stale derived one even when the new
 *  estimate is lower (e.g. after a break), because the point is to track current capacity,
 *  not a lifetime peak. An absent source is writable per ADR-0021's literal text, even when
 *  a value is already present under that absent source. */
export function applyOneRepMaxDerivation(
    existingValue: number | undefined,
    existingSource: TargetSource | undefined,
    estimate: OneRepMaxEstimate,
    computedAtIso: string,
): OneRepMaxWritebackResult {
    const isWritable = existingSource === undefined || existingSource === 'derived';
    if (!isWritable) {
        return {
            updated: false,
            // existingSource is defined and protected here, so a defined existingValue is
            // the only reachable case -- a protected source with no recorded value would be
            // a data inconsistency between the two maps, not a state this function invents.
            estimatedOneRmKg: existingValue as number,
            source: existingSource,
            reason: `existing ${existingSource} value is protected and was not overwritten`,
        };
    }
    return { updated: true, estimatedOneRmKg: estimate.estimatedOneRmKg, source: 'derived', computedAt: computedAtIso };
}

export interface OneRepMaxDerivationOutcome {
    exerciseId: string;
    estimate: OneRepMaxEstimate;
    result: OneRepMaxWritebackResult;
}

function findAdmissibleEstimate(exercise: LoggedExercise): OneRepMaxEstimate | null {
    if (exercise.exerciseId === null) return null; // No stable key into estimated1RmKg for a free-text lift.
    return estimateOneRepMax(exercise.sets);
}

/** One outcome per exercise in `session` that produced an admissible estimate (S2.1) --
 *  an exercise with no admissible sets, or no `exerciseId`, contributes nothing rather than
 *  a null-ish entry. Every outcome is included regardless of whether it was actually
 *  written, so a caller (and a test) can see *why* a protected value was left alone. */
export function deriveOneRepMaxUpdatesForSession(
    session: StrengthSession,
    currentEstimated1RmKg: Record<string, number> | undefined,
    currentEstimated1RmSources: Record<string, { source: TargetSource; computedAt?: string }> | undefined,
    computedAtIso: string,
): OneRepMaxDerivationOutcome[] {
    const outcomes: OneRepMaxDerivationOutcome[] = [];
    for (const exercise of session.exercises) {
        const estimate = findAdmissibleEstimate(exercise);
        if (!estimate || exercise.exerciseId === null) continue;
        const result = applyOneRepMaxDerivation(
            currentEstimated1RmKg?.[exercise.exerciseId],
            currentEstimated1RmSources?.[exercise.exerciseId]?.source,
            estimate,
            computedAtIso,
        );
        outcomes.push({ exerciseId: exercise.exerciseId, estimate, result });
    }
    return outcomes;
}
