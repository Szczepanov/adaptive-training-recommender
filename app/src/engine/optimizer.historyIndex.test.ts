import { describe, expect, it } from 'vitest';
import { buildHistoryFeatureSummary } from './optimizer';
import type { SessionHistoryEntry } from './models';

function historyEntry(date: string, overrides: Partial<SessionHistoryEntry> = {}): SessionHistoryEntry {
    return {
        date,
        modality: 'Cycling',
        category: 'Moderate Endurance',
        systemicCost: 0.5,
        lowerBodyCost: 0.3,
        ...overrides,
    };
}

describe('buildHistoryFeatureSummary date index', () => {
    it('preserves the summary when distinct history dates are unsorted', () => {
        const sorted = [
            historyEntry('2026-08-07', { systemicCost: 0.8 }),
            historyEntry('2026-08-08', { systemicCost: 0.3 }),
            historyEntry('2026-08-09', { systemicCost: 0.8 }),
        ];
        const unsorted = [sorted[2], sorted[0], sorted[1]];

        expect(buildHistoryFeatureSummary(unsorted, '2026-08-10')).toEqual(
            buildHistoryFeatureSummary(sorted, '2026-08-10'),
        );
    });

    it('keeps the first entry for a duplicate date, matching find semantics', () => {
        const summary = buildHistoryFeatureSummary([
            historyEntry('2026-08-09', { category: 'Rest', systemicCost: 0 }),
            historyEntry('2026-08-09', { category: 'Hard Endurance', systemicCost: 0.9 }),
        ], '2026-08-10');

        expect(summary.consecutiveHardStreak).toBe(0);
    });
});
