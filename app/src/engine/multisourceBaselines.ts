/**
 * Source-specific baseline calculator (MS12/ADR-0024/ADR-0027).
 *
 * Computes robust 7d/28d medians and MAD (Median Absolute Deviation) within a single
 * source/provider boundary to prevent device discontinuities from distorting baselines.
 * Evaluates baseline maturity state machines to ensure secondary sensors do not affect
 * confidence before reaching adequate maturity.
 *
 * KNOWN GAP (PI0/PI5, ADR-0028): `computeSourceMetricBaseline()` currently consumes all source
 * bundles for a provider/transport regardless of identity attribution -- the co-presence check
 * in multisourceFusion.ts runs later, downstream of this calculator. This is the "current defect"
 * PI5 (Pre-baseline effective-eligibility gate) fixes by requiring effective identity eligibility
 * metadata as an input here. Do not treat the current behavior as identity-safe.
 */

import type { BaselineMaturity, HealthObservationDayBundle } from '../observations/models';

export interface SourceMetricBaseline {
    metric: string;
    provider: string;
    transport: string;
    count7d: number;
    count28d: number;
    median7d: number | null;
    median28d: number | null;
    mad28d: number | null; // scaled MAD (~ stdev)
    maturity: BaselineMaturity;
    latestObservedDate: string | null;
}

export function calculateMedian(values: readonly number[]): number | null {
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 1) {
        return sorted[mid];
    }
    return (sorted[mid - 1] + sorted[mid]) / 2;
}

export function calculateMad(values: readonly number[], median: number | null): number | null {
    if (values.length === 0 || median === null) return null;
    const absDevs = values.map((v) => Math.abs(v - median));
    const rawMad = calculateMedian(absDevs);
    if (rawMad === null) return null;
    // Scale normal consistency factor ~ 1.4826
    return rawMad * 1.4826;
}

export function evaluateBaselineMaturity(
    count28d: number,
    latestObservedDate: string | null,
    referenceDate: string,
): BaselineMaturity {
    if (!latestObservedDate) {
        return 'INSUFFICIENT_HISTORY';
    }

    const refTime = new Date(referenceDate).getTime();
    const latestTime = new Date(latestObservedDate).getTime();
    const daysSinceLatest = Math.floor((refTime - latestTime) / (1000 * 60 * 60 * 24));

    if (daysSinceLatest > 3) {
        return 'STALE';
    }
    if (count28d < 14) {
        return 'INSUFFICIENT_HISTORY';
    }
    if (count28d < 28) {
        return 'PROVISIONAL';
    }
    return 'MATURE';
}

export function computeSourceMetricBaseline(
    bundles: readonly HealthObservationDayBundle[],
    metric: string,
    provider: string,
    transport: string,
    referenceDate: string,
): SourceMetricBaseline {
    const relevantBundles = bundles.filter(
        (b) => b.provider === provider && b.transport === transport,
    );

    // Extract numeric values mapped by logical date
    const dateValues: { date: string; value: number }[] = [];
    for (const bundle of relevantBundles) {
        for (const obs of bundle.observations) {
            if (obs.metric === metric && typeof obs.value === 'number') {
                dateValues.push({ date: bundle.logicalDate, value: obs.value });
                break; // 1 observation per metric per day bundle
            }
        }
    }

    dateValues.sort((a, b) => a.date.localeCompare(b.date));

    const refTime = new Date(referenceDate).getTime();
    const window28Values: number[] = [];
    const window7Values: number[] = [];
    let latestDate: string | null = null;

    for (const item of dateValues) {
        const itemTime = new Date(item.date).getTime();
        const diffDays = Math.floor((refTime - itemTime) / (1000 * 60 * 60 * 24));
        if (diffDays >= 0 && diffDays < 28) {
            window28Values.push(item.value);
            if (diffDays < 7) {
                window7Values.push(item.value);
            }
            if (!latestDate || item.date > latestDate) {
                latestDate = item.date;
            }
        }
    }

    const median7d = calculateMedian(window7Values);
    const median28d = calculateMedian(window28Values);
    const mad28d = calculateMad(window28Values, median28d);
    const maturity = evaluateBaselineMaturity(window28Values.length, latestDate, referenceDate);

    return {
        metric,
        provider,
        transport,
        count7d: window7Values.length,
        count28d: window28Values.length,
        median7d,
        median28d,
        mad28d,
        maturity,
        latestObservedDate: latestDate,
    };
}
