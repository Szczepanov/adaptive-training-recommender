import { describe, expect, it } from 'vitest';
import type { DailyRecoverySnapshot } from './models';
import { classifyObjective } from './contextBriefRecoverySynthesis';
import {
    classifyRecoveryMetric,
    evaluateRecoveryBeyondBaseline,
    type RecoveryMetric,
    type RecoveryMetricInput,
} from '../derived/flags/recoveryBeyondBaseline';

/*
 * #1144 PR1-5 frozen oracle (the SEP-B precedent). `classifyObjective` became a renderer over
 * `derived/flags/recoveryBeyondBaseline.ts` results. The pre-extraction implementation is
 * copied below verbatim, with its constants and helpers frozen as literals, and the new path
 * must reproduce its state, detail string and implausible marker over the whole grid.
 * Do not "fix" the oracle: it is the behaviour this refactor promised not to change.
 */

// ---- Frozen oracle: engine/contextBriefRecoverySynthesis.ts and contextBriefRecovery.ts before PR1-5 ----
type FamilyState = 'adverse' | 'reassuring' | 'neutral' | 'unavailable';
type EvidenceFamily = 'subjective' | 'hrv' | 'rhr' | 'sleep';
interface FamilyEvidence {
    family: EvidenceFamily;
    label: string;
    kind: 'athlete_reported' | 'measured_core';
    state: FamilyState;
    detail: string;
}

function round(value: number | null | undefined, places = 1): string {
    if (value === null || value === undefined || !Number.isFinite(value)) return '—';
    const factor = 10 ** places;
    return String(Math.round(value * factor) / factor);
}

function signed(value: number | null | undefined, places = 1): string {
    if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
    const rounded = Math.round(value * 10 ** places) / 10 ** places;
    return rounded > 0 ? `+${rounded}` : String(rounded);
}

const PHYSIOLOGICAL_BOUNDS = {
    hrv: { min: 8, max: 300 },
    rhr: { min: 28, max: 140 },
    sleepScore: { min: 0, max: 100 },
} as const;

const HRV_SD_FLOOR_MS = 3;
const RHR_SD_FLOOR_BPM = 1.5;
const SLEEP_SD_FLOOR_PTS = 4;
const SLEEP_SCORE_ABSOLUTE_FLOOR = 50;

const isNum = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

function plausible(value: number, bounds: { min: number; max: number }): boolean {
    return value >= bounds.min && value <= bounds.max;
}

interface ObjectiveSpec {
    family: Exclude<EvidenceFamily, 'subjective'>;
    label: string;
    unit: string;
    current: number | null;
    delta7d: number | null | undefined;
    sd28d: number | null | undefined;
    sdFloor: number;
    /** +1 when a higher value is adverse (RHR), -1 when a lower value is adverse. */
    adverseSign: 1 | -1;
    bounds: { min: number; max: number };
}

interface ObjectiveResult { evidence: FamilyEvidence; implausible: boolean }

function oracleClassifyObjective(spec: ObjectiveSpec, metricDate: string, asOfDate: string): ObjectiveResult {
    const base = { family: spec.family, label: spec.label, kind: 'measured_core' as const };
    const out = (state: FamilyState, detail: string, implausible = false): ObjectiveResult =>
        ({ evidence: { ...base, state, detail }, implausible });
    if (!isNum(spec.current)) return out('unavailable', `not recorded (metric date ${metricDate})`);
    if (metricDate !== asOfDate) {
        return out('unavailable', `${round(spec.current)} ${spec.unit} is dated ${metricDate}, not ${asOfDate} (provider fallback) — stale, not read as current recovery`);
    }
    if (!plausible(spec.current, spec.bounds)) {
        return out('unavailable', `${round(spec.current)} ${spec.unit} is outside the plausible range; ignored`, true);
    }
    if (spec.family === 'sleep' && spec.current < SLEEP_SCORE_ABSOLUTE_FLOOR) {
        return out('adverse', `${round(spec.current)} ${spec.unit} on ${metricDate}, below the absolute floor of ${SLEEP_SCORE_ABSOLUTE_FLOOR}`);
    }
    if (!isNum(spec.delta7d)) return out('unavailable', `${round(spec.current)} ${spec.unit} on ${metricDate}; no 7d baseline delta`);
    const band = Math.max(isNum(spec.sd28d) ? spec.sd28d : spec.sdFloor, spec.sdFloor);
    const where = `${round(spec.current)} ${spec.unit} on ${metricDate}, ${signed(spec.delta7d)} vs 7d (usual variation ±${round(band)})`;
    if (Math.abs(spec.delta7d) < band) return out('reassuring', `${where} — at baseline`);
    const adverse = spec.adverseSign * spec.delta7d > 0;
    return out(adverse ? 'adverse' : 'reassuring', `${where} — ${adverse ? 'adverse' : 'favorable'} vs baseline`);
}

