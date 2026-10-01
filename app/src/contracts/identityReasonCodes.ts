/**
 * Neutral identity-reason-code contract shared by observation attribution and persistence
 * validation. Kept outside observations/ so production recommendation selection can validate
 * persisted provenance without depending on evidence-only observation modules (OV1.4).
 */
export const IDENTITY_REASON_CODE_SCHEMA_VERSION = 'identity-reason-codes-v1';

export const IDENTITY_REASON_CODES = [
    'ANCHOR_MISSING',
    'ANCHOR_QUALITY_INSUFFICIENT',
    'EVIDENCE_LINEAGE_DEPENDENT',
    'INSUFFICIENT_PASSPORT_HISTORY',
    'MULTIPLE_PAIRING_CANDIDATES',
    'SESSION_TIMING_CONCORDANT',
    'SESSION_TIMING_DISCORDANT',
    'RHR_RELATION_CONCORDANT',
    'RHR_RELATION_DISCORDANT',
    'RESPIRATION_RELATION_CONCORDANT',
    'RESPIRATION_RELATION_DISCORDANT',
    'HRV_RELATION_CONCORDANT',
    'HRV_RELATION_DISCORDANT',
    'MIXED_OCCUPANCY_SUSPECTED',
    'SESSION_INTERVAL_INVALID',
] as const;

export type IdentityReasonCode = typeof IDENTITY_REASON_CODES[number];

export function isKnownIdentityReasonCode(code: string): code is IdentityReasonCode {
    return (IDENTITY_REASON_CODES as readonly string[]).includes(code);
}
