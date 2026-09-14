/**
 * Repeatability, tolerance, and median summarization rules for home_anthropometry@1.
 *
 * Owned by ADR-0039 D-BC-PROTOCOL.
 */

import type {
    AnthropometryMeasurementItem,
    AnthropometryMetricId,
    Laterality,
} from './models';
import { LIMB_METRIC_IDS } from './models';
import { getLocalDateString } from '../utils/localDate';

/**
 * Initial circumference quality tolerance: max(1.0 cm, 1% of the pair mean).
 * Product-quality technique heuristic; not a physiological threshold.
 */
export function calculateCircumferenceTolerance(r1: number, r2: number): number {
    const mean = (r1 + r2) / 2;
    return Math.max(1.0, mean * 0.01);
}

/**
 * Returns true if the difference between two circumference readings exceeds the quality tolerance.
 */
export function exceedsCircumferenceTolerance(r1: number, r2: number): boolean {
    const tolerance = calculateCircumferenceTolerance(r1, r2);
    // Use an epsilon of 1e-6 to avoid floating-point representation artifacts.
    return Math.abs(r1 - r2) - tolerance > 1e-6;
}

/**
 * Deterministic median of 1 to 3 numeric readings.
 */
export function calculateMedian(readings: readonly number[]): number {
    if (readings.length === 0) {
        throw new Error('Cannot compute median of empty readings list');
    }
    const sorted = [...readings].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 1) {
        return sorted[mid];
    }
    return (sorted[mid - 1] + sorted[mid]) / 2;
}

export function roundTo1Decimal(val: number): number {
    return Math.round(val * 10) / 10;
}

export function roundTo2Decimals(val: number): number {
    return Math.round(val * 100) / 100;
}

/**
 * Derives an ISO 8601 UTC `observedAt` instant that resolves to the given Europe/Warsaw
 * logical `date` -- required because `validateAnthropometryEntry` rejects an entry whose
 * `observedAt` disagrees with its logical date (D-BC persistence invariant, mirroring I2).
 *
 * When `date` is today's Warsaw date, the real current instant is used so same-day entries
 * retain a genuine observation time and their natural same-day ordering. For a backdated (or
 * otherwise non-today) date -- the modal's date picker allows either, e.g. logging
 * yesterday's session -- noon UTC on that date is used: Warsaw's offset never exceeds +2, so
 * noon UTC always falls within the same Warsaw calendar day regardless of DST, and can never
 * spill into the adjacent day the way a caller-supplied local midnight/current-time could.
 */
export function deriveObservedAtForLocalDate(date: string, now: Date = new Date()): string {
    if (getLocalDateString(now) === date) {
        return now.toISOString();
    }
    return new Date(`${date}T12:00:00.000Z`).toISOString();
}

/**
 * Constructs a deterministic AnthropometryMeasurementItem given raw entered readings.
 */
export function summarizeMeasurementItem(
    metricId: AnthropometryMetricId,
    rawReadings: readonly number[],
    laterality?: Laterality,
): AnthropometryMeasurementItem {
    const isLimb = LIMB_METRIC_IDS.includes(metricId);
    const effectiveLaterality = isLimb ? (laterality ?? 'unspecified') : undefined;

    if (metricId === 'body_mass_kg') {
        if (rawReadings.length !== 1) {
            throw new Error(`body_mass_kg expects exactly 1 reading, received ${rawReadings.length}`);
        }
        const val = roundTo2Decimals(rawReadings[0]);
        return {
            metricId,
            unit: 'kg',
            readings: [val],
            value: val,
        };
    }

    if (rawReadings.length < 2 || rawReadings.length > 3) {
        throw new Error(`Circumference ${metricId} expects 2 or 3 readings, received ${rawReadings.length}`);
    }

    const roundedReadings = rawReadings.map(roundTo1Decimal);
    const medianVal = roundTo1Decimal(calculateMedian(roundedReadings));
    const pairExceeded = exceedsCircumferenceTolerance(roundedReadings[0], roundedReadings[1]);

    return {
        metricId,
        laterality: effectiveLaterality,
        unit: 'cm',
        readings: roundedReadings,
        value: medianVal,
        repeatabilityWarning: pairExceeded,
    };
}
