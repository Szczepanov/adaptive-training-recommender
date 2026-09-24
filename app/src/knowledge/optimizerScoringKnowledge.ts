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
    eventPriorityMultipliersPolicyV1: 'policy.optimizer.event_priority_multipliers_v1',
    eventPriorityMultipliersPolicy: 'policy.optimizer.event_priority_multipliers_v2',
    recoveryStreakHeuristicsPolicy: 'policy.optimizer.recovery_streak_heuristics_v1',
    rollingLoadBudgetPolicy: 'policy.optimizer.rolling_load_budget_v1',
    fieldCatalogExplicitPreferencePolicy: 'policy.optimizer.field_catalog_explicit_preference_v1',
    unpreferredModalityFallbackPolicy: 'policy.optimizer.unpreferred_modality_fallback_v1',
    timeCapEasyEnduranceTruncationPolicy: 'policy.optimizer.time_cap_easy_endurance_truncation_v1',
    preferredModalityTodayTieBreakPolicy: 'policy.optimizer.preferred_modality_today_tiebreak_v1',
    catalogStrengthAdjacencyPolicy: 'policy.optimizer.catalog_strength_adjacency_v1',
    symptomCompatibleStrengthSupportPolicy: 'policy.optimizer.symptom_compatible_strength_support_v1',
    readinessModifiedAerobicSupportPolicy: 'policy.optimizer.readiness_modified_aerobic_support_v1',
    residualLowerBodyStrengthDeferralPolicy: 'policy.optimizer.residual_lower_body_strength_deferral_v1',
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
        id: OPTIMIZER_SCORING_CLAIM_IDS.residualLowerBodyStrengthDeferralPolicy,
        statement: 'Product candidate-selection policy v1: when combined lower-body fatigue is at least 0.6, a heavy lower-body strength candidate whose tier-0/1 urgency comes only from primary_strength has that primary-strength urgency removed. Any other authored coverage tier remains authoritative; the candidate reaches tier 3 only when it advances no other active role. Upper-body strength and candidates advancing another required role retain their authored tier. Exact coverage credit and weekly reservations remain unchanged.',
        claimType: 'heuristic', maturity: 'heuristic', status: 'active', evidenceCertainty: 'not_applicable', recommendationStrength: 'conditional', safetyImpact: 'moderate',
        applicability: { contexts: ['candidate_selection', 'week_ahead_planning'], sports: ['all_supported_sports'], populations: ['app_users'], outcomes: ['strength_session_ranking'], horizon: 'acute' },
        evidence: [{ sourceId: OPTIMIZER_SCORING_PRODUCT_POLICY_SOURCE, directness: 'direct' }],
        limitations: ['The 0.6 threshold is product ranking calibration, not a physiological injury cut-point. It does not make a candidate ineligible or grant, remove, or reserve exact weekly-role credit; non-primary authored roles are still ranked normally.'],
        reviewedOn: '2026-09-24', version: 1,
    },
    {
        id: OPTIMIZER_SCORING_CLAIM_IDS.fieldCatalogExplicitPreferencePolicy,
        statement: 'Product candidate-selection policy v1: an automatic catalog template marked requiresExplicitModalityPreference is ineligible unless the athlete explicitly prefers that template modality under canonical alias matching. The current marked catalog templates are Field Maintenance and Field technical/sprint-mechanics sessions.',
        claimType: 'heuristic', maturity: 'heuristic', status: 'active', evidenceCertainty: 'not_applicable', recommendationStrength: 'conditional', safetyImpact: 'moderate',
        applicability: { contexts: ['candidate_selection', 'catalog_admission'], sports: ['all_supported_sports'], populations: ['app_users'], outcomes: ['catalog_candidate_eligibility'], horizon: 'acute' },
        evidence: [{ sourceId: OPTIMIZER_SCORING_PRODUCT_POLICY_SOURCE, directness: 'direct' }],
        limitations: ['This is an explicit catalog opt-in rule for specialized automatic content, not a clinical safety restriction and not a general rule that preferences unlock ordinary training modalities. Event-specific demand remains a separate planning authority.'],
        reviewedOn: '2026-09-23', version: 1,
    },
    {
        id: OPTIMIZER_SCORING_CLAIM_IDS.unpreferredModalityFallbackPolicy,
        statement: 'Product candidate-selection policy v2: when at least one preferred non-recovery training candidate clears hard gates, another non-preferred, non-recovery, non-event-matching candidate remains eligible but its benefit and utility are multiplied by 0.25 unless it qualifies for an unresolved weekly objective that is not already advanced by any eligible preferred training candidate and contributes positive stimulus on a positive target axis.',
        claimType: 'heuristic', maturity: 'heuristic', status: 'active', evidenceCertainty: 'not_applicable', recommendationStrength: 'conditional', safetyImpact: 'low',
        applicability: { contexts: ['candidate_selection', 'modality_preference'], sports: ['all_supported_sports'], populations: ['app_users'], outcomes: ['preferred_modality_ranking'], horizon: 'acute' },
        evidence: [{ sourceId: OPTIMIZER_SCORING_PRODUCT_POLICY_SOURCE, directness: 'direct' }],
        limitations: ['The 0.25 multiplier is product calibration, not a measured physiological effect size. Hard safety/feasibility gates, explicit event demand, and genuinely unresolved programming objectives lacking a preferred-modality alternative remain authoritative.'],
        reviewedOn: '2026-09-24', version: 2,
    },
    {
        id: OPTIMIZER_SCORING_CLAIM_IDS.timeCapEasyEnduranceTruncationPolicy,
        statement: 'Product candidate-selection policy v1: on a non-modify day, a time cap truncates an Easy Endurance template within its authored prescription when durationMax exceeds the cap, durationMin fits the cap, and the authored easierDose starts below durationMin. The active dose keeps the authored durationMin, sets durationMax to the cap, and uses max(easierDose.doseRatio, midpoint(durationMin, cap) / midpoint(durationMin, durationMax)) as its doseRatio. Modify-tier days retain the authored easierDose. This is duration-feasible; not a claim of dose adequacy: a 30–35 min Zone 2 ride can earn one weekly aerobic-volume coverage session while objective credit remains scaled by delivered dose.',
        claimType: 'heuristic', maturity: 'heuristic', status: 'active', evidenceCertainty: 'not_applicable', recommendationStrength: 'conditional', safetyImpact: 'low',
        applicability: { contexts: ['candidate_selection', 'time_cap_dosing'], sports: ['all_supported_sports'], populations: ['app_users'], outcomes: ['time_capped_candidate_dose'], horizon: 'acute' },
        evidence: [{ sourceId: OPTIMIZER_SCORING_PRODUCT_POLICY_SOURCE, directness: 'direct' }],
        limitations: ['This is a product duration-feasibility rule, not a physiological dose-equivalence or aerobic-adequacy claim. The midpoint ratio is calibration rather than a measured stimulus relation; modify-tier dosing remains unchanged.'],
        reviewedOn: '2026-09-24', version: 1,
    },
    {
        id: OPTIMIZER_SCORING_CLAIM_IDS.preferredModalityTodayTieBreakPolicy,
        statement: 'Product candidate-selection policy v1: preferredModalityToday is honored only when it also belongs to the athlete’s preferredModalities, and then wins only among candidates in the same coverage, recovery-preference, and objective-benefit tier before utility ranking and the final variety tie-break.',
        claimType: 'heuristic', maturity: 'heuristic', status: 'active', evidenceCertainty: 'not_applicable', recommendationStrength: 'conditional', safetyImpact: 'low',
        applicability: { contexts: ['candidate_selection', 'same_day_preference'], sports: ['all_supported_sports'], populations: ['app_users'], outcomes: ['current_day_candidate_order'], horizon: 'acute' },
        evidence: [{ sourceId: OPTIMIZER_SCORING_PRODUCT_POLICY_SOURCE, directness: 'direct' }],
        limitations: ['The current-day preference changes only the present ranking decision; it does not rewrite chronic preferences and cannot override hard gates or higher-priority programming tiers.'],
        reviewedOn: '2026-09-23', version: 1,
    },
    {
        id: OPTIMIZER_SCORING_CLAIM_IDS.catalogStrengthAdjacencyPolicy,
        statement: 'Product candidate-selection policy v1: automatic catalog ranking rejects a strength candidate on the athlete-local calendar day immediately after any prior strength exposure, across strength categories. Shared recovery evaluation retains its existing workout-specific spacing semantics so authored-plan critique does not inherit this catalog-only rule.',
        claimType: 'heuristic', maturity: 'heuristic', status: 'active', evidenceCertainty: 'not_applicable', recommendationStrength: 'conditional', safetyImpact: 'moderate',
        applicability: { contexts: ['candidate_selection', 'strength_spacing'], sports: ['all_supported_sports'], populations: ['app_users'], outcomes: ['strength_spacing'], horizon: 'acute' },
        evidence: [{ sourceId: OPTIMIZER_SCORING_PRODUCT_POLICY_SOURCE, directness: 'direct' }],
        limitations: ['The adjacent-local-date rule is a conservative scheduling policy, not a literal 48-hour elapsed-time threshold or a universal physiological recovery requirement.'],
        reviewedOn: '2026-09-23', version: 1,
    },
    {
        id: OPTIMIZER_SCORING_CLAIM_IDS.symptomCompatibleStrengthSupportPolicy,
        statement: 'Product candidate-selection policy v1: when the active coverage state has an unmet primary-strength minimum, a template explicitly marked guardrailFallbackRole=shoulder_spinal_strength receives coverage tier 2 ranking urgency only while avoid_heavy_spinal_loading or avoid_overhead_pressing is active. This support never grants a coverage key, fulfils or reserves primary_strength, and remains below exact tier-0/tier-1 role authority.',
        claimType: 'heuristic', maturity: 'heuristic', status: 'active', evidenceCertainty: 'not_applicable', recommendationStrength: 'conditional', safetyImpact: 'moderate',
        applicability: { contexts: ['candidate_selection', 'week_ahead_planning'], sports: ['all_supported_sports'], populations: ['app_users'], outcomes: ['strength_support_ranking'], horizon: 'acute' },
        evidence: [{ sourceId: OPTIMIZER_SCORING_PRODUCT_POLICY_SOURCE, directness: 'direct' }],
        limitations: ['Tier 2 is product ranking calibration, not a clinical treatment rule, a measured physiological effect size, or evidence that reduced-load support is equivalent to the exact primary-strength role. Hard safety, recovery, load, spacing, time, equipment, event and taper authorities remain independent and authoritative.'],
        reviewedOn: '2026-09-24', version: 1,
    },
    {
        id: OPTIMIZER_SCORING_CLAIM_IDS.readinessModifiedAerobicSupportPolicy,
        statement: 'Product candidate-selection policy v1: on a readiness-limited (modify-tier) day, an easier-dose aerobic exposure is marked isReadinessModifiedDose and does not earn exact aerobic_volume coverage credit (remaining at coverage tier 3 when it fulfills no other role) even when its reduced duration meets or exceeds a catalog minimumMin. Combined with preferred-alternative-aware unpreferred-modality demotion, readiness-modified aerobic candidates compete on equal coverage tier 3 urgency so primary/preferred-modality maintenance wins without claiming weekly aerobic_volume completion.',
        claimType: 'heuristic', maturity: 'heuristic', status: 'active', evidenceCertainty: 'not_applicable', recommendationStrength: 'conditional', safetyImpact: 'low',
        applicability: { contexts: ['candidate_selection', 'week_ahead_planning'], sports: ['all_supported_sports'], populations: ['app_users'], outcomes: ['readiness_modified_aerobic_ranking'], horizon: 'acute' },
        evidence: [{ sourceId: OPTIMIZER_SCORING_PRODUCT_POLICY_SOURCE, directness: 'direct' }],
        limitations: ['Excluding modify-tier easier doses from exact aerobic_volume coverage is product role-accounting calibration, not a physiological dose-equivalence claim. Readiness-modified easier doses preserve light aerobic maintenance on modify days while leaving the exact weekly aerobic_volume requirement open for full-prescription days.'],
        reviewedOn: '2026-09-24', version: 1,
    },
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
        statement: 'Product optimizer scoring v1: Rest returns 0.1. When stimulusProfile is absent or unresolvedObjectives is empty, Mobility/Recovery returns 0.2, Technical Skill returns 0.3, and every other category returns min(0.75, 0.45 + 0.2*(aerobicEndurance + thresholdPower)), with missing stimulusProfile contributing zero to that sum. When objective scoring is active, qualified weekly objectives use multipliers of 1.5 for thresholdPower, repeatedSurges and vo2MaxPower; 1.2 for aerobicEndurance and fatigueResistance; and a strength term of 1.6 * max(target.maxStrength, target.hypertrophy) * max(stimulus.maxStrength, stimulus.hypertrophy), so either strength axis can supply that term. sprintPower has no dedicated objective-benefit term. In that objective-scoring branch, Mobility/Recovery uses a 0.2 non-objective baseline and other non-Rest categories use 0.5; the baseline is returned when no qualified target contributes and is added when benefit is non-zero.',
        claimType: 'heuristic', maturity: 'heuristic', status: 'active', evidenceCertainty: 'not_applicable', recommendationStrength: 'conditional', safetyImpact: 'low',
        applicability: { contexts: ['candidate_selection', 'stimulus_benefit_scoring'], sports: ['all_supported_sports'], populations: ['app_users'], outcomes: ['candidate_benefit_score'], horizon: 'acute' },
        evidence: [{ sourceId: OPTIMIZER_SCORING_PRODUCT_POLICY_SOURCE, directness: 'direct' }],
        limitations: ['Utility calibration determines relative preference among candidate sessions that satisfy constraints; the multipliers, strength-axis max fusion and fallback curve reflect product emphasis across adaptation targets, not empirical effect sizes.'],
        reviewedOn: '2026-09-03', version: 1,
    },
    {
        id: OPTIMIZER_SCORING_CLAIM_IDS.eventPriorityMultipliersPolicyV1,
        statement: 'Product optimizer scoring v1: event matching is modality-based (cycling_event -> Cycling, running_race -> Running, strength_meet -> Strength, triathlon -> Cycling or Running). A matching candidate is multiplied by 1.40 for an A-priority event and 1.25 for a B-priority event; for strength_meet, that priority boost applies only when the candidate satisfies an unresolved objective (the current nominated-anchor matcher is cycling-only). For B events, a second race-specific endurance session within 6 days is multiplied by 0.35. At distances >21 days from race date, race-specific endurance sessions are multiplied by 0.50. A non-matching candidate is multiplied by 0.20 only when unresolved objectives exist and the candidate is neither explicitly preferred nor itself satisfying an unresolved objective.',
        claimType: 'heuristic', maturity: 'heuristic', status: 'deprecated', evidenceCertainty: 'not_applicable', recommendationStrength: 'conditional', safetyImpact: 'low',
        applicability: { contexts: ['candidate_selection', 'event_priority_ranking'], sports: ['all_supported_sports'], populations: ['app_users_with_target_events'], outcomes: ['candidate_benefit_score'], horizon: 'acute' },
        evidence: [{ sourceId: OPTIMIZER_SCORING_PRODUCT_POLICY_SOURCE, directness: 'direct' }],
        limitations: ['Event priority multipliers shape session ranking toward specific event deadlines and types; event-modality matching and the strength-meet qualification exception are product utility rules rather than physiological adaptation rates.'],
        reviewedOn: '2026-09-03', version: 1,
    },
    {
        id: OPTIMIZER_SCORING_CLAIM_IDS.eventPriorityMultipliersPolicy,
        statement: 'Product optimizer scoring v3: event matching is modality-based (cycling_event -> Cycling, running_race -> Running, strength_meet -> Strength, triathlon -> Swimming, Cycling or Running). Existing A/B event-aware ranking remains unchanged: a matching candidate is multiplied by 1.40 for an A-priority event and 1.25 for a B-priority event; for strength_meet, that priority boost applies only when the candidate satisfies an unresolved objective (the current nominated-anchor matcher is cycling-only). C-priority cycling_event, running_race and triathlon candidates enter the same event-aware ranking with a neutral 1.00 multiplier, while C-priority general_target and strength_meet retain their prior no-op behavior. B endurance events dampen a second race-specific endurance session within 6 days by 0.35; C endurance events without an active authored taper retain build volume through D-3 and apply that repeat dampener only in the final 48 hours. An active athlete-authored taper on a C event restores the resolved taper-window restriction and repeat dampener. Within the final 35 days before a low-surge cycling durability event (aerobicEndurance>=0.8, fatigueResistance>=0.8, repeatedSurges<0.6), a Cycling candidate with repeatedSurges>=0.6 above event demand remains eligible but has its benefit multiplied by event repeatedSurges / candidate repeatedSurges; this specificity multiplier does not apply earlier than D-35. At distances >21 days from race date, race-specific endurance sessions are multiplied by 0.50. A non-matching candidate is multiplied by 0.20 only when unresolved objectives exist and the candidate is neither explicitly preferred nor itself satisfying an unresolved objective.',
        claimType: 'heuristic', maturity: 'heuristic', status: 'active', evidenceCertainty: 'not_applicable', recommendationStrength: 'conditional', safetyImpact: 'low',
        applicability: { contexts: ['candidate_selection', 'event_priority_ranking'], sports: ['all_supported_sports'], populations: ['app_users_with_target_events'], outcomes: ['candidate_benefit_score'], horizon: 'acute' },
        evidence: [{ sourceId: OPTIMIZER_SCORING_PRODUCT_POLICY_SOURCE, directness: 'direct' }],
        limitations: ['Event priority multipliers shape session ranking toward specific event deadlines and types; the A/B/C utility values and repeat-session dampener are product rules rather than physiological adaptation rates. C endurance competitions intentionally retain the canonical no-default-taper train-through behavior, and unrelated C general targets/strength meets are deliberately left unchanged by this policy.', 'The six-day window, 0.35 repeat multiplier, D-35 specificity boundary, 0.6 high-surge threshold and event/candidate surge ratio are product calibration values, not universal physiological cut-points.'],
        reviewedOn: '2026-09-23', version: 2,
        supersedes: OPTIMIZER_SCORING_CLAIM_IDS.eventPriorityMultipliersPolicyV1,
    },
    {
        id: OPTIMIZER_SCORING_CLAIM_IDS.recoveryStreakHeuristicsPolicy,
        statement: 'Product optimizer scoring v1: with mixed recovery style, Mobility/Recovery is multiplied by 1.40 when the most recent recovery entry was Rest or no recovery entry exists, while Rest is multiplied by 1.40 when the most recent recovery entry was Mobility/Recovery. Across the contiguous prior run of non-recovery training days (up to 14 calendar days), days with systemicCost >= 0.40 contribute to the recovery streak count. When unresolved objectives are empty and the count is <3, aerobic defaults are multiplied by 1.25; at count >=3, Rest/Mobility is multiplied by 2.0 while aerobic defaults are multiplied by 0.3, tightening to 0.1 at count >=4. If the most recent prior recorded session has systemicCost >=0.50, another candidate with systemicCost >=0.50 receives a 0.35x multiplier.',
        claimType: 'heuristic', maturity: 'heuristic', status: 'active', evidenceCertainty: 'not_applicable', recommendationStrength: 'conditional', safetyImpact: 'moderate',
        applicability: { contexts: ['candidate_selection', 'training_streak_management'], sports: ['all_supported_sports'], populations: ['app_users'], outcomes: ['candidate_utility_score'], horizon: 'acute' },
        evidence: [{ sourceId: OPTIMIZER_SCORING_PRODUCT_POLICY_SOURCE, directness: 'direct' }],
        limitations: ['Recovery alternation and training-streak shaping prevent monotonous recovery choices and excessive uninterrupted loading when plan objectives are satisfied; the 14-day lookback, 0.40/0.50 thresholds, and 1.40x/1.25x/2.0x/0.3x/0.1x/0.35x multipliers are product calibration values.'],
        reviewedOn: '2026-09-03', version: 1,
    },
    {
        id: OPTIMIZER_SCORING_CLAIM_IDS.rollingLoadBudgetPolicy,
        statement: 'Product rolling-load budget v2: when at least 3 completed exposures span at least 14 calendar days in the stable 42-day pre-window, the planner derives a per-athlete seven-day future catalog-cost envelope from that athlete\'s own weekly baseline with 15% headroom. Each dimension uses the greater of that individualized value and product floors of systemic 2.0, cardiovascular 3.0, lower-body 2.0, upper-body 2.0, impact-tissue 2.0 and neuromuscular 2.0. The seven-date accounting horizon begins tomorrow. The already-computed day-1 provisional recommendation is charged to that envelope but remains selected by the separate next-day evaluator; planner-generated day-2+ projected exercise candidates are gated using the dose actually prescribed. Candidate admission evaluates each dimension independently: pre-existing exceedance in an unrelated dimension does not veto a candidate with non-participating contribution (cost within 1e-9 floating-point tolerance), while a dimension blocks admission only when candidate cost exceeds 1e-9 and remaining capacity after admission is below -1e-9. Zero is structural non-participation subject only to floating-point tolerance; no non-zero de minimis threshold is implied. Fixed-activity and schedule-overlay expected costs reserve the same horizon envelope without being reclassified as completed training. Clinical, injury and readiness authorities remain independent, and sparse history leaves the new gate inactive.',
        claimType: 'heuristic', maturity: 'heuristic', status: 'active', evidenceCertainty: 'not_applicable', recommendationStrength: 'conditional', safetyImpact: 'high',
        applicability: { contexts: ['candidate_selection', 'load_management', 'week_ahead_planning'], sports: ['all_supported_sports'], populations: ['app_users_with_stable_training_history'], outcomes: ['bounded_discretionary_catalog_load'], horizon: 'chronic' },
        evidence: [{ sourceId: OPTIMIZER_SCORING_PRODUCT_POLICY_SOURCE, directness: 'direct' }],
        limitations: [
            'Training-load monitoring and stress-recovery evidence support longitudinal individualization, but do not validate the normalized catalog-cost scale, the 15% headroom, or the product floors as physiological constants.',
            'This envelope is a conservative product guardrail for forecast allocation, not a diagnosis, injury probability, medical limit, or claim of universal dose-response.',
            'The budget must not be increased from a physiological identity score or from a single HRV/readiness value; prospective outcome calibration remains required before relaxing it.',
            'Dimensional admission isolates non-participating contributions within floating-point tolerance (1e-9) only; non-zero costs exceeding tolerance are not dismissed as de minimis without explicit calibrated product policy.',
        ],
        reviewedOn: '2026-09-21', version: 2,
    },
];
