import type { Recommendation, RecommendationAudit } from './models';
import type { TrainingHistorySnapshot } from './trainingHistorySnapshot';
import {
    compactSubjectiveDriftAudit,
    type SubjectiveDriftAudit,
    type SubjectiveDriftAuditSource,
} from './subjectiveDriftAudit';

export type RecommendationAuditWithSubjectiveDrift = RecommendationAudit & {
    subjectiveDrift?: SubjectiveDriftAudit;
};

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
        ...(trace.externalPlan ? { externalPlan: trace.externalPlan } : {}),
        ...(subjectiveDrift ? { subjectiveDrift } : {}),
    };
}
