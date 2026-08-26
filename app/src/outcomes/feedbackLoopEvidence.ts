import type { AthleteDecisionAction, ClosedLoopFeedbackRecord, CoachingHelpfulness, CounterfactualRegretClass } from '../feedback/feedbackModels';

export type DecisionActionCounts = Record<AthleteDecisionAction, number>;
export type RegretClassCounts = Record<CounterfactualRegretClass, number>;

const REGRETFUL_CLASSES: readonly CounterfactualRegretClass[] = [
    'overreaching_crash',
    'unnecessary_forfeiture',
    'injury_exacerbation',
];

export interface FeedbackLoopEvidence {
    /** Count of closed-loop records folded into this window; 0 means no evidence exists yet,
     * not that zero modifications/regret occurred. */
    recordCount: number;
    decisionActionCounts: DecisionActionCounts;
    /** Percent of decisions that were not a plain `accepted`. Null when recordCount is 0. */
    modificationRatePct: number | null;
    regretClassCounts: RegretClassCounts;
    /**
     * SV goal #6: the operational regret-label rate. Denominator is records with a non-null,
     * non-`inconclusive` regret classification -- ambiguous observations are excluded from
     * both numerator and denominator rather than forced toward either bound. Null when no
     * record has a resolvable classification.
     */
    regretRatePct: number | null;
    averageUtilityScore: number | null;
    averageClarityScore: number | null;
    coachingHelpfulnessCounts: Record<CoachingHelpfulness, number>;
    averageHoldCompliancePct: number | null;
    averageDurationDeltaPct: number | null;
    sourceIds: {
        /** `date@r<revision>` of the recommendation each record reconciles against, mirroring
         * `blockProcessEvidence.ts`'s recommendation reference format. */
        feedbackRecordIds: readonly string[];
    };
}

function emptyDecisionActionCounts(): DecisionActionCounts {
    return {
        accepted: 0,
        scaled_down: 0,
        scaled_up: 0,
        substituted: 0,
        rejected_rest: 0,
        rejected_train_harder: 0,
    };
}

function emptyRegretClassCounts(): RegretClassCounts {
    return {
        optimal_choice: 0,
        overreaching_crash: 0,
        unnecessary_forfeiture: 0,
        injury_exacerbation: 0,
        inconclusive: 0,
    };
}

function emptyCoachingHelpfulnessCounts(): Record<CoachingHelpfulness, number> {
    return {
        very_helpful: 0,
        helpful: 0,
        neutral: 0,
        unhelpful: 0,
        counterproductive: 0,
    };
}

function average(values: readonly number[]): number | null {
    if (values.length === 0) return null;
    const sum = values.reduce((total, value) => total + value, 0);
    return Math.round((sum / values.length) * 100) / 100;
}

function percentage(numerator: number, denominator: number): number | null {
    if (denominator === 0) return null;
    return Math.round((10000 * numerator) / denominator) / 100;
}

function compareCodeUnits(left: string, right: string): number {
    return left < right ? -1 : left > right ? 1 : 0;
}

function feedbackRecordRef(record: ClosedLoopFeedbackRecord): string {
    return `${record.date}@r${record.recommendationRef.revision}`;
}

/**
 * SV4 evidence-only read model. Pure aggregation over already-validated closed-loop feedback
 * records (see `feedback/feedbackValidation.ts`); it never derives, mutates, or infers a
 * record and it never feeds back into `verdict` -- see the plan's "not an immediate
 * recommendation-policy mutation" framing.
 */
export function deriveFeedbackLoopEvidence(records: readonly ClosedLoopFeedbackRecord[]): FeedbackLoopEvidence {
    const decisionActionCounts = emptyDecisionActionCounts();
    const regretClassCounts = emptyRegretClassCounts();
    const coachingHelpfulnessCounts = emptyCoachingHelpfulnessCounts();

    let nonAccepted = 0;
    let classifiedRegret = 0;
    let regretfulRegret = 0;
    const utilityScores: number[] = [];
    const clarityScores: number[] = [];
    const holdCompliancePcts: number[] = [];
    const durationDeltaPcts: number[] = [];

    for (const record of records) {
        decisionActionCounts[record.decision.action] += 1;
        if (record.decision.action !== 'accepted') nonAccepted += 1;

        if (record.regret) {
            regretClassCounts[record.regret.regretClass] += 1;
            if (record.regret.regretClass !== 'inconclusive') {
                classifiedRegret += 1;
                if (REGRETFUL_CLASSES.includes(record.regret.regretClass)) regretfulRegret += 1;
            }
        }

        if (record.utility) {
            utilityScores.push(record.utility.utilityScore);
            clarityScores.push(record.utility.clarityScore);
            coachingHelpfulnessCounts[record.utility.coachingHelpfulness] += 1;
        }

        if (record.doseReconciliation.holdCompliancePct !== null) {
            holdCompliancePcts.push(record.doseReconciliation.holdCompliancePct);
        }
        if (record.doseReconciliation.durationDeltaPct !== null) {
            durationDeltaPcts.push(record.doseReconciliation.durationDeltaPct);
        }
    }

    return {
        recordCount: records.length,
        decisionActionCounts,
        modificationRatePct: percentage(nonAccepted, records.length),
        regretClassCounts,
        regretRatePct: percentage(regretfulRegret, classifiedRegret),
        averageUtilityScore: average(utilityScores),
        averageClarityScore: average(clarityScores),
        coachingHelpfulnessCounts,
        averageHoldCompliancePct: average(holdCompliancePcts),
        averageDurationDeltaPct: average(durationDeltaPcts),
        sourceIds: {
            feedbackRecordIds: [...new Set(records.map(feedbackRecordRef))].sort(compareCodeUnits),
        },
    };
}
