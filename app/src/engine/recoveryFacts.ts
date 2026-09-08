/**
 * Pure recovery fact models and derivation boundaries (ADR-0038 Work Package RP2).
 *
 * Implements historical recovery truth:
 * - Work A: Performed active recovery facts with exact workout identity and qualification authority;
 * - Work B: ADR-0035 authored Rest bridge validated through the existing replay path;
 * - Work C: Generated complete-Rest outcome reconciliation requiring authoritative closure;
 * - Work D: Durable bootstrap epoch resolution and historical recovery snapshot derivation.
 *
 * Fails closed: non-training is never treated as a performed workout, missing telemetry is
 * never interpreted as Rest, and generic modality/category without exact catalog identity
 * never mints recovery credit.
 */

import type { CoverageSetId, PlanPhase } from '../workouts/event-plan';
import {
    isQualifyingRecoveryIdentity,
    resolveRecoveryAuthority,
    type RecoveryAuthorityResolution,
} from './recoveryPlacement';
import {
    isExternalRestOverride,
    type ExternalRestDecisionProvenance,
} from './externalRestProvenance';
import type {
    DailyRecommendation,
    ExternalRestProvenance,
    ExternalTrainingPlan,
    RecommendationAudit,
    SessionTemplate,
} from './models';
import {
    templateIdForWorkoutId,
    type CoverageCreditFact,
    type HydratedOccurrenceContext,
    type PerformedExposureFact,
} from './performedTrainingFacts';
import type { PerformedTrainingOccurrence, PerformedOccurrenceStatus } from '../training-occurrence/models';
import { getLocalDateString } from '../utils/localDate';
import { replayRecommendationAuditAgainstRevision } from './replay';

export interface PerformedRecoveryQualification {
    coverageSetId: CoverageSetId;
    phase: PlanPhase;
    coverageKey: 'recovery_or_rest';
}

export type RecoveryFactSource =
    | {
          kind: 'performed_recovery';
          performedOccurrenceId: string;
          workoutId: string;
          qualification: PerformedRecoveryQualification;
          templateId?: string;
      }
    | {
          kind: 'authored_rest';
          planId: string;
          revision: number;
          contentHash: string;
          restDirectiveId: string;
          date: string;
          overridden?: true;
      }
    | {
          kind: 'engine_rest_day_outcome';
          decisionContextRevision: string;
          policyVersion: string;
          reconciliationStatus: 'adherence_confirmed' | 'authoritative_clean_closure';
          reconciliationEvidenceAt: string;
      };

export interface RecoveryPlacementFact {
    date: string;
    source: RecoveryFactSource;
}

export interface RecoveryHistorySnapshot {
    asOfDate: string;
    facts: RecoveryPlacementFact[];
    qualifyingRecoveryDates: string[];
    latestQualifyingRecoveryDate: string | null;
    bootstrapDate: string | null;
}

function isValidCalendarDate(value: string): boolean {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) return false;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const candidate = new Date(Date.UTC(year, month - 1, day));
    return candidate.getUTCFullYear() === year
        && candidate.getUTCMonth() === month - 1
        && candidate.getUTCDate() === day;
}

function isValidInstant(value: unknown): value is string {
    return typeof value === 'string'
        && value.trim().length > 0
        && !Number.isNaN(new Date(value).getTime());
}

function requirePerformedLocalDate(
    occurrence: PerformedTrainingOccurrence,
    startedAt: string | undefined,
    hydrated: HydratedOccurrenceContext,
): string {
    let localDate: string | undefined;
    if (occurrence.localDate !== undefined) {
        localDate = occurrence.localDate;
    } else if (startedAt) {
        const startedInstant = new Date(startedAt);
        if (!Number.isNaN(startedInstant.getTime())) {
            localDate = getLocalDateString(startedInstant);
        }
    } else if (hydrated.provider?.garminActivity?.date !== undefined) {
        localDate = hydrated.provider.garminActivity.date;
    }

    if (!localDate || !isValidCalendarDate(localDate)) {
        throw new Error(`Performed training occurrence ${occurrence.performedOccurrenceId} has invalid or missing local date.`);
    }
    return localDate;
}

// ---------------------------------------------------------------------------
// Work A: Performed active recovery facts
// ---------------------------------------------------------------------------

/**
 * Derives a RecoveryPlacementFact from a canonical performed occurrence and its hydrated sources.
 * Refuses merged/superseded canonical occurrences, generic modality and unmapped sessions: an exact
 * canonical workoutId must be present and qualify under the resolved authority descriptor and phase.
 */
