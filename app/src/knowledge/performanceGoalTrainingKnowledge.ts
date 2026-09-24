import type { KnowledgeClaim, KnowledgeSource } from './sportsKnowledge.ts';

export const PERFORMANCE_GOAL_TRAINING_CLAIM_IDS = {
    strengthHighLoadStrengthGain: 'performance.strength.high_load_strength_gain',
    cyclingShortSprintAnaerobicPerformance: 'performance.cycling.short_sprint_anaerobic_performance',
    deadliftDirectPracticePolicy: 'policy.workout_catalog.deadlift_direct_practice_v1',
    cyclingSprintPowerPolicy: 'policy.workout_catalog.cycling_sprint_power_v1',
} as const;

const CURRIER_2023_RT_PRESCRIPTION_SOURCE = 'CURRIER-2023-RT-PRESCRIPTION-NMA';
const HALL_2023_SIT_PERFORMANCE_SOURCE = 'HALL-2023-SIT-PERFORMANCE-META';
const BOULLOSA_2022_SHORT_SIT_SOURCE = 'BOULLOSA-2022-SHORT-SIT-META';
const HAZELL_2010_SHORT_CYCLING_SIT_SOURCE = 'HAZELL-2010-SHORT-CYCLING-SIT';
const PG6_WORKOUT_POLICY_SOURCE = 'PRODUCT-PG6-WORKOUT-COVERAGE-V1';

export const PERFORMANCE_GOAL_TRAINING_SOURCES: readonly KnowledgeSource[] = [
    {
        id: CURRIER_2023_RT_PRESCRIPTION_SOURCE,
        title: 'Resistance training prescription for muscle strength and hypertrophy in healthy adults: a systematic review and Bayesian network meta-analysis',
        sourceType: 'systematic_review',
        citation: 'Currier BS, McLeod JC, Banfield L, et al. Br J Sports Med. 2023;57(18):1211-1220. doi:10.1136/bjsports-2023-106807.',
        url: 'https://pubmed.ncbi.nlm.nih.gov/37414459/',
        publishedOn: '2023-07-06',
        externalIds: [
            { type: 'pmid', value: '37414459' },
            { type: 'pmcid', value: 'PMC10579494' },
            { type: 'doi', value: '10.1136/bjsports-2023-106807' },
        ],
        synthesisMethods: ['network_meta_analysis'],
        notes: 'Network meta-analysis of 178 strength studies / 5,097 participants. All resistance-training prescriptions improved strength versus non-exercise control; higher-load prescriptions (>80% 1RM) maximized strength gains on average. It does not establish one optimal deadlift-specific set/rep/rest scheme.',
    },
    {
        id: HALL_2023_SIT_PERFORMANCE_SOURCE,
        title: 'The Effects of Sprint Interval Training on Physical Performance: A Systematic Review and Meta-Analysis',
        sourceType: 'systematic_review',
        citation: 'Hall AJ, Aspe RR, Craig TP, et al. J Strength Cond Res. 2023;37(2):457-481. doi:10.1519/JSC.0000000000004257.',
        url: 'https://pubmed.ncbi.nlm.nih.gov/36165995/',
        publishedOn: '2022-09-08',
        externalIds: [
            { type: 'pmid', value: '36165995' },
            { type: 'doi', value: '10.1519/JSC.0000000000004257' },
        ],
        synthesisMethods: ['meta_analysis'],
        notes: 'Fifty-five-study meta-analysis found moderate overall physical-performance improvement with sprint interval training and the largest estimated effects for anaerobic outcomes, but also extensive small-study effects and substantial protocol heterogeneity.',
    },
    {
        id: BOULLOSA_2022_SHORT_SIT_SOURCE,
        title: 'Effects of short sprint interval training on aerobic and anaerobic indices: A systematic review and meta-analysis',
        sourceType: 'systematic_review',
        citation: 'Boullosa D, Dragutinovic B, Feuerbacher JF, et al. Scand J Med Sci Sports. 2022;32(5):810-820. doi:10.1111/sms.14133.',
        url: 'https://pubmed.ncbi.nlm.nih.gov/35090181/',
        publishedOn: '2022-02-11',
        externalIds: [
            { type: 'pmid', value: '35090181' },
            { type: 'doi', value: '10.1111/sms.14133' },
        ],
        synthesisMethods: ['meta_analysis'],
        notes: 'Eighteen-study review of supervised short sprint interval training with efforts <=10 s in active adults and athletes. Short sprint training improved aerobic and anaerobic outcomes versus no exercise/usual training, without superiority over HIIT/continuous comparators.',
    },
    {
        id: HAZELL_2010_SHORT_CYCLING_SIT_SOURCE,
        title: '10 or 30-s sprint interval training bouts enhance both aerobic and anaerobic performance',
        sourceType: 'randomized_trial',
        citation: 'Hazell TJ, Macpherson REK, Gravelle BMR, Lemon PWR. Eur J Appl Physiol. 2010;110(1):153-160. doi:10.1007/s00421-010-1474-y.',
        url: 'https://pubmed.ncbi.nlm.nih.gov/20424855/',
        publishedOn: '2010-04-28',
        externalIds: [
            { type: 'pmid', value: '20424855' },
            { type: 'doi', value: '10.1007/s00421-010-1474-y' },
        ],
        notes: 'Cycling trial using 10-s all-out bouts with 2- or 4-min recovery. Both short-sprint groups improved Wingate peak power over two weeks; the study supports feasibility of minutes-scale recovery but is not evidence that one exact recovery duration is universally optimal.',
    },
    {
        id: PG6_WORKOUT_POLICY_SOURCE,
        title: 'Performance-goal catalog coverage policy v1',
        sourceType: 'product_policy',
        citation: 'Adaptive Training Recommender product policy: pg6-workout-coverage-v1.',
        notes: 'Records the exact conservative workout defaults used to close PG6 catalog coverage gaps. These scalars are product calibration bounded by external evidence, not externally validated universal prescriptions.',
    },
];

