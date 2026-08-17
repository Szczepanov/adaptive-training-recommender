import type { DailyRecommendation, ExternalDecisionProvenance, ExternalTrainingPlan } from './models';
import { computeContentHash } from './externalPlanHash';
import { externalTemplateId, isExternalTemplateId } from './externalSessionProfiles';
import { isHistoricalPolicyVersion, POLICY_VERSION } from './policy';
import { subjectiveDriftAuditReplayErrors } from './subjectiveDriftAudit';

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

function rankedDecisionErrors(recommendation: DailyRecommendation): string[] {
    const scores = recommendation.recommendationAudit!.candidateScores;
    const selected = scores.find(candidate => candidate.templateId === recommendation.templateId);
    if (!selected) return ['Persisted template is absent from the audited candidates.'];
    if (scores.some(candidate => candidate.utilityScore > selected.utilityScore)) {
        return ['Persisted template was not the highest-utility audited candidate.'];
    }
    return [];
}

/**
 * Verifies that a v3 record is internally reproducible from its compact persisted
 * audit. It intentionally validates normalized decision facts only; raw recovery
 * payloads, raw subjective history, and free-text notes are neither required nor accepted
 * as replay inputs. Optional subjective-drift evidence is checked against only the
 * normalized invariants that are reproducible from the compact audit.
 *
 * Historical policy versions remain auditable but are not executable in the current
 * bundle. Replaying one is rejected explicitly rather than silently interpreting its
 * facts under the current policy implementation.
 *
 * ADR-0019 now has two external-provenance shapes:
 * - an externally selected training session ranks nothing and persists either its `ext:`
 *   template or a non-actionable recovery template;
 * - an `isEvent` session is a FixedActivity-style commitment, so the engine still ranks
 *   any additional recommendation while retaining the event revision/hash as an input to
 *   that decision.
 * Replay verifies the relevant selection invariant for each shape.
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

    const subjectiveDrift = (audit as typeof audit & { subjectiveDrift?: unknown }).subjectiveDrift;
    errors.push(...subjectiveDriftAuditReplayErrors(subjectiveDrift, recommendation.date));

    if (audit.externalPlan) {
        errors.push(...externalDecisionErrors(recommendation, audit.externalPlan, externalRevision));
    } else {
        if (externalRevision) {
            errors.push('A plan revision was supplied for a decision that did not come from an external plan.');
        }
        errors.push(...rankedDecisionErrors(recommendation));
    }

    return { reproducible: errors.length === 0, policyMatchesCurrent, errors };
}

function externalDecisionErrors(
    recommendation: DailyRecommendation,
    provenance: ExternalDecisionProvenance,
    externalRevision: ExternalRevisionEvidence | null,
): string[] {
    const errors: string[] = [];

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

    const session = externalRevision.plan.sessions.find(item => item.id === provenance.sessionId);
    if (!session) {
        errors.push(`Session ${provenance.sessionId} is not present in plan ${provenance.planId} revision ${provenance.revision}.`);
        return errors;
    }

    if (session.isEvent) {
        // D-EVENT: the event itself is never the selected template. Its provenance remains
        // load-bearing because it changed availability/fatigue/stimulus before the normal
        // ranking path chose the persisted catalog recommendation.
        if (isExternalTemplateId(recommendation.templateId)) {
            errors.push('An external event was persisted as the recommended template instead of as a fixed commitment.');
            return errors;
        }
        if (recommendation.recommendationAudit!.candidateScores.length > 0) {
            errors.push(...rankedDecisionErrors(recommendation));
        }
        return errors;
    }

    // Ordinary external sessions own selection, so ranking candidates here would mean a
    // second selection path ran and went unrecorded.
    if (recommendation.recommendationAudit!.candidateScores.length > 0) {
        errors.push('An externally selected session audited ranked candidates, which that decision path must not produce.');
    }

    // A non-actionable verdict persists the rest template rather than the synthetic one,
    // so an external decision legitimately carries either id -- but never another `ext:` id.
    const expectedTemplateId = externalTemplateId(provenance.planId, provenance.revision, provenance.sessionId);
    if (isExternalTemplateId(recommendation.templateId) && recommendation.templateId !== expectedTemplateId) {
        errors.push(`Persisted template ${recommendation.templateId} does not match the audited external session ${expectedTemplateId}.`);
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
