/**
 * Pure retrospective trend calculations for body mass, circumferences, hunger, and provider estimates.
 *
 * Governed by ADR-0039 D-BC-DAILY, D-BC-TRENDS, D-BC-NOFAT, D-BC-NOEA.
 */

import type {
    AnthropometryEntry,
    AnthropometryMetricId,
    Laterality,
} from './models';
import { roundTo1Decimal, roundTo2Decimals } from './protocol';

export interface DailyBodyMassPoint {
    date: string; // YYYY-MM-DD
    observedAt?: string;
    source: 'provider' | 'manual';
    weightKg: number;
    isPreferredContext?: boolean;
    entryId?: string;
}

export interface BodyMassWindowSummary {
    windowDays: 7;
    endDate: string;
    distinctRecordedDates: number;
    qualifiesForMean: boolean; // distinctRecordedDates >= 4
    meanWeightKg: number | null;
}

export interface BodyMassTrendResult {
    source: 'provider' | 'manual';
    latestPoint: DailyBodyMassPoint | null;
    current7d: BodyMassWindowSummary;
    prior7d: BodyMassWindowSummary;
    weekOverWeekAbsoluteKg: number | null;
    weekOverWeekPercent: number | null;
}

export interface CircumferencePoint {
    date: string;
    observedAt: string;
    metricId: AnthropometryMetricId;
    laterality: Laterality;
    protocol: string;
    value: number; // cm
    repeatabilityWarning: boolean;
    isPreferredContext: boolean;
    entryId: string;
}

export interface CircumferenceTrendResult {
    seriesKey: string;
    metricId: AnthropometryMetricId;
    laterality: Laterality;
    protocol: string;
    latestPoint: CircumferencePoint | null;
    previousPoint: CircumferencePoint | null;
    deltaCm: number | null;
}

export interface HungerRetrospectiveSummary {
    timing: 'morning_pre_breakfast' | 'other';
    recordedDays7d: number;
    mean7d: number | null;
    recordedDays28d: number;
    mean28d: number | null;
    latestValue: number | null;
    latestDate: string | null;
}

export interface ProviderCompositionTrend {
    latestBodyFatPct: number | null;
    latestDate: string | null;
    mean7d: number | null;
    recordedDays7d: number;
}

/**
 * Deterministically reduces same-day manual entries to at most one point per date.
 * Preference order:
 * 1. morningPostVoidPreIntake && !trainingBeforeMeasurement
 * 2. Earliest observedAt
 * 3. Stable entry id tie-break
 */
export function reduceDailyManualBodyMass(entries: readonly AnthropometryEntry[]): Map<string, DailyBodyMassPoint> {
    const entriesByDate = new Map<string, AnthropometryEntry[]>();

    for (const entry of entries) {
        const hasWeight = entry.measurements.some(m => m.metricId === 'body_mass_kg');
        if (!hasWeight) continue;
        const list = entriesByDate.get(entry.date) ?? [];
        list.push(entry);
        entriesByDate.set(entry.date, list);
    }

    const result = new Map<string, DailyBodyMassPoint>();

    for (const [date, dateEntries] of entriesByDate.entries()) {
        const sorted = [...dateEntries].sort((a, b) => {
            const aPref = a.context.morningPostVoidPreIntake && !a.context.trainingBeforeMeasurement;
            const bPref = b.context.morningPostVoidPreIntake && !b.context.trainingBeforeMeasurement;
            if (aPref !== bPref) return aPref ? -1 : 1;

            if (a.observedAt !== b.observedAt) {
                return a.observedAt.localeCompare(b.observedAt);
            }
            return a.id.localeCompare(b.id);
        });

        const chosen = sorted[0];
        const weightItem = chosen.measurements.find(m => m.metricId === 'body_mass_kg')!;
        const isPref = chosen.context.morningPostVoidPreIntake && !chosen.context.trainingBeforeMeasurement;

        result.set(date, {
            date,
            observedAt: chosen.observedAt,
            source: 'manual',
            weightKg: weightItem.value,
            isPreferredContext: isPref,
            entryId: chosen.id,
        });
    }

    return result;
}

export interface RawProviderWeightRecord {
    date: string; // YYYY-MM-DD
    weightKg: number;
    observedAt?: string;
}

