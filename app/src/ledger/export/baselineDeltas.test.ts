import { describe, expect, it } from 'vitest';
import { addDaysToLocalDateString } from '../../utils/localDate.ts';
import { BASELINE_DELTA_KEYS, CHECKIN_BASELINE_KEYS, RECOVERY_BASELINE_KEYS } from './baselineDeltas.ts';
import { buildLedgerExport } from './buildLedgerExport.ts';
import { AS_OF, checkin, fullInput, fullRecords, recoverySnapshot } from './ledgerExportFixtures.testSupport.ts';
import type { DerivedMetric, LedgerExport } from './schema.ts';

const metricsOf = (ledger: LedgerExport, id: DerivedMetric['id']) => ledger.derived.find(metric => metric.id === id)!.metrics!;

function readySnapshot(date = AS_OF, metricDates?: Parameters<typeof recoverySnapshot>[2]) {
    const base = recoverySnapshot(date, {}, metricDates);
    return {
        ...base,
        derived: { ...base.derived, sleepScore28dAvg: 75, restingHr28dAvg: 50, hrv28dAvg: 64.4, respiration28dAvg: 14 },
        dataQuality: { ...base.dataQuality, baseline28dReady: true },
    };
}

/** 28 prior complete check-ins with readiness 8, plus today's readiness 7. */
function checkinHistory() {
    const prior = Array.from({ length: 28 }, (_, i) => checkin(addDaysToLocalDateString(AS_OF, -1 - i), {
        readiness: 8, sleepQuality: 6, fatigue: 3, soreness: 2, mentalStress: 3, motivation: 8,
    }));
    return [checkin(AS_OF), ...prior];
}

describe('state-bearing 28-day baseline deltas in derived', () => {
    it('declares one delta key per matching baseline and none for metrics without a baseline', () => {
        expect(BASELINE_DELTA_KEYS.biometric_baselines).toEqual(
            Object.keys(RECOVERY_BASELINE_KEYS).map(field => `${field}_delta28d`));
        expect(BASELINE_DELTA_KEYS.subjective_baselines).toEqual(
            Object.keys(CHECKIN_BASELINE_KEYS).map(field => `${field}_delta28d`));
        const ledger = buildLedgerExport(fullInput());
        expect(Object.keys(metricsOf(ledger, 'biometric_baselines'))).not.toContain('totalSteps_delta28d');
        expect(Object.keys(metricsOf(ledger, 'biometric_baselines')).filter(key => key.endsWith('_delta28d')))
            .toEqual([...BASELINE_DELTA_KEYS.biometric_baselines]);
    });

    it('exports a measured delta in the value unit when value and baseline match on the same date', () => {
        const records = { ...fullRecords(), recovery: [readySnapshot()], checkins: checkinHistory() };
        const ledger = buildLedgerExport(fullInput({ records }));
        const bio = metricsOf(ledger, 'biometric_baselines');
        expect(bio.sleepScore_delta28d).toEqual({ value: 6, unit: 'score', source: 'daily_recovery_snapshots', state: 'measured', observedOn: AS_OF });
        expect(bio.restingHr_delta28d).toMatchObject({ value: -2, unit: 'bpm', state: 'measured' });
        expect(bio.hrvOvernightAvg_delta28d).toMatchObject({ value: -2.4, unit: 'ms', state: 'measured' });
        expect(bio.respirationAvg_delta28d).toMatchObject({ value: 0, unit: 'breaths/min', state: 'measured' });
        const subjective = metricsOf(ledger, 'subjective_baselines');
        expect(subjective.readiness_longAvg).toMatchObject({ value: 8, state: 'measured' });
        expect(subjective.readiness_delta28d).toEqual({
            value: -1, unit: 'score_1_10', source: 'daily_subjective_checkins', state: 'measured', observedOn: AS_OF,
        });
        // Today's soreness is not recorded: no delta, and the value's state wins.
        expect(subjective.soreness_delta28d).toMatchObject({ value: null, state: 'not_recorded' });
    });

    it('withholds the delta with the baseline state when no baseline is ready', () => {
        const ledger = buildLedgerExport(fullInput());
        expect(metricsOf(ledger, 'biometric_baselines').sleepScore_delta28d).toMatchObject({ value: null, state: 'missing' });
        expect(metricsOf(ledger, 'subjective_baselines').readiness_delta28d).toMatchObject({ value: null, state: 'missing' });
    });

    it('never compares a stale value with a baseline for another semantic date', () => {
        const records = { ...fullRecords(), recovery: [readySnapshot(AS_OF, { sleep: '2026-11-18' })], checkins: checkinHistory() };
        const ledger = buildLedgerExport(fullInput({ records }));
        expect(ledger.facts.recovery.items[0].fields.sleepScore).toMatchObject({ state: 'stale', observedOn: '2026-11-18' });
        expect(metricsOf(ledger, 'biometric_baselines').sleepScore_delta28d).toMatchObject({ value: null, state: 'stale' });
        expect(metricsOf(ledger, 'biometric_baselines').restingHr_delta28d.state).toBe('measured');
    });

    it("reports the missing value's state when today has no record", () => {
        const records = { ...fullRecords(), recovery: [readySnapshot()], checkins: checkinHistory().slice(1) };
        const ledger = buildLedgerExport(fullInput({ records }));
        expect(metricsOf(ledger, 'subjective_baselines').readiness_delta28d).toMatchObject({ value: null, state: 'not_recorded' });
        const noRecovery = buildLedgerExport(fullInput({ records: { ...records, recovery: [readySnapshot('2026-11-19')] } }));
        expect(metricsOf(noRecovery, 'biometric_baselines').sleepScore_delta28d).toMatchObject({ value: null, state: 'missing' });
    });

    it('carries an unread source through to every delta', () => {
        const ledger = buildLedgerExport(fullInput({ records: {} }));
        for (const [id, keys] of Object.entries(BASELINE_DELTA_KEYS)) {
            for (const key of keys) {
                expect(metricsOf(ledger, id as DerivedMetric['id'])[key], key).toMatchObject({ value: null, state: 'unavailable' });
            }
        }
    });

    it('keeps an invalid value invalid rather than computing a delta from it', () => {
        const records = { ...fullRecords(), recovery: [readySnapshot()], checkins: checkinHistory() };
        records.recovery[0].raw.restingHr = 0;
        const ledger = buildLedgerExport(fullInput({ records }));
        expect(metricsOf(ledger, 'biometric_baselines').restingHr_delta28d).toMatchObject({ value: null, state: 'invalid' });
    });
});
