import type { AssessmentTrial, MetricObservationRevision } from './models';

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

/** Canonical JSON of an immutable evidence record, excluding `createdAt` write provenance. */
function canonicalSemanticJson(record: object): string {
    const semantic = Object.fromEntries(
        Object.entries(record).filter(([key]) => key !== 'createdAt'),
    );
    return JSON.stringify(canonicalize(semantic));
}

/**
 * Canonical semantic payload for an immutable observation revision. `createdAt` is write
 * provenance, not measured content, and therefore must not make an offline/double-tap retry
 * conflict with the revision that already landed. Revision-chain metadata is retained because
 * it changes the meaning of corrections.
 */
export function canonicalObservationRevisionJson(revision: MetricObservationRevision): string {
    return canonicalSemanticJson(revision);
}

export function sameCanonicalObservationRevision(
    a: MetricObservationRevision,
    b: MetricObservationRevision,
): boolean {
    return canonicalObservationRevisionJson(a) === canonicalObservationRevisionJson(b);
}

/** Same retry semantics for immutable raw assessment trials (ADR-0046 D-AT-TRIAL). */
export function sameCanonicalAssessmentTrial(a: AssessmentTrial, b: AssessmentTrial): boolean {
    return canonicalSemanticJson(a) === canonicalSemanticJson(b);
}
