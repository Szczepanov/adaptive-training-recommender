import type { KnowledgeClaim, KnowledgeSource } from './sportsKnowledge';

/**
 * SKR3 Evidence Pack 6 (W1): periodization phase structure and sport/event demand profiling.
 *
 * Two scientific boundaries, four product-policy calibration records. Per the SKR3 method the
 * atomic claims below were drafted from the exact current product rule (see
 * `docs/plans/2026-09-02-skr3-completion-plan.md` §W1) before evidence was searched. The
 * evidence found supports the general strategies (structured periodization with no established
 * universally superior organization; event-duration/format-dependent physiological demand)
 * without validating any exact scalar this codebase uses -- day boundaries, blend weights,
 * volume/intensity scales, normalized inclusion thresholds, contribution windows, or the 19
 * authored event-preset demand vectors. None of those families reach `covered`; they land
 * `partial`.
 */
export const PERIODIZATION_EVENT_DEMAND_CLAIM_IDS = {
    blockStructuredProgression: 'performance.periodization.block_structured_progression',
    eventDurationLimiterShift: 'performance.event_demand.duration_intensity_limiter_shift',
    phaseBoundariesScalesPolicy: 'policy.periodization.phase_boundaries_scales_v1',
    objectiveThresholdsPolicy: 'policy.periodization.objective_thresholds_v1',
    multiEventContributionPolicy: 'policy.periodization.multi_event_contribution_v1',
    eventDemandPresetsPolicy: 'policy.event_demand.presets_v1',
} as const;

const MOLMEN_BLOCK_PERIODIZATION_META = 'MOLMEN-2019-BLOCK-PERIODIZATION-META';
const GALAN_RIOJA_CYCLIST_PERIODIZATION_REVIEW = 'GALAN-RIOJA-2023-CYCLIST-PERIODIZATION-REVIEW';
const ALMQUIST_PERIODIZATION_RCT = 'ALMQUIST-2022-CYCLIST-PERIODIZATION-RCT';
const ISSURIN_PERIODIZATION_REVIEW = 'ISSURIN-2010-PERIODIZATION-REVIEW';
const JOYNER_COYLE_PHYSIOLOGY_REVIEW = 'JOYNER-2008-ENDURANCE-PHYSIOLOGY-REVIEW';
const SANDERS_CYCLING_POWER_PROFILE_REVIEW = 'SANDERS-2021-CYCLING-POWER-PROFILE-REVIEW';
const EBERT_ROAD_CYCLING_POWER_COHORT = 'EBERT-2006-ROAD-CYCLING-POWER-COHORT';
const SHARMA_TRIATHLON_DISTANCE_CHAPTER = 'SHARMA-2020-TRIATHLON-DISTANCE-PHYSIOLOGY-CHAPTER';
const PERIODIZATION_EVENT_DEMAND_PRODUCT_POLICY_SOURCE = 'PRODUCT-PERIODIZATION-EVENT-DEMAND-POLICY-V1';

