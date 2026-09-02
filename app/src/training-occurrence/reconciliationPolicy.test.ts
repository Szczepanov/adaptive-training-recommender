import { describe, expect, it } from 'vitest';
import type { PerformedTrainingOccurrence } from './models';
import type { ReconciliationFeatures, ReconciliationScore } from './reconciliationScore';
import { AMBIGUOUS_CONFIDENCE, AUTO_LINK_CONFIDENCE, decideReconciliation, type ScoredCandidate } from './reconciliationPolicy';

function occurrence(id: string): PerformedTrainingOccurrence {
    return {
        schemaVersion: 1,
        performedOccurrenceId: id,
        userId: 'user-1',
        status: 'active',
        sourceRefs: [{ kind: 'structured_execution', executionId: `exec-${id}` }],
        reconciliation: { state: 'single_source' },
        createdAt: '2026-08-26T06:00:00.000Z',
        updatedAt: '2026-08-26T06:00:00.000Z',
    };
}

function features(overrides: Partial<ReconciliationFeatures> = {}): ReconciliationFeatures {
    return {
        explicitCorrelation: false,
        hasAbsoluteTimestamps: true,
        overlapSeconds: 600,
        startGapSeconds: 0,
        durationDiffMin: 2,
        modalityCompatible: true,
        sameLocalDate: true,
        ...overrides,
    };
}

function candidate(id: string, confidence: number, featureOverrides: Partial<ReconciliationFeatures> = {}): ScoredCandidate {
    const score: ReconciliationScore = { confidence, features: features(featureOverrides) };
    return { occurrence: occurrence(id), score };
}

describe('decideReconciliation', () => {
    it('auto-links a single strong candidate above the threshold with absolute-timestamp evidence', () => {
        const decision = decideReconciliation([candidate('a', AUTO_LINK_CONFIDENCE + 0.1)]);

        expect(decision.outcome).toBe('auto_link');
        if (decision.outcome === 'auto_link') expect(decision.candidate.occurrence.performedOccurrenceId).toBe('a');
    });

    it('never auto-links on date-only evidence, even at a high score', () => {
        const decision = decideReconciliation([
            candidate('a', 0.99, { hasAbsoluteTimestamps: false, explicitCorrelation: false }),
        ]);

        expect(decision.outcome).toBe('ambiguous');
    });

    it('marks ambiguous when a competing candidate also clears the ambiguous threshold', () => {
        const decision = decideReconciliation([
            candidate('a', AUTO_LINK_CONFIDENCE + 0.1),
            candidate('b', AMBIGUOUS_CONFIDENCE + 0.05),
        ]);

        expect(decision.outcome).toBe('ambiguous');
        if (decision.outcome === 'ambiguous') expect(decision.candidates.map(c => c.occurrence.performedOccurrenceId).sort()).toEqual(['a', 'b']);
    });

    it('returns no_match when nothing clears the ambiguous threshold', () => {
        const decision = decideReconciliation([candidate('a', AMBIGUOUS_CONFIDENCE - 0.1)]);

        expect(decision.outcome).toBe('no_match');
    });

    it('marks ambiguous (not auto-link) in the medium-confidence band below the auto-link threshold', () => {
        const decision = decideReconciliation([candidate('a', (AMBIGUOUS_CONFIDENCE + AUTO_LINK_CONFIDENCE) / 2)]);

        expect(decision.outcome).toBe('ambiguous');
    });

    it('auto-links on explicit correlation alone even without absolute timestamps', () => {
        const decision = decideReconciliation([
            candidate('a', 1, { explicitCorrelation: true, hasAbsoluteTimestamps: false }),
        ]);

        expect(decision.outcome).toBe('auto_link');
    });
});
