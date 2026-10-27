import { describe, expect, it } from 'vitest';
import type { DailyRecoverySnapshot } from '../../ledger/models';
import {
    classifyRecoveryMetric,
    evaluateRecoveryBeyondBaseline,
    RECOVERY_BEYOND_BASELINE_FLAG_DEFINITION_VERSION,
    RECOVERY_BEYOND_BASELINE_WINDOW,
    RECOVERY_VARIABILITY_FLOORS,
    SLEEP_SCORE_ABSOLUTE_FLOOR,
} from './recoveryBeyondBaseline';

const AS_OF = '2026-09-25';

function snapshot(overrides: {
    date?: string;
    raw?: Partial<DailyRecoverySnapshot['raw']>;
    deltas?: Partial<DailyRecoverySnapshot['derived']['deltas']>;
    sd?: Partial<Pick<DailyRecoverySnapshot['derived'], 'hrv28dStdev' | 'restingHr28dStdev' | 'sleepScore28dStdev'>>;
    quality?: Partial<DailyRecoverySnapshot['dataQuality']>;
    metricDates?: DailyRecoverySnapshot['source']['metricDates'];
} = {}): DailyRecoverySnapshot {
    const date = overrides.date ?? AS_OF;
    return {
        userId: 'u1', date,
        source: { garminSyncedAt: `${date}T06:15:00Z`, sourceSchemaVersion: 3, ...(overrides.metricDates ? { metricDates: overrides.metricDates } : {}) },
        raw: {
            sleepScore: 78, sleepDurationSec: 27000, restingHr: 48, hrvOvernightAvg: 62,
            hrvStatus: 'balanced', respirationAvg: 13, bodyBatteryWake: 80, bodyBatteryChange: 40,
            totalSteps: 9000, last3DaysHardSessionsCount: 0, yesterdayTraining: null,
            ...overrides.raw,
        },
        derived: {
            baselineComputationVersion: 2,
            sleepScore7dAvg: 78, sleepScore28dAvg: 78, restingHr7dAvg: 48, restingHr28dAvg: 48,
            hrv7dAvg: 62, hrv28dAvg: 62, respiration7dAvg: 13, respiration28dAvg: 13,
            hrv28dStdev: 6, restingHr28dStdev: 2, sleepScore28dStdev: 6,
            ...overrides.sd,
            deltas: {
                sleepScoreVs7d: 0, sleepScoreVs28d: 0, restingHrVs7d: 0, restingHrVs28d: 0,
                hrvVs7d: 0, hrvVs28d: 0, respirationVs7d: 0, respirationVs28d: 0,
                ...overrides.deltas,
            },
        },
        dataQuality: {
            sleepScoreAvailable: true, restingHrAvailable: true, hrvAvailable: true,
            baseline7dReady: true, baseline28dReady: true, ...overrides.quality,
        },
    };
}

describe('recovery_beyond_baseline constants', () => {
    it('keeps the variability floors and sleep floor unchanged', () => {
        expect(RECOVERY_VARIABILITY_FLOORS).toEqual({ hrv: 3, rhr: 1.5, sleep: 4 });
        expect(SLEEP_SCORE_ABSOLUTE_FLOOR).toBe(50);
    });
});

