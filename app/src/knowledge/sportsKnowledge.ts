export type KnowledgeClaimType =
    | 'definition'
    | 'descriptive'
    | 'causal'
    | 'intervention'
    | 'prognostic'
    | 'safety'
    | 'heuristic';

export type KnowledgeMaturity = 'foundational' | 'established' | 'supported' | 'emerging' | 'heuristic';
export type KnowledgeStatus = 'active' | 'contested' | 'deprecated' | 'rejected';
export type EvidenceCertainty = 'high' | 'moderate' | 'low' | 'very_low' | 'not_applicable';
export type EvidenceDirectness = 'direct' | 'partially_direct' | 'indirect';
export type RecommendationStrength = 'strong' | 'conditional' | 'informational';
export type KnowledgeSafetyImpact = 'low' | 'moderate' | 'high';
export type KnowledgeHorizon = 'acute' | 'chronic' | 'both' | 'not_applicable';
export type KnowledgeSourceType =
    | 'guideline'
    | 'systematic_review'
    | 'umbrella_review'
    | 'randomized_trial'
    | 'cohort'
    | 'cross_sectional'
    | 'mechanistic'
    | 'consensus'
    | 'expert_practice'
    | 'product_policy';
export type KnowledgeSynthesisMethod = 'meta_analysis' | 'network_meta_analysis' | 'narrative_synthesis';
export type KnowledgeExternalIdType = 'pmid' | 'pmcid' | 'doi' | 'prospero' | 'isbn';

export interface KnowledgeExternalId {
    type: KnowledgeExternalIdType;
    value: string;
}

export interface KnowledgeSource {
    id: string;
    title: string;
    sourceType: KnowledgeSourceType;
    citation: string;
    url?: string;
    publishedOn?: string;
    /** Stable publication/registration identifiers such as PMID, DOI or PROSPERO. */
    externalIds?: KnowledgeExternalId[];
    /** Review-level synthesis methods; meta-analysis is a method, not a source-quality tier. */
    synthesisMethods?: KnowledgeSynthesisMethod[];
    notes?: string;
}

export interface KnowledgeEvidenceLink {
    sourceId: string;
    directness: EvidenceDirectness;
    note?: string;
}

export interface KnowledgeApplicability {
    contexts: string[];
    sports: string[];
    populations: string[];
    outcomes: string[];
    horizon: KnowledgeHorizon;
}

export interface KnowledgeClaim {
    id: string;
    statement: string;
    claimType: KnowledgeClaimType;
    maturity: KnowledgeMaturity;
    status: KnowledgeStatus;
    evidenceCertainty: EvidenceCertainty;
    recommendationStrength: RecommendationStrength;
    safetyImpact: KnowledgeSafetyImpact;
    applicability: KnowledgeApplicability;
    evidence: KnowledgeEvidenceLink[];
    limitations: string[];
    reviewedOn: string;
    version: number;
    supersedes?: string;
}

export interface KnowledgeRegistryValidation {
    valid: boolean;
    errors: string[];
    warnings: string[];
}

const WHO_PHYSICAL_ACTIVITY_SOURCE = 'WHO-2020-PHYSICAL-ACTIVITY-GUIDELINES';
const EVERGREEN_PRODUCT_POLICY_SOURCE = 'PRODUCT-EVERGREEN-DOSE-V1';
const LOAD_INTENSITY_RECOVERY_PRODUCT_POLICY_SOURCE = 'PRODUCT-LOAD-INTENSITY-RECOVERY-V1';
const OLIVEIRA_POLARIZED_TID_SOURCE = 'OLIVEIRA-2024-POLARIZED-TID-META';
const ROSENBLAT_TID_SOURCE = 'ROSENBLAT-2025-TID-NETWORK-META';
const KELLMANN_RECOVERY_SOURCE = 'KELLMANN-2018-RECOVERY-CONSENSUS';
const HARRISON_MUSCLE_DAMAGE_SOURCE = 'HARRISON-2024-MUSCLE-DAMAGE-RECOVERY-META';
const VARELA_RT_FATIGUE_SOURCE = 'VARELA-OLALLA-2025-RT-FATIGUE-REVIEW';
const HUIBERTS_CONCURRENT_SOURCE = 'HUIBERTS-2024-CONCURRENT-TRAINING-META';
const EDDENS_SEQUENCE_SOURCE = 'EDDENS-2018-CONCURRENT-SEQUENCE-META';
const BANGSBO_ELITE_CONSENSUS_SOURCE = 'BANGSBO-2025-ELITE-ATHLETE-CONSENSUS';

