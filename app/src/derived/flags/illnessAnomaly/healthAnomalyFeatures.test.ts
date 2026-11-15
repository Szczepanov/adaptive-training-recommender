import { describe, expect, it } from 'vitest';
import type { DailyRecoverySnapshot } from '../../../ledger/models';
import {
    computeActivityMatchedExpectations,
    HEALTH_ANOMALY_NEAR_ZERO_SCALE_EPSILON,
    mapRecoverySnapshotToHealthAnomalyFeatures,
} from './healthAnomalyFeatures';

function isoDay(day: number): string {
    return new Date(Date.UTC(2026, 6, day)).toISOString().slice(0, 10);
}

function makeSnapshot(
    date: string,
    values: {
        rhr?: number | null;
        respiration?: number | null;
        hrv?: number | null;
        baselineVersion?: number;
        rhrMean?: number | null;
        rhrStdev?: number | null;
        rhrMedian?: number | null;
        rhrMad?: number | null;
        respirationMedian?: number | null;
        respirationMad?: number | null;
        hrvMean?: number | null;
        hrvStdev?: number | null;
        hrvMedian?: number | null;
        hrvMad?: number | null;
        yesterdayTraining?: DailyRecoverySnapshot['raw']['yesterdayTraining'];
    } = {},
): DailyRecoverySnapshot {
    return {
        userId: 'u1',
        date,
        source: {
            garminSyncedAt: `${date}T06:00:00Z`,
            sourceSchemaVersion: 3,
            timezone: 'Europe/Warsaw',
            metricDates: { sleep: date },
        },
        raw: {
            sleepScore: null,
            sleepDurationSec: null,
            restingHr: values.rhr ?? null,
            hrvOvernightAvg: values.hrv ?? null,
            hrvStatus: null,
            respirationAvg: values.respiration ?? null,
            bodyBatteryWake: null,
            bodyBatteryChange: null,
            totalSteps: null,
            last3DaysHardSessionsCount: 0,
            yesterdayTraining: values.yesterdayTraining ?? null,
            todayTraining: null,
        },
        derived: {
            baselineComputationVersion: values.baselineVersion ?? 5,
            sleepScore7dAvg: null,
            sleepScore28dAvg: null,
            restingHr7dAvg: null,
            restingHr28dAvg: values.rhrMean ?? null,
            hrv7dAvg: null,
            hrv28dAvg: values.hrvMean ?? null,
            respiration7dAvg: null,
            respiration28dAvg: values.respirationMedian ?? null,
            hrv28dStdev: values.hrvStdev ?? null,
            restingHr28dStdev: values.rhrStdev ?? null,
            sleepScore28dStdev: null,
            respiration28dMad: values.respirationMad ?? null,
            restingHr28dMedian: values.rhrMedian ?? null,
            restingHr28dMad: values.rhrMad ?? null,
            hrv28dMedian: values.hrvMedian ?? null,
            hrv28dMad: values.hrvMad ?? null,
            deltas: {
                sleepScoreVs7d: null,
                sleepScoreVs28d: null,
                restingHrVs7d: null,
                restingHrVs28d: null,
                hrvVs7d: null,
                hrvVs28d: null,
                respirationVs7d: null,
                respirationVs28d: null,
            },
        },
        dataQuality: {
            sleepScoreAvailable: false,
            restingHrAvailable: values.rhr != null,
            hrvAvailable: values.hrv != null,
            baseline7dReady: true,
            baseline28dReady: true,
        },
    } as DailyRecoverySnapshot;
}

function signal(
    snapshot: DailyRecoverySnapshot,
    name: 'rhr' | 'respiration' | 'hrv',
    history: readonly DailyRecoverySnapshot[] = [],
) {
    const result = mapRecoverySnapshotToHealthAnomalyFeatures(snapshot, history);
    const found = result.coreSignals.find(item => item.signal === name);
    if (!found) throw new Error(`missing ${name}`);
    return found;
}

