import type { Recommendation, RecommendationAudit } from './models';
import type { TrainingHistorySnapshot } from './trainingHistorySnapshot';
import type { IdentityDecisionProvenance } from '../observations/identityModels';
import type { AthleteEvidenceRecord } from '../knowledge/athleteEvidence';
import {
    compactSubjectiveDriftAudit,
    type SubjectiveDriftAudit,
    type SubjectiveDriftAuditSource,
} from './subjectiveDriftAudit';
import {
    mergeKnowledgeRefs,
    snapshotAthleteEvidenceLineage,
    snapshotKnowledgeLineage,
} from './knowledgeLineage';

export type RecommendationAuditWithSubjectiveDrift = RecommendationAudit & {
    /** Present only when an explicitly measured/enabled subjective-drift path supplied normalized evidence. */
    subjectiveDrift?: SubjectiveDriftAudit;
};

/** Builds the v4 audit from already-normalized decision facts. Do not add free-text
 * check-in notes, raw wearable payloads, raw readiness values, raw subjective history,
 * athlete-evidence rationales, or athlete-evidence user IDs to this record. */
export function buildRecommendationAudit(
    recommendation: Recommendation,
    historySnapshot: TrainingHistorySnapshot,
    evaluatedAt = new Date().toISOString(),
    subjectiveDriftEvidence: SubjectiveDriftAuditSource | null = null,
    identityDecision: IdentityDecisionProvenance | null = null,
    athleteEvidenceRecords: readonly AthleteEvidenceRecord[] = [],
): RecommendationAuditWithSubjectiveDrift | null {
    const trace = recommendation.decisionTrace;
    const envelopes = recommendation.envelopes;
    if (!trace || !envelopes) return null;

    const subjectiveDrift = compactSubjectiveDriftAudit(subjectiveDriftEvidence);
    const athleteEvidenceLineage = snapshotAthleteEvidenceLineage(athleteEvidenceRecords);
    const knowledgeLineage = snapshotKnowledgeLineage(mergeKnowledgeRefs(
        recommendation.knowledgeRefs ?? [],
        athleteEvidenceRecords.map(record => record.baseKnowledgeClaimId),
    ));

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
        knowledgeLineage,
        ...(athleteEvidenceLineage ? { athleteEvidenceLineage } : {}),
        ...(recommendation.plannedDose ? { plannedDose: recommendation.plannedDose } : {}),
        ...(recommendation.executionDose ? { executionDose: recommendation.executionDose } : {}),
        candidateScores: trace.candidateScores,
        droppedContributorObjectives: trace.droppedContributorObjectives,
        ...(trace.externalPlan ? { externalPlan: trace.externalPlan } : {}),
        ...(trace.externalRest ? { externalRest: trace.externalRest } : {}),
        ...(trace.authoredOccurrence ? { authoredOccurrence: trace.authoredOccurrence } : {}),
        ...(recommendation.primarySession ? { primarySession: recommendation.primarySession } : {}),
        ...(recommendation.additionalSessions && recommendation.additionalSessions.length > 0 ? { additionalSessions: recommendation.additionalSessions } : {}),
        ...(subjectiveDrift ? { subjectiveDrift } : {}),
        ...(identityDecision ? { identityDecision } : {}),
    };
}
