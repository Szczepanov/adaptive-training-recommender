/**
 * Body-mass-relative context derivation for assessments and reporting.
 *
 * Governed by ADR-0046 D-AT-BODYMASS, ADR-0039 D-BC-WEIGHT, and Issue #897 WP3.4 / D8.
 * Relative values are context-only: never canonical observations, never goal inputs,
 * and never used for progress derivation.
 */

import type { DailyRecoverySnapshot } from '../engine/models';
import type { AnthropometryEntry } from './models';
import {
    reduceDailyManualBodyMass,
    reduceDailyProviderBodyMass,
    type RawProviderWeightRecord,
} from './trends';
import { roundTo2Decimals } from './protocol';
import { chooseEffectiveBodyMassSource } from './bodyMassPreference';

export interface ResolvedSameDayBodyMass {
    bodyMassKg: number;
    source: 'provider' | 'manual';
    date: string;
}

export interface ResolveSameDayBodyMassOptions {
    manualEntries?: readonly AnthropometryEntry[];
    providerRecords?: readonly RawProviderWeightRecord[];
    snapshots?: readonly DailyRecoverySnapshot[];
    preferredSource?: 'provider' | 'manual' | null;
}

export interface BodyMassRelativeContext {
    bodyMassKg?: number;
    bodyMassSource?: 'provider' | 'manual';
    bodyMassDate?: string;
    relativeValue?: number;
    relativeUnit?: string;
}

/**
 * Extracts provider weight records keyed strictly on `source.metricDates.weight` (the weigh-in date),
 * never on the snapshot date.
 */
export function extractProviderWeightRecords(
    snapshots: readonly DailyRecoverySnapshot[],
): RawProviderWeightRecord[] {
    return snapshots
        .filter(s => typeof s.raw.weightKg === 'number' && s.raw.weightKg > 0 && s.source.metricDates?.weight)
        .map(s => ({
            date: s.source.metricDates!.weight as string,
            weightKg: s.raw.weightKg as number,
        }));
}

/**
 * Checks if a canonical metric admits body-mass-relative context (sprint W/kg or relative 1RM).
 */
export function isBodyMassRelativeMetric(metricId: string): boolean {
    return metricId === 'cycling_sprint_1s_peak_power_w'
        || metricId === 'cycling_sprint_5s_mean_power_w'
        || metricId === 'cycling_5s_peak_power_w'
        || metricId === 'strength_1rm_kg';
}

/**
 * Resolves exactly one same-day body-mass point for a Warsaw calendar date from ONE source:
 * athlete preference if set, otherwise provider-first per D-BC-WEIGHT.
 * Never averages, never falls back to the other source, and never uses a stale carry-forward.
 */
export function resolveSameDayBodyMass(
    targetDate: string,
    options: ResolveSameDayBodyMassOptions,
): ResolvedSameDayBodyMass | null {
    const providerRecords = options.providerRecords
        ?? (options.snapshots ? extractProviderWeightRecords(options.snapshots) : []);
    const manualEntries = options.manualEntries ?? [];
    const preferred = chooseEffectiveBodyMassSource(
        options.preferredSource ?? null,
        providerRecords.length > 0,
        manualEntries.some(entry =>
            entry.measurements.some(measurement => measurement.metricId === 'body_mass_kg')
        ),
    );

    if (preferred === 'provider') {
        const dailyMap = reduceDailyProviderBodyMass(providerRecords);
        const point = dailyMap.get(targetDate);
        if (!point || typeof point.weightKg !== 'number' || point.weightKg <= 0) {
            return null;
        }
        return {
            bodyMassKg: point.weightKg,
            source: 'provider',
            date: point.date,
        };
    }

    const dailyMap = reduceDailyManualBodyMass(manualEntries);
    const point = dailyMap.get(targetDate);
    if (!point || typeof point.weightKg !== 'number' || point.weightKg <= 0) {
        return null;
    }
    return {
        bodyMassKg: point.weightKg,
        source: 'manual',
        date: point.date,
    };
}

/**
 * Computes body-mass-relative value and context for sprint W/kg or relative 1RM.
 * Returns empty object if metric is not relative or if body mass is unavailable.
 */
export function computeBodyMassRelativeContext(
    metricId: string,
    value: number,
    bodyMass: ResolvedSameDayBodyMass | null,
): BodyMassRelativeContext {
    if (!isBodyMassRelativeMetric(metricId)) {
        return {};
    }
    if (!bodyMass || bodyMass.bodyMassKg <= 0) {
        return {};
    }

    const unit = metricId === 'strength_1rm_kg' ? 'kg/kg' : 'W/kg';
    const relativeValue = roundTo2Decimals(value / bodyMass.bodyMassKg);
    return {
        bodyMassKg: bodyMass.bodyMassKg,
        bodyMassSource: bodyMass.source,
        bodyMassDate: bodyMass.date,
        relativeValue,
        relativeUnit: unit,
    };
}

/**
 * User-facing formatting for relative context.
 */
export function formatBodyMassRelativeContext(
    metricId: string,
    context: BodyMassRelativeContext,
): string | null {
    if (!isBodyMassRelativeMetric(metricId)) return null;
    if (context.relativeValue === undefined || !context.relativeUnit) {
        return 'unavailable';
    }
    return `${context.relativeValue} ${context.relativeUnit} (${context.bodyMassSource} · ${context.bodyMassDate})`;
}
