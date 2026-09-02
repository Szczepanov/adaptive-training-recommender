/**
 * Pure candidate filtering. The repository/service does the actual Firestore read (a
 * `localDate` window query, ADR-0034 "Time semantics" -- date is a search aid only, not
 * match identity) and hands the resulting pool here to narrow it to plausible pairings
 * before scoring.
 */
import type { PerformedTrainingOccurrence, ReconciliationSourceFacts } from './models';
import { sourceKeyForRef } from './sourceIdentity';

/**
 * An occurrence may carry zero-or-more `provider_activity` sources (watch + cycling
 * computer, duplicate provider import, ADR-0034 "Model the source set, not one Garmin
 * slot") but at most one `structured_execution` source. So a structured incoming source
 * is never a candidate match for an occurrence that already has one, while a Garmin
 * incoming source can still be a candidate even when the occurrence already carries
 * another provider activity.
 */
function alreadyHasIncomingKind(occurrence: PerformedTrainingOccurrence, incomingKind: ReconciliationSourceFacts['sourceRef']['kind']): boolean {
    if (incomingKind !== 'structured_execution') return false;
    return occurrence.sourceRefs.some(ref => ref.kind === 'structured_execution');
}

export function filterCandidates(
    incoming: ReconciliationSourceFacts,
    pool: readonly PerformedTrainingOccurrence[],
): PerformedTrainingOccurrence[] {
    const incomingKey = sourceKeyForRef(incoming.sourceRef);
    return pool.filter(occurrence => {
        if (occurrence.status !== 'active') return false;
        if (occurrence.reconciliation.excludedSourceKeys?.includes(incomingKey)) return false;
        if (occurrence.sourceRefs.some(ref => sourceKeyForRef(ref) === incomingKey)) return false;
        if (alreadyHasIncomingKind(occurrence, incoming.sourceRef.kind)) return false;
        return true;
    });
}
