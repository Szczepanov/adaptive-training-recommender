import type { ProposedProgressionChange } from '../engine/progressionReview';

function hex(bytes: ArrayBuffer): string {
    return Array.from(new Uint8Array(bytes)).map(byte => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Content-addressed logical identity for one reviewed bounded progression change.
 *
 * The canonical payload includes every semantic field in `ProposedProgressionChange`, plus
 * the source block revision and review evidence-as-of date. That prevents two different
 * target bindings or before/after payloads from aliasing the same idempotency key while
 * keeping the Firestore id bounded to 64 hex characters.
 *
 * It is intentionally NOT a full review-evidence hash: a same-day review rerun against the
 * same source revision that produces the same proposed change still has the same id. The
 * remaining immutable D-REPLAY evidence-snapshot gap is documented in
 * `docs/plans/h5c-pr517-review-hardening.md`.
 */
export async function deriveProgressionProposalId(
    sourceBlockRevision: number,
    reviewAsOfDate: string,
    change: ProposedProgressionChange,
): Promise<string> {
    const canonical = JSON.stringify({
        sourceBlockRevision,
        reviewAsOfDate,
        targetBinding: {
            objectiveId: change.targetBinding.objectiveId,
            sessionId: change.targetBinding.sessionId ?? null,
            stepId: change.targetBinding.stepId ?? null,
        },
        variable: change.variable,
        unit: change.unit,
        previousValue: change.previousValue,
        proposedValue: change.proposedValue,
        derivedDoseEffects: { delta: change.derivedDoseEffects.delta },
    });
    return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical)));
}
