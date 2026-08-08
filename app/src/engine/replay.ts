import type { DailyRecommendation } from './models';
import { isHistoricalPolicyVersion, POLICY_VERSION } from './policy';

export interface RecommendationReplayResult {
    reproducible: boolean;
    policyMatchesCurrent: boolean;
    errors: string[];
}

/**
 * Verifies that a v3 record is internally reproducible from its compact persisted
 * audit. It intentionally validates normalized decision facts only; raw recovery
 * payloads and free-text notes are neither required nor accepted as replay inputs.
 *
 * Historical policy versions remain auditable but are not executable in the current
 * bundle. Replaying one is rejected explicitly rather than silently interpreting its
 * facts under the current policy implementation.
 */
export function replayRecommendationAudit(recommendation: DailyRecommendation): RecommendationReplayResult {
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

    const selected = audit.candidateScores.find(candidate => candidate.templateId === recommendation.templateId);
    if (!selected) {
        errors.push('Persisted template is absent from the audited candidates.');
    } else if (audit.candidateScores.some(candidate => candidate.utilityScore > selected.utilityScore)) {
        errors.push('Persisted template was not the highest-utility audited candidate.');
    }

    return { reproducible: errors.length === 0, policyMatchesCurrent, errors };
}
