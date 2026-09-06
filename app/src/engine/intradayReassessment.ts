/**
 * ADR-0036 (H4) D-REASSESS: runtime reassessment of dependent intraday bundle members
 * before launch.
 *
 * A morning PM verdict is provisional. Before a later session starts, compose a fresh
 * as-of decision from current availability, today's canonical completed work, current
 * health/symptom inputs and the shared daily ledger.
 *
 * Core invariants:
 * 1. Predecessor completion: If afterSessionId is defined, predecessor must be completed.
 * 2. Timing separation (D-TIME): Elapsed minutes between prospective start and predecessor
 *    actual end instant must satisfy minimumSeparationMinutes.
 * 3. Explicit post-predecessor confirmation (ADR-0023 D-MRESP): Requires explicit SessionResponse
 *    or tissue confirmation; absent confirmation leaves it pending, not implicitly well-tolerated.
 * 4. Reactive symptoms scale or reject: Sharp tissue pain or adverse symptoms scale/reject PM.
 * 5. Favorable response does not expand authored dose.
 * 6. Shared daily ledger admission (D-LEDGER): Verifies candidate fits remainingMinutes
 *    and remainingSystemicCost via admitsCandidate.
 * 7. Readiness envelope: Re-evaluates readiness and safety envelopes bypassing the single-session
 *    alreadyTrainedOverride circuit breaker, since same-day load is accounted for via the ledger.
 */

import type {
    DailyReadiness,
    UserContext,
    PlannedDose,
    RegionTissueResponse,
} from './models';
import type { SessionDefinition } from '../sessions/models';
import type { OccurrenceState } from '../sessions/models';
import type { SessionResponse } from '../responses/models';
import type { ResolvedAvailability } from './schedule';
import type { EligibilityReason } from './eligibility';
import { elapsedMinutesBetweenInstants } from './localInstant';
import { admitsCandidate, type DailyLedgerResult } from './dailyLedger';
import {
    adjudicateAuthoredSession,
    estimateAuthoredSessionSystemicCost,
    scaleSessionDefinitionForModify,
} from './authoredSessionGates';
import { evaluateReadinessAndSafetyEnvelope } from './rules';
import { deriveTissueSeverity } from './injuryPolicy';

export interface ReassessmentInputRevision {
    availabilityRevision: string;
    completedFactsRevision: string;
    checkinRevision: string;
    ledgerRevision: number;
    placementRevision: string;
    postPredecessorConfirmationRevision?: string;
}

export function computeReassessmentInputRevision(params: {
    availabilityRevision: string;
    completedFactsRevision: string;
    checkinRevision: string;
    ledgerRevision: number;
    placementRevision: string;
    postPredecessorConfirmationRevision?: string;
}): ReassessmentInputRevision {
    return {
        availabilityRevision: params.availabilityRevision,
        completedFactsRevision: params.completedFactsRevision,
        checkinRevision: params.checkinRevision,
        ledgerRevision: params.ledgerRevision,
        placementRevision: params.placementRevision,
        ...(params.postPredecessorConfirmationRevision !== undefined
            ? { postPredecessorConfirmationRevision: params.postPredecessorConfirmationRevision }
            : {}),
    };
}

export interface DependentBundleMemberTarget {
    sessionId: string;
    definition: SessionDefinition;
    requestedWindow: { startLocal: string; endLocal: string };
    afterSessionId?: string;
    minimumSeparationMinutes?: number;
}

export interface PredecessorEvidence {
    sessionId: string;
    occurrenceId: string;
    state: OccurrenceState;
    completedAt?: string | null;
    response?: SessionResponse | null;
    tissueResponses?: RegionTissueResponse[];
}

export interface ReassessDependentBundleMemberParams {
    target: DependentBundleMemberTarget;
    predecessor?: PredecessorEvidence;
    evaluationInstant: string; // ISO UTC instant (e.g. now)
    readiness: DailyReadiness;
    context: UserContext;
    date: string;
    availability: ResolvedAvailability;
    candidateWindowMinutes: number;
    dailyLedger: DailyLedgerResult;
    acceptedSameDaySystemicCost: number;
    inputRevision: ReassessmentInputRevision;
    plannedDose?: PlannedDose;
}