export const SPORTS_KNOWLEDGE_SOURCES: readonly KnowledgeSource[] = [
    {
        id: WHO_PHYSICAL_ACTIVITY_SOURCE,
        title: 'WHO guidelines on physical activity and sedentary behaviour',
        sourceType: 'guideline',
        citation: 'World Health Organization. WHO guidelines on physical activity and sedentary behaviour. 2020. ISBN 978-92-4-001512-8.',
        url: 'https://www.who.int/publications/i/item/9789240015128',
        publishedOn: '2020-11-25',
        externalIds: [{ type: 'isbn', value: '978-92-4-001512-8' }],
        notes: 'Authoritative public-health guidance; not a sport-performance prescription.',
    },
    {
        id: EVERGREEN_PRODUCT_POLICY_SOURCE,
        title: 'Evergreen dose policy v1',
        sourceType: 'product_policy',
        citation: 'Adaptive Training Recommender product policy: evergreen-dose-v1.',
        notes: 'Explicit product prior. It is not represented as external scientific evidence.',
    },
    {
        id: LOAD_INTENSITY_RECOVERY_PRODUCT_POLICY_SOURCE,
        title: 'Load, intensity and recovery policy v1',
        sourceType: 'product_policy',
        citation: 'Adaptive Training Recommender product policy: load-intensity-recovery-v1.',
        notes: 'Records exact internal load-scale thresholds and conservative spacing defaults. External evidence informs direction and limitations but does not scientifically validate these exact product scalars.',
    },
    {
        id: OLIVEIRA_POLARIZED_TID_SOURCE,
        title: "Comparison of Polarized Versus Other Types of Endurance Training Intensity Distribution on Athletes' Endurance Performance: A Systematic Review with Meta-analysis",
        sourceType: 'systematic_review',
        citation: 'Oliveira PS, Boppre G, Fonseca H. Sports Med. 2024;54(8):2071-2095. doi:10.1007/s40279-024-02034-z.',
        url: 'https://pubmed.ncbi.nlm.nih.gov/38717713/',
        publishedOn: '2024-05-08',
        externalIds: [
            { type: 'pmid', value: '38717713' },
            { type: 'pmcid', value: 'PMC11329428' },
            { type: 'doi', value: '10.1007/s40279-024-02034-z' },
            { type: 'prospero', value: 'CRD42022365117' },
        ],
        synthesisMethods: ['meta_analysis'],
        notes: 'Comparative TID evidence: polarized training showed a small VO2peak advantage overall, especially in shorter interventions/highly trained athletes, but not superiority across all endurance outcomes.',
    },
    {
        id: ROSENBLAT_TID_SOURCE,
        title: 'Which Training Intensity Distribution Intervention will Produce the Greatest Improvements in Maximal Oxygen Uptake and Time-Trial Performance in Endurance Athletes? A Systematic Review and Network Meta-analysis of Individual Participant Data',
        sourceType: 'systematic_review',
        citation: 'Rosenblat MA, Watt JA, Arnold JI, et al. Sports Med. 2025;55(3):655-673. doi:10.1007/s40279-024-02149-3.',
        url: 'https://pubmed.ncbi.nlm.nih.gov/39888556/',
        publishedOn: '2025-01-31',
        externalIds: [
            { type: 'pmid', value: '39888556' },
            { type: 'doi', value: '10.1007/s40279-024-02149-3' },
        ],
        synthesisMethods: ['network_meta_analysis'],
        notes: 'Individual-participant network meta-analysis comparing endurance training-intensity distributions; useful for distribution-level decisions, not for validating an internal systemic-cost threshold or rolling hard-session count.',
    },
    {
        id: KELLMANN_RECOVERY_SOURCE,
        title: 'Recovery and Performance in Sport: Consensus Statement',
        sourceType: 'consensus',
        citation: 'Kellmann M, Bertollo M, Bosquet L, et al. Int J Sports Physiol Perform. 2018;13(2):240-245. doi:10.1123/ijspp.2017-0759.',
        url: 'https://pubmed.ncbi.nlm.nih.gov/29345524/',
        publishedOn: '2018-02-01',
        externalIds: [
            { type: 'pmid', value: '29345524' },
            { type: 'doi', value: '10.1123/ijspp.2017-0759' },
        ],
        notes: 'Consensus emphasizes stress-recovery balance and material inter- and intra-individual variability; it does not prescribe universal fixed recovery windows.',
    },
    {
        id: HARRISON_MUSCLE_DAMAGE_SOURCE,
        title: 'Acute effects of exercise-induced muscle damage on sprint and change of direction performance: A systematic review and meta-analysis',
        sourceType: 'systematic_review',
        citation: 'Harrison DC, Doma K, Rush C, Connor JD. Biol Sport. 2024;41(3):153-168. doi:10.5114/biolsport.2024.131823.',
        url: 'https://pubmed.ncbi.nlm.nih.gov/38952917/',
        publishedOn: '2024-01-30',
        externalIds: [
            { type: 'pmid', value: '38952917' },
            { type: 'pmcid', value: 'PMC11167466' },
            { type: 'doi', value: '10.5114/biolsport.2024.131823' },
        ],
        synthesisMethods: ['meta_analysis'],
        notes: 'Twenty-study review of deliberately muscle-damaging resistance/plyometric protocols; supports residual performance impairment up to 72 h in that context, not a universal recovery duration after every lower-body session.',
    },
    {
        id: VARELA_RT_FATIGUE_SOURCE,
        title: 'Influence of Proximity to Failure, Relative Intensity, and Volume on Voluntary Performance and Fatigue Symptoms After Resistance Training: A Systematic Review',
        sourceType: 'systematic_review',
        citation: 'Varela-Olalla D, del Campo-Vecino J, Balsalobre-Fernandez C. J Strength Cond Res. 2025;39(9):e1129-e1168. doi:10.1519/JSC.0000000000005194.',
        url: 'https://pubmed.ncbi.nlm.nih.gov/40644670/',
        publishedOn: '2025-07-09',
        externalIds: [
            { type: 'pmid', value: '40644670' },
            { type: 'doi', value: '10.1519/JSC.0000000000005194' },
        ],
        notes: 'Review of 51 articles identifies set duration, proximity to failure, total volume and density as important determinants of acute resistance-training fatigue.',
    },
    {
        id: HUIBERTS_CONCURRENT_SOURCE,
        title: 'Concurrent Strength and Endurance Training: A Systematic Review and Meta-Analysis on the Impact of Sex and Training Status',
        sourceType: 'systematic_review',
        citation: 'Huiberts RO, Wust RCI, van der Zwaard S. Sports Med. 2024;54(2):485-503. doi:10.1007/s40279-023-01943-9.',
        url: 'https://pubmed.ncbi.nlm.nih.gov/37847373/',
        publishedOn: '2023-10-17',
        externalIds: [
            { type: 'pmid', value: '37847373' },
            { type: 'pmcid', value: 'PMC10933151' },
            { type: 'doi', value: '10.1007/s40279-023-01943-9' },
            { type: 'prospero', value: 'CRD42022370894' },
        ],
        synthesisMethods: ['meta_analysis'],
        notes: 'Fifty-nine-study review found small context-dependent interference for some outcomes, including lower-body strength in males, with training-status and sex differences.',
    },
    {
        id: EDDENS_SEQUENCE_SOURCE,
        title: 'The Role of Intra-Session Exercise Sequence in the Interference Effect: A Systematic Review with Meta-Analysis',
        sourceType: 'systematic_review',
        citation: 'Eddens L, van Someren K, Howatson G. Sports Med. 2018;48(1):177-188. doi:10.1007/s40279-017-0784-1.',
        url: 'https://pubmed.ncbi.nlm.nih.gov/28917030/',
        externalIds: [
            { type: 'pmid', value: '28917030' },
            { type: 'pmcid', value: 'PMC5752732' },
            { type: 'doi', value: '10.1007/s40279-017-0784-1' },
        ],
        synthesisMethods: ['meta_analysis'],
        notes: 'Sequence affected lower-body dynamic-strength adaptation but not several other measured outcomes; it does not establish that strength and endurance must be separated by a full day.',
    },
    {
        id: BANGSBO_ELITE_CONSENSUS_SOURCE,
        title: 'Consensus Statements-Optimizing Performance of the Elite Athlete',
        sourceType: 'consensus',
        citation: 'Bangsbo J, Hostrup M, Hellsten Y, et al. Scand J Med Sci Sports. 2025;35(8):e70112. doi:10.1111/sms.70112.',
        url: 'https://pubmed.ncbi.nlm.nih.gov/40781883/',
        publishedOn: '2025-08-09',
        externalIds: [
            { type: 'pmid', value: '40781883' },
            { type: 'pmcid', value: 'PMC12334928' },
            { type: 'doi', value: '10.1111/sms.70112' },
        ],
        notes: 'Elite-athlete consensus supports individualized concurrent training and explicitly permits different modalities on the same day; applicability outside trained/elite contexts is not automatic.',
    },
];

