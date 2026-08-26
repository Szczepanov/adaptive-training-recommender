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
    sampleCount: number;
    isCollinear: boolean; // |r| >= 0.70
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
    varianceReductionRatio: number; // chronicVariance / acuteVariance
    dampingEfficiencyPct: number;
}

function meanAndStd(values: readonly number[]): { mean: number; std: number } {
    if (values.length === 0) return { mean: 0, std: 0 };
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
    const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (values.length > 1 ? values.length - 1 : 1);
    return { mean, std: Math.sqrt(variance) };
}

export function computePearsonCorrelation(
    xs: readonly number[],
    ys: readonly number[],
): number | null {
    if (xs.length !== ys.length || xs.length < 3) return null;
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
    return Math.round((numerator / denominator) * 1000) / 1000;
}

export function computeSignalCorrelationMatrix(
    rows: readonly SignalObservationRow[],
    collinearityThreshold = 0.70,
): CorrelationMatrixReport {
    const keys: readonly HealthSignalKey[] = [
        'hrv',
        'restingHr',
        'sleepScore',
        'respiration',
        'trainingLoad',
        'soreness',
        'readiness',
    ];

    const correlations: PairwiseCorrelation[] = [];
    const collinearPairs: { signalA: HealthSignalKey; signalB: HealthSignalKey; r: number }[] = [];

    for (let i = 0; i < keys.length; i++) {
        for (let j = i + 1; j < keys.length; j++) {
            const sigA = keys[i];
            const sigB = keys[j];

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
            const r = computePearsonCorrelation(xs, ys);

            const isCollinear = r !== null && Math.abs(r) >= collinearityThreshold;
            correlations.push({
                signalA: sigA,
                signalB: sigB,
                pearsonR: r,
                sampleCount: pairedValues.length,
                isCollinear,
            });

            if (isCollinear && r !== null) {
                collinearPairs.push({ signalA: sigA, signalB: sigB, r });
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
    const keys: readonly HealthSignalKey[] = [
        'hrv',
        'restingHr',
        'sleepScore',
        'respiration',
        'trainingLoad',
        'soreness',
        'readiness',
    ];

    const result = {} as Record<HealthSignalKey, SignalVarianceProfile>;

    for (const key of keys) {
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
                mean: Math.round(mean * 100) / 100,
                stdDev: Math.round(std * 100) / 100,
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
    if (dailyValues.length < chronicWindowDays) {
        return {
            acuteWindowDays,
            chronicWindowDays,
            acuteVariance: 0,
            chronicVariance: 0,
            varianceReductionRatio: 1,
            dampingEfficiencyPct: 0,
        };
    }

    // Rolling acute means
    const acuteRollingMeans: number[] = [];
    for (let i = acuteWindowDays; i <= dailyValues.length; i++) {
        const slice = dailyValues.slice(i - acuteWindowDays, i);
        acuteRollingMeans.push(slice.reduce((a, b) => a + b, 0) / acuteWindowDays);
    }

    // Rolling chronic means
    const chronicRollingMeans: number[] = [];
    for (let i = chronicWindowDays; i <= dailyValues.length; i++) {
        const slice = dailyValues.slice(i - chronicWindowDays, i);
        chronicRollingMeans.push(slice.reduce((a, b) => a + b, 0) / chronicWindowDays);
    }

    const { std: acuteStd } = meanAndStd(acuteRollingMeans);
    const { std: chronicStd } = meanAndStd(chronicRollingMeans);

    const acuteVar = acuteStd ** 2;
    const chronicVar = chronicStd ** 2;
    const ratio = acuteVar > 0 ? chronicVar / acuteVar : 1;
    const dampingPct = Math.max(0, Math.min(100, (1 - ratio) * 100));

    return {
        acuteWindowDays,
        chronicWindowDays,
        acuteVariance: Math.round(acuteVar * 1000) / 1000,
        chronicVariance: Math.round(chronicVar * 1000) / 1000,
        varianceReductionRatio: Math.round(ratio * 1000) / 1000,
        dampingEfficiencyPct: Math.round(dampingPct * 10) / 10,
    };
}
