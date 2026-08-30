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

/** Compact ADR-0010/ADR-0028 identity evidence retained by a recommendation audit. */
export interface IdentityDecisionProvenance {
    identityAssessmentId: string;
    automaticStatus: IdentityStatus;
    effectiveStatus: IdentityStatus;
    reviewEventId: string | null;
    identityPolicyVersion: string;
    featureSchemaVersion: string;
    passportVersion: string | null;
    sharedBundleRef: ObservationBundleRef;
    anchorBundleRefs: readonly ObservationBundleRef[];
    selectedEffectiveSource: { provider: string; transport: string } | null;
    fallbackReason: IdentityReasonCode | null;
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
    Object.freeze(assessment.sharedSource);
    Object.freeze(assessment.sharedBundleRef);
    for (const ref of assessment.anchorBundleRefs) {
        Object.freeze(ref);
    }
    Object.freeze(assessment.anchorBundleRefs);
    return Object.freeze(assessment);
}

function compareReviewEventsByRecencyDesc(a: IdentityReviewEvent, b: IdentityReviewEvent): number {
    const aTime = Date.parse(a.recordedAt);
    const bTime = Date.parse(b.recordedAt);
    if (aTime !== bTime) {
        return bTime - aTime;
    }
    // Deterministic tie-break when `recordedAt` collides (defensive; server ordering should
    // normally avoid this).
    return a.id < b.id ? 1 : -1;
}

function reviewEventShapeIsValid(event: IdentityReviewEvent): boolean {
    if (event.schemaVersion !== 1 || !event.id || !event.assessmentId) return false;
    if (!Number.isFinite(Date.parse(event.recordedAt))) return false;
    if (event.supersedesReviewEventId === event.id) return false;
    if (event.source !== 'user_ui' && event.source !== 'admin_replay') return false;
    if (event.source === 'admin_replay') return true;
    // Match the client-write Firestore contract. Admin replay may preserve historical combinations
    // that were never available through the user UI, while eligibility still treats identity and
    // occupancy as separate evidence dimensions.
    if (event.label === 'USER') return event.occupancyAttestation === 'EXCLUSIVE';
    if (event.label === 'NOT_USER') return event.occupancyAttestation === 'UNKNOWN';
    return event.occupancyAttestation === 'MIXED' || event.occupancyAttestation === 'UNKNOWN';
}

/**
 * Resolves the single currently-effective review event out of an append-only chain, following
 * `supersedesReviewEventId` links. Only a complete chain rooted at an unsuperseding event is
 * admitted; orphaned, cyclic, duplicate-ID, non-monotonic, or structurally malformed events fail
 * closed and cannot override the automatic assessment. Identity label and occupancy attestation
 * remain separate evidence dimensions in the derived eligibility projection.
 */
export function findEffectiveReviewEvent(
    reviewEvents: readonly IdentityReviewEvent[],
): IdentityReviewEvent | null {
    if (reviewEvents.length === 0) {
        return null;
    }

    const candidates = new Map<string, IdentityReviewEvent>();
    const duplicateIds = new Set<string>();
    for (const event of reviewEvents) {
        if (!reviewEventShapeIsValid(event)) continue;
        if (candidates.has(event.id)) duplicateIds.add(event.id);
        candidates.set(event.id, event);
    }
    for (const duplicateId of duplicateIds) {
        candidates.delete(duplicateId);
    }

    const accepted = new Map<string, IdentityReviewEvent>();
    for (const [id, event] of candidates) {
        if (event.supersedesReviewEventId === null) accepted.set(id, event);
    }

    while (true) {
        let added = false;
        for (const [id, event] of candidates) {
            if (accepted.has(id) || event.supersedesReviewEventId === null) continue;
            const parent = accepted.get(event.supersedesReviewEventId);
            if (!parent) continue;
            if (Date.parse(event.recordedAt) >= Date.parse(parent.recordedAt)) {
                accepted.set(id, event);
                added = true;
            }
        }
        if (!added) break;
    }

    if (accepted.size === 0) return null;
    const supersededIds = new Set<string>();
    for (const event of accepted.values()) {
        if (event.supersedesReviewEventId !== null) supersededIds.add(event.supersedesReviewEventId);
    }
    const heads = [...accepted.values()].filter((event) => !supersededIds.has(event.id));
    return heads.sort(compareReviewEventsByRecencyDesc)[0] ?? null;
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