describe('classifyRecoveryMetric', () => {
    it('reports the band, its source and the metric date', () => {
        expect(classifyRecoveryMetric('hrv', { current: 50, delta7d: -12, sd28d: 6, metricDate: AS_OF }, AS_OF)).toEqual({
            metric: 'hrv', unit: 'ms', state: 'measured', reasonCode: 'adverse_vs_baseline', adverse: true,
            current: 50, delta7d: -12, band: 6, bandSource: 'personal_28d_stdev', metricDate: AS_OF,
        });
        expect(classifyRecoveryMetric('rhr', { current: 48, delta7d: 1, sd28d: null, metricDate: AS_OF }, AS_OF))
            .toMatchObject({ reasonCode: 'at_baseline', adverse: false, band: 1.5, bandSource: 'variability_floor' });
        expect(classifyRecoveryMetric('rhr', { current: 48, delta7d: 1, sd28d: 1, metricDate: AS_OF }, AS_OF))
            .toMatchObject({ band: 1.5, bandSource: 'variability_floor' });
    });

    it('treats higher RHR and lower HRV/sleep as adverse', () => {
        expect(classifyRecoveryMetric('rhr', { current: 55, delta7d: 6, sd28d: 2, metricDate: AS_OF }, AS_OF).reasonCode).toBe('adverse_vs_baseline');
        expect(classifyRecoveryMetric('rhr', { current: 44, delta7d: -6, sd28d: 2, metricDate: AS_OF }, AS_OF).reasonCode).toBe('favorable_vs_baseline');
        expect(classifyRecoveryMetric('sleep', { current: 60, delta7d: -10, sd28d: 6, metricDate: AS_OF }, AS_OF).reasonCode).toBe('adverse_vs_baseline');
        expect(classifyRecoveryMetric('hrv', { current: 70, delta7d: 8, sd28d: 6, metricDate: AS_OF }, AS_OF).reasonCode).toBe('favorable_vs_baseline');
    });

    it('never reads a missing, fallback-dated or implausible value as normal', () => {
        expect(classifyRecoveryMetric('hrv', { current: null, delta7d: 0, sd28d: 6, metricDate: AS_OF }, AS_OF))
            .toMatchObject({ state: 'missing', reasonCode: 'not_recorded', adverse: null, current: null });
        expect(classifyRecoveryMetric('rhr', { current: 48, delta7d: 0, sd28d: 2, metricDate: '2026-09-24' }, AS_OF))
            .toMatchObject({ state: 'stale', reasonCode: 'stale_metric_date', adverse: null, metricDate: '2026-09-24' });
        expect(classifyRecoveryMetric('hrv', { current: 500, delta7d: 0, sd28d: 6, metricDate: AS_OF }, AS_OF))
            .toMatchObject({ state: 'invalid', reasonCode: 'implausible', adverse: null });
        expect(classifyRecoveryMetric('sleep', { current: 78, delta7d: undefined, sd28d: 6, metricDate: AS_OF }, AS_OF))
            .toMatchObject({ state: 'unavailable', reasonCode: 'no_baseline_delta', adverse: null, band: null, bandSource: null });
    });

    it('makes a sleep score below 50 adverse even without a baseline delta', () => {
        expect(classifyRecoveryMetric('sleep', { current: 49, delta7d: null, sd28d: null, metricDate: AS_OF }, AS_OF))
            .toMatchObject({ state: 'measured', reasonCode: 'below_absolute_floor', adverse: true });
        expect(classifyRecoveryMetric('sleep', { current: 50, delta7d: null, sd28d: null, metricDate: AS_OF }, AS_OF).reasonCode)
            .toBe('no_baseline_delta');
    });
});

