import type { KnowledgeClaim, KnowledgeSource } from './sportsKnowledge.ts';

/** Issue #804: longitudinal mechanical and impact exposure model. */
export const MECHANICAL_EXPOSURE_CLAIM_IDS = {
    progressiveMechanicalLoading: 'biomechanics.impact.progressive_mechanical_loading',
    mechanicalExposurePolicy: 'policy.evergreen.mechanical_exposure_v1',
} as const;

const WARDEN_BONE_ADAPTATION_SOURCE = 'WARDEN-2014-BONE-MECHANICAL-ADAPTATION';
const BOHM_TENDON_ADAPTATION_SOURCE = 'BOHM-2015-TENDON-MECHANICAL-ADAPTATION';
const MECHANICAL_EXPOSURE_PRODUCT_POLICY_SOURCE = 'PRODUCT-MECHANICAL-EXPOSURE-V1';

export const MECHANICAL_EXPOSURE_SOURCES: readonly KnowledgeSource[] = [
    {
        id: WARDEN_BONE_ADAPTATION_SOURCE,
        title: 'Cross-sectional bone adaptation to mechanical loading',
        sourceType: 'narrative_review',
        citation: 'Warden SJ, Burr DB, Brukner PD. PNAS. 2014;111(14):5337-5342. doi:10.1073/pnas.1308871111.',
        url: 'https://pubmed.ncbi.nlm.nih.gov/24706817/',
        publishedOn: '2014-04-08',
        externalIds: [
            { type: 'pmid', value: '24706817' },
            { type: 'doi', value: '10.1073/pnas.1308871111' },
        ],
        notes: 'Review of skeletal adaptation to mechanical loading: bone tissue responds to dynamic, high-strain-rate loading with rapid saturation (40–100 cycles); additional cycles yield diminishing osteogenic benefits while accumulating fatigue microdamage. Recovery intervals between mechanical bouts are critical for tissue remodeling.',
    },
    {
        id: BOHM_TENDON_ADAPTATION_SOURCE,
        title: 'Human tendon adaptation in response to mechanical loading: a systematic review and meta-analysis of exercise interventions',
        sourceType: 'systematic_review',
        synthesisMethods: ['meta_analysis'],
        citation: 'Bohm S, Mersmann F, Arampatzis A. Sports Med. 2015;45(12):1709-1726. doi:10.1007/s40279-015-0397-3.',
        url: 'https://pubmed.ncbi.nlm.nih.gov/26406284/',
        publishedOn: '2015-09-25',
        externalIds: [
            { type: 'pmid', value: '26406284' },
            { type: 'doi', value: '10.1007/s40279-015-0397-3' },
        ],
        notes: 'Meta-analysis finding that tendon stiffness and cross-sectional area adapt positively to high-magnitude mechanical loading when adequate recovery intervals (approx. 48 hours or more) are provided; insufficient recovery or unmanaged volume increases risk of non-adaptive tendon strain and reactive tendinopathy.',
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
        statement: 'Connective and skeletal tissues adapt positively to progressive, dynamic mechanical loading when sufficient recovery separation (approx. 48 hours) is provided; mechanical dose saturates early and consecutive unrecovered loading increases fatigue damage without additional adaptive stimulus.',
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
            { sourceId: WARDEN_BONE_ADAPTATION_SOURCE, directness: 'direct', note: 'Dynamic mechanical loading saturates bone adaptation after low contact counts; spacing is essential.' },
            { sourceId: BOHM_TENDON_ADAPTATION_SOURCE, directness: 'direct', note: 'Tendon adapts to progressive high-strain loading with multi-day recovery intervals.' },
        ],
        limitations: [
            'Individual tendon and cartilage tolerances vary substantially by biological age, prior loading history, and anatomical region.',
            'Direct measurement of in vivo tissue strain during varied field exercises is unavailable; contact counts and running minutes serve as operational proxies.',
            'Mechanosensory saturation limits osteogenic stimulus per bout; excess loading accumulates microdamage without proportional adaptive signaling.',
        ],
        reviewedOn: '2026-09-26',
        version: 1,
    },
    {
        id: MECHANICAL_EXPOSURE_CLAIM_IDS.mechanicalExposurePolicy,
        statement: 'Evergreen mechanical exposure policy v1: an established hybrid athlete whose priorities include sport readiness or speed/power, or who maintains mechanical capacity alongside cycling, receives a longitudinal mechanical exposure requirement targeting one low-dose session per week (max 2 credited). Progression follows 4 discrete stages (Stage 1 landing/pogo/walk-run, Stage 2 bilateral jump/linear running, Stage 3 braking/deceleration, Stage 4 multidirectional/COD) and strictly requires explicit normal tissue response evidence; missing follow-up response evidence fails closed and halts progression at the current stage. Mild tissue symptoms regress the stage by 1; moderate/severe symptoms, pain flags, knee swelling, or active avoid_high_impact guardrails immediately withhold or block exposure. Exposures on consecutive calendar days are withheld to protect tissue remodeling, and absence of exposure for >= 14 days enforces re-entry at Stage 1.',
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
            { sourceId: WARDEN_BONE_ADAPTATION_SOURCE, directness: 'indirect', note: 'Supports low-volume dynamic loading and non-consecutive stimulus days.' },
            { sourceId: BOHM_TENDON_ADAPTATION_SOURCE, directness: 'indirect', note: 'Supports progressive tendon loading with mandatory recovery separation.' },
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