describe('mapRecoverySnapshotToHealthAnomalyFeatures HA2', () => {
    it('exposes RHR mean/stdev and median/MAD candidates without choosing a winner', () => {
        const current = makeSnapshot('2026-07-29', {
            rhr: 56,
            rhrMean: 50,
            rhrStdev: 2,
            rhrMedian: 49,
            rhrMad: 1.5,
        });

        const result = signal(current, 'rhr');
        expect(result.adverseDirection).toBe('high');
        expect(result.candidates).toHaveLength(2);
        expect(result.candidates[0]).toMatchObject({
            estimator: 'mean-stdev-28d',
            status: 'available',
            standardizedDeviation: 3,
        });
        expect(result.candidates[1]).toMatchObject({
            estimator: 'median-mad-28d',
            status: 'available',
        });
        expect(result.candidates[1].standardizedDeviation).toBeCloseTo((56 - 49) / 1.5);
    });

    it('uses respiration median/MAD only for baseline v3+ and preserves selected-sleep provenance', () => {
        const current = makeSnapshot('2026-07-29', {
            respiration: 15.5,
            respirationMedian: 14,
            respirationMad: 0.5,
            baselineVersion: 5,
        });
        const compatible = signal(current, 'respiration');
        expect(compatible.candidates[0]).toMatchObject({
            estimator: 'median-mad-28d',
            status: 'available',
            baselineValue: 14,
            scaleValue: 0.5,
            standardizedDeviation: 3,
        });
        expect(compatible.measurementProvenance).toBe('garmin:sleep:2026-07-29');

        const legacy = makeSnapshot('2026-07-29', {
            respiration: 15.5,
            respirationMedian: 14,
            respirationMad: 0.5,
            baselineVersion: 2,
        });
        expect(signal(legacy, 'respiration').candidates[0]).toMatchObject({
            status: 'unavailable',
            unavailableReason: 'incompatible_baseline_version',
            standardizedDeviation: null,
        });
    });

    it('fails current respiration closed when selected sleep belongs to another date', () => {
        const current = makeSnapshot('2026-07-29', {
            respiration: 15.5,
            respirationMedian: 14,
            respirationMad: 0.5,
        });
        current.source.metricDates = { sleep: '2026-07-28' };

        const result = signal(current, 'respiration');
        expect(result.dataQuality.currentValueMissing).toBe(true);
        expect(result.measurementProvenance).toBe('garmin:sleep:2026-07-28');
        expect(result.candidates[0]).toMatchObject({
            status: 'unavailable',
            unavailableReason: 'missing_current',
            standardizedDeviation: null,
        });
    });

    it('keys respiration history by selected sleep date and does not double-count a fallback night', () => {
        const current = makeSnapshot('2026-07-29', {
            respiration: 14.8,
            respirationMedian: 14,
            respirationMad: 0.4,
        });
        const first = makeSnapshot('2026-07-27', { respiration: 14.0 });
        const fallback = makeSnapshot('2026-07-28', { respiration: 14.2 });
        fallback.source.metricDates = { sleep: '2026-07-27' };

        const result = signal(current, 'respiration', [first, fallback]);
        expect(result.dataQuality).toMatchObject({
            historyCount: 1,
            recentDayCoverage: 1 / 7,
            baselineAgeDays: 2,
        });
    });

    it('adds a natural-log HRV candidate from prior days and excludes the current day', () => {
        const current = makeSnapshot('2026-07-29', {
            hrv: 75,
            hrvMean: 55,
            hrvStdev: 8,
            hrvMedian: 54,
            hrvMad: 7,
        });
        const priorValues = Array.from({ length: 14 }, (_, index) => 48 + index);
        const history = priorValues.map((hrv, index) => makeSnapshot(isoDay(15 + index), { hrv }));
        // A caller mistake: include today's row with an extreme value. It must be discarded.
        history.push(makeSnapshot('2026-07-29', { hrv: 1 }));

        const result = signal(current, 'hrv', history);
        const logCandidate = result.candidates.find(
            candidate => candidate.estimator === 'log-mean-stdev-28d',
        );
        const expected = priorValues.reduce((total, value) => total + Math.log(value), 0)
            / priorValues.length;

        expect(logCandidate).toBeDefined();
        expect(logCandidate?.status).toBe('available');
        expect(logCandidate?.baselineValue).toBeCloseTo(expected, 10);
        expect(logCandidate?.currentValue).toBeCloseTo(Math.log(75), 10);
        expect(result.dataQuality.historyCount).toBe(14);
        expect(result.dataQuality.baselineAgeDays).toBe(1);
    });

    it('fails closed on zero/near-zero scale and never emits infinite evidence', () => {
        const current = makeSnapshot('2026-07-29', {
            rhr: 50,
            rhrMean: 50,
            rhrStdev: HEALTH_ANOMALY_NEAR_ZERO_SCALE_EPSILON / 2,
            rhrMedian: 50,
            rhrMad: 0,
        });
        const history = Array.from({ length: 14 }, (_, index) => (
            makeSnapshot(isoDay(15 + index), { rhr: 50 })
        ));

        const result = signal(current, 'rhr', history);
        for (const candidate of result.candidates) {
            expect(candidate.status).toBe('unavailable');
            expect(candidate.unavailableReason).toBe('near_zero_scale');
            expect(candidate.standardizedDeviation).toBeNull();
            expect(candidate.deltaValue).toBeNull();
        }
        expect(result.dataQuality.zeroOrNearZeroScale).toBe(true);
        expect(result.dataQuality.suspectedQuantizationOrTies).toBe(true);
    });

    it('reports signal-specific history coverage and missingness instead of fabricating normal', () => {
        const current = makeSnapshot('2026-07-29', {
            respiration: null,
            respirationMedian: 14,
            respirationMad: 0.4,
        });
        const history = [
            makeSnapshot('2026-07-22', { respiration: 14 }),
            makeSnapshot('2026-07-24', { respiration: 14 }),
            makeSnapshot('2026-07-28', { respiration: 14.5 }),
        ];

        const result = signal(current, 'respiration', history);
        expect(result.dataQuality).toMatchObject({
            historyCount: 3,
            recentDayCoverage: 3 / 7,
            baselineWindowStart: '2026-07-01',
            baselineWindowEndExclusive: '2026-07-29',
            baselineAgeDays: 1,
            currentValueMissing: true,
        });
        expect(result.candidates[0]).toMatchObject({
            status: 'unavailable',
            unavailableReason: 'missing_current',
            standardizedDeviation: null,
        });
    });

    it('requires enough positive history before the log-HRV candidate becomes available', () => {
        const current = makeSnapshot('2026-07-29', {
            hrv: 60,
            hrvMean: 55,
            hrvStdev: 5,
            hrvMedian: 55,
            hrvMad: 5,
        });
        const history = Array.from({ length: 13 }, (_, index) => (
            makeSnapshot(isoDay(16 + index), { hrv: 50 + index })
        ));

        const logCandidate = signal(current, 'hrv', history).candidates.find(
            candidate => candidate.estimator === 'log-mean-stdev-28d',
        );
        expect(logCandidate).toMatchObject({
            status: 'unavailable',
            unavailableReason: 'insufficient_history',
            standardizedDeviation: null,
        });
    });

    it('causally excludes contaminated illness days so clean baseline and scale remain unshifted', () => {
        const cleanDates = Array.from({ length: 14 }, (_, index) => isoDay(10 + index));
        const contaminatedDates = [isoDay(24), isoDay(25), isoDay(26)];
        const currentDate = isoDay(27);
        const history: DailyRecoverySnapshot[] = [
            ...cleanDates.map((date, idx) => makeSnapshot(date, {
                rhr: 49 + (idx % 3),
                respiration: 13.8 + (idx % 3) * 0.2,
                hrv: 68 + (idx % 3) * 2,
            })),
            // Contaminated illness days with elevated RHR/respiration and suppressed HRV
            ...contaminatedDates.map(date => makeSnapshot(date, {
                rhr: 66,
                respiration: 18.0,
                hrv: 32,
            })),
            // Future contaminated date must be ignored by causal filter
            makeSnapshot(isoDay(28), { rhr: 70, respiration: 19, hrv: 25 }),
        ];

        // Simulated backend snapshot derived stats polluted by the 3 contaminated days
        const current = makeSnapshot(currentDate, {
            rhr: 55,
            rhrMean: 52.8,
            rhrStdev: 5.7,
            respiration: 15.0,
            respirationMedian: 14.3,
            respirationMad: 0.9,
            hrv: 52,
            hrvMean: 62,
            hrvStdev: 14,
        });

        const features = mapRecoverySnapshotToHealthAnomalyFeatures(current, history, {
            contaminatedDates: [...contaminatedDates, currentDate, isoDay(28)],
        });
        const rhr = features.coreSignals.find(s => s.signal === 'rhr')!;
        const meanCand = rhr.candidates.find(c => c.estimator === 'mean-stdev-28d')!;
        expect(rhr.dataQuality.contaminatedDaysExcluded).toBe(3);
        expect(rhr.dataQuality.historyCount).toBe(14);
        // Clean RHR observations average ~49.93 with stdev < 1 (instead of polluted 52.8 / 5.7)
        expect(meanCand.baselineValue!).toBeCloseTo(49.9286, 3);
        expect(meanCand.scaleValue!).toBeLessThan(1.0);
        expect(meanCand.standardizedDeviation!).toBeGreaterThan(5.0);
    });

    it('preserves observations when excluding contaminated dates would leave fewer than 7 nights', () => {
        const currentDate = isoDay(15);
        const history = [
            ...Array.from({ length: 5 }, (_, i) => makeSnapshot(isoDay(5 + i), { rhr: 50 })),
            ...Array.from({ length: 4 }, (_, i) => makeSnapshot(isoDay(10 + i), { rhr: 62 })),
        ];
        const current = makeSnapshot(currentDate, { rhr: 54, rhrMean: 55, rhrStdev: 6 });

        const features = mapRecoverySnapshotToHealthAnomalyFeatures(current, history, {
            contaminatedDates: Array.from({ length: 4 }, (_, i) => isoDay(10 + i)),
        });
        const rhr = features.coreSignals.find(s => s.signal === 'rhr')!;
        expect(rhr.dataQuality.contaminatedDaysExcluded).toBe(0);
        expect(rhr.dataQuality.historyCount).toBe(9);
        expect(rhr.dataQuality.baselineMaturity).toBe('emerging');
    });

    it('computes emerging 7-13d baselines from observations when derived baselines are null', () => {
        const currentDate = isoDay(20);
        const history = Array.from({ length: 9 }, (_, i) => makeSnapshot(isoDay(10 + i), {
            rhr: 49 + (i % 3),
            respiration: 13.8 + (i % 3) * 0.2,
            hrv: 68 + (i % 3) * 2,
        }));
        const current = makeSnapshot(currentDate, {
            rhr: 54,
            respiration: 15.2,
            hrv: 56,
        });

        const features = mapRecoverySnapshotToHealthAnomalyFeatures(current, history);
        const rhr = features.coreSignals.find(s => s.signal === 'rhr')!;
        const hrv = features.coreSignals.find(s => s.signal === 'hrv')!;
        expect(rhr.dataQuality.baselineMaturity).toBe('emerging');
        expect(rhr.candidates.find(c => c.estimator === 'mean-stdev-28d')?.status).toBe('available');
        expect(hrv.candidates.find(c => c.estimator === 'mean-stdev-28d')?.status).toBe('available');
        expect(hrv.candidates.find(c => c.estimator === 'log-mean-stdev-28d')?.unavailableReason).toBe('insufficient_history');
    });

    it('applies empirical-Bayes shrinkage (K=5) for activity-matched expectations', () => {
        const easyDay = {
            activityCount: 1,
            totalDurationMin: 40,
            hardActivityCount: 0,
            highCostActivityCount: 0,
            primaryActivity: {
                activityId: 1,
                type: 'Running',
                durationMin: 40,
                trainingEffect: 2.2,
                intensityTag: 'easy',
                sessionCost: 'moderate' as const,
            },
        };
        const hardDay = {
            activityCount: 1,
            totalDurationMin: 75,
            hardActivityCount: 1,
            highCostActivityCount: 1,
            primaryActivity: {
                activityId: 2,
                type: 'Running',
                durationMin: 75,
                trainingEffect: 4.1,
                intensityTag: 'hard',
                sessionCost: 'high' as const,
            },
        };
        const history: DailyRecoverySnapshot[] = [
            // 10 post-easy nights at RHR=48
            ...Array.from({ length: 10 }, (_, i) => makeSnapshot(isoDay(1 + i), {
                rhr: 48,
                hrv: 72,
                respiration: 14,
                yesterdayTraining: easyDay,
            })),
            // 5 post-hard nights at RHR=54
            ...Array.from({ length: 5 }, (_, i) => makeSnapshot(isoDay(11 + i), {
                rhr: 54,
                hrv: 60,
                respiration: 14,
                yesterdayTraining: hardDay,
            })),
        ];

        // Post-hard night: unconditional baseline=50, stdev=2, post-hard stratum mean=54 (n=5),
        // shrunk expectation = (5*54 + 5*50)/(5+5) = 52.
        const withinExpectedSnapshot = makeSnapshot(isoDay(20), {
            rhr: 53,
            rhrMean: 50,
            rhrStdev: 2,
            yesterdayTraining: hardDay,
        });
        const matchedWithin = computeActivityMatchedExpectations(withinExpectedSnapshot, history);
        const rhrWithin = matchedWithin.find(e => e.signal === 'rhr')!;
        expect(rhrWithin.stratum).toBe('post_hard_or_high_cost');
        expect(rhrWithin.stratumSampleCount).toBe(5);
        expect(rhrWithin.unconditionalBaseline).toBe(50);
        expect(rhrWithin.shrunkExpectedValue).toBeCloseTo(52, 5);
        expect(rhrWithin.residualFromExpected).toBeCloseTo(1, 5);
        expect(rhrWithin.residualStandardizedDeviation).toBeCloseTo(0.5, 5);
        expect(rhrWithin.withinExpectedTrainingResponse).toBe(true);

        // Excess post-hard RHR=56 -> residual = +4 (+2.0 SD beyond shrunk expectation)
        const beyondExpectedSnapshot = makeSnapshot(isoDay(20), {
            rhr: 56,
            rhrMean: 50,
            rhrStdev: 2,
            yesterdayTraining: hardDay,
        });
        const featuresBeyond = mapRecoverySnapshotToHealthAnomalyFeatures(beyondExpectedSnapshot, history);
        const rhrBeyond = featuresBeyond.activityMatchedExpectations?.find(e => e.signal === 'rhr');
        expect(rhrBeyond?.withinExpectedTrainingResponse).toBe(false);
        expect(rhrBeyond?.residualStandardizedDeviation).toBeCloseTo(2.0, 5);
    });
});
