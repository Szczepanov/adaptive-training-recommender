import { describe, expect, it } from 'vitest';
import { computeProviderCompositionSummary } from './trends';

const CURRENT_7D = [
    '2026-08-09',
    '2026-08-10',
    '2026-08-11',
    '2026-08-12',
    '2026-08-13',
    '2026-08-14',
    '2026-08-15',
] as const;

describe('computeProviderCompositionSummary distinct-date coverage', () => {
    it('counts a provider measurement date once when the same scale reading is echoed by several snapshots', () => {
        const result = computeProviderCompositionSummary([
            { date: '2026-08-15', bodyFatPct: 15.2 },
            { date: '2026-08-15', bodyFatPct: 15.2 },
            { date: '2026-08-15', bodyFatPct: 15.2 },
            { date: '2026-08-15', bodyFatPct: 15.2 },
        ], CURRENT_7D);

        expect(result).toEqual({
            latestBodyFatPct: 15.2,
            latestDate: '2026-08-15',
            mean7d: null,
            recordedDays7d: 1,
        });
    });

    it('qualifies the 7-day mean only from four distinct provider measurement dates', () => {
        const result = computeProviderCompositionSummary([
            { date: '2026-08-09', bodyFatPct: 15.8 },
            { date: '2026-08-11', bodyFatPct: 15.6 },
            { date: '2026-08-13', bodyFatPct: 15.4 },
            { date: '2026-08-15', bodyFatPct: 15.2 },
            // A duplicate snapshot echo must not change coverage or the mean.
            { date: '2026-08-15', bodyFatPct: 15.2 },
        ], CURRENT_7D);

        expect(result.recordedDays7d).toBe(4);
        expect(result.mean7d).toBe(15.5);
        expect(result.latestDate).toBe('2026-08-15');
        expect(result.latestBodyFatPct).toBe(15.2);
    });
});
