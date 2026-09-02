import type { KnowledgeClaim, KnowledgeSource } from './sportsKnowledge';

export const STRENGTH_WARMUP_CLAIM_IDS = {
    contextualPreparation: 'strength.warmup.contextual_preparation',
    specificRehearsal: 'strength.warmup.specific_rehearsal',
} as const;

const GENERAL_WARMUP_REVIEW = 'FRADKIN-2010-WARMUP-META';
const RESISTANCE_WARMUP_SCOPING_REVIEW = 'NEVES-2026-RESISTANCE-WARMUP-SCOPING';
const SPECIFIC_RESISTANCE_TRIAL = 'RIBEIRO-2020-SPECIFIC-WARMUP-TRIAL';
const NULL_RESISTANCE_TRIAL = 'RIBEIRO-2014-WARMUP-NULL-TRIAL';

export const STRENGTH_WARMUP_SOURCES: readonly KnowledgeSource[] = [
    {
        id: GENERAL_WARMUP_REVIEW,
        title: 'Effects of warming-up on physical performance: a systematic review with meta-analysis',
        sourceType: 'systematic_review',
        citation: 'Fradkin AJ, Zazryn TR, Smoliga JM. J Strength Cond Res. 2010;24(1):140-148. PMID:19996770.',
        url: 'https://pubmed.ncbi.nlm.nih.gov/19996770/',
        publishedOn: '2010-01-01',
        externalIds: [{ type: 'pmid', value: '19996770' }],
        synthesisMethods: ['meta_analysis'],
        notes: 'Broad performance review; it does not establish one resistance-training warm-up dose for every athlete or lift.',
    },
    {
        id: RESISTANCE_WARMUP_SCOPING_REVIEW,
        title: 'Acute Effects of Resistance Training Warm-Up and Re-Warm-Up on Dynamic Strength Performance: A Scoping Review',
        sourceType: 'scoping_review',
        citation: 'Neves PP, Marques DL, Neiva HP, Alves AR. J Sci Sport Exerc. 2026. doi:10.1007/s42978-025-00361-9.',
        url: 'https://doi.org/10.1007/s42978-025-00361-9',
        publishedOn: '2026-01-19',
        externalIds: [{ type: 'doi', value: '10.1007/s42978-025-00361-9' }],
        synthesisMethods: ['narrative_synthesis'],
        notes: 'Resistance-training-specific scoping review (systematic search; 19 warm-up studies and one re-warm-up study), with evidence concentrated in strength-trained males. It supports context-specific or progressive preparation for some acute dynamic-strength outcomes but does not establish one universal protocol or an injury-prevention effect.',
    },
    {
        id: SPECIFIC_RESISTANCE_TRIAL,
        title: 'The Role of Specific Warm-up during Bench Press and Squat Exercises: A Novel Approach',
        sourceType: 'randomized_trial',
        citation: 'Ribeiro B, Pereira A, Neves PP, et al. Int J Environ Res Public Health. 2020;17(18):6882. doi:10.3390/ijerph17186882.',
        url: 'https://pubmed.ncbi.nlm.nih.gov/32971729/',
        publishedOn: '2020-09-22',
        externalIds: [
            { type: 'pmid', value: '32971729' },
            { type: 'pmcid', value: 'PMC7558980' },
            { type: 'doi', value: '10.3390/ijerph17186882' },
        ],
        notes: 'Supports considering movement-specific preparation for squat/bench acute performance in its studied context; not a universal percentage ladder.',
    },
    {
        id: NULL_RESISTANCE_TRIAL,
        title: 'Effect of different warm-up procedures on the performance of resistance training exercises',
        sourceType: 'randomized_trial',
        citation: 'Ribeiro AS, Romanzini M, Schoenfeld BJ, et al. Percept Mot Skills. 2014;119(1):133-145. doi:10.2466/25.29.PMS.119c17z7.',
        url: 'https://pubmed.ncbi.nlm.nih.gov/25153744/',
        publishedOn: '2014-08-01',
        externalIds: [
            { type: 'pmid', value: '25153744' },
            { type: 'doi', value: '10.2466/25.29.PMS.119c17z7' },
        ],
        notes: 'A null finding reinforces that acute response and exact protocol are context-dependent.',
    },
];

export const STRENGTH_WARMUP_CLAIMS: readonly KnowledgeClaim[] = [
    {
        id: STRENGTH_WARMUP_CLAIM_IDS.contextualPreparation,
        statement: 'A brief, low-fatigue warm-up can support acute readiness and performance in many exercise contexts, but the most useful content and dose are task- and athlete-specific.',
        claimType: 'intervention', maturity: 'supported', status: 'active', evidenceCertainty: 'low', recommendationStrength: 'conditional', safetyImpact: 'low',
        applicability: { contexts: ['strength_training', 'session_preparation'], sports: ['strength', 'endurance_multisport', 'team_sports'], populations: ['healthy_adults_and_athletes'], outcomes: ['acute_performance', 'readiness'], horizon: 'acute' },
        evidence: [
            { sourceId: RESISTANCE_WARMUP_SCOPING_REVIEW, directness: 'direct', note: 'Resistance-training-specific acute evidence; population is concentrated in strength-trained males.' },
            { sourceId: GENERAL_WARMUP_REVIEW, directness: 'partially_direct' },
            { sourceId: NULL_RESISTANCE_TRIAL, directness: 'direct', note: 'Bounds the claim; response is not guaranteed.' },
        ],
        limitations: ['Evidence does not establish a universal warm-up duration, exercise selection, percentage of 1RM, or performance response.', 'Resistance-specific evidence is concentrated in strength-trained males, so population generalization remains limited.', 'This claim does not support an injury-prevention promise.'],
        reviewedOn: '2026-09-01', version: 1,
    },
    {
        id: STRENGTH_WARMUP_CLAIM_IDS.specificRehearsal,
        statement: 'Movement-specific rehearsal or light ramping before a loaded or high-coordination strength movement is a reasonable implementation pattern, while exact loading and number of sets must remain contextual.',
        claimType: 'intervention', maturity: 'supported', status: 'active', evidenceCertainty: 'low', recommendationStrength: 'conditional', safetyImpact: 'low',
        applicability: { contexts: ['strength_training', 'movement_rehearsal'], sports: ['strength', 'endurance_multisport'], populations: ['healthy_adults_and_athletes'], outcomes: ['acute_performance'], horizon: 'acute' },
        evidence: [
            { sourceId: RESISTANCE_WARMUP_SCOPING_REVIEW, directness: 'direct', note: 'Supports the implementation direction while preserving protocol-level uncertainty.' },
            { sourceId: SPECIFIC_RESISTANCE_TRIAL, directness: 'direct' },
            { sourceId: NULL_RESISTANCE_TRIAL, directness: 'direct', note: 'Keeps protocol claims conditional.' },
        ],
        limitations: ['The catalog uses descriptive light rehearsal rather than a universal percentage ladder.', 'Resistance-specific evidence is concentrated in strength-trained males and acute performance outcomes.', 'This is not clinical screening, rehabilitation guidance, or an injury-prevention claim.'],
        reviewedOn: '2026-09-01', version: 1,
    },
];
