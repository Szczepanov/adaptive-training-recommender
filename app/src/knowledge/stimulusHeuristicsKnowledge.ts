import type { KnowledgeClaim, KnowledgeSource } from './sportsKnowledge';

/**
 * SKR3 Workstream W2b: Stimulus Credit & Remaining Product Heuristics (11 families).
 *
 * Registers product-policy calibration records for stimulus credit formulas, fatigue fusion,
 * ambient step surge scaling, plan-tier cost ceilings, post-recover hysteresis buffers,
 * evergreen history qualification thresholds, default commitment profiles, and dose packing
 * tie-breakers.
 *
 * Per ADR-0033 and `docs/plans/2026-09-02-skr3-completion-plan.md` §W2, these families are
 * internal software heuristics and engineering calibration. They are registered with
 * `evidenceCertainty: 'not_applicable'` and explicit alignment tests to prevent drift.
 */
export const STIMULUS_HEURISTICS_CLAIM_IDS = {
    objectiveCreditConfidencePolicy: 'policy.stimulus.objective_credit_confidence_v1',
    raceSpecificCreditFormulaPolicy: 'policy.stimulus.race_specific_credit_formula_v1',
    coverageThresholdPolicy: 'policy.stimulus.coverage_threshold_v1',
    legacyKeywordCreditPolicy: 'policy.stimulus.legacy_keyword_credit_v1',
    aerobicVolumeFloorPolicy: 'policy.stimulus.aerobic_volume_athlete_relative_floor_v1',
    weeklyAerobicDoseEnvelopePolicy: 'policy.stimulus.weekly_aerobic_dose_envelope_v1',
    maxFusionPolicy: 'policy.fatigue.max_fusion_policy_v1',
    ambientStepSurgePolicy: 'policy.fatigue.ambient_step_surge_v1',
    planTierCostCeilingsPolicy: 'policy.readiness.plan_tier_cost_ceilings_v1',
    postRecoverBufferPolicy: 'policy.readiness.post_recover_buffer_v1',
    trainingHistoryQualificationPolicy: 'policy.evergreen.training_history_qualification_v1',
    defaultWeeklyCommitmentPolicy: 'policy.evergreen.default_weekly_commitment_v1',
    legacySessionSpacingTiebreakPolicy: 'policy.packing.legacy_session_spacing_tiebreak_v1',
} as const;

const STIMULUS_CREDIT_POLICY_SOURCE = 'PRODUCT-STIMULUS-CREDIT-POLICY-V1';
const FATIGUE_READINESS_HEURISTICS_SOURCE = 'PRODUCT-FATIGUE-READINESS-HEURISTICS-POLICY-V1';
const PLANNING_PRIORS_SOURCE = 'PRODUCT-PLANNING-PRIORS-POLICY-V1';

export const STIMULUS_HEURISTICS_SOURCES: readonly KnowledgeSource[] = [
    {
        id: STIMULUS_CREDIT_POLICY_SOURCE,
        title: 'Adaptive Training Recommender stimulus credit calibration policy v1',
        sourceType: 'product_policy',
        citation: 'Adaptive Training Recommender product policy, reviewed 2026-09-02.',
        publishedOn: '2026-09-02',
        notes: 'Registers the exact confidence discounting weights, race-specific credit blending formula, qualification threshold, and legacy keyword compatibility credit as product policy.',
    },
    {
        id: FATIGUE_READINESS_HEURISTICS_SOURCE,
        title: 'Adaptive Training Recommender fatigue & readiness heuristics policy v1',
        sourceType: 'product_policy',
        citation: 'Adaptive Training Recommender product policy, reviewed 2026-09-02.',
        publishedOn: '2026-09-02',
        notes: 'Registers dimensional fatigue max-fusion, ambient step surge excess scaling, readiness plan tier systemic cost ceilings, and the post-recover one-day buffer as product policy.',
    },
    {
        id: PLANNING_PRIORS_SOURCE,
        title: 'Adaptive Training Recommender planning priors & history qualification policy v1',
        sourceType: 'product_policy',
        citation: 'Adaptive Training Recommender product policy, reviewed 2026-09-02.',
        publishedOn: '2026-09-02',
        notes: 'Registers training-history qualification thresholds, default commitment profile priors, and dose packing tie-break preferences as product policy.',
    },
];

