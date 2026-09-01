import type { KnowledgeClaim, KnowledgeSource } from './sportsKnowledge';

export const SUBJECTIVE_READINESS_CLAIM_IDS = {
    contextualMonitoring: 'readiness.subjective.contextual_monitoring',
    measurementQualityLimits: 'readiness.subjective.measurement_quality_limits',
    exactCutpointLimits: 'readiness.subjective.exact_cutpoint_limits',
    modeThresholdsPolicy: 'policy.readiness.subjective_mode_thresholds_v1',
} as const;

const SAW_SUBJECTIVE_MONITORING_SOURCE = 'SAW-2016-SUBJECTIVE-MONITORING-REVIEW';
const DUIGNAN_SINGLE_ITEM_SOURCE = 'DUIGNAN-2020-SINGLE-ITEM-WELLNESS-REVIEW';
const JEFFRIES_AROM_COSMIN_SOURCE = 'JEFFRIES-2020-AROM-COSMIN-REVIEW';
const CAMPBELL_WELLNESS_PREDICTION_SOURCE = 'CAMPBELL-2021-WELLNESS-LOAD-PREDICTION';
const BRAUERS_ARSS_SRSS_VALIDATION_SOURCE = 'BRAUERS-2024-ARSS-SRSS-VALIDATION';
const BRAUERS_FOOTBALL_RESPONSE_META_SOURCE = 'BRAUERS-2026-FOOTBALL-LOAD-RESPONSE-META';
const SUBJECTIVE_READINESS_PRODUCT_POLICY_SOURCE = 'PRODUCT-SUBJECTIVE-READINESS-MODE-V1';

/**
 * A versioned, reviewable description of the existing classifier. It intentionally
 * records policy rather than deriving constants from `rules.ts`, so the alignment
 * tests can detect drift without making the decision implementation depend on this
 * evidence module.
 */
export const SUBJECTIVE_READINESS_POLICY_DESCRIPTOR = {
    neutralDefaultForMissingScaleDimensions: 5,
    composite: {
        denominator: 5,
        dimensions: {
            fatigue: 'direct',
            soreness: 'direct',
            readiness: 'inverted',
            sleepQuality: 'inverted',
            motivation: 'inverted',
        },
        modifyWhen: '> 5',
        recoverWhen: '> 7',
    },
    independentTriggers: {
        sorenessModifyWhen: '> 6',
        fatigueRecoverWhen: '> 8',
        sorenessRecoverWhen: '> 8',
    },
    severeDistressRecoverWhenAny: [
        'fatigue >= 8 && readiness <= 4',
        'readiness <= 3 && stress >= 8',
        'fatigue >= 8 && stress >= 8',
    ],
    acuteSubjectiveModifyWhenAny: [
        'fatigue >= 8',
        'readiness <= 3',
        'stress >= 9',
        'readiness <= 4 && fatigue >= 6',
    ],
    excludedFromThisPolicySurface: ['painFlag', 'illnessSymptoms', 'subjectiveDrift'],
} as const;

