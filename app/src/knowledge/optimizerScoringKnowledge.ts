import type { KnowledgeClaim, KnowledgeSource } from './sportsKnowledge';

/**
 * SKR3 Workstream W2a: Optimizer Scoring & Candidate Selection Heuristics.
 *
 * Registers product-policy calibration records for candidate utility scoring in `optimizer.ts`.
 * In accordance with ADR-0033 and `docs/plans/2026-09-02-skr3-completion-plan.md` §W2, these
 * families represent internal scoring coefficients and utility shaping rather than physiological
 * effect estimates. They are registered with `evidenceCertainty: 'not_applicable'` and explicit
 * alignment tests to keep claim prose synchronized with production constants.
 */
export const OPTIMIZER_SCORING_CLAIM_IDS = {
    fatigueCostWeightsPolicy: 'policy.optimizer.fatigue_cost_weights_v1',
    stimulusBenefitWeightsPolicy: 'policy.optimizer.stimulus_benefit_weights_v1',
    eventPriorityMultipliersPolicy: 'policy.optimizer.event_priority_multipliers_v1',
    recoveryStreakHeuristicsPolicy: 'policy.optimizer.recovery_streak_heuristics_v1',
} as const;

const OPTIMIZER_SCORING_PRODUCT_POLICY_SOURCE = 'PRODUCT-OPTIMIZER-SCORING-POLICY-V1';

export const OPTIMIZER_SCORING_SOURCES: readonly KnowledgeSource[] = [
    {
        id: OPTIMIZER_SCORING_PRODUCT_POLICY_SOURCE,
        title: 'Adaptive Training Recommender candidate selection & optimizer scoring calibration policy v1',
        sourceType: 'product_policy',
        citation: 'Adaptive Training Recommender product policy, reviewed 2026-09-02.',
        publishedOn: '2026-09-02',
        notes: 'Registers the exact candidate fatigue-cost penalty weights, stimulus-benefit utility weights, event-priority multipliers, and consecutive training streak recovery-boosting heuristics as product calibration.',
    },
];

