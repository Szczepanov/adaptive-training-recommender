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

function contextFor(recommendation: DailyRecommendation): PolicyContext {
    const externalPlan = recommendation.recommendationAudit?.externalPlan;
    return {
        policyVersion: recommendation.recommendationAudit?.policyVersion ?? UNKNOWN_POLICY_VERSION,
        planningMode: externalPlan ? 'externally_planned' : UNKNOWN_PLANNING_MODE,
        ...(externalPlan ? { authoredPlanRef: `${externalPlan.planId}@r${externalPlan.revision}` } : {}),
    };
}

function sameContext(left: PolicyContext, right: PolicyContext): boolean {
    return left.policyVersion === right.policyVersion
        && left.planningMode === right.planningMode
        && left.authoredPlanRef === right.authoredPlanRef;
}

function asSegment(startDate: string, endDate: string, context: PolicyContext): PolicySegment {
    return { startDate, endDate, ...context };
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

    const inPeriod = [...recommendations]
        .filter(item => item.date >= period.startDate && item.date <= period.endDate)
        .sort((a, b) => a.date.localeCompare(b.date));

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
