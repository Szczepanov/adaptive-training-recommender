import type { DailyRecommendation, ExternalDecisionProvenance, ExternalTrainingPlan } from './models';
import { computeContentHash } from './externalPlanHash';
import { externalTemplateId, isExternalTemplateId } from './externalSessionProfiles';
import { isHistoricalPolicyVersion, POLICY_VERSION } from './policy';
import { subjectiveDriftAuditReplayErrors } from './subjectiveDriftAudit';

export interface RecommendationReplayResult { reproducible: boolean; policyMatchesCurrent: boolean; errors: string[]; }
export interface ExternalRevisionEvidence { plan: ExternalTrainingPlan; contentHash: string; }

function rankedDecisionErrors(recommendation: DailyRecommendation): string[] {
    const scores = recommendation.recommendationAudit!.candidateScores;
    const selected = scores.find(candidate => candidate.templateId === recommendation.templateId);
    if (!selected) return ['Persisted template is absent from the audited candidates.'];
    if (scores.some(candidate => candidate.utilityScore > selected.utilityScore)) return ['Persisted template was not the highest-utility audited candidate.'];
    return [];
}

export function replayRecommendationAudit(
    recommendation: DailyRecommendation,
    externalRevision: ExternalRevisionEvidence | null = null,
): RecommendationReplayResult {
    const errors: string[] = [];
    const audit = recommendation.recommendationAudit;
    if (recommendation.schemaVersion !== 3 || !audit) return { reproducible: false, policyMatchesCurrent: false, errors: ['Recommendation does not contain a v3 audit.'] };
    const policyMatchesCurrent = audit.policyVersion === POLICY_VERSION;
    if (!policyMatchesCurrent) {
        errors.push(isHistoricalPolicyVersion(audit.policyVersion)
            ? `Historical policy version ${audit.policyVersion} is intentionally audit-only and cannot be replayed by this build.`
            : `Policy version ${audit.policyVersion} is not available in this build.`);
    }
    if (audit.safetyStatus !== 'complete') errors.push('Audit safety status is not complete.');
    if (!audit.decisionContextRevision.startsWith('history-v1:')) errors.push('Decision context revision is invalid.');
    if (audit.history.unmatchedEventCount > audit.history.completedEventCount) errors.push('Unmatched event count exceeds completed event count.');
    errors.push(...subjectiveDriftAuditReplayErrors((audit as typeof audit & { subjectiveDrift?: unknown }).subjectiveDrift, recommendation.date));
    if (audit.externalPlan) errors.push(...externalDecisionErrors(recommendation, audit.externalPlan, externalRevision));
    else {
        if (externalRevision) errors.push('A plan revision was supplied for a decision that did not come from an external plan.');
        errors.push(...rankedDecisionErrors(recommendation));
    }
    return { reproducible: errors.length === 0, policyMatchesCurrent, errors };
}

function externalDecisionErrors(recommendation: DailyRecommendation, provenance: ExternalDecisionProvenance, externalRevision: ExternalRevisionEvidence | null): string[] {
    const errors: string[] = [];
    if (!externalRevision) {
        errors.push(`External decision references plan ${provenance.planId} revision ${provenance.revision}, which was not supplied; it cannot be replayed without it.`);
        return errors;
    }
    if (externalRevision.plan.planId !== provenance.planId || externalRevision.plan.revision !== provenance.revision) {
        errors.push(`Supplied revision is ${externalRevision.plan.planId}@${externalRevision.plan.revision}, but the audit references ${provenance.planId}@${provenance.revision}.`);
        return errors;
    }
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
        if (isExternalTemplateId(recommendation.templateId)) {
            errors.push('An external event was persisted as the recommended template instead of as a fixed commitment.');
            return errors;
        }
        if (recommendation.recommendationAudit!.candidateScores.length > 0) errors.push(...rankedDecisionErrors(recommendation));
        return errors;
    }
    if (recommendation.recommendationAudit!.candidateScores.length > 0) errors.push('An externally selected session audited ranked candidates, which that decision path must not produce.');
    const expectedTemplateId = externalTemplateId(provenance.planId, provenance.revision, provenance.sessionId);
    if (isExternalTemplateId(recommendation.templateId) && recommendation.templateId !== expectedTemplateId) errors.push(`Persisted template ${recommendation.templateId} does not match the audited external session ${expectedTemplateId}.`);
    return errors;
}

export async function replayRecommendationAuditAgainstRevision(recommendation: DailyRecommendation, plan: ExternalTrainingPlan | null): Promise<RecommendationReplayResult> {
    if (!plan) return replayRecommendationAudit(recommendation);
    return replayRecommendationAudit(recommendation, { plan, contentHash: await computeContentHash(plan) });
}
