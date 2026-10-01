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
    /** Stable reference to the canonical source record used for this derived context. */
    reference?: string;
}

export interface ResolveSameDayBodyMassOptions {
    manualEntries?: readonly AnthropometryEntry[];
    /**
     * Provider weigh-ins covering the target date(s) plus the provider-series lookback
     * (`PROVIDER_BODY_MASS_SERIES_LOOKBACK_DAYS`), so "a usable provider series exists" is not
     * judged from the test day alone.
     */
    providerRecords?: readonly RawProviderWeightRecord[];
    snapshots?: readonly DailyRecoverySnapshot[];
    preferredSource?: 'provider' | 'manual' | null;
    /**
     * `unknown` when the provider read failed or returned unreadable rows. Without an explicit
     * athlete preference, provider-first selection cannot be applied to unknown provider data,
     * so the relative value is unavailable rather than substituted from the manual series.
     */
    providerSeriesStatus?: 'known' | 'unknown';
}

/**
 * Horizon over which a provider body-mass series counts as "usable" for D-BC-WEIGHT
 * provider-first selection. A provider series with weigh-ins in this window stays the selected
 * source even on a test day without a weigh-in (the value is then unavailable, never manual).
 */
export const PROVIDER_BODY_MASS_SERIES_LOOKBACK_DAYS = 28;

export interface BodyMassRelativeContext {
    bodyMassKg?: number;
    bodyMassSource?: 'provider' | 'manual';
    bodyMassDate?: string;
    bodyMassReference?: string;
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
            sourceRef: `daily_recovery_snapshot:${s.date}`,
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
    if (!options.preferredSource && options.providerSeriesStatus === 'unknown') {
        // ADR-0046 D-AT-BODYMASS: no cross-source substitution. A failed provider read must not
        // turn provider-first selection into a silent manual fallback.
        return null;
    }
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
            reference: point.sourceRef,
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
        reference: point.entryId ? `anthropometry_entry:${point.entryId}` : undefined,
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
        bodyMassReference: bodyMass.reference,
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
    const provenance = context.bodyMassReference
        ? `${context.bodyMassSource} · ${context.bodyMassDate} · ref ${context.bodyMassReference}`
        : `${context.bodyMassSource} · ${context.bodyMassDate}`;
    return `${context.relativeValue} ${context.relativeUnit} (${provenance})`;
}
