/**
 * Orchestration entry points for PR 1 shadow reconciliation. Callers (see
 * `training-occurrence/index.ts` and the hooks it wires into) never see Firestore
 * details -- they hand this module a `SessionExecution` or `NormalizedGarminActivity` and
 * get back a typed result. Every entry point is safe to call repeatedly for the same
 * source (idempotent) and safe to call concurrently (the repository's transactional
 * claim primitive is what actually guarantees that; this module just orchestrates it).
 */
import type { NormalizedGarminActivity } from '../engine/models';
import { normalizedGarminModality } from '../sessions/occurrenceReconciliation';
import type { SessionExecution } from '../sessions/models';
import { activityService } from '../services/activityService';
import { sessionExecutionService } from '../services/sessionExecutionService';
import { addDaysToLocalDateString } from '../utils/localDate';
import { filterCandidates } from './reconciliationCandidates';
import { orderOccurrencesForMerge } from './mergeIdentity';
import { RECONCILIATION_MATCHER_VERSION, RECONCILIATION_POLICY_VERSION } from './models';
import type { PerformedTrainingOccurrence, ReconciliationSourceFacts } from './models';
import { decideReconciliation, type ScoredCandidate } from './reconciliationPolicy';
import { recordShadowReconciliationEvent } from './metrics';
import { performedTrainingOccurrenceRepository as repository, SourceLinkConflictError } from './repository';
import { scoreCandidate } from './reconciliationScore';
import { sourceKeyForRef } from './sourceIdentity';

export type ReconciliationOutcome =
    | 'created_single_source'
    | 'attached_auto_link'
    | 'ambiguous'
    | 'already_linked'
    | 'error';

export interface ReconciliationResult {
    outcome: ReconciliationOutcome;
    occurrence?: PerformedTrainingOccurrence;
    error?: unknown;
}

export function structuredExecutionToFacts(
    execution: Pick<SessionExecution, 'executionId' | 'occurrenceId' | 'prescriptionHash' | 'date' | 'startedAt' | 'completedAt'>,
    modality?: string,
): ReconciliationSourceFacts {
    const durationMin = execution.completedAt
        ? Math.max(0, Math.round((Date.parse(execution.completedAt) - Date.parse(execution.startedAt)) / 60000))
        : null;
    return {
        sourceRef: {
            kind: 'structured_execution',
            executionId: execution.executionId,
            ...(execution.occurrenceId ? { sessionOccurrenceId: execution.occurrenceId } : {}),
            ...(execution.prescriptionHash ? { prescriptionHash: execution.prescriptionHash } : {}),
        },
        localDate: execution.date,
        startedAt: execution.startedAt,
        ...(execution.completedAt ? { endedAt: execution.completedAt } : {}),
        durationMin,
        ...(modality ? { modality } : {}),
        ...(execution.prescriptionHash ? { prescriptionHash: execution.prescriptionHash } : {}),
    };
}

export function garminActivityToFacts(activity: NormalizedGarminActivity, provider = 'garmin'): ReconciliationSourceFacts {
    const modality = normalizedGarminModality(activity.type);
    return {
        sourceRef: { kind: 'provider_activity', provider, activityId: activity.activityId },
        localDate: activity.date,
        ...(activity.startedAt ? { startedAt: activity.startedAt } : {}),
        ...(activity.endedAt ? { endedAt: activity.endedAt } : {}),
        durationMin: activity.durationMin,
        ...(modality ? { modality } : {}),
    };
}

async function candidatesFor(userId: string, facts: ReconciliationSourceFacts): Promise<ScoredCandidate[]> {
    const windowStart = addDaysToLocalDateString(facts.localDate, -1);
    const windowEnd = addDaysToLocalDateString(facts.localDate, 1);
    const pool = await repository.queryActiveInDateWindow(userId, windowStart, windowEnd);
    return filterCandidates(facts, pool).map(occurrence => ({ occurrence, score: scoreCandidate(facts, occurrence) }));
}

/**
 * Reconciles one source (structured completion or Garmin activity) against currently
 * active occurrences in a +-1 local-day window. Candidate generation/scoring always run
 * before any write: an `auto_link` decision attaches directly to the winning candidate
 * (no throwaway standalone occurrence is ever created first), and only `ambiguous`/
 * `no_match` fall through to `createOrGetForSource`.
 */
