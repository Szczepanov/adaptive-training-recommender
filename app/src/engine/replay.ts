import type { DailyRecommendation, ExternalDecisionProvenance, ExternalTrainingPlan } from './models';
import { computeContentHash } from './externalPlanHash';
import { externalTemplateId, isExternalTemplateId } from './externalSessionProfiles';
import { isHistoricalPolicyVersion, POLICY_VERSION } from './policy';

export interface RecommendationReplayResult {
    reproducible: boolean;
    policyMatchesCurrent: boolean;
    errors: string[];
}

/**
 * The stored revision an external decision claims to have been made from, plus the hash
 * recomputed from it. The hash is supplied by the caller because `computeContentHash` is
 * async (WebCrypto) and this function stays synchronous for every existing caller — use
 * `replayRecommendationAuditAgainstRevision` to have it computed for you.
 */
export interface ExternalRevisionEvidence {
    plan: ExternalTrainingPlan;
    /** SHA-256 recomputed from `plan`. Never read from the audit — that would make the
     * comparison below compare a value with itself. */
    contentHash: string;
}

/**
 * Verifies that a v3 record is internally reproducible from its compact persisted
 * audit. It intentionally validates normalized decision facts only; raw recovery
 * payloads and free-text notes are neither required nor accepted as replay inputs.
 *
 * Historical policy versions remain auditable but are not executable in the current
 * bundle. Replaying one is rejected explicitly rather than silently interpreting its
 * facts under the current policy implementation.
 *
 * An external decision (ADR-0019) ranked nothing, so the highest-utility check below does
 * not apply to it. In its place the decision is verified against the plan revision it
 * names: without that revision it is *not* reproducible, and a hash mismatch is reported
 * as its own distinct failure rather than folded into a generic error.
 */
export function replayRecommendationAudit(
    recommendation: DailyRecommendation,
    externalRevision: ExternalRevisionEvidence | null = null,
): RecommendationReplayResult {
    const errors: string[] = [];
    const audit = recommendation.recommendationAudit;
    if (recommendation.schemaVersion !== 3 || !audit) {
        return { reproducible: false, policyMatchesCurrent: false, errors: ['Recommendation does not contain a v3 audit.'] };
    }
    const policyMatchesCurrent = audit.policyVersion === POLICY_VERSION;
    if (!policyMatchesCurrent) {
        errors.push(isHistoricalPolicyVersion(audit.policyVersion)
            ? `Historical policy version ${audit.policyVersion} is intentionally audit-only and cannot be replayed by this build.`
            : `Policy version ${audit.policyVersion} is not available in this build.`);
    }
    if (audit.safetyStatus !== 'complete') errors.push('Audit safety status is not complete.');
    if (!audit.decisionContextRevision.startsWith('history-v1:')) errors.push('Decision context revision is invalid.');
    if (audit.history.unmatchedEventCount > audit.history.completedEventCount) errors.push('Unmatched event count exceeds completed event count.');

    if (audit.externalPlan) {
        errors.push(...externalDecisionErrors(recommendation, audit.externalPlan, externalRevision));
    } else {
        if (externalRevision) {
            errors.push('A plan revision was supplied for a decision that did not come from an external plan.');
        }
        const selected = audit.candidateScores.find(candidate => candidate.templateId === recommendation.templateId);
        if (!selected) {
            errors.push('Persisted template is absent from the audited candidates.');
        } else if (audit.candidateScores.some(candidate => candidate.utilityScore > selected.utilityScore)) {
            errors.push('Persisted template was not the highest-utility audited candidate.');
        }
    }

    return { reproducible: errors.length === 0, policyMatchesCurrent, errors };
}

function externalDecisionErrors(
    recommendation: DailyRecommendation,
    provenance: ExternalDecisionProvenance,
    externalRevision: ExternalRevisionEvidence | null,
): string[] {
    const errors: string[] = [];

    // Selection belonged to the plan's author, so there is nothing to rank. A populated
    // candidate list would mean a second selection path ran and went unrecorded.
    if (recommendation.recommendationAudit!.candidateScores.length > 0) {
        errors.push('An external decision audited ranked candidates, which no external decision produces.');
    }

    // A non-actionable verdict persists the rest template rather than the synthetic one,
    // so an external decision legitimately carries either id -- but never a third.
    const expectedTemplateId = externalTemplateId(provenance.planId, provenance.revision, provenance.sessionId);
    if (isExternalTemplateId(recommendation.templateId) && recommendation.templateId !== expectedTemplateId) {
        errors.push(`Persisted template ${recommendation.templateId} does not match the audited external session ${expectedTemplateId}.`);
    }

    if (!externalRevision) {
        errors.push(`External decision references plan ${provenance.planId} revision ${provenance.revision}, which was not supplied; it cannot be replayed without it.`);
        return errors;
    }

    if (externalRevision.plan.planId !== provenance.planId || externalRevision.plan.revision !== provenance.revision) {
        errors.push(`Supplied revision is ${externalRevision.plan.planId}@${externalRevision.plan.revision}, but the audit references ${provenance.planId}@${provenance.revision}.`);
        return errors;
    }

    // The load-bearing check. A plan re-imported under the same revision number reads back
    // with the same identity and different content; only the hash catches that, and a
    // decision replayed against changed content is not the decision that was made.
    if (externalRevision.contentHash !== provenance.contentHash) {
        errors.push(`Plan content hash mismatch: the audit recorded ${provenance.contentHash} but the supplied revision hashes to ${externalRevision.contentHash}. The stored revision has changed since this decision was made.`);
        return errors;
    }

    if (!externalRevision.plan.sessions.some(session => session.id === provenance.sessionId)) {
        errors.push(`Session ${provenance.sessionId} is not present in plan ${provenance.planId} revision ${provenance.revision}.`);
    }

    return errors;
}

/**
 * Convenience wrapper that hashes the supplied revision itself, so a caller cannot
 * accidentally pass the audit's own recorded hash back in and verify nothing.
 */
export async function replayRecommendationAuditAgainstRevision(
    recommendation: DailyRecommendation,
    plan: ExternalTrainingPlan | null,
): Promise<RecommendationReplayResult> {
    if (!plan) return replayRecommendationAudit(recommendation);
    return replayRecommendationAudit(recommendation, { plan, contentHash: await computeContentHash(plan) });
}
