/**
 * Suspicious-night review UI logic (PI7, ADR-0028).
 *
 * Pure selection/copy/mapping functions consumed by `IdentityReviewCard`. Kept separate from the
 * component so the "which night, which copy, which review-event fields" decisions are unit
 * tested without React or Firestore.
 *
 * "Only interrupt the user when action can change data authority" (PI7): a night is a review
 * candidate only when the automatic evaluator actually abstained *because of* comparable evidence
 * -- a discordant relation, a suspected mixed occupancy, or a missing/ineligible anchor -- never
 * merely because the passport is still immature or pairing was ambiguous, where there is nothing
 * concrete for the user to confirm or deny.
 */

import type {
    AutomaticIdentityAssessment,
    IdentityReasonCode,
    IdentityStatus,
    OccupancyAttestation,
} from '../observations/identityModels';
import type { EffectiveBundleIdentityProjection } from './identityEligibility';

/** Reason codes that make a night worth asking the user about (PI7 copy table). */
const REVIEW_TRIGGER_REASON_CODES: readonly IdentityReasonCode[] = [
    'ANCHOR_MISSING',
    'ANCHOR_QUALITY_INSUFFICIENT',
    'SESSION_TIMING_DISCORDANT',
    'RHR_RELATION_DISCORDANT',
    'RESPIRATION_RELATION_DISCORDANT',
    'HRV_RELATION_DISCORDANT',
    'MIXED_OCCUPANCY_SUSPECTED',
];

export type IdentityReviewCopyVariant = 'ANCHOR_MISSING' | 'ANCHOR_QUALITY_INSUFFICIENT' | 'DEFAULT';

/**
 * A night is a suspicious-night review candidate only when the *automatic* evaluator abstained
 * (never for an already-effective `NOT_USER`/`USER` decision reached through manual review -- that
 * question has already been asked and answered) and did so for one of the trigger reasons above.
 */
export function needsSuspiciousNightReview(assessment: AutomaticIdentityAssessment): boolean {
    return (
        assessment.automaticStatus === 'UNCERTAIN' &&
        assessment.reasonCodes.some((code) => REVIEW_TRIGGER_REASON_CODES.includes(code))
    );
}

/**
 * Selects the copy variant by the assessment's *leading* reason code. `reasonCodes` is always
 * produced in the stable `IDENTITY_REASON_CODES` schema order (see `identityAttribution.ts`'s
 * `uniqueReasons`), so checking membership in priority order reproduces "leading reason code"
 * without re-deriving that ordering here.
 */
export function identityReviewCopyVariant(
    reasonCodes: readonly IdentityReasonCode[],
): IdentityReviewCopyVariant {
    if (reasonCodes.includes('ANCHOR_MISSING')) return 'ANCHOR_MISSING';
    if (reasonCodes.includes('ANCHOR_QUALITY_INSUFFICIENT')) return 'ANCHOR_QUALITY_INSUFFICIENT';
    return 'DEFAULT';
}

/**
 * Selects the single most recent suspicious night worth surfacing, if any. Mirrors the existing
 * HA6 "one card, most recent candidate" pattern rather than an open-ended review inbox.
 *
 * `needsSuspiciousNightReview` alone is not enough here: it only inspects the immutable
 * automatic assessment, which never changes once a review event exists. A night that already has
 * an effective manual review (`decision.authority === 'MANUAL_REVIEW'`) must not be re-selected --
 * that question has already been asked and answered (see `needsSuspiciousNightReview`'s doc
 * comment) -- regardless of what its frozen `automaticStatus`/`reasonCodes` still say.
 */
export function selectMostRecentSuspiciousNightForReview(
    projections: readonly EffectiveBundleIdentityProjection[],
): EffectiveBundleIdentityProjection | null {
    const candidates = projections.filter(
        (p) => p.decision.authority === 'AUTOMATIC' && needsSuspiciousNightReview(p.assessment),
    );
    if (candidates.length === 0) return null;
    return candidates.reduce((latest, candidate) =>
        candidate.assessment.sourceNightKey > latest.assessment.sourceNightKey ? candidate : latest,
    );
}

export type IdentityReviewButtonChoice = 'ONLY_ME' | 'SHARED_MIXED' | 'NOT_ME' | 'UNSURE';

export interface IdentityReviewEventFields {
    label: IdentityStatus;
    occupancyAttestation: OccupancyAttestation;
}

/**
 * Maps each PI7 review button to the exact `(label, occupancyAttestation)` pair the plan
 * specifies. Every choice, including "Unsure", produces a review event -- "do not force a label"
 * (PI7) means the *label* stays `UNCERTAIN`/`UNKNOWN`, not that nothing is recorded; a durable
 * event is what stops the same night from re-prompting on every later visit.
 */
export function identityReviewEventFields(choice: IdentityReviewButtonChoice): IdentityReviewEventFields {
    switch (choice) {
        case 'ONLY_ME':
            return { label: 'USER', occupancyAttestation: 'EXCLUSIVE' };
        case 'SHARED_MIXED':
            return { label: 'UNCERTAIN', occupancyAttestation: 'MIXED' };
        case 'NOT_ME':
            return { label: 'NOT_USER', occupancyAttestation: 'UNKNOWN' };
        case 'UNSURE':
            return { label: 'UNCERTAIN', occupancyAttestation: 'UNKNOWN' };
        default: {
            const exhaustive: never = choice;
            throw new Error(`Unhandled identity review choice: ${String(exhaustive)}`);
        }
    }
}
