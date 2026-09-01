import type { KnowledgeClaim, KnowledgeSource } from './sportsKnowledge';

export const INJURY_PAIN_CLAIM_IDS = {
    symptomsRequireContextualAssessment: 'injury.symptoms.require_contextual_assessment',
    returnToSportCriteriaBasedRiskManagement: 'injury.return_to_sport.criteria_based_risk_management',
    tissueResponseTemporalMonitoring: 'injury.tissue_response.temporal_monitoring_condition_specific',
    tissueResponseSeverityPolicyV1: 'policy.injury.tissue_response_severity_v1',
    tissueResponseSeverityPolicy: 'policy.injury.tissue_response_severity_v2',
    lowerLimbImpactPolicy: 'policy.injury.region_lower_limb_impact_v1',
    lowerLimbStrengthPolicy: 'policy.injury.region_lower_limb_strength_v1',
    lumbarLoadingPolicyV1: 'policy.injury.region_lumbar_loading_v1',
    lumbarLoadingPolicy: 'policy.injury.region_lumbar_loading_v2',
    upperLimbLoadingPolicy: 'policy.injury.region_upper_limb_loading_v1',
    genericClinicalEnvelopePolicyV1: 'policy.injury.generic_clinical_envelope_v1',
    genericClinicalEnvelopePolicy: 'policy.injury.contextual_clinical_envelope_v2',
    clinicalEscalationProtocol: 'policy.safety.clinical_escalation_protocol',
} as const;

const IOC_PAIN_CONSENSUS_SOURCE = 'HAINLINE-2017-IOC-PAIN-CONSENSUS';
const RETURN_TO_SPORT_CONSENSUS_SOURCE = 'HERRING-2024-RETURN-TO-SPORT-CONSENSUS';
const TENDINOPATHY_PROGRESSION_REVIEW_SOURCE = 'ESCRICHE-ESCUDER-2020-LOWER-LIMB-TENDINOPATHY-PROGRESSION-REVIEW';
const INITIAL_MSK_ASSESSMENT_CONSENSUS_SOURCE = 'HERRING-2024-INITIAL-MSK-ASSESSMENT-CONSENSUS';
const INJURY_PRODUCT_POLICY_SOURCE = 'PRODUCT-INJURY-CLINICAL-SYMPTOM-POLICY-V1';
const CONTEXTUAL_CLINICAL_PRODUCT_POLICY_SOURCE = 'PRODUCT-INJURY-CLINICAL-SYMPTOM-POLICY-V2';
const TISSUE_RESPONSE_SEVERITY_PRODUCT_POLICY_V2_SOURCE = 'PRODUCT-TISSUE-RESPONSE-SEVERITY-POLICY-V2';
const LUMBAR_LOADING_PRODUCT_POLICY_V2_SOURCE = 'PRODUCT-LUMBAR-LOADING-POLICY-V2';
const CLINICAL_ESCALATION_PRODUCT_POLICY_SOURCE = 'PRODUCT-CLINICAL-ESCALATION-POLICY-V1';

/**
 * Exact descriptor of the current injury and clinical-symptom product policy. It is
 * deliberately data-only: alignment tests compare it with `injuryPolicy.ts`, `adapters.ts`
 * and `rules.ts`, while the executable policy remains independent of the evidence registry.
 */
