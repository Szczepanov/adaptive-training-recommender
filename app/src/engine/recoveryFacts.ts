/**
 * Pure recovery fact models and derivation boundaries (ADR-0038 Work Package RP2).
 *
 * Implements historical recovery truth:
 * - Work A: Performed active recovery facts with exact workout identity and qualification authority;
 * - Work B: ADR-0035 authored Rest bridge with override suppression and adherence contradiction checks;
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
    RecommendationAudit,
    SessionTemplate,
} from './models';
import {
    templateIdForWorkoutId,
    type CoverageCreditFact,
    type HydratedOccurrenceContext,
    type PerformedExposureFact,
} from './performedTrainingFacts';
import type { PerformedTrainingOccurrence } from '../training-occurrence/models';
import { getLocalDateString } from '../utils/localDate';

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
          recommendationAuditId: string;
          policyVersion: string;
          reconciliationStatus: 'adherence_confirmed' | 'authoritative_clean_closure';
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
 * Refuses generic modality or unmapped sessions: an exact canonical workoutId must be present
 * and qualify under the resolved authority descriptor and phase.
 */
export function deriveRecoveryFactFromPerformedOccurrence(
    occurrence: PerformedTrainingOccurrence,
    hydrated: HydratedOccurrenceContext,
    authority: RecoveryAuthorityResolution = resolveRecoveryAuthority(null),
): RecoveryPlacementFact | null {
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
 * Derives a RecoveryPlacementFact from an already-derived CoverageCreditFact and PerformedExposureFact.
 */
export function deriveRecoveryFactFromCoverageCreditFact(
    coverageCredit: CoverageCreditFact,
    exposure: PerformedExposureFact,
    authority: RecoveryAuthorityResolution = resolveRecoveryAuthority(null),
): RecoveryPlacementFact | null {
    if (coverageCredit.coverageKey !== 'recovery_or_rest' || coverageCredit.creditKind !== 'exact') {
        return null;
    }
    const workoutId = coverageCredit.workoutId ?? exposure.workoutId;
    if (!workoutId || !isQualifyingRecoveryIdentity(workoutId, authority)) {
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
 * Returns false if the stored identity does not qualify under the authority descriptor & phase.
 */
export function validatePerformedRecoveryFact(
    fact: RecoveryPlacementFact,
    authority: RecoveryAuthorityResolution,
): boolean {
    if (fact.source.kind !== 'performed_recovery') {
        return false;
    }
    const { qualification, workoutId } = fact.source;
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
}

function isValidBaseRestProvenance(provenance: ExternalRestProvenance): boolean {
    return Boolean(
        provenance.planId && provenance.planId.trim().length > 0
        && typeof provenance.revision === 'number' && provenance.revision >= 1
        && provenance.contentHash && provenance.contentHash.trim().length > 0
        && provenance.restDirectiveId && provenance.restDirectiveId.trim().length > 0
        && provenance.date && isValidCalendarDate(provenance.date),
    );
}

/**
 * Validates authored Rest provenance and bridges it into an auditable recovery fact.
 * - Suppresses credit when decision-time provenance reports `overridden: true`.
 * - Suppresses credit when unrecorded contradictory performed training appears on the date.
 * - Preserves original base provenance in audit.
 */
export function deriveRecoveryFactFromAuthoredRest(
    provenance: ExternalRestProvenance | ExternalRestDecisionProvenance,
    options: DeriveAuthoredRestFactOptions = {},
): DeriveAuthoredRestFactResult {
    if (!isValidBaseRestProvenance(provenance)) {
        return { fact: null, reason: 'invalid_provenance' };
    }

    if (isExternalRestOverride(provenance) || (provenance as ExternalRestDecisionProvenance).overridden === true) {
        return { fact: null, reason: 'overridden' };
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

/**
 * Pure post-day reconciliation step for generated complete-Rest recommendations.
 * Emits a historical Rest fact only when:
 * 1. Persisted recommendation proves canonical Rest was selected with valid policy version;
 * 2. Reconciliation closure state is authoritative enough to close the day;
 * 3. No contradictory performed training replaced Rest.
 *
 * Missing provider telemetry ("provider returned nothing") is explicitly rejected as closure.
 */
export function reconcileGeneratedRestOutcome(input: ReconcileGeneratedRestInput): ReconcileGeneratedRestResult {
    const { recommendation, closureState, contradictoryOccurrences = [], authority = resolveRecoveryAuthority(null) } = input;

    const isRestRecommendation =
        recommendation.category === 'Rest'
        || recommendation.templateId === 'rest_day'
        || isQualifyingRecoveryIdentity(recommendation.templateId, authority);

    if (!isRestRecommendation) {
        return { fact: null, status: 'not_rest' };
    }

    const policyVersion = recommendation.recommendationAudit?.policyVersion;
    if (!policyVersion) {
        return { fact: null, status: 'unreconciled' };
    }

    const hasContradiction = contradictoryOccurrences.some(occ => {
        const occDate = occ.localDate ?? occ.date;
        if (occDate !== recommendation.date) return false;
        // Non-rest activity performed on the rest date is contradictory training
        return occ.modality !== 'None';
    });

    if (hasContradiction) {
        return { fact: null, status: 'contradicted' };
    }

    if (closureState.status === 'incomplete'
        || closureState.status === 'unreconciled'
        || closureState.status === 'provider_empty_unverified') {
        return { fact: null, status: 'unreconciled' };
    }

    const recommendationAuditId = recommendation.recommendationAudit?.decisionContextRevision
        ?? `recommendation_rest:${recommendation.date}`;

    return {
        fact: {
            date: recommendation.date,
            source: {
                kind: 'engine_rest_day_outcome',
                recommendationAuditId,
                policyVersion,
                reconciliationStatus: closureState.status,
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
 */
export function resolveBootstrapDate(input: ResolveBootstrapDateInput): ResolveBootstrapDateResult {
    if (input.storedBootstrapDate && isValidCalendarDate(input.storedBootstrapDate)) {
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
 * Pure constructor assembling a bounded RecoveryHistorySnapshot from derived facts.
 * Deduplicates and sorts qualifying recovery dates, resolving the latest qualifying recovery date.
 */
export function buildRecoveryHistorySnapshot(input: BuildRecoveryHistorySnapshotInput): RecoveryHistorySnapshot {
    const { asOfDate, facts, bootstrapDate } = input;
    const qualifyingDatesSet = new Set<string>();

    for (const fact of facts) {
        if (isValidCalendarDate(fact.date) && fact.date <= asOfDate) {
            qualifyingDatesSet.add(fact.date);
        }
    }

    const qualifyingRecoveryDates = [...qualifyingDatesSet].sort();
    const latestQualifyingRecoveryDate = qualifyingRecoveryDates.length > 0
        ? qualifyingRecoveryDates[qualifyingRecoveryDates.length - 1]
        : null;

    return {
        asOfDate,
        facts: [...facts].sort((a, b) => a.date.localeCompare(b.date)),
        qualifyingRecoveryDates,
        latestQualifyingRecoveryDate,
        bootstrapDate: bootstrapDate ?? null,
    };
}
