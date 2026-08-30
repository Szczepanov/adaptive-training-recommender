export type KnowledgeClaimType =
    | 'definition'
    | 'descriptive'
    | 'causal'
    | 'intervention'
    | 'prognostic'
    | 'safety'
    | 'heuristic';

export type KnowledgeMaturity = 'foundational' | 'established' | 'supported' | 'emerging' | 'heuristic';
export type KnowledgeStatus = 'active' | 'contested' | 'deprecated' | 'rejected';
export type EvidenceCertainty = 'high' | 'moderate' | 'low' | 'very_low' | 'not_applicable';
export type EvidenceDirectness = 'direct' | 'partially_direct' | 'indirect';
export type RecommendationStrength = 'strong' | 'conditional' | 'informational';
export type KnowledgeSafetyImpact = 'low' | 'moderate' | 'high';
export type KnowledgeHorizon = 'acute' | 'chronic' | 'both' | 'not_applicable';
export type KnowledgeSourceType =
    | 'guideline'
    | 'systematic_review'
    | 'umbrella_review'
    | 'randomized_trial'
    | 'cohort'
    | 'cross_sectional'
    | 'mechanistic'
    | 'consensus'
    | 'expert_practice'
    | 'product_policy';
export type KnowledgeSynthesisMethod = 'meta_analysis' | 'network_meta_analysis' | 'narrative_synthesis';
export type KnowledgeExternalIdType = 'pmid' | 'pmcid' | 'doi' | 'prospero' | 'isbn';

export interface KnowledgeExternalId {
    type: KnowledgeExternalIdType;
    value: string;
}

export interface KnowledgeSource {
    id: string;
    title: string;
    sourceType: KnowledgeSourceType;
    citation: string;
    url?: string;
    publishedOn?: string;
    /** Stable publication/registration identifiers such as PMID, DOI or PROSPERO. */
    externalIds?: KnowledgeExternalId[];
    /** Review-level synthesis methods; meta-analysis is a method, not a source-quality tier. */
    synthesisMethods?: KnowledgeSynthesisMethod[];
    notes?: string;
}

export interface KnowledgeEvidenceLink {
    sourceId: string;
    directness: EvidenceDirectness;
    note?: string;
}

export interface KnowledgeApplicability {
    contexts: string[];
    sports: string[];
    populations: string[];
    outcomes: string[];
    horizon: KnowledgeHorizon;
}

export interface KnowledgeClaim {
    id: string;
    statement: string;
    claimType: KnowledgeClaimType;
    maturity: KnowledgeMaturity;
    status: KnowledgeStatus;
    evidenceCertainty: EvidenceCertainty;
    recommendationStrength: RecommendationStrength;
    safetyImpact: KnowledgeSafetyImpact;
    applicability: KnowledgeApplicability;
    evidence: KnowledgeEvidenceLink[];
    limitations: string[];
    reviewedOn: string;
    version: number;
    supersedes?: string;
}

export interface KnowledgeRegistryValidation {
    valid: boolean;
    errors: string[];
    warnings: string[];
}

const WHO_PHYSICAL_ACTIVITY_SOURCE = 'WHO-2020-PHYSICAL-ACTIVITY-GUIDELINES';
const EVERGREEN_PRODUCT_POLICY_SOURCE = 'PRODUCT-EVERGREEN-DOSE-V1';

export const SPORTS_KNOWLEDGE_SOURCES: readonly KnowledgeSource[] = [
    {
        id: WHO_PHYSICAL_ACTIVITY_SOURCE,
        title: 'WHO guidelines on physical activity and sedentary behaviour',
        sourceType: 'guideline',
        citation: 'World Health Organization. WHO guidelines on physical activity and sedentary behaviour. 2020. ISBN 978-92-4-001512-8.',
        url: 'https://www.who.int/publications/i/item/9789240015128',
        publishedOn: '2020-11-25',
        externalIds: [{ type: 'isbn', value: '978-92-4-001512-8' }],
        notes: 'Authoritative public-health guidance; not a sport-performance prescription.',
    },
    {
        id: EVERGREEN_PRODUCT_POLICY_SOURCE,
        title: 'Evergreen dose policy v1',
        sourceType: 'product_policy',
        citation: 'Adaptive Training Recommender product policy: evergreen-dose-v1.',
        notes: 'Explicit product prior. It is not represented as external scientific evidence.',
    },
];

export const KNOWLEDGE_CLAIM_IDS = {
    adultAerobicHealthVolume: 'health.adults.aerobic.weekly_volume',
    adultStrengthHealthFrequency: 'health.adults.strength.weekly_frequency',
    adultStrengthDefaultUpperTarget: 'health.adults.strength.default_upper_target',
    conditionalHighIntensityPrior: 'performance.high_intensity.conditional_weekly_prior',
} as const;

