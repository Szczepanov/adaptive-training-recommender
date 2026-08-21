import type { ReliabilityEstimate } from './models';

/**
 * Reliability metadata is evidence provenance, not a probability model. Keep the source and
 * statistic explicit so later progress policy never has to infer what a bare number meant.
 */
export function assertValidReliabilityEstimate(estimate: ReliabilityEstimate): void {
    if (!Number.isFinite(estimate.value) || estimate.value < 0) {
        throw new Error('Reliability estimate value must be a finite non-negative number');
    }
    if (estimate.reference !== undefined && estimate.reference.trim().length === 0) {
        throw new Error('Reliability reference must be non-empty when provided');
    }
    if (estimate.contextNote !== undefined && estimate.contextNote.trim().length === 0) {
        throw new Error('Reliability context note must be non-empty when provided');
    }
}

export function reliabilityEvidenceLabel(estimate: ReliabilityEstimate): 'reference_level' | 'personal' | 'manual' {
    if (estimate.source === 'literature_reference') return 'reference_level';
    if (estimate.source === 'personal_repeatability') return 'personal';
    return 'manual';
}
