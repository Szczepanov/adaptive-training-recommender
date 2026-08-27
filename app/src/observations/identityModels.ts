/**
 * Physiological Identity Passport & Measurement Trust contracts (PI1, ADR-0028).
 *
 * Provider-neutral identity-attribution and observation-eligibility contracts at the
 * observation/engine boundary, sitting between source-aware immutable observation bundles
 * (ADR-0027, ./models.ts) and downstream physiological baseline/fusion logic.
 *
 * These types and this file are the single canonical schema for identity records: the source
 * analysis, ADR-0028, the implementation plan, and every persisted-document example must match
 * this shape verbatim -- `sourceNightKey` (not `logicalDate`), and `IdentityReviewEvent` including
 * `schemaVersion` and `supersedesReviewEventId: string | null`.
 *
 * Contract rules (ADR-0028 P-PI-1..P-PI-17):
 * - identity is assigned at shared-source night/session level, not per metric;
 * - metric technical quality remains independent of identity attribution;
 * - `NOT_USER` is not synonymous with sensor error;
 * - `UNCERTAIN` is not synonymous with missing data;
 * - `identityScore` is an evidence/ranking score and must never be named `probability`;
 * - baseline/fusion code must consume `EffectiveIdentityDecision`, never raw automatic status alone;
 * - repeated user corrections are append-only; effective state is a deterministic derived projection;
 * - `passportVersion=null` is valid when assessment abstains because no mature passport exists.
 */

export type IdentityStatus = 'USER' | 'NOT_USER' | 'UNCERTAIN';
export type IdentityConfidenceTier = 'HIGH' | 'MODERATE' | 'LOW' | 'NONE';

export type IdentityReasonCode =
    | 'ANCHOR_MISSING'
    | 'ANCHOR_QUALITY_INSUFFICIENT'
    | 'EVIDENCE_LINEAGE_DEPENDENT'
    | 'INSUFFICIENT_PASSPORT_HISTORY'
    | 'MULTIPLE_PAIRING_CANDIDATES'
    | 'SESSION_TIMING_CONCORDANT'
    | 'SESSION_TIMING_DISCORDANT'
    | 'RHR_RELATION_CONCORDANT'
    | 'RHR_RELATION_DISCORDANT'
    | 'RESPIRATION_RELATION_CONCORDANT'
    | 'RESPIRATION_RELATION_DISCORDANT'
    | 'HRV_RELATION_CONCORDANT'
    | 'HRV_RELATION_DISCORDANT'
    | 'MIXED_OCCUPANCY_SUSPECTED'
    | 'SESSION_INTERVAL_INVALID';

/**
 * Stable, versioned registry of every valid `IdentityReasonCode`. Bump
 * `IDENTITY_REASON_CODE_SCHEMA_VERSION` whenever a code is added, removed, or its meaning changes
 * in a way that would invalidate historical replay comparisons (see PI1 tests: "reason codes are
 * stable/versioned").
 */
export const IDENTITY_REASON_CODE_SCHEMA_VERSION = 'identity-reason-codes-v1';

export const IDENTITY_REASON_CODES: readonly IdentityReasonCode[] = Object.freeze([
    'ANCHOR_MISSING',
    'ANCHOR_QUALITY_INSUFFICIENT',
    'EVIDENCE_LINEAGE_DEPENDENT',
    'INSUFFICIENT_PASSPORT_HISTORY',
    'MULTIPLE_PAIRING_CANDIDATES',
    'SESSION_TIMING_CONCORDANT',
    'SESSION_TIMING_DISCORDANT',
    'RHR_RELATION_CONCORDANT',
    'RHR_RELATION_DISCORDANT',
    'RESPIRATION_RELATION_CONCORDANT',
    'RESPIRATION_RELATION_DISCORDANT',
    'HRV_RELATION_CONCORDANT',
    'HRV_RELATION_DISCORDANT',
    'MIXED_OCCUPANCY_SUSPECTED',
    'SESSION_INTERVAL_INVALID',
]);

export function isKnownIdentityReasonCode(code: string): code is IdentityReasonCode {
    return (IDENTITY_REASON_CODES as readonly string[]).includes(code);
}

export interface ObservationBundleRef {
    id: string;
    provider: string;
    transport: string;
    revision: number;
    sourcePayloadHash: string;
    lineageKey: string;
}

export interface ObservationEligibility {
    display: boolean;
    recovery: boolean;
    baselineLearning: boolean;
    passportLearning: boolean;
}

export interface AutomaticIdentityAssessment {
    id: string;
    sourceNightKey: string;
    sharedSource: { provider: string; transport: string };
    automaticStatus: IdentityStatus;
    identityScore: number | null; // evidence score, not calibrated probability
    confidenceTier: IdentityConfidenceTier;
    reasonCodes: readonly IdentityReasonCode[];
    passportVersion: string | null; // null before a usable passport exists
    policyVersion: string;
    featureSchemaVersion: string;
    assessedAt: string;
    sharedBundleRef: ObservationBundleRef;
    anchorBundleRefs: readonly ObservationBundleRef[];
}

export type OccupancyAttestation = 'EXCLUSIVE' | 'MIXED' | 'UNKNOWN';