export type ReassessmentDecision = 'proceed' | 'scale' | 'reject' | 'pending';

export interface ReassessmentResult {
    decision: ReassessmentDecision;
    reason: string;
    scaledDefinition?: SessionDefinition;
    executionDose?: PlannedDose;
    acceptedSystemicCost?: number;
    admittedMinutes?: number;
    gateFailures?: EligibilityReason[];
    inputRevision: ReassessmentInputRevision;
    timingPrerequisiteMet: boolean;
    predecessorConfirmed: boolean;
}

/**
 * Pure evaluation function for D-REASSESS.
 * Composes a fresh as-of decision before a dependent session starts.
 */
export function reassessDependentBundleMember(
    params: ReassessDependentBundleMemberParams,
): ReassessmentResult {
    const {
        target,
        predecessor,
        evaluationInstant,
        readiness,
        context,
        date,
        availability,
        candidateWindowMinutes,
        dailyLedger,
        acceptedSameDaySystemicCost,
        inputRevision,
        plannedDose,
    } = params;

    const candidateMinutes = target.definition.duration?.min ?? 45;
    const candidateSystemicCost = estimateAuthoredSessionSystemicCost(target.definition);

    // ── 1. Predecessor completion gate ─────────────────────────────────────────
    if (target.afterSessionId) {
        if (!predecessor || predecessor.sessionId !== target.afterSessionId || predecessor.state !== 'completed') {
            return {
                decision: 'pending',
                reason: `Predecessor session '${target.afterSessionId}' has not completed (state: ${predecessor?.state ?? 'unstarted'}).`,
                inputRevision,
                timingPrerequisiteMet: false,
                predecessorConfirmed: false,
            };
        }

        if (!predecessor.completedAt) {
            return {
                decision: 'pending',
                reason: `Predecessor session '${target.afterSessionId}' completion timestamp is missing; cannot verify separation.`,
                inputRevision,
                timingPrerequisiteMet: false,
                predecessorConfirmed: false,
            };
        }

        // ── 2. Timing separation gate (D-TIME) ──────────────────────────────────
        if (target.minimumSeparationMinutes !== undefined && target.minimumSeparationMinutes > 0) {
            const elapsed = elapsedMinutesBetweenInstants(evaluationInstant, predecessor.completedAt);
            if (elapsed < 0) {
                return {
                    decision: 'pending',
                    reason: `Evaluation instant (${evaluationInstant}) predates predecessor completion (${predecessor.completedAt}).`,
                    inputRevision,
                    timingPrerequisiteMet: false,
                    predecessorConfirmed: false,
                };
            }

            if (elapsed < target.minimumSeparationMinutes) {
                return {
                    decision: 'pending',
                    reason: `Required separation of ${target.minimumSeparationMinutes}m has not elapsed (${elapsed}m elapsed since ${predecessor.completedAt}).`,
                    inputRevision,
                    timingPrerequisiteMet: false,
                    predecessorConfirmed: false,
                };
            }
        }

        // ── 3. Post-predecessor confirmation gate (ADR-0023 D-MRESP) ───────────
        const hasResponse = Boolean(predecessor.response);
        const hasTissue = Boolean(predecessor.tissueResponses && predecessor.tissueResponses.length > 0);
        if (!hasResponse && !hasTissue) {
            return {
                decision: 'pending',
                reason: `Awaiting explicit post-predecessor symptom and response confirmation for '${target.afterSessionId}'.`,
                inputRevision,
                timingPrerequisiteMet: true,
                predecessorConfirmed: false,
            };
        }

        // Check for acute reactive tissue responses (severe/adverse pain)
        if (predecessor.tissueResponses) {
            const adverseRegion = predecessor.tissueResponses.find(
                tr => tr.afterTrainingState === 'severe' || deriveTissueSeverity(tr) === 'exclude',
            );
            if (adverseRegion) {
                return {
                    decision: 'reject',
                    reason: `Predecessor session reported severe/adverse tissue response in region '${adverseRegion.region}'. Deferred for athlete safety.`,
                    inputRevision,
                    timingPrerequisiteMet: true,
                    predecessorConfirmed: true,
                    gateFailures: ['safety_guardrail'],
                };
            }
        }
    }

    // ── 4. Readiness & Safety Envelopes (with alreadyTrainedOverride bypass) ───
    const envelopeState = evaluateReadinessAndSafetyEnvelope(
        readiness,
        context,
        date,
        undefined,
        'off',
        undefined,
        { ignoreAlreadyTrainedOverride: true },
    );

    if (envelopeState.mode === 'recover' && target.definition.intent !== 'recovery') {
        return {
            decision: 'reject',
            reason: 'Readiness or clinical red flags require recovery mode.',
            gateFailures: ['restricted_category'],
            inputRevision,
            timingPrerequisiteMet: true,
            predecessorConfirmed: true,
        };
    }

    // ── 5. Shared daily ledger admission (D-LEDGER) ───────────────────────────
    const admission = admitsCandidate(
        dailyLedger,
        candidateWindowMinutes,
        candidateMinutes,
        candidateSystemicCost,
    );

    if (!admission.admitted) {
        return {
            decision: 'reject',
            reason: `Shared daily ledger capacity exhausted (remaining: ${dailyLedger.remainingMinutes}m, systemic cost: ${dailyLedger.remainingSystemicCost.toFixed(2)}; candidate requires: ${candidateMinutes}m, cost: ${candidateSystemicCost.toFixed(2)}).`,
            inputRevision,
            timingPrerequisiteMet: true,
            predecessorConfirmed: true,
            gateFailures: ['time_limit'],
        };
    }

    // ── 6. Authored session adjudication ──────────────────────────────────────
    const authoredVerdict = adjudicateAuthoredSession(
        target.definition,
        readiness,
        context,
        envelopeState,
        plannedDose ?? { volume: 1.0, intensity: 1.0 },
        date,
        availability,
        acceptedSameDaySystemicCost,
    );

    if (authoredVerdict.decision === 'reject') {
        return {
            decision: 'reject',
            reason: authoredVerdict.rationale,
            gateFailures: authoredVerdict.gateFailures,
            inputRevision,
            timingPrerequisiteMet: true,
            predecessorConfirmed: true,
        };
    }

    // Check for scaling triggers: modify mode, unexpected fatigue, or aching tissue
    const hasAche = predecessor?.tissueResponses?.some(
        tr => tr.afterTrainingState === 'mild' || tr.afterTrainingState === 'moderate',
    );
    const hasUnexpectedFatigue = predecessor?.response?.unexpectedFatigue === true;

    if (authoredVerdict.decision === 'scale') {
        return {
            decision: 'scale',
            reason: authoredVerdict.rationale,
            scaledDefinition: authoredVerdict.scaledDefinition,
            executionDose: authoredVerdict.executionDose,
            acceptedSystemicCost: authoredVerdict.acceptedSystemicCost,
            admittedMinutes: admission.admittedMinutes,
            inputRevision,
            timingPrerequisiteMet: true,
            predecessorConfirmed: true,
        };
    }

    if (hasUnexpectedFatigue || hasAche) {
        const scaledDef = scaleSessionDefinitionForModify(target.definition, 0.7);
        const fatigueReason = hasUnexpectedFatigue && hasAche
            ? 'Scaled authored session volume due to unexpected fatigue and muscle ache reported after predecessor session.'
            : hasUnexpectedFatigue
                ? 'Scaled authored session volume due to unexpected fatigue reported after predecessor session.'
                : 'Scaled authored session volume due to localized muscle ache reported after predecessor session.';

        return {
            decision: 'scale',
            reason: fatigueReason,
            scaledDefinition: scaledDef,
            executionDose: authoredVerdict.executionDose,
            acceptedSystemicCost: estimateAuthoredSessionSystemicCost(scaledDef),
            admittedMinutes: admission.admittedMinutes,
            inputRevision,
            timingPrerequisiteMet: true,
            predecessorConfirmed: true,
        };
    }

    return {
        decision: 'proceed',
        reason: authoredVerdict.rationale,
        executionDose: authoredVerdict.executionDose,
        acceptedSystemicCost: authoredVerdict.acceptedSystemicCost ?? candidateSystemicCost,
        admittedMinutes: admission.admittedMinutes,
        inputRevision,
        timingPrerequisiteMet: true,
        predecessorConfirmed: true,
    };
}