export function deriveRecoveryFactFromPerformedOccurrence(
    occurrence: PerformedTrainingOccurrence,
    hydrated: HydratedOccurrenceContext,
    authority: RecoveryAuthorityResolution = resolveRecoveryAuthority(null),
): RecoveryPlacementFact | null {
    if (occurrence.status !== 'active') {
        return null;
    }

    const workoutId = hydrated.structured?.workoutId;
    if (!workoutId || workoutId === 'legacy_strength') {
        return null;
    }

    if (!isQualifyingRecoveryIdentity(workoutId, authority)) {
        return null;
    }

    const startedAt = hydrated.structured?.startedAt ?? occurrence.startedAt ?? hydrated.provider?.startedAt;
    const localDate = requirePerformedLocalDate(occurrence, startedAt, hydrated);
    const templateId = hydrated.structured?.templateId ?? templateIdForWorkoutId(workoutId);

    return {
        date: localDate,
        source: {
            kind: 'performed_recovery',
            performedOccurrenceId: occurrence.performedOccurrenceId,
            workoutId,
            qualification: {
                coverageSetId: authority.coverageSetId,
                phase: authority.phase,
                coverageKey: 'recovery_or_rest',
            },
            ...(templateId ? { templateId } : {}),
        },
    };
}

/**
 * Derives a RecoveryPlacementFact from an already-derived CoverageCreditFact and
 * PerformedExposureFact. Both facts must describe the same canonical occurrence; exact coverage
 * from one occurrence must never be paired with the date/exposure of another occurrence.
 */
export function deriveRecoveryFactFromCoverageCreditFact(
    coverageCredit: CoverageCreditFact,
    exposure: PerformedExposureFact,
    authority: RecoveryAuthorityResolution = resolveRecoveryAuthority(null),
): RecoveryPlacementFact | null {
    if (coverageCredit.performedOccurrenceId !== exposure.performedOccurrenceId) {
        return null;
    }
    if (coverageCredit.coverageSetId !== authority.coverageSetId) {
        return null;
    }
    if (coverageCredit.coverageKey !== 'recovery_or_rest' || coverageCredit.creditKind !== 'exact') {
        return null;
    }
    if (!isValidCalendarDate(exposure.localDate)) {
        return null;
    }

    const workoutId = coverageCredit.workoutId;
    if (!workoutId || !isQualifyingRecoveryIdentity(workoutId, authority)) {
        return null;
    }
    if (exposure.workoutId !== undefined && exposure.workoutId !== workoutId) {
        return null;
    }

    const templateId = exposure.templateId ?? templateIdForWorkoutId(workoutId);

    return {
        date: exposure.localDate,
        source: {
            kind: 'performed_recovery',
            performedOccurrenceId: exposure.performedOccurrenceId,
            workoutId,
            qualification: {
                coverageSetId: authority.coverageSetId,
                phase: authority.phase,
                coverageKey: 'recovery_or_rest',
            },
            ...(templateId ? { templateId } : {}),
        },
    };
}

/**
 * Pure replay validator for performed recovery facts.
 * Revalidates the persisted workoutId against the recorded qualification authority.
 * Returns false if the stored identity/date/provenance cannot be trusted under the authority.
 */
export function validatePerformedRecoveryFact(
    fact: RecoveryPlacementFact,
    authority: RecoveryAuthorityResolution,
): boolean {
    if (fact.source.kind !== 'performed_recovery') {
        return false;
    }
    const { qualification, workoutId, performedOccurrenceId } = fact.source;
    if (!isValidCalendarDate(fact.date) || performedOccurrenceId.trim().length === 0 || workoutId.trim().length === 0) {
        return false;
    }
    if (qualification.coverageKey !== 'recovery_or_rest') {
        return false;
    }
    if (qualification.coverageSetId !== authority.coverageSetId || qualification.phase !== authority.phase) {
        return false;
    }
    return isQualifyingRecoveryIdentity(workoutId, authority);
}

// ---------------------------------------------------------------------------
// Work B: ADR-0035 Authored Rest bridge
// ---------------------------------------------------------------------------

export interface DeriveAuthoredRestFactOptions {
    /**
     * Set when contradictory canonical training occurred on the resolved date
     * without an explicit in-app override. Suppresses recovery credit while preserving
     * original intent in audit.
     */
    hasContradictoryTraining?: boolean;
}

export interface DeriveAuthoredRestFactResult {
    fact: RecoveryPlacementFact | null;
    reason?: 'overridden' | 'contradictory_training' | 'invalid_provenance';
    /** Existing replay diagnostics when provenance/revision/decision validation fails. */
    replayErrors?: string[];
}

function isValidBaseRestProvenance(provenance: ExternalRestProvenance): boolean {
    return Boolean(
        provenance.planId && provenance.planId.trim().length > 0
        && typeof provenance.revision === 'number' && Number.isInteger(provenance.revision) && provenance.revision >= 1
        && provenance.contentHash && provenance.contentHash.trim().length > 0
        && provenance.restDirectiveId && provenance.restDirectiveId.trim().length > 0
        && provenance.date && isValidCalendarDate(provenance.date),
    );
}

