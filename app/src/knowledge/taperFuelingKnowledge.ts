import type { KnowledgeClaim, KnowledgeSource } from './sportsKnowledge';

export const TAPER_FUELING_CLAIM_IDS = {
    endurancePreEventTaper: 'performance.taper.endurance.pre_event_volume_reduction',
    carbohydrateDuringExercise: 'nutrition.endurance.carbohydrate_during_exercise.performance',
    carbohydrateEventScaledDose: 'nutrition.endurance.carbohydrate_during_exercise.event_scaled_dose',
    hydrationAvoidOverdrinking: 'nutrition.endurance.hydration.avoid_overdrinking',
    taperWindowsVolumePolicy: 'policy.taper.windows_volume_v1',
    preEventRestrictionsPolicy: 'policy.taper.pre_event_restrictions_v1',
    taperSharpeningPolicy: 'policy.taper.sharpening_targets_v1',
} as const;

const WANG_TAPER_SOURCE = 'WANG-2023-ENDURANCE-TAPER-META';
const BOSQUET_TAPER_SOURCE = 'BOSQUET-2007-TAPER-META';
const THOMAS_NUTRITION_SOURCE = 'THOMAS-2016-NUTRITION-POSITION';
const BURKE_CARBOHYDRATE_SOURCE = 'BURKE-2011-CARBOHYDRATE-PRACTICE';
const RAMOS_CAMPO_CARBOHYDRATE_SOURCE = 'RAMOS-CAMPO-2024-CARBOHYDRATE-META';
const MORTON_CARBOHYDRATE_SOURCE = 'MORTON-2026-ENDURANCE-CARBOHYDRATE-REVIEW';
const PLEWS_ULTRA_HIGH_CARBOHYDRATE_SOURCE = 'PLEWS-2026-ULTRA-HIGH-CARBOHYDRATE-OPINION';
const HEW_BUTLER_HYPONATREMIA_SOURCE = 'HEW-BUTLER-2015-HYPONATREMIA-CONSENSUS';
const TAPER_PRODUCT_POLICY_SOURCE = 'PRODUCT-TAPER-POLICY-V1';

