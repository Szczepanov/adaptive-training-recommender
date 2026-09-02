import { getActiveKnowledgeClaim, KNOWLEDGE_CLAIM_IDS } from './sportsKnowledgeRegistry.ts';

export type KnowledgeAssumptionClassification =
    | 'scientific_claim'
    | 'product_heuristic'
    | 'athlete_specific_rule'
    | 'safety_invariant'
    | 'implementation_constant';
export type KnowledgeCoverageState = 'covered' | 'partial' | 'uncovered' | 'not_applicable';
export type KnowledgeDecisionImpact = 'low' | 'moderate' | 'high';
export type KnowledgeSafetyImpact = 'low' | 'moderate' | 'high';
export type KnowledgeResearchPriority = 'p0' | 'p1' | 'p2' | 'p3' | 'none';
export type KnowledgeCoverageDomain =
    | 'evergreen_dose' | 'readiness_recovery' | 'fatigue_load' | 'injury_safety'
    | 'session_spacing' | 'optimizer_scoring' | 'periodization_taper' | 'event_demand'
    | 'stimulus_credit' | 'data_trust' | 'planning_capacity' | 'workout_catalog';

export interface EngineKnowledgeCoverageItem {
    /** Stable audit identity. Do not encode file names or line numbers into the id. */
    id: string;
    domain: KnowledgeCoverageDomain;
    title: string;
    /** Exact current policy in concise human-readable form, including material thresholds. */
    currentRule: string;
    classification: KnowledgeAssumptionClassification;
    coverage: KnowledgeCoverageState;
    decisionImpact: KnowledgeDecisionImpact;
    safetyImpact: KnowledgeSafetyImpact;
    researchPriority: KnowledgeResearchPriority;
    /** Symbols/files owning the decision. These are navigational audit references, not scientific citations. */
    codeRefs: readonly string[];
    /** Existing Sports Knowledge Registry claims materially supporting this policy family. */
    knowledgeRefs: readonly string[];
    /** What remains unsupported or why external sports evidence is not applicable. */
    coverageRationale: string;
}

export interface KnowledgeCoverageValidation { valid: boolean; errors: string[]; warnings: string[]; }
export interface KnowledgeCoverageSummary {
    total: number;
    byCoverage: Record<KnowledgeCoverageState, number>;
    byClassification: Record<KnowledgeAssumptionClassification, number>;
    byPriority: Record<KnowledgeResearchPriority, number>;
    highImpactUncovered: number;
    highSafetyUncovered: number;
}

/**
 * Current decision-authority knowledge inventory.
 *
 * `covered` means the rule has adequate explicit lineage for its current epistemic status.
 * For a product heuristic that can mean a reviewed scientific boundary plus an explicit
 * product-policy claim for the exact scalar. It does not mean an internal threshold was
 * scientifically validated. `partial` means a material sub-surface remains unaudited and
 * therefore must keep a research priority.
 */