export async function reconcileSourceFacts(userId: string, facts: ReconciliationSourceFacts): Promise<ReconciliationResult> {
    try {
        const sourceKey = sourceKeyForRef(facts.sourceRef);
        const existing = await repository.getBySourceKey(userId, sourceKey);
        if (existing) return { outcome: 'already_linked', occurrence: existing };

        const scored = await candidatesFor(userId, facts);
        const decision = decideReconciliation(scored);

        if (decision.outcome === 'auto_link') {
            const target = decision.candidate.occurrence;
            try {
                const attached = await repository.attachSource(userId, target.performedOccurrenceId, facts, {
                    state: 'matched',
                    matcherVersion: RECONCILIATION_MATCHER_VERSION,
                    policyVersion: RECONCILIATION_POLICY_VERSION,
                    confidence: decision.candidate.score.confidence,
                    features: decision.candidate.score.features,
                    linkedAt: new Date().toISOString(),
                });
                recordShadowReconciliationEvent({
                    type: 'training_occurrence.matched',
                    userId,
                    performedOccurrenceId: attached.performedOccurrenceId,
                    matcherVersion: RECONCILIATION_MATCHER_VERSION,
                    policyVersion: RECONCILIATION_POLICY_VERSION,
                    confidence: decision.candidate.score.confidence,
                });
                return { outcome: 'attached_auto_link', occurrence: attached };
            } catch (err) {
                if (err instanceof SourceLinkConflictError) {
                    // A concurrent caller claimed this exact source between our candidate
                    // read and this attach -- converge onto whatever now legitimately
                    // owns it rather than creating a duplicate or surfacing an error for
                    // what is actually a successfully-idempotent outcome.
                    recordShadowReconciliationEvent({ type: 'training_occurrence.source_link_conflict', userId, message: err.message });
                    const resolved = await repository.getBySourceKey(userId, sourceKey);
                    if (resolved) return { outcome: 'already_linked', occurrence: resolved };
                }
                throw err;
            }
        }

        const initialReconciliation = decision.outcome === 'ambiguous'
            ? {
                state: 'ambiguous' as const,
                matcherVersion: RECONCILIATION_MATCHER_VERSION,
                policyVersion: RECONCILIATION_POLICY_VERSION,
            }
            : { state: 'single_source' as const };
        const { occurrence, created } = await repository.createOrGetForSource(userId, facts, initialReconciliation);

        // Another caller may have claimed this source after our first read but before the
        // transactional create. In that race, the repository returns the already-owned
        // canonical occurrence and we must report convergence, not our now-stale local
        // ambiguity/no-match decision.
        if (!created) return { outcome: 'already_linked', occurrence };

        if (decision.outcome === 'ambiguous') {
            recordShadowReconciliationEvent({
                type: 'training_occurrence.ambiguous',
                userId,
                performedOccurrenceId: occurrence.performedOccurrenceId,
                competingCandidateCount: decision.candidates.length,
            });
            return { outcome: 'ambiguous', occurrence };
        }
        recordShadowReconciliationEvent({ type: 'training_occurrence.single_source', userId, performedOccurrenceId: occurrence.performedOccurrenceId });
        return { outcome: 'created_single_source', occurrence };
    } catch (error) {
        recordShadowReconciliationEvent({ type: 'training_occurrence.reconciliation_error', userId, message: error instanceof Error ? error.message : String(error) });
        return { outcome: 'error', error };
    }
}

export function reconcileStructuredCompletion(
    userId: string,
    execution: Pick<SessionExecution, 'executionId' | 'occurrenceId' | 'prescriptionHash' | 'date' | 'startedAt' | 'completedAt'>,
    modality?: string,
): Promise<ReconciliationResult> {
    return reconcileSourceFacts(userId, structuredExecutionToFacts(execution, modality));
}

export function reconcileGarminActivity(userId: string, activity: NormalizedGarminActivity): Promise<ReconciliationResult> {
    return reconcileSourceFacts(userId, garminActivityToFacts(activity));
}

/**
 * Self-healing de-duplication pass for the transient case ADR-0034 explicitly
 * anticipates ("If two canonical records already exist when a later reconciliation
 * discovers they are the same workout"): true concurrent first-arrival of a structured
 * completion and a Garmin activity can each independently create their own single-source
 * occurrence before either observes the other. This scans one window's active,
 * single-source occurrences for opposite-kind pairs that now clear the auto-link
 * threshold and merges them -- survivor chosen deterministically (earlier `createdAt`,
 * tie-broken by ID) so repeated sweeps are idempotent.
 */