export const KNOWLEDGE_CLAIM_IDS = {
    adultAerobicHealthVolume: 'health.adults.aerobic.weekly_volume',
    adultStrengthHealthFrequency: 'health.adults.strength.weekly_frequency',
    adultStrengthDefaultUpperTarget: 'health.adults.strength.default_upper_target',
    conditionalHighIntensityPrior: 'performance.high_intensity.conditional_weekly_prior',
    enduranceIntensityDistribution: 'performance.endurance.intensity_distribution.low_intensity_majority',
    trainingStressRecoveryBalance: 'recovery.training.stress_recovery_balance',
    strenuousLowerBodyResidualFatigue: 'recovery.lower_body.strenuous_work.residual_impairment',
    concurrentStrengthEnduranceContext: 'performance.concurrent.strength_endurance.context_dependent',
    internalLoadIntensityBands: 'policy.load_intensity.internal_scale_thresholds_v1',
    rollingHardDensityCap: 'policy.load_recovery.rolling_hard_density_v1',
    anchorSpacing: 'policy.load_recovery.anchor_spacing_v1',
    hardLowerBodySpacing: 'policy.load_recovery.hard_lower_body_spacing_v1',
    strengthEnduranceAdjacency: 'policy.load_recovery.strength_endurance_adjacency_v1',
    recentHardReadinessPenalty: 'policy.load_recovery.recent_hard_readiness_penalty_v1',
    fatigueDecayHalfLives: 'policy.load_recovery.fatigue_decay_half_lives_v1',
} as const;

