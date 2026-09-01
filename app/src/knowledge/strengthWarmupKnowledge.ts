import type { KnowledgeClaim, KnowledgeSource } from './sportsKnowledge';

export const STRENGTH_WARMUP_CLAIM_IDS = {
    contextualPreparation: 'strength.warmup.contextual_preparation',
    specificRehearsal: 'strength.warmup.specific_rehearsal',
} as const;

const GENERAL_WARMUP_REVIEW = 'FRADKIN-2010-WARMUP-META';
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
        id: SPECIFIC_RESISTANCE_TRIAL,
        title: 'Specific warm-up protocols and resistance-exercise performance',
        sourceType: 'randomized_trial',
        citation: 'Resistance-training warm-up trial indexed in PubMed. PMID:32971729.',
        url: 'https://pubmed.ncbi.nlm.nih.gov/32971729/',
        publishedOn: '2020-01-01',
        externalIds: [{ type: 'pmid', value: '32971729' }],
        notes: 'Supports considering movement-specific preparation for squat/bench performance in its studied context; not a universal percentage ladder.',
    },
    {
        id: NULL_RESISTANCE_TRIAL,
        title: 'Resistance-training warm-up crossover trial with null performance findings',
        sourceType: 'randomized_trial',
        citation: 'Resistance-training warm-up trial indexed in PubMed. PMID:25153744.',
        url: 'https://pubmed.ncbi.nlm.nih.gov/25153744/',
        publishedOn: '2014-01-01',
        externalIds: [{ type: 'pmid', value: '25153744' }],
        notes: 'A null finding reinforces that acute response and exact protocol are context-dependent.',
    },
];

export const STRENGTH_WARMUP_CLAIMS: readonly KnowledgeClaim[] = [
    {
        id: STRENGTH_WARMUP_CLAIM_IDS.contextualPreparation,
        statement: 'A brief, low-fatigue warm-up can support acute readiness and performance in many exercise contexts, but the most useful content and dose are task- and athlete-specific.',
        claimType: 'intervention', maturity: 'supported', status: 'active', evidenceCertainty: 'low', recommendationStrength: 'conditional', safetyImpact: 'low',
        applicability: { contexts: ['strength_training', 'session_preparation'], sports: ['strength', 'endurance_multisport', 'team_sports'], populations: ['healthy_adults_and_athletes'], outcomes: ['acute_performance', 'readiness'], horizon: 'acute' },
        evidence: [{ sourceId: GENERAL_WARMUP_REVIEW, directness: 'partially_direct' }, { sourceId: NULL_RESISTANCE_TRIAL, directness: 'direct', note: 'Bounds the claim; response is not guaranteed.' }],
        limitations: ['Evidence does not establish a universal warm-up duration, exercise selection, percentage of 1RM, or performance response.', 'This claim does not support an injury-prevention promise.'],
        reviewedOn: '2026-09-01', version: 1,
    },
    {
        id: STRENGTH_WARMUP_CLAIM_IDS.specificRehearsal,
        statement: 'Movement-specific rehearsal or light ramping before a loaded or high-coordination strength movement is a reasonable implementation pattern, while exact loading and number of sets must remain contextual.',
        claimType: 'intervention', maturity: 'supported', status: 'active', evidenceCertainty: 'low', recommendationStrength: 'conditional', safetyImpact: 'low',
        applicability: { contexts: ['strength_training', 'movement_rehearsal'], sports: ['strength', 'endurance_multisport'], populations: ['healthy_adults_and_athletes'], outcomes: ['acute_performance', 'movement_quality'], horizon: 'acute' },
        evidence: [{ sourceId: SPECIFIC_RESISTANCE_TRIAL, directness: 'direct' }, { sourceId: NULL_RESISTANCE_TRIAL, directness: 'direct', note: 'Keeps protocol claims conditional.' }],
        limitations: ['The catalog uses descriptive light rehearsal rather than a universal percentage ladder.', 'This is not clinical screening, rehabilitation guidance, or an injury-prevention claim.'],
        reviewedOn: '2026-09-01', version: 1,
    },
];
