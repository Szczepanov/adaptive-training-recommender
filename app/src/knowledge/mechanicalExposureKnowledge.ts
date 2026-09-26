import type { KnowledgeClaim, KnowledgeSource } from './sportsKnowledge.ts';

/** Issue #804: longitudinal mechanical and impact exposure model. */
export const MECHANICAL_EXPOSURE_CLAIM_IDS = {
    progressiveMechanicalLoading: 'biomechanics.impact.progressive_mechanical_loading',
    mechanicalExposurePolicy: 'policy.evergreen.mechanical_exposure_v1',
} as const;

const ROBLING_BONE_MECHANOTRANSDUCTION_SOURCE = 'ROBLING-TURNER-2009-BONE-MECHANOTRANSDUCTION';
const BOHM_TENDON_ADAPTATION_SOURCE = 'BOHM-2015-TENDON-MECHANICAL-ADAPTATION';
const MECHANICAL_EXPOSURE_PRODUCT_POLICY_SOURCE = 'PRODUCT-MECHANICAL-EXPOSURE-V1';

export const MECHANICAL_EXPOSURE_SOURCES: readonly KnowledgeSource[] = [
    {
        id: ROBLING_BONE_MECHANOTRANSDUCTION_SOURCE,
        title: 'Mechanical signaling for bone modeling and remodeling',
        sourceType: 'narrative_review',
        citation: 'Robling AG, Turner CH. Crit Rev Eukaryot Gene Expr. 2009;19(4):319-338. doi:10.1615/critreveukargeneexpr.v19.i4.50.',
        url: 'https://pubmed.ncbi.nlm.nih.gov/19817708/',
        publishedOn: '2009-01-01',
        externalIds: [
            { type: 'pmid', value: '19817708' },
            { type: 'doi', value: '10.1615/critreveukargeneexpr.v19.i4.50' },
        ],
        notes: 'Review of bone mechanotransduction and bone-cell accommodation. It supports the general idea that repeated mechanical signaling can show diminishing responsiveness within a bout, but it does not establish a universal athlete session-spacing threshold.',
    },
    {
        id: BOHM_TENDON_ADAPTATION_SOURCE,
        title: 'Human tendon adaptation in response to mechanical loading: a systematic review and meta-analysis of exercise interventions',
        sourceType: 'systematic_review',
        synthesisMethods: ['meta_analysis'],
        citation: 'Bohm S, Mersmann F, Arampatzis A. Sports Med Open. 2015;1:7. doi:10.1186/s40798-015-0009-9.',
        url: 'https://pubmed.ncbi.nlm.nih.gov/27747846/',
        publishedOn: '2015-03-27',
        externalIds: [
            { type: 'pmid', value: '27747846' },
            { type: 'doi', value: '10.1186/s40798-015-0009-9' },
        ],
        notes: 'Systematic review/meta-analysis of healthy adults showing tendon stiffness, modulus and cross-sectional-area adaptation to chronic mechanical loading; loading magnitude was an important moderator. The review does not establish a universal 48-hour between-session rule.',
    },
    {
        id: MECHANICAL_EXPOSURE_PRODUCT_POLICY_SOURCE,
        title: 'Mechanical and impact exposure policy v1',
        sourceType: 'product_policy',
        citation: 'Adaptive Training Recommender product policy: mechanical-exposure-v1 (issue #804).',
        notes: 'Explicit product policy for longitudinal mechanical and impact exposure: 4-stage discrete progression, conservative response-gated advancement (missing response fails closed), regression on symptoms or gaps, and safety blocking under avoid_high_impact, knee swelling, or acute pain.',
    },
];