export const ENGINE_KNOWLEDGE_COVERAGE: readonly EngineKnowledgeCoverageItem[] = [
    {
        id: 'workout_catalog.strength_warmup_invariant', domain: 'workout_catalog', title: 'Catalog strength warm-up invariant',
        currentRule: 'Every active non-manual catalog strength workout begins with a non-empty warm-up block that remains inside its advertised session duration.',
        classification: 'product_heuristic', coverage: 'covered', decisionImpact: 'moderate', safetyImpact: 'low', researchPriority: 'none',
        codeRefs: ['workouts/validation.ts:validateWorkoutLibrary', 'workouts/catalog/*.ts'], knowledgeRefs: [KNOWLEDGE_CLAIM_IDS.contextualPreparation, KNOWLEDGE_CLAIM_IDS.specificRehearsal],
        coverageRationale: 'The rule is a cautious product implementation of conditional acute preparation and rehearsal evidence; it deliberately avoids a universal dose or injury-prevention claim.',
    },
    {
        id: 'evergreen.adult_aerobic_weekly_volume', domain: 'evergreen_dose', title: 'Adult aerobic health-volume floor and range',
        currentRule: 'Evergreen health/balanced planning uses 150 min/week as the non-droppable aerobic floor and a 150-300 min target range.',
        classification: 'scientific_claim', coverage: 'covered', decisionImpact: 'high', safetyImpact: 'low', researchPriority: 'none',
        codeRefs: ['engine/evergreenStrategy.ts:aerobicRequirement'], knowledgeRefs: [KNOWLEDGE_CLAIM_IDS.adultAerobicHealthVolume],
        coverageRationale: 'Directly linked to the active WHO-backed adult aerobic-volume claim.',
    },
    {
        id: 'evergreen.adult_strength_weekly_frequency', domain: 'evergreen_dose', title: 'Adult strength health-frequency floor',
        currentRule: 'Evergreen health/balanced planning requires two strength sessions per week.',
        classification: 'scientific_claim', coverage: 'covered', decisionImpact: 'high', safetyImpact: 'low', researchPriority: 'none',
        codeRefs: ['engine/evergreenStrategy.ts:strengthRequirement'], knowledgeRefs: [KNOWLEDGE_CLAIM_IDS.adultStrengthHealthFrequency],
        coverageRationale: 'Directly linked to the active WHO-backed two-or-more-days strength claim.',
    },
    {
        id: 'evergreen.strength_default_upper_target', domain: 'evergreen_dose', title: 'Evergreen strength default upper target',
        currentRule: 'The general Evergreen allocation target is bounded at three strength sessions per week.',
        classification: 'product_heuristic', coverage: 'covered', decisionImpact: 'moderate', safetyImpact: 'low', researchPriority: 'none',
        codeRefs: ['engine/evergreenStrategy.ts:strengthRequirement'], knowledgeRefs: [KNOWLEDGE_CLAIM_IDS.adultStrengthDefaultUpperTarget],
        coverageRationale: 'Explicitly registered as a product heuristic, separate from the WHO >=2-day recommendation.',
    },
    {
        id: 'evergreen.high_intensity_weekly_prior', domain: 'evergreen_dose', title: 'Conditional high-intensity weekly prior',
        currentRule: 'When recent training evidence qualifies, Evergreen targets one high-intensity session and permits no more than two per week.',
        classification: 'product_heuristic', coverage: 'covered', decisionImpact: 'high', safetyImpact: 'moderate', researchPriority: 'none',
        codeRefs: ['engine/evergreenStrategy.ts:resolveEvidenceBackedStrategy'], knowledgeRefs: [KNOWLEDGE_CLAIM_IDS.conditionalHighIntensityPrior],
        coverageRationale: 'The weekly target/cap is explicitly registered as a conservative product prior. Qualification thresholds are inventoried separately.',
    },
    {
        id: 'evergreen.default_weekly_commitment', domain: 'evergreen_dose', title: 'Unsaved-profile weekly commitment default',
        currentRule: 'An athlete without a saved intent profile receives min/target/max session counts of 2/3/4.',
        classification: 'product_heuristic', coverage: 'covered', decisionImpact: 'moderate', safetyImpact: 'low', researchPriority: 'none',
        codeRefs: ['engine/evergreenStrategy.ts:DEFAULT_TRAINING_INTENT_PROFILE'],
        knowledgeRefs: [KNOWLEDGE_CLAIM_IDS.defaultWeeklyCommitmentPolicy],
        coverageRationale: 'Registered as an explicit product-policy claim (`policy.evergreen.default_weekly_commitment_v1`) with alignment testing. Authoring 2/3/4 provides a safe starting baseline within WHO guidelines for unprofiled athletes.',
    },
    {
        id: 'evergreen.training_history_qualification', domain: 'evergreen_dose', title: 'Training-history qualification for performance priors',
        currentRule: 'History <14 days is insufficient; <28 days is limited; established requires >=28 observed days, >=12 sessions and >=720 total minutes.',
        classification: 'product_heuristic', coverage: 'covered', decisionImpact: 'high', safetyImpact: 'moderate', researchPriority: 'none',
        codeRefs: ['engine/evergreenStrategy.ts:inferAthleteTrainingState'],
        knowledgeRefs: [KNOWLEDGE_CLAIM_IDS.trainingHistoryQualificationPolicy],
        coverageRationale: 'Registered as an explicit product-policy claim (`policy.evergreen.training_history_qualification_v1`) with alignment testing. Qualification floors prevent unwarranted high-intensity allocation without pretending to measure true biological training age.',
    },
    {
        id: 'packing.legacy_session_spacing_tiebreak', domain: 'session_spacing', title: 'Legacy weekly session-spacing tie-break',
        currentRule: 'For otherwise equivalent dose placements, preferred spacing is 3 days at 2 sessions/week, 2 days at 3, and 1 day at 4-6+.',
        classification: 'product_heuristic', coverage: 'covered', decisionImpact: 'low', safetyImpact: 'low', researchPriority: 'none',
        codeRefs: ['engine/weeklyDosePacking.ts:LEGACY_SESSION_COUNT_TIE_BREAKER'],
        knowledgeRefs: [KNOWLEDGE_CLAIM_IDS.legacySessionSpacingTiebreakPolicy],
        coverageRationale: 'Registered as an explicit product-policy claim (`policy.packing.legacy_session_spacing_tiebreak_v1`) with alignment testing. A deterministic schedule tie-breaker that yields to all hard eligibility and fatigue recovery constraints.',
    },
    {
        id: 'readiness.physiological_strain_model', domain: 'readiness_recovery', title: 'HRV/RHR/sleep/respiration strain model',
        currentRule: 'Uses weights HRV 0.5, RHR 0.3, sleep 0.2, respiration 0.3; variability floors 3 ms/1.5 bpm/4 points/1 brpm; z cap 2.0; chronic component multiplier 1.5.',
        classification: 'product_heuristic', coverage: 'covered', decisionImpact: 'high', safetyImpact: 'moderate', researchPriority: 'none',
        codeRefs: ['engine/rules.ts:metricStrain', 'engine/rules.ts:evaluateReadinessAndSafetyEnvelope'],
        knowledgeRefs: [KNOWLEDGE_CLAIM_IDS.hrvContextualMonitoring, KNOWLEDGE_CLAIM_IDS.hrvGuidedTrainingConditional, KNOWLEDGE_CLAIM_IDS.rhrContextualMonitoring, KNOWLEDGE_CLAIM_IDS.sleepPerformanceImportance, KNOWLEDGE_CLAIM_IDS.wearableSleepMeasurementLimits, KNOWLEDGE_CLAIM_IDS.respirationLongitudinalContext, KNOWLEDGE_CLAIM_IDS.readinessPhysiologicalStrainModel],
        coverageRationale: 'HRV and resting-HR evidence supports longitudinal, individualized, multi-signal interpretation; meaningful sleep loss is performance-relevant but consumer sleep scores retain measurement limits; nocturnal respiration can contribute contextual anomaly information but is not a specific illness/readiness marker. The exact weights, variability floors, z cap and chronic multiplier remain explicit product calibration rather than scientific coefficients.',
    },
    {
        id: 'readiness.subjective_mode_thresholds', domain: 'readiness_recovery', title: 'Subjective readiness mode thresholds',
        currentRule: 'Four-item physical fatigue average (fatigue, soreness, inverted readiness/sleep quality) >5 modifies and >7 recovers; motivation is excluded from the physical composite. Complete minimum-safety check-ins average only answered physical dimensions without neutral-default imputation. Additional fatigue/soreness/readiness/stress combinations at 3/4/6/8/9 thresholds can force modify/recover.',
        classification: 'product_heuristic', coverage: 'partial', decisionImpact: 'high', safetyImpact: 'high', researchPriority: 'p0',
        codeRefs: ['engine/rules.ts:evaluateReadinessAndSafetyEnvelope', 'engine/adapters.ts:mapCheckinToSubjectiveInput', 'engine/safetyCheckin.ts:getMinimumSafetyCheckinStatus'],
        knowledgeRefs: [KNOWLEDGE_CLAIM_IDS.contextualMonitoring, KNOWLEDGE_CLAIM_IDS.measurementQualityLimits, KNOWLEDGE_CLAIM_IDS.exactCutpointLimits, KNOWLEDGE_CLAIM_IDS.modeThresholdsPolicy],
        coverageRationale: 'SEP-C2 recalibrates the subjective classifier: motivation is decoupled from physical fatigue, unmeasured dimensions in partial check-ins participate dynamically without neutral-5 dilution, and clinical painFlag is decoupled from extreme fatigue. Direct action thresholds remain an explicit product heuristic rather than a universal constant; outcome-linked calibration remains P0 research debt.',
    },
    {
        id: 'readiness.absolute_device_floors', domain: 'readiness_recovery', title: 'Absolute sleep-score and Body Battery floors',
        currentRule: 'Sleep score <50 adds 0.5 strain; Body Battery is penalized below 50 to a 0.3 cap at 25; Body Battery <=20 forces recover; envelope is Easy below Body Battery 30 or sleep score 55.',
        classification: 'product_heuristic', coverage: 'covered', decisionImpact: 'high', safetyImpact: 'moderate', researchPriority: 'none',
        codeRefs: ['engine/rules.ts:evaluateReadinessAndSafetyEnvelope', 'engine/rules.ts:evaluateEnvelopes'],
        knowledgeRefs: [KNOWLEDGE_CLAIM_IDS.sleepPerformanceImportance, KNOWLEDGE_CLAIM_IDS.wearableSleepMeasurementLimits, KNOWLEDGE_CLAIM_IDS.readinessAbsoluteDeviceFloors],
        coverageRationale: 'Sleep loss is performance-relevant, but consumer sleep estimates and proprietary wellness scores have measurement/validation limits. The exact sleep-score and Body Battery floors are therefore explicit conservative product policy rather than claimed device-validated readiness thresholds.',
    },
    {
        id: 'readiness.acute_biometric_floors', domain: 'readiness_recovery', title: 'Acute HRV/RHR hard modify floors',
        currentRule: 'RHR delta >=+6 bpm with >=0.6 acute contribution or HRV delta <=-15 ms with >=1.0 acute contribution can force modify independent of the total score.',
        classification: 'product_heuristic', coverage: 'covered', decisionImpact: 'high', safetyImpact: 'moderate', researchPriority: 'none',
        codeRefs: ['engine/rules.ts:evaluateReadinessAndSafetyEnvelope'],
        knowledgeRefs: [KNOWLEDGE_CLAIM_IDS.hrvContextualMonitoring, KNOWLEDGE_CLAIM_IDS.hrvGuidedTrainingConditional, KNOWLEDGE_CLAIM_IDS.rhrContextualMonitoring, KNOWLEDGE_CLAIM_IDS.readinessAcuteBiometricFloors],
        coverageRationale: 'HRV/resting-HR changes can contribute to conservative training adjustment when interpreted against the athlete baseline, but the +6 bpm/-15 ms and contribution floors are explicitly product-authored cut-points rather than universal meaningful-change thresholds.',
    },
    {
        id: 'readiness.recent_hard_session_penalty', domain: 'readiness_recovery', title: 'Recent hard-session readiness penalty',
        currentRule: 'Two or more hard sessions in the prior three days adds 1.0 to readiness strain.',
        classification: 'product_heuristic', coverage: 'covered', decisionImpact: 'high', safetyImpact: 'moderate', researchPriority: 'none',
        codeRefs: ['engine/rules.ts:evaluateReadinessAndSafetyEnvelope'],
        knowledgeRefs: [KNOWLEDGE_CLAIM_IDS.trainingStressRecoveryBalance, KNOWLEDGE_CLAIM_IDS.recentHardReadinessPenalty],
        coverageRationale: 'Recovery literature supports accounting for accumulated stress and individual recovery; the exact 3-day/count-2/+1.0 translation is explicitly registered as product calibration rather than presented as a scientific cutoff.',
    },
    {
        id: 'readiness.mode_score_thresholds', domain: 'readiness_recovery', title: 'Composite strain train/modify/recover thresholds',
        currentRule: 'Composite objective strain >=1.0 modifies and >=2.2 recovers; conservative mode adds 0.4 before those thresholds.',
        classification: 'product_heuristic', coverage: 'covered', decisionImpact: 'high', safetyImpact: 'high', researchPriority: 'none',
        codeRefs: ['engine/rules.ts:evaluateReadinessAndSafetyEnvelope'],
        knowledgeRefs: [KNOWLEDGE_CLAIM_IDS.hrvContextualMonitoring, KNOWLEDGE_CLAIM_IDS.rhrContextualMonitoring, KNOWLEDGE_CLAIM_IDS.sleepPerformanceImportance, KNOWLEDGE_CLAIM_IDS.respirationLongitudinalContext, KNOWLEDGE_CLAIM_IDS.trainingStressRecoveryBalance, KNOWLEDGE_CLAIM_IDS.readinessModeThresholds],
        coverageRationale: 'The external evidence supports contextual multi-signal monitoring and conservative load adjustment, not a universal readiness score. The exact 1.0/2.2/+0.4 action thresholds are explicit high-safety product policy and remain candidates for simulation and athlete-outcome calibration.',
    },
    {
        id: 'readiness.post_recover_buffer', domain: 'readiness_recovery', title: 'Post-recover one-day buffer',
        currentRule: 'A day that otherwise evaluates to train is downgraded to modify when the previous mode was recover.',
        classification: 'product_heuristic', coverage: 'covered', decisionImpact: 'moderate', safetyImpact: 'moderate', researchPriority: 'none',
        codeRefs: ['engine/rules.ts:evaluateReadinessAndSafetyEnvelope'],
        knowledgeRefs: [KNOWLEDGE_CLAIM_IDS.postRecoverBufferPolicy],
        coverageRationale: 'Registered as an explicit product-policy claim (`policy.readiness.post_recover_buffer_v1`) with alignment testing. A conservative temporal hysteresis rule dampening rapid oscillation between recover and train modes.',
    },
    {
        id: 'readiness.already_trained_fail_closed', domain: 'readiness_recovery', title: 'Already-trained same-day override',
        currentRule: 'A positive subjective already-trained answer or detected today training forces recover/no additional normal training.',
        classification: 'safety_invariant', coverage: 'not_applicable', decisionImpact: 'high', safetyImpact: 'high', researchPriority: 'none',
        codeRefs: ['engine/rules.ts:evaluateReadinessAndSafetyEnvelope'], knowledgeRefs: [],
        coverageRationale: 'Fail-closed duplicate-session prevention is a product safety invariant driven by known same-day work, not a claim that no athlete can ever train twice per day.',
    },
    {
        id: 'readiness.plan_tier_cost_ceilings', domain: 'readiness_recovery', title: 'Readiness plan-tier systemic cost ceilings',
        currentRule: 'Rest/Mobility/Easy/Moderate/Hard tiers cap systemicCost at 0/0.15/0.5/0.8/infinity; modify also caps at 0.5.',
        classification: 'product_heuristic', coverage: 'covered', decisionImpact: 'high', safetyImpact: 'moderate', researchPriority: 'none',
        codeRefs: ['engine/rules.ts:PLAN_TIER_SYSTEMIC_COST_CEILING', 'engine/rules.ts:evaluateTrainingWithIntent'],
        knowledgeRefs: [KNOWLEDGE_CLAIM_IDS.planTierCostCeilingsPolicy],
        coverageRationale: 'Registered as an explicit product-policy claim (`policy.readiness.plan_tier_cost_ceilings_v1`) with alignment testing. Binds discrete readiness tier states to continuous catalog systemic cost caps.',
    },
    {
        id: 'fatigue.dimension_half_lives', domain: 'fatigue_load', title: 'Dimensional fatigue decay half-lives',
        currentRule: 'Exponential half-lives are systemic 36h, cardiovascular 24h, lower-body 48h, upper-body 36h, impact tissue 48h and neuromuscular 36h.',
        classification: 'product_heuristic', coverage: 'covered', decisionImpact: 'high', safetyImpact: 'moderate', researchPriority: 'none',
        codeRefs: ['engine/fatigue.ts:DECAY_HALF_LIVES_HOURS', 'engine/fatigue.ts:decayFatigue'],
        knowledgeRefs: [KNOWLEDGE_CLAIM_IDS.trainingStressRecoveryBalance, KNOWLEDGE_CLAIM_IDS.strenuousLowerBodyResidualFatigue, KNOWLEDGE_CLAIM_IDS.fatigueDecayHalfLives],
        coverageRationale: 'Evidence supports heterogeneous residual fatigue after strenuous work; the exact six exponential half-lives are explicitly registered as a compact product model rather than scientific recovery constants.',
    },
    {
        id: 'fatigue.internal_response_model', domain: 'fatigue_load', title: 'Internal response strain normalization and fusion weights',
        currentRule: 'HRV drop saturates at 15 ms, RHR rise at 10 bpm, sleep strain begins below score 75; systemic is 0.4 subjective fatigue +0.3 HRV +0.3 sleep, cardiovascular 0.5 RHR +0.5 HRV, upper-body soreness multiplier 0.7, neuromuscular 0.5 fatigue +0.5 inverse motivation.',
        classification: 'product_heuristic', coverage: 'covered', decisionImpact: 'high', safetyImpact: 'moderate', researchPriority: 'none',
        codeRefs: ['engine/fatigue.ts:computeInternalResponseStrain'],
        knowledgeRefs: [KNOWLEDGE_CLAIM_IDS.hrvContextualMonitoring, KNOWLEDGE_CLAIM_IDS.rhrContextualMonitoring, KNOWLEDGE_CLAIM_IDS.sleepPerformanceImportance, KNOWLEDGE_CLAIM_IDS.internalResponseStrainModel],
        coverageRationale: 'HRV, resting HR, sleep and subjective symptoms are defensible complementary recovery inputs, but their exact normalization thresholds and fusion weights are explicitly registered as product modeling choices rather than inferred effect sizes.',
    },
    {
        id: 'fatigue.ambient_step_surge', domain: 'fatigue_load', title: 'Ambient step-surge tissue-strain heuristic',
        currentRule: 'Ambient steps trigger tissue strain at >=1.8x 7-day baseline and >=6000 excess steps; strain scales to 0.4 by +15000. Running/field and walking/hiking are estimated at 155/110 steps per minute for subtraction.',
        classification: 'product_heuristic', coverage: 'covered', decisionImpact: 'moderate', safetyImpact: 'moderate', researchPriority: 'none',
        codeRefs: ['engine/fatigue.ts:estimateActivitySteps', 'engine/fatigue.ts:computeInternalResponseStrain'],
        knowledgeRefs: [KNOWLEDGE_CLAIM_IDS.ambientStepSurgePolicy],
        coverageRationale: 'Registered as an explicit product-policy claim (`policy.fatigue.ambient_step_surge_v1`) with alignment testing. Cadence deduction and ambient surge scaling protect against unrecorded ambulatory load.',
    },
    {
        id: 'fatigue.max_fusion_policy', domain: 'fatigue_load', title: 'External/internal fatigue fusion policy',
        currentRule: 'Production combines external-load and internal-response fatigue by taking the maximum on each dimension; additive fusion is simulation-only.',
        classification: 'product_heuristic', coverage: 'covered', decisionImpact: 'high', safetyImpact: 'moderate', researchPriority: 'none',
        codeRefs: ['engine/fatigue.ts:combineFatigue'],
        knowledgeRefs: [KNOWLEDGE_CLAIM_IDS.maxFusionPolicy],
        coverageRationale: 'Registered as an explicit product-policy claim (`policy.fatigue.max_fusion_policy_v1`) with alignment testing. The dimensional max operator prevents double-counting between external workload and internal autonomic strain.',
    },
    {
        id: 'safety.minimum_checkin_gate', domain: 'injury_safety', title: 'Minimum safety check-in fail-closed gate',
        currentRule: 'Normal training requires answered pain/injury, illness and already-trained flags plus a valid fatigue or soreness score; missing/incomplete state returns provisional Rest.',
        classification: 'safety_invariant', coverage: 'not_applicable', decisionImpact: 'high', safetyImpact: 'high', researchPriority: 'none',
        codeRefs: ['engine/safetyCheckin.ts:getMinimumSafetyCheckinStatus', 'engine/safetyCheckin.ts:createProvisionalSafetyRecommendation'], knowledgeRefs: [],
        coverageRationale: 'This is conservative missing-data behavior, not a physiological threshold. Scientific evidence may inform which fields are useful, but fail-closed handling is a product safety contract.',
    },
    {
        id: 'safety.clinical_escalation_protocol', domain: 'injury_safety', title: 'Red-flag and clinical escalation protocol',
        currentRule: 'Red-flag presentations (neurological deficit, acute traumatic non-weight-bearing / instability, severe systemic infection with high fever, or rapidly worsening symptoms) halt all physical training recommendations, cap the plan envelope at Rest, and mandate medical evaluation before resuming physical loading.',
        classification: 'safety_invariant', coverage: 'covered', decisionImpact: 'high', safetyImpact: 'high', researchPriority: 'none',
        codeRefs: ['engine/models.ts:RedFlagFinding', 'engine/adapters.ts:resolveRedFlagFindings', 'engine/rules.ts:evaluateEnvelopes'], knowledgeRefs: [KNOWLEDGE_CLAIM_IDS.clinicalEscalationProtocol],
        coverageRationale: 'The specific red-flag categories, the Rest cap, and the mandatory-referral routing are conservative product policy (CLINICAL_ESCALATION_PRODUCT_POLICY_SOURCE, SEP-C4). Hainline 2017 IOC Pain Consensus and Herring 2024 Initial MSK Assessment support only the boundary that automated athletic prescription must defer to medical evaluation; neither validates this specific routing protocol.',
    },
    {
        id: 'injury.tissue_response_severity', domain: 'injury_safety', title: 'Tissue-response to restriction severity mapping',
        currentRule: 'Tissue response evaluates 24-hour response latency: severe at any point maps to exclude; persistent post-session or delayed next-morning moderate irritability (or waking state) maps to limit; transient during-session moderate loading discomfort that settles by next morning maps to monitor (tolerable loading, Escriche-Escuder 2020); mild maps to monitor; normal maps to null. Observed response can only preserve or tighten standing constraints.',
        classification: 'product_heuristic', coverage: 'partial', decisionImpact: 'high', safetyImpact: 'high', researchPriority: 'p0',
        codeRefs: ['engine/injuryPolicy.ts:deriveTissueSeverity', 'engine/injuryPolicy.ts:resolveEffectiveInjuryConstraints'], knowledgeRefs: [KNOWLEDGE_CLAIM_IDS.tissueResponseTemporalMonitoring, KNOWLEDGE_CLAIM_IDS.tissueResponseSeverityPolicy],
        coverageRationale: 'SEP-C3 refines the latency model to distinguish tolerable during-session loading from persistent or delayed irritability using tendinopathy load-tolerance criteria. Comparative evidence across multiple tissues remains limited, so this high-safety mapping remains partial P0 debt.',
    },
    {
        id: 'injury.standing_constraint_preserve_or_tighten', domain: 'injury_safety', title: 'Standing injury constraint preserve-or-tighten invariant',
        currentRule: 'An active standing injury constraint is never weakened or cleared by tissue response; a newly inferred response constraint is today-only and expired standing constraints remain inactive.',
        classification: 'safety_invariant', coverage: 'not_applicable', decisionImpact: 'high', safetyImpact: 'high', researchPriority: 'none',
        codeRefs: ['engine/injuryPolicy.ts:resolveEffectiveInjuryConstraints', 'engine/injuryPolicy.ts:resolveInjuryRestrictions'], knowledgeRefs: [],
        coverageRationale: 'This is a conservative software safety contract governing monotonicity, expiry and persistence scope, not an externally claimed rehabilitation threshold.',
    },
    {
        id: 'injury.region_mapping.lower_limb_impact', domain: 'injury_safety', title: 'Lower-limb impact restriction mapping',
        currentRule: 'Knee, Achilles, ankle and calf limit/exclude constraints imply avoid-high-impact; exclude additionally restricts Running.',
        classification: 'product_heuristic', coverage: 'partial', decisionImpact: 'high', safetyImpact: 'high', researchPriority: 'p0',
        codeRefs: ['engine/injuryPolicy.ts:resolveInjuryRestrictions'], knowledgeRefs: [KNOWLEDGE_CLAIM_IDS.returnToSportCriteriaBasedRiskManagement, KNOWLEDGE_CLAIM_IDS.lowerLimbImpactPolicy],
        coverageRationale: 'SEP-B records the return-to-sport assessment boundary and exact policy mapping. A body region is not a diagnosis, so neither source validates this region-only impact/Running restriction as a universal clinical rule.',
    },
    {
        id: 'injury.region_mapping.lower_limb_strength', domain: 'injury_safety', title: 'Lower-limb strength restriction mapping',
        currentRule: 'Hamstring, quadriceps, adductor/groin and hip limit/exclude constraints imply avoid-heavy-lower-body; exclude additionally restricts Lower-body Strength and Full-body Strength.',
        classification: 'product_heuristic', coverage: 'partial', decisionImpact: 'high', safetyImpact: 'high', researchPriority: 'p0',
        codeRefs: ['engine/injuryPolicy.ts:resolveInjuryRestrictions'], knowledgeRefs: [KNOWLEDGE_CLAIM_IDS.returnToSportCriteriaBasedRiskManagement, KNOWLEDGE_CLAIM_IDS.lowerLimbStrengthPolicy],
        coverageRationale: 'SEP-B records the return-to-sport assessment boundary and exact policy mapping. A body region is not a diagnosis, so neither source validates this broad strength restriction as a universal clinical rule.',
    },
    {
        id: 'injury.region_mapping.lumbar_loading', domain: 'injury_safety', title: 'Lumbar loading restriction mapping',
        currentRule: 'Lower-back limit/exclude constraints imply avoid-heavy-spinal-loading; exclude additionally implies avoid-heavy-lower-body and avoid-high-impact.',
        classification: 'product_heuristic', coverage: 'partial', decisionImpact: 'high', safetyImpact: 'high', researchPriority: 'p0',
        codeRefs: ['engine/injuryPolicy.ts:resolveInjuryRestrictions'], knowledgeRefs: [KNOWLEDGE_CLAIM_IDS.returnToSportCriteriaBasedRiskManagement, KNOWLEDGE_CLAIM_IDS.lumbarLoadingPolicy],
        coverageRationale: 'SEP-C3 adds avoid-high-impact to severe lower-back exclusions as conservative product policy (LUMBAR_LOADING_PRODUCT_POLICY_V2_SOURCE) to offload repetitive axial shock. Herring 2024 supports deferring to clinical assessment for lumbar injury, not this specific mapping; lower-back symptoms are heterogeneous, so this remains partial P0 debt.',
    },
    {
        id: 'injury.region_mapping.upper_limb_loading', domain: 'injury_safety', title: 'Upper-limb loading restriction mapping',
        currentRule: 'Shoulder, elbow and wrist limit/exclude constraints imply avoid-overhead-pressing; exclude additionally restricts Upper-body Strength.',
        classification: 'product_heuristic', coverage: 'partial', decisionImpact: 'high', safetyImpact: 'high', researchPriority: 'p0',
        codeRefs: ['engine/injuryPolicy.ts:resolveInjuryRestrictions'], knowledgeRefs: [KNOWLEDGE_CLAIM_IDS.returnToSportCriteriaBasedRiskManagement, KNOWLEDGE_CLAIM_IDS.upperLimbLoadingPolicy],
        coverageRationale: 'SEP-B records the return-to-sport assessment boundary and exact policy mapping. A body region is not a diagnosis, so this broad upper-limb mapping remains partial P0 debt.',
    },
    {
        id: 'injury.pain_envelope_mapping', domain: 'injury_safety', title: 'Generic clinical-symptom envelope',
        currentRule: 'Pain/injury or non-allergy illness symptoms set painFlag; the flag adds Running to restricted modalities and caps the day at Mobility, or Rest when already trained.',
        classification: 'product_heuristic', coverage: 'partial', decisionImpact: 'high', safetyImpact: 'high', researchPriority: 'p0',
        codeRefs: ['engine/adapters.ts:mapCheckinToSubjectiveInput', 'engine/rules.ts:evaluateEnvelopes'], knowledgeRefs: [KNOWLEDGE_CLAIM_IDS.symptomsRequireContextualAssessment, KNOWLEDGE_CLAIM_IDS.genericClinicalEnvelopePolicy],
        coverageRationale: 'SEP-B records a contextual symptom-assessment boundary and the exact combined clinical-symptom product policy. Neither source validates anatomy-agnostic Running restriction or Mobility ceiling as universal guidance, and illness/pain causes remain distinct; this stays partial P0 debt.',
    },
    {
        id: 'spacing.anchor_next_day', domain: 'session_spacing', title: 'Anchor/quality next-day spacing gate',
        currentRule: 'A candidate anchor is rejected when an anchor occurred one day earlier.',
        classification: 'product_heuristic', coverage: 'covered', decisionImpact: 'high', safetyImpact: 'moderate', researchPriority: 'none',
        codeRefs: ['engine/optimizer.ts:evaluateRecoveryConstraints'], knowledgeRefs: [KNOWLEDGE_CLAIM_IDS.trainingStressRecoveryBalance, KNOWLEDGE_CLAIM_IDS.anchorSpacing],
        coverageRationale: 'Recovery evidence supports protecting quality under accumulated stress but not a universal one-day rule; the exact previous-day exclusion is explicitly recorded as conservative product policy.',
    },
    {
        id: 'spacing.rolling_hard_cap', domain: 'session_spacing', title: 'Rolling hard-session density cap',
        currentRule: 'Sessions with systemicCost >=0.5 count as hard in the prior six days; a new >=0.5 session is rejected once three such sessions are present.',
        classification: 'product_heuristic', coverage: 'covered', decisionImpact: 'high', safetyImpact: 'high', researchPriority: 'none',
        codeRefs: ['engine/optimizer.ts:buildHistoryFeatureSummary', 'engine/optimizer.ts:evaluateRecoveryConstraints'], knowledgeRefs: [KNOWLEDGE_CLAIM_IDS.enduranceIntensityDistribution, KNOWLEDGE_CLAIM_IDS.trainingStressRecoveryBalance, KNOWLEDGE_CLAIM_IDS.rollingHardDensityCap],
        coverageRationale: 'Endurance evidence supports structuring a smaller share of higher-intensity work and recovery-aware load management; the exact systemicCost >=0.5 / three-in-six rule remains an explicit product guardrail rather than a scientific maximum.',
    },
    {
        id: 'spacing.hard_lower_body_recovery', domain: 'session_spacing', title: 'Hard lower-body minimum spacing and workout recovery hours',
        currentRule: 'Lower-body cost >=0.6 is hard; default minimum gap is two days unless a workout declares minimumDaysAfterHardLowerBody. Declared recoveryHours are converted to ceil(hours/24) and can block hard/anchor work while unelapsed.',
        classification: 'product_heuristic', coverage: 'partial', decisionImpact: 'high', safetyImpact: 'high', researchPriority: 'p1',
        codeRefs: ['engine/optimizer.ts:evaluateRecoveryConstraints', 'engine/planningCandidate.ts:resolveMinimumDaysAfterHardLowerBody', 'engine/planningCandidate.ts:resolveRecoveryHoursForTemplate'],
        knowledgeRefs: [KNOWLEDGE_CLAIM_IDS.strenuousLowerBodyResidualFatigue, KNOWLEDGE_CLAIM_IDS.trainingStressRecoveryBalance, KNOWLEDGE_CLAIM_IDS.hardLowerBodySpacing],
        coverageRationale: 'The scientific recovery boundary and default 0.6/two-day product fallback have explicit lineage. Audited in docs/analysis/2026-09-02-workout-catalog-recovery-metadata-audit.md and validated in validateWorkoutLibrary: all 46 workouts declare bounded recoveryHours [0, 96] and 21 declare minimumDays [1, 2]. Coverage remains partial at P1 because 10 workouts with lowerBodyCost >=0.6 declare 1-day spacing overrides that weaken the two-day fallback and require a separate behavior-calibration change.',
    },
    {
        id: 'spacing.strength_key_cycling_adjacency', domain: 'session_spacing', title: 'Heavy lower-body strength vs key-cycling adjacency',
        currentRule: 'Heavy lower-body strength and key cycling sessions cannot be placed within the same/previous-day 0-1 day window; post-heavy-strength strength also receives a next-day buffer unless a workout explicitly allows one day.',
        classification: 'product_heuristic', coverage: 'covered', decisionImpact: 'high', safetyImpact: 'moderate', researchPriority: 'none',
        codeRefs: ['engine/optimizer.ts:evaluateRecoveryConstraints'], knowledgeRefs: [KNOWLEDGE_CLAIM_IDS.concurrentStrengthEnduranceContext, KNOWLEDGE_CLAIM_IDS.strengthEnduranceAdjacency],
        coverageRationale: 'Concurrent-training evidence says same-day modalities can be effective and effects are context-dependent; the exact 0-1-day exclusion is deliberately registered as a conservative product quality-protection rule, not a scientific requirement.',
    },
    {
        id: 'spacing.pre_event_restrictions', domain: 'session_spacing', title: 'Pre-event strength, hard and exhaustive session restrictions',
        currentRule: 'For A/B cycling/running events: strength is blocked 1-3 days pre-race; hard work is blocked 1-2 days; exhaustive work (systemicCost >=0.75 or VO2 title) is blocked 3-7 days.',
        classification: 'product_heuristic', coverage: 'partial', decisionImpact: 'high', safetyImpact: 'moderate', researchPriority: 'p1',
        codeRefs: ['engine/optimizer.ts:evaluateRecoveryConstraints'], knowledgeRefs: [KNOWLEDGE_CLAIM_IDS.preEventRestrictionsPolicy, KNOWLEDGE_CLAIM_IDS.endurancePreEventTaper],
        coverageRationale: 'Recorded as an explicit product-policy claim (`policy.taper.pre_event_restrictions_v1`) so the exact 1-3/1-2/3-7-day windows have provenance, and linked to the moderate-certainty pre-event taper boundary that competition load should fall while quality is preserved. Stays partial/P1: that boundary supports reducing load before competition in general, but validates none of these modality-specific day counts, and Evidence Pack 6 found no literature establishing per-session-type pre-competition blocking windows. SKR1 runtime lineage does not yet emit this claim: the optimizer evaluates the restriction against exact days-to-event, while `trainingIntentKnowledgeRefs` only has a coarser taper-active signal available, and attributing on that coarser signal would over-claim lineage on days where the restriction never actually evaluates. Wiring precise days-to-event into runtime lineage is a separate change.',
    },
    {
        id: 'optimizer.intensity_class_thresholds', domain: 'optimizer_scoring', title: 'Catalog systemic-cost intensity classification',
        currentRule: 'systemicCost >=0.6 is hard and >=0.3 is moderate; a hard candidate requires planned intensity >=0.8. Several history paths use 0.5-0.7 related hard/anchor cutoffs.',
        classification: 'product_heuristic', coverage: 'covered', decisionImpact: 'high', safetyImpact: 'moderate', researchPriority: 'none',
        codeRefs: ['engine/optimizer.ts:intensityClassForTemplate', 'engine/optimizer.ts:isIntensityClassAdmissible', 'engine/optimizer.ts:normalizeHistory'], knowledgeRefs: [KNOWLEDGE_CLAIM_IDS.enduranceIntensityDistribution, KNOWLEDGE_CLAIM_IDS.internalLoadIntensityBands],
        coverageRationale: 'The scientific claim provides distribution-level context; exact internal 0..1 thresholds are separately registered as product semantics and are not physiological zones.',
    },
    {
        id: 'optimizer.fatigue_cost_weights', domain: 'optimizer_scoring', title: 'Fatigue cost-penalty weights',
        currentRule: 'Candidate cost penalty weights systemic 2.0, cardiovascular 1.5, lower-body 2.5, upper-body 1.5, impact-tissue 2.0 and neuromuscular 1.8 against dimensional fatigue.',
        classification: 'product_heuristic', coverage: 'covered', decisionImpact: 'high', safetyImpact: 'moderate', researchPriority: 'none',
        codeRefs: ['engine/optimizer.ts:calculateFatigueCostPenalty'],
        knowledgeRefs: [KNOWLEDGE_CLAIM_IDS.trainingStressRecoveryBalance, KNOWLEDGE_CLAIM_IDS.fatigueDecayHalfLives, KNOWLEDGE_CLAIM_IDS.fatigueCostWeightsPolicy],
        coverageRationale: 'Registered as an explicit product-policy claim (`policy.optimizer.fatigue_cost_weights_v1`) with alignment testing. Residual fatigue evidence provides biological context for dimensional separation, while the exact penalty multipliers are explicit product heuristics rather than empirical constants.',
    },
    {
        id: 'optimizer.stimulus_benefit_weights', domain: 'optimizer_scoring', title: 'Objective stimulus-benefit weights',
        currentRule: 'Threshold/surge/VO2 matches use 1.5 multipliers, aerobic/fatigue-resistance 1.2, strength 1.6, plus category baselines around 0.1-0.5.',
        classification: 'product_heuristic', coverage: 'covered', decisionImpact: 'moderate', safetyImpact: 'low', researchPriority: 'none',
        codeRefs: ['engine/optimizer.ts:calculateStimulusBenefit'],
        knowledgeRefs: [KNOWLEDGE_CLAIM_IDS.stimulusBenefitWeightsPolicy],
        coverageRationale: 'Registered as an explicit product-policy claim (`policy.optimizer.stimulus_benefit_weights_v1`) with alignment testing. The multipliers govern candidate ranking among feasible sessions; they represent product utility emphasis rather than adaptation magnitude claims.',
    },
    {
        id: 'optimizer.event_priority_multipliers', domain: 'optimizer_scoring', title: 'Event-priority and horizon ranking multipliers',
        currentRule: 'Matching A/B events multiply benefit by 1.40/1.25; a second B race-specific session in six days is multiplied by 0.35; race-specific work >21 days out by 0.50; unrelated work can fall to 0.20.',
        classification: 'product_heuristic', coverage: 'covered', decisionImpact: 'moderate', safetyImpact: 'low', researchPriority: 'none',
        codeRefs: ['engine/optimizer.ts:rankCandidates'],
        knowledgeRefs: [KNOWLEDGE_CLAIM_IDS.eventPriorityMultipliersPolicy],
        coverageRationale: 'Registered as an explicit product-policy claim (`policy.optimizer.event_priority_multipliers_v1`) with alignment testing. Multipliers shape candidate utility toward target event deadlines and priorities.',
    },
    {
        id: 'optimizer.recovery_streak_heuristics', domain: 'optimizer_scoring', title: 'Recovery alternation and training-streak heuristics',
        currentRule: 'A systemicCost >=0.40 streak is scanned up to 14 days; at >=3 consecutive non-recovery days with no unresolved objectives recovery is boosted 2x and easy aerobic suppressed, with stronger suppression at >=4. Previous high-intensity also applies a 0.35 multiplier to another >=0.5 candidate.',
        classification: 'product_heuristic', coverage: 'covered', decisionImpact: 'moderate', safetyImpact: 'moderate', researchPriority: 'none',
        codeRefs: ['engine/optimizer.ts:buildHistoryFeatureSummary', 'engine/optimizer.ts:rankCandidates'],
        knowledgeRefs: [KNOWLEDGE_CLAIM_IDS.recoveryStreakHeuristicsPolicy],
        coverageRationale: 'Registered as an explicit product-policy claim (`policy.optimizer.recovery_streak_heuristics_v1`) with alignment testing. The 14-day lookback, 0.40 streak threshold, and 2.0x/0.3x/0.1x multipliers prevent excessive loading once objectives are met.',
    },
    {
        id: 'periodization.phase_boundaries_scales', domain: 'periodization_taper', title: 'Base/Build/Specificity phase boundaries and dose scales',
        currentRule: 'Specificity begins <=35 days; Build <=84 days; farther dates are Base. Build uses 0.6 event-demand blend, volume 1.1/intensity 0.9; Base uses 0.3 blend, volume 1.0/intensity 0.8; Specificity uses volume 1.0/intensity 1.1.',
        classification: 'product_heuristic', coverage: 'partial', decisionImpact: 'high', safetyImpact: 'moderate', researchPriority: 'p1',
        codeRefs: ['engine/periodization.ts:evaluatePeriodizationPhase'], knowledgeRefs: [KNOWLEDGE_CLAIM_IDS.blockStructuredProgression, KNOWLEDGE_CLAIM_IDS.phaseBoundariesScalesPolicy],
        coverageRationale: 'Evidence Pack 6 registers low-certainty mixed evidence that block periodization is a viable organization model but is not consistently superior to progressively loaded traditional periodization, plus an explicit product-policy record of the exact scalars. Coverage stays partial at P1 because the 35/84-day boundaries, 0.6/0.3 blend weights and volume/intensity scalars remain uncalibrated product choices; comparative cyclist evidence does not establish one universally optimal periodization sequence.',
    },
    {
        id: 'periodization.taper_windows_volume', domain: 'periodization_taper', title: 'Event taper windows and volume reduction',
        currentRule: 'An athlete-authored taper start date overrides all defaults. Otherwise cycling A events taper from race-week Monday with a 3-day minimum; non-general-target A/B events fall back to 14/5 days. Taper intensityScale stays 1.0 while volumeScale linearly falls toward 0.6.',
        classification: 'product_heuristic', coverage: 'covered', decisionImpact: 'high', safetyImpact: 'moderate', researchPriority: 'none',
        codeRefs: ['engine/taperPolicy.ts:resolveEventTaper', 'engine/periodization.ts:evaluatePeriodizationPhase'], knowledgeRefs: [KNOWLEDGE_CLAIM_IDS.endurancePreEventTaper, KNOWLEDGE_CLAIM_IDS.taperWindowsVolumePolicy],
        coverageRationale: 'The pre-event volume-reduction-while-preserving-intensity boundary has a moderate-certainty scientific claim; exact default scheduling (authored-start override precedence, cycling-A race-week alignment with a 3-day minimum, and legacy 14/5-day fallback for non-general targets) plus the 0.6 volume endpoint are separately registered as explicit product policy, not scientific constants. SKR1 runtime lineage (`knowledgeLineage.ts:trainingIntentKnowledgeRefs`) already emits both claims while a taper is active for an endurance event.',
    },
    {
        id: 'periodization.post_event_recovery_window', domain: 'periodization_taper', title: 'A-event post-event recovery window',
        currentRule: 'A-priority cycling/running events completed or DNF within the last 3 days enter a Post-Event Recovery phase at volume/intensity 0.4; B/C events and events older than 3 days do not.',
        classification: 'product_heuristic', coverage: 'uncovered', decisionImpact: 'moderate', safetyImpact: 'moderate', researchPriority: 'p1',
        codeRefs: ['engine/periodization.ts:evaluatePeriodizationPhase'], knowledgeRefs: [],
        coverageRationale: 'Split out of periodization.taper_windows_volume (2026-09-02): this is an independently calibrated post-event rule, not a taper, and taper meta-analysis does not justify its 3-day window or 0.4/0.4 scale. It stays uncovered on its own rather than borrowing the adjacent taper claim by proximity.',
    },
    {
        id: 'periodization.objective_thresholds', domain: 'periodization_taper', title: 'Demand-to-weekly-objective thresholds',
        currentRule: 'Aerobic objective appears at demand >=0.4 and becomes two exposures at >=0.7; threshold at >=0.5; surge/VO2 at >=0.6; race-specific cycling at fatigue-resistance >=0.7 or surges >=0.6; qualification floors commonly use 0.6.',
        classification: 'product_heuristic', coverage: 'partial', decisionImpact: 'high', safetyImpact: 'moderate', researchPriority: 'p1',
        codeRefs: ['engine/periodization.ts:objectivesFromDemand', 'engine/microcycle.ts:generateWeeklyObjectives'], knowledgeRefs: [KNOWLEDGE_CLAIM_IDS.objectiveThresholdsPolicy],
        coverageRationale: 'Evidence Pack 6 records the exact inclusion thresholds as an explicit product-policy claim, so they now have provenance and drift protection. No scientific claim is attached and none applies: the normalized 0-1 demand scale is product-defined, so no external study can validate a cut point on it. Stays partial at P1 pending empirical calibration against athlete outcomes.',
    },
    {
        id: 'periodization.taper_sharpening_targets', domain: 'periodization_taper', title: 'Race-week sharpening and strength-primer targets',
        currentRule: 'Taper sharpening targets thresholdPower 0.5/repeatedSurges 0.4 with threshold qualification 0.3; strength primer targets maxStrength 0.3/hypertrophy 0.2.',
        classification: 'product_heuristic', coverage: 'partial', decisionImpact: 'moderate', safetyImpact: 'moderate', researchPriority: 'p2',
        codeRefs: ['engine/periodization.ts:TAPER_SHARPENING_TARGET_STIMULUS', 'engine/periodization.ts:TAPER_STRENGTH_TARGET_STIMULUS'], knowledgeRefs: [KNOWLEDGE_CLAIM_IDS.taperSharpeningPolicy],
        coverageRationale: 'Now recorded as an explicit product-policy claim (`policy.taper.sharpening_targets_v1`), so the scalars have provenance and drift protection. The concepts align with freshness/maintenance goals from the taper literature, but the exact target values remain uncalibrated against outcomes, so this stays partial rather than covered.',
    },
    {
        id: 'periodization.multi_event_contribution', domain: 'periodization_taper', title: 'Multi-event contribution window and taper authority',
        currentRule: 'Secondary events contribute objectives inside 35 days; authority taper can drop threshold work; each contributor uses its canonical resolved taper (athlete-authored start override first, cycling-A race-week alignment next, otherwise the applicable legacy A/B default), and same-key requirements merge by max rather than sum.',
        classification: 'product_heuristic', coverage: 'partial', decisionImpact: 'moderate', safetyImpact: 'moderate', researchPriority: 'p2',
        codeRefs: ['engine/periodization.ts:resolveMultiEventObjectives', 'engine/taperPolicy.ts:resolveEventTaper'], knowledgeRefs: [KNOWLEDGE_CLAIM_IDS.multiEventContributionPolicy],
        coverageRationale: 'Evidence Pack 6 records the 35-day contribution window, the delegation of contributor taper resolution to the canonical taper policy, and the merge-by-max semantics as an explicit product-policy claim. Deliberately no scientific claim: this is deterministic conflict-resolution scheduling for concurrent goals, and no sports-science literature addresses it. Stays partial at P2 because the 35-day window, the taper defaults reached through the canonical policy, and the merge semantics all still alter training and remain uncalibrated.',
    },
    {
        id: 'event.demand_presets', domain: 'event_demand', title: 'Sport/event demand profiles',
        currentRule: 'Road race, criterium, TT, gran fondo, gravel, running distances, triathlon distances and strength events are mapped to authored 0..1 aerobic/threshold/VO2/surge/sprint/fatigue-resistance/neuromuscular demand vectors.',
        classification: 'product_heuristic', coverage: 'partial', decisionImpact: 'high', safetyImpact: 'low', researchPriority: 'p1',
        codeRefs: ['engine/eventPresets.ts:EVENT_PRESETS'], knowledgeRefs: [KNOWLEDGE_CLAIM_IDS.eventDurationLimiterShift, KNOWLEDGE_CLAIM_IDS.eventDemandPresetsPolicy],
        coverageRationale: 'Evidence Pack 6 reclassifies this from scientific_claim to product_heuristic (an authored 0-1 vector table is an encoding, not a measured constant) and registers a moderate-certainty boundary that endurance demands shift with event duration and race morphology, plus a product-policy record of the 19 authored preset vectors. Stays partial at P1: the field literature supports broad demand differences but validates no individual axis value or exact preset mapping, and the strength_meet/general_target presets have no cited endurance-event-demand literature behind them.',
    },
    {
        id: 'stimulus.objective_credit_confidence', domain: 'stimulus_credit', title: 'Stimulus-evidence confidence discount',
        currentRule: 'Objective credit weights exact/inferred/unknown stimulus evidence at 1.0/0.75/0.4 before dose completion scaling.',
        classification: 'product_heuristic', coverage: 'covered', decisionImpact: 'moderate', safetyImpact: 'moderate', researchPriority: 'none',
        codeRefs: ['engine/stimulus.ts:CONFIDENCE_CREDIT_WEIGHT', 'engine/stimulus.ts:deriveObjectiveCreditFromProfile'],
        knowledgeRefs: [KNOWLEDGE_CLAIM_IDS.objectiveCreditConfidencePolicy],
        coverageRationale: 'Registered as an explicit product-policy claim (`policy.stimulus.objective_credit_confidence_v1`) with alignment testing. Discounts unverified or inferred stimulus evidence to prevent overestimating weekly progress.',
    },
    {
        id: 'stimulus.legacy_keyword_credit', domain: 'stimulus_credit', title: 'Legacy keyword compatibility credit',
        currentRule: 'A legacy free-text objective match earns 0.5 credit per exposure and cannot resolve a one-credit objective by itself.',
        classification: 'product_heuristic', coverage: 'covered', decisionImpact: 'low', safetyImpact: 'low', researchPriority: 'none',
        codeRefs: ['engine/microcycle.ts:LEGACY_KEYWORD_COMPATIBILITY_CREDIT', 'engine/microcycle.ts:updateMicrocycleProgress'],
        knowledgeRefs: [KNOWLEDGE_CLAIM_IDS.legacyKeywordCreditPolicy],
        coverageRationale: 'Registered as an explicit product-policy claim (`policy.stimulus.legacy_keyword_credit_v1`) with alignment testing. Conservative fallback credit for unstructured legacy catalog entries.',
    },
    {
        id: 'stimulus.race_specific_credit_formula', domain: 'stimulus_credit', title: 'Race-specific objective credit formula',
        currentRule: 'Race-specific credit uses max(fatigueResistance, 0.5*aerobicEndurance + 0.5*repeatedSurges); other objective keys select one canonical axis or max strength/hypertrophy.',
        classification: 'product_heuristic', coverage: 'covered', decisionImpact: 'moderate', safetyImpact: 'low', researchPriority: 'none',
        codeRefs: ['engine/stimulus.ts:deriveObjectiveCreditFromProfile'],
        knowledgeRefs: [KNOWLEDGE_CLAIM_IDS.raceSpecificCreditFormulaPolicy],
        coverageRationale: 'Registered as an explicit product-policy claim (`policy.stimulus.race_specific_credit_formula_v1`) with alignment testing. Internal stimulus blending formula balancing fatigue resistance and surge/aerobic combinations.',
    },
    {
        id: 'stimulus.coverage_threshold', domain: 'stimulus_credit', title: 'Stimulus coverage qualification threshold',
        currentRule: 'Generic stimulus coverage uses a 0.6 qualification threshold where consumed by compatibility/planning paths.',
        classification: 'product_heuristic', coverage: 'covered', decisionImpact: 'moderate', safetyImpact: 'low', researchPriority: 'none',
        codeRefs: ['engine/microcycle.ts:STIMULUS_CREDIT_COVERAGE_THRESHOLD'],
        knowledgeRefs: [KNOWLEDGE_CLAIM_IDS.coverageThresholdPolicy],
        coverageRationale: 'Registered as an explicit product-policy claim (`policy.stimulus.coverage_threshold_v1`) with alignment testing. Product qualification floor determining session admissibility for planning role coverage.',
    },
    {
        id: 'planning.user_capacity_authority', domain: 'planning_capacity', title: 'User-authored time/equipment/environment capacity',
        currentRule: 'The engine takes the minimum of current-day and configured time caps, enforces required equipment/environment, and packs only into positive schedule windows.',
        classification: 'implementation_constant', coverage: 'not_applicable', decisionImpact: 'high', safetyImpact: 'low', researchPriority: 'none',
        codeRefs: ['engine/eligibility.ts:evaluateTemplateEligibility', 'engine/trainingCapacity.ts:resolveTrainingCapacity'], knowledgeRefs: [], coverageRationale: 'This applies explicit user/availability constraints and deterministic feasibility arithmetic; it is not a sports-knowledge claim.',
    },
    {
        id: 'planning.search_budgets', domain: 'planning_capacity', title: 'Deterministic weekly allocation search budgets',
        currentRule: 'Weekly role allocation is bounded to 7 dates, 14 occurrences, 4 candidates per occurrence and 1024 transitions.',
        classification: 'implementation_constant', coverage: 'not_applicable', decisionImpact: 'low', safetyImpact: 'low', researchPriority: 'none',
        codeRefs: ['engine/weeklyAllocation.ts:WEEKLY_ALLOCATION_SEARCH_BUDGET'], knowledgeRefs: [], coverageRationale: 'These are deterministic computational-resource bounds; scientific provenance would be category error. Budget exhaustion is surfaced rather than treated as physiological infeasibility.',
    },
    {
        id: 'data_trust.identity_gated_source_fail_closed', domain: 'data_trust', title: 'Identity-gated health-source eligibility',
        currentRule: 'Configured shared sources enter recovery/baselines/passport learning only when exactly one projection matches the immutable bundle and resolves to effective USER with the requested eligibility; missing/stale/ambiguous projections are excluded.',
        classification: 'safety_invariant', coverage: 'not_applicable', decisionImpact: 'high', safetyImpact: 'high', researchPriority: 'none',
        codeRefs: ['engine/identityEligibility.ts:selectEligibleHealthObservationBundles'], knowledgeRefs: [], coverageRationale: 'This is provenance/identity fail-closed behavior protecting physiological inputs, not a sports-science claim. Shadow classifier thresholds that may create projections require separate activation evidence before becoming authority.',
    },
];

const ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;

/** Validate inventory structure, active claim references and explicit research-debt semantics. */
export function validateKnowledgeCoverageInventory(
    items: readonly EngineKnowledgeCoverageItem[] = ENGINE_KNOWLEDGE_COVERAGE,
): KnowledgeCoverageValidation {
    const errors: string[] = [];
    const warnings: string[] = [];
    const ids = new Set<string>();
    for (const item of items) {
        if (!ID_PATTERN.test(item.id)) errors.push(`coverage ${item.id}: id must be stable lowercase machine-safe text`);
        if (ids.has(item.id)) errors.push(`duplicate coverage id: ${item.id}`);
        ids.add(item.id);
        if (!item.title.trim()) errors.push(`coverage ${item.id}: title is required`);
        if (!item.currentRule.trim()) errors.push(`coverage ${item.id}: currentRule is required`);
        if (item.codeRefs.length === 0) errors.push(`coverage ${item.id}: at least one codeRef is required`);
        if (!item.coverageRationale.trim()) errors.push(`coverage ${item.id}: coverageRationale is required`);
        const uniqueKnowledgeRefs = new Set(item.knowledgeRefs);
        if (uniqueKnowledgeRefs.size !== item.knowledgeRefs.length) errors.push(`coverage ${item.id}: duplicate knowledgeRefs are not allowed`);
        if (item.coverage === 'covered' && item.knowledgeRefs.length === 0) errors.push(`coverage ${item.id}: covered items require at least one knowledgeRef`);
        if (item.coverage === 'partial' && item.knowledgeRefs.length === 0) errors.push(`coverage ${item.id}: partial items require at least one existing knowledgeRef`);
        if ((item.coverage === 'uncovered' || item.coverage === 'not_applicable') && item.knowledgeRefs.length > 0) errors.push(`coverage ${item.id}: ${item.coverage} items must not claim knowledgeRefs`);
        if (item.coverage === 'not_applicable' && item.classification !== 'implementation_constant' && item.classification !== 'safety_invariant') errors.push(`coverage ${item.id}: not_applicable is reserved for implementation constants and non-scientific safety invariants`);
        if (item.coverage === 'covered' && item.researchPriority !== 'none') errors.push(`coverage ${item.id}: covered items must not retain a research priority`);
        if (item.coverage === 'uncovered' && item.researchPriority === 'none') errors.push(`coverage ${item.id}: uncovered items require a research priority`);
        if (item.coverage === 'partial' && item.researchPriority === 'none') errors.push(`coverage ${item.id}: partial items must retain a research priority for their unresolved surface`);
        if (item.coverage === 'not_applicable' && item.researchPriority !== 'none') errors.push(`coverage ${item.id}: not_applicable items must not enter the research backlog`);
        for (const claimId of item.knowledgeRefs) {
            try { getActiveKnowledgeClaim(claimId); }
            catch (error) { errors.push(`coverage ${item.id}: knowledgeRef ${claimId} is not an active known claim (${error instanceof Error ? error.message : String(error)})`); }
        }
        if (item.coverage === 'uncovered' && item.decisionImpact === 'high') warnings.push(`coverage ${item.id}: high-impact decision assumption has no knowledge claim`);
        if (item.coverage === 'uncovered' && item.safetyImpact === 'high') warnings.push(`coverage ${item.id}: high-safety assumption has no knowledge claim`);
        if (item.coverage === 'partial' && item.decisionImpact === 'high') warnings.push(`coverage ${item.id}: high-impact decision assumption remains only partially covered`);
        if (item.coverage === 'partial' && item.safetyImpact === 'high') warnings.push(`coverage ${item.id}: high-safety assumption remains only partially covered`);
    }
    return { valid: errors.length === 0, errors, warnings };
}