export const SPORTS_KNOWLEDGE_CLAIMS: readonly KnowledgeClaim[] = [
    {
        id: KNOWLEDGE_CLAIM_IDS.adultAerobicHealthVolume,
        statement: 'For adults, 150-300 minutes of moderate-intensity aerobic physical activity per week, or the vigorous-intensity equivalent, is a WHO health-promoting target range.',
        claimType: 'intervention',
        maturity: 'established',
        status: 'active',
        evidenceCertainty: 'moderate',
        recommendationStrength: 'strong',
        safetyImpact: 'low',
        applicability: {
            contexts: ['health', 'balanced_performance'],
            sports: ['general_physical_activity'],
            populations: ['adults_without_sport_specific_performance_requirement'],
            outcomes: ['health_promoting_aerobic_activity_volume'],
            horizon: 'chronic',
        },
        evidence: [{ sourceId: WHO_PHYSICAL_ACTIVITY_SOURCE, directness: 'direct' }],
        limitations: [
            'This is public-health guidance, not evidence that 150-300 minutes is an optimal sport-performance dose.',
            'Individual contraindications, disability, pregnancy and clinical conditions may require contextualized guidance.',
        ],
        reviewedOn: '2026-08-30',
        version: 1,
    },
    {
        id: KNOWLEDGE_CLAIM_IDS.adultStrengthHealthFrequency,
        statement: 'Adults should perform muscle-strengthening activity involving all major muscle groups on two or more days per week for additional health benefits.',
        claimType: 'intervention',
        maturity: 'established',
        status: 'active',
        evidenceCertainty: 'moderate',
        recommendationStrength: 'strong',
        safetyImpact: 'low',
        applicability: {
            contexts: ['health', 'balanced_performance', 'strength_muscle'],
            sports: ['general_physical_activity'],
            populations: ['adults_without_sport_specific_performance_requirement'],
            outcomes: ['health_promoting_strength_frequency'],
            horizon: 'chronic',
        },
        evidence: [{ sourceId: WHO_PHYSICAL_ACTIVITY_SOURCE, directness: 'direct' }],
        limitations: [
            'WHO specifies two or more days; it does not establish the product default of three sessions as a scientific maximum.',
            'This is health guidance, not a hypertrophy-, strength- or sport-specific optimum.',
        ],
        reviewedOn: '2026-08-30',
        version: 1,
    },
    {
        id: KNOWLEDGE_CLAIM_IDS.adultStrengthDefaultUpperTarget,
        statement: 'The Evergreen planner uses three strength sessions per week as a bounded default upper target when allocating a general health or balanced plan.',
        claimType: 'heuristic',
        maturity: 'heuristic',
        status: 'active',
        evidenceCertainty: 'not_applicable',
        recommendationStrength: 'conditional',
        safetyImpact: 'low',
        applicability: {
            contexts: ['health', 'balanced_performance', 'strength_muscle'],
            sports: ['general_physical_activity'],
            populations: ['evergreen_mode_users'],
            outcomes: ['bounded_weekly_strength_allocation'],
            horizon: 'chronic',
        },
        evidence: [{
            sourceId: EVERGREEN_PRODUCT_POLICY_SOURCE,
            directness: 'direct',
            note: 'Product allocation prior, deliberately separated from the WHO >=2 day recommendation.',
        }],
        limitations: [
            'This is a product allocation heuristic, not an evidence-based claim that three sessions is a physiological maximum or optimum.',
        ],
        reviewedOn: '2026-08-30',
        version: 1,
    },
    {
        id: KNOWLEDGE_CLAIM_IDS.conditionalHighIntensityPrior,
        statement: 'For an athlete with sufficient and internally consistent recent training history, Evergreen may allocate one high-intensity session as a target and no more than two in the weekly plan.',
        claimType: 'heuristic',
        maturity: 'heuristic',
        status: 'active',
        evidenceCertainty: 'not_applicable',
        recommendationStrength: 'conditional',
        safetyImpact: 'moderate',
        applicability: {
            contexts: ['endurance', 'speed_power', 'sport_readiness'],
            sports: ['endurance', 'speed_power', 'sport_readiness'],
            populations: ['athletes_with_sufficient_consistent_recent_training_evidence'],
            outcomes: ['bounded_performance_oriented_high_intensity_exposure'],
            horizon: 'chronic',
        },
        evidence: [{ sourceId: EVERGREEN_PRODUCT_POLICY_SOURCE, directness: 'direct' }],
        limitations: [
            'This is a conservative product prior, not a claim that one to two high-intensity sessions is universally optimal.',
            'The prior is withheld when recent training evidence is insufficient, limited or conflicting.',
        ],
        reviewedOn: '2026-08-30',
        version: 1,
    },
    {
        id: KNOWLEDGE_CLAIM_IDS.enduranceIntensityDistribution,
        statement: 'For trained endurance athletes, effective programs commonly place most training at low intensity and a smaller share at moderate/high intensity; comparative evidence supports organizing intensity distribution but does not establish a universal number of hard sessions in a rolling week.',
        claimType: 'intervention',
        maturity: 'supported',
        status: 'active',
        evidenceCertainty: 'moderate',
        recommendationStrength: 'conditional',
        safetyImpact: 'moderate',
        applicability: {
            contexts: ['endurance', 'performance', 'training_distribution'],
            sports: ['cycling', 'running', 'endurance_multisport'],
            populations: ['trained_endurance_athletes'],
            outcomes: ['endurance_performance', 'aerobic_power', 'training_intensity_distribution'],
            horizon: 'chronic',
        },
        evidence: [
            { sourceId: OLIVEIRA_POLARIZED_TID_SOURCE, directness: 'direct' },
            { sourceId: ROSENBLAT_TID_SOURCE, directness: 'direct' },
        ],
        limitations: [
            'Comparative TID evidence does not validate the product systemicCost scale or a threshold such as systemicCost >= 0.5/0.6.',
            'The evidence does not establish a universal maximum count of hard sessions in a six- or seven-day window.',
            'Optimal distribution depends on athlete level, event, phase and outcome; polarized training was not superior for every measured performance outcome.',
        ],
        reviewedOn: '2026-08-30',
        version: 1,
    },
    {
        id: KNOWLEDGE_CLAIM_IDS.trainingStressRecoveryBalance,
        statement: 'Training and competition stress should be balanced with adequate recovery, and recovery requirements vary materially both between athletes and within the same athlete across contexts.',
        claimType: 'intervention',
        maturity: 'supported',
        status: 'active',
        evidenceCertainty: 'moderate',
        recommendationStrength: 'conditional',
        safetyImpact: 'moderate',
        applicability: {
            contexts: ['performance', 'recovery', 'load_management'],
            sports: ['all_sports'],
            populations: ['athletes'],
            outcomes: ['performance_readiness', 'underrecovery_risk'],
            horizon: 'both',
        },
        evidence: [{ sourceId: KELLMANN_RECOVERY_SOURCE, directness: 'direct' }],
        limitations: [
            'The consensus supports monitoring and individualization, not a universal fixed 24-, 48- or 72-hour spacing rule.',
            'This claim does not define the product fatigue model, load scale or decision thresholds.',
        ],
        reviewedOn: '2026-08-30',
        version: 1,
    },
    {
        id: KNOWLEDGE_CLAIM_IDS.strenuousLowerBodyResidualFatigue,
        statement: 'Strenuous resistance or plyometric work can produce residual lower-body neuromuscular and performance impairment for roughly 24-72 hours, with magnitude and recovery time strongly dependent on protocol characteristics such as volume, density, proximity to failure and exercise type.',
        claimType: 'causal',
        maturity: 'supported',
        status: 'active',
        evidenceCertainty: 'moderate',
        recommendationStrength: 'informational',
        safetyImpact: 'moderate',
        applicability: {
            contexts: ['strength', 'power', 'recovery', 'concurrent_training'],
            sports: ['strength', 'running', 'cycling', 'field_sports', 'endurance_multisport'],
            populations: ['healthy_adults_and_adolescent_athletes'],
            outcomes: ['neuromuscular_performance', 'sprint_performance', 'change_of_direction', 'perceived_fatigue'],
            horizon: 'acute',
        },
        evidence: [
            { sourceId: HARRISON_MUSCLE_DAMAGE_SOURCE, directness: 'direct' },
            { sourceId: VARELA_RT_FATIGUE_SOURCE, directness: 'partially_direct' },
        ],
        limitations: [
            'The 72-hour findings include deliberately muscle-damaging resistance/plyometric protocols and should not be generalized to every strength session.',
            'Recovery is heterogeneous; the evidence does not establish the product lowerBodyCost >= 0.6 threshold or a universal two-day gap.',
            'Protocol dose and athlete training status materially affect fatigue and recovery.',
        ],
        reviewedOn: '2026-08-30',
        version: 1,
    },
    {
        id: KNOWLEDGE_CLAIM_IDS.concurrentStrengthEnduranceContext,
        statement: 'Concurrent strength and endurance training can be effective, while interference and sequencing effects are context-dependent; performing different modalities on the same day is not inherently contraindicated and prescriptions should account for athlete goals, training status and tolerability.',
        claimType: 'intervention',
        maturity: 'supported',
        status: 'active',
        evidenceCertainty: 'moderate',
        recommendationStrength: 'conditional',
        safetyImpact: 'moderate',
        applicability: {
            contexts: ['concurrent_training', 'endurance', 'strength'],
            sports: ['cycling', 'running', 'endurance_multisport', 'team_sports'],
            populations: ['healthy_adult_athletes'],
            outcomes: ['lower_body_strength', 'endurance_performance', 'training_quality'],
            horizon: 'chronic',
        },
        evidence: [
            { sourceId: HUIBERTS_CONCURRENT_SOURCE, directness: 'direct' },
            { sourceId: EDDENS_SEQUENCE_SOURCE, directness: 'direct' },
            { sourceId: BANGSBO_ELITE_CONSENSUS_SOURCE, directness: 'direct' },
        ],
        limitations: [
            'Some lower-body strength interference and exercise-sequence effects have been observed; effects differ by outcome, sex and training status.',
            'The evidence does not establish that heavy strength and key endurance sessions must always be separated by one or more calendar days.',
            'The 2025 elite-athlete consensus is most directly applicable to trained/elite athletes and emphasizes individualization.',
        ],
        reviewedOn: '2026-08-30',
        version: 1,
    },
    {
        id: KNOWLEDGE_CLAIM_IDS.internalLoadIntensityBands,
        statement: 'The product classifies non-recovery sessions as hard when category semantics say hard/race-specific or systemicCost is at least 0.6, as moderate when category semantics say moderate or systemicCost is at least 0.3, and requires plannedIntensity at least 0.8 for a hard candidate; related history fallbacks use systemicCost 0.5-0.7 to identify load/anchor context.',
        claimType: 'heuristic',
        maturity: 'heuristic',
        status: 'active',
        evidenceCertainty: 'not_applicable',
        recommendationStrength: 'conditional',
        safetyImpact: 'moderate',
        applicability: {
            contexts: ['recommendation_engine', 'internal_load_scale'],
            sports: ['all_supported_sports'],
            populations: ['product_users'],
            outcomes: ['candidate_intensity_classification', 'history_load_classification'],
            horizon: 'both',
        },
        evidence: [{ sourceId: LOAD_INTENSITY_RECOVERY_PRODUCT_POLICY_SOURCE, directness: 'direct' }],
        limitations: [
            'systemicCost and plannedIntensity are internal product scales, not physiological intensity zones or validated biomarker thresholds.',
            'The exact 0.3/0.5/0.6/0.65/0.7/0.8 boundaries are product calibration values, not scientific cut-points.',
        ],
        reviewedOn: '2026-08-30',
        version: 1,
    },
    {
        id: KNOWLEDGE_CLAIM_IDS.rollingHardDensityCap,
        statement: 'The product counts a prior session with systemicCost at least 0.5 as hard for rolling-density protection and rejects another systemicCost-at-least-0.5 candidate when three such sessions occurred in the previous six calendar days.',
        claimType: 'heuristic',
        maturity: 'heuristic',
        status: 'active',
        evidenceCertainty: 'not_applicable',
        recommendationStrength: 'conditional',
        safetyImpact: 'high',
        applicability: {
            contexts: ['recommendation_engine', 'load_management'],
            sports: ['all_supported_sports'],
            populations: ['product_users'],
            outcomes: ['hard_session_density_guardrail'],
            horizon: 'acute',
        },
        evidence: [{ sourceId: LOAD_INTENSITY_RECOVERY_PRODUCT_POLICY_SOURCE, directness: 'direct' }],
        limitations: [
            'This is a conservative product guardrail; evidence on endurance intensity distribution does not establish three sessions in six days as a universal physiological maximum.',
            'The internal systemicCost >= 0.5 definition is product semantics rather than an external intensity threshold.',
        ],
        reviewedOn: '2026-08-30',
        version: 1,
    },
    {
        id: KNOWLEDGE_CLAIM_IDS.anchorSpacing,
        statement: 'The product rejects an anchor-quality candidate when another anchor-quality exposure occurred on the previous calendar day.',
        claimType: 'heuristic',
        maturity: 'heuristic',
        status: 'active',
        evidenceCertainty: 'not_applicable',
        recommendationStrength: 'conditional',
        safetyImpact: 'moderate',
        applicability: {
            contexts: ['recommendation_engine', 'quality_session_spacing'],
            sports: ['cycling', 'endurance'],
            populations: ['product_users'],
            outcomes: ['quality_session_spacing_guardrail'],
            horizon: 'acute',
        },
        evidence: [{ sourceId: LOAD_INTENSITY_RECOVERY_PRODUCT_POLICY_SOURCE, directness: 'direct' }],
        limitations: [
            'A one-calendar-day exclusion is a product safety/performance heuristic, not a universal recovery duration established by the literature.',
        ],
        reviewedOn: '2026-08-30',
        version: 1,
    },
    {
        id: KNOWLEDGE_CLAIM_IDS.hardLowerBodySpacing,
        statement: 'The product treats lowerBodyCost at least 0.6 as hard lower-body work and applies a default two-calendar-day minimum gap to another hard-lower-body candidate, while allowing authored workout recovery metadata to specify a different requirement.',
        claimType: 'heuristic',
        maturity: 'heuristic',
        status: 'active',
        evidenceCertainty: 'not_applicable',
        recommendationStrength: 'conditional',
        safetyImpact: 'high',
        applicability: {
            contexts: ['recommendation_engine', 'lower_body_recovery'],
            sports: ['strength', 'cycling', 'running', 'field_sports', 'endurance_multisport'],
            populations: ['product_users'],
            outcomes: ['lower_body_spacing_guardrail'],
            horizon: 'acute',
        },
        evidence: [{ sourceId: LOAD_INTENSITY_RECOVERY_PRODUCT_POLICY_SOURCE, directness: 'direct' }],
        limitations: [
            'The 0.6 cost threshold and two-day default are product calibration, not universal physiological recovery cut-points.',
            'Individual authored workout recoveryHours/minimumDays values remain catalog-specific policy data and require their own evidence/calibration audit.',
        ],
        reviewedOn: '2026-08-30',
        version: 1,
    },
    {
        id: KNOWLEDGE_CLAIM_IDS.strengthEnduranceAdjacency,
        statement: 'The product conservatively blocks heavy lower-body strength and key cycling sessions from occurring on the same or adjacent calendar day in either order, with a next-day post-heavy-strength buffer for strength unless workout metadata explicitly permits otherwise.',
        claimType: 'heuristic',
        maturity: 'heuristic',
        status: 'active',
        evidenceCertainty: 'not_applicable',
        recommendationStrength: 'conditional',
        safetyImpact: 'moderate',
        applicability: {
            contexts: ['recommendation_engine', 'concurrent_training'],
            sports: ['cycling', 'strength'],
            populations: ['product_users'],
            outcomes: ['key_session_quality_protection'],
            horizon: 'acute',
        },
        evidence: [{ sourceId: LOAD_INTENSITY_RECOVERY_PRODUCT_POLICY_SOURCE, directness: 'direct' }],
        limitations: [
            'This is deliberately more conservative than evidence requiring a universal separation: concurrent modalities can be effective on the same day.',
            'The rule protects session quality under uncertainty; it is not a scientific claim that same-day strength and endurance training is harmful.',
        ],
        reviewedOn: '2026-08-30',
        version: 1,
    },
    {
        id: KNOWLEDGE_CLAIM_IDS.recentHardReadinessPenalty,
        statement: 'The product adds 1.0 readiness-strain point when the recovery snapshot reports at least two hard sessions in the previous three calendar days.',
        claimType: 'heuristic',
        maturity: 'heuristic',
        status: 'active',
        evidenceCertainty: 'not_applicable',
        recommendationStrength: 'conditional',
        safetyImpact: 'moderate',
        applicability: {
            contexts: ['recommendation_engine', 'daily_readiness'],
            sports: ['all_supported_sports'],
            populations: ['product_users'],
            outcomes: ['daily_training_mode'],
            horizon: 'acute',
        },
        evidence: [{ sourceId: LOAD_INTENSITY_RECOVERY_PRODUCT_POLICY_SOURCE, directness: 'direct' }],
        limitations: [
            'The three-day window, count of two and +1.0 score contribution are product calibration values and are not validated universal physiological thresholds.',
        ],
        reviewedOn: '2026-08-30',
        version: 1,
    },
    {
        id: KNOWLEDGE_CLAIM_IDS.fatigueDecayHalfLives,
        statement: 'The product decays latent training fatigue exponentially using half-lives of 36 h systemic, 24 h cardiovascular, 48 h lower body, 36 h upper body, 48 h impact tissue and 36 h neuromuscular.',
        claimType: 'heuristic',
        maturity: 'heuristic',
        status: 'active',
        evidenceCertainty: 'not_applicable',
        recommendationStrength: 'conditional',
        safetyImpact: 'moderate',
        applicability: {
            contexts: ['recommendation_engine', 'fatigue_projection'],
            sports: ['all_supported_sports'],
            populations: ['product_users'],
            outcomes: ['projected_dimensional_fatigue'],
            horizon: 'acute',
        },
        evidence: [{ sourceId: LOAD_INTENSITY_RECOVERY_PRODUCT_POLICY_SOURCE, directness: 'direct' }],
        limitations: [
            'These half-lives are a compact product model, not direct estimates of universal human recovery kinetics.',
            'Empirical recovery varies with exercise type, dose, muscle damage, training status and individual response.',
        ],
        reviewedOn: '2026-08-30',
        version: 1,
    },
];

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const PMID_PATTERN = /^\d+$/;
const PMCID_PATTERN = /^PMC\d+$/i;
const PROSPERO_PATTERN = /^CRD\d+$/i;
const DOI_PATTERN = /^10\.\d{4,9}\/\S+$/i;
const REVIEW_SOURCE_TYPES: readonly KnowledgeSourceType[] = ['systematic_review', 'umbrella_review'];