export const SPORTS_KNOWLEDGE_CLAIMS: readonly KnowledgeClaim[] = [
    {
        id: KNOWLEDGE_CLAIM_IDS.adultAerobicHealthVolume,
        statement: 'For adults, 150-300 minutes of moderate-intensity aerobic physical activity per week, or the vigorous-intensity equivalent, is a WHO health-promoting target range.',
        claimType: 'intervention',
        maturity: 'established',
        status: 'active',
        evidenceCertainty: 'moderate',
        recommendationStrength: 'strong',
        safetyImpact: 'low',
        applicability: {
            contexts: ['health', 'balanced_performance'],
            sports: ['general_physical_activity'],
            populations: ['adults_without_sport_specific_performance_requirement'],
            outcomes: ['health_promoting_aerobic_activity_volume'],
            horizon: 'chronic',
        },
        evidence: [{ sourceId: WHO_PHYSICAL_ACTIVITY_SOURCE, directness: 'direct' }],
        limitations: [
            'This is public-health guidance, not evidence that 150-300 minutes is an optimal sport-performance dose.',
            'Individual contraindications, disability, pregnancy and clinical conditions may require contextualized guidance.',
        ],
        reviewedOn: '2026-08-30',
        version: 1,
    },
    {
        id: KNOWLEDGE_CLAIM_IDS.adultStrengthHealthFrequency,
        statement: 'Adults should perform muscle-strengthening activity involving all major muscle groups on two or more days per week for additional health benefits.',
        claimType: 'intervention',
        maturity: 'established',
        status: 'active',
        evidenceCertainty: 'moderate',
        recommendationStrength: 'strong',
        safetyImpact: 'low',
        applicability: {
            contexts: ['health', 'balanced_performance', 'strength_muscle'],
            sports: ['general_physical_activity'],
            populations: ['adults_without_sport_specific_performance_requirement'],
            outcomes: ['health_promoting_strength_frequency'],
            horizon: 'chronic',
        },
        evidence: [{ sourceId: WHO_PHYSICAL_ACTIVITY_SOURCE, directness: 'direct' }],
        limitations: [
            'WHO specifies two or more days; it does not establish the product default of three sessions as a scientific maximum.',
            'This is health guidance, not a hypertrophy-, strength- or sport-specific optimum.',
        ],
        reviewedOn: '2026-08-30',
        version: 1,
    },
    {
        id: KNOWLEDGE_CLAIM_IDS.adultStrengthDefaultUpperTarget,
        statement: 'The Evergreen planner uses three strength sessions per week as a bounded default upper target when allocating a general health or balanced plan.',
        claimType: 'heuristic',
        maturity: 'heuristic',
        status: 'active',
        evidenceCertainty: 'not_applicable',
        recommendationStrength: 'conditional',
        safetyImpact: 'low',
        applicability: {
            contexts: ['health', 'balanced_performance', 'strength_muscle'],
            sports: ['general_physical_activity'],
            populations: ['evergreen_mode_users'],
            outcomes: ['bounded_weekly_strength_allocation'],
            horizon: 'chronic',
        },
        evidence: [{
            sourceId: EVERGREEN_PRODUCT_POLICY_SOURCE,
            directness: 'direct',
            note: 'Product allocation prior, deliberately separated from the WHO >=2 day recommendation.',
        }],
        limitations: [
            'This is a product allocation heuristic, not an evidence-based claim that three sessions is a physiological maximum or optimum.',
        ],
        reviewedOn: '2026-08-30',
        version: 1,
    },
    {
        id: KNOWLEDGE_CLAIM_IDS.conditionalHighIntensityPrior,
        statement: 'For an athlete with sufficient and internally consistent recent training history, Evergreen may allocate one high-intensity session as a target and no more than two in the weekly plan.',
        claimType: 'heuristic',
        maturity: 'heuristic',
        status: 'active',
        evidenceCertainty: 'not_applicable',
        recommendationStrength: 'conditional',
        safetyImpact: 'moderate',
        applicability: {
            contexts: ['endurance', 'speed_power', 'sport_readiness'],
            sports: ['endurance', 'speed_power', 'sport_readiness'],
            populations: ['athletes_with_sufficient_consistent_recent_training_evidence'],
            outcomes: ['bounded_performance_oriented_high_intensity_exposure'],
            horizon: 'chronic',
        },
        evidence: [{ sourceId: EVERGREEN_PRODUCT_POLICY_SOURCE, directness: 'direct' }],
        limitations: [
            'This is a conservative product prior, not a claim that one to two high-intensity sessions is universally optimal.',
            'The prior is withheld when recent training evidence is insufficient, limited or conflicting.',
        ],
        reviewedOn: '2026-08-30',
        version: 1,
    },
];

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const PMID_PATTERN = /^\d+$/;
const PMCID_PATTERN = /^PMC\d+$/i;
const PROSPERO_PATTERN = /^CRD\d+$/i;
const DOI_PATTERN = /^10\.\d{4,9}\/\S+$/i;
const REVIEW_SOURCE_TYPES: readonly KnowledgeSourceType[] = ['systematic_review', 'umbrella_review'];