export const PERIODIZATION_EVENT_DEMAND_SOURCES: readonly KnowledgeSource[] = [
    {
        id: MOLMEN_BLOCK_PERIODIZATION_META,
        title: 'Block periodization of endurance training – a systematic review and meta-analysis',
        sourceType: 'systematic_review',
        citation: 'Mølmen KS, Øfsteng SJ, Rønnestad BR. Open Access J Sports Med. 2019;10:145-160. doi:10.2147/OAJSM.S180408.',
        url: 'https://pubmed.ncbi.nlm.nih.gov/31802956/',
        publishedOn: '2019-10-17',
        externalIds: [{ type: 'pmid', value: '31802956' }, { type: 'doi', value: '10.2147/OAJSM.S180408' }],
        synthesisMethods: ['meta_analysis'],
        notes: 'Meta-analysis of block-periodized vs traditional endurance training in trained-to-well-trained athletes: small-to-moderate favorable pooled effects for block periodization on VO2max (SMD 0.40) and maximal aerobic power (SMD 0.28), with favorable effects on some threshold/workload outcomes. The authors explicitly caution that the evidence base is small and the included studies are generally of low methodological quality.',
    },
    {
        id: GALAN_RIOJA_CYCLIST_PERIODIZATION_REVIEW,
        title: 'Training Periodization, Intensity Distribution, and Volume in Trained Cyclists: A Systematic Review',
        sourceType: 'systematic_review',
        citation: 'Galán-Rioja MÁ, Gonzalez-Ravé JM, González-Mohíno F, Seiler S. Int J Sports Physiol Perform. 2023;18(2):112-122. doi:10.1123/ijspp.2022-0302.',
        url: 'https://pubmed.ncbi.nlm.nih.gov/36640771/',
        publishedOn: '2023-01-14',
        externalIds: [{ type: 'pmid', value: '36640771' }, { type: 'doi', value: '10.1123/ijspp.2022-0302' }],
        synthesisMethods: ['narrative_synthesis'],
        notes: 'Cyclist-specific systematic review. Seven periodization studies met inclusion criteria; both block and traditional approaches improved performance-related outcomes, and the authors concluded that no evidence currently favors a specific periodization model over 8-12 weeks in trained road cyclists. Seasonal comparative evidence remains sparse.',
    },
    {
        id: ALMQUIST_PERIODIZATION_RCT,
        title: 'No Differences Between 12 Weeks of Block- vs. Traditional-Periodized Training in Performance Adaptations in Trained Cyclists',
        sourceType: 'randomized_trial',
        citation: 'Almquist NW et al. Front Physiol. 2022;13:837634. doi:10.3389/fphys.2022.837634.',
        url: 'https://pubmed.ncbi.nlm.nih.gov/35299664/',
        publishedOn: '2022-03-01',
        externalIds: [{ type: 'pmid', value: '35299664' }, { type: 'pmcid', value: 'PMC8921659' }, { type: 'doi', value: '10.3389/fphys.2022.837634' }],
        notes: 'Load-matched parallel-group trial in trained cyclists who were pair-matched by 40-min time-trial power and sex, then randomly assigned to block or best-practice traditional periodization. Both groups improved 5- and 40-min time-trial power and related performance measures, with no between-group performance advantage after 12 weeks; some hematological and capillary adaptations differed.',
    },
    {
        id: ISSURIN_PERIODIZATION_REVIEW,
        title: 'New Horizons for the Methodology and Physiology of Training Periodization',
        sourceType: 'expert_practice',
        citation: 'Issurin VB. Sports Med. 2010;40(3):189-206. doi:10.2165/11319770-000000000-00000.',
        url: 'https://pubmed.ncbi.nlm.nih.gov/20199119/',
        publishedOn: '2010-03-01',
        externalIds: [{ type: 'pmid', value: '20199119' }, { type: 'doi', value: '10.2165/11319770-000000000-00000' }],
        notes: 'Influential theoretical/narrative review articulating concentrated, sequential development of few target abilities per block as an alternative to traditional simultaneous multi-ability periodization. A conceptual framework paper, not itself a systematic review or effect-size synthesis.',
    },
    {
        id: JOYNER_COYLE_PHYSIOLOGY_REVIEW,
        title: 'Endurance exercise performance: the physiology of champions',
        sourceType: 'expert_practice',
        citation: 'Joyner MJ, Coyle EF. J Physiol. 2008;586(Pt 1):35-44. doi:10.1113/jphysiol.2007.143834.',
        url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC2375555/',
        publishedOn: '2008-01-01',
        externalIds: [{ type: 'pmid', value: '17901124' }, { type: 'pmcid', value: 'PMC2375555' }, { type: 'doi', value: '10.1113/jphysiol.2007.143834' }],
        notes: 'Foundational, widely-cited narrative review establishing VO2max, lactate threshold and movement economy as primary interacting determinants of endurance performance, with substrate availability and fatigue becoming progressively important as event duration increases.',
    },
    {
        id: SANDERS_CYCLING_POWER_PROFILE_REVIEW,
        title: "The Physical Demands and Power Profile of Professional Men's Cycling Races: An Updated Review",
        sourceType: 'expert_practice',
        citation: 'Sanders D, van Erp T. Int J Sports Physiol Perform. 2021;16(1):3-12. doi:10.1123/IJSPP.2020-0508.',
        url: 'https://pubmed.ncbi.nlm.nih.gov/33271501/',
        publishedOn: '2021-01-01',
        externalIds: [{ type: 'pmid', value: '33271501' }, { type: 'doi', value: '10.1123/IJSPP.2020-0508' }],
        notes: 'Review of professional road-racing field data showing that stage type materially changes intensity, load and power profile. More-elevated stages show more longer-duration power, whereas flat and semimountainous stages show higher maximal mean power over shorter durations; single-day races also tend to carry higher daily intensity/load than multiday stages. It does not validate this product\'s normalized 0-1 demand scale.',
    },
    {
        id: EBERT_ROAD_CYCLING_POWER_COHORT,
        title: "Power output during a professional men's road-cycling tour",
        sourceType: 'cohort',
        citation: 'Ebert TR, Martin DT, Stephens B, Withers RT. Int J Sports Physiol Perform. 2006;1(4):324-335. doi:10.1123/ijspp.1.4.324.',
        url: 'https://pubmed.ncbi.nlm.nih.gov/19124890/',
        publishedOn: '2006-12-01',
        externalIds: [{ type: 'pmid', value: '19124890' }, { type: 'doi', value: '10.1123/ijspp.1.4.324' }],
        notes: 'Direct field-power data from 207 races over six competition years in 31 national-level male road cyclists. Criteriums had the highest mean power, variability and time above 7.5 W/kg, with about 70 sprints above maximal aerobic power versus about 40 in hilly and 20 in flat races; most surges lasted 6-10 s. Supports event-format-specific high-power demand without validating any authored preset scalar.',
    },
    {
        id: SHARMA_TRIATHLON_DISTANCE_CHAPTER,
        title: 'Physiological Requirements of the Different Distances of Triathlon',
        sourceType: 'expert_practice',
        citation: 'Sharma AP, Périard JD. In: Migliorini S, ed. Triathlon Medicine. Springer; 2020:5-17. doi:10.1007/978-3-030-22357-1_2.',
        url: 'https://doi.org/10.1007/978-3-030-22357-1_2',
        publishedOn: '2020-01-01',
        externalIds: [{ type: 'doi', value: '10.1007/978-3-030-22357-1_2' }],
        notes: 'Book chapter summarizing how triathlon distance (sprint through Ironman) and drafting rules shift dominant physiological demand from near-threshold/VO2max-adjacent effort toward prolonged submaximal aerobic output constrained increasingly by fuel availability, thermoregulation and musculoskeletal durability.',
    },
    {
        id: PERIODIZATION_EVENT_DEMAND_PRODUCT_POLICY_SOURCE,
        title: 'Adaptive Training Recommender periodization & event-demand calibration policy v1',
        sourceType: 'product_policy',
        citation: 'Adaptive Training Recommender product policy, reviewed 2026-09-02.',
        publishedOn: '2026-09-02',
        notes: 'Registers the exact phase day-boundaries, demand-blend weights and volume/intensity scales, the normalized objective-inclusion thresholds, the multi-event contribution/merge rules, and the 19 authored event-preset demand vectors as product calibration, distinct from the scientific boundaries above.',
    },
];

