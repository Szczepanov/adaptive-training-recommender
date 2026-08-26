export type HealthSignalKey =
    | 'hrv'
    | 'restingHr'
    | 'sleepScore'
    | 'respiration'
    | 'trainingLoad'
    | 'soreness'
    | 'readiness';

export interface SignalObservationRow {
    date: string;
    signals: Record<HealthSignalKey, number | null>;
}

export interface PairwiseCorrelation {
    signalA: HealthSignalKey;
    signalB: HealthSignalKey;
    pearsonR: number | null;
    normalizedMutualInformation: number | null;
    sampleCount: number;
    isCollinear: boolean; // |r| >= configured threshold
}

export interface CorrelationMatrixReport {
    correlations: readonly PairwiseCorrelation[];
    collinearPairs: readonly { signalA: HealthSignalKey; signalB: HealthSignalKey; r: number }[];
    evaluatedDays: number;
}

export interface SignalVarianceProfile {
    signal: HealthSignalKey;
    mean: number;
    stdDev: number;
    min: number;
    max: number;
    validSamples: number;
}

export interface BaselineStabilityResult {
    acuteWindowDays: number;
    chronicWindowDays: number;
    acuteVariance: number;
    chronicVariance: number;
    /** chronicVariance / acuteVariance; null when acute variance is zero but chronic variance is positive. */
    varianceReductionRatio: number | null;
    dampingEfficiencyPct: number;
    comparisonPoints: number;
    sufficientData: boolean;
}

const SIGNAL_KEYS: readonly HealthSignalKey[] = [
    'hrv',
    'restingHr',
    'sleepScore',
    'respiration',
    'trainingLoad',
    'soreness',
    'readiness',
];

function round(value: number, decimals: number): number {
    const factor = 10 ** decimals;
    return Math.round(value * factor) / factor;
}

function meanAndStd(values: readonly number[]): { mean: number; std: number } {
    if (values.length === 0) return { mean: 0, std: 0 };
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
    const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0)
        / (values.length > 1 ? values.length - 1 : 1);
    return { mean, std: Math.sqrt(variance) };
}

function hasOnlyFiniteValues(values: readonly number[]): boolean {
    return values.every(Number.isFinite);
}

export function computePearsonCorrelation(
    xs: readonly number[],
    ys: readonly number[],
): number | null {
    if (xs.length !== ys.length || xs.length < 3) return null;
    if (!hasOnlyFiniteValues(xs) || !hasOnlyFiniteValues(ys)) return null;

    const n = xs.length;
    const meanX = xs.reduce((a, b) => a + b, 0) / n;
    const meanY = ys.reduce((a, b) => a + b, 0) / n;

    let numerator = 0;
    let denomX = 0;
    let denomY = 0;

    for (let i = 0; i < n; i++) {
        const dx = xs[i] - meanX;
        const dy = ys[i] - meanY;
        numerator += dx * dy;
        denomX += dx * dx;
        denomY += dy * dy;
    }

    const denominator = Math.sqrt(denomX * denomY);
    if (denominator === 0) return null;
    return numerator / denominator;
}

/**
 * Exploratory dependence diagnostic that complements Pearson correlation.
 *
 * Equal-width discretization keeps the estimator deterministic and dependency-free,
 * but the result is sample-size/binning sensitive and must not be interpreted as a
 * causal effect or a calibrated predictive score.
 */
export function estimateNormalizedMutualInformation(
    xs: readonly number[],
    ys: readonly number[],
    binCount = 4,
): number | null {
    if (!Number.isInteger(binCount) || binCount < 2 || binCount > 20) {
        throw new Error('binCount must be an integer between 2 and 20');
    }
    const minimumSamples = Math.max(20, binCount * 4);
    if (xs.length !== ys.length || xs.length < minimumSamples) return null;
    if (!hasOnlyFiniteValues(xs) || !hasOnlyFiniteValues(ys)) return null;

    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    if (minX === maxX || minY === maxY) return null;

    const widthX = (maxX - minX) / binCount;
    const widthY = (maxY - minY) / binCount;
    const countsX = Array.from({ length: binCount }, () => 0);
    const countsY = Array.from({ length: binCount }, () => 0);
    const joint = Array.from({ length: binCount }, () => Array.from({ length: binCount }, () => 0));

    const toBin = (value: number, min: number, width: number): number => Math.min(
        binCount - 1,
        Math.floor((value - min) / width),
    );

    for (let i = 0; i < xs.length; i++) {
        const xBin = toBin(xs[i], minX, widthX);
        const yBin = toBin(ys[i], minY, widthY);
        countsX[xBin] += 1;
        countsY[yBin] += 1;
        joint[xBin][yBin] += 1;
    }

    const n = xs.length;
    const entropy = (counts: readonly number[]): number => counts.reduce((sum, count) => {
        if (count === 0) return sum;
        const p = count / n;
        return sum - p * Math.log(p);
    }, 0);

    const entropyX = entropy(countsX);
    const entropyY = entropy(countsY);
    if (entropyX === 0 || entropyY === 0) return null;

    let mutualInformation = 0;
    for (let xBin = 0; xBin < binCount; xBin++) {
        for (let yBin = 0; yBin < binCount; yBin++) {
            const count = joint[xBin][yBin];
            if (count === 0) continue;
            const pxy = count / n;
            const px = countsX[xBin] / n;
            const py = countsY[yBin] / n;
            mutualInformation += pxy * Math.log(pxy / (px * py));
        }
    }

    const normalized = mutualInformation / Math.sqrt(entropyX * entropyY);
    return round(Math.max(0, Math.min(1, normalized)), 3);
}