export const PERFORMANCE_GOAL_TRAINING_CLAIMS: readonly KnowledgeClaim[] = [
    {
        id: PERFORMANCE_GOAL_TRAINING_CLAIM_IDS.strengthHighLoadStrengthGain,
        statement: 'Resistance training improves muscular strength across a wide range of prescriptions, while higher-load prescriptions above about 80% 1RM tend to maximize 1RM strength gains on average; this supports meaningful loaded practice for strength goals but does not establish one universal exercise-specific dose.',
        claimType: 'intervention',
        maturity: 'supported',
        status: 'active',
        evidenceCertainty: 'moderate',
        recommendationStrength: 'conditional',
        safetyImpact: 'moderate',
        applicability: {
            contexts: ['strength_training', 'performance_development'],
            sports: ['strength', 'endurance_multisport', 'team_sports'],
            populations: ['healthy_adults'],
            outcomes: ['muscular_strength', 'one_repetition_maximum'],
            horizon: 'chronic',
        },
        evidence: [
            { sourceId: CURRIER_2023_RT_PRESCRIPTION_SOURCE, directness: 'partially_direct', note: 'Direct for load/prescription effects on strength, but not a deadlift-specific protocol comparison.' },
        ],
        limitations: [
            'The network meta-analysis aggregates many exercises, populations and program designs; it does not validate the catalog deadlift session as an optimal deadlift program.',
            'Aspirational goal 1RM is not current capability and must never be used as the load denominator.',
            'Athlete history, technique, pain/injury state and concurrent training load remain necessary implementation constraints.',
        ],
        reviewedOn: '2026-09-24',
        version: 1,
    },
    {
        id: PERFORMANCE_GOAL_TRAINING_CLAIM_IDS.cyclingShortSprintAnaerobicPerformance,
        statement: 'Short sprint interval training using efforts of 10 seconds or less can improve anaerobic performance in active adults and athletes; cycling trials support short all-out efforts separated by minutes of recovery, but the evidence does not establish one universally optimal sprint count, duration or recovery interval for peak-power development.',
        claimType: 'intervention',
        maturity: 'supported',
        status: 'active',
        evidenceCertainty: 'low',
        recommendationStrength: 'conditional',
        safetyImpact: 'moderate',
        applicability: {
            contexts: ['cycling_training', 'sprint_training', 'performance_development'],
            sports: ['cycling', 'endurance_multisport'],
            populations: ['healthy_active_adults_and_athletes'],
            outcomes: ['anaerobic_performance', 'cycling_peak_power'],
            horizon: 'chronic',
        },
        evidence: [
            { sourceId: BOULLOSA_2022_SHORT_SIT_SOURCE, directness: 'direct', note: 'Short-sprint <=10 s intervention evidence across exercise modes including cycling.' },
            { sourceId: HALL_2023_SIT_PERFORMANCE_SOURCE, directness: 'partially_direct', note: 'Broader sprint-interval evidence; anaerobic outcomes showed the largest estimated effects but small-study effects were substantial.' },
            { sourceId: HAZELL_2010_SHORT_CYCLING_SIT_SOURCE, directness: 'direct', note: 'Cycling-specific 10-s all-out protocol with 2- or 4-min recovery and improved Wingate peak power.' },
        ],
        limitations: [
            'The reviews include heterogeneous modalities, sprint durations, participant training status and intervention lengths.',
            'The Hall meta-analysis reported extensive small-study effects, so effect magnitude may be overestimated.',
            'The evidence supports the direction of short maximal sprint practice, not the exact catalog choice of five 8-second sprints with 240-second recovery.',
            'Peak-power training should not be conflated with repeated-sprint conditioning; preserving execution quality can require longer recovery than conditioning-focused protocols.',
        ],
        reviewedOn: '2026-09-24',
        version: 1,
    },
    {
        id: PERFORMANCE_GOAL_TRAINING_CLAIM_IDS.deadliftDirectPracticePolicy,
        statement: 'For PG6 conventional-deadlift goal coverage, the catalog uses three work sets of three repetitions at 3-5 reps in reserve with 180 seconds between sets; the reduced variant keeps two direct-practice sets and the return-to-training variant removes loaded conventional-deadlift exposure.',
        claimType: 'heuristic',
        maturity: 'heuristic',
        status: 'active',
        evidenceCertainty: 'not_applicable',
        recommendationStrength: 'conditional',
        safetyImpact: 'moderate',
        applicability: {
            contexts: ['strength_training', 'workout_catalog', 'performance_goal_coverage'],
            sports: ['strength', 'endurance_multisport', 'team_sports'],
            populations: ['healthy_adults_with_appropriate_strength_experience'],
            outcomes: ['direct_exercise_practice', 'muscular_strength'],
            horizon: 'both',
        },
        evidence: [{ sourceId: PG6_WORKOUT_POLICY_SOURCE, directness: 'direct' }],
        limitations: [
            'The exact 3x3, RIR 3-5 and 180-second rest values are conservative product calibration, not a scientifically proven universal optimum.',
            'The scientific strength evidence bounds the direction of loaded strength work but does not validate this exact deadlift dose.',
            'This policy does not override pain flags, readiness, spacing, equipment, technique or higher-authority scheduling constraints.',
            'A substitution such as Romanian deadlift may preserve broad hinge strength but does not satisfy exact conventional-deadlift goal coverage.',
        ],
        reviewedOn: '2026-09-24',
        version: 1,
    },
    {
        id: PERFORMANCE_GOAL_TRAINING_CLAIM_IDS.cyclingSprintPowerPolicy,
        statement: 'For PG6 cycling 5-second peak-power goal coverage, the catalog uses five 8-second maximal cycling sprints separated by 240 seconds of easy recovery; the reduced variant keeps three maximal sprints and the return-to-training variant removes maximal sprint exposure.',
        claimType: 'heuristic',
        maturity: 'heuristic',
        status: 'active',
        evidenceCertainty: 'not_applicable',
        recommendationStrength: 'conditional',
        safetyImpact: 'moderate',
        applicability: {
            contexts: ['cycling_training', 'workout_catalog', 'performance_goal_coverage'],
            sports: ['cycling', 'endurance_multisport'],
            populations: ['healthy_adults_with_safe_sprint_environment'],
            outcomes: ['direct_sprint_power_practice', 'cycling_peak_power'],
            horizon: 'both',
        },
        evidence: [{ sourceId: PG6_WORKOUT_POLICY_SOURCE, directness: 'direct' }],
        limitations: [
            'The exact 5x8-second and 240-second recovery values are conservative product calibration, not a universally optimal protocol.',
            'The goal wattage is an outcome and never becomes the prescribed sprint wattage.',
            'The workout requires a safe riding environment and does not override pain, readiness or spacing constraints.',
            'The return-to-training variant deliberately loses direct peak-power-goal coverage rather than relabeling submaximal work as maximal sprint practice.',
        ],
        reviewedOn: '2026-09-24',
        version: 1,
    },
];
