/**
 * Dual-read diagnostics (ADR-0034 Stage 2 "construct the new completed-workout DTO in
 * parallel; compare row counts, duplicates, source coverage"). Suggested metric names
 * from the ADR (`activity_read.shadow.row_count_delta`, `activity_read.shadow.duplicate_delta`)
 * are logged via the same `[training_occurrence]` console convention `metrics.ts`
 * established for PR 1, since this repository has no real metrics backend.
 */
import type { NormalizedGarminActivity } from '../engine/models';
import type { CompletedWorkoutView } from './completedWorkoutView';

export interface ActivitiesReadModelComparison {
    currentRowCount: number;
    canonicalRowCount: number;
    rowCountDelta: number;
    /** How many raw Garmin rows collapsed into fewer canonical rows because they were
     * matched to a structured source (or another provider activity). Zero means the
     * canonical view found nothing to deduplicate relative to the raw view. */
    duplicateDelta: number;
    garminOnlyCount: number;
    structuredOnlyCount: number;
    matchedCount: number;
    ambiguousCount: number;
}

export function compareActivitiesReadModels(
    currentActivities: readonly NormalizedGarminActivity[],
    canonicalWorkouts: readonly CompletedWorkoutView[],
): ActivitiesReadModelComparison {
    const garminOnlyCount = canonicalWorkouts.filter(w => w.sourceBadge.hasProvider && !w.sourceBadge.hasStructured).length;
    const structuredOnlyCount = canonicalWorkouts.filter(w => w.sourceBadge.hasStructured && !w.sourceBadge.hasProvider).length;
    const matchedCount = canonicalWorkouts.filter(w => w.sourceBadge.hasProvider && w.sourceBadge.hasStructured).length;
    const ambiguousCount = canonicalWorkouts.filter(w => w.reconciliation.state === 'ambiguous').length;

    // Counting garminOnlyCount + matchedCount against currentActivities.length assumes
    // every canonical row's Garmin source is one of currentActivities -- false for a row
    // hydrated from an adjacent local day (its Garmin activity.date can fall outside this
    // exact range) and for a generic non-Garmin `sourceBadge.hasProvider` row. Derive the
    // count from hydrated Garmin activity IDs that actually appear in currentActivities.
    const currentActivityIds = new Set(currentActivities.map(activity => activity.activityId));
    const canonicalActivityIdsInRange = new Set(
        canonicalWorkouts
            .map(workout => workout.garmin?.activityId)
            .filter((id): id is string => id !== undefined && currentActivityIds.has(id)),
    );

    return {
        currentRowCount: currentActivities.length,
        canonicalRowCount: canonicalWorkouts.length,
        rowCountDelta: canonicalWorkouts.length - currentActivities.length,
        duplicateDelta: currentActivities.length - canonicalActivityIdsInRange.size,
        garminOnlyCount,
        structuredOnlyCount,
        matchedCount,
        ambiguousCount,
    };
}

// DataView still has a defensive best-effort comparison at the UI boundary. The service
// now records the authoritative comparison once both inputs are known, so the two calls can
// legitimately arrive back-to-back with the same payload. Coalesce only that very short
// duplicate window; later refreshes still emit even when their aggregate values happen to
// be identical.
const DUPLICATE_LOG_WINDOW_MS = 250;
let lastLogSignature: string | null = null;
let lastLogAtMs = 0;

export function recordActivitiesReadModelComparison(userId: string, comparison: ActivitiesReadModelComparison): void {
    const signature = JSON.stringify([userId, comparison]);
    const now = Date.now();
    if (signature === lastLogSignature && now - lastLogAtMs <= DUPLICATE_LOG_WINDOW_MS) return;
    lastLogSignature = signature;
    lastLogAtMs = now;
    console.info('[training_occurrence] activity_read.shadow', { userId, ...comparison });
}