function emptyCoverageCounts(): Record<KnowledgeCoverageState, number> { return { covered: 0, partial: 0, uncovered: 0, not_applicable: 0 }; }
function emptyClassificationCounts(): Record<KnowledgeAssumptionClassification, number> { return { scientific_claim: 0, product_heuristic: 0, athlete_specific_rule: 0, safety_invariant: 0, implementation_constant: 0 }; }
function emptyPriorityCounts(): Record<KnowledgeResearchPriority, number> { return { p0: 0, p1: 0, p2: 0, p3: 0, none: 0 }; }

/** Summarize registry coverage without treating partial coverage as complete. */
export function summarizeKnowledgeCoverage(
    items: readonly EngineKnowledgeCoverageItem[] = ENGINE_KNOWLEDGE_COVERAGE,
): KnowledgeCoverageSummary {
    const byCoverage = emptyCoverageCounts();
    const byClassification = emptyClassificationCounts();
    const byPriority = emptyPriorityCounts();
    let highImpactUncovered = 0;
    let highSafetyUncovered = 0;
    for (const item of items) {
        byCoverage[item.coverage] += 1;
        byClassification[item.classification] += 1;
        byPriority[item.researchPriority] += 1;
        if (item.coverage === 'uncovered' && item.decisionImpact === 'high') highImpactUncovered += 1;
        if (item.coverage === 'uncovered' && item.safetyImpact === 'high') highSafetyUncovered += 1;
    }
    return { total: items.length, byCoverage, byClassification, byPriority, highImpactUncovered, highSafetyUncovered };
}

