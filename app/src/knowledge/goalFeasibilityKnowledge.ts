import type { KnowledgeClaim, KnowledgeSource } from './sportsKnowledge';

/**
 * PG4.5.5/ADR-0041: registers the exact numeric bands `goalFeasibility.ts` uses to
 * classify a strength performance-goal's required pace as plausible/stretch/unlikely.
 * These are a bounded, low-certainty product interpretation of short-horizon 1RM
 * dose-response and reliability evidence, not a precise physiological rate constant -- hence
 * `evidenceCertainty: 'low'` and `recommendationStrength: 'conditional'`. No equivalent
 * band exists yet for speed or power; `goalFeasibility.ts` deliberately returns
 * `insufficient_evidence` for those families rather than reusing this one.
 */
export const GOAL_FEASIBILITY_CLAIM_IDS = {
    strengthRequiredChangeBands: 'goalFeasibility.strength.requiredChangeBands',
} as const;

const ACSM_2026_POSITION_STAND = 'CURRIER-2026-ACSM-RESISTANCE-TRAINING';
const PELLAND_2026_DOSE_RESPONSE = 'PELLAND-2026-RESISTANCE-DOSE-RESPONSE';
const GRGIC_2018_FREQUENCY_META = 'GRGIC-2018-STRENGTH-FREQUENCY-META';
const ANDROULAKIS_KORAKAKIS_2020_MIN_DOSE = 'ANDROULAKIS-KORAKAKIS-2020-MIN-DOSE';
const CORATELLA_2016_ECCENTRIC_TRAINED_MEN = 'CORATELLA-2016-ECCENTRIC-TRAINED-MEN';
const GRGIC_2020_1RM_RELIABILITY = 'GRGIC-2020-1RM-RELIABILITY';

export const GOAL_FEASIBILITY_SOURCES: readonly KnowledgeSource[] = [
    {
        id: ACSM_2026_POSITION_STAND,
        title: 'ACSM Position Stand: Resistance Training Prescription for Muscle Function, Hypertrophy, and Physical Performance in Healthy Adults',
        sourceType: 'guideline',
        citation: 'Currier BS et al. Med Sci Sports Exerc. 2026.',
        url: 'https://pubmed.ncbi.nlm.nih.gov/41843416/',
        publishedOn: '2026-01-01',
        externalIds: [{ type: 'pmid', value: '41843416' }],
        notes: 'Synthesizes 137 systematic reviews; strength is enhanced by heavier loading, 2-3 sets and at least 2 sessions/week -- supports treating >=2 sessions/week as the adequate-frequency reference point.',
    },
    {
        id: PELLAND_2026_DOSE_RESPONSE,
        title: 'The Resistance Training Dose Response: Meta-Regressions Exploring the Effects of Weekly Volume and Frequency on Muscle Hypertrophy and Strength Gains',
        sourceType: 'systematic_review',
        citation: 'Pelland JC et al. 2026.',
        url: 'https://pubmed.ncbi.nlm.nih.gov/41343037/',
        publishedOn: '2026-01-01',
        externalIds: [{ type: 'pmid', value: '41343037' }],
        synthesisMethods: ['meta_analysis'],
        notes: 'Strength gains increase with weekly volume and frequency, both with diminishing returns -- supports frequency as a graded, not binary, feasibility factor.',
    },
    {
        id: GRGIC_2018_FREQUENCY_META,
        title: 'Effect of resistance training frequency on gains in muscular strength: a systematic review and meta-analysis',
        sourceType: 'systematic_review',
        citation: 'Grgic J et al. Sports Med. 2018;48(5):1207-1220.',
        url: 'https://pubmed.ncbi.nlm.nih.gov/29470825/',
        publishedOn: '2018-01-01',
        externalIds: [{ type: 'pmid', value: '29470825' }],
        synthesisMethods: ['meta_analysis'],
        notes: 'Higher frequency associated with larger strength effects overall, though the difference disappeared in volume-equated subgroups -- frequency is informative but not the only causal variable.',
    },
    {
        id: ANDROULAKIS_KORAKAKIS_2020_MIN_DOSE,
        title: 'Minimum Effective Training Dose Required to Increase 1RM Strength in Resistance-Trained Men',
        sourceType: 'systematic_review',
        citation: 'Androulakis-Korakakis P et al. Sports Med. 2020;50(4):751-765.',
        url: 'https://pubmed.ncbi.nlm.nih.gov/31797219/',
        publishedOn: '2020-01-01',
        externalIds: [{ type: 'pmid', value: '31797219' }],
        synthesisMethods: ['meta_analysis'],
        notes: 'Low-dose training can still improve 1RM; pooled bench-press increase of 8.25 kg across included low-dose studies -- an absolute benchmark, not a linear weekly rate.',
    },
    {
        id: CORATELLA_2016_ECCENTRIC_TRAINED_MEN,
        title: 'Eccentric resistance training increases and retains maximal strength, muscle endurance, and hypertrophy in trained men',
        sourceType: 'randomized_trial',
        citation: 'Coratella G, Schena F. Appl Physiol Nutr Metab. 2016;41(11):1184-1189.',
        url: 'https://pubmed.ncbi.nlm.nih.gov/27801598/',
        publishedOn: '2016-01-01',
        externalIds: [{ type: 'pmid', value: '27801598' }],
        notes: 'Six-week bench-press 1RM/body-mass increases of roughly 4.7-7.7% across training groups in resistance-trained men -- the short-horizon anchor for the plausible ceiling; the wider stretch band is explicitly heuristic.',
    },
    {
        id: GRGIC_2020_1RM_RELIABILITY,
        title: 'Test-retest reliability of the one-repetition maximum strength assessment',
        sourceType: 'systematic_review',
        citation: 'Grgic J et al. Sports Med Open. 2020;6(1):31.',
        url: 'https://pubmed.ncbi.nlm.nih.gov/32681399/',
        publishedOn: '2020-01-01',
        externalIds: [{ type: 'pmid', value: '32681399' }],
        synthesisMethods: ['narrative_synthesis'],
        notes: 'Median coefficient of variation 4.2% -- the reference for distinguishing a large required-change gap from ordinary measurement noise.',
    },
];

