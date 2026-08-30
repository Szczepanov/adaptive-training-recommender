import { describe, expect, it } from 'vitest';
import type { DailyRecoverySnapshot } from './models';
import {
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
            yesterdayTraining: null,
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
});