export const SUBJECTIVE_READINESS_SOURCES: readonly KnowledgeSource[] = [
    {
        id: SAW_SUBJECTIVE_MONITORING_SOURCE,
        title: 'Monitoring the athlete training response: subjective self-reported measures trump commonly used objective measures: a systematic review',
        sourceType: 'systematic_review',
        citation: 'Saw AE, Main LC, Gastin PB. Br J Sports Med. 2016;50(5):281-291. doi:10.1136/bjsports-2015-094758.',
        url: 'https://pubmed.ncbi.nlm.nih.gov/26423706/',
        publishedOn: '2015-09-09',
        externalIds: [
            { type: 'pmid', value: '26423706' },
            { type: 'pmcid', value: 'PMC4789708' },
            { type: 'doi', value: '10.1136/bjsports-2015-094758' },
        ],
        synthesisMethods: ['narrative_synthesis'],
        notes: 'Review of 56 original studies comparing subjective and objective well-being measures. Subjective measures were generally more sensitive and consistent to acute and chronic training-load changes, but the review did not validate a common questionnaire, composite score, action threshold, injury diagnosis, or training prescription.',
    },
    {
        id: DUIGNAN_SINGLE_ITEM_SOURCE,
        title: 'Single-Item Self-Report Measures of Team-Sport Athlete Wellbeing and Their Relationship With Training Load: A Systematic Review',
        sourceType: 'systematic_review',
        citation: 'Duignan C, Doherty C, Caulfield B, Blake C. J Athl Train. 2020;55(9):944-953. doi:10.4085/1062-6050-0528.19.',
        url: 'https://pubmed.ncbi.nlm.nih.gov/32991706/',
        publishedOn: '2020-09-01',
        externalIds: [
            { type: 'pmid', value: '32991706' },
            { type: 'pmcid', value: 'PMC7534939' },
            { type: 'doi', value: '10.4085/1062-6050-0528.19' },
        ],
        synthesisMethods: ['narrative_synthesis'],
        notes: 'Twenty-one adult field/court-team-sport studies used heterogeneous single-item wellness measures. Associations with modifiable training load ranged from none to very large and were predominantly trivial-to-moderate in larger-observation studies; authors called for measurement-property and clinically meaningful outcome studies.',
    },
    {
        id: JEFFRIES_AROM_COSMIN_SOURCE,
        title: 'Athlete-Reported Outcome Measures for Monitoring Training Responses: A Systematic Review of Risk of Bias and Measurement Property Quality According to the COSMIN Guidelines',
        sourceType: 'systematic_review',
        citation: 'Jeffries AC, Wallace L, Coutts AJ, et al. Int J Sports Physiol Perform. 2020;15(9):1203-1215. doi:10.1123/ijspp.2020-0386.',
        url: 'https://pubmed.ncbi.nlm.nih.gov/32957081/',
        publishedOn: '2020-10-01',
        externalIds: [
            { type: 'pmid', value: '32957081' },
            { type: 'doi', value: '10.1123/ijspp.2020-0386' },
        ],
        synthesisMethods: ['narrative_synthesis'],
        notes: 'COSMIN review found 46.1% of athlete-reported outcome measures were single items. Apart from two reliability/responsiveness studies, it found no validity studies for the frequent single-item measures and identified important content-validity and measurement-error limitations.',
    },
    {
        id: BRAUERS_ARSS_SRSS_VALIDATION_SOURCE,
        title: 'Monitoring the recovery-stress states of athletes: Psychometric properties of the acute recovery and stress scale and short recovery stress scale among Dutch and Flemish athletes',
        sourceType: 'cross_sectional',
        citation: 'Brauers JJ, Den Hartigh RJR, Jakowski S, et al. J Sports Sci. 2024;42(2):189-199. doi:10.1080/02640414.2024.2325783.',
        url: 'https://pubmed.ncbi.nlm.nih.gov/38451830/',
        publishedOn: '2024-03-07',
        externalIds: [
            { type: 'pmid', value: '38451830' },
            { type: 'doi', value: '10.1080/02640414.2024.2325783' },
        ],
        notes: 'Instrument-specific psychometric study in 385 Dutch/Flemish athletes found satisfactory internal consistency and construct-validity support for the named ARSS/SRSS instruments, while a combined recovery-stress factor model fit less well. It demonstrates that later, instrument-specific validation exists without validating this product\'s bespoke single items, composite, defaults, or thresholds.',
    },
    {
        id: BRAUERS_FOOTBALL_RESPONSE_META_SOURCE,
        title: 'The short-term relation between load and acute psychophysiological responses in football: a meta-analysis and methodological considerations',
        sourceType: 'systematic_review',
        citation: 'Brauers JJ, Den Hartigh RJR, Klooster D, et al. Sci Med Footb. 2026;10(1):105-125. doi:10.1080/24733938.2025.2476474.',
        url: 'https://pubmed.ncbi.nlm.nih.gov/40159621/',
        publishedOn: '2025-03-30',
        externalIds: [
            { type: 'pmid', value: '40159621' },
            { type: 'doi', value: '10.1080/24733938.2025.2476474' },
        ],
        synthesisMethods: ['meta_analysis'],
        notes: 'Meta-analysis of 62 articles and 1,474 football-code athletes found modest short-term associations between load and overall wellbeing, soreness, fatigue, sleep quality and stress. High risk of bias, inconsistency and imprecision produced very-low GRADE certainty, so this source supports contextual monitoring only and argues against high-confidence prescriptive thresholds.',
    },
    {
        id: CAMPBELL_WELLNESS_PREDICTION_SOURCE,
        title: 'Analysing the predictive capacity and dose-response of wellness in load monitoring',
        sourceType: 'cohort',
        citation: 'Campbell PG, et al. J Sports Sci. 2021;39(12):1338-1347. doi:10.1080/02640414.2020.1870303.',
        url: 'https://pubmed.ncbi.nlm.nih.gov/33404378/',
        publishedOn: '2021-01-15',
        externalIds: [
            { type: 'pmid', value: '33404378' },
            { type: 'doi', value: '10.1080/02640414.2020.1870303' },
        ],
        notes: '14,109 observations across cricket, rugby league and football found limited predictive capacity of wellness questionnaires for load measures. It informs a limitation boundary only: load prediction is not equivalent to readiness, safety, injury risk, or benefit from a particular session.',
    },
    {
        id: SUBJECTIVE_READINESS_PRODUCT_POLICY_SOURCE,
        title: 'Subjective readiness mode policy v1',
        sourceType: 'product_policy',
        citation: 'Adaptive Training Recommender product policy: subjective-readiness-mode-v1.',
        notes: 'Records the current five-item equal-weight composite, independent subjective triggers, strict/inclusive comparison operators, and neutral midpoint defaults used after minimum-safety check-in validation. These are product calibration and safety choices, not externally validated clinical or physiological cut-points.',
    },
];