export const OPTIMIZER_SCORING_CLAIMS: readonly KnowledgeClaim[] = [
    {
        id: OPTIMIZER_SCORING_CLAIM_IDS.fatigueCostWeightsPolicy,
        statement: "Product optimizer scoring v1: candidate session fatigue penalty weights dimensional fatigue as systemic 2.0, cardiovascular 1.5, lower-body 2.5, upper-body 1.5, impact-tissue 2.0 and neuromuscular 1.8 against the workout's costProfile. An explicit extraRecoveryMargin, or conservativeBias when extraRecoveryMargin is unset, adds a fixed 0.3 cost penalty when systemicCost > 0.5; conservativeBias additionally adds 0.35 when systemicCost >= 0.6.",
        claimType: 'heuristic', maturity: 'heuristic', status: 'active', evidenceCertainty: 'not_applicable', recommendationStrength: 'conditional', safetyImpact: 'moderate',
        applicability: { contexts: ['candidate_selection', 'fatigue_cost_penalty'], sports: ['all_supported_sports'], populations: ['app_users'], outcomes: ['candidate_cost_penalty'], horizon: 'acute' },
        evidence: [{ sourceId: OPTIMIZER_SCORING_PRODUCT_POLICY_SOURCE, directness: 'direct' }],
        limitations: ['These weights materially alter candidate ranking and session selection; they are internal product heuristics balancing dimensional recovery times rather than empirical physiological interaction coefficients.'],
        reviewedOn: '2026-09-03', version: 1,
    },
    {
        id: OPTIMIZER_SCORING_CLAIM_IDS.stimulusBenefitWeightsPolicy,
        statement: 'Product optimizer scoring v1: Rest returns 0.1. When stimulusProfile is absent or unresolvedObjectives is empty, Mobility/Recovery returns 0.2, Technical Skill returns 0.3, and every other category returns min(0.75, 0.45 + 0.2*(aerobicEndurance + thresholdPower)), with missing stimulusProfile contributing zero to that sum. When objective scoring is active, qualified weekly objectives use multipliers of 1.5 for thresholdPower, repeatedSurges and vo2MaxPower; 1.2 for aerobicEndurance and fatigueResistance; and 1.6 for maxStrength or hypertrophy. In that objective-scoring branch, Mobility/Recovery uses a 0.2 non-objective baseline and other non-Rest categories use 0.5; the baseline is returned when no qualified target contributes and is added when benefit is non-zero.',
        claimType: 'heuristic', maturity: 'heuristic', status: 'active', evidenceCertainty: 'not_applicable', recommendationStrength: 'conditional', safetyImpact: 'low',
        applicability: { contexts: ['candidate_selection', 'stimulus_benefit_scoring'], sports: ['all_supported_sports'], populations: ['app_users'], outcomes: ['candidate_benefit_score'], horizon: 'acute' },
        evidence: [{ sourceId: OPTIMIZER_SCORING_PRODUCT_POLICY_SOURCE, directness: 'direct' }],
        limitations: ['Utility calibration determines relative preference among candidate sessions that satisfy constraints; the multipliers and fallback curve reflect product emphasis across adaptation targets, not empirical effect sizes.'],
        reviewedOn: '2026-09-03', version: 1,
    },
    {
        id: OPTIMIZER_SCORING_CLAIM_IDS.eventPriorityMultipliersPolicy,
        statement: 'Product optimizer scoring v1: target event alignment multiplies candidate benefit by 1.40 for A-priority events and 1.25 for B-priority events. For B events, a second race-specific endurance session within 6 days is multiplied by 0.35. At distances >21 days from race date, race-specific endurance sessions are multiplied by 0.50. Non-matching sessions when unresolved objectives exist are multiplied by 0.20.',
        claimType: 'heuristic', maturity: 'heuristic', status: 'active', evidenceCertainty: 'not_applicable', recommendationStrength: 'conditional', safetyImpact: 'low',
        applicability: { contexts: ['candidate_selection', 'event_priority_ranking'], sports: ['all_supported_sports'], populations: ['app_users_with_target_events'], outcomes: ['candidate_benefit_score'], horizon: 'acute' },
        evidence: [{ sourceId: OPTIMIZER_SCORING_PRODUCT_POLICY_SOURCE, directness: 'direct' }],
        limitations: ['Event priority multipliers shape session ranking toward specific event deadlines and types; they represent product utility preferences rather than physiological adaptation rates.'],
        reviewedOn: '2026-09-02', version: 1,
    },
    {
        id: OPTIMIZER_SCORING_CLAIM_IDS.recoveryStreakHeuristicsPolicy,
        statement: 'Product optimizer scoring v1: consecutive non-recovery training streaks (systemicCost >= 0.40) scanned over a 14-day history window trigger recovery prioritization when unresolved objectives are empty: at streak >= 3 consecutive days, Rest/Mobility is boosted by 2.0x while aerobic defaults are multiplied by 0.3 (or 0.1 at streak >= 4). A high-intensity candidate (systemicCost >= 0.50) immediately following another high-intensity session receives a 0.35x penalty multiplier.',
        claimType: 'heuristic', maturity: 'heuristic', status: 'active', evidenceCertainty: 'not_applicable', recommendationStrength: 'conditional', safetyImpact: 'moderate',
        applicability: { contexts: ['candidate_selection', 'training_streak_management'], sports: ['all_supported_sports'], populations: ['app_users'], outcomes: ['candidate_utility_score'], horizon: 'acute' },
        evidence: [{ sourceId: OPTIMIZER_SCORING_PRODUCT_POLICY_SOURCE, directness: 'direct' }],
        limitations: ['Training-streak suppression prevents excessive uninterrupted loading when plan objectives are satisfied; the 14-day lookback, 0.40 threshold, and 2.0x/0.3x/0.1x multipliers are product calibration values.'],
        reviewedOn: '2026-09-02', version: 1,
    },
];