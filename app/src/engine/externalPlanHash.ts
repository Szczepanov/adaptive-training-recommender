import type { ExternalTrainingPlan } from './models';

/** Stable ordering so the same document always hashes the same. `JSON.stringify` preserves
 * insertion order, which differs between a freshly-parsed import and a Firestore read. */
export function canonicalise(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonicalise);
    if (value && typeof value === 'object') {
        return Object.fromEntries(
            Object.keys(value as Record<string, unknown>)
                .sort()
                .map(key => [key, canonicalise((value as Record<string, unknown>)[key])]),
        );
    }
    return value;
}

/**
 * SHA-256 over the canonical JSON of a revision (ADR-0019 D-IMMUT). Persisted on the plan
 * header and on the decision audit, so a replay can prove which bytes it read.
 *
 * Lives in `engine/` rather than beside the Firestore service because `replay.ts` verifies
 * against it and must stay free of I/O — a decision has to be checkable from persisted
 * inputs alone, with no database in the loop.
 */
export async function computeContentHash(plan: ExternalTrainingPlan): Promise<string> {
    const canonical = JSON.stringify(canonicalise(plan));
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
    return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, '0')).join('');
}
