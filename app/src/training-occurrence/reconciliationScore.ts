/**
 * Pure candidate scoring (ADR-0034 "Reconciliation evidence contract"). Produces a
 * confidence in [0, 1] plus the feature values that produced it -- both are persisted for
 * every auto-link so a match is auditable/replayable (`docs/plans/training-occurrence-pr1-scope.md`
 * "Persist matcher inputs/features, score, threshold policy, and matcher version").
 *
 * Absolute timestamps are the primary temporal evidence; local date is supporting-only
 * (ADR-0034 "Time semantics"). Whether date-only evidence is even eligible for an
 * auto-link is enforced by `reconciliationPolicy.ts`, not by score magnitude alone -- a
 * score-only guarantee would be one weight-tuning mistake away from violating the
 * "never auto-link on date-only evidence" invariant.
 */
import type { PerformedTrainingOccurrence, ReconciliationSourceFacts } from './models';

export interface ReconciliationFeatures {
    // Named properties plus a compatible index signature so a `ReconciliationFeatures`
    // value can be persisted directly as `ReconciliationProvenance.features`
    // (`Record<string, number | string | boolean | null>`) without a cast at every call
    // site -- every named property below is already a subtype of the index signature.
    [key: string]: number | string | boolean | null;
    explicitCorrelation: boolean;
    hasAbsoluteTimestamps: boolean;
    overlapSeconds: number | null;
    startGapSeconds: number | null;
    durationDiffMin: number | null;
    modalityCompatible: boolean | null;
    sameLocalDate: boolean;
}

export interface ReconciliationScore {
    confidence: number;
    features: ReconciliationFeatures;
}

const TEMPORAL_GAP_DECAY_SECONDS = 4 * 3600;
const DURATION_DECAY_MIN = 60;

function clamp01(value: number): number {
    return Math.max(0, Math.min(1, value));
}

/** `prescriptionHash` is the only explicit-correlation evidence available in PR 1
 * (structured executions carry it; Garmin does not yet carry any Adaptive-issued
 * correlation identity -- see ADR-0034 "Tier 2: structured FIT/workout identity" for the
 * future enhancement). Comparing it against every source ref already attached to the
 * candidate, not just the candidate's own top-level fields, lets a later-arriving
 * structured source correlate even after a Garmin-only occurrence already exists. */
function explicitCorrelationMatches(
    incoming: ReconciliationSourceFacts,
    candidate: PerformedTrainingOccurrence,
): boolean {
    if (!incoming.prescriptionHash) return false;
    return candidate.sourceRefs.some(
        ref => ref.kind === 'structured_execution' && ref.prescriptionHash === incoming.prescriptionHash,
    );
}

function overlapAndGapSeconds(
    incoming: ReconciliationSourceFacts,
    candidate: PerformedTrainingOccurrence,
): { overlapSeconds: number | null; startGapSeconds: number | null } {
    if (!incoming.startedAt || !candidate.startedAt) return { overlapSeconds: null, startGapSeconds: null };
    const incomingStart = Date.parse(incoming.startedAt);
    const candidateStart = Date.parse(candidate.startedAt);
    if (Number.isNaN(incomingStart) || Number.isNaN(candidateStart)) return { overlapSeconds: null, startGapSeconds: null };

    const incomingEnd = incoming.endedAt ? Date.parse(incoming.endedAt) : incomingStart;
    const candidateEnd = candidate.endedAt ? Date.parse(candidate.endedAt) : candidateStart;
    const overlapMs = Math.min(incomingEnd, candidateEnd) - Math.max(incomingStart, candidateStart);

    return {
        overlapSeconds: Math.max(0, Math.round(overlapMs / 1000)),
        startGapSeconds: Math.round(Math.abs(incomingStart - candidateStart) / 1000),
    };
}

function durationDiffMin(incoming: ReconciliationSourceFacts, candidate: PerformedTrainingOccurrence): number | null {
    const candidateDurationMin = candidate.startedAt && candidate.endedAt
        ? (Date.parse(candidate.endedAt) - Date.parse(candidate.startedAt)) / 60000
        : null;
    if (incoming.durationMin === null || candidateDurationMin === null || Number.isNaN(candidateDurationMin)) return null;
    return Math.abs(incoming.durationMin - candidateDurationMin);
}

export function scoreCandidate(
    incoming: ReconciliationSourceFacts,
    candidate: PerformedTrainingOccurrence,
): ReconciliationScore {
    const explicitCorrelation = explicitCorrelationMatches(incoming, candidate);
    const modalityCompatible = incoming.modality && candidate.modality
        ? incoming.modality === candidate.modality
        : null;
    const { overlapSeconds, startGapSeconds } = overlapAndGapSeconds(incoming, candidate);
    const hasAbsoluteTimestamps = overlapSeconds !== null;
    const durationDelta = durationDiffMin(incoming, candidate);
    const sameLocalDate = incoming.localDate === candidate.localDate;

    const features: ReconciliationFeatures = {
        explicitCorrelation,
        hasAbsoluteTimestamps,
        overlapSeconds,
        startGapSeconds,
        durationDiffMin: durationDelta,
        modalityCompatible,
        sameLocalDate,
    };

    if (explicitCorrelation) return { confidence: 1, features };
    // Modality compatibility is required-when-known (ADR-0034): an incompatible pairing
    // is disqualified outright regardless of how strong the other evidence looks.
    if (modalityCompatible === false) return { confidence: 0, features };

    const temporalScore = !hasAbsoluteTimestamps
        ? 0
        : overlapSeconds! > 0
            ? 1
            : clamp01(1 - (startGapSeconds ?? TEMPORAL_GAP_DECAY_SECONDS) / TEMPORAL_GAP_DECAY_SECONDS);
    const durationScore = durationDelta === null ? 0.5 : clamp01(1 - durationDelta / DURATION_DECAY_MIN);
    const dateScore = sameLocalDate ? 1 : 0;
    const modalityScore = modalityCompatible === true ? 1 : 0.5;

    // Two weighting regimes: with absolute timestamps, temporal proximity dominates.
    // Without them, evidence is inherently weaker (duration + supporting date + modality
    // only) and the total is intentionally capped below what the policy's auto-link
    // threshold requires -- see reconciliationPolicy.ts's explicit hasAbsoluteTimestamps
    // gate, which does not rely on this cap alone.
    const confidence = hasAbsoluteTimestamps
        ? clamp01(0.55 * temporalScore + 0.25 * durationScore + 0.1 * dateScore + 0.1 * modalityScore)
        : clamp01(0.5 * durationScore + 0.3 * dateScore + 0.2 * modalityScore) * 0.6;

    return { confidence, features };
}