export const INJURY_PAIN_POLICY_DESCRIPTOR = {
    tissueResponseSeverity: {
        sourceSignals: ['morningState', 'painDuringTraining', 'afterTrainingState', 'nextMorningReaction'],
        severeSignalMapping: 'exclude',
        persistentOrDelayedModerateMapping: 'limit',
        transientDuringSessionLoadingSettledMapping: 'monitor',
        mildSignalMapping: 'monitor',
        normalSignalMapping: null,
        standingConstraintRule: 'preserve_or_tighten',
        derivedConstraintScope: 'today_only',
    },
    regionMappings: {
        lowerLimbImpact: {
            regions: ['knee', 'achilles', 'ankle', 'calf'],
            limit: { restrictedModalities: [], impliedGuardrails: ['avoid_high_impact'], restrictedCategories: [] },
            exclude: { restrictedModalities: ['Running'], impliedGuardrails: ['avoid_high_impact'], restrictedCategories: [] },
        },
        lowerLimbStrength: {
            regions: ['hamstring', 'quadriceps', 'adductor_groin', 'hip'],
            limit: { restrictedModalities: [], impliedGuardrails: ['avoid_heavy_lower_body'], restrictedCategories: [] },
            exclude: { restrictedModalities: [], impliedGuardrails: ['avoid_heavy_lower_body'], restrictedCategories: ['Lower-body Strength', 'Full-body Strength'] },
        },
        lumbarLoading: {
            regions: ['lower_back'],
            limit: { restrictedModalities: [], impliedGuardrails: ['avoid_heavy_spinal_loading'], restrictedCategories: [] },
            exclude: { restrictedModalities: [], impliedGuardrails: ['avoid_heavy_spinal_loading', 'avoid_heavy_lower_body', 'avoid_high_impact'], restrictedCategories: [] },
        },
        upperLimbLoading: {
            regions: ['shoulder', 'elbow', 'wrist'],
            limit: { restrictedModalities: [], impliedGuardrails: ['avoid_overhead_pressing'], restrictedCategories: [] },
            exclude: { restrictedModalities: [], impliedGuardrails: ['avoid_overhead_pressing'], restrictedCategories: ['Upper-body Strength'] },
        },
    },
    genericClinicalEnvelope: {
        aggregateFlag: 'painOrInjury || (illnessSymptoms && !allergyLikeSymptomDay)',
        sourceCategories: ['pain_or_injury', 'non_allergy_illness'],
        maxTierWhenCurrentClinicalSymptoms: 'Mobility',
        maxTierWhenAlreadyTrained: 'Rest',
        genericRunningRestriction: {
            appliesToSource: 'pain_or_injury',
            currentPainLocationSource: 'today_structured_tissue_responses_only',
            restrictWhenLocationUnknown: true,
            restrictWhenRegionFamilyIncludes: ['lower_limb_impact'],
            noGenericRestrictionForIsolatedFamilies: ['lower_limb_strength', 'lumbar_loading', 'upper_limb_loading'],
            provenanceTraceMayControlPolicy: false,
        },
    },
    clinicalEscalationProtocol: {
        redFlagCategories: ['neurological', 'acute_trauma_structural', 'systemic_infection', 'rapidly_worsening'],
        maxTierWhenRedFlag: 'Rest',
        enforceMode: 'recover',
        requiresMedicalReferral: true,
        prohibitsPhysicalTraining: true,
    },
} as const;

