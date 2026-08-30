import { describe, expect, it } from 'vitest';
import { evaluateRespirationElevation } from './respirationElevation';
import type { RespirationElevationInput, RespirationElevationPolicy } from './healthAnomalyModels';

function input(overrides: Partial<RespirationElevationInput> = {}): RespirationElevationInput {
    return {
        targetDate: '2026-08-21',
        measurementDate: '2026-08-21',
        timezone: 'Europe/Warsaw',
        currentValue: 14,
        baseline7dValue: 13.5,
        baseline28dValue: 13,
        baselineVersion: 3,
        historyCount: 28,
        recentDayCoverage: 1,
        measurementEligible: true,
        ...overrides,
    };
}

describe('respiration elevation evidence', () => {
    it.each([
        ['E1', 0.75, 0.25],
        ['E2', 1, 0.5],
        ['E3', 1.25, 0.75],
    ] as const)('classifies %s immediately below and at its boundary', (_name, delta28d, delta7d) => {
        const policy: RespirationElevationPolicy = {
            policyVersion: `test-${_name}`,
            minimumBaselineVersion: 3,
            minimumHistoryCount: 14,
            minimumRecentDayCoverage: 4 / 7,
            elevatedDeltaVs28d: delta28d,
            elevatedDeltaVs7d: delta7d,
            strongDeltaVs28d: 2,
            strongDeltaVs7d: 1,
        };
        expect(evaluateRespirationElevation(input({
            currentValue: 13 + delta28d - 0.001,
            baseline7dValue: 13 + delta28d - delta7d,
        }), policy).status).toBe('normal');
        expect(evaluateRespirationElevation(input({
            currentValue: 13 + delta28d,
            baseline7dValue: 13 + delta28d - delta7d,
        }), policy).status).toBe('elevated');
    });

    it('classifies the S1 strong boundary inclusively', () => {
        expect(evaluateRespirationElevation(input({
            currentValue: 15,
            baseline7dValue: 14,
            baseline28dValue: 13,
        })).status).toBe('strongly_elevated');
    });

    it('requires both personal deltas even when the absolute value is high', () => {
        expect(evaluateRespirationElevation(input({
            currentValue: 16,
            baseline7dValue: 15.8,
            baseline28dValue: 15.7,
        }))).toMatchObject({ status: 'normal', reasonCodes: ['BELOW_ELEVATION_BOUNDARY'] });
    });

    it('marks an elevated long-baseline value as resolving when it is no longer above 7d', () => {
        expect(evaluateRespirationElevation(input({
            currentValue: 14,
            baseline7dValue: 14.1,
            baseline28dValue: 12.8,
        }))).toMatchObject({ status: 'resolving', reasonCodes: ['RECENT_DELTA_NON_POSITIVE'] });
    });

    it('never treats lower respiration as adverse evidence', () => {
        expect(evaluateRespirationElevation(input({
            currentValue: 12,
            baseline7dValue: 13,
            baseline28dValue: 13.5,
        })).status).toBe('normal');
    });

    it.each([
        [{ currentValue: null }, 'MISSING_CURRENT'],
        [{ currentValue: Number.NaN }, 'INVALID_CURRENT'],
        [{ currentValue: 40 }, 'INVALID_CURRENT'],
        [{ measurementDate: '2026-08-20' }, 'DATE_PROVENANCE_MISMATCH'],
        [{ baselineVersion: 2 }, 'INCOMPATIBLE_BASELINE_VERSION'],
        [{ historyCount: 13 }, 'INSUFFICIENT_HISTORY'],
        [{ recentDayCoverage: 0.5 }, 'INSUFFICIENT_RECENT_COVERAGE'],
        [{ baseline7dValue: null }, 'MISSING_7D_BASELINE'],
        [{ baseline7dValue: 0 }, 'MISSING_7D_BASELINE'],
        [{ baseline7dValue: -1 }, 'MISSING_7D_BASELINE'],
        [{ baseline28dValue: null }, 'MISSING_28D_BASELINE'],
        [{ baseline28dValue: 100 }, 'MISSING_28D_BASELINE'],
        [{ measurementEligible: false }, 'MEASUREMENT_INELIGIBLE'],
    ] as const)('fails closed for %o', (overrides, reason) => {
        const evidence = evaluateRespirationElevation(input(overrides));
        expect(evidence).toMatchObject({
            status: 'unavailable',
            reasonCodes: expect.arrayContaining([reason]),
        });
        if ('baseline7dValue' in overrides) {
            expect(evidence.baseline7dValue).toBeNull();
        }
        if ('baseline28dValue' in overrides) {
            expect(evidence.baseline28dValue).toBeNull();
        }
    });
});
