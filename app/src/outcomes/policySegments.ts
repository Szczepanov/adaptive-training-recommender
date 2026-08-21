import type { DailyRecommendation } from '../engine/models';
import { addDaysToLocalDateString } from '../utils/localDate';

export const UNKNOWN_POLICY_VERSION = 'unknown' as const;
export const UNKNOWN_PLANNING_MODE = 'unknown' as const;

export interface PolicySegment {
    startDate: string;
    endDate: string;
    policyVersion: string;
    planningMode: string;
    authoredPlanRef?: string;
}

interface PolicyContext {
    policyVersion: string;
    planningMode: string;
    authoredPlanRef?: string;
}

function compareCodeUnits(left: string, right: string): number {
    return left < right ? -1 : left > right ? 1 : 0;
}

function contextFor(recommendation: DailyRecommendation): PolicyContext {
    const externalPlan = recommendation.recommendationAudit?.externalPlan;
    return {
        policyVersion: recommendation.recommendationAudit?.policyVersion ?? UNKNOWN_POLICY_VERSION,
        planningMode: externalPlan ? 'externally_planned' : UNKNOWN_PLANNING_MODE,
        ...(externalPlan ? { authoredPlanRef: `${externalPlan.planId}@r${externalPlan.revision}` } : {}),
    };
}

function sameContext(left: PolicyContext, right: PolicyContext): boolean {
    // ADR-0017 reserves direct `.planningMode` reads for the effective-mode authority.
    // These are report-evidence fields, not TrainingIntentProfile, so destructure them
    // explicitly rather than creating a misleading direct-access pattern in production.
    const { policyVersion: leftPolicy, planningMode: leftMode, authoredPlanRef: leftPlan } = left;
    const { policyVersion: rightPolicy, planningMode: rightMode, authoredPlanRef: rightPlan } = right;
    return leftPolicy === rightPolicy && leftMode === rightMode && leftPlan === rightPlan;
}

function asSegment(startDate: string, endDate: string, context: PolicyContext): PolicySegment {
    return { startDate, endDate, ...context };
}

function recommendationRevision(recommendation: DailyRecommendation): number {
    return recommendation.revision ?? 1;
}

function canonicalTieBreakKey(recommendation: DailyRecommendation): string {
    // Same ADR-0017 guard as sameContext: this is persisted report evidence, not an
    // effective-mode derivation. Destructure to avoid a direct `.planningMode` read.
    const { policyVersion, planningMode, authoredPlanRef } = contextFor(recommendation);
    return [
        recommendation.updatedAt,
        recommendation.createdAt,
        policyVersion,
        planningMode,
        authoredPlanRef ?? '',
    ].join('\u0000');
}

/**
 * Select one stable recommendation per date. The highest persisted recommendation revision is
 * authoritative; the remaining fields only provide deterministic ordering for malformed or
 * duplicated equal-revision inputs so caller order can never change segmentation.
 */
function canonicalRecommendations(
    recommendations: readonly DailyRecommendation[],
    period: { startDate: string; endDate: string },
): DailyRecommendation[] {
    const byDate = new Map<string, DailyRecommendation>();
    for (const recommendation of recommendations) {
        if (recommendation.date < period.startDate || recommendation.date > period.endDate) continue;
        const current = byDate.get(recommendation.date);
        if (!current
            || recommendationRevision(recommendation) > recommendationRevision(current)
            || (recommendationRevision(recommendation) === recommendationRevision(current)
                && compareCodeUnits(canonicalTieBreakKey(recommendation), canonicalTieBreakKey(current)) > 0)) {
            byDate.set(recommendation.date, recommendation);
        }
    }
    return [...byDate.values()].sort((a, b) => compareCodeUnits(a.date, b.date));
}

/**
 * OV5.4: segment persisted decision context without attributing metric progress to a policy.
 * Missing historical context is represented explicitly as `unknown`; it is never back-filled
 * from today's engine configuration.
 */
export function derivePolicySegments(
    recommendations: readonly DailyRecommendation[],
    period: { startDate: string; endDate: string },
): PolicySegment[] {
    if (period.startDate > period.endDate) throw new Error('Policy segment period startDate cannot exceed endDate');

    const inPeriod = canonicalRecommendations(recommendations, period);

    const unknown: PolicyContext = {
        policyVersion: UNKNOWN_POLICY_VERSION,
        planningMode: UNKNOWN_PLANNING_MODE,
    };
    if (inPeriod.length === 0) return [asSegment(period.startDate, period.endDate, unknown)];

    const segments: PolicySegment[] = [];
    let activeContext = unknown;
    let activeStart = period.startDate;

    for (const recommendation of inPeriod) {
        const nextContext = contextFor(recommendation);
        if (sameContext(activeContext, nextContext)) continue;

        if (recommendation.date > activeStart) {
            segments.push(asSegment(
                activeStart,
                addDaysToLocalDateString(recommendation.date, -1),
                activeContext,
            ));
        }
        activeContext = nextContext;
        activeStart = recommendation.date;
    }

    segments.push(asSegment(activeStart, period.endDate, activeContext));
    return segments;
}
