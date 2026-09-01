import {
    KNOWLEDGE_CLAIM_IDS as CORE_KNOWLEDGE_CLAIM_IDS,
    SPORTS_KNOWLEDGE_CLAIMS as CORE_SPORTS_KNOWLEDGE_CLAIMS,
    SPORTS_KNOWLEDGE_SOURCES as CORE_SPORTS_KNOWLEDGE_SOURCES,
    validateSportsKnowledgeRegistry,
    type KnowledgeClaim,
    type KnowledgeRegistryValidation,
    type KnowledgeSource,
} from './sportsKnowledge.ts';
import {
    READINESS_CARDIORESPIRATORY_CLAIM_IDS,
    READINESS_CARDIORESPIRATORY_CLAIMS,
    READINESS_CARDIORESPIRATORY_SOURCES,
} from './readinessCardiorespiratoryKnowledge.ts';
import {
    STRENGTH_CONCURRENT_CLAIM_IDS,
    STRENGTH_CONCURRENT_CLAIMS,
    STRENGTH_CONCURRENT_SOURCES,
} from './strengthConcurrentKnowledge.ts';
import {
    TAPER_FUELING_CLAIM_IDS,
    TAPER_FUELING_CLAIMS,
    TAPER_FUELING_SOURCES,
} from './taperFuelingKnowledge.ts';
import {
    SUBJECTIVE_READINESS_CLAIM_IDS,
    SUBJECTIVE_READINESS_CLAIMS,
    SUBJECTIVE_READINESS_SOURCES,
} from './subjectiveReadinessKnowledge.ts';
import {
    INJURY_PAIN_CLAIM_IDS,
    INJURY_PAIN_CLAIMS,
    INJURY_PAIN_SOURCES,
} from './injuryPainKnowledge.ts';

/**
 * Canonical aggregate registry.
 *
 * Domain-specific knowledge can live in focused Git-backed modules while this surface keeps
 * source/claim identity, validation and production lookup global. `sportsKnowledge.ts`
 * remains the original core registry; consumers that need the complete registry should use
 * this module so cross-module duplicate identifiers are still validated together.
 */
export const SPORTS_KNOWLEDGE_SOURCES: readonly KnowledgeSource[] = [
    ...CORE_SPORTS_KNOWLEDGE_SOURCES,
    ...READINESS_CARDIORESPIRATORY_SOURCES,
    ...STRENGTH_CONCURRENT_SOURCES,
    ...TAPER_FUELING_SOURCES,
    ...SUBJECTIVE_READINESS_SOURCES,
    ...INJURY_PAIN_SOURCES,
];

export const SPORTS_KNOWLEDGE_CLAIMS: readonly KnowledgeClaim[] = [
    ...CORE_SPORTS_KNOWLEDGE_CLAIMS,
    ...READINESS_CARDIORESPIRATORY_CLAIMS,
    ...STRENGTH_CONCURRENT_CLAIMS,
    ...TAPER_FUELING_CLAIMS,
    ...SUBJECTIVE_READINESS_CLAIMS,
    ...INJURY_PAIN_CLAIMS,
];

export const KNOWLEDGE_CLAIM_IDS = {
    ...CORE_KNOWLEDGE_CLAIM_IDS,
    ...READINESS_CARDIORESPIRATORY_CLAIM_IDS,
    ...STRENGTH_CONCURRENT_CLAIM_IDS,
    ...TAPER_FUELING_CLAIM_IDS,
    ...SUBJECTIVE_READINESS_CLAIM_IDS,
    ...INJURY_PAIN_CLAIM_IDS,
} as const;

export const SPORTS_KNOWLEDGE_SOURCES_BY_ID: ReadonlyMap<string, KnowledgeSource> = new Map(
    SPORTS_KNOWLEDGE_SOURCES.map(source => [source.id, source])
);

export const SPORTS_KNOWLEDGE_CLAIMS_BY_ID: ReadonlyMap<string, KnowledgeClaim> = new Map(
    SPORTS_KNOWLEDGE_CLAIMS.map(claim => [claim.id, claim])
);

/** Validate the complete cross-domain registry, including duplicate identifiers and lineage. */
export function validateCanonicalSportsKnowledgeRegistry(): KnowledgeRegistryValidation {
    return validateSportsKnowledgeRegistry(SPORTS_KNOWLEDGE_SOURCES, SPORTS_KNOWLEDGE_CLAIMS);
}

/** Resolve a claim from the canonical registry or fail closed for an unknown identifier. */
export function getKnowledgeClaim(id: string): KnowledgeClaim {
    const claim = SPORTS_KNOWLEDGE_CLAIMS_BY_ID.get(id);
    if (!claim) throw new Error(`Unknown sports knowledge claim: ${id}`);
    return claim;
}

/** Resolve only active claims so decision policy cannot silently consume retired knowledge. */
export function getActiveKnowledgeClaim(id: string): KnowledgeClaim {
    const claim = getKnowledgeClaim(id);
    if (claim.status !== 'active') {
        throw new Error(`Sports knowledge claim ${id} is ${claim.status}; active policy cannot consume it implicitly`);
    }
    return claim;
}

/** Resolve a source from the canonical cross-domain registry. */
export function getKnowledgeSource(id: string): KnowledgeSource {
    const source = SPORTS_KNOWLEDGE_SOURCES_BY_ID.get(id);
    if (!source) throw new Error(`Unknown sports knowledge source: ${id}`);
    return source;
}
