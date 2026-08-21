import type { DailyRecommendation, ShadowVerdict } from '../engine/models';
import type { SessionOutcome } from '../responses/outcome';

export interface KeyRoleEvidence {
    /** Stable occurrence identities supplied by the existing weekly-role coverage authority. */
    plannedOccurrenceIds: readonly string[];
    /** Subset of plannedOccurrenceIds that canonical completed-session evidence fulfilled. */
    completedOccurrenceIds: readonly string[];
}

export interface CompletedSessionEvidence {
    /** Exact IDs from the canonical completed session/execution history for this block. */
    sessionIds: readonly string[];
}

export interface BlockProcessEvidence {
    plannedKeyRoles: number;
    completedKeyRoles: number;
    plannedSessionCount: number;
    completedSessionCount: number;
    adherencePct: number;
    scaledCount: number;
    deferredCount: number;
    skippedCount: number;
    unplannedRestCount: number;
    responseCounts: {
        passed: number;
        caution: number;
        reactive: number;
        unknown: number;
    };
    responseCoveragePct: number;
    /** Exact read-model provenance; these are references to existing records, never a new truth store. */
    sourceIds: {
        recommendationIds: readonly string[];
        sessionIds: readonly string[];
    };
}

type RecommendationEvidence = DailyRecommendation & { engineVerdict?: ShadowVerdict };

export interface BlockProcessEvidenceInput {
    recommendations: readonly RecommendationEvidence[];
    sessionOutcomes: readonly SessionOutcome[];
    keyRoles: KeyRoleEvidence;
    completedSessions: CompletedSessionEvidence;
}

function uniqueSorted(values: readonly string[]): string[] {
    return [...new Set(values)].sort();
}

function percentage(numerator: number, denominator: number): number {
    if (denominator === 0) return 100;
    return Math.round((10000 * numerator) / denominator) / 100;
}

function isPlannedTrainingSession(recommendation: RecommendationEvidence): boolean {
    return recommendation.category !== 'Rest';
}

function completedRecommendation(recommendation: RecommendationEvidence): boolean {
    const adherence = recommendation.adherence;
    if (adherence.respondedAt === null || adherence.followed === null) return false;
    return adherence.followed === true;
}

function recommendationRef(recommendation: RecommendationEvidence): string {
    return `${recommendation.date}@r${recommendation.revision ?? 1}`;
}

/**
 * OV5.2 read model over existing recommendation/adherence, completed-session history,
 * weekly-role coverage and M5.3 response facts. Nothing here writes data or invents a
 * second adherence/response authority.
 */
export function deriveBlockProcessEvidence(input: BlockProcessEvidenceInput): BlockProcessEvidence {
    const plannedKeyRoleIds = uniqueSorted(input.keyRoles.plannedOccurrenceIds);
    const plannedKeyRoleSet = new Set(plannedKeyRoleIds);
    const completedKeyRoleIds = uniqueSorted(input.keyRoles.completedOccurrenceIds)
        .filter(id => plannedKeyRoleSet.has(id));
    const completedSessionIds = uniqueSorted(input.completedSessions.sessionIds);

    const recommendations = [...input.recommendations]
        .sort((a, b) => a.date.localeCompare(b.date) || recommendationRef(a).localeCompare(recommendationRef(b)));
    const plannedSessions = recommendations.filter(isPlannedTrainingSession);
    const adheredPlannedSessions = plannedSessions.filter(completedRecommendation);

    const responseCounts: BlockProcessEvidence['responseCounts'] = {
        passed: 0,
        caution: 0,
        reactive: 0,
        unknown: 0,
    };
    for (const outcome of input.sessionOutcomes) responseCounts[outcome.status] += 1;
    const responseKnown = responseCounts.passed + responseCounts.caution + responseCounts.reactive;

    return {
        plannedKeyRoles: plannedKeyRoleIds.length,
        completedKeyRoles: completedKeyRoleIds.length,
        plannedSessionCount: plannedSessions.length,
        completedSessionCount: completedSessionIds.length,
        // Adherence remains a derived read-model field over the canonical recommendation
        // adherence record; completed-session history is intentionally a separate count.
        adherencePct: percentage(adheredPlannedSessions.length, plannedSessions.length),
        scaledCount: recommendations.filter(item => item.engineVerdict === 'scale').length,
        deferredCount: recommendations.filter(item => item.engineVerdict === 'defer').length,
        skippedCount: recommendations.filter(item => item.engineVerdict === 'skip').length,
        unplannedRestCount: plannedSessions.filter(item =>
            item.engineVerdict !== 'skip'
            && item.engineVerdict !== 'defer'
            && item.adherence.respondedAt !== null
            && item.adherence.followed === false
            && item.adherence.skipped
        ).length,
        responseCounts,
        responseCoveragePct: input.sessionOutcomes.length === 0
            ? 0
            : percentage(responseKnown, input.sessionOutcomes.length),
        sourceIds: {
            recommendationIds: uniqueSorted(recommendations.map(recommendationRef)),
            sessionIds: uniqueSorted([
                ...completedSessionIds,
                ...input.sessionOutcomes.map(item => item.sourceSession.id),
            ]),
        },
    };
}
