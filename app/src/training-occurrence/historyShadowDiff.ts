/**
 * PR 4 (ADR-0034 / docs/plans/training-occurrence-implementation-checklist.md "PR 4 —
 * completed-training history and coach integration", "Shadow calculation first"):
 * compares the LIVE completed-training pipeline's exposure count and evidence-tier
 * distribution against a canonical-occurrence-derived estimate, for the same window.
 * When a caller also supplies semantic canonical `CompletedExposure` rows, the same diff
 * reports load, delivered-dose, stimulus and identity aggregates. No canonical exposure
 * adapter is inferred from the UI DTO: missing derivation remains an explicit null.
 *
 * This module NEVER changes live behavior -- it is not imported by
 * `engine/completedTraining.ts`, `engine/trainingHistorySnapshot.ts`, or any
 * recommendation/coach path. Per ADR-0034's explicit rollout gate, canonical occurrences
 * must not become authoritative for completed-training history until this diff has been
 * reviewed and regressions investigated. Calling this is a diagnostic action a caller
 * opts into (e.g. from a script or an admin tool), not a side effect of normal app usage.
 *
 * `CompletedTrainingEvent.linkedActivityId` (when present -- adherence-only live events
 * have none) enables a real per-activity coverage join against canonical occurrences'
 * `provider_activity` source refs, in addition to the aggregate counts ADR-0034's own
 * suggested metric names (`history_shadow.exposure_count_delta`,
 * `history_shadow.evidence_tier_delta`) ask for. Evidence-tier comparison stays
 * aggregate-only because event-to-tier attribution is not part of the current DTO.
 */
import type { CompletedTrainingEvent, EvidenceTier } from '../engine/models';
import { classifyGarminTier, completedEventToExposure } from '../engine/completedTraining';
import type { CompletedExposure } from '../engine/trainingHistory';
import type { CompletedWorkoutView } from './completedWorkoutView';
import { compareCompletedExposureSets, type ExposureComparison } from './historyCounterfactual';

export type EvidenceTierCounts = Partial<Record<EvidenceTier, number>>;

export interface HistoryShadowDiff {
    liveExposureCount: number;
    canonicalExposureCount: number;
    exposureCountDelta: number;
    liveEvidenceTierCounts: EvidenceTierCounts;
    canonicalEvidenceTierCounts: EvidenceTierCounts;
    /** Occurrences carrying 2+ sources -- the direct evidence for "one physical workout,
     * one exposure": each still contributes exactly one row to `canonicalExposureCount`
     * regardless of how many sources it merged. */
    matchedOccurrenceCount: number;
    /** Ambiguous occurrences are deliberately NOT counted as matched or merged -- they
     * remain separate rows, which is why they can inflate `canonicalExposureCount`
     * relative to a live pipeline that might have merged them heuristically (or missed
     * them). Surfaced so a reviewer can tell an ambiguity-driven delta apart from a real
     * duplicate/gap. */
    ambiguousOccurrenceCount: number;
    /** A live event's `linkedActivityId` that no canonical occurrence in this window
     * attaches as a `provider_activity` source -- a canonical-tracking gap for that
     * specific activity, not just an aggregate count mismatch. */
    liveActivityIdsMissingFromCanonical: string[];
    /** The mirror image: a canonical `provider_activity` source with no live event linked
     * to that activityId at all -- either the live pipeline never picked it up, or it was
     * folded into a matched occurrence's structured side and never needed its own live
     * link (expected and benign for a genuinely matched workout). */
    canonicalActivityIdsMissingFromLive: string[];
    /** null until an evidence adapter can honestly produce broad canonical exposures. */
    broadExposureComparison: ExposureComparison | null;
}

/** Estimates the canonical-side evidence tier for one workout using the exact same
 * classifier the live pipeline uses for Garmin-only evidence. A structured source is
 * always at least `completedStructuredWorkout` -- ADR-0034's "no regression from
 * completedStructuredWorkout to a weaker Garmin-derived evidence tier for matched
 * structured sessions" invariant, applied as the floor for this estimate. This can't
 * distinguish `exactPrescribedMatch` (requires recommendation linkage this DTO doesn't
 * carry) from `completedStructuredWorkout` -- both are already at or above the floor the
 * invariant requires, so collapsing them here doesn't hide a real regression. */