export const SUBJECTIVE_READINESS_CLAIMS: readonly KnowledgeClaim[] = [
    {
        id: SUBJECTIVE_READINESS_CLAIM_IDS.contextualMonitoring,
        statement: 'Repeated athlete self-reports of fatigue, soreness and perceived sleep/well-being can contribute contextual information about recent training response, particularly when interpreted alongside training history and other signals; they do not independently establish medical cause, injury status, or suitability for a specific session.',
        claimType: 'prognostic', maturity: 'supported', status: 'active', evidenceCertainty: 'low', recommendationStrength: 'informational', safetyImpact: 'high',
        applicability: { contexts: ['daily_readiness', 'training_monitoring', 'recovery'], sports: ['team_sports_and_other_athlete_monitoring_contexts'], populations: ['athletes_with_repeated_self_report_collection'], outcomes: ['training_response_context', 'wellbeing_context'], horizon: 'both' },
        evidence: [
            { sourceId: SAW_SUBJECTIVE_MONITORING_SOURCE, directness: 'direct' },
            { sourceId: DUIGNAN_SINGLE_ITEM_SOURCE, directness: 'direct', note: 'Direct for adult field/court team-sport single-item wellness, with heterogeneous instruments and associations.' },
            { sourceId: BRAUERS_FOOTBALL_RESPONSE_META_SOURCE, directness: 'direct', note: 'Current quantitative synthesis for short-term load-response associations in football codes; GRADE certainty was very low because of bias, inconsistency and imprecision.' },
        ],
        limitations: [
            'The literature primarily concerns repeated monitoring in team-sport cohorts, not consumer-app prescriptions across all supported sports or health conditions.',
            'The 2026 football meta-analysis found only modest associations and rated certainty very low; the claim is therefore intentionally informational and low-certainty rather than prescriptive.',
            'Self-reported changes are nonspecific and can reflect training, life stress, sleep, illness, expectation, response style and measurement context.',
            'The supported items do not validate this product\'s readiness or motivation items, equal weights, missing-value defaults, or a single-day train/modify/recover action.',
            'This claim is contextual monitoring authority only; pain, illness and injury use separate safety-policy surfaces.',
        ],
        reviewedOn: '2026-09-01', version: 1,
    },
    {
        id: SUBJECTIVE_READINESS_CLAIM_IDS.measurementQualityLimits,
        statement: 'Common athlete single-item wellness ratings and modified questionnaires have heterogeneous and incompletely established measurement properties, so values and changes should be interpreted consistently within person and instrument rather than as interchangeable validated measures of a single readiness construct.',
        claimType: 'descriptive', maturity: 'supported', status: 'active', evidenceCertainty: 'moderate', recommendationStrength: 'informational', safetyImpact: 'high',
        applicability: { contexts: ['daily_readiness', 'athlete_reported_outcomes', 'training_monitoring'], sports: ['team_sports_and_other_athlete_monitoring_contexts'], populations: ['athletes_using_single_item_or_modified_wellness_measures'], outcomes: ['measurement_interpretation', 'readiness_input_interpretation'], horizon: 'both' },
        evidence: [
            { sourceId: JEFFRIES_AROM_COSMIN_SOURCE, directness: 'direct' },
            { sourceId: DUIGNAN_SINGLE_ITEM_SOURCE, directness: 'direct' },
            { sourceId: BRAUERS_ARSS_SRSS_VALIDATION_SOURCE, directness: 'partially_direct', note: 'Shows that named recovery/stress instruments can receive later psychometric support; it does not validate the app\'s bespoke single items or composite.' },
        ],
        limitations: [
            'The COSMIN review is a 2020 evidence snapshot; later instrument-specific studies, including 2024 ARSS/SRSS work, show that some named instruments have psychometric support.',
            'Instrument-specific validation does not transfer automatically to different wording, single items, scale anchors, composites, populations, administration contexts or missing-value policies.',
            'The evidence does not establish that an arbitrary neutral midpoint is measurement-equivalent to an answered item.',
            'Measurement-quality limits do not imply that self-report must be ignored; they limit the certainty and action authority assigned to it.',
            'This claim does not assess clinical screening tools or diagnose injury, illness, overtraining or mental-health conditions.',
        ],
        reviewedOn: '2026-09-01', version: 1,
    },
    {
        id: SUBJECTIVE_READINESS_CLAIM_IDS.exactCutpointLimits,
        statement: 'The reviewed subjective-monitoring literature does not validate the product\'s five-item equal-weight composite, its >5 modify and >7 recover cut-points, its 3/4/6/8/9 item combinations, or neutral defaults as universal clinical, physiological, or performance-readiness thresholds.',
        claimType: 'descriptive', maturity: 'supported', status: 'active', evidenceCertainty: 'moderate', recommendationStrength: 'informational', safetyImpact: 'high',
        applicability: { contexts: ['daily_readiness', 'recommendation_engine', 'athlete_reported_outcomes'], sports: ['all_supported_sports'], populations: ['product_users'], outcomes: ['threshold_interpretation', 'policy_calibration'], horizon: 'acute' },
        evidence: [
            { sourceId: DUIGNAN_SINGLE_ITEM_SOURCE, directness: 'partially_direct', note: 'Reviews heterogeneous single-item wellness instruments and calls for clinically meaningful outcomes rather than supplying product-matching cut-points.' },
            { sourceId: JEFFRIES_AROM_COSMIN_SOURCE, directness: 'partially_direct', note: 'Documents absent/limited validation for frequent single-item AROMs rather than testing this product composite.' },
            { sourceId: CAMPBELL_WELLNESS_PREDICTION_SOURCE, directness: 'indirect', note: 'Reinforces limited predictive authority for load measures; it is not a test of the product classifier or readiness outcome.' },
            { sourceId: BRAUERS_FOOTBALL_RESPONSE_META_SOURCE, directness: 'indirect', note: 'Quantifies load-response associations but does not test a train/modify/recover classifier or product-matching cut-points.' },
        ],
        limitations: [
            'This is a negative boundary from the scoped review, not proof that every threshold is ineffective or unsafe for every athlete.',
            'No study in the selected evidence set tested the exact product questionnaire wording, scale anchors, score directions, population, missing-data policy, decision outcomes or counterfactual session alternatives.',
            'The absence of direct validation does not determine the best replacement threshold; outcome-linked calibration and prospective safety review remain required.',
        ],
        reviewedOn: '2026-09-01', version: 1,
    },
    {
        id: SUBJECTIVE_READINESS_CLAIM_IDS.modeThresholdsPolicy,
        statement: 'The product computes an equal-weight five-item subjective fatigue score from fatigue, soreness, inverted readiness, inverted sleep quality and inverted motivation; it modifies above 5 and recovers above 7, applies the documented independent and combination triggers, and maps missing non-safety scale dimensions to neutral 5 after minimum-safety check-in validation.',
        claimType: 'heuristic', maturity: 'heuristic', status: 'active', evidenceCertainty: 'not_applicable', recommendationStrength: 'conditional', safetyImpact: 'high',
        applicability: { contexts: ['recommendation_engine', 'daily_readiness'], sports: ['all_supported_sports'], populations: ['product_users_with_a_complete_minimum_safety_checkin'], outcomes: ['daily_training_mode'], horizon: 'acute' },
        evidence: [{ sourceId: SUBJECTIVE_READINESS_PRODUCT_POLICY_SOURCE, directness: 'direct' }],
        limitations: [
            'The equal weights, >5/>7 thresholds, 3/4/6/8/9 comparisons, combination triggers and neutral midpoint are product calibration rather than externally validated clinical or physiological constants.',
            'Minimum-safety completeness requires answered pain/injury, illness and already-trained flags plus fatigue or soreness; other scale dimensions can be neutral defaults and were not necessarily measured that day.',
            'Pain/illness mapping and default-off subjective-drift logic are intentionally excluded from this claim and retain their separate policy/evidence status.',
            'A recover/modify output is conservative product guidance, not a diagnosis, return-to-sport clearance, or substitute for medical assessment.',
        ],
        reviewedOn: '2026-09-01', version: 1,
    },
];