/**
 * Deterministically emits at most one provider body mass point per date.
 */
export function reduceDailyProviderBodyMass(records: readonly RawProviderWeightRecord[]): Map<string, DailyBodyMassPoint> {
    const result = new Map<string, DailyBodyMassPoint>();
    for (const rec of records) {
        if (typeof rec.weightKg !== 'number' || !Number.isFinite(rec.weightKg) || rec.weightKg <= 0) continue;
        const existing = result.get(rec.date);
        // If multiple on same date, prefer earliest or keep first deterministic
        if (!existing) {
            result.set(rec.date, {
                date: rec.date,
                observedAt: rec.observedAt,
                source: 'provider',
                weightKg: roundTo2Decimals(rec.weightKg),
            });
        }
    }
    return result;
}

/**
 * Computes a 7-day arithmetic mean requiring at least 4 distinct valid dates.
 * `calendarDates` must be an ordered array of 7 consecutive YYYY-MM-DD strings.
 */
export function compute7dBodyMassSummary(
    calendarDates: readonly string[],
    pointsByDate: ReadonlyMap<string, DailyBodyMassPoint>,
): BodyMassWindowSummary {
    if (calendarDates.length !== 7) {
        throw new Error(`Expected exactly 7 calendar dates, received ${calendarDates.length}`);
    }

    const recordedPoints: DailyBodyMassPoint[] = [];
    for (const d of calendarDates) {
        const p = pointsByDate.get(d);
        if (p && typeof p.weightKg === 'number' && Number.isFinite(p.weightKg)) {
            recordedPoints.push(p);
        }
    }

    const count = recordedPoints.length;
    const qualifies = count >= 4;
    const mean = qualifies
        ? roundTo2Decimals(recordedPoints.reduce((acc, p) => acc + p.weightKg, 0) / count)
        : null;

    return {
        windowDays: 7,
        endDate: calendarDates[6],
        distinctRecordedDates: count,
        qualifiesForMean: qualifies,
        meanWeightKg: mean,
    };
}

/**
 * Evaluates the full body-mass trend for a selected source given current and prior 7-day windows.
 */
export function computeBodyMassTrend(
    source: 'provider' | 'manual',
    current7dDates: readonly string[],
    prior7dDates: readonly string[],
    pointsByDate: ReadonlyMap<string, DailyBodyMassPoint>,
): BodyMassTrendResult {
    const current7d = compute7dBodyMassSummary(current7dDates, pointsByDate);
    const prior7d = compute7dBodyMassSummary(prior7dDates, pointsByDate);

    // Find the latest recorded point across all dates
    const allDates = Array.from(pointsByDate.keys()).sort();
    const latestDate = allDates.length > 0 ? allDates[allDates.length - 1] : null;
    const latestPoint = latestDate ? pointsByDate.get(latestDate) ?? null : null;

    let weekOverWeekAbsoluteKg: number | null = null;
    let weekOverWeekPercent: number | null = null;

    if (current7d.qualifiesForMean && prior7d.qualifiesForMean && current7d.meanWeightKg !== null && prior7d.meanWeightKg !== null) {
        weekOverWeekAbsoluteKg = roundTo2Decimals(current7d.meanWeightKg - prior7d.meanWeightKg);
        weekOverWeekPercent = roundTo1Decimal(((current7d.meanWeightKg - prior7d.meanWeightKg) / prior7d.meanWeightKg) * 100);
    }

    return {
        source,
        latestPoint,
        current7d,
        prior7d,
        weekOverWeekAbsoluteKg,
        weekOverWeekPercent,
    };
}

/**
 * Extracts and groups circumference points by series key `${metricId}:${laterality}:${protocol}`.
 */
