import type { DailyRecoverySnapshot } from './models';
import type {
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
export const HEALTH_ANOMALY_NEAR_ZERO_SCALE_EPSILON = 1e-6;
export const HEALTH_ANOMALY_TIE_FRACTION_THRESHOLD = 0.4;

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
};

/**
 * Extract deduplicated, date-sorted observations for all core signals in a single pass.
 * Current/future rows are discarded, preserving the invariant that the current day
 * never enters its own reference baseline.
 */
export function extractSignalObservations(
    currentDate: string,
    history: readonly DailyRecoverySnapshot[],
): ExtractedSignalObservations {
    const currentDay = parseEpochDay(currentDate);
    if (currentDay === null) {
        return { rhr: [], respiration: [], hrv: [] };
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
        if (respVal !== null) {
            byDateResp.set(snapshot.date, { date: snapshot.date, day, value: respVal });
        }
        const hrvVal = finiteNumber(snapshot.raw.hrvOvernightAvg);
        if (hrvVal !== null) {
            byDateHrv.set(snapshot.date, { date: snapshot.date, day, value: hrvVal });
        }
    }

    const sortFn = (left: SignalObservation, right: SignalObservation) => left.day - right.day;

    return {
        rhr: [...byDateRhr.values()].sort(sortFn),
        respiration: [...byDateResp.values()].sort(sortFn),
        hrv: [...byDateHrv.values()].sort(sortFn),
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

function buildDataQuality(
    currentDate: string,
    signal: HealthCoreSignal,
    currentValue: number | null,
    observations: readonly SignalObservation[],
    scales: readonly (number | null)[],
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

function buildRhrFeatures(
    snapshot: DailyRecoverySnapshot,
    history: readonly DailyRecoverySnapshot[],
    baselineVersion: number | null,
    preExtractedObservations?: SignalObservation[],
): HealthCoreSignalFeatures {
    const current = finiteNumber(snapshot.raw.restingHr);
    const observations = preExtractedObservations ?? historyForSignal(snapshot.date, history, 'rhr');
    const meanScale = finiteNumber(snapshot.derived.restingHr28dStdev);
    const medianScale = finiteNumber(snapshot.derived.restingHr28dMad);
    const medianCompatible = baselineVersion !== null && baselineVersion >= 4;
    const candidates = [
        buildCandidate({
            estimator: 'mean-stdev-28d',
            currentValue: current,
            baselineValue: finiteNumber(snapshot.derived.restingHr28dAvg),
            scaleValue: meanScale,
            baselineVersion,
        }),
        buildCandidate({
            estimator: 'median-mad-28d',
            currentValue: current,
            baselineValue: finiteNumber(snapshot.derived.restingHr28dMedian),
            scaleValue: medianScale,
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
            [meanScale, medianScale],
        ),
        measurementProvenance: 'garmin:restingHr',
    };
}

function buildRespirationFeatures(
    snapshot: DailyRecoverySnapshot,
    history: readonly DailyRecoverySnapshot[],
    baselineVersion: number | null,
    preExtractedObservations?: SignalObservation[],
): HealthCoreSignalFeatures {
    const current = finiteNumber(snapshot.raw.respirationAvg);
    const observations = preExtractedObservations ?? historyForSignal(snapshot.date, history, 'respiration');
    const scale = finiteNumber(snapshot.derived.respiration28dMad);
    const compatible = baselineVersion !== null && baselineVersion >= 3;
    const candidates = [buildCandidate({
        estimator: 'median-mad-28d',
        currentValue: current,
        baselineValue: finiteNumber(snapshot.derived.respiration28dAvg),
        scaleValue: scale,
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
            [scale],
        ),
        // The canonical snapshot currently stores the precise-or-fallback nightly value but
        // not which path produced it. HA2 must preserve that missingness rather than guess.
        measurementProvenance: null,
    };
}

function buildHrvFeatures(
    snapshot: DailyRecoverySnapshot,
    history: readonly DailyRecoverySnapshot[],
    baselineVersion: number | null,
    preExtractedObservations?: SignalObservation[],
): HealthCoreSignalFeatures {
    const current = finiteNumber(snapshot.raw.hrvOvernightAvg);
    const observations = preExtractedObservations ?? historyForSignal(snapshot.date, history, 'hrv');
    const meanScale = finiteNumber(snapshot.derived.hrv28dStdev);
    const medianScale = finiteNumber(snapshot.derived.hrv28dMad);
    const medianCompatible = baselineVersion !== null && baselineVersion >= 4;
    const logCandidate = buildLogHrvCandidate(current, observations, baselineVersion);
    const candidates = [
        buildCandidate({
            estimator: 'mean-stdev-28d',
            currentValue: current,
            baselineValue: finiteNumber(snapshot.derived.hrv28dAvg),
            scaleValue: meanScale,
            baselineVersion,
        }),
        buildCandidate({
            estimator: 'median-mad-28d',
            currentValue: current,
            baselineValue: finiteNumber(snapshot.derived.hrv28dMedian),
            scaleValue: medianScale,
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
            [meanScale, medianScale, logCandidate.scaleValue],
        ),
        measurementProvenance: 'garmin:hrvOvernightAvg',
    };
}

/**
 * HA2 pure feature mapper. It exposes estimator candidates side by side and never chooses a
 * winner or classifies an anomaly. No readiness/rules adapter imports this module.
 */
export function mapRecoverySnapshotToHealthAnomalyFeatures(
    snapshot: DailyRecoverySnapshot,
    history: readonly DailyRecoverySnapshot[] = [],
): HealthAnomalyFeatureSet {
    const baselineVersion = finiteNumber(snapshot.derived.baselineComputationVersion);
    const extracted = extractSignalObservations(snapshot.date, history);
    return {
        date: snapshot.date,
        baselineVersion,
        coreSignals: [
            buildRhrFeatures(snapshot, history, baselineVersion, extracted.rhr),
            buildRespirationFeatures(snapshot, history, baselineVersion, extracted.respiration),
            buildHrvFeatures(snapshot, history, baselineVersion, extracted.hrv),
        ],
    };
}
