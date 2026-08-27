/**
 * Provenance-lineage independence evaluation (PI2, ADR-0028).
 *
 * Before physiological or session-timing features can corroborate identity, confirm that the
 * anchor and shared-source observations are independent at the sensor lineage level:
 *
 *   Garmin Direct observation
 *   + same Garmin observation re-exported through an aggregator
 *   != two independent votes
 *
 * Provider/transport difference is useful provenance (ADR-0027) but is not, by itself, proof of
 * independence -- two `ObservationBundleRef`s that trace back to the same upstream sensor lineage
 * must never be counted as corroborating evidence twice (ADR-0028 P-PI-13). This mirrors the
 * broader provenance principle used in health-data interoperability (HL7 FHIR Provenance):
 * trust/replay requires retaining the entities/processes that produced and transformed a
 * resource, not only its final transport.
 */

import type { IdentityReasonCode, ObservationBundleRef } from '../observations/identityModels';

/**
 * Two bundle refs are lineage-independent when their `lineageKey` values differ. `lineageKey` is
 * expected to identify the ultimate originating sensor/process, not the transport that carried it
 * -- a mirrored/re-exported copy of the same upstream signal must carry the same `lineageKey` as
 * its origin so this comparison catches it regardless of provider/transport labeling.
 */
export function isLineageIndependent(a: ObservationBundleRef, b: ObservationBundleRef): boolean {
    return a.lineageKey !== b.lineageKey;
}

export interface AnchorLineageEvaluation {
    /** Anchor refs whose lineage is independent of the shared-source ref -- usable as corroboration. */
    independentAnchorRefs: readonly ObservationBundleRef[];
    /** Anchor refs excluded because they share lineage with the shared-source ref. */
    dependentAnchorRefs: readonly ObservationBundleRef[];
    reasonCodes: readonly IdentityReasonCode[];
}

/**
 * Filters a set of candidate anchor bundle refs down to those independent of the shared-source
 * ref. When every candidate anchor is lineage-dependent (or none exist), no independent
 * corroboration is available and callers must abstain (`UNCERTAIN`) rather than treat the
 * dependent evidence as confirming.
 */
export function evaluateAnchorLineageIndependence(
    anchorRefs: readonly ObservationBundleRef[],
    sharedRef: ObservationBundleRef,
): AnchorLineageEvaluation {
    const independentAnchorRefs = anchorRefs.filter((ref) => isLineageIndependent(ref, sharedRef));
    const dependentAnchorRefs = anchorRefs.filter((ref) => !isLineageIndependent(ref, sharedRef));

    const reasonCodes: IdentityReasonCode[] =
        dependentAnchorRefs.length > 0 ? ['EVIDENCE_LINEAGE_DEPENDENT'] : [];

    return { independentAnchorRefs, dependentAnchorRefs, reasonCodes };
}

export interface LineageGroup {
    lineageKey: string;
    refs: readonly ObservationBundleRef[];
}

/**
 * Groups a set of bundle refs by `lineageKey`. Useful for detecting mirrored/re-exported
 * duplicates among a wider candidate set (e.g. Garmin Direct plus the same Garmin measurement
 * re-exported via Google Health) before they are used as independent votes.
 */
export function groupByLineage(refs: readonly ObservationBundleRef[]): readonly LineageGroup[] {
    const order: string[] = [];
    const groups = new Map<string, ObservationBundleRef[]>();
    for (const ref of refs) {
        if (!groups.has(ref.lineageKey)) {
            groups.set(ref.lineageKey, []);
            order.push(ref.lineageKey);
        }
        groups.get(ref.lineageKey)!.push(ref);
    }
    return order.map((lineageKey) => ({ lineageKey, refs: groups.get(lineageKey)! }));
}

/**
 * Deterministically selects one representative ref per lineage group (highest `revision`, then
 * lexicographically smallest `id` as a stable tie-break) so a mirrored/re-exported duplicate never
 * contributes a second, independent-looking vote alongside its origin.
 */
export function deduplicateByLineage(
    refs: readonly ObservationBundleRef[],
): readonly ObservationBundleRef[] {
    return groupByLineage(refs).map((group) => {
        const [best] = [...group.refs].sort((a, b) => {
            if (a.revision !== b.revision) {
                return b.revision - a.revision;
            }
            return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
        });
        return best;
    });
}
