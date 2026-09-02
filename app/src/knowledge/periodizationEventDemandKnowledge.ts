import type { KnowledgeClaim, KnowledgeSource } from './sportsKnowledge';

/**
 * SKR3 Evidence Pack 6 (W1): periodization phase structure and sport/event demand profiling.
 *
 * Two scientific boundaries, four product-policy calibration records. Per the SKR3 method the
 * atomic claims below were drafted from the exact current product rule (see
 * `docs/plans/2026-09-02-skr3-completion-plan.md` §W1) before evidence was searched. The
 * evidence found supports the general strategies (progressive phase-based specificity;
 * event-duration/format-dependent physiological demand) without validating any exact scalar
 * this codebase uses -- day boundaries, blend weights, volume/intensity scales, normalized
 * inclusion thresholds, contribution windows, or the 22 authored event-preset demand vectors.
 * None of those families reach `covered`; they land `partial`.
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
const ISSURIN_PERIODIZATION_REVIEW = 'ISSURIN-2010-PERIODIZATION-REVIEW';
const JOYNER_COYLE_PHYSIOLOGY_REVIEW = 'JOYNER-2008-ENDURANCE-PHYSIOLOGY-REVIEW';
const SANDERS_CYCLING_POWER_PROFILE_REVIEW = 'SANDERS-2021-CYCLING-POWER-PROFILE-REVIEW';
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
        notes: 'First meta-analysis of block-periodized vs traditional endurance training in trained-to-well-trained athletes: small-to-moderate favorable effects for block periodization on VO2max (SMD 0.40) and maximal aerobic power (SMD 0.28), with moderate-to-large effects on some threshold/workload outcomes. The authors explicitly caution the 20 included studies are few and generally of low methodological quality.',
    },
    {
        id: ISSURIN_PERIODIZATION_REVIEW,
        title: 'New Horizons for the Methodology and Physiology of Training Periodization',
        sourceType: 'expert_practice',
        citation: 'Issurin VB. Sports Med. 2010;40(3):189-206. doi:10.2165/11319770-000000000-00000.',
        url: 'https://pubmed.ncbi.nlm.nih.gov/20199119/',
        publishedOn: '2010-03-01',
        externalIds: [{ type: 'pmid', value: '20199119' }, { type: 'doi', value: '10.2165/11319770-000000000-00000' }],
        notes: 'Influential theoretical/narrative review articulating concentrated, sequential development of few target abilities per block as an alternative to traditional simultaneous multi-ability periodization. A conceptual framework paper, not itself a systematic review or effect-size synthesis -- its role here is to state the general strategy the block-periodization meta-analysis then tests.',
    },
    {
        id: JOYNER_COYLE_PHYSIOLOGY_REVIEW,
        title: 'Endurance exercise performance: the physiology of champions',
        sourceType: 'expert_practice',
        citation: 'Joyner MJ, Coyle EF. J Physiol. 2008;586(Pt 1):35-44. doi:10.1113/jphysiol.2007.143834.',
        url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC2375555/',
        publishedOn: '2008-01-01',
        externalIds: [{ type: 'pmid', value: '17901124' }, { type: 'pmcid', value: 'PMC2375555' }, { type: 'doi', value: '10.1113/jphysiol.2007.143834' }],
        notes: 'Foundational, widely-cited narrative review establishing VO2max, lactate threshold and movement economy as the primary determinants of endurance performance, and that their relative importance shifts with event duration: VO2max/anaerobic power dominate short high-intensity efforts (e.g. 5-10km running), while lactate threshold, economy and fuel availability increasingly dominate as duration grows beyond roughly 10 miles/90 minutes.',
    },
    {
        id: SANDERS_CYCLING_POWER_PROFILE_REVIEW,
        title: "The Physical Demands and Power Profile of Professional Men's Cycling Races: An Updated Review",
        sourceType: 'expert_practice',
        citation: 'Sanders D, van Erp T. Int J Sports Physiol Perform. 2021;16(1):3-12. doi:10.1123/IJSPP.2020-0508.',
        url: 'https://pubmed.ncbi.nlm.nih.gov/33271501/',
        publishedOn: '2021-01-01',
        externalIds: [{ type: 'pmid', value: '33271501' }, { type: 'doi', value: '10.1123/IJSPP.2020-0508' }],
        notes: 'Narrative review of field power-output data across professional cycling race formats. Supports that racing format materially changes physiological demand -- sustained near-threshold effort in non-drafting time trials versus highly variable, repeated supra-threshold surges in mass-start/criterium racing -- without proposing or validating any normalized 0-1 demand scale.',
    },
    {
        id: SHARMA_TRIATHLON_DISTANCE_CHAPTER,
        title: 'Physiological Requirements of the Different Distances of Triathlon',
        sourceType: 'expert_practice',
        citation: 'Sharma AP, Périard JD. In: Migliorini S, ed. Triathlon Medicine. Springer; 2020:5-17. doi:10.1007/978-3-030-22357-1_2.',
        url: 'https://doi.org/10.1007/978-3-030-22357-1_2',
        publishedOn: '2020-01-01',
        externalIds: [{ type: 'doi', value: '10.1007/978-3-030-22357-1_2' }],
        notes: 'Book chapter summarizing how triathlon distance (sprint through Ironman) and drafting rules shift the dominant physiological demand and limiter from near-threshold/VO2max-adjacent effort toward prolonged submaximal aerobic output constrained by fuel availability, thermoregulation and musculoskeletal durability.',
    },
    {
        id: PERIODIZATION_EVENT_DEMAND_PRODUCT_POLICY_SOURCE,
        title: 'Adaptive Training Recommender periodization & event-demand calibration policy v1',
        sourceType: 'product_policy',
        citation: 'Adaptive Training Recommender product policy, reviewed 2026-09-02.',
        publishedOn: '2026-09-02',
        notes: 'Registers the exact phase day-boundaries, demand-blend weights and volume/intensity scales, the normalized objective-inclusion thresholds, the multi-event contribution/merge windows, and the 22 authored event-preset demand vectors as product calibration, distinct from the scientific boundaries above.',
    },
];

export const PERIODIZATION_EVENT_DEMAND_CLAIMS: readonly KnowledgeClaim[] = [
    {
        id: PERIODIZATION_EVENT_DEMAND_CLAIM_IDS.blockStructuredProgression,
        statement: 'Progressively concentrating training toward fewer, more event-specific target abilities across sequential training blocks (block periodization) can produce small-to-moderate superior improvements in VO2max, maximal aerobic power and endurance performance/threshold workload compared with traditional periodization that develops abilities simultaneously, in trained-to-well-trained endurance athletes -- though the supporting evidence base is small and of generally low methodological quality.',
        claimType: 'intervention', maturity: 'emerging', status: 'active', evidenceCertainty: 'low', recommendationStrength: 'conditional', safetyImpact: 'low',
        applicability: { contexts: ['training_periodization', 'macrocycle_planning'], sports: ['cycling', 'running', 'endurance_multisport'], populations: ['trained_to_well_trained_endurance_athletes'], outcomes: ['vo2max', 'maximal_aerobic_power', 'endurance_performance'], horizon: 'chronic' },
        evidence: [
            { sourceId: MOLMEN_BLOCK_PERIODIZATION_META, directness: 'direct' },
            { sourceId: ISSURIN_PERIODIZATION_REVIEW, directness: 'partially_direct', note: 'States the conceptual strategy the meta-analysis tests; not itself an effect-size synthesis.' },
        ],
        limitations: [
            'The meta-analysis pool is 20 studies the authors themselves describe as few and generally low methodological quality; treat the effect sizes as suggestive, not settled.',
            'Does not validate this product\'s exact Specificity/Build/Base day boundaries (35/84 days), demand-blend weights (0.6/0.3) or volume/intensity scale values (1.1/0.9, 1.0/0.8, 1.0/1.1) -- those are separately registered as product calibration.',
            'Studied populations are trained-to-well-trained endurance athletes; generalization to novice athletes, strength-meet preparation or general-target planning is not established.',
        ],
        reviewedOn: '2026-09-02', version: 1,
    },
    {
        id: PERIODIZATION_EVENT_DEMAND_CLAIM_IDS.eventDurationLimiterShift,
        statement: 'The physiological factors that limit endurance performance shift systematically with event duration and format: shorter, higher-intensity events are constrained more by maximal oxygen uptake and anaerobic/neuromuscular power, while longer events are increasingly constrained by lactate threshold, movement economy, fuel availability and durability. Within a discipline, format also matters independent of duration: variable-intensity, tactical/drafting formats (e.g. criterium, mass-start racing) impose materially different demand than sustained, fixed-pace formats (e.g. time trial).',
        claimType: 'descriptive', maturity: 'established', status: 'active', evidenceCertainty: 'moderate', recommendationStrength: 'conditional', safetyImpact: 'low',
        applicability: { contexts: ['event_demand_characterization', 'training_periodization'], sports: ['cycling', 'running', 'endurance_multisport'], populations: ['trained_endurance_athletes'], outcomes: ['performance_limiting_factors', 'training_specificity'], horizon: 'acute' },
        evidence: [
            { sourceId: JOYNER_COYLE_PHYSIOLOGY_REVIEW, directness: 'direct' },
            { sourceId: SANDERS_CYCLING_POWER_PROFILE_REVIEW, directness: 'partially_direct', note: 'Cycling-specific field power-output evidence for the format (not just duration) dimension.' },
            { sourceId: SHARMA_TRIATHLON_DISTANCE_CHAPTER, directness: 'partially_direct', note: 'Triathlon-specific distance-dependent limiter shift.' },
        ],
        limitations: [
            'Does not validate the exact 0-1 numeric value chosen for any axis of any of the 22 authored event presets in EVENT_PRESETS -- those are product calibration informed by, not derived from, this literature.',
            'No cited source covers strength_meet or general_target categories; those two preset groups have no direct endurance-performance-limiter literature behind them.',
            'The cycling and triathlon sources are narrative reviews of field/observational data, not randomized comparisons -- directionally consistent evidence, not a controlled effect estimate.',
        ],
        reviewedOn: '2026-09-02', version: 1,
    },
    {
        id: PERIODIZATION_EVENT_DEMAND_CLAIM_IDS.phaseBoundariesScalesPolicy,
        statement: "Product periodization v1: Specificity begins at <=35 days to a governing event, Build at <=84 days, and farther out is Base. Build blends the event's demand vector with the default base-demand vector at weight 0.6 and uses volume/intensity scale 1.1/0.9; Base blends at weight 0.3 with scale 1.0/0.8; Specificity uses the event's own demand at scale 1.0/1.1.",
        claimType: 'heuristic', maturity: 'heuristic', status: 'active', evidenceCertainty: 'not_applicable', recommendationStrength: 'conditional', safetyImpact: 'moderate',
        applicability: { contexts: ['training_periodization', 'macrocycle_planning'], sports: ['all_supported_sports'], populations: ['app_users_with_target_events'], outcomes: ['planner_phase_state'], horizon: 'chronic' },
        evidence: [{ sourceId: PERIODIZATION_EVENT_DEMAND_PRODUCT_POLICY_SOURCE, directness: 'direct' }],
        limitations: ['Block-periodization evidence supports progressive, event-specific concentration as a strategy; it does not validate these specific day boundaries, blend weights or volume/intensity scalars as calibrated quantities.'],
        reviewedOn: '2026-09-02', version: 1,
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
