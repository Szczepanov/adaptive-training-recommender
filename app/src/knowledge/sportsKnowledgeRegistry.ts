import {
    KNOWLEDGE_CLAIM_IDS as CORE_KNOWLEDGE_CLAIM_IDS,
    SPORTS_KNOWLEDGE_CLAIMS as CORE_SPORTS_KNOWLEDGE_CLAIMS,
    SPORTS_KNOWLEDGE_SOURCES as CORE_SPORTS_KNOWLEDGE_SOURCES,
    validateSportsKnowledgeRegistry,
    type KnowledgeClaim,
    type KnowledgeRegistryValidation,
    type KnowledgeSource,
} from './sportsKnowledge';
import {
    READINESS_CARDIORESPIRATORY_CLAIM_IDS,
    READINESS_CARDIORESPIRATORY_CLAIMS,
    READINESS_CARDIORESPIRATORY_SOURCES,
} from './readinessCardiorespiratoryKnowledge';

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
];

export const SPORTS_KNOWLEDGE_CLAIMS: readonly KnowledgeClaim[] = [
    ...CORE_SPORTS_KNOWLEDGE_CLAIMS,
    ...READINESS_CARDIORESPIRATORY_CLAIMS,
];

export const KNOWLEDGE_CLAIM_IDS = {
    ...CORE_KNOWLEDGE_CLAIM_IDS,
    ...READINESS_CARDIORESPIRATORY_CLAIM_IDS,
} as const;

export function validateCanonicalSportsKnowledgeRegistry(): KnowledgeRegistryValidation {
    return validateSportsKnowledgeRegistry(SPORTS_KNOWLEDGE_SOURCES, SPORTS_KNOWLEDGE_CLAIMS);
}

export function getKnowledgeClaim(id: string): KnowledgeClaim {
    const claim = SPORTS_KNOWLEDGE_CLAIMS.find(candidate => candidate.id === id);
    if (!claim) throw new Error(`Unknown sports knowledge claim: ${id}`);
    return claim;
}

export function getActiveKnowledgeClaim(id: string): KnowledgeClaim {
    const claim = getKnowledgeClaim(id);
    if (claim.status !== 'active') {
        throw new Error(`Sports knowledge claim ${id} is ${claim.status}; active policy cannot consume it implicitly`);
    }
    return claim;
}

export function getKnowledgeSource(id: string): KnowledgeSource {
    const source = SPORTS_KNOWLEDGE_SOURCES.find(candidate => candidate.id === id);
    if (!source) throw new Error(`Unknown sports knowledge source: ${id}`);
    return source;
}
