import type { DailyRecoverySnapshot } from '../../../ledger/models';
import type {
    ActivityMatchedSignalExpectation,
    ActivityStratum,
    BaselineMaturity,
    CoreSignalDataQuality,
    HealthAnomalyFeatureSet,
    HealthAnomalyEstimator,
    HealthCoreSignal,
    HealthCoreSignalFeatures,
    HealthSignalFeatureCandidate,
    HealthSignalFeatureUnavailableReason,
} from './healthAnomalyModels';

export const HEALTH_ANOMALY_BASELINE_WINDOW_DAYS = 28;
export const HEALTH_ANOMALY_RECENT_WINDOW_DAYS = 7;
export const HEALTH_ANOMALY_MIN_BASELINE_OBSERVATIONS = 14;
export const HEALTH_ANOMALY_EMERGING_BASELINE_OBSERVATIONS = 7;
export const HEALTH_ANOMALY_ACTIVITY_SHRINKAGE_PRIOR_DAYS = 5;
export const HEALTH_ANOMALY_NEAR_ZERO_SCALE_EPSILON = 1e-6;
export const HEALTH_ANOMALY_TIE_FRACTION_THRESHOLD = 0.4;

export interface HealthAnomalyFeatureMappingOptions {
    /**
     * Dates known to be contaminated by acute illness or systemic anomaly episodes prior to
     * `currentDate`. Any date `>= currentDate` is ignored to prevent future-information leakage.
     */
    contaminatedDates?: ReadonlySet<string> | readonly string[];
}

const DAY_MS = 86_400_000;

type SignalObservation = {
    date: string;
    day: number;
    value: number;
};

type CandidateInput = {
    estimator: HealthAnomalyEstimator;
    currentValue: number | null;
    baselineValue: number | null;
    scaleValue: number | null;
    baselineVersion: number | null;
    unavailableReason?: HealthSignalFeatureUnavailableReason | null;
};

function finiteNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function parseEpochDay(date: string): number | null {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const millis = Date.UTC(year, month - 1, day);
    const parsed = new Date(millis);
    if (
        parsed.getUTCFullYear() !== year
        || parsed.getUTCMonth() !== month - 1
        || parsed.getUTCDate() !== day
    ) {
        return null;
    }
    return Math.floor(millis / DAY_MS);
}