/** Shadow/observability surfaces reviewed but intentionally outside live decision authority. */
export const REVIEWED_NON_AUTHORITY_SURFACES = [
    { ref: 'engine/sleepRecoveryEvidence.ts', reason: 'Shadow-only sleep evidence classification; explicitly not consumed by live rules/fatigue.' },
    { ref: 'engine/dataConfidence.ts', reason: 'Dashboard-facing observability only; does not change readiness, eligibility, dose or ranking.' },
    { ref: 'engine/healthAnomaly.ts', reason: 'Candidate health-anomaly thresholds are shadow/replay evidence pending explicit policy activation.' },
    { ref: 'engine/activityHrFidelity.ts', reason: 'HR use-authority policy is shadow-only until a live consumer is activated.' },
    { ref: 'engine/identityAttribution.ts', reason: 'Automatic physiological identity classifier thresholds are shadow/replay candidates; effective eligibility itself is inventoried separately.' },
    { ref: 'engine/subjectiveBaseline.ts + subjectiveDriftAudit.ts', reason: 'Subjective drift contribution is production-default off and evaluated through simulation/audit before activation.' },
    { ref: 'engine/weeklyAllocation.ts search limits', reason: 'Bounded deterministic search resources are implementation constants; the one useful boundary is inventoried as not-applicable.' },
] as const;