export const INJURY_PAIN_SOURCES: readonly KnowledgeSource[] = [
    {
        id: IOC_PAIN_CONSENSUS_SOURCE,
        title: 'International Olympic Committee consensus statement on pain management in elite athletes',
        sourceType: 'consensus',
        citation: 'Hainline B, et al. Br J Sports Med. 2017;51(17):1245-1258. doi:10.1136/bjsports-2017-097884.',
        url: 'https://pubmed.ncbi.nlm.nih.gov/28827314/',
        publishedOn: '2017-09-01',
        externalIds: [{ type: 'pmid', value: '28827314' }, { type: 'doi', value: '10.1136/bjsports-2017-097884' }],
        notes: 'Elite-athlete consensus. It describes pain as multifactorial and supports a contextual assessment approach; it does not establish an anatomy-agnostic training restriction, severity threshold, or consumer-app return-to-sport rule.',
    },
    {
        id: RETURN_TO_SPORT_CONSENSUS_SOURCE,
        title: 'Team Physician Consensus Statement: Return to Sport/Return to Play and the Team Physician: A Team Physician Consensus Statement-2023 Update',
        sourceType: 'consensus',
        citation: 'Herring SA, et al. Curr Sports Med Rep. 2024;23(5):183-191. doi:10.1249/JSR.0000000000001169.',
        url: 'https://pubmed.ncbi.nlm.nih.gov/38709944/',
        publishedOn: '2024-05-01',
        externalIds: [{ type: 'pmid', value: '38709944' }, { type: 'doi', value: '10.1249/JSR.0000000000001169' }],
        notes: 'Team-physician consensus about return-to-sport decision-making. It supports a clinician-led, contextual risk-management boundary; it does not validate a body-region lookup table or replace individual assessment.',
    },
    {
        id: TENDINOPATHY_PROGRESSION_REVIEW_SOURCE,
        title: 'Load progression criteria in exercise programmes in lower limb tendinopathy: a systematic review',
        sourceType: 'systematic_review',
        citation: 'Escriche-Escuder A, Casaña J, Cuesta-Vargas AI. BMJ Open. 2020;10:e041433. doi:10.1136/bmjopen-2020-041433.',
        url: 'https://pubmed.ncbi.nlm.nih.gov/33444210/',
        publishedOn: '2020-11-19',
        externalIds: [{ type: 'pmid', value: '33444210' }, { type: 'pmcid', value: 'PMC7678382' }, { type: 'doi', value: '10.1136/bmjopen-2020-041433' }],
        synthesisMethods: ['narrative_synthesis'],
        notes: 'Thirty lower-limb tendinopathy exercise trials frequently used pain-based progression criteria, but the review found their use was not supported by strong comparative evidence. It is condition- and population-limited and does not validate the product severity state machine.',
    },
    {
        id: INITIAL_MSK_ASSESSMENT_CONSENSUS_SOURCE,
        title: 'Initial Assessment and Management of Select Musculoskeletal Injuries: A Team Physician Consensus Statement',
        sourceType: 'consensus',
        citation: 'Herring SA, et al. Curr Sports Med Rep. 2024;23(3):86-104. doi:10.1249/JSR.0000000000001151.',
        url: 'https://pubmed.ncbi.nlm.nih.gov/38437494/',
        publishedOn: '2024-03-01',
        externalIds: [{ type: 'pmid', value: '38437494' }, { type: 'doi', value: '10.1249/JSR.0000000000001151' }],
        notes: 'Team-physician consensus for initial assessment and management of selected musculoskeletal injuries. It supports the boundary that clinical assessment is distinct from automated training advice; it does not supply a universal self-report routing algorithm.',
    },
    {
        id: INJURY_PRODUCT_POLICY_SOURCE,
        title: 'Injury and clinical-symptom policy v1',
        sourceType: 'product_policy',
        citation: 'Adaptive Training Recommender product policy: injury-clinical-symptom-v1.',
        notes: 'Historical policy that coupled the aggregate pain/injury/non-allergy-illness flag to both the Mobility ceiling and a generic Running restriction. Retained so persisted v1 lineage remains resolvable after SEP-C1.',
    },
    {
        id: CONTEXTUAL_CLINICAL_PRODUCT_POLICY_SOURCE,
        title: 'Injury and clinical-symptom policy v2 (SEP-C1 contextual clinical envelope)',
        sourceType: 'product_policy',
        citation: 'Adaptive Training Recommender product policy: injury-clinical-symptom-v2 / SEP-C1.',
        notes: 'Separates the systemic current-clinical-symptom ceiling from the pain/injury-specific generic Running fallback. Current pain location comes only from today structured tissue responses; standing-injury trace remains provenance and cannot loosen policy.',
    },
    {
        id: TISSUE_RESPONSE_SEVERITY_PRODUCT_POLICY_V2_SOURCE,
        title: 'Tissue response severity policy v2 (SEP-C3 latency-aware)',
        sourceType: 'product_policy',
        citation: 'Adaptive Training Recommender product policy: tissue-response-severity-v2 (SEP-C3).',
        notes: 'Evaluates tissue response with 24-hour response latency: severe at any point maps to exclude; persistent post-session or delayed next-morning moderate irritability maps to limit; transient during-session moderate loading discomfort that settles post-session and next morning maps to monitor (tolerable loading, Escriche-Escuder 2020); mild maps to monitor; normal maps to null.',
    },
    {
        id: LUMBAR_LOADING_PRODUCT_POLICY_V2_SOURCE,
        title: 'Lumbar loading restriction policy v2 (SEP-C3 axial shock offload)',
        sourceType: 'product_policy',
        citation: 'Adaptive Training Recommender product policy: lumbar-loading-v2 (SEP-C3).',
        notes: 'For lower-back constraints, limit applies avoid-heavy-spinal-loading, while exclude applies avoid-heavy-spinal-loading, avoid-heavy-lower-body, and avoid-high-impact to offload high-impact axial shock.',
    },
    {
        id: CLINICAL_ESCALATION_PRODUCT_POLICY_SOURCE,
        title: 'Red-flag & clinical escalation protocol policy v1 (SEP-C4)',
        sourceType: 'product_policy',
        citation: 'Adaptive Training Recommender product policy: clinical-escalation-protocol-v1 (SEP-C4).',
        notes: 'Red-flag presentations (neurological deficit, acute traumatic instability, severe systemic infection/fever, or rapidly worsening symptoms) halt training prescriptions, cap the plan envelope at Rest, and mandate clinical evaluation.',
    },
];