export function computeSignalCorrelationMatrix(
    rows: readonly SignalObservationRow[],
    collinearityThreshold = 0.70,
): CorrelationMatrixReport {
    if (!Number.isFinite(collinearityThreshold)
        || collinearityThreshold < 0
        || collinearityThreshold > 1) {
        throw new Error('collinearityThreshold must be between 0 and 1');
    }

    const correlations: PairwiseCorrelation[] = [];
    const collinearPairs: { signalA: HealthSignalKey; signalB: HealthSignalKey; r: number }[] = [];

    for (let i = 0; i < SIGNAL_KEYS.length; i++) {
        for (let j = i + 1; j < SIGNAL_KEYS.length; j++) {
            const sigA = SIGNAL_KEYS[i];
            const sigB = SIGNAL_KEYS[j];

            const pairedValues: { a: number; b: number }[] = [];
            for (const row of rows) {
                const a = row.signals[sigA];
                const b = row.signals[sigB];
                if (a !== null && b !== null && Number.isFinite(a) && Number.isFinite(b)) {
                    pairedValues.push({ a, b });
                }
            }

            const xs = pairedValues.map(p => p.a);
            const ys = pairedValues.map(p => p.b);
            const rawR = computePearsonCorrelation(xs, ys);
            const reportedR = rawR === null ? null : round(rawR, 3);
            const normalizedMutualInformation = estimateNormalizedMutualInformation(xs, ys);

            // Use the unrounded statistic for classification so values such as 0.6996
            // are not promoted to the 0.70 threshold merely by presentation rounding.
            const isCollinear = rawR !== null && Math.abs(rawR) >= collinearityThreshold;
            correlations.push({
                signalA: sigA,
                signalB: sigB,
                pearsonR: reportedR,
                normalizedMutualInformation,
                sampleCount: pairedValues.length,
                isCollinear,
            });

            if (isCollinear && reportedR !== null) {
                collinearPairs.push({ signalA: sigA, signalB: sigB, r: reportedR });
            }
        }
    }

    return {
        correlations,
        collinearPairs,
        evaluatedDays: rows.length,
    };
}

export function evaluateSignalVariances(
    rows: readonly SignalObservationRow[],
): Record<HealthSignalKey, SignalVarianceProfile> {
    const result = {} as Record<HealthSignalKey, SignalVarianceProfile>;

    for (const key of SIGNAL_KEYS) {
        const values = rows
            .map(r => r.signals[key])
            .filter((v): v is number => v !== null && Number.isFinite(v));

        if (values.length === 0) {
            result[key] = {
                signal: key,
                mean: 0,
                stdDev: 0,
                min: 0,
                max: 0,
                validSamples: 0,
            };
        } else {
            const { mean, std } = meanAndStd(values);
            result[key] = {
                signal: key,
                mean: round(mean, 2),
                stdDev: round(std, 2),
                min: Math.min(...values),
                max: Math.max(...values),
                validSamples: values.length,
            };
        }
    }

    return result;
}

export function evaluateBaselineWindowStability(
    dailyValues: readonly number[],
    acuteWindowDays = 7,
    chronicWindowDays = 28,
): BaselineStabilityResult {
    if (!Number.isInteger(acuteWindowDays)
        || !Number.isInteger(chronicWindowDays)
        || acuteWindowDays < 1
        || chronicWindowDays < 2
        || acuteWindowDays >= chronicWindowDays) {
        throw new Error('Window sizes must be positive integers with acuteWindowDays < chronicWindowDays');
    }
    if (!hasOnlyFiniteValues(dailyValues)) {
        throw new Error('dailyValues must contain only finite numbers');
    }

    const comparisonPoints = Math.max(0, dailyValues.length - chronicWindowDays + 1);
    if (comparisonPoints < 2) {
        return {
            acuteWindowDays,
            chronicWindowDays,
            acuteVariance: 0,
            chronicVariance: 0,
            varianceReductionRatio: 1,
            dampingEfficiencyPct: 0,
            comparisonPoints,
            sufficientData: false,
        };
    }

    // Compare the two windows on the same endpoint dates. Starting the acute series
    // earlier than the chronic series changes the sampled time period and can make a
    // trend/regime shift look like "noise damping".
    const acuteRollingMeans: number[] = [];
    const chronicRollingMeans: number[] = [];
    for (let end = chronicWindowDays; end <= dailyValues.length; end++) {
        const acuteSlice = dailyValues.slice(end - acuteWindowDays, end);
        const chronicSlice = dailyValues.slice(end - chronicWindowDays, end);
        acuteRollingMeans.push(acuteSlice.reduce((a, b) => a + b, 0) / acuteWindowDays);
        chronicRollingMeans.push(chronicSlice.reduce((a, b) => a + b, 0) / chronicWindowDays);
    }

    const { std: acuteStd } = meanAndStd(acuteRollingMeans);
    const { std: chronicStd } = meanAndStd(chronicRollingMeans);

    const acuteVar = acuteStd ** 2;
    const chronicVar = chronicStd ** 2;
    const ratio = acuteVar === 0
        ? (chronicVar === 0 ? 1 : null)
        : chronicVar / acuteVar;
    const dampingPct = ratio === null
        ? 0
        : Math.max(0, Math.min(100, (1 - ratio) * 100));

    return {
        acuteWindowDays,
        chronicWindowDays,
        acuteVariance: round(acuteVar, 3),
        chronicVariance: round(chronicVar, 3),
        varianceReductionRatio: ratio === null ? null : round(ratio, 3),
        dampingEfficiencyPct: round(dampingPct, 1),
        comparisonPoints,
        sufficientData: true,
    };
}