export interface IdentityReviewEvent {
    id: string;
    assessmentId: string;
    schemaVersion: number;
    label: IdentityStatus;
    occupancyAttestation: OccupancyAttestation;
    supersedesReviewEventId: string | null; // Firestore has no `undefined`; absence of a prior event is explicit `null`
    recordedAt: string; // server-authoritative ordering
    source: 'user_ui' | 'admin_replay';
}

export interface EffectiveIdentityDecision {
    assessmentId: string;
    effectiveStatus: IdentityStatus;
    eligibility: ObservationEligibility;
    authority: 'AUTOMATIC' | 'MANUAL_REVIEW';
    reviewEventId?: string;
}

/**
 * Automatic assessment must remain replay-immutable. Freezes the top-level object and every
 * nested array/object reachable from it so a later review event cannot accidentally mutate
 * historical model output in place (ADR-0028 P-PI-14).
 */
export function freezeAutomaticIdentityAssessment(
    assessment: AutomaticIdentityAssessment,
): Readonly<AutomaticIdentityAssessment> {
    Object.freeze(assessment.reasonCodes);
    Object.freeze(assessment.sharedBundleRef);
    for (const ref of assessment.anchorBundleRefs) {
        Object.freeze(ref);
    }
    Object.freeze(assessment.anchorBundleRefs);
    return Object.freeze(assessment);
}

function compareReviewEventsByRecencyDesc(a: IdentityReviewEvent, b: IdentityReviewEvent): number {
    if (a.recordedAt !== b.recordedAt) {
        return a.recordedAt < b.recordedAt ? 1 : -1;
    }
    // Deterministic tie-break when `recordedAt` collides (defensive; server ordering should
    // normally avoid this).
    return a.id < b.id ? 1 : -1;
}

/**
 * Resolves the single currently-effective review event out of an append-only chain, following
 * `supersedesReviewEventId` links. An event is a "head" (current) when no other event in the
 * chain supersedes it. Returns `null` when no review events exist yet.
 */
export function findEffectiveReviewEvent(
    reviewEvents: readonly IdentityReviewEvent[],
): IdentityReviewEvent | null {
    if (reviewEvents.length === 0) {
        return null;
    }

    const supersededIds = new Set<string>();
    for (const event of reviewEvents) {
        if (event.supersedesReviewEventId) {
            supersededIds.add(event.supersedesReviewEventId);
        }
    }

    const heads = reviewEvents.filter((event) => !supersededIds.has(event.id));
    const candidates = heads.length > 0 ? heads : reviewEvents; // defensive fallback for a malformed/cyclic chain
    return [...candidates].sort(compareReviewEventsByRecencyDesc)[0] ?? null;
}

/**
 * Automatic USER/NOT_USER/UNCERTAIN eligibility mapping (ADR-0028 P-PI-3, P-PI-4, P-PI-10, P-PI-15).
 *
 * - Only `USER` can ever be recovery/baseline/passport-learning eligible.
 * - Suspected mixed occupancy quarantines the full nightly aggregate; only an explicit
 *   `EXCLUSIVE` attestation can lift that quarantine for an effective `USER` decision.
 * - Raw observations are always `display`-eligible: identity uncertainty/negativity never deletes
 *   or hides preserved history (P-PI-5).
 */
export function deriveObservationEligibility(
    effectiveStatus: IdentityStatus,
    occupancyAttestation: OccupancyAttestation,
    mixedOccupancySuspected: boolean,
): ObservationEligibility {
    if (effectiveStatus !== 'USER') {
        return { display: true, recovery: false, baselineLearning: false, passportLearning: false };
    }

    if (mixedOccupancySuspected && occupancyAttestation !== 'EXCLUSIVE') {
        return { display: true, recovery: false, baselineLearning: false, passportLearning: false };
    }

    return { display: true, recovery: true, baselineLearning: true, passportLearning: true };
}

/**
 * Derives the current effective identity decision from an immutable automatic assessment plus its
 * append-only review-event history. Never mutates `assessment` or any `reviewEvents` entry.
 */
export function deriveEffectiveIdentityDecision(
    assessment: AutomaticIdentityAssessment,
    reviewEvents: readonly IdentityReviewEvent[],
): EffectiveIdentityDecision {
    const scopedEvents = reviewEvents.filter((event) => event.assessmentId === assessment.id);
    const currentEvent = findEffectiveReviewEvent(scopedEvents);

    const effectiveStatus: IdentityStatus = currentEvent ? currentEvent.label : assessment.automaticStatus;
    const occupancyAttestation: OccupancyAttestation = currentEvent
        ? currentEvent.occupancyAttestation
        : 'UNKNOWN';
    const mixedOccupancySuspected =
        assessment.reasonCodes.includes('MIXED_OCCUPANCY_SUSPECTED') || occupancyAttestation === 'MIXED';

    return {
        assessmentId: assessment.id,
        effectiveStatus,
        eligibility: deriveObservationEligibility(effectiveStatus, occupancyAttestation, mixedOccupancySuspected),
        authority: currentEvent ? 'MANUAL_REVIEW' : 'AUTOMATIC',
        ...(currentEvent ? { reviewEventId: currentEvent.id } : {}),
    };
}
