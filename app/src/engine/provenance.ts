import type { Recommendation, RecommendationAudit } from './models';
import type { TrainingHistorySnapshot } from './trainingHistorySnapshot';
import {
    compactSubjectiveDriftAudit,
    type SubjectiveDriftAudit,
    type SubjectiveDriftAuditSource,
} from './subjectiveDriftAudit';

export type RecommendationAuditWithSubjectiveDrift = RecommendationAudit & {
    /** Present only when an explicitly measured/enabled subjective-drift path supplied
     * normalized evidence. Production-default callers do not supply it and retain the
     * exact legacy audit shape. */
    subjectiveDrift?: SubjectiveDriftAudit;
};

/** Builds the v3 audit from already-normalized decision facts. Do not add free-text
 * check-in notes, raw wearable payloads, raw readiness values, or raw subjective history
 * to this record. Subjective drift, when explicitly measured, is already normalized and
 * bounded before it reaches this function (ADR-0020/D-SUBJAUDIT). */
export function buildRecommendationAudit(
    recommendation: Recommendation,
    historySnapshot: TrainingHistorySnapshot,
    evaluatedAt = new Date().toISOString(),
    subjectiveDriftEvidence: SubjectiveDriftAuditSource | null = null,
): RecommendationAuditWithSubjectiveDrift | null {
    const trace = recommendation.decisionTrace;
    const envelopes = recommendation.envelopes;
    if (!trace || !envelopes) return null;

    const subjectiveDrift = compactSubjectiveDriftAudit(subjectiveDriftEvidence);
    return {
        policyVersion: trace.policyVersion,
        evaluatedAt,
        decisionContextRevision: historySnapshot.revision,
        safetyStatus: 'complete',
        history: {
            completedEventCount: historySnapshot.completedEvents.length,
            unmatchedEventCount: historySnapshot.completedEvents.filter(event => event.sources.length === 1).length,
            sourceStatuses: {
                activities: historySnapshot.sourceStates.activities.status,
                recommendations: historySnapshot.sourceStates.recommendations.status,
                manualTraining: historySnapshot.sourceStates.manualTraining.status,
            },
        },
        envelope: {
            safetyRestrictedModalityCount: envelopes.safety.restrictedModalities.length,
            planMaxAllowableTier: envelopes.plan.maxAllowableTier,
        },
        ...(recommendation.plannedDose ? { plannedDose: recommendation.plannedDose } : {}),
        ...(recommendation.executionDose ? { executionDose: recommendation.executionDose } : {}),
        candidateScores: trace.candidateScores,
        droppedContributorObjectives: trace.droppedContributorObjectives,
        // Carried verbatim: the audit must name the revision bytes, not re-derive them.
        ...(trace.externalPlan ? { externalPlan: trace.externalPlan } : {}),
        ...(recommendation.primarySession ? { primarySession: recommendation.primarySession } : {}),
        ...(recommendation.additionalSessions && recommendation.additionalSessions.length > 0 ? { additionalSessions: recommendation.additionalSessions } : {}),
        ...(subjectiveDrift ? { subjectiveDrift } : {}),
    };
}
