/**
 * Stable, normalized source identity for `PerformedOccurrenceSourceLink` documents
 * (ADR-0034 "Source identity"). A source key is never interpolated into a Firestore path
 * unescaped -- `encodeSourceKeyForDocId` produces the actual doc ID.
 */
import type { PerformedOccurrenceSourceRef } from './models';

export function structuredExecutionSourceKey(executionId: string): string {
    return `structured_execution:${executionId}`;
}

export function providerActivitySourceKey(provider: string, activityId: string): string {
    // Provider labels are identifiers, not display text. Normalizing case/outer
    // whitespace prevents `Garmin:123` and `garmin:123` from claiming two different
    // canonical source-link documents for the same physical provider record.
    const normalizedProvider = provider.trim().toLowerCase();
    return `provider_activity:${normalizedProvider}:${activityId}`;
}

export function sourceKeyForRef(sourceRef: PerformedOccurrenceSourceRef): string {
    return sourceRef.kind === 'structured_execution'
        ? structuredExecutionSourceKey(sourceRef.executionId)
        : providerActivitySourceKey(sourceRef.provider, sourceRef.activityId);
}

/** A Firestore document ID may not contain "/", may not be exactly "." or "..", and has a
 * 1500-byte limit. `encodeURIComponent` already escapes "/"; additionally escape "%" and
 * "." (both left untouched by `encodeURIComponent`) so an activity ID containing a
 * literal ".." or a stray "%" from a provider cannot produce a colliding or invalid doc
 * ID. Falls back to a stable hash when the encoded form is unexpectedly long -- never
 * silently truncates, which could collide two different source keys onto one doc ID. */
export function encodeSourceKeyForDocId(sourceKey: string): string {
    const encoded = encodeURIComponent(sourceKey).replace(/[.%]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
    if (encoded.length <= 400 && encoded !== '.' && encoded !== '..') return encoded;
    return `h-${stableHash(sourceKey)}`;
}

/** Small deterministic non-cryptographic hash (FNV-1a, 32-bit, doubled for a wider
 * keyspace) -- collision-avoidance for an unusually long/malformed source key, not a
 * security boundary. Firestore document IDs never need cryptographic hashing here. */
function stableHash(input: string): string {
    const fnv32 = (seed: number): string => {
        let hash = seed >>> 0;
        for (let index = 0; index < input.length; index += 1) {
            hash ^= input.charCodeAt(index);
            hash = Math.imul(hash, 0x01000193) >>> 0;
        }
        return hash.toString(16).padStart(8, '0');
    };
    return `${fnv32(0x811c9dc5)}${fnv32(0x1b873593)}`;
}
