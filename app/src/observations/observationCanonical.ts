import type { MetricObservationRevision } from './models';

function canonicalize(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (value && typeof value === 'object') {
        const record = value as Record<string, unknown>;
        return Object.fromEntries(
            Object.keys(record)
                .filter(key => record[key] !== undefined)
                .sort()
                .map(key => [key, canonicalize(record[key])]),
        );
    }
    return value;
}

/**
 * Canonical semantic payload for an immutable observation revision. `createdAt` is write
 * provenance, not measured content, and therefore must not make an offline/double-tap retry
 * conflict with the revision that already landed. Revision-chain metadata is retained because
 * it changes the meaning of corrections.
 */
export function canonicalObservationRevisionJson(revision: MetricObservationRevision): string {
    const semantic = Object.fromEntries(
        Object.entries(revision).filter(([key]) => key !== 'createdAt'),
    );
    return JSON.stringify(canonicalize(semantic));
}

export function sameCanonicalObservationRevision(
    a: MetricObservationRevision,
    b: MetricObservationRevision,
): boolean {
    return canonicalObservationRevisionJson(a) === canonicalObservationRevisionJson(b);
}