const ORACLE_SPECS: Record<RecoveryMetric, Omit<ObjectiveSpec, 'current' | 'delta7d' | 'sd28d'>> = {
    hrv: { family: 'hrv', label: 'HRV (overnight)', unit: 'ms', sdFloor: HRV_SD_FLOOR_MS, adverseSign: -1, bounds: PHYSIOLOGICAL_BOUNDS.hrv },
    rhr: { family: 'rhr', label: 'Resting HR', unit: 'bpm', sdFloor: RHR_SD_FLOOR_BPM, adverseSign: 1, bounds: PHYSIOLOGICAL_BOUNDS.rhr },
    sleep: { family: 'sleep', label: 'Sleep score', unit: 'pts', sdFloor: SLEEP_SD_FLOOR_PTS, adverseSign: -1, bounds: PHYSIOLOGICAL_BOUNDS.sleepScore },
};
// ---- End of frozen oracle ----

const AS_OF = '2026-09-25';
const D_MINUS_1 = '2026-09-24';

type Maybe = number | null | undefined;

const CURRENTS: Record<RecoveryMetric, Maybe[]> = {
    hrv: [null, undefined, Number.NaN, Number.POSITIVE_INFINITY, 7.9, 8, 62, 62.44, 300, 300.1, 5000],
    rhr: [null, undefined, Number.NaN, 27.9, 28, 48, 48.06, 140, 141],
    sleep: [null, undefined, Number.NaN, -1, 0, 12.35, 49, 49.99, 50, 78, 100, 100.5],
};

const DELTAS: Record<RecoveryMetric, Maybe[]> = {
    hrv: [null, undefined, Number.NaN, 0, -0.04, 2.7, -2.7, 3, -3, 5.99, -6, 6.01, -12.36, 20],
    rhr: [null, undefined, Number.NaN, 0, 1.35, -1.35, 1.5, -1.5, 2, -2, 2.49, 6, -6],
    sleep: [null, undefined, Number.NaN, 0, 3.6, -3.6, 4, -4, 5.99, -6, 6.01, -15.25],
};

const SDS: Record<RecoveryMetric, Maybe[]> = {
    hrv: [null, undefined, Number.NaN, 0, 2.99, 3, 6, 6.04],
    rhr: [null, undefined, Number.NaN, 1, 1.5, 2, 2.49],
    sleep: [null, undefined, Number.NaN, 3.9, 4, 6, 7.83],
};

interface GridPoint { metric: RecoveryMetric; input: RecoveryMetricInput }

function grid(): GridPoint[] {
    const points: GridPoint[] = [];
    for (const metric of ['hrv', 'rhr', 'sleep'] as const) {
        for (const current of CURRENTS[metric]) {
            for (const delta7d of DELTAS[metric]) {
                for (const sd28d of SDS[metric]) {
                    for (const metricDate of [AS_OF, D_MINUS_1]) {
                        points.push({ metric, input: { current, delta7d, sd28d, metricDate } });
                    }
                }
            }
        }
    }
    return points;
}

function oracleFor({ metric, input }: GridPoint): ObjectiveResult {
    // The old spec typed `current` as number | null; undefined reached it the same way at runtime.
    const spec: ObjectiveSpec = { ...ORACLE_SPECS[metric], current: input.current as number | null, delta7d: input.delta7d, sd28d: input.sd28d };
    return oracleClassifyObjective(spec, input.metricDate, AS_OF);
}

describe('classifyObjective frozen oracle (#1144 PR1-5)', () => {
    const points = grid();

    it('covers every reason the oracle can produce, including missing metrics', () => {
        const details = points.map(point => oracleFor(point).evidence.detail);
        expect(points.length).toBeGreaterThan(5000);
        for (const fragment of ['not recorded', 'provider fallback', 'plausible range', 'absolute floor', 'no 7d baseline delta', 'at baseline', 'adverse vs baseline', 'favorable vs baseline']) {
            expect(details.some(detail => detail.includes(fragment))).toBe(true);
        }
    });

    it('renders identical evidence (state, detail, implausible) over the whole grid', () => {
        const mismatches = points
            .map(point => ({ point, expected: oracleFor(point), actual: classifyObjective(classifyRecoveryMetric(point.metric, point.input, AS_OF), AS_OF) }))
            .filter(({ expected, actual }) => JSON.stringify(expected) !== JSON.stringify(actual));
        expect(mismatches.slice(0, 5)).toEqual([]);
    });

    it('maps the oracle family state onto the derived adverse verdict and ledger state', () => {
        for (const point of points) {
            const expected = oracleFor(point);
            const result = classifyRecoveryMetric(point.metric, point.input, AS_OF);
            const verdict = expected.evidence.state === 'unavailable' ? null : expected.evidence.state === 'adverse';
            expect(result.adverse).toBe(verdict);
            expect(result.state === 'measured').toBe(verdict !== null);
            if (!isNum(point.input.current)) {
                expect(result).toMatchObject({ state: 'missing', reasonCode: 'not_recorded', current: null });
            }
            if (expected.implausible) expect(result.state).toBe('invalid');
        }
    });
});