export const MECHANICAL_EXPOSURE_CLAIMS: readonly KnowledgeClaim[] = [
    {
        id: MECHANICAL_EXPOSURE_CLAIM_IDS.progressiveMechanicalLoading,
        statement: 'Bone and tendon tissues adapt to mechanical loading, but the evidence supports different aspects of that process: bone mechanotransduction can show accommodation/diminishing responsiveness to repeated signaling, while human tendon adaptation is influenced by chronic loading magnitude. These sources do not define a universal 48-hour spacing rule for mixed running, jumping and field sessions.',
        claimType: 'causal',
        maturity: 'established',
        status: 'active',
        evidenceCertainty: 'moderate',
        recommendationStrength: 'conditional',
        safetyImpact: 'moderate',
        applicability: {
            contexts: ['mechanical_loading', 'plyometrics', 'running', 'maintenance'],
            sports: ['running', 'field', 'strength', 'endurance_multisport'],
            populations: ['trained_adults', 'hybrid_athletes'],
            outcomes: ['tissue_capacity', 'bone_density', 'tendon_stiffness'],
            horizon: 'chronic',
        },
        evidence: [
            { sourceId: ROBLING_BONE_MECHANOTRANSDUCTION_SOURCE, directness: 'indirect', note: 'Supports bone-cell accommodation and diminishing responsiveness to repeated mechanical signaling; much of the mechanistic evidence is not an athlete session-spacing trial.' },
            { sourceId: BOHM_TENDON_ADAPTATION_SOURCE, directness: 'direct', note: 'Supports chronic human tendon adaptation to mechanical loading and the importance of loading magnitude, not a fixed between-session interval.' },
        ],
        limitations: [
            'Individual tendon and cartilage tolerances vary substantially by biological age, prior loading history, and anatomical region.',
            'Direct measurement of in vivo tissue strain during varied field exercises is unavailable; contact counts and running minutes serve as operational proxies.',
            'The no-consecutive-day and >=14-day re-entry rules are conservative product-policy guardrails; neither cited review validates those exact calendar thresholds.',
        ],
        reviewedOn: '2026-09-26',
        version: 1,
    },
    {
        id: MECHANICAL_EXPOSURE_CLAIM_IDS.mechanicalExposurePolicy,
        statement: 'Evergreen mechanical exposure policy v1: an established hybrid athlete whose priorities include sport readiness or speed/power, or who maintains mechanical capacity alongside cycling, receives a longitudinal mechanical exposure requirement targeting one low-dose session per week (max 2 credited). Progression follows 4 discrete stages (Stage 1 landing/pogo/walk-run, Stage 2 bilateral jump/linear running, Stage 3 braking/deceleration, Stage 4 multidirectional/COD) and strictly requires explicit normal tissue response evidence after at least two current-stage exposures; missing follow-up response evidence fails closed and halts progression at the current stage. Mild tissue symptoms regress the stage by 1; moderate/severe symptoms, pain flags, knee swelling, or active avoid_high_impact guardrails immediately withhold or block exposure. Exposures on consecutive calendar days are withheld to protect tissue remodeling, and absence of exposure for >= 14 days enforces re-entry at Stage 1.',
        claimType: 'heuristic',
        maturity: 'heuristic',
        status: 'active',
        evidenceCertainty: 'not_applicable',
        recommendationStrength: 'conditional',
        safetyImpact: 'high',
        applicability: {
            contexts: ['evergreen', 'mechanical_exposure', 'progression', 'maintenance'],
            sports: ['running', 'field', 'strength', 'cycling', 'endurance_multisport'],
            populations: ['established_hybrid_athletes'],
            outcomes: ['mechanical_capacity_maintenance', 'injury_prevention'],
            horizon: 'chronic',
        },
        evidence: [
            { sourceId: MECHANICAL_EXPOSURE_PRODUCT_POLICY_SOURCE, directness: 'direct', note: 'Issue #804 product policy governing progression, regression, and safety limits.' },
            { sourceId: ROBLING_BONE_MECHANOTRANSDUCTION_SOURCE, directness: 'indirect', note: 'Supports the broad rationale for distributing mechanical loading, but not the exact product-policy spacing thresholds.' },
            { sourceId: BOHM_TENDON_ADAPTATION_SOURCE, directness: 'indirect', note: 'Supports progressive chronic tendon loading; exact daily spacing remains product policy.' },
        ],
        limitations: [
            'The 4-stage discrete progression is an operational product heuristic, not a universal physiological boundary.',
            'Missing response evidence fails closed to prevent premature load escalation, but may delay advancement for athletes who skip daily check-ins.',
            'Subjective tissue responses rely on athlete compliance and self-reporting accuracy.',
        ],
        reviewedOn: '2026-09-26',
        version: 1,
    },
];
