import { describe, expect, it } from 'vitest';
import type { CompletedTrainingEvent } from './models';
import type { PerformedExposureFact } from '../derived/training/performedTrainingFacts';
import { compareCanonicalVsLegacyFacts } from './performedTrainingFactsComparison';

function legacyEvent(
    id: string,
    date: string,
    modality: 'Strength' | 'Cycling' | 'Running',
): CompletedTrainingEvent {
    return {
        id,
        date,
        durationMin: 60,
        modality,
        intensity: 'easy',
        evidenceTier: 'durationIntensity',
    } as unknown as CompletedTrainingEvent;
}

function canonicalExposure(
    id: string,
    localDate: string,
    modality: PerformedExposureFact['modality'],
): PerformedExposureFact {
    return {
        performedOccurrenceId: id,
        localDate,
        modality,
        confidence: 'inferred',
        sourceKinds: ['provider_activity'],
        evidenceTier: 'durationIntensity',
    };
}

describe('compareCanonicalVsLegacyFacts', () => {
    it('reports parity when date, modality and multiplicity match', () => {
        const result = compareCanonicalVsLegacyFacts(
            [canonicalExposure('pto-1', '2026-09-01', 'Strength')],
            [legacyEvent('evt-1', '2026-09-01', 'Strength')],
        );

        expect(result.exposureCountDelta).toBe(0);
        expect(result.mismatchCount).toBe(0);
        expect(result.mismatches).toEqual([]);
    });

    it('detects modality drift even when row counts match', () => {
        const result = compareCanonicalVsLegacyFacts(
            [canonicalExposure('pto-1', '2026-09-01', 'Strength')],
            [legacyEvent('evt-1', '2026-09-01', 'Cycling')],
        );

        expect(result.exposureCountDelta).toBe(0);
        expect(result.mismatchCount).toBe(1);
        expect(result.mismatches).toEqual([
            expect.objectContaining({ type: 'modality_mismatch' }),
        ]);
    });

    it('detects date drift even when row counts match', () => {
        const result = compareCanonicalVsLegacyFacts(
            [canonicalExposure('pto-1', '2026-09-02', 'Strength')],
            [legacyEvent('evt-1', '2026-09-01', 'Strength')],
        );

        expect(result.exposureCountDelta).toBe(0);
        expect(result.mismatchCount).toBe(1);
        expect(result.mismatches).toEqual([
            expect.objectContaining({ type: 'date_mismatch' }),
        ]);
    });

    it('is multiset-aware and detects a legacy duplicate split after consuming an exact match', () => {
        const result = compareCanonicalVsLegacyFacts(
            [canonicalExposure('pto-1', '2026-09-01', 'Strength')],
            [
                legacyEvent('evt-1', '2026-09-01', 'Strength'),
                legacyEvent('evt-2', '2026-09-01', 'Strength'),
            ],
        );

        expect(result.exposureCountDelta).toBe(-1);
        expect(result.mismatchCount).toBe(1);
        expect(result.mismatches).toEqual([
            expect.objectContaining({ type: 'legacy_duplicate' }),
        ]);
    });

    it('detects canonical occurrences that have no legacy counterpart', () => {
        const result = compareCanonicalVsLegacyFacts(
            [
                canonicalExposure('pto-1', '2026-09-01', 'Strength'),
                canonicalExposure('pto-2', '2026-09-02', 'Cycling'),
            ],
            [legacyEvent('evt-1', '2026-09-01', 'Strength')],
        );

        expect(result.exposureCountDelta).toBe(1);
        expect(result.mismatchCount).toBe(1);
        expect(result.mismatches).toEqual([
            expect.objectContaining({ type: 'legacy_unmatched' }),
        ]);
    });
});