function snapshot(metrics: Record<RecoveryMetric, Pick<RecoveryMetricInput, 'current' | 'delta7d'>>): DailyRecoverySnapshot {
    return {
        userId: 'u1', date: AS_OF,
        source: { garminSyncedAt: `${AS_OF}T06:15:00Z`, sourceSchemaVersion: 3 },
        raw: {
            sleepScore: metrics.sleep.current as number | null, sleepDurationSec: 27000,
            restingHr: metrics.rhr.current as number | null, hrvOvernightAvg: metrics.hrv.current as number | null,
            hrvStatus: 'balanced', respirationAvg: 13, bodyBatteryWake: 80, bodyBatteryChange: 40,
            totalSteps: 9000, last3DaysHardSessionsCount: 0, yesterdayTraining: null,
        },
        derived: {
            baselineComputationVersion: 2,
            sleepScore7dAvg: 78, sleepScore28dAvg: 78, restingHr7dAvg: 48, restingHr28dAvg: 48,
            hrv7dAvg: 62, hrv28dAvg: 62, respiration7dAvg: 13, respiration28dAvg: 13,
            hrv28dStdev: null, restingHr28dStdev: null, sleepScore28dStdev: null,
            deltas: {
                sleepScoreVs7d: metrics.sleep.delta7d as number | null, sleepScoreVs28d: 0,
                restingHrVs7d: metrics.rhr.delta7d as number | null, restingHrVs28d: 0,
                hrvVs7d: metrics.hrv.delta7d as number | null, hrvVs28d: 0,
                respirationVs7d: 0, respirationVs28d: 0,
            },
        },
        dataQuality: {
            sleepScoreAvailable: true, restingHrAvailable: true, hrvAvailable: true,
            baseline7dReady: true, baseline28dReady: true,
        },
    } as DailyRecoverySnapshot;
}

describe('recovery_beyond_baseline flag over the oracle (#1144 PR1-5, owner decision Q4)', () => {
    // Per metric: missing, no delta, at baseline, adverse, favorable.
    const scenarios: Record<RecoveryMetric, Array<Pick<RecoveryMetricInput, 'current' | 'delta7d'>>> = {
        hrv: [{ current: null, delta7d: null }, { current: 62, delta7d: null }, { current: 62, delta7d: 1 }, { current: 50, delta7d: -12 }, { current: 70, delta7d: 8 }],
        rhr: [{ current: null, delta7d: null }, { current: 48, delta7d: undefined }, { current: 48, delta7d: 0.5 }, { current: 55, delta7d: 6 }, { current: 44, delta7d: -4 }],
        sleep: [{ current: null, delta7d: null }, { current: 78, delta7d: null }, { current: 78, delta7d: 2 }, { current: 45, delta7d: null }, { current: 90, delta7d: 12 }],
    };

    it('is active iff any metric is adverse; a negative needs every metric judged, otherwise active null with an explicit state', () => {
        let cases = 0;
        for (const hrv of scenarios.hrv) {
            for (const rhr of scenarios.rhr) {
                for (const sleep of scenarios.sleep) {
                    const { flag, metrics } = evaluateRecoveryBeyondBaseline(snapshot({ hrv, rhr, sleep }), AS_OF);
                    const oracle = (['hrv', 'rhr', 'sleep'] as const).map(metric => oracleFor({
                        metric,
                        input: { ...{ hrv, rhr, sleep }[metric], sd28d: null, metricDate: AS_OF },
                    }).evidence);
                    const expected = oracle.some(evidence => evidence.state === 'adverse') ? true
                        : oracle.every(evidence => evidence.state !== 'unavailable') ? false : null;
                    // Unjudged here is either not recorded (missing) or recorded without a delta (unavailable, the worse state).
                    const unjudgedState = oracle.some(evidence => evidence.detail.includes('no 7d baseline delta')) ? 'unavailable' : 'missing';
                    expect(flag.active).toBe(expected);
                    expect(flag.state).toBe(expected === null ? unjudgedState : 'measured');
                    expect(metrics.map(result => result.metric)).toEqual(['hrv', 'rhr', 'sleep']);
                    cases += 1;
                }
            }
        }
        expect(cases).toBe(125);
    });

    it('reports every metric missing, with active null, when none is recorded', () => {
        const none = { current: null, delta7d: null };
        const { flag, metrics } = evaluateRecoveryBeyondBaseline(snapshot({ hrv: none, rhr: none, sleep: none }), AS_OF);
        expect(flag).toMatchObject({ id: 'recovery_beyond_baseline', active: null, state: 'missing', reasonCode: 'no_judged_metric' });
        expect(metrics.map(result => [result.state, result.reasonCode])).toEqual([
            ['missing', 'not_recorded'], ['missing', 'not_recorded'], ['missing', 'not_recorded'],
        ]);
        expect(flag.inputs.map(input => input.value.state)).toEqual(['missing', 'missing', 'missing']);
    });
});