/**
 * Validates an authored Rest decision through ADR-0035's existing recommendation replay path before
 * bridging it into historical recovery truth. This proves the immutable revision hash, directive id,
 * resolved date, canonical Rest selection and the recommendation's normal replay invariants instead
 * of trusting a shape-valid provenance object in isolation.
 */
export async function deriveRecoveryFactFromAuthoredRest(
    recommendation: DailyRecommendation,
    planRevision: ExternalTrainingPlan,
    options: DeriveAuthoredRestFactOptions = {},
): Promise<DeriveAuthoredRestFactResult> {
    const provenance = recommendation.recommendationAudit?.externalRest;
    if (!provenance || !isValidBaseRestProvenance(provenance)) {
        return { fact: null, reason: 'invalid_provenance' };
    }

    if (isExternalRestOverride(provenance) || (provenance as ExternalRestDecisionProvenance).overridden === true) {
        return { fact: null, reason: 'overridden' };
    }

    const replay = await replayRecommendationAuditAgainstRevision(recommendation, planRevision);
    if (!replay.reproducible) {
        return { fact: null, reason: 'invalid_provenance', replayErrors: replay.errors };
    }

    if (options.hasContradictoryTraining) {
        return { fact: null, reason: 'contradictory_training' };
    }

    return {
        fact: {
            date: provenance.date,
            source: {
                kind: 'authored_rest',
                planId: provenance.planId,
                revision: provenance.revision,
                contentHash: provenance.contentHash,
                restDirectiveId: provenance.restDirectiveId,
                date: provenance.date,
            },
        },
    };
}

// ---------------------------------------------------------------------------
// Work C: Generated complete-Rest day outcome reconciliation
// ---------------------------------------------------------------------------

export type DayReconciliationClosure =
    | { status: 'adherence_confirmed' }
    | { status: 'authoritative_clean_closure'; closedAt: string }
    | { status: 'incomplete' | 'unreconciled' | 'provider_empty_unverified' };

export interface ContradictoryOccurrenceCandidate {
    performedOccurrenceId?: string;
    date?: string;
    localDate?: string;
    modality?: SessionTemplate['modality'] | 'Unknown';
    status?: PerformedOccurrenceStatus;
}

export interface ReconcileGeneratedRestInput {
    recommendation: {
        date: string;
        category: SessionTemplate['category'];
        templateId: string;
        recommendationAudit?: Pick<RecommendationAudit, 'policyVersion' | 'decisionContextRevision'>;
        adherence?: DailyRecommendation['adherence'];
    };
    closureState: DayReconciliationClosure;
    contradictoryOccurrences?: ContradictoryOccurrenceCandidate[];
    authority?: RecoveryAuthorityResolution;
}

export interface ReconcileGeneratedRestResult {
    fact: RecoveryPlacementFact | null;
    status: 'credited' | 'contradicted' | 'unreconciled' | 'not_rest';
}

function positiveRestAdherenceEvidence(adherence: DailyRecommendation['adherence'] | undefined): string | null {
    if (!adherence || adherence.followed !== true || adherence.skipped === true) {
        return null;
    }
    if (adherence.actualModality !== null && adherence.actualModality !== undefined && adherence.actualModality !== 'None') {
        return null;
    }
    if (typeof adherence.actualDurationMin === 'number' && adherence.actualDurationMin > 0) {
        return null;
    }
    return isValidInstant(adherence.respondedAt) ? adherence.respondedAt : null;
}

/**
 * Pure post-day reconciliation step for generated complete-Rest recommendations.
 * Emits a historical Rest fact only when:
 * 1. Persisted recommendation proves an exact authority-pinned Rest identity and replay identity;
 * 2. Reconciliation closure has positive Rest adherence or an authoritative clean closure;
 * 3. No active contradictory performed training replaced Rest.
 *
 * Missing provider telemetry ("provider returned nothing") is explicitly rejected as closure.
 */