function formatEpochDay(day: number): string {
    return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

export type ExtractedSignalObservations = {
    rhr: SignalObservation[];
    respiration: SignalObservation[];
    hrv: SignalObservation[];
    contaminatedDaysExcluded?: Record<HealthCoreSignal, number>;
};

function normalizeCausalContaminatedDates(
    currentDate: string,
    contaminatedDates?: ReadonlySet<string> | readonly string[],
): Set<string> {
    const result = new Set<string>();
    if (!contaminatedDates) return result;
    for (const date of contaminatedDates) {
        if (typeof date === 'string' && date < currentDate) {
            result.add(date);
        }
    }
    return result;
}

function filterContaminatedObservations(
    observations: readonly SignalObservation[],
    contaminated: ReadonlySet<string>,
): { retained: SignalObservation[]; excludedCount: number } {
    if (contaminated.size === 0) {
        return { retained: [...observations], excludedCount: 0 };
    }
    const clean = observations.filter(obs => !contaminated.has(obs.date));
    // Only exclude contaminated days when enough clean baseline observations remain so cold-start
    // or sparse histories are not artificially blinded.
    if (clean.length >= HEALTH_ANOMALY_EMERGING_BASELINE_OBSERVATIONS) {
        return {
            retained: clean,
            excludedCount: observations.length - clean.length,
        };
    }
    return { retained: [...observations], excludedCount: 0 };
}

/**
 * Extract deduplicated, date-sorted observations for all core signals in a single pass.
 * Current/future rows are discarded, preserving the invariant that the current day
 * never enters its own reference baseline. Respiration is keyed by the selected sleep
 * record's metric date rather than the recovery document date so a D-1 sleep fallback is
 * never silently re-labelled as a D observation.
 */
export function extractSignalObservations(
    currentDate: string,
    history: readonly DailyRecoverySnapshot[],
    options?: HealthAnomalyFeatureMappingOptions,
): ExtractedSignalObservations {
    const currentDay = parseEpochDay(currentDate);
    if (currentDay === null) {
        return {
            rhr: [],
            respiration: [],
            hrv: [],
            contaminatedDaysExcluded: { rhr: 0, respiration: 0, hrv: 0 },
        };
    }
    const startDay = currentDay - HEALTH_ANOMALY_BASELINE_WINDOW_DAYS;
    const byDateRhr = new Map<string, SignalObservation>();
    const byDateResp = new Map<string, SignalObservation>();
    const byDateHrv = new Map<string, SignalObservation>();

    for (let i = 0; i < history.length; i++) {
        const snapshot = history[i];
        const day = parseEpochDay(snapshot.date);
        if (day === null || day < startDay || day >= currentDay) continue;

        const rhrVal = finiteNumber(snapshot.raw.restingHr);
        if (rhrVal !== null) {
            byDateRhr.set(snapshot.date, { date: snapshot.date, day, value: rhrVal });
        }
        const respVal = finiteNumber(snapshot.raw.respirationAvg);
        const respirationDate = snapshot.source.metricDates?.sleep ?? null;
        const respirationDay = respirationDate === null ? null : parseEpochDay(respirationDate);
        if (
            respVal !== null
            && respirationDate !== null
            && respirationDay !== null
            && respirationDay >= startDay
            && respirationDay < currentDay
        ) {
            byDateResp.set(respirationDate, {
                date: respirationDate,
                day: respirationDay,
                value: respVal,
            });
        }
        const hrvVal = finiteNumber(snapshot.raw.hrvOvernightAvg);
        if (hrvVal !== null) {
            byDateHrv.set(snapshot.date, { date: snapshot.date, day, value: hrvVal });
        }
    }

    const sortFn = (left: SignalObservation, right: SignalObservation) => left.day - right.day;
    const contaminated = normalizeCausalContaminatedDates(currentDate, options?.contaminatedDates);
    const rhrFiltered = filterContaminatedObservations([...byDateRhr.values()].sort(sortFn), contaminated);
    const respFiltered = filterContaminatedObservations([...byDateResp.values()].sort(sortFn), contaminated);
    const hrvFiltered = filterContaminatedObservations([...byDateHrv.values()].sort(sortFn), contaminated);

    return {
        rhr: rhrFiltered.retained,
        respiration: respFiltered.retained,
        hrv: hrvFiltered.retained,
        contaminatedDaysExcluded: {
            rhr: rhrFiltered.excludedCount,
            respiration: respFiltered.excludedCount,
            hrv: hrvFiltered.excludedCount,
        },
    };
}

/**
 * Normalize a caller-supplied history into one valid observation per prior calendar day.
 */
function historyForSignal(
    currentDate: string,
    history: readonly DailyRecoverySnapshot[],
    signal: HealthCoreSignal,
): SignalObservation[] {
    const extracted = extractSignalObservations(currentDate, history);
    return extracted[signal];
}

function suspectedTies(observations: readonly SignalObservation[]): boolean {
    if (observations.length < 4) return false;
    const frequencies = new Map<number, number>();
    let maxCount = 0;
    for (const observation of observations) {
        const next = (frequencies.get(observation.value) ?? 0) + 1;
        frequencies.set(observation.value, next);
        maxCount = Math.max(maxCount, next);
    }
    return maxCount / observations.length >= HEALTH_ANOMALY_TIE_FRACTION_THRESHOLD;
}

function resolveBaselineMaturity(historyCount: number): BaselineMaturity {
    if (historyCount >= HEALTH_ANOMALY_MIN_BASELINE_OBSERVATIONS) return 'reliable';
    if (historyCount >= HEALTH_ANOMALY_EMERGING_BASELINE_OBSERVATIONS) return 'emerging';
    return 'insufficient';
}

function buildDataQuality(
    currentDate: string,
    signal: HealthCoreSignal,
    currentValue: number | null,
    observations: readonly SignalObservation[],
    scales: readonly (number | null)[],
    contaminatedDaysExcluded = 0,
): CoreSignalDataQuality {
    const currentDay = parseEpochDay(currentDate);
    const latest = observations.at(-1);
    const recentStart = currentDay === null
        ? null
        : currentDay - HEALTH_ANOMALY_RECENT_WINDOW_DAYS;
    const recentCount = recentStart === null
        ? 0
        : observations.filter(observation => observation.day >= recentStart).length;

    return {
        signal,
        historyCount: observations.length,
        recentDayCoverage: recentCount / HEALTH_ANOMALY_RECENT_WINDOW_DAYS,
        baselineWindowStart: currentDay === null
            ? null
            : formatEpochDay(currentDay - HEALTH_ANOMALY_BASELINE_WINDOW_DAYS),
        baselineWindowEndExclusive: currentDay === null ? null : currentDate,
        baselineAgeDays: currentDay === null || !latest ? null : currentDay - latest.day,
        zeroOrNearZeroScale: scales.some(
            scale => scale !== null && Math.abs(scale) <= HEALTH_ANOMALY_NEAR_ZERO_SCALE_EPSILON,
        ),
        currentValueMissing: currentValue === null,
        suspectedQuantizationOrTies: suspectedTies(observations),
        baselineMaturity: resolveBaselineMaturity(observations.length),
        contaminatedDaysExcluded,
    };
}

function buildCandidate(input: CandidateInput): HealthSignalFeatureCandidate {
    const current = finiteNumber(input.currentValue);
    const baseline = finiteNumber(input.baselineValue);
    const scale = finiteNumber(input.scaleValue);
    let reason = input.unavailableReason ?? null;

    if (reason === null && current === null) reason = 'missing_current';
    if (reason === null && baseline === null) reason = 'missing_baseline';
    if (reason === null && scale === null) reason = 'missing_scale';
    if (
        reason === null
        && scale !== null
        && Math.abs(scale) <= HEALTH_ANOMALY_NEAR_ZERO_SCALE_EPSILON
    ) {
        reason = 'near_zero_scale';
    }

    if (reason !== null || current === null || baseline === null || scale === null) {
        return {
            estimator: input.estimator,
            status: 'unavailable',
            unavailableReason: reason,
            currentValue: current,
            baselineValue: baseline,
            scaleValue: scale,
            deltaValue: null,
            standardizedDeviation: null,
            baselineVersion: input.baselineVersion,
        };
    }

    const delta = current - baseline;
    const standardizedDeviation = delta / scale;
    if (!Number.isFinite(standardizedDeviation)) {
        return {
            estimator: input.estimator,
            status: 'unavailable',
            unavailableReason: 'near_zero_scale',
            currentValue: current,
            baselineValue: baseline,
            scaleValue: scale,
            deltaValue: null,
            standardizedDeviation: null,
            baselineVersion: input.baselineVersion,
        };
    }

    return {
        estimator: input.estimator,
        status: 'available',
        unavailableReason: null,
        currentValue: current,
        baselineValue: baseline,
        scaleValue: scale,
        deltaValue: delta,
        standardizedDeviation,
        baselineVersion: input.baselineVersion,
    };
}

function mean(values: readonly number[]): number | null {
    if (values.length === 0) return null;
    return values.reduce((total, value) => total + value, 0) / values.length;
}

function populationStdev(values: readonly number[]): number | null {
    const average = mean(values);
    if (average === null) return null;
    const variance = values.reduce((total, value) => total + (value - average) ** 2, 0)
        / values.length;
    return Math.sqrt(variance);
}

const MAD_CONSISTENCY_CONSTANT = 1.4826;

function median(values: readonly number[]): number | null {
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 1
        ? sorted[mid]!
        : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function scaledMad(values: readonly number[]): number | null {
    const med = median(values);
    if (med === null) return null;
    const rawMad = median(values.map(value => Math.abs(value - med)));
    return rawMad === null ? null : rawMad * MAD_CONSISTENCY_CONSTANT;
}

/**
 * Natural-log candidate for Garmin's exported `hrvOvernightAvg`. This deliberately does not
 * call the feature LnRMSSD: the repository has not established that Garmin's exported field
 * is semantically identical to directly measured RMSSD used in the sports literature.
 */
function buildLogHrvCandidate(
    currentValue: number | null,
    observations: readonly SignalObservation[],
    baselineVersion: number | null,
): HealthSignalFeatureCandidate {
    if (currentValue !== null && currentValue <= 0) {
        return buildCandidate({
            estimator: 'log-mean-stdev-28d',
            currentValue: null,
            baselineValue: null,
            scaleValue: null,
            baselineVersion,
            unavailableReason: 'invalid_domain',
        });
    }

    const positiveHistory = observations.filter(observation => observation.value > 0);
    if (positiveHistory.length < HEALTH_ANOMALY_MIN_BASELINE_OBSERVATIONS) {
        return buildCandidate({
            estimator: 'log-mean-stdev-28d',
            currentValue: currentValue === null ? null : Math.log(currentValue),
            baselineValue: null,
            scaleValue: null,
            baselineVersion,
            unavailableReason: currentValue === null ? 'missing_current' : 'insufficient_history',
        });
    }

    const logValues = positiveHistory.map(observation => Math.log(observation.value));
    return buildCandidate({
        estimator: 'log-mean-stdev-28d',
        currentValue: currentValue === null ? null : Math.log(currentValue),
        baselineValue: mean(logValues),
        scaleValue: populationStdev(logValues),
        baselineVersion,
    });
}

function resolveSignalStats(
    derivedBaseline: number | null,
    derivedScale: number | null,
    observations: readonly SignalObservation[],
    contaminatedDaysExcluded: number,
    mode: 'mean-stdev' | 'median-mad',
    allowMatureFallback = false,
): { baselineValue: number | null; scaleValue: number | null } {
    const recomputeClean = contaminatedDaysExcluded > 0
        && observations.length >= HEALTH_ANOMALY_EMERGING_BASELINE_OBSERVATIONS;
    const emergingFallback = contaminatedDaysExcluded === 0
        && observations.length >= HEALTH_ANOMALY_EMERGING_BASELINE_OBSERVATIONS
        && (allowMatureFallback || observations.length < HEALTH_ANOMALY_MIN_BASELINE_OBSERVATIONS)
        && derivedBaseline === null
        && derivedScale === null;
    if (!recomputeClean && !emergingFallback) {
        return { baselineValue: derivedBaseline, scaleValue: derivedScale };
    }
    const values = observations.map(observation => observation.value);
    return mode === 'median-mad'
        ? { baselineValue: median(values), scaleValue: scaledMad(values) }
        : { baselineValue: mean(values), scaleValue: populationStdev(values) };
}

function buildRhrFeatures(
    snapshot: DailyRecoverySnapshot,
    history: readonly DailyRecoverySnapshot[],
    baselineVersion: number | null,
    preExtractedObservations?: SignalObservation[],
    contaminatedDaysExcluded = 0,
): HealthCoreSignalFeatures {
    const current = finiteNumber(snapshot.raw.restingHr);
    const observations = preExtractedObservations ?? historyForSignal(snapshot.date, history, 'rhr');
    const meanStats = resolveSignalStats(
        finiteNumber(snapshot.derived.restingHr28dAvg),
        finiteNumber(snapshot.derived.restingHr28dStdev),
        observations,
        contaminatedDaysExcluded,
        'mean-stdev',
    );
    const medianStats = resolveSignalStats(
        finiteNumber(snapshot.derived.restingHr28dMedian),
        finiteNumber(snapshot.derived.restingHr28dMad),
        observations,
        contaminatedDaysExcluded,
        'median-mad',
    );
    const medianCompatible = baselineVersion !== null && baselineVersion >= 4;
    const candidates = [
        buildCandidate({
            estimator: 'mean-stdev-28d',
            currentValue: current,
            baselineValue: meanStats.baselineValue,
            scaleValue: meanStats.scaleValue,
            baselineVersion,
        }),
        buildCandidate({
            estimator: 'median-mad-28d',
            currentValue: current,
            baselineValue: medianStats.baselineValue,
            scaleValue: medianStats.scaleValue,
            baselineVersion,
            unavailableReason: medianCompatible ? null : 'incompatible_baseline_version',
        }),
    ];

    return {
        signal: 'rhr',
        adverseDirection: 'high',
        candidates,
        dataQuality: buildDataQuality(
            snapshot.date,
            'rhr',
            current,
            observations,
            [meanStats.scaleValue, medianStats.scaleValue],
            contaminatedDaysExcluded,
        ),
        measurementProvenance: 'garmin:restingHr',
    };
}

function buildRespirationFeatures(
    snapshot: DailyRecoverySnapshot,
    history: readonly DailyRecoverySnapshot[],
    baselineVersion: number | null,
    preExtractedObservations?: SignalObservation[],
    contaminatedDaysExcluded = 0,
): HealthCoreSignalFeatures {
    const measurementDate = snapshot.source.metricDates?.sleep ?? null;
    const current = measurementDate === snapshot.date
        ? finiteNumber(snapshot.raw.respirationAvg)
        : null;
    const observations = preExtractedObservations ?? historyForSignal(snapshot.date, history, 'respiration');
    const stats = resolveSignalStats(
        finiteNumber(snapshot.derived.respiration28dAvg),
        finiteNumber(snapshot.derived.respiration28dMad),
        observations,
        contaminatedDaysExcluded,
        'median-mad',
    );
    const compatible = baselineVersion !== null && baselineVersion >= 3;
    const candidates = [buildCandidate({
        estimator: 'median-mad-28d',
        currentValue: current,
        baselineValue: stats.baselineValue,
        scaleValue: stats.scaleValue,
        baselineVersion,
        unavailableReason: compatible ? null : 'incompatible_baseline_version',
    })];

    return {
        signal: 'respiration',
        adverseDirection: 'high',
        candidates,
        dataQuality: buildDataQuality(
            snapshot.date,
            'respiration',
            current,
            observations,
            [stats.scaleValue],
            contaminatedDaysExcluded,
        ),
        // Garmin respirationAvg is selected from the same sleep record as sleepScore;
        // metricDates.sleep therefore supplies the bounded logical-date provenance needed
        // to distinguish a target-date night from the backend's D-1 sleep fallback.
        measurementProvenance: measurementDate === null ? null : `garmin:sleep:${measurementDate}`,
    };
}

function buildHrvFeatures(
    snapshot: DailyRecoverySnapshot,
    history: readonly DailyRecoverySnapshot[],
    baselineVersion: number | null,
    preExtractedObservations?: SignalObservation[],
    contaminatedDaysExcluded = 0,
): HealthCoreSignalFeatures {
    const current = finiteNumber(snapshot.raw.hrvOvernightAvg);
    const observations = preExtractedObservations ?? historyForSignal(snapshot.date, history, 'hrv');
    const meanStats = resolveSignalStats(
        finiteNumber(snapshot.derived.hrv28dAvg),
        finiteNumber(snapshot.derived.hrv28dStdev),
        observations,
        contaminatedDaysExcluded,
        'mean-stdev',
    );
    const medianStats = resolveSignalStats(
        finiteNumber(snapshot.derived.hrv28dMedian),
        finiteNumber(snapshot.derived.hrv28dMad),
        observations,
        contaminatedDaysExcluded,
        'median-mad',
    );
    const medianCompatible = baselineVersion !== null && baselineVersion >= 4;
    const logCandidate = buildLogHrvCandidate(current, observations, baselineVersion);
    const candidates = [
        buildCandidate({
            estimator: 'mean-stdev-28d',
            currentValue: current,
            baselineValue: meanStats.baselineValue,
            scaleValue: meanStats.scaleValue,
            baselineVersion,
        }),
        buildCandidate({
            estimator: 'median-mad-28d',
            currentValue: current,
            baselineValue: medianStats.baselineValue,
            scaleValue: medianStats.scaleValue,
            baselineVersion,
            unavailableReason: medianCompatible ? null : 'incompatible_baseline_version',
        }),
        logCandidate,
    ];

    return {
        signal: 'hrv',
        adverseDirection: 'low',
        candidates,
        dataQuality: buildDataQuality(
            snapshot.date,
            'hrv',
            current,
            observations,
            [meanStats.scaleValue, medianStats.scaleValue, logCandidate.scaleValue],
            contaminatedDaysExcluded,
        ),
        measurementProvenance: 'garmin:hrvOvernightAvg',
    };
}

function classifyActivityStratum(snapshot: DailyRecoverySnapshot): ActivityStratum {
    const yt = snapshot.raw.yesterdayTraining;
    if (!yt) return 'post_easy_or_rest';
    if (
        (yt.hardActivityCount ?? 0) > 0
        || yt.primaryActivity?.intensityTag === 'hard'
        || (yt.highCostActivityCount ?? 0) > 0
        || yt.primaryActivity?.sessionCost === 'high'
        || yt.primaryActivity?.sessionCost === 'very_high'
    ) {
        return 'post_hard_or_high_cost';
    }
    return 'post_easy_or_rest';
}

/**
 * Compute activity-stratum-matched expectations for each core physiological signal using
 * empirical-Bayes shrinkage toward the clean 28-day unconditional baseline.
 */
export function computeActivityMatchedExpectations(
    snapshot: DailyRecoverySnapshot,
    history: readonly DailyRecoverySnapshot[] = [],
    options?: HealthAnomalyFeatureMappingOptions,
    preExtracted?: ExtractedSignalObservations,
): ActivityMatchedSignalExpectation[] {
    const currentDay = parseEpochDay(snapshot.date);
    const todayStratum = classifyActivityStratum(snapshot);
    const extracted = preExtracted ?? extractSignalObservations(snapshot.date, history, options);
    const stratumByDate = new Map<string, ActivityStratum>();

    if (currentDay !== null) {
        const startDay = currentDay - HEALTH_ANOMALY_BASELINE_WINDOW_DAYS;
        for (const item of history) {
            const day = parseEpochDay(item.date);
            if (day === null || day < startDay || day >= currentDay) continue;
            stratumByDate.set(item.date, classifyActivityStratum(item));
        }
    }

    const respMeasurementDate = snapshot.source.metricDates?.sleep ?? null;
    const signalSpecs: Array<{
        signal: HealthCoreSignal;
        mode: 'mean-stdev' | 'median-mad';
        currentValue: number | null;
        derivedBaseline: number | null;
        derivedScale: number | null;
    }> = [
        {
            signal: 'rhr',
            mode: 'mean-stdev',
            currentValue: finiteNumber(snapshot.raw.restingHr),
            derivedBaseline: finiteNumber(snapshot.derived.restingHr28dAvg),
            derivedScale: finiteNumber(snapshot.derived.restingHr28dStdev),
        },
        {
            signal: 'respiration',
            mode: 'median-mad',
            currentValue: respMeasurementDate === snapshot.date
                ? finiteNumber(snapshot.raw.respirationAvg)
                : null,
            derivedBaseline: finiteNumber(snapshot.derived.respiration28dAvg),
            derivedScale: finiteNumber(snapshot.derived.respiration28dMad),
        },
        {
            signal: 'hrv',
            mode: 'mean-stdev',
            currentValue: finiteNumber(snapshot.raw.hrvOvernightAvg),
            derivedBaseline: finiteNumber(snapshot.derived.hrv28dAvg),
            derivedScale: finiteNumber(snapshot.derived.hrv28dStdev),
        },
    ];

    return signalSpecs.map((spec) => {
        const observations = extracted[spec.signal];
        const contaminatedExcluded = extracted.contaminatedDaysExcluded?.[spec.signal] ?? 0;
        const stats = resolveSignalStats(
            spec.derivedBaseline,
            spec.derivedScale,
            observations,
            contaminatedExcluded,
            spec.mode,
            true,
        );
        const unconditionalBaseline = stats.baselineValue;
        const scale = stats.scaleValue;

        const stratumValues = observations
            .filter(obs => (stratumByDate.get(obs.date) ?? 'post_easy_or_rest') === todayStratum)
            .map(obs => obs.value);
        const stratumSampleCount = stratumValues.length;
        const stratumCenter = mean(stratumValues);

        const shrunkExpectedValue = unconditionalBaseline === null
            ? null
            : stratumCenter === null || stratumSampleCount === 0
                ? unconditionalBaseline
                : (stratumSampleCount * stratumCenter
                    + HEALTH_ANOMALY_ACTIVITY_SHRINKAGE_PRIOR_DAYS * unconditionalBaseline)
                    / (stratumSampleCount + HEALTH_ANOMALY_ACTIVITY_SHRINKAGE_PRIOR_DAYS);

        const residualFromExpected = spec.currentValue !== null && shrunkExpectedValue !== null
            ? spec.currentValue - shrunkExpectedValue
            : null;
        const residualStandardizedDeviation = residualFromExpected !== null
            && scale !== null
            && Math.abs(scale) > HEALTH_ANOMALY_NEAR_ZERO_SCALE_EPSILON
            ? residualFromExpected / scale
            : null;

        const adverseResidualZ = residualStandardizedDeviation === null
            ? null
            : spec.signal === 'hrv'
                ? -residualStandardizedDeviation
                : residualStandardizedDeviation;
        const withinExpectedTrainingResponse = adverseResidualZ === null
            ? true
            : adverseResidualZ < 1.5;

        return {
            signal: spec.signal,
            stratum: todayStratum,
            stratumSampleCount,
            unconditionalBaseline,
            shrunkExpectedValue,
            currentValue: spec.currentValue,
            residualFromExpected,
            residualStandardizedDeviation,
            withinExpectedTrainingResponse,
        };
    });
}

/**
 * HA2 pure feature mapper. It exposes estimator candidates side by side and never chooses a
 * winner or classifies an anomaly. No readiness/rules adapter imports this module.
 */
export function mapRecoverySnapshotToHealthAnomalyFeatures(
    snapshot: DailyRecoverySnapshot,
    history: readonly DailyRecoverySnapshot[] = [],
    options?: HealthAnomalyFeatureMappingOptions,
): HealthAnomalyFeatureSet {
    const baselineVersion = finiteNumber(snapshot.derived.baselineComputationVersion);
    const extracted = extractSignalObservations(snapshot.date, history, options);
    return {
        date: snapshot.date,
        baselineVersion,
        coreSignals: [
            buildRhrFeatures(
                snapshot,
                history,
                baselineVersion,
                extracted.rhr,
                extracted.contaminatedDaysExcluded?.rhr ?? 0,
            ),
            buildRespirationFeatures(
                snapshot,
                history,
                baselineVersion,
                extracted.respiration,
                extracted.contaminatedDaysExcluded?.respiration ?? 0,
            ),
            buildHrvFeatures(
                snapshot,
                history,
                baselineVersion,
                extracted.hrv,
                extracted.contaminatedDaysExcluded?.hrv ?? 0,
            ),
        ],
        activityMatchedExpectations: computeActivityMatchedExpectations(
            snapshot,
            history,
            options,
            extracted,
        ),
    };
}
