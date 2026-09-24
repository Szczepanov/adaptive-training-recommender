import type { KnowledgeClaim, KnowledgeSource } from './sportsKnowledge';

/**
 * Registers the unlogged physical-work (occupational/manual-labour) strain model that
 * `occupationalLoad.ts` `resolveOccupationalLoadContext` and `fatigue.ts`
 * `computeInternalResponseStrain` apply to D-1 non-exercise work.
 *
 * Per ADR-0033 these magnitudes, the baseline discount and the dimensional multipliers are
 * product calibration: there is no validated mapping from a three-level self-reported work
 * block to the engine's six fatigue dimensions. The claim is registered with
 * `evidenceCertainty: 'not_applicable'` and pinned by
 * `physicalWorkStrainPolicyAlignment.test.ts` so the numbers cannot drift silently.
 */
export const PHYSICAL_WORK_STRAIN_CLAIM_IDS = {
    physicalWorkStrainMappingPolicy: 'policy.fatigue.physical_work_strain_mapping_v1',
    physicalWorkReadinessModeGatesPolicy: 'policy.readiness.physical_work_mode_gates_v1',
    physicalWorkGuardrailsPolicy: 'policy.safety.physical_work_guardrails_v1',
} as const;

const PHYSICAL_WORK_STRAIN_POLICY_SOURCE = 'PRODUCT-PHYSICAL-WORK-STRAIN-POLICY-V1';

export const PHYSICAL_WORK_STRAIN_SOURCES: readonly KnowledgeSource[] = [
    {
        id: PHYSICAL_WORK_STRAIN_POLICY_SOURCE,
        title: 'Adaptive Training Recommender unlogged physical-work strain policy v1',
        sourceType: 'product_policy',
        citation: 'Adaptive Training Recommender product policy, reviewed 2026-09-24.',
        publishedOn: '2026-09-24',
        notes: 'Registers the physical-work strain model, raw-strain readiness mode gates, and area-specific guardrails as product policy.',
    },
];

export const PHYSICAL_WORK_STRAIN_CLAIMS: readonly KnowledgeClaim[] = [
    {
        id: PHYSICAL_WORK_STRAIN_CLAIM_IDS.physicalWorkStrainMappingPolicy,
        statement: 'Product fatigue model v1: a performed unlogged physical-work block has strain min(1, intensity x duration) with intensity moderate 0.45 / hard 0.70 / exhausting 0.88 and duration short 0.65 / medium 1.00 / extended 1.25; omitted detail defaults to moderate/medium. An occupational baseline softly discounts min(raw strain, baseline strain x baseline confidence x load-area overlap), where overlap is the share of reported areas inside the usual areas (1 when either list is absent). The remaining acute strain maps to systemic x0.60; upper-body x0.85 with no specific areas, upper_body or grip_forearms, else 0; lower-body x0.85 with no specific areas or legs_carrying, else 0; neuromuscular x0.75 with no specific areas, grip_forearms or lower_back_spine, else x0.40; impact-tissue x0.40 only for legs_carrying at hard or exhausting intensity. Each term is max-combined with the other internal-response terms.',
        claimType: 'heuristic', maturity: 'heuristic', status: 'active', evidenceCertainty: 'not_applicable', recommendationStrength: 'conditional', safetyImpact: 'moderate',
        applicability: { contexts: ['fatigue_load_modeling', 'internal_response_fusion', 'occupational_load'], sports: ['all_supported_sports'], populations: ['app_users_reporting_physical_work'], outcomes: ['internal_response_strain', 'candidate_fatigue_cost'], horizon: 'acute' },
        evidence: [{ sourceId: PHYSICAL_WORK_STRAIN_POLICY_SOURCE, directness: 'direct' }],
        limitations: [
            'The 0.45/0.70/0.88 intensity and 0.65/1.00/1.25 duration factors are authored ordinal mappings of a coarse self-report, not measured energy expenditure or mechanical load.',
            'The 0.60/0.85/0.75/0.40 dimensional multipliers and their load-area gating are product modeling choices; no cited evidence establishes how manual work partitions into systemic, regional, neuromuscular and impact fatigue.',
            'The baseline discount is a soft, confidence- and overlap-bounded adaptation assumption, not evidence that habitual occupational load stops producing fatigue.',
            'The ambient-step co-occurrence flag computed alongside the discount is diagnostic only and does not change strain.',
        ],
        reviewedOn: '2026-09-24', version: 1,
    },
    {
        id: PHYSICAL_WORK_STRAIN_CLAIM_IDS.physicalWorkReadinessModeGatesPolicy,
        statement: 'Product readiness policy v1: only a performed physical-work block participates. Raw strain is min(1, intensity x duration), with moderate 0.45 / hard 0.70 / exhausting 0.88 and short 0.65 / medium 1.00 / extended 1.25; omitted detail defaults to moderate/medium. Raw strain >=0.65 forces modify, and raw strain >=0.85 forces recover when subjective fatigue >=6 or soreness >=6. These gates use raw strain before any occupational-baseline discount of acute fatigue.',
        claimType: 'heuristic', maturity: 'heuristic', status: 'active', evidenceCertainty: 'not_applicable', recommendationStrength: 'conditional', safetyImpact: 'high',
        applicability: { contexts: ['readiness_mode_selection', 'occupational_load'], sports: ['all_supported_sports'], populations: ['app_users_reporting_physical_work'], outcomes: ['readiness_mode'], horizon: 'acute' },
        evidence: [{ sourceId: PHYSICAL_WORK_STRAIN_POLICY_SOURCE, directness: 'direct' }],
        limitations: [
            'The raw-strain gates and fatigue/soreness interaction are conservative product cutoffs, not validated occupational-load thresholds.',
            'A baseline can reduce the fatigue model contribution while the readiness gate still acts on raw reported work; this difference is intentional.',
        ],
        reviewedOn: '2026-09-24', version: 1,
    },
    {
        id: PHYSICAL_WORK_STRAIN_CLAIM_IDS.physicalWorkGuardrailsPolicy,
        statement: 'Product physical-work guardrail policy v1: for performed work, hard or exhausting intensity involving lower_back_spine adds avoid_heavy_spinal_loading; exhausting intensity involving upper_body or grip_forearms adds avoid_overhead_pressing. These temporary guardrails are unioned with existing injury-policy guardrails. Missing intensity or areas, moderate work, and unperformed work add no physical-work guardrail.',
        claimType: 'heuristic', maturity: 'heuristic', status: 'active', evidenceCertainty: 'not_applicable', recommendationStrength: 'conditional', safetyImpact: 'high',
        applicability: { contexts: ['occupational_load', 'session_safety_gating'], sports: ['all_supported_sports'], populations: ['app_users_reporting_physical_work'], outcomes: ['session_eligibility'], horizon: 'acute' },
        evidence: [{ sourceId: PHYSICAL_WORK_STRAIN_POLICY_SOURCE, directness: 'direct' }],
        limitations: [
            'The area and intensity cutoffs are conservative product choices, not validated injury or occupational-load thresholds.',
            'A physical-work guardrail indicates recent reported load, not a diagnosis or a standing injury restriction.',
        ],
        reviewedOn: '2026-09-24', version: 1,
    },
];