export function reconcileGeneratedRestOutcome(input: ReconcileGeneratedRestInput): ReconcileGeneratedRestResult {
    const { recommendation, closureState, contradictoryOccurrences = [], authority = resolveRecoveryAuthority(null) } = input;

    if (!isValidCalendarDate(recommendation.date)
        || !isQualifyingRecoveryIdentity(recommendation.templateId, authority)) {
        return { fact: null, status: 'not_rest' };
    }

    const policyVersion = recommendation.recommendationAudit?.policyVersion?.trim();
    const decisionContextRevision = recommendation.recommendationAudit?.decisionContextRevision?.trim();
    if (!policyVersion || !decisionContextRevision || !decisionContextRevision.startsWith('history-v1:')) {
        return { fact: null, status: 'unreconciled' };
    }

    const hasContradiction = contradictoryOccurrences.some(occ => {
        if (occ.status !== undefined && occ.status !== 'active') return false;
        const occDate = occ.localDate ?? occ.date;
        if (occDate !== recommendation.date) return false;
        // Any active performed occurrence other than explicit non-training contradicts a Rest day.
        return occ.modality !== 'None';
    });

    if (hasContradiction) {
        return { fact: null, status: 'contradicted' };
    }

    let reconciliationEvidenceAt: string | null = null;
    if (closureState.status === 'adherence_confirmed') {
        reconciliationEvidenceAt = positiveRestAdherenceEvidence(recommendation.adherence);
    } else if (closureState.status === 'authoritative_clean_closure') {
        reconciliationEvidenceAt = isValidInstant(closureState.closedAt) ? closureState.closedAt : null;
    }

    if (!reconciliationEvidenceAt) {
        return { fact: null, status: 'unreconciled' };
    }

    return {
        fact: {
            date: recommendation.date,
            source: {
                kind: 'engine_rest_day_outcome',
                decisionContextRevision,
                policyVersion,
                reconciliationStatus: closureState.status,
                reconciliationEvidenceAt,
            },
        },
        status: 'credited',
    };
}

// ---------------------------------------------------------------------------
// Work D: Durable bootstrap resolution and recovery history snapshot
// ---------------------------------------------------------------------------

export interface ResolveBootstrapDateInput {
    storedBootstrapDate?: string | null;
    firstEvaluationDate?: string | null;
    asOfDate?: string;
}

export interface ResolveBootstrapDateResult {
    bootstrapDate: string;
    isNewlyGenerated: boolean;
}

/**
 * Pure resolver for the durable recovery-policy bootstrap epoch B.
 * Reuses the stored epoch when present so repeated recomputation never slides the reference date.
 * A malformed persisted epoch fails closed rather than silently replacing it with today's date.
 */
export function resolveBootstrapDate(input: ResolveBootstrapDateInput): ResolveBootstrapDateResult {
    if (input.storedBootstrapDate !== undefined && input.storedBootstrapDate !== null) {
        if (!isValidCalendarDate(input.storedBootstrapDate)) {
            throw new Error('Cannot resolve bootstrap date: storedBootstrapDate is invalid.');
        }
        return { bootstrapDate: input.storedBootstrapDate, isNewlyGenerated: false };
    }
    const candidate = input.firstEvaluationDate ?? input.asOfDate;
    if (!candidate || !isValidCalendarDate(candidate)) {
        throw new Error('Cannot resolve bootstrap date: valid storedBootstrapDate, firstEvaluationDate, or asOfDate is required.');
    }
    return { bootstrapDate: candidate, isNewlyGenerated: true };
}

export interface BuildRecoveryHistorySnapshotInput {
    asOfDate: string;
    facts: RecoveryPlacementFact[];
    bootstrapDate?: string | null;
}

/**
 * Pure constructor assembling a trustworthy historical RecoveryHistorySnapshot.
 * Only dates strictly before the evaluation date are historical. When a bootstrap epoch exists,
 * the unknown-history prefix through B is excluded; a real qualifying fact must occur after B.
 * Older post-bootstrap facts are retained because the deadline calculation needs the latest known
 * recovery even when it is more than one seven-day window old (overdue state).
 */
export function buildRecoveryHistorySnapshot(input: BuildRecoveryHistorySnapshotInput): RecoveryHistorySnapshot {
    const { asOfDate, facts, bootstrapDate = null } = input;
    if (!isValidCalendarDate(asOfDate)) {
        throw new Error('Cannot build recovery history: asOfDate is invalid.');
    }
    if (bootstrapDate !== null && !isValidCalendarDate(bootstrapDate)) {
        throw new Error('Cannot build recovery history: bootstrapDate is invalid.');
    }

    const historicalFacts = facts
        .filter(fact => isValidCalendarDate(fact.date)
            && fact.date < asOfDate
            && (bootstrapDate === null || fact.date > bootstrapDate))
        .sort((a, b) => a.date.localeCompare(b.date));

    const qualifyingRecoveryDates = [...new Set(historicalFacts.map(fact => fact.date))].sort();
    const latestQualifyingRecoveryDate = qualifyingRecoveryDates.length > 0
        ? qualifyingRecoveryDates[qualifyingRecoveryDates.length - 1]
        : null;

    return {
        asOfDate,
        facts: historicalFacts,
        qualifyingRecoveryDates,
        latestQualifyingRecoveryDate,
        bootstrapDate,
    };
}