export const STIMULUS_HEURISTICS_CLAIMS: readonly KnowledgeClaim[] = [
    {
        id: STIMULUS_HEURISTICS_CLAIM_IDS.objectiveCreditConfidencePolicy,
        statement: 'Product stimulus credit v1: objective credit discounts delivered stimulus evidence by confidence tier before dose completion scaling: exact evidence earns 1.0 weight, inferred evidence earns 0.75 weight, and unknown evidence earns 0.40 weight.',
        claimType: 'heuristic', maturity: 'heuristic', status: 'active', evidenceCertainty: 'not_applicable', recommendationStrength: 'conditional', safetyImpact: 'moderate',
        applicability: { contexts: ['stimulus_credit', 'completed_training_reconciliation'], sports: ['all_supported_sports'], populations: ['app_users'], outcomes: ['objective_credit_earned'], horizon: 'acute' },
        evidence: [{ sourceId: STIMULUS_CREDIT_POLICY_SOURCE, directness: 'direct' }],
        limitations: ['Confidence discounting reflects measurement and inference uncertainty rather than physiological adaptation rates; exact weights 1.0/0.75/0.40 are engineering policy.'],
        reviewedOn: '2026-09-02', version: 1,
    },
    {
        id: STIMULUS_HEURISTICS_CLAIM_IDS.raceSpecificCreditFormulaPolicy,
        statement: 'Product stimulus credit v1: race-specific endurance objective credit uses max(fatigueResistance, 0.5*aerobicEndurance + 0.5*repeatedSurges); other single-key objectives take their matching canonical axis value, or max(maxStrength, hypertrophy) for strength.',
        claimType: 'heuristic', maturity: 'heuristic', status: 'active', evidenceCertainty: 'not_applicable', recommendationStrength: 'conditional', safetyImpact: 'low',
        applicability: { contexts: ['stimulus_credit', 'weekly_objective_progress'], sports: ['cycling', 'running', 'endurance_multisport'], populations: ['app_users'], outcomes: ['race_specific_objective_credit'], horizon: 'acute' },
        evidence: [{ sourceId: STIMULUS_CREDIT_POLICY_SOURCE, directness: 'direct' }],
        limitations: ['The equal blend of aerobic endurance and repeated surges as an alternative to fatigue resistance is a heuristic mapping, not an empirically validated formula.'],
        reviewedOn: '2026-09-02', version: 1,
    },
    {
        id: STIMULUS_HEURISTICS_CLAIM_IDS.coverageThresholdPolicy,
        statement: 'Product stimulus credit v1: weekly objective qualification and planning coverage check uses a 0.60 stimulus qualification threshold across required stimulus axes.',
        claimType: 'heuristic', maturity: 'heuristic', status: 'active', evidenceCertainty: 'not_applicable', recommendationStrength: 'conditional', safetyImpact: 'low',
        applicability: { contexts: ['stimulus_credit', 'microcycle_progress'], sports: ['all_supported_sports'], populations: ['app_users'], outcomes: ['stimulus_coverage_qualification'], horizon: 'acute' },
        evidence: [{ sourceId: STIMULUS_CREDIT_POLICY_SOURCE, directness: 'direct' }],
        limitations: ['The 0.60 threshold is an internal product cutoff determining whether a candidate session sufficiently addresses a programming role.'],
        reviewedOn: '2026-09-02', version: 1,
    },
    {
        id: STIMULUS_HEURISTICS_CLAIM_IDS.legacyKeywordCreditPolicy,
        statement: 'Product stimulus credit v1: legacy free-text objective matching earns a conservative 0.50 credit per exposure and cannot resolve a one-credit weekly objective by itself.',
        claimType: 'heuristic', maturity: 'heuristic', status: 'active', evidenceCertainty: 'not_applicable', recommendationStrength: 'conditional', safetyImpact: 'low',
        applicability: { contexts: ['stimulus_credit', 'legacy_compatibility'], sports: ['all_supported_sports'], populations: ['app_users'], outcomes: ['compatibility_objective_credit'], horizon: 'acute' },
        evidence: [{ sourceId: STIMULUS_CREDIT_POLICY_SOURCE, directness: 'direct' }],
        limitations: ['Legacy keyword credit is backward-compatibility logic for workouts lacking structured stimulus profiles; it deliberately discounts unstructured free text.'],
        reviewedOn: '2026-09-02', version: 1,
    },
    {
        id: STIMULUS_HEURISTICS_CLAIM_IDS.aerobicVolumeFloorPolicy,
        statement: 'Product aerobic-volume coverage floor v1 (#757): weekly aerobic_volume coverage stays binary, and a continuous aerobic session earns exact role credit only when its duration (actual for a completed session; the upper bound of the prescribed range for a planned one, whose lower bound must still reach the catalog minimum) reaches one athlete-level floor, max(catalog minimum, 0.75 x median), rounded to the nearest 5 minutes and clamped to the catalog maximum of each workout (and, for a planned template, its uncapped standard durationMax). The median is taken over full-dose Cycling, Running, Walking and Swimming sessions of at least the 30-minute catalog minimum in the preceding 28 days, excluding readiness-modified doses; with fewer than 4 such sessions the floor stays at the catalog minimum. The same floor applies to every aerobic modality and budgets the packed aerobic_volume role; it is not clamped to the daily time cap, so an unreachable floor is reported as a packing shortfall rather than satisfied by a different modality.',
        claimType: 'heuristic', maturity: 'heuristic', status: 'active', evidenceCertainty: 'not_applicable', recommendationStrength: 'conditional', safetyImpact: 'low',
        applicability: { contexts: ['coverage_admission', 'weekly_role_credit'], sports: ['cycling', 'running', 'walking', 'endurance_multisport', 'general_physical_activity'], populations: ['app_users'], outcomes: ['aerobic_volume_coverage_credit'], horizon: 'acute' },
        evidence: [{ sourceId: STIMULUS_CREDIT_POLICY_SOURCE, directness: 'direct' }],
        limitations: [
            'Evidence does not show a sharp minimum-effective-session threshold in trained athletes; aerobic adaptation tracks accumulated volume and intensity over weeks.',
            'The 0.75 fraction, 28-day window, 4-session minimum and 5-minute rounding are product calibration heuristics, not physiological constants.',
            'This is a coverage-admission floor, not a claim of dose adequacy; the dose-scaled zone2_aerobic objective ledger remains separate, and converging the two ledgers (partial coverage credit) is deferred.',
            'Applying one athlete-level floor across modalities deliberately prevents a short non-primary session from satisfying the role; it does not model modality-specific aerobic equivalence.',
        ],
        reviewedOn: '2026-09-25', version: 1,
    },
    {
        id: STIMULUS_HEURISTICS_CLAIM_IDS.weeklyAerobicDoseEnvelopePolicy,
        statement: 'Product weekly aerobic-dose envelope v1 (#806): after at least 28 observed days, an established athlete with easy continuous aerobic sessions in at least 3 of the 4 fixed prior weeks receives a low-intensity weekly target from the median of those four weekly minute totals, or the upper observed quartile in an endurance development phase; the floor is the greater of 150 minutes and the lower observed quartile, capped at the selected target. History of fewer than 4 primary-modality sessions does not nominate a long anchor. The anchor is one continuous authored session using the 75th-percentile duration in that modality, capped by the authored identity maximum and the #757 session floor, when it fits real capacity; taper, post-event recovery, adverse recovery and current clinical symptoms suspend it. Quality-session minutes are not converted to low-intensity minutes, and athlete-history targets are restricted to the historically primary modality.',
        claimType: 'heuristic', maturity: 'heuristic', status: 'active', evidenceCertainty: 'not_applicable', recommendationStrength: 'conditional', safetyImpact: 'moderate',
        applicability: { contexts: ['weekly_aerobic_dose', 'low_intensity_support', 'long_aerobic_anchor'], sports: ['cycling', 'running', 'walking', 'swimming', 'endurance_multisport'], populations: ['established_app_users'], outcomes: ['weekly_aerobic_dose_target', 'long_aerobic_role'], horizon: 'chronic' },
        evidence: [{ sourceId: STIMULUS_CREDIT_POLICY_SOURCE, directness: 'direct' }],
        limitations: [
            'Observed weekly training is a maintenance/productive-dose prior, not proof of an optimum, causal adaptation response, or biological minimum.',
            'The 28-day window, three observed weeks, quartile selection, and percentile anchor duration are product calibration choices and require prospective outcome review.',
            'Minutes are counted only from sessions identified as easy continuous aerobic work; this does not claim equivalence across modalities. The primary modality is selected from observed low-intensity minutes.',
            'The envelope does not replace readiness, tissue, capacity or rolling-load authorities. Temporary delivery limits do not rewrite the evidence-derived weekly target.',
        ],
        reviewedOn: '2026-09-26', version: 1,
    },
    {
        id: STIMULUS_HEURISTICS_CLAIM_IDS.maxFusionPolicy,
        statement: 'Product fatigue model v1: production combines external-load fatigue and internal-response fatigue by taking the dimensional maximum across all six dimensions (systemic, cardiovascular, lower-body, upper-body, impact-tissue, neuromuscular) to prevent double-counting; additive fusion is restricted to simulation experiments.',
        claimType: 'heuristic', maturity: 'heuristic', status: 'active', evidenceCertainty: 'not_applicable', recommendationStrength: 'conditional', safetyImpact: 'moderate',
        applicability: { contexts: ['fatigue_load_modeling', 'internal_response_fusion'], sports: ['all_supported_sports'], populations: ['app_users'], outcomes: ['combined_fatigue_state'], horizon: 'acute' },
        evidence: [{ sourceId: FATIGUE_READINESS_HEURISTICS_SOURCE, directness: 'direct' }],
        limitations: ['The max operator prevents double-counting between external work and autonomic/symptom response, but represents a conservative model assumption rather than a biological law.'],
        reviewedOn: '2026-09-02', version: 1,
    },
    {
        id: STIMULUS_HEURISTICS_CLAIM_IDS.ambientStepSurgePolicy,
        statement: 'Product fatigue model v1: ambient non-exercise steps trigger ambulatory tissue strain when exceeding 1.8x the 7-day average baseline with >=6000 excess ambient steps; tissue strain scales linearly up to a 0.4 cap at +15,000 excess steps. Structured running/field and walking/hiking sessions deduct estimated activity steps at 155 and 110 steps per minute, respectively.',
        claimType: 'heuristic', maturity: 'heuristic', status: 'active', evidenceCertainty: 'not_applicable', recommendationStrength: 'conditional', safetyImpact: 'moderate',
        applicability: { contexts: ['fatigue_load_modeling', 'ambient_activity_accounting'], sports: ['all_supported_sports'], populations: ['app_users'], outcomes: ['tissue_fatigue_strain'], horizon: 'acute' },
        evidence: [{ sourceId: FATIGUE_READINESS_HEURISTICS_SOURCE, directness: 'direct' }],
        limitations: ['Deducting activity steps and applying a 1.8x/6000-step surge threshold protects against unrecorded non-training loading, but cadence deductions and the 0.4 cap are engineering heuristics.'],
        reviewedOn: '2026-09-02', version: 1,
    },
    {
        id: STIMULUS_HEURISTICS_CLAIM_IDS.planTierCostCeilingsPolicy,
        statement: 'Product readiness envelope v1: catalog workout systemic cost is capped by allowable readiness tier: Rest caps at 0, Mobility caps at 0.15, Easy caps at 0.50 (matching the modify mode ceiling), Moderate caps at 0.80, and Hard allows uncapped systemic cost.',
        claimType: 'heuristic', maturity: 'heuristic', status: 'active', evidenceCertainty: 'not_applicable', recommendationStrength: 'conditional', safetyImpact: 'moderate',
        applicability: { contexts: ['readiness_envelope', 'catalog_session_eligibility'], sports: ['all_supported_sports'], populations: ['app_users'], outcomes: ['max_allowable_session_tier'], horizon: 'acute' },
        evidence: [{ sourceId: FATIGUE_READINESS_HEURISTICS_SOURCE, directness: 'direct' }],
        limitations: ['Tier boundaries map discrete readiness states onto continuous catalog systemic costs; exact cutoffs 0/0.15/0.50/0.80 are product policy.'],
        reviewedOn: '2026-09-02', version: 1,
    },
    {
        id: STIMULUS_HEURISTICS_CLAIM_IDS.postRecoverBufferPolicy,
        statement: "Product readiness envelope v1: a day that evaluates to train is downgraded to modify when the previous day's resolved mode was recover, providing a one-day temporal buffer before resuming normal full-volume training.",
        claimType: 'heuristic', maturity: 'heuristic', status: 'active', evidenceCertainty: 'not_applicable', recommendationStrength: 'conditional', safetyImpact: 'moderate',
        applicability: { contexts: ['readiness_envelope', 'temporal_hysteresis'], sports: ['all_supported_sports'], populations: ['app_users'], outcomes: ['recommended_mode'], horizon: 'acute' },
        evidence: [{ sourceId: FATIGUE_READINESS_HEURISTICS_SOURCE, directness: 'direct' }],
        limitations: ['Temporal hysteresis dampens rapid oscillation between recover and train; the one-day modify buffer is a conservative safety rule rather than an empirically fitted transition probability.'],
        reviewedOn: '2026-09-02', version: 1,
    },
    {
        id: STIMULUS_HEURISTICS_CLAIM_IDS.trainingHistoryQualificationPolicy,
        statement: 'Product evergreen dose v1: training history qualification requires >=14 observed days to avoid insufficient data; history <28 days is classified as limited; established training state requires >=28 observed days, >=12 completed sessions, and >=720 total training minutes.',
        claimType: 'heuristic', maturity: 'heuristic', status: 'active', evidenceCertainty: 'not_applicable', recommendationStrength: 'conditional', safetyImpact: 'moderate',
        applicability: { contexts: ['evergreen_dose', 'training_history_inference'], sports: ['all_supported_sports'], populations: ['app_users'], outcomes: ['athlete_training_state'], horizon: 'chronic' },
        evidence: [{ sourceId: PLANNING_PRIORS_SOURCE, directness: 'direct' }],
        limitations: ['The 14-day, 28-day, 12-session and 720-minute qualification floors are conservative priors guarding high-intensity exposure; they do not measure true biological training age.'],
        reviewedOn: '2026-09-02', version: 1,
    },
    {
        id: STIMULUS_HEURISTICS_CLAIM_IDS.defaultWeeklyCommitmentPolicy,
        statement: 'Product evergreen dose v1: an athlete without an authored training intent profile receives a conservative default weekly commitment of min 2, target 3, and max 4 sessions.',
        claimType: 'heuristic', maturity: 'heuristic', status: 'active', evidenceCertainty: 'not_applicable', recommendationStrength: 'conditional', safetyImpact: 'low',
        applicability: { contexts: ['evergreen_dose', 'unprofiled_athlete_defaults'], sports: ['all_supported_sports'], populations: ['app_users_without_intent_profile'], outcomes: ['weekly_commitment_sessions'], horizon: 'chronic' },
        evidence: [{ sourceId: PLANNING_PRIORS_SOURCE, directness: 'direct' }],
        limitations: ['The 2/3/4 session commitment prior is an authored product default. It is not derived from WHO activity-duration or strengthening-frequency recommendations and must not be presented as a scientifically validated session-count prescription.'],
        reviewedOn: '2026-09-02', version: 1,
    },
    {
        id: STIMULUS_HEURISTICS_CLAIM_IDS.legacySessionSpacingTiebreakPolicy,
        statement: 'Product dose packing v1: for otherwise equivalent weekly dose placements, preferred spacing between sessions is 3 days for 2 sessions/week, 2 days for 3 sessions/week, and 1 day for 4-6+ sessions/week.',
        claimType: 'heuristic', maturity: 'heuristic', status: 'active', evidenceCertainty: 'not_applicable', recommendationStrength: 'conditional', safetyImpact: 'low',
        applicability: { contexts: ['weekly_dose_packing', 'placement_tiebreak'], sports: ['all_supported_sports'], populations: ['app_users'], outcomes: ['preferred_session_spacing_days'], horizon: 'acute' },
        evidence: [{ sourceId: PLANNING_PRIORS_SOURCE, directness: 'direct' }],
        limitations: ['The spacing tie-break resolves schedule ties evenly across the microcycle; counts above six clamp to the six-session row, so 7+ also resolve to one-day preferred spacing. This remains a convenience heuristic that yields to hard eligibility and recovery constraints.'],
        reviewedOn: '2026-09-02', version: 1,
    },
];