/** Validate both ISO date shape and Gregorian calendar validity without timezone-dependent parsing. */
function isIsoCalendarDate(value: string): boolean {
    const match = ISO_DATE_PATTERN.exec(value);
    if (!match) return false;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (month < 1 || month > 12 || day < 1) return false;
    const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    return day <= daysInMonth[month - 1];
}

/** Normalize stable external identifiers for duplicate detection without changing display values. */
function normalizedExternalId(identifier: KnowledgeExternalId): string {
    const value = identifier.value.trim();
    const normalizedValue = identifier.type === 'doi'
        ? value.toLowerCase()
        : identifier.type === 'pmcid' || identifier.type === 'prospero'
            ? value.toUpperCase()
            : value;
    return `${identifier.type}:${normalizedValue}`;
}

/** Return a validation error when an external identifier has an invalid format. */
function externalIdFormatError(identifier: KnowledgeExternalId): string | null {
    const value = identifier.value.trim();
    if (!value) return 'value is required';
    if (identifier.type === 'pmid' && !PMID_PATTERN.test(value)) return 'PMID must contain digits only';
    if (identifier.type === 'pmcid' && !PMCID_PATTERN.test(value)) return 'PMCID must use PMC followed by digits';
    if (identifier.type === 'prospero' && !PROSPERO_PATTERN.test(value)) return 'PROSPERO id must use CRD followed by digits';
    if (identifier.type === 'doi' && !DOI_PATTERN.test(value)) return 'DOI must use the 10.xxxx/... form';
    return null;
}

/**
 * Validate referential, lifecycle, source-synthesis, and epistemic invariants for a candidate sports knowledge registry.
 * This deliberately checks structure and category errors; it does not replace scientific peer review.
 */