export const TAPER_FUELING_SOURCES: readonly KnowledgeSource[] = [
    {
        id: WANG_TAPER_SOURCE,
        title: 'Effects of tapering on performance in endurance athletes: A systematic review and meta-analysis',
        sourceType: 'systematic_review',
        citation: 'Wang Z, Wang YT, Gao W, Zhong Y. PLoS One. 2023;18(5):e0282838. doi:10.1371/journal.pone.0282838.',
        url: 'https://pubmed.ncbi.nlm.nih.gov/37163550/',
        publishedOn: '2023-05-10',
        externalIds: [
            { type: 'pmid', value: '37163550' },
            { type: 'pmcid', value: 'PMC10171681' },
            { type: 'doi', value: '10.1371/journal.pone.0282838' },
        ],
        synthesisMethods: ['meta_analysis'],
        notes: 'Fourteen studies. Endurance performance improved with taper strategies that reduced volume while maintaining intensity/frequency; subgroup results supported roughly 41-60% volume reduction and tapers up to 21 days, but did not establish one event- or athlete-independent taper schedule.',
    },
    {
        id: BOSQUET_TAPER_SOURCE,
        title: 'Effects of tapering on performance: a meta-analysis',
        sourceType: 'systematic_review',
        citation: 'Bosquet L, Montpetit J, Arvisais D, Mujika I. Med Sci Sports Exerc. 2007;39(8):1358-1365. doi:10.1249/mss.0b013e31806010e0.',
        url: 'https://pubmed.ncbi.nlm.nih.gov/17762369/',
        publishedOn: '2007-08-01',
        externalIds: [
            { type: 'pmid', value: '17762369' },
            { type: 'doi', value: '10.1249/mss.0b013e31806010e0' },
        ],
        synthesisMethods: ['meta_analysis'],
        notes: 'Classic meta-analysis of 27 studies identified an approximately two-week taper with 41-60% volume reduction and maintained intensity/frequency as an effective average strategy. It should be interpreted as population-level guidance, not an exact per-event rule.',
    },
    {
        id: THOMAS_NUTRITION_SOURCE,
        title: 'Position of the Academy of Nutrition and Dietetics, Dietitians of Canada, and the American College of Sports Medicine: Nutrition and Athletic Performance',
        sourceType: 'guideline',
        citation: 'Thomas DT, Erdman KA, Burke LM. J Acad Nutr Diet. 2016;116(3):501-528. doi:10.1016/j.jand.2015.12.006.',
        url: 'https://pubmed.ncbi.nlm.nih.gov/26920240/',
        publishedOn: '2016-03-01',
        externalIds: [
            { type: 'pmid', value: '26920240' },
            { type: 'doi', value: '10.1016/j.jand.2015.12.006' },
        ],
        notes: 'Joint sports-nutrition position statement supporting individualized type, amount and timing of food/fluid intake for training, competition and recovery. It provides context for event-specific fueling rather than one universal prescription.',
    },
    {
        id: BURKE_CARBOHYDRATE_SOURCE,
        title: 'Carbohydrates for training and competition',
        sourceType: 'narrative_review',
        citation: 'Burke LM, Hawley JA, Wong SH, Jeukendrup AE. J Sports Sci. 2011;29 Suppl 1:S17-S27. doi:10.1080/02640414.2011.585473.',
        url: 'https://pubmed.ncbi.nlm.nih.gov/21660838/',
        publishedOn: '2011-06-09',
        externalIds: [
            { type: 'pmid', value: '21660838' },
            { type: 'doi', value: '10.1080/02640414.2011.585473' },
        ],
        notes: 'Widely used event-scaled carbohydrate framework: small amounts can help around one hour, 30-60 g/h is appropriate for longer events, and events >2.5 h may benefit from intakes up to about 90 g/h using multiple transportable carbohydrates. Individual tolerance and event demands matter.',
    },
    {
        id: RAMOS_CAMPO_CARBOHYDRATE_SOURCE,
        title: 'The ergogenic effects of acute carbohydrate feeding on endurance performance: a systematic review, meta-analysis and meta-regression',
        sourceType: 'systematic_review',
        citation: 'Ramos-Campo DJ, et al. Crit Rev Food Sci Nutr. 2024;64(30):11196-11205. doi:10.1080/10408398.2023.2233633.',
        url: 'https://pubmed.ncbi.nlm.nih.gov/37449467/',
        publishedOn: '2023-07-14',
        externalIds: [
            { type: 'pmid', value: '37449467' },
            { type: 'doi', value: '10.1080/10408398.2023.2233633' },
        ],
        synthesisMethods: ['meta_analysis'],
        notes: 'Meta-analysis of 136 studies found carbohydrate ingestion during endurance exercise improved performance versus placebo/control, with larger benefit as event duration increased. This supports the ergogenic direction, not one universal gram-per-hour target.',
    },
    {
        id: MORTON_CARBOHYDRATE_SOURCE,
        title: 'From Metabolism to Medals: Contemporary Perspectives and Revisiting Carbohydrate Guidelines for Fueling Endurance Athletes during Exercise',
        sourceType: 'narrative_review',
        citation: 'Morton JP, Fell JM, Gonzalez JT, Hearris MA, Podlogar T, Pugh JN, Wallis GA. J Nutr. 2026;156(5):101442. doi:10.1016/j.tjnut.2026.101442.',
        url: 'https://pubmed.ncbi.nlm.nih.gov/41759826/',
        publishedOn: '2026-02-25',
        externalIds: [
            { type: 'pmid', value: '41759826' },
            { type: 'pmcid', value: 'PMC13197957' },
            { type: 'doi', value: '10.1016/j.tjnut.2026.101442' },
        ],
        notes: 'Contemporary narrative review supports the established <=90 g/h framework for prolonged endurance exercise while noting that 120 g/h can raise exogenous/whole-body carbohydrate oxidation in trained athletes. It explicitly states that performance efficacy above 90 g/h is not yet substantiated well enough to make very-high intake a general recommendation.',
    },
    {
        id: PLEWS_ULTRA_HIGH_CARBOHYDRATE_SOURCE,
        title: 'Fuelled or Fooled? Examining the Evidence and Mechanisms Behind Ultra-High Carbohydrate Intake in Endurance Athletes',
        sourceType: 'narrative_review',
        citation: 'Plews DJ, Booth PD, Krieger T, Maunder E. Sports Med. 2026. doi:10.1007/s40279-026-02462-z.',
        url: 'https://pubmed.ncbi.nlm.nih.gov/42258036/',
        publishedOn: '2026-06-08',
        externalIds: [
            { type: 'pmid', value: '42258036' },
            { type: 'doi', value: '10.1007/s40279-026-02462-z' },
        ],
        notes: 'Current-opinion review focused on ultra-high carbohydrate intake (>90 g/h). It finds limited direct performance evidence, diminishing returns beyond roughly 60-90 g/h in most studied settings, and concludes that broad ultra-high-carbohydrate recommendations are premature, particularly for amateur and recreational athletes. It is supporting context rather than primary efficacy evidence.',
    },
    {
        id: HEW_BUTLER_HYPONATREMIA_SOURCE,
        title: 'Statement of the Third International Exercise-Associated Hyponatremia Consensus Development Conference, Carlsbad, California, 2015',
        sourceType: 'consensus',
        citation: 'Hew-Butler T, et al. Clin J Sport Med. 2015;25(4):303-320. doi:10.1097/JSM.0000000000000221.',
        url: 'https://pubmed.ncbi.nlm.nih.gov/26102445/',
        publishedOn: '2015-07-01',
        externalIds: [
            { type: 'pmid', value: '26102445' },
            { type: 'doi', value: '10.1097/JSM.0000000000000221' },
        ],
        notes: 'Consensus emphasizes excessive fluid intake as the principal behavioral driver of exercise-associated hyponatremia and supports avoiding overdrinking rather than prescribing one universal fluid-replacement number.',
    },
    {
        id: TAPER_PRODUCT_POLICY_SOURCE,
        title: 'Adaptive Training Recommender taper calibration policy v1',
        sourceType: 'product_policy',
        citation: 'Adaptive Training Recommender product policy, reviewed 2026-08-30.',
        publishedOn: '2026-08-30',
        notes: 'Registers exact taper windows, volume curve, pre-event blocking windows and sharpening target values as product calibration. These values remain distinct from the scientific taper principle.',
    },
];

