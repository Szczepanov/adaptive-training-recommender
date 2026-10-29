import type { Modality } from '../ledger/models';
import type { CompletedTrainingEvent } from './models';
import { normalizeModality, type PerformedExposureFact } from '../derived/training/performedTrainingFacts';

export interface FactsComparisonResult {
    canonicalExposureCount: number;
    legacyExposureCount: number;
    exposureCountDelta: number;
    mismatchCount: number;
    mismatches: Array<{
        type: 'canonical_linked' | 'legacy_duplicate' | 'modality_mismatch' | 'date_mismatch' | 'legacy_unmatched';
        detail: string;
    }>;
}

interface ComparableExposure {
    date: string;
    modality: Modality | 'Unknown';
}

function consumeFirstMatch<T>(items: T[], predicate: (item: T) => boolean): T | undefined {
    const index = items.findIndex(predicate);
    if (index < 0) return undefined;
    const [matched] = items.splice(index, 1);
    return matched;
}

/**
 * Diagnostic helper comparing canonical facts vs legacy completed training events.
 * Matching is multiset-aware: exact date+modality matches are consumed first, then
 * equal-date and equal-modality leftovers are classified so equal row counts cannot
 * hide semantic or date drift. Remaining rows expose split/unmatched-path differences.
 */
export function compareCanonicalVsLegacyFacts(
    canonicalExposures: readonly PerformedExposureFact[],
    legacyEvents: readonly CompletedTrainingEvent[],
): FactsComparisonResult {
    const mismatches: FactsComparisonResult['mismatches'] = [];
    const unmatchedLegacy: ComparableExposure[] = legacyEvents.map(event => ({
        date: event.date,
        modality: normalizeModality(event.modality),
    }));
    const unmatchedCanonical: ComparableExposure[] = [];

    for (const exposure of canonicalExposures) {
        const canonical = { date: exposure.localDate, modality: exposure.modality };
        const exact = consumeFirstMatch(
            unmatchedLegacy,
            legacy => legacy.date === canonical.date && legacy.modality === canonical.modality,
        );
        if (!exact) unmatchedCanonical.push(canonical);
    }

    let modalityMismatchCount = 0;
    for (let index = unmatchedCanonical.length - 1; index >= 0; index -= 1) {
        const canonical = unmatchedCanonical[index];
        const sameDate = consumeFirstMatch(unmatchedLegacy, legacy => legacy.date === canonical.date);
        if (sameDate) {
            modalityMismatchCount += 1;
            unmatchedCanonical.splice(index, 1);
        }
    }
    if (modalityMismatchCount > 0) {
        mismatches.push({
            type: 'modality_mismatch',
            detail: `${modalityMismatchCount} canonical/legacy event pair(s) share a local date but disagree on modality.`,
        });
    }

    let dateMismatchCount = 0;
    for (let index = unmatchedCanonical.length - 1; index >= 0; index -= 1) {
        const canonical = unmatchedCanonical[index];
        const sameModality = consumeFirstMatch(unmatchedLegacy, legacy => legacy.modality === canonical.modality);
        if (sameModality) {
            dateMismatchCount += 1;
            unmatchedCanonical.splice(index, 1);
        }
    }
    if (dateMismatchCount > 0) {
        mismatches.push({
            type: 'date_mismatch',
            detail: `${dateMismatchCount} canonical/legacy event pair(s) share a modality but disagree on local date.`,
        });
    }

    const legacyExtraCount = unmatchedLegacy.length;
    if (legacyExtraCount > 0) {
        mismatches.push({
            type: 'legacy_duplicate',
            detail: `${legacyExtraCount} legacy event(s) remain without a canonical counterpart (potential legacy split/duplicate).`,
        });
    }

    const canonicalExtraCount = unmatchedCanonical.length;
    if (canonicalExtraCount > 0) {
        mismatches.push({
            type: 'legacy_unmatched',
            detail: `${canonicalExtraCount} canonical occurrence(s) remain without a legacy counterpart.`,
        });
    }

    return {
        canonicalExposureCount: canonicalExposures.length,
        legacyExposureCount: legacyEvents.length,
        exposureCountDelta: canonicalExposures.length - legacyEvents.length,
        mismatchCount: modalityMismatchCount + dateMismatchCount + legacyExtraCount + canonicalExtraCount,
        mismatches,
    };
}