export function computeCircumferenceTrends(entries: readonly AnthropometryEntry[]): Map<string, CircumferenceTrendResult> {
    const seriesPoints = new Map<string, CircumferencePoint[]>();

    for (const entry of entries) {
        const isPref = entry.context.morningPostVoidPreIntake && !entry.context.trainingBeforeMeasurement;
        for (const m of entry.measurements) {
            if (m.metricId === 'body_mass_kg') continue;
            const laterality = m.laterality ?? 'unspecified';
            const key = `${m.metricId}:${laterality}:${entry.protocol}`;

            const pt: CircumferencePoint = {
                date: entry.date,
                observedAt: entry.observedAt,
                metricId: m.metricId,
                laterality,
                protocol: entry.protocol,
                value: m.value,
                repeatabilityWarning: Boolean(m.repeatabilityWarning),
                isPreferredContext: isPref,
                entryId: entry.id,
            };

            const list = seriesPoints.get(key) ?? [];
            list.push(pt);
            seriesPoints.set(key, list);
        }
    }

    const results = new Map<string, CircumferenceTrendResult>();

    for (const [key, points] of seriesPoints.entries()) {
        const sorted = [...points].sort((a, b) => {
            if (a.date !== b.date) return a.date.localeCompare(b.date);
            return a.observedAt.localeCompare(b.observedAt);
        });

        const latest = sorted[sorted.length - 1];
        const previous = sorted.length > 1 ? sorted[sorted.length - 2] : null;
        const deltaCm = previous !== null ? roundTo1Decimal(latest.value - previous.value) : null;

        results.set(key, {
            seriesKey: key,
            metricId: latest.metricId,
            laterality: latest.laterality,
            protocol: latest.protocol,
            latestPoint: latest,
            previousPoint: previous,
            deltaCm,
        });
    }

    return results;
}

export interface CheckinHungerRecord {
    date: string;
    hunger1To10?: number | null;
    hungerTiming?: 'morning_pre_breakfast' | 'other' | null;
}

/**
 * Computes retrospective hunger summary for a specific timing window.
 */
export function computeHungerRetrospectiveSummary(
    records: readonly CheckinHungerRecord[],
    timing: 'morning_pre_breakfast' | 'other',
    dates7d: readonly string[],
    dates28d: readonly string[],
): HungerRetrospectiveSummary {
    const dates7dSet = new Set(dates7d);
    const dates28dSet = new Set(dates28d);

    const matchingRecords = records.filter(r => r.hungerTiming === timing && typeof r.hunger1To10 === 'number');

    const in7d = matchingRecords.filter(r => dates7dSet.has(r.date));
    const in28d = matchingRecords.filter(r => dates28dSet.has(r.date));

    const mean7d = in7d.length > 0
        ? roundTo1Decimal(in7d.reduce((acc, r) => acc + (r.hunger1To10 ?? 0), 0) / in7d.length)
        : null;

    const mean28d = in28d.length > 0
        ? roundTo1Decimal(in28d.reduce((acc, r) => acc + (r.hunger1To10 ?? 0), 0) / in28d.length)
        : null;

    // Find the latest recorded entry for this timing
    const sorted = [...matchingRecords].sort((a, b) => a.date.localeCompare(b.date));
    const latest = sorted.length > 0 ? sorted[sorted.length - 1] : null;

    return {
        timing,
        recordedDays7d: in7d.length,
        mean7d,
        recordedDays28d: in28d.length,
        mean28d,
        latestValue: latest?.hunger1To10 ?? null,
        latestDate: latest?.date ?? null,
    };
}

export interface ProviderCompositionRecord {
    date: string;
    bodyFatPct?: number | null;
}

/**
 * Computes summary for device-estimated provider body fat percentage.
 */
export function computeProviderCompositionSummary(
    records: readonly ProviderCompositionRecord[],
    dates7d: readonly string[],
): ProviderCompositionTrend {
    const dates7dSet = new Set(dates7d);
    const validRecords = records.filter(r => typeof r.bodyFatPct === 'number' && Number.isFinite(r.bodyFatPct));

    const in7d = validRecords.filter(r => dates7dSet.has(r.date));
    const mean7d = in7d.length >= 4
        ? roundTo1Decimal(in7d.reduce((acc, r) => acc + (r.bodyFatPct ?? 0), 0) / in7d.length)
        : null;

    const sorted = [...validRecords].sort((a, b) => a.date.localeCompare(b.date));
    const latest = sorted.length > 0 ? sorted[sorted.length - 1] : null;

    return {
        latestBodyFatPct: latest?.bodyFatPct ?? null,
        latestDate: latest?.date ?? null,
        mean7d,
        recordedDays7d: in7d.length,
    };
}