export const INJURY_PAIN_CLAIMS: readonly KnowledgeClaim[] = [
    {
        id: INJURY_PAIN_CLAIM_IDS.symptomsRequireContextualAssessment,
        statement: 'Pain and symptom reports in athletes require contextual assessment of contributing factors and functional impact; they do not independently establish a diagnosis, tissue pathology, injury severity, or suitability for a particular training session.',
        claimType: 'safety', maturity: 'supported', status: 'active', evidenceCertainty: 'moderate', recommendationStrength: 'informational', safetyImpact: 'high',
        applicability: { contexts: ['pain_or_symptom_checkin', 'training_safety'], sports: ['athlete_contexts'], populations: ['athletes_reporting_pain_or_symptoms'], outcomes: ['assessment_boundary'], horizon: 'acute' },
        evidence: [
            { sourceId: IOC_PAIN_CONSENSUS_SOURCE, directness: 'partially_direct', note: 'Direct elite-athlete pain-management consensus; it does not evaluate this product or general consumer users.' },
            { sourceId: INITIAL_MSK_ASSESSMENT_CONSENSUS_SOURCE, directness: 'partially_direct', note: 'Supports a clinical-assessment boundary for selected athletic musculoskeletal injuries.' },
        ],
        limitations: [
            'The sources concern clinical and elite/team-athlete settings, not autonomous consumer-app diagnosis or training prescription.',
            'This boundary does not determine a safe activity dose, identify red flags, or authorize return to sport.',
            'Illness symptoms and musculoskeletal pain can both reduce training suitability but have different causes and must not be represented as the same condition.',
        ],
        reviewedOn: '2026-09-01', version: 1,
    },
    {
        id: INJURY_PAIN_CLAIM_IDS.returnToSportCriteriaBasedRiskManagement,
        statement: 'Return-to-sport decisions after injury are contextual risk-management decisions that require condition-, athlete-, and activity-specific assessment rather than a body-region label or a single symptom response alone.',
        claimType: 'safety', maturity: 'supported', status: 'active', evidenceCertainty: 'moderate', recommendationStrength: 'informational', safetyImpact: 'high',
        applicability: { contexts: ['return_to_sport_boundary', 'injury_safety'], sports: ['athlete_contexts'], populations: ['athletes_returning_after_injury'], outcomes: ['risk_management_boundary'], horizon: 'both' },
        evidence: [{ sourceId: RETURN_TO_SPORT_CONSENSUS_SOURCE, directness: 'partially_direct', note: 'Consensus is direct to team-physician return-to-sport decision-making, not a body-region-only automated rule.' }],
        limitations: [
            'The product does not collect the examination, diagnosis, functional testing, imaging, sport demands, or shared decision-making inputs required for clinical return-to-sport decisions.',
            'This claim does not validate any current region-family restriction or imply that a non-restricted category is medically safe.',
        ],
        reviewedOn: '2026-09-01', version: 1,
    },
    {
        id: INJURY_PAIN_CLAIM_IDS.tissueResponseTemporalMonitoring,
        statement: 'In lower-limb tendinopathy exercise programmes, pain and symptom response during and around loading are commonly used as progression criteria, but comparative evidence is insufficient to establish one universal response threshold or severity-to-restriction translation.',
        claimType: 'descriptive', maturity: 'supported', status: 'active', evidenceCertainty: 'low', recommendationStrength: 'informational', safetyImpact: 'high',
        applicability: { contexts: ['tissue_response_monitoring', 'load_progression'], sports: ['lower_limb_loading_contexts'], populations: ['people_with_midportion_achilles_patellar_or_gluteal_tendinopathy'], outcomes: ['exercise_progression_criteria'], horizon: 'acute' },
        evidence: [{ sourceId: TENDINOPATHY_PROGRESSION_REVIEW_SOURCE, directness: 'direct' }],
        limitations: [
            'The review is limited to specified lower-limb tendinopathies and exercise programmes; it does not cover undiagnosed symptoms, acute injury, lumbar, upper-limb, illness, or all supported sports.',
            'Predominant use of pain criteria is not strong evidence that a particular criterion is effective or safe.',
            'This claim does not validate the product normal/mild/moderate/severe labels, worst-signal rule, or monitor/limit/exclude mapping.',
        ],
        reviewedOn: '2026-09-01', version: 1,
    },
    {
        id: INJURY_PAIN_CLAIM_IDS.tissueResponseSeverityPolicyV1,
        statement: 'The product takes the worst available daily tissue-response signal, maps severe/moderate/mild to exclude/limit/monitor, preserves or tightens active standing constraints, and scopes a newly inferred constraint to the current local day.',
        claimType: 'heuristic', maturity: 'heuristic', status: 'deprecated', evidenceCertainty: 'not_applicable', recommendationStrength: 'conditional', safetyImpact: 'high',
        applicability: { contexts: ['recommendation_engine', 'tissue_response_monitoring'], sports: ['all_supported_sports'], populations: ['product_users_with_structured_tissue_response'], outcomes: ['injury_constraint_severity'], horizon: 'acute' },
        evidence: [{ sourceId: INJURY_PRODUCT_POLICY_SOURCE, directness: 'direct' }],
        limitations: [
            'Superseded by SEP-C3 latency-aware model because naive worst-of aggregation penalized tolerable transient during-session discomfort.',
            'Retained only so historical recommendation lineage remains interpretable.',
        ],
        reviewedOn: '2026-09-01', version: 1,
    },
    {
        id: INJURY_PAIN_CLAIM_IDS.tissueResponseSeverityPolicy,
        statement: 'The product evaluates daily tissue-response observations with 24-hour response latency: severe at any observation point maps to exclude; persistent post-session or delayed next-morning moderate irritability (or waking state) maps to limit; transient during-session moderate loading discomfort that settles by next morning (normal/mild) maps to monitor (tolerable loading); mild maps to monitor; normal maps to null. Active standing constraints are preserved or tightened, and newly inferred constraints are scoped to the current local day.',
        claimType: 'heuristic', maturity: 'heuristic', status: 'active', evidenceCertainty: 'not_applicable', recommendationStrength: 'conditional', safetyImpact: 'high',
        applicability: { contexts: ['recommendation_engine', 'tissue_response_monitoring'], sports: ['all_supported_sports'], populations: ['product_users_with_structured_tissue_response'], outcomes: ['injury_constraint_severity'], horizon: 'acute' },
        evidence: [{ sourceId: TISSUE_RESPONSE_SEVERITY_PRODUCT_POLICY_V2_SOURCE, directness: 'direct' }],
        limitations: [
            'The 24-hour latency model and severity thresholds are product policy, not externally validated clinical constants.',
            'A tissue response neither diagnoses a condition nor clears an active standing constraint.',
            'This policy does not provide medical escalation, treatment, or return-to-sport clearance.',
        ],
        reviewedOn: '2026-09-01', version: 1,
        supersedes: INJURY_PAIN_CLAIM_IDS.tissueResponseSeverityPolicyV1,
    },
    {
        id: INJURY_PAIN_CLAIM_IDS.lowerLimbImpactPolicy,
        statement: 'For knee, Achilles, ankle, and calf constraints, the product applies avoid-high-impact at limit/exclude and additionally restricts Running at exclude.',
        claimType: 'heuristic', maturity: 'heuristic', status: 'active', evidenceCertainty: 'not_applicable', recommendationStrength: 'conditional', safetyImpact: 'high',
        applicability: { contexts: ['recommendation_engine', 'injury_safety'], sports: ['all_supported_sports'], populations: ['product_users_with_matching_active_constraint'], outcomes: ['restriction_mapping'], horizon: 'acute' },
        evidence: [{ sourceId: INJURY_PRODUCT_POLICY_SOURCE, directness: 'direct' }],
        limitations: ['A body region is not a diagnosis and does not establish the safe amount or type of impact exposure.', 'The mapping is conservative product policy and is not condition-specific rehabilitation authority.', 'Explicit athlete modality restrictions pass through independently of this mapping.'],
        reviewedOn: '2026-09-01', version: 1,
    },
    {
        id: INJURY_PAIN_CLAIM_IDS.lowerLimbStrengthPolicy,
        statement: 'For hamstring, quadriceps, adductor/groin, and hip constraints, the product applies avoid-heavy-lower-body at limit/exclude and additionally restricts Lower-body Strength and Full-body Strength at exclude.',
        claimType: 'heuristic', maturity: 'heuristic', status: 'active', evidenceCertainty: 'not_applicable', recommendationStrength: 'conditional', safetyImpact: 'high',
        applicability: { contexts: ['recommendation_engine', 'injury_safety'], sports: ['all_supported_sports'], populations: ['product_users_with_matching_active_constraint'], outcomes: ['restriction_mapping'], horizon: 'acute' },
        evidence: [{ sourceId: INJURY_PRODUCT_POLICY_SOURCE, directness: 'direct' }],
        limitations: ['A body region is not a diagnosis and does not establish the safe load, range, or exercise variant.', 'The mapping is conservative product policy and is not condition-specific rehabilitation authority.', 'Explicit athlete modality restrictions pass through independently of this mapping.'],
        reviewedOn: '2026-09-01', version: 1,
    },
    {
        id: INJURY_PAIN_CLAIM_IDS.lumbarLoadingPolicyV1,
        statement: 'For lower-back constraints, the product applies avoid-heavy-spinal-loading at limit/exclude and additionally applies avoid-heavy-lower-body at exclude.',
        claimType: 'heuristic', maturity: 'heuristic', status: 'deprecated', evidenceCertainty: 'not_applicable', recommendationStrength: 'conditional', safetyImpact: 'high',
        applicability: { contexts: ['recommendation_engine', 'injury_safety'], sports: ['all_supported_sports'], populations: ['product_users_with_matching_active_constraint'], outcomes: ['restriction_mapping'], horizon: 'acute' },
        evidence: [{ sourceId: INJURY_PRODUCT_POLICY_SOURCE, directness: 'direct' }],
        limitations: [
            'Superseded by SEP-C3 which adds the avoid_high_impact guardrail to severe lower-back exclusions to offload repetitive axial impact.',
            'Retained only so historical recommendation lineage remains interpretable.',
        ],
        reviewedOn: '2026-09-01', version: 1,
    },
    {
        id: INJURY_PAIN_CLAIM_IDS.lumbarLoadingPolicy,
        statement: 'For lower-back constraints, the product applies avoid-heavy-spinal-loading at limit/exclude and additionally applies avoid-heavy-lower-body and avoid-high-impact at exclude to offload high-impact axial shock.',
        claimType: 'heuristic', maturity: 'heuristic', status: 'active', evidenceCertainty: 'not_applicable', recommendationStrength: 'conditional', safetyImpact: 'high',
        applicability: { contexts: ['recommendation_engine', 'injury_safety'], sports: ['all_supported_sports'], populations: ['product_users_with_matching_active_constraint'], outcomes: ['restriction_mapping'], horizon: 'acute' },
        evidence: [{ sourceId: LUMBAR_LOADING_PRODUCT_POLICY_V2_SOURCE, directness: 'direct' }],
        limitations: [
            'Lower-back symptoms have heterogeneous causes and require contextual clinical assessment.',
            'The mapping is conservative product policy, not diagnosis-specific rehabilitation authority.',
            'Explicit athlete modality restrictions pass through independently of this mapping.',
        ],
        reviewedOn: '2026-09-01', version: 1,
        supersedes: INJURY_PAIN_CLAIM_IDS.lumbarLoadingPolicyV1,
    },
    {
        id: INJURY_PAIN_CLAIM_IDS.upperLimbLoadingPolicy,
        statement: 'For shoulder, elbow, and wrist constraints, the product applies avoid-overhead-pressing at limit/exclude and additionally restricts Upper-body Strength at exclude.',
        claimType: 'heuristic', maturity: 'heuristic', status: 'active', evidenceCertainty: 'not_applicable', recommendationStrength: 'conditional', safetyImpact: 'high',
        applicability: { contexts: ['recommendation_engine', 'injury_safety'], sports: ['all_supported_sports'], populations: ['product_users_with_matching_active_constraint'], outcomes: ['restriction_mapping'], horizon: 'acute' },
        evidence: [{ sourceId: INJURY_PRODUCT_POLICY_SOURCE, directness: 'direct' }],
        limitations: ['A body region is not a diagnosis and does not establish safe loading across upper-limb activities.', 'The mapping is conservative product policy and is not condition-specific rehabilitation authority.', 'Explicit athlete modality restrictions pass through independently of this mapping.'],
        reviewedOn: '2026-09-01', version: 1,
    },
    {
        id: INJURY_PAIN_CLAIM_IDS.genericClinicalEnvelopePolicyV1,
        statement: 'When the normalized pain flag is true from pain/injury or non-allergy illness symptoms, the product restricts Running and caps the day at Mobility, or Rest when already trained today.',
        claimType: 'heuristic', maturity: 'heuristic', status: 'deprecated', evidenceCertainty: 'not_applicable', recommendationStrength: 'conditional', safetyImpact: 'high',
        applicability: { contexts: ['recommendation_engine', 'clinical_symptom_envelope'], sports: ['all_supported_sports'], populations: ['product_users_with_normalized_pain_flag'], outcomes: ['daily_training_ceiling'], horizon: 'acute' },
        evidence: [{ sourceId: INJURY_PRODUCT_POLICY_SOURCE, directness: 'direct' }],
        limitations: ['Superseded by SEP-C1 because it coupled non-allergy illness to an anatomy-specific Running restriction.', 'Retained only so historical recommendation lineage remains interpretable.'],
        reviewedOn: '2026-09-01', version: 1,
    },
    {
        id: INJURY_PAIN_CLAIM_IDS.genericClinicalEnvelopePolicy,
        statement: 'Current pain/injury and non-allergy illness symptoms both cap the day at Mobility (or Rest when already trained), but only current pain/injury adds the generic Running fallback; that fallback applies when current pain location is unknown or includes a lower-limb-impact family, while isolated current upper-limb, lumbar, or lower-limb-strength context does not add a generic Running restriction.',
        claimType: 'heuristic', maturity: 'heuristic', status: 'active', evidenceCertainty: 'not_applicable', recommendationStrength: 'conditional', safetyImpact: 'high',
        applicability: { contexts: ['recommendation_engine', 'clinical_symptom_envelope'], sports: ['all_supported_sports'], populations: ['product_users_with_current_clinical_symptoms'], outcomes: ['daily_training_ceiling', 'generic_running_fallback'], horizon: 'acute' },
        evidence: [{ sourceId: CONTEXTUAL_CLINICAL_PRODUCT_POLICY_SOURCE, directness: 'direct' }],
        limitations: [
            'This is conservative product policy, not a diagnosis, treatment protocol, or medical/return-to-sport clearance.',
            'Removing a generic Running fallback does not assert that Running is clinically safe; explicit athlete restrictions and standing/today-derived injury constraints remain additive and can still prohibit it.',
            'Current-pain location is accepted only from today structured tissue responses. Standing-injury provenance is not allowed to explain away an otherwise unlocated current pain report.',
            'Allergy-like symptom days are excluded by ADR-0032 cause-aware mapping; unknown or severe symptom presentations remain conservative.',
        ],
        reviewedOn: '2026-09-01', version: 1,
        supersedes: INJURY_PAIN_CLAIM_IDS.genericClinicalEnvelopePolicyV1,
    },
    {
        id: INJURY_PAIN_CLAIM_IDS.clinicalEscalationProtocol,
        statement: 'Red-flag findings (neurological symptoms, acute traumatic structural instability, severe systemic infection with high fever, or rapidly worsening symptoms) halt all physical training recommendations, cap the plan envelope at Rest, and mandate medical evaluation before resuming physical loading.',
        claimType: 'heuristic', maturity: 'heuristic', status: 'active', evidenceCertainty: 'not_applicable', recommendationStrength: 'conditional', safetyImpact: 'high',
        applicability: { contexts: ['recommendation_engine', 'injury_safety'], sports: ['all_supported_sports'], populations: ['product_users_with_red_flag_symptoms'], outcomes: ['daily_training_ceiling', 'clinical_escalation_referral'], horizon: 'acute' },
        evidence: [{ sourceId: CLINICAL_ESCALATION_PRODUCT_POLICY_SOURCE, directness: 'direct' }],
        limitations: [
            'Check-in screening relies on self-reported athlete symptoms and does not replace medical history, physical examination, or diagnostic imaging.',
            'Enforcing a Rest ceiling does not provide clinical treatment or rehabilitation advice; it safely halts automated exercise prescription.',
        ],
        reviewedOn: '2026-09-01', version: 1,
    },
];