describe('evaluateRecoveryBeyondBaseline', () => {
    it('cannot evaluate without a snapshot', () => {
        const { flag, metrics } = evaluateRecoveryBeyondBaseline(null, AS_OF);
        expect(flag).toMatchObject({ id: 'recovery_beyond_baseline', active: null, state: 'missing', reasonCode: 'no_snapshot' });
        expect(flag.definitionVersion).toBe(RECOVERY_BEYOND_BASELINE_FLAG_DEFINITION_VERSION);
        expect(metrics).toEqual([]);
    });

    it('cannot evaluate a stale snapshot or an immature baseline', () => {
        expect(evaluateRecoveryBeyondBaseline(snapshot({ date: '2026-09-23' }), AS_OF).flag)
            .toMatchObject({ active: null, state: 'stale', reasonCode: 'snapshot_stale' });
        expect(evaluateRecoveryBeyondBaseline(snapshot({ quality: { baseline7dReady: false, baseline28dReady: false } }), AS_OF).flag)
            .toMatchObject({ active: null, state: 'unavailable', reasonCode: 'baseline_immature' });
        expect(evaluateRecoveryBeyondBaseline(snapshot({ quality: { baseline28dReady: false } }), AS_OF).flag)
            .toMatchObject({ active: false, state: 'measured' });
    });

    it('is not active when every metric is at baseline', () => {
        const { flag, metrics } = evaluateRecoveryBeyondBaseline(snapshot(), AS_OF);
        expect(flag).toMatchObject({ active: false, state: 'measured', reasonCode: 'none_adverse' });
        expect(metrics.map(result => result.reasonCode)).toEqual(['at_baseline', 'at_baseline', 'at_baseline']);
        expect(flag.threshold).toContain('below 50');
    });

    it('is active when any single metric is adverse, naming every adverse metric', () => {
        expect(evaluateRecoveryBeyondBaseline(snapshot({ deltas: { restingHrVs7d: 6 } }), AS_OF).flag)
            .toMatchObject({ active: true, reasonCode: 'adverse:rhr' });
        expect(evaluateRecoveryBeyondBaseline(snapshot({ raw: { sleepScore: 40 }, deltas: { hrvVs7d: -12 } }), AS_OF).flag)
            .toMatchObject({ active: true, reasonCode: 'adverse:hrv+sleep' });
    });

    it('dates each metric by source.metricDates, so a D-1 fallback is stale, not current', () => {
        const { flag, metrics } = evaluateRecoveryBeyondBaseline(
            snapshot({ deltas: { restingHrVs7d: 6 }, metricDates: { restingHr: '2026-09-24' } }),
            AS_OF,
        );
        expect(metrics[1]).toMatchObject({ metric: 'rhr', state: 'stale', metricDate: '2026-09-24' });
        expect(flag).toMatchObject({ active: null, state: 'stale', reasonCode: 'incomplete_none_adverse' });
        expect(flag.inputs[1]).toEqual({
            name: 'rhr',
            value: { value: 48, unit: 'bpm', source: 'daily_recovery_snapshot', state: 'stale', observedOn: '2026-09-24' },
        });
    });

    it('does not read stale adverse-looking metrics as a measured negative (review #1174)', () => {
        // HRV measured at baseline; RHR +10 bpm and sleep 40 are D-1 provider fallbacks.
        const { flag, metrics } = evaluateRecoveryBeyondBaseline(
            snapshot({ raw: { sleepScore: 40 }, deltas: { restingHrVs7d: 10 }, metricDates: { restingHr: '2026-09-24', sleep: '2026-09-24' } }),
            AS_OF,
        );
        expect(metrics.map(result => result.state)).toEqual(['measured', 'stale', 'stale']);
        expect(flag).toMatchObject({ active: null, state: 'stale', reasonCode: 'incomplete_none_adverse' });
    });

    it('derives the incomplete state from the unjudged metrics, worst first', () => {
        const staleAndMissing = evaluateRecoveryBeyondBaseline(
            snapshot({ raw: { restingHr: null }, metricDates: { sleep: '2026-09-24' } }),
            AS_OF,
        ).flag;
        expect(staleAndMissing).toMatchObject({ active: null, state: 'missing', reasonCode: 'incomplete_none_adverse' });
        const invalid = evaluateRecoveryBeyondBaseline(snapshot({ raw: { hrvOvernightAvg: 500 } }), AS_OF).flag;
        expect(invalid).toMatchObject({ active: null, state: 'invalid', reasonCode: 'incomplete_none_adverse' });
        const noDelta = evaluateRecoveryBeyondBaseline(snapshot({ deltas: { sleepScoreVs7d: null } }), AS_OF).flag;
        expect(noDelta).toMatchObject({ active: null, state: 'unavailable', reasonCode: 'incomplete_none_adverse' });
    });

    it('derives the no-judged-metric state from the inputs instead of always missing', () => {
        const allStale = evaluateRecoveryBeyondBaseline(
            snapshot({ metricDates: { hrv: '2026-09-24', restingHr: '2026-09-24', sleep: '2026-09-24' } }),
            AS_OF,
        ).flag;
        expect(allStale).toMatchObject({ active: null, state: 'stale', reasonCode: 'no_judged_metric' });
        const mixed = evaluateRecoveryBeyondBaseline(
            snapshot({ raw: { hrvOvernightAvg: null, restingHr: 500 }, metricDates: { sleep: '2026-09-24' } }),
            AS_OF,
        ).flag;
        expect(mixed).toMatchObject({ active: null, state: 'invalid', reasonCode: 'no_judged_metric' });
    });

    it('states the D-1 and 7d-only semantics in its threshold and window', () => {
        const { flag } = evaluateRecoveryBeyondBaseline(snapshot(), AS_OF);
        expect(flag.threshold).toContain('D-1');
        expect(flag.threshold).toContain('28-day drift');
        expect(RECOVERY_BEYOND_BASELINE_WINDOW).toContain('excludes the 28-day chronic-drift term');
    });

    it('stays active when one metric is adverse and the others are stale', () => {
        const { flag } = evaluateRecoveryBeyondBaseline(
            snapshot({ deltas: { hrvVs7d: -12 }, metricDates: { restingHr: '2026-09-24', sleep: '2026-09-24' } }),
            AS_OF,
        );
        expect(flag).toMatchObject({ active: true, state: 'measured', reasonCode: 'adverse:hrv' });
    });

    it('stays active when one metric is adverse and the others are missing', () => {
        const { flag } = evaluateRecoveryBeyondBaseline(
            snapshot({ raw: { hrvOvernightAvg: null, restingHr: null }, deltas: { sleepScoreVs7d: -10 } }),
            AS_OF,
        );
        expect(flag).toMatchObject({ active: true, state: 'measured', reasonCode: 'adverse:sleep' });
    });
});