async function mergeDuplicatesInWindow(userId: string, fromDateInclusive: string, toDateInclusive: string): Promise<void> {
    const pool = await repository.queryActiveInDateWindow(userId, fromDateInclusive, toDateInclusive);
    // Ambiguity is durable state. Do not feed an occurrence policy has explicitly marked
    // ambiguous back into automatic merge repair; only genuinely unresolved single-source
    // records are eligible for this convergence sweep.
    const singleSource = pool.filter(occurrence => occurrence.reconciliation.state === 'single_source');
    const merged = new Set<string>();

    for (const occurrence of singleSource) {
        if (merged.has(occurrence.performedOccurrenceId)) continue;
        const facts: ReconciliationSourceFacts | undefined = occurrence.sourceRefs[0] && {
            sourceRef: occurrence.sourceRefs[0],
            localDate: occurrence.localDate ?? fromDateInclusive,
            startedAt: occurrence.startedAt,
            endedAt: occurrence.endedAt,
            durationMin: occurrence.startedAt && occurrence.endedAt
                ? Math.round((Date.parse(occurrence.endedAt) - Date.parse(occurrence.startedAt)) / 60000)
                : null,
            modality: occurrence.modality,
        };
        if (!facts) continue;

        const opposingPool = singleSource.filter(other => other.performedOccurrenceId !== occurrence.performedOccurrenceId && !merged.has(other.performedOccurrenceId));
        const scored: ScoredCandidate[] = filterCandidates(facts, opposingPool).map(candidateOccurrence => ({
            occurrence: candidateOccurrence,
            score: scoreCandidate(facts, candidateOccurrence),
        }));
        const decision = decideReconciliation(scored);
        if (decision.outcome !== 'auto_link') continue;

        const other = decision.candidate.occurrence;
        const [survivor, loser] = orderOccurrencesForMerge(occurrence, other);
        try {
            await repository.mergeOccurrences(userId, survivor.performedOccurrenceId, loser.performedOccurrenceId, {
                state: 'matched',
                matcherVersion: RECONCILIATION_MATCHER_VERSION,
                policyVersion: RECONCILIATION_POLICY_VERSION,
                confidence: decision.candidate.score.confidence,
                features: decision.candidate.score.features,
                linkedAt: new Date().toISOString(),
            });
            recordShadowReconciliationEvent({
                type: 'training_occurrence.merge_tombstone_created',
                userId,
                performedOccurrenceId: survivor.performedOccurrenceId,
                confidence: decision.candidate.score.confidence,
            });
            merged.add(survivor.performedOccurrenceId);
            merged.add(loser.performedOccurrenceId);
        } catch (error) {
            recordShadowReconciliationEvent({ type: 'training_occurrence.reconciliation_error', userId, message: error instanceof Error ? error.message : String(error) });
        }
    }
}

export interface SweepSummary {
    executionsProcessed: number;
    activitiesProcessed: number;
}

/**
 * Bounded date-range sweep -- the entry point used when a specific source ID isn't known
 * (the Garmin-sync-completed hooks), and generally for repair/backfill. Skips any source
 * that already has a source link (cheap `getBySourceKey` short-circuit inside
 * `reconcileSourceFacts`) so re-running the sweep over the same window is cheap and safe.
 */
export async function reconcileDateRangeForUser(
    userId: string,
    fromDateInclusive: string,
    toDateExclusive: string,
): Promise<SweepSummary> {
    const toDateInclusive = addDaysToLocalDateString(toDateExclusive, -1);
    const [{ executions }, activitiesState] = await Promise.all([
        sessionExecutionService.getExecutionsInRange(userId, fromDateInclusive, toDateExclusive),
        activityService.getActivitiesInRange(userId, fromDateInclusive, toDateExclusive),
    ]);

    for (const { execution } of executions) {
        if (execution.state !== 'completed') continue;
        await reconcileSourceFacts(userId, structuredExecutionToFacts(execution));
    }

    const activities = activitiesState.status === 'AVAILABLE' ? activitiesState.data : [];
    for (const activity of activities) {
        await reconcileSourceFacts(userId, garminActivityToFacts(activity));
    }

    await mergeDuplicatesInWindow(userId, fromDateInclusive, toDateInclusive);

    return { executionsProcessed: executions.length, activitiesProcessed: activities.length };
}
