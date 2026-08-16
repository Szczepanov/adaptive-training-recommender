import type { Recommendation, RecommendationAudit } from './models';
import type { TrainingHistorySnapshot } from './trainingHistorySnapshot';

/** Builds the v3 audit from already-normalized decision facts. Do not add free-text
 * check-in notes, raw wearable payloads, or raw readiness values to this record. */
export function buildRecommendationAudit(
    recommendation: Recommendation,
    historySnapshot: TrainingHistorySnapshot,
    evaluatedAt = new Date().toISOString(),
): RecommendationAudit | null {
    const trace = recommendation.decisionTrace;
    const envelopes = recommendation.envelopes;
    if (!trace || !envelopes) return null;

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
    };
}