/** Validate both ISO date shape and Gregorian calendar validity without timezone-dependent parsing. */
function isIsoCalendarDate(value: string): boolean {
    const match = ISO_DATE_PATTERN.exec(value);
    if (!match) return false;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (month < 1 || month > 12 || day < 1) return false;
    const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    return day <= daysInMonth[month - 1];
}

/** Normalize stable external identifiers for duplicate detection without changing display values. */
function normalizedExternalId(identifier: KnowledgeExternalId): string {
    const value = identifier.value.trim();
    const normalizedValue = identifier.type === 'doi'
        ? value.toLowerCase()
        : identifier.type === 'pmcid' || identifier.type === 'prospero'
            ? value.toUpperCase()
            : value;
    return `${identifier.type}:${normalizedValue}`;
}

/** Return a validation error when an external identifier has an invalid format. */
function externalIdFormatError(identifier: KnowledgeExternalId): string | null {
    const value = identifier.value.trim();
    if (!value) return 'value is required';
    if (identifier.type === 'pmid' && !PMID_PATTERN.test(value)) return 'PMID must contain digits only';
    if (identifier.type === 'pmcid' && !PMCID_PATTERN.test(value)) return 'PMCID must use PMC followed by digits';
    if (identifier.type === 'prospero' && !PROSPERO_PATTERN.test(value)) return 'PROSPERO id must use CRD followed by digits';
    if (identifier.type === 'doi' && !DOI_PATTERN.test(value)) return 'DOI must use the 10.xxxx/... form';
    return null;
}