export function validateSportsKnowledgeRegistry(
    sources: readonly KnowledgeSource[] = SPORTS_KNOWLEDGE_SOURCES,
    claims: readonly KnowledgeClaim[] = SPORTS_KNOWLEDGE_CLAIMS,
): KnowledgeRegistryValidation {
    const errors: string[] = [];
    const warnings: string[] = [];
    const sourceIds = new Set<string>();
    const sourceById = new Map<string, KnowledgeSource>();
    const externalIds = new Set<string>();
    const claimIds = new Set<string>();

    for (const source of sources) {
        if (!ID_PATTERN.test(source.id)) errors.push(`source ${source.id}: id must be stable and machine-safe`);
        if (sourceIds.has(source.id)) errors.push(`duplicate source id: ${source.id}`);
        sourceIds.add(source.id);
        sourceById.set(source.id, source);
        if (!source.title.trim()) errors.push(`source ${source.id}: title is required`);
        if (!source.citation.trim()) errors.push(`source ${source.id}: citation is required`);
        if (source.publishedOn && !isIsoCalendarDate(source.publishedOn)) {
            errors.push(`source ${source.id}: publishedOn must be a valid YYYY-MM-DD calendar date`);
        }

        const sourceSynthesisMethods = new Set<KnowledgeSynthesisMethod>();
        for (const method of source.synthesisMethods ?? []) {
            if (sourceSynthesisMethods.has(method)) errors.push(`source ${source.id}: duplicate synthesis method ${method}`);
            sourceSynthesisMethods.add(method);
        }
        if (sourceSynthesisMethods.size > 0 && !REVIEW_SOURCE_TYPES.includes(source.sourceType)) {
            errors.push(`source ${source.id}: synthesisMethods are reserved for systematic/umbrella reviews`);
        }

        for (const identifier of source.externalIds ?? []) {
            const formatError = externalIdFormatError(identifier);
            if (formatError) errors.push(`source ${source.id}: invalid ${identifier.type} identifier: ${formatError}`);
            const normalized = normalizedExternalId(identifier);
            if (externalIds.has(normalized)) errors.push(`duplicate external source identifier: ${normalized}`);
            externalIds.add(normalized);
        }
    }

    for (const claim of claims) {
        if (!ID_PATTERN.test(claim.id)) errors.push(`claim ${claim.id}: id must be stable and machine-safe`);
        if (claimIds.has(claim.id)) errors.push(`duplicate claim id: ${claim.id}`);
        claimIds.add(claim.id);
    }

    const claimById = new Map(claims.map(claim => [claim.id, claim]));

    for (const claim of claims) {
        if (!claim.statement.trim()) errors.push(`claim ${claim.id}: statement is required`);
        if (!Number.isInteger(claim.version) || claim.version < 1) errors.push(`claim ${claim.id}: version must be a positive integer`);
        if (!isIsoCalendarDate(claim.reviewedOn)) errors.push(`claim ${claim.id}: reviewedOn must be a valid YYYY-MM-DD calendar date`);
        if (claim.evidence.length === 0) errors.push(`claim ${claim.id}: at least one evidence/source link is required`);
        if (claim.supersedes === claim.id) errors.push(`claim ${claim.id}: cannot supersede itself`);
        if (claim.supersedes && !claimIds.has(claim.supersedes)) errors.push(`claim ${claim.id}: supersedes unknown claim ${claim.supersedes}`);

        if (claim.supersedes !== claim.id) {
            const lineage = new Set<string>([claim.id]);
            let predecessor = claim.supersedes;
            while (predecessor) {
                if (lineage.has(predecessor)) {
                    errors.push(`claim ${claim.id}: supersedes chain contains a cycle`);
                    break;
                }
                lineage.add(predecessor);
                predecessor = claimById.get(predecessor)?.supersedes;
            }
        }

        const linkedSources = new Set<string>();
        let hasProductPolicySource = false;
        let hasNonProductPolicySource = false;
        for (const link of claim.evidence) {
            const source = sourceById.get(link.sourceId);
            if (!source) errors.push(`claim ${claim.id}: unknown source ${link.sourceId}`);
            if (linkedSources.has(link.sourceId)) errors.push(`claim ${claim.id}: duplicate source link ${link.sourceId}`);
            linkedSources.add(link.sourceId);
            hasProductPolicySource ||= source?.sourceType === 'product_policy';
            hasNonProductPolicySource ||= source !== undefined && source.sourceType !== 'product_policy';
        }

        if (claim.maturity === 'heuristic' && claim.evidenceCertainty !== 'not_applicable') {
            errors.push(`claim ${claim.id}: heuristic maturity must not masquerade as scientific certainty`);
        }
        if (claim.maturity === 'heuristic' && !hasProductPolicySource) {
            errors.push(`claim ${claim.id}: heuristic maturity requires an explicit product_policy source`);
        }
        if (claim.evidenceCertainty !== 'not_applicable' && !hasNonProductPolicySource) {
            errors.push(`claim ${claim.id}: scientific certainty requires at least one non-product-policy source`);
        }
        if (claim.evidenceCertainty === 'not_applicable' && claim.maturity !== 'heuristic' && claim.maturity !== 'foundational') {
            errors.push(`claim ${claim.id}: not_applicable certainty is reserved for heuristic/foundational claims`);
        }
        if ((claim.status === 'deprecated' || claim.status === 'rejected') && claim.recommendationStrength === 'strong') {
            errors.push(`claim ${claim.id}: deprecated/rejected claims cannot authorize strong recommendations`);
        }
        if (
            claim.safetyImpact === 'high'
            && claim.recommendationStrength === 'strong'
            && (claim.maturity === 'emerging' || claim.maturity === 'heuristic' || ['low', 'very_low', 'not_applicable'].includes(claim.evidenceCertainty))
        ) {
            errors.push(`claim ${claim.id}: high-safety strong policy requires at least supported maturity and moderate certainty`);
        }
        if (claim.status === 'contested') warnings.push(`claim ${claim.id}: contested claim requires explicit consumer opt-in`);
        if (claim.limitations.length === 0) warnings.push(`claim ${claim.id}: no applicability limitations recorded`);
    }

    return { valid: errors.length === 0, errors, warnings };
}

/** Return a registered claim regardless of lifecycle status, or throw for an unknown ID. */
export function getKnowledgeClaim(id: string): KnowledgeClaim {
    const claim = SPORTS_KNOWLEDGE_CLAIMS.find(candidate => candidate.id === id);
    if (!claim) throw new Error(`Unknown sports knowledge claim: ${id}`);
    return claim;
}

/** Return an active claim for production-policy consumption and fail closed for any other status. */
export function getActiveKnowledgeClaim(id: string): KnowledgeClaim {
    const claim = getKnowledgeClaim(id);
    if (claim.status !== 'active') {
        throw new Error(`Sports knowledge claim ${id} is ${claim.status}; active policy cannot consume it implicitly`);
    }
    return claim;
}

/** Return a normalized knowledge source, or throw for an unknown source ID. */
export function getKnowledgeSource(id: string): KnowledgeSource {
    const source = SPORTS_KNOWLEDGE_SOURCES.find(candidate => candidate.id === id);
    if (!source) throw new Error(`Unknown sports knowledge source: ${id}`);
    return source;
}