export const TAPER_FUELING_CLAIMS: readonly KnowledgeClaim[] = [
    {
        id: TAPER_FUELING_CLAIM_IDS.endurancePreEventTaper,
        statement: 'A pre-event taper can improve endurance performance by substantially reducing training volume while preserving meaningful training intensity and generally maintaining frequency; population-level syntheses commonly support roughly 41-60% volume reduction over a taper of up to about 21 days, with an approximately two-week taper often effective, but optimal duration and shape remain athlete- and event-dependent.',
        claimType: 'intervention', maturity: 'established', status: 'active', evidenceCertainty: 'moderate', recommendationStrength: 'conditional', safetyImpact: 'moderate',
        applicability: { contexts: ['pre_event_taper', 'endurance_competition'], sports: ['cycling', 'running', 'endurance_multisport'], populations: ['trained_endurance_athletes'], outcomes: ['competition_performance', 'fatigue_reduction', 'fitness_preservation'], horizon: 'acute' },
        evidence: [
            { sourceId: WANG_TAPER_SOURCE, directness: 'direct' },
            { sourceId: BOSQUET_TAPER_SOURCE, directness: 'direct' },
        ],
        limitations: [
            'The evidence supports a population-level taper strategy, not the product rule that every A event starts 14 days out or every B event five days out.',
            'The current cycling-A race-week-Monday rule and three-day minimum are product scheduling choices rather than directly validated scientific boundaries.',
            'Maintaining intensity means preserving some quality stimulus while volume falls; it does not validate the product internal intensityScale of exactly 1.0 or every sharpening target value.',
            'This claim addresses pre-event tapering only and does not justify the product three-day post-event recovery period at volume/intensity 0.4.',
        ], reviewedOn: '2026-08-30', version: 1,
    },
    {
        id: TAPER_FUELING_CLAIM_IDS.carbohydrateDuringExercise,
        statement: 'Carbohydrate ingestion during endurance exercise can improve performance compared with placebo or no carbohydrate, with the average ergogenic benefit becoming more relevant as exercise duration increases.',
        claimType: 'intervention', maturity: 'established', status: 'active', evidenceCertainty: 'high', recommendationStrength: 'strong', safetyImpact: 'low',
        applicability: { contexts: ['endurance_training', 'endurance_competition'], sports: ['cycling', 'running', 'endurance_multisport'], populations: ['healthy_adult_athletes'], outcomes: ['endurance_performance'], horizon: 'acute' },
        evidence: [
            { sourceId: RAMOS_CAMPO_CARBOHYDRATE_SOURCE, directness: 'direct' },
            { sourceId: THOMAS_NUTRITION_SOURCE, directness: 'direct' },
        ],
        limitations: [
            'Magnitude varies with exercise duration, intensity, pre-exercise carbohydrate availability, feeding strategy and performance-test design.',
            'This claim supports carbohydrate availability during relevant endurance work; it does not establish one dose for every session or athlete.',
            'Gastrointestinal tolerance, diabetes/metabolic conditions and individual medical/nutrition needs require personalization.',
        ], reviewedOn: '2026-08-30', version: 1,
    },
    {
        id: TAPER_FUELING_CLAIM_IDS.carbohydrateEventScaledDose,
        statement: 'Carbohydrate intake during endurance exercise should be scaled to event duration and demands: approximately 30-60 g/h is a common target for longer-duration exercise, while events beyond about 2.5 hours may benefit from intakes up to roughly 90 g/h when multiple transportable carbohydrates are tolerated; these are practical ranges, not mandatory universal doses.',
        claimType: 'intervention', maturity: 'established', status: 'active', evidenceCertainty: 'moderate', recommendationStrength: 'conditional', safetyImpact: 'low',
        applicability: { contexts: ['endurance_competition', 'long_endurance_training'], sports: ['cycling', 'running', 'endurance_multisport'], populations: ['healthy_adult_endurance_athletes'], outcomes: ['carbohydrate_availability', 'endurance_performance', 'fueling_tolerance'], horizon: 'acute' },
        evidence: [
            { sourceId: BURKE_CARBOHYDRATE_SOURCE, directness: 'direct' },
            { sourceId: THOMAS_NUTRITION_SOURCE, directness: 'direct' },
            { sourceId: RAMOS_CAMPO_CARBOHYDRATE_SOURCE, directness: 'partially_direct', note: 'Supports performance benefit and duration dependence more strongly than exact dose bands.' },
            { sourceId: MORTON_CARBOHYDRATE_SOURCE, directness: 'partially_direct', note: 'Updates the practical boundary: >90 g/h may raise carbohydrate oxidation in trained athletes, but performance superiority and generalizability remain insufficiently established.' },
            { sourceId: PLEWS_ULTRA_HIGH_CARBOHYDRATE_SOURCE, directness: 'partially_direct', note: 'Focused current-opinion review concludes that evidence for broad >90 g/h performance recommendations remains insufficient, especially outside selected elite contexts.' },
        ],
        limitations: [
            'The gram-per-hour ranges are practical guidance synthesized across heterogeneous exercise contexts; athletes should individualize by body size only where evidence/guidance specifically calls for it rather than mechanically converting these rates to g/kg/h.',
            'High intakes require gastrointestinal tolerance and often gut-training/practice; the upper range should not be introduced for the first time on race day.',
            'Recent 2026 reviews describe 120 g/h as physiologically plausible for some trained endurance athletes, but performance benefit beyond the established <=90 g/h framework is not sufficiently substantiated to make >90 g/h a general recommendation; the most recent focused opinion review explicitly cautions against treating ultra-high intake as a gold standard for amateur/recreational athletes.',
            'Shorter/easier sessions may not require exogenous carbohydrate for performance, and training goals can intentionally alter carbohydrate availability.',
        ], reviewedOn: '2026-08-30', version: 1,
    },
    {
        id: TAPER_FUELING_CLAIM_IDS.hydrationAvoidOverdrinking,
        statement: 'Endurance hydration strategies should prevent both meaningful hypohydration and excessive fluid intake; athletes should not routinely drink beyond losses or pursue blanket replacement targets that create weight gain, because overdrinking is a primary modifiable risk for exercise-associated hyponatremia.',
        claimType: 'safety', maturity: 'established', status: 'active', evidenceCertainty: 'high', recommendationStrength: 'strong', safetyImpact: 'high',
        applicability: { contexts: ['endurance_training', 'endurance_competition', 'hot_environment'], sports: ['all_supported_sports'], populations: ['physically_active_adults'], outcomes: ['hydration_safety', 'exercise_associated_hyponatremia_risk'], horizon: 'acute' },
        evidence: [
            { sourceId: HEW_BUTLER_HYPONATREMIA_SOURCE, directness: 'direct' },
            { sourceId: THOMAS_NUTRITION_SOURCE, directness: 'partially_direct', note: 'Supports individualized fluid strategy in sport.' },
        ],
        limitations: [
            'Sweat rate, heat, altitude, duration, body size, acclimatization and access to fluid vary substantially; no single mL/h rate is appropriate for all athletes.',
            'This registry claim is preventive guidance, not diagnosis or treatment of suspected hyponatremia or heat illness.',
        ], reviewedOn: '2026-08-30', version: 1,
    },
    {
        id: TAPER_FUELING_CLAIM_IDS.taperWindowsVolumePolicy,
        statement: 'Product taper v1: cycling A events default to race-week Monday with at least three days; other A/B competition defaults use 14/5 days; taper intensityScale remains 1.0 while volumeScale falls linearly toward 0.6.',
        claimType: 'heuristic', maturity: 'heuristic', status: 'active', evidenceCertainty: 'not_applicable', recommendationStrength: 'conditional', safetyImpact: 'moderate',
        applicability: { contexts: ['pre_event_taper'], sports: ['all_supported_sports'], populations: ['app_users_with_target_events'], outcomes: ['planner_taper_state'], horizon: 'acute' },
        evidence: [{ sourceId: TAPER_PRODUCT_POLICY_SOURCE, directness: 'direct' }],
        limitations: ['Exact event-priority windows, race-week alignment, linear curve and 0.6 endpoint are product calibration, not direct effect estimates from taper meta-analysis.', 'Post-event recovery is intentionally excluded from this claim.'], reviewedOn: '2026-08-30', version: 1,
    },
    {
        id: TAPER_FUELING_CLAIM_IDS.preEventRestrictionsPolicy,
        statement: 'Product pre-event restriction v1: for A/B cycling/running events, strength is blocked 1-3 days before the event, hard work 1-2 days, and exhaustive work 3-7 days according to current event-priority logic.',
        claimType: 'heuristic', maturity: 'heuristic', status: 'active', evidenceCertainty: 'not_applicable', recommendationStrength: 'conditional', safetyImpact: 'moderate',
        applicability: { contexts: ['pre_event_taper'], sports: ['cycling', 'running'], populations: ['app_users_with_A_or_B_events'], outcomes: ['session_eligibility'], horizon: 'acute' },
        evidence: [{ sourceId: TAPER_PRODUCT_POLICY_SOURCE, directness: 'direct' }],
        limitations: ['Taper evidence supports freshness and preserved quality while volume falls; it does not directly validate each 1/2/3/7-day block as a universal biological recovery threshold.'], reviewedOn: '2026-08-30', version: 1,
    },
    {
        id: TAPER_FUELING_CLAIM_IDS.taperSharpeningPolicy,
        statement: 'Product taper sharpening v1: cycling sharpening targets thresholdPower 0.5/repeatedSurges 0.4 with threshold qualification 0.3, while the strength primer targets maxStrength 0.3/hypertrophy 0.2.',
        claimType: 'heuristic', maturity: 'heuristic', status: 'active', evidenceCertainty: 'not_applicable', recommendationStrength: 'conditional', safetyImpact: 'moderate',
        applicability: { contexts: ['pre_event_taper'], sports: ['cycling', 'running', 'endurance_multisport'], populations: ['app_users_in_taper'], outcomes: ['weekly_objective_calibration'], horizon: 'acute' },
        evidence: [{ sourceId: TAPER_PRODUCT_POLICY_SOURCE, directness: 'direct' }],
        limitations: ['Maintaining useful intensity during taper is evidence-consistent, but these internal 0..1 stimulus values are product semantics, not physiological effect sizes.'], reviewedOn: '2026-08-30', version: 1,
    },
];