/**
 * Validate referential, lifecycle, source-synthesis, and epistemic invariants for a candidate sports knowledge registry.
 * This deliberately checks structure and category errors; it does not replace scientific peer review.
 */
export function validateSportsKnowledgeRegistry(
    sources: readonly KnowledgeSource[] = SPORTS_KNOWLEDGE_SOURCES,
    claims: readonly KnowledgeClaim[] = SPORTS_KNOWLEDGE_CLAIMS,
): KnowledgeRegistryValidation {
    const errors: string[] = [];
    const warnings: string[] = [];
    const sourceIds = new Set<string>();
    const sourceById = new Map<string, KnowledgeSource>();
    const externalIds = new Set<string>();
    const claimIds = new Set<string>();

    for (const source of sources) {
        if (!ID_PATTERN.test(source.id)) errors.push(`source ${source.id}: id must be stable and machine-safe`);
        if (sourceIds.has(source.id)) errors.push(`duplicate source id: ${source.id}`);
        sourceIds.add(source.id);
        sourceById.set(source.id, source);
        if (!source.title.trim()) errors.push(`source ${source.id}: title is required`);
        if (!source.citation.trim()) errors.push(`source ${source.id}: citation is required`);
        if (source.publishedOn && !isIsoCalendarDate(source.publishedOn)) {
            errors.push(`source ${source.id}: publishedOn must be a valid YYYY-MM-DD calendar date`);
        }

        const sourceSynthesisMethods = new Set<KnowledgeSynthesisMethod>();
        for (const method of source.synthesisMethods ?? []) {
            if (sourceSynthesisMethods.has(method)) errors.push(`source ${source.id}: duplicate synthesis method ${method}`);
            sourceSynthesisMethods.add(method);
        }
        if (sourceSynthesisMethods.size > 0 && !REVIEW_SOURCE_TYPES.includes(source.sourceType)) {
            errors.push(`source ${source.id}: synthesisMethods are reserved for systematic/umbrella reviews`);
        }

        for (const identifier of source.externalIds ?? []) {
            const formatError = externalIdFormatError(identifier);
            if (formatError) errors.push(`source ${source.id}: invalid ${identifier.type} identifier: ${formatError}`);
            const normalized = normalizedExternalId(identifier);
            if (externalIds.has(normalized)) errors.push(`duplicate external source identifier: ${normalized}`);
            externalIds.add(normalized);
        }
    }

    for (const claim of claims) {
        if (!ID_PATTERN.test(claim.id)) errors.push(`claim ${claim.id}: id must be stable and machine-safe`);
        if (claimIds.has(claim.id)) errors.push(`duplicate claim id: ${claim.id}`);
        claimIds.add(claim.id);
    }

    const claimById = new Map(claims.map(claim => [claim.id, claim]));

    for (const claim of claims) {
        if (!claim.statement.trim()) errors.push(`claim ${claim.id}: statement is required`);
        if (!Number.isInteger(claim.version) || claim.version < 1) errors.push(`claim ${claim.id}: version must be a positive integer`);
        if (!isIsoCalendarDate(claim.reviewedOn)) errors.push(`claim ${claim.id}: reviewedOn must be a valid YYYY-MM-DD calendar date`);
        if (claim.evidence.length === 0) errors.push(`claim ${claim.id}: at least one evidence/source link is required`);
        if (claim.supersedes === claim.id) errors.push(`claim ${claim.id}: cannot supersede itself`);
        if (claim.supersedes && !claimIds.has(claim.supersedes)) errors.push(`claim ${claim.id}: supersedes unknown claim ${claim.supersedes}`);

        if (claim.supersedes !== claim.id) {
            const lineage = new Set<string>([claim.id]);
            let predecessor = claim.supersedes;
            while (predecessor) {
                if (lineage.has(predecessor)) {
                    errors.push(`claim ${claim.id}: supersedes chain contains a cycle`);
                    break;
                }
                lineage.add(predecessor);
                predecessor = claimById.get(predecessor)?.supersedes;
            }
        }

        const linkedSources = new Set<string>();
        let hasProductPolicySource = false;
        let hasNonProductPolicySource = false;
        for (const link of claim.evidence) {
            const source = sourceById.get(link.sourceId);
            if (!source) errors.push(`claim ${claim.id}: unknown source ${link.sourceId}`);
            if (linkedSources.has(link.sourceId)) errors.push(`claim ${claim.id}: duplicate source link ${link.sourceId}`);
            linkedSources.add(link.sourceId);
            hasProductPolicySource ||= source?.sourceType === 'product_policy';
            hasNonProductPolicySource ||= source !== undefined && source.sourceType !== 'product_policy';
        }

        if (claim.maturity === 'heuristic' && claim.evidenceCertainty !== 'not_applicable') {
            errors.push(`claim ${claim.id}: heuristic maturity must not masquerade as scientific certainty`);
        }
        if (claim.maturity === 'heuristic' && !hasProductPolicySource) {
            errors.push(`claim ${claim.id}: heuristic maturity requires an explicit product_policy source`);
        }
        if (claim.evidenceCertainty !== 'not_applicable' && !hasNonProductPolicySource) {
            errors.push(`claim ${claim.id}: scientific certainty requires at least one non-product-policy source`);
        }
        if (claim.evidenceCertainty === 'not_applicable' && claim.maturity !== 'heuristic' && claim.maturity !== 'foundational') {
            errors.push(`claim ${claim.id}: not_applicable certainty is reserved for heuristic/foundational claims`);
        }
        if ((claim.status === 'deprecated' || claim.status === 'rejected') && claim.recommendationStrength === 'strong') {
            errors.push(`claim ${claim.id}: deprecated/rejected claims cannot authorize strong recommendations`);
        }
        if (
            claim.safetyImpact === 'high'
            && claim.recommendationStrength === 'strong'
            && (claim.maturity === 'emerging' || claim.maturity === 'heuristic' || ['low', 'very_low', 'not_applicable'].includes(claim.evidenceCertainty))
        ) {
            errors.push(`claim ${claim.id}: high-safety strong policy requires at least supported maturity and moderate certainty`);
        }
        if (claim.status === 'contested') warnings.push(`claim ${claim.id}: contested claim requires explicit consumer opt-in`);
        if (claim.limitations.length === 0) warnings.push(`claim ${claim.id}: no applicability limitations recorded`);
    }

    return { valid: errors.length === 0, errors, warnings };
}

/** Return a registered claim regardless of lifecycle status, or throw for an unknown ID. */
export function getKnowledgeClaim(id: string): KnowledgeClaim {
    const claim = SPORTS_KNOWLEDGE_CLAIMS.find(candidate => candidate.id === id);
    if (!claim) throw new Error(`Unknown sports knowledge claim: ${id}`);
    return claim;
}

/** Return an active claim for production-policy consumption and fail closed for any other status. */
export function getActiveKnowledgeClaim(id: string): KnowledgeClaim {
    const claim = getKnowledgeClaim(id);
    if (claim.status !== 'active') {
        throw new Error(`Sports knowledge claim ${id} is ${claim.status}; active policy cannot consume it implicitly`);
    }
    return claim;
}

/** Return a normalized knowledge source, or throw for an unknown source ID. */
export function getKnowledgeSource(id: string): KnowledgeSource {
    const source = SPORTS_KNOWLEDGE_SOURCES.find(candidate => candidate.id === id);
    if (!source) throw new Error(`Unknown sports knowledge source: ${id}`);
    return source;
}