export const PERIODIZATION_EVENT_DEMAND_CLAIMS: readonly KnowledgeClaim[] = [
    {
        id: PERIODIZATION_EVENT_DEMAND_CLAIM_IDS.blockStructuredProgression,
        statement: 'Concentrated block periodization is a viable way to organize selected endurance-training qualities and has produced favorable adaptations in some trained-athlete studies, but cyclist-specific 8-12-week evidence does not establish consistent superiority over a progressively loaded traditional organization. It should therefore be treated as one workable periodization model rather than a uniquely optimal sequence.',
        claimType: 'intervention', maturity: 'emerging', status: 'active', evidenceCertainty: 'low', recommendationStrength: 'conditional', safetyImpact: 'low',
        applicability: { contexts: ['training_periodization', 'macrocycle_planning'], sports: ['cycling', 'running', 'endurance_multisport'], populations: ['trained_to_well_trained_endurance_athletes'], outcomes: ['vo2max', 'maximal_aerobic_power', 'endurance_performance'], horizon: 'chronic' },
        evidence: [
            { sourceId: MOLMEN_BLOCK_PERIODIZATION_META, directness: 'direct', note: 'Older pooled evidence favors block periodization on selected outcomes, but the authors flag small, generally low-quality studies.' },
            { sourceId: GALAN_RIOJA_CYCLIST_PERIODIZATION_REVIEW, directness: 'direct', note: 'Cyclist-specific systematic review found no evidence favoring one periodization model over 8-12 weeks.' },
            { sourceId: ALMQUIST_PERIODIZATION_RCT, directness: 'direct', note: 'Load-matched 12-week cyclist trial found similar performance adaptation with block and best-practice traditional periodization.' },
            { sourceId: ISSURIN_PERIODIZATION_REVIEW, directness: 'partially_direct', note: 'States the conceptual block-periodization framework; not itself an effect-size synthesis.' },
        ],
        limitations: [
            'The positive pooled block-periodization signal comes from a small, generally low-methodological-quality evidence base, while newer cyclist-specific evidence reports no clear 8-12-week model advantage; this supports optionality rather than superiority.',
            'Does not validate this product\'s exact Specificity/Build/Base day boundaries (35/84 days), demand-blend weights (0.6/0.3) or volume/intensity scale values (1.1/0.9, 1.0/0.8, 1.0/1.1) -- those are separately registered as product calibration.',
            'Comparative evidence is short relative to a full season and sparse in highly individualized elite settings; no cited study identifies a universally optimal sequence for every athlete or event.',
        ],
        reviewedOn: '2026-09-02', version: 2,
    },
    {
        id: PERIODIZATION_EVENT_DEMAND_CLAIM_IDS.eventDurationLimiterShift,
        statement: 'The physiological factors that limit endurance performance shift with event duration and competition morphology: shorter and more stochastic events place greater weight on maximal aerobic and short-duration high-power capacity, while longer events progressively elevate the importance of sustainable fraction, economy, substrate availability and fatigue resistance. In road cycling specifically, criterium, flat, hilly and high-elevation race formats show materially different power-duration and surge profiles.',
        claimType: 'descriptive', maturity: 'established', status: 'active', evidenceCertainty: 'moderate', recommendationStrength: 'conditional', safetyImpact: 'low',
        applicability: { contexts: ['event_demand_characterization', 'training_periodization'], sports: ['cycling', 'running', 'endurance_multisport'], populations: ['trained_endurance_athletes'], outcomes: ['performance_limiting_factors', 'training_specificity'], horizon: 'acute' },
        evidence: [
            { sourceId: JOYNER_COYLE_PHYSIOLOGY_REVIEW, directness: 'direct' },
            { sourceId: SANDERS_CYCLING_POWER_PROFILE_REVIEW, directness: 'direct', note: 'Cycling-specific synthesis linking stage/race morphology to power-duration, intensity and load profiles.' },
            { sourceId: EBERT_ROAD_CYCLING_POWER_COHORT, directness: 'direct', note: 'Direct field-power comparison of criterium, flat and hilly races, including repeated supra-maximal-aerobic-power surges.' },
            { sourceId: SHARMA_TRIATHLON_DISTANCE_CHAPTER, directness: 'partially_direct', note: 'Triathlon-specific distance-dependent limiter shift.' },
        ],
        limitations: [
            'Does not validate the exact 0-1 numeric value chosen for any axis of any of the 19 authored event presets in EVENT_PRESETS -- those are product calibration informed by, not derived from, this literature.',
            'The scientific sources support broad duration/morphology differences, not the exact mapping between every named product preset; for example, the quoted cycling time-trial vector remains product-authored calibration rather than a study-derived profile.',
            'No cited source covers strength_meet or general_target categories; those two preset groups have no direct endurance-performance-limiter literature behind them.',
            'Cycling morphology evidence is largely observational field data and review synthesis rather than randomized manipulation of race format; it supports characterization, not a causal training-effect estimate.',
        ],
        reviewedOn: '2026-09-02', version: 2,
    },
    {
        id: PERIODIZATION_EVENT_DEMAND_CLAIM_IDS.phaseBoundariesScalesPolicy,
        statement: "Product periodization v1: Specificity begins at <=35 days to a governing event, Build at <=84 days, and farther out is Base. Build blends the event's demand vector with the default base-demand vector at weight 0.6 and uses volume/intensity scale 1.1/0.9; Base blends at weight 0.3 with scale 1.0/0.8; Specificity uses the event's own demand at scale 1.0/1.1.",
        claimType: 'heuristic', maturity: 'heuristic', status: 'active', evidenceCertainty: 'not_applicable', recommendationStrength: 'conditional', safetyImpact: 'moderate',
        applicability: { contexts: ['training_periodization', 'macrocycle_planning'], sports: ['all_supported_sports'], populations: ['app_users_with_target_events'], outcomes: ['planner_phase_state'], horizon: 'chronic' },
        evidence: [{ sourceId: PERIODIZATION_EVENT_DEMAND_PRODUCT_POLICY_SOURCE, directness: 'direct' }],
        limitations: ['Periodization evidence supports structured organization and event-specific progression as viable coaching strategies, but does not establish one universally superior model or validate these specific day boundaries, blend weights or volume/intensity scalars as calibrated quantities.'],
        reviewedOn: '2026-09-02', version: 2,
    },
    {
        id: PERIODIZATION_EVENT_DEMAND_CLAIM_IDS.objectiveThresholdsPolicy,
        statement: "Product periodization v1: on the app's normalized 0-1 demand scale, a weekly aerobic objective appears at aerobicEndurance>=0.4 (a second exposure at >=0.7), a threshold objective at thresholdPower>=0.5 outside taper, a surge/VO2 objective at vo2MaxPower>=0.6 or repeatedSurges>=0.6, cycling race-specific objectives at fatigueResistance>=0.7 or repeatedSurges>=0.6, and qualification floors commonly use 0.6.",
        claimType: 'heuristic', maturity: 'heuristic', status: 'active', evidenceCertainty: 'not_applicable', recommendationStrength: 'conditional', safetyImpact: 'moderate',
        applicability: { contexts: ['training_periodization', 'weekly_objective_generation'], sports: ['all_supported_sports'], populations: ['app_users_with_target_events'], outcomes: ['weekly_objective_inclusion'], horizon: 'chronic' },
        evidence: [{ sourceId: PERIODIZATION_EVENT_DEMAND_PRODUCT_POLICY_SOURCE, directness: 'direct' }],
        limitations: ['The normalized demand scale and every inclusion threshold on it are internal product semantics; no sports-science literature defines this 0-1 scale or validates these specific cut points.'],
        reviewedOn: '2026-09-02', version: 1,
    },
    {
        id: PERIODIZATION_EVENT_DEMAND_CLAIM_IDS.multiEventContributionPolicy,
        statement: 'Product periodization v1: a secondary scheduled event contributes objectives to the plan when within 35 days; a contributor resolves its own taper through the single canonical taper-policy authority (athlete-authored start override first, cycling-A race-week alignment next, otherwise the legacy A/B day defaults) rather than through a duplicated day-window table; a contributor objective inadmissible during the governing event\'s own taper is dropped rather than merged; same-key objectives from different contributors merge by taking the larger required-credit amount and unioning compatible modality qualifiers, never blending or summing magnitudes.',
        claimType: 'heuristic', maturity: 'heuristic', status: 'active', evidenceCertainty: 'not_applicable', recommendationStrength: 'conditional', safetyImpact: 'moderate',
        applicability: { contexts: ['training_periodization', 'multi_event_planning'], sports: ['all_supported_sports'], populations: ['app_users_with_multiple_target_events'], outcomes: ['weekly_objective_merge_resolution'], horizon: 'chronic' },
        evidence: [{ sourceId: PERIODIZATION_EVENT_DEMAND_PRODUCT_POLICY_SOURCE, directness: 'direct' }],
        limitations: ['This is deterministic conflict-resolution scheduling logic for concurrent training goals, not a physiological claim -- no sports-science literature addresses how a training-planning system should reconcile multiple simultaneous target events, so no scientific claim is attached to it.'],
        reviewedOn: '2026-09-02', version: 1,
    },
    {
        id: PERIODIZATION_EVENT_DEMAND_CLAIM_IDS.eventDemandPresetsPolicy,
        statement: 'Product event-demand v1: each of the 19 authored event presets across cycling, running, triathlon and strength maps to a specific 7-axis (aerobicEndurance/thresholdPower/vo2MaxPower/repeatedSurges/sprintPower/fatigueResistance/neuromuscular) 0-1 demand vector -- e.g. cycling time trial emphasizes thresholdPower (0.95) with minimal repeatedSurges/sprintPower (0.1 each), while criterium emphasizes vo2MaxPower/repeatedSurges/sprintPower (0.85/0.9/0.7) with lower aerobicEndurance (0.5).',
        claimType: 'heuristic', maturity: 'heuristic', status: 'active', evidenceCertainty: 'not_applicable', recommendationStrength: 'conditional', safetyImpact: 'low',
        applicability: { contexts: ['event_demand_characterization', 'training_periodization'], sports: ['cycling', 'running', 'endurance_multisport', 'strength'], populations: ['app_users_with_target_events'], outcomes: ['event_demand_vector'], horizon: 'chronic' },
        evidence: [{ sourceId: PERIODIZATION_EVENT_DEMAND_PRODUCT_POLICY_SOURCE, directness: 'direct' }],
        limitations: ['The exact numeric value on every axis of all 19 presets is product calibration informed by, but not derived from, the cited physiological-demand literature; no study measures training demand on this specific normalized scale, and the two strength_meet presets and the general_target preset have no directly cited endurance-performance-limiter literature behind them at all.'],
        reviewedOn: '2026-09-02', version: 1,
    },
];