export function estimateCanonicalEvidenceTier(workout: CompletedWorkoutView): EvidenceTier | null {
    if (workout.structured) return 'completedStructuredWorkout';
    if (workout.garmin) {
        return classifyGarminTier({
            trainingEffectAerobic: workout.garmin.trainingEffectAerobic,
            trainingEffectAnaerobic: workout.garmin.trainingEffectAnaerobic,
            intensityTag: workout.garmin.intensityTag,
            activityTrainingLoad: workout.garmin.activityTrainingLoad,
            modalityKnown: workout.modality !== undefined,
        });
    }
    return null;
}

function tallyTiers(tiers: readonly (EvidenceTier | null | undefined)[]): EvidenceTierCounts {
    const counts: EvidenceTierCounts = {};
    for (const tier of tiers) {
        if (!tier) continue;
        counts[tier] = (counts[tier] ?? 0) + 1;
    }
    return counts;
}

export function diffCompletedTrainingHistory(
    liveEvents: readonly CompletedTrainingEvent[],
    canonicalWorkouts: readonly CompletedWorkoutView[],
    options: {
        canonicalExposures?: readonly CompletedExposure[];
        unknownCanonicalOccurrenceKeys?: readonly string[];
        /** Opaque, same-occurrence aliases prepared without exposing source IDs in reports. */
        liveOccurrenceKeysByEventId?: ReadonlyMap<string, string>;
    } = {},
): HistoryShadowDiff {
    const canonicalExposureCount = canonicalWorkouts.length;
    const matchedOccurrenceCount = canonicalWorkouts.filter(w => w.sourceBadge.hasStructured && w.sourceBadge.hasProvider).length;
    const ambiguousOccurrenceCount = canonicalWorkouts.filter(w => w.reconciliation.state === 'ambiguous').length;

    // Only the primary provider activity per occurrence is compared -- PR 2's DTO
    // surfaces just one Garmin activity per occurrence by design (ADR-0034 v1 UI
    // allowance), so this join can't yet see a second/duplicate device recording.
    const canonicalActivityIds = new Set(canonicalWorkouts.map(w => w.garmin?.activityId).filter((id): id is string => !!id));
    const liveActivityIds = new Set(liveEvents.map(event => event.linkedActivityId).filter((id): id is string => !!id));

    return {
        liveExposureCount: liveEvents.length,
        canonicalExposureCount,
        exposureCountDelta: canonicalExposureCount - liveEvents.length,
        liveEvidenceTierCounts: tallyTiers(liveEvents.map(event => event.evidenceTier)),
        canonicalEvidenceTierCounts: tallyTiers(canonicalWorkouts.map(estimateCanonicalEvidenceTier)),
        matchedOccurrenceCount,
        ambiguousOccurrenceCount,
        liveActivityIdsMissingFromCanonical: [...liveActivityIds].filter(id => !canonicalActivityIds.has(id)),
        canonicalActivityIdsMissingFromLive: [...canonicalActivityIds].filter(id => !liveActivityIds.has(id)),
        broadExposureComparison: options.canonicalExposures
            ? compareCompletedExposureSets(
                liveEvents.map(event => ({
                    ...completedEventToExposure(event),
                    ...(options.liveOccurrenceKeysByEventId?.get(event.id)
                        ? { occurrenceKey: options.liveOccurrenceKeysByEventId.get(event.id) }
                        : {}),
                })),
                options.canonicalExposures,
                options.unknownCanonicalOccurrenceKeys,
            )
            : null,
    };
}

/** ADR-0034's suggested metric names (`history_shadow.exposure_count_delta`,
 * `history_shadow.evidence_tier_delta`) are logged as one structured line, matching the
 * `[training_occurrence]` console convention `metrics.ts` established -- this is a
 * distinct diagnostic surface from `metrics.ts`'s reconciliation-event counters, not
 * routed through them, since a history diff isn't a reconciliation event. */
export function recordHistoryShadowDiff(userId: string, diff: HistoryShadowDiff): void {
    console.info('[training_occurrence] history_shadow', { userId, ...diff });
}