export const GOAL_FEASIBILITY_CLAIMS: readonly KnowledgeClaim[] = [
    {
        id: GOAL_FEASIBILITY_CLAIM_IDS.strengthRequiredChangeBands,
        statement: 'Product goal-feasibility policy v2 (strength family only): required pace is expressed as |relative % change required| / weeks remaining. At an adequate reference frequency of 2+ relevant sessions/week, pace <=1.3%/week is labelled plausible and <=2.0%/week is labelled stretch; above that, unlikely. The plausible ceiling linearizes to ~7.8% over six weeks, approximately the upper end of the cited resistance-trained-men result (~4.7-7.7% over six weeks); the wider stretch ceiling is deliberately permissive and is not directly validated by that study. Available weekly capacity below 2 sessions/week tightens (lowers) both ceilings proportionally, down to a floor of 20% of the adequate-frequency ceiling. Total weekly capacity is only an upper bound: until target-specific planned/performed frequency is available, confidence is reduced when that missing frequency could change a plausible/stretch classification; an already-unlikely result under the optimistic capacity upper bound does not receive that reducer because fewer actual exposures cannot make it more plausible. No equivalent band exists for speed or power; those families report insufficient_evidence rather than reusing this one.',
        claimType: 'heuristic', maturity: 'supported', status: 'active', evidenceCertainty: 'low', recommendationStrength: 'conditional', safetyImpact: 'low',
        applicability: { contexts: ['goal_feasibility', 'performance_goal_advisory'], sports: ['strength'], populations: ['app_users'], outcomes: ['goal_plausibility_classification'], horizon: 'chronic' },
        evidence: [
            { sourceId: CORATELLA_2016_ECCENTRIC_TRAINED_MEN, directness: 'partially_direct', note: 'Six-week 4.7-7.7% 1RM/body-mass gains anchor the plausible ceiling: 1.3%/week linearizes to ~7.8% over six weeks. The 2.0%/week stretch ceiling deliberately extends beyond that observed range and is not directly validated by this study.' },
            { sourceId: ANDROULAKIS_KORAKAKIS_2020_MIN_DOSE, directness: 'indirect', note: 'Absolute low-dose benchmark; supports treating low weekly frequency as feasibility-limiting rather than irrelevant.' },
            { sourceId: ACSM_2026_POSITION_STAND, directness: 'indirect', note: 'Anchors 2 sessions/week as the adequate-frequency reference point.' },
            { sourceId: PELLAND_2026_DOSE_RESPONSE, directness: 'indirect', note: 'Supports frequency as a graded (diminishing-returns) factor rather than a binary cutoff.' },
            { sourceId: GRGIC_2018_FREQUENCY_META, directness: 'indirect', note: 'Bounds the frequency effect; volume-equated subgroups showed no frequency difference, so frequency alone is not deterministic.' },
            { sourceId: GRGIC_2020_1RM_RELIABILITY, directness: 'indirect', note: 'Supports treating small required changes (within ~4% measurement noise) as distinguishable from a genuine target gap.' },
        ],
        limitations: [
            'This is a conservative product calibration, not a validated predictive model of individual strength gain.',
            'Evidence anchors are concentrated in resistance-trained men over a 6-week horizon; applicability to untrained athletes, longer horizons, or other lifts is not established.',
            'The frequency adjustment and the 2.0%/week stretch ceiling are product heuristics, not fitted dose-response curves or validated individual prediction thresholds.',
            'Total weekly commitment is only an upper bound; target-specific planned/performed frequency is unavailable before PG5-PG7. This reduces confidence when actual frequency could worsen a plausible/stretch classification, but not when the target is already unlikely under the optimistic upper-bound frequency.',
            'No exact success probability is derived from this policy; only the plausible/stretch/unlikely band per PG4.5.1.',
        ],
        reviewedOn: '2026-09-19', version: 2,
    },
];
