import { describe, expect, it } from 'vitest';
import {
    computeIntervalOverlapMetrics,
    computePhysiologicalRelationFeatures,
    evaluateAnchorEligibility,
    selectBestSessionPairing,
    type SessionInterval,
} from './identityFeatures';

describe('computeIntervalOverlapMetrics (PI2, ADR-0028)', () => {
    it('exact overlap: identical intervals yield jaccard=1 and zero deltas', () => {
        const garmin: SessionInterval = { startIso: '2026-08-27T22:00:00Z', endIso: '2026-08-28T06:00:00Z' };
        const eightSleep: SessionInterval = { ...garmin };

        const result = computeIntervalOverlapMetrics(garmin, eightSleep);
        expect(result.valid).toBe(true);
        expect(result.metrics).toEqual({
            intersectionMinutes: 480,
            unionMinutes: 480,
            jaccard: 1,
            eightOverlapFraction: 1,
            garminOverlapFraction: 1,
            startDeltaMinutes: 0,
            endDeltaMinutes: 0,
            durationDeltaMinutes: 0,
        });
    });

    it('partial overlap at the start: Eight Sleep begins and ends earlier', () => {
        const garmin: SessionInterval = { startIso: '2026-08-27T22:00:00Z', endIso: '2026-08-28T06:00:00Z' };
        const eightSleep: SessionInterval = { startIso: '2026-08-27T21:00:00Z', endIso: '2026-08-28T05:00:00Z' };

        const { metrics } = computeIntervalOverlapMetrics(garmin, eightSleep);
        expect(metrics).toMatchObject({
            intersectionMinutes: 420,
            unionMinutes: 540,
            startDeltaMinutes: -60,
            endDeltaMinutes: -60,
            durationDeltaMinutes: 0,
        });
        expect(metrics!.jaccard).toBeCloseTo(420 / 540, 10);
        expect(metrics!.eightOverlapFraction).toBeCloseTo(420 / 480, 10);
        expect(metrics!.garminOverlapFraction).toBeCloseTo(420 / 480, 10);
    });

    it('partial overlap at the end: Eight Sleep begins and ends later', () => {
        const garmin: SessionInterval = { startIso: '2026-08-27T22:00:00Z', endIso: '2026-08-28T06:00:00Z' };
        const eightSleep: SessionInterval = { startIso: '2026-08-27T23:00:00Z', endIso: '2026-08-28T07:00:00Z' };

        const { metrics } = computeIntervalOverlapMetrics(garmin, eightSleep);
        expect(metrics).toMatchObject({
            intersectionMinutes: 420,
            unionMinutes: 540,
            startDeltaMinutes: 60,
            endDeltaMinutes: 60,
            durationDeltaMinutes: 0,
        });
    });

    it('nested intervals: Eight Sleep session fully inside a longer Garmin session', () => {
        const garmin: SessionInterval = { startIso: '2026-08-27T21:00:00Z', endIso: '2026-08-28T07:00:00Z' };
        const eightSleep: SessionInterval = { startIso: '2026-08-27T23:00:00Z', endIso: '2026-08-28T05:00:00Z' };

        const { metrics } = computeIntervalOverlapMetrics(garmin, eightSleep);
        expect(metrics).toMatchObject({
            intersectionMinutes: 360,
            unionMinutes: 600,
            eightOverlapFraction: 1,
            garminOverlapFraction: 0.6,
            startDeltaMinutes: 120,
            endDeltaMinutes: -120,
            durationDeltaMinutes: -240,
        });
    });

    it('disjoint intervals: a daytime nap has zero intersection with an overnight Garmin session', () => {
        const garmin: SessionInterval = { startIso: '2026-08-27T22:00:00Z', endIso: '2026-08-28T06:00:00Z' };
        const eightSleep: SessionInterval = { startIso: '2026-08-27T14:00:00Z', endIso: '2026-08-27T14:45:00Z' };

        const { valid, metrics } = computeIntervalOverlapMetrics(garmin, eightSleep);
        expect(valid).toBe(true);
        expect(metrics!.intersectionMinutes).toBe(0);
        expect(metrics!.jaccard).toBe(0);
        expect(metrics!.eightOverlapFraction).toBe(0);
        expect(metrics!.garminOverlapFraction).toBe(0);
    });

    it('timezone/UTC boundary: mixed "Z" and explicit-offset timestamps resolve to the same instants', () => {
        // 20:00Z == 22:00+02:00; 04:00Z (next day) == 06:00+02:00 (next day).
        const garmin: SessionInterval = { startIso: '2026-08-27T20:00:00Z', endIso: '2026-08-28T04:00:00Z' };
        const eightSleep: SessionInterval = {
            startIso: '2026-08-27T22:00:00+02:00',
            endIso: '2026-08-28T06:00:00+02:00',
        };

        const { metrics } = computeIntervalOverlapMetrics(garmin, eightSleep);
        expect(metrics!.jaccard).toBe(1);
        expect(metrics!.startDeltaMinutes).toBe(0);
        expect(metrics!.endDeltaMinutes).toBe(0);
    });

    it('DST spring-forward in Europe/Warsaw (2026-03-29, clocks skip 02:00->03:00 CEST) computes real elapsed time', () => {
        // Wall-clock 01:00->04:00 spans the skipped hour; real elapsed time is only 2h, not 3h.
        const garmin: SessionInterval = {
            startIso: '2026-03-29T01:00:00+01:00',
            endIso: '2026-03-29T04:00:00+02:00',
        };
        // Nested wall-clock 01:15->03:45, real elapsed 1.5h, fully inside the 2h Garmin window.
        const eightSleep: SessionInterval = {
            startIso: '2026-03-29T01:15:00+01:00',
            endIso: '2026-03-29T03:45:00+02:00',
        };

        const { metrics } = computeIntervalOverlapMetrics(garmin, eightSleep);
        expect(metrics!.unionMinutes).toBe(120); // Garmin's real 2h span, not a naive 3h wall-clock span
        expect(metrics!.eightOverlapFraction).toBe(1); // Eight Sleep fully nested
        expect(metrics!.durationDeltaMinutes).toBe(-30); // 90min - 120min
    });

    it('DST fall-back in Europe/Warsaw (2026-10-25, clocks repeat 02:00-03:00) computes real elapsed time', () => {
        // Wall-clock 22:00->06:00 looks like 8h but the repeated hour makes real elapsed time 9h.
        const interval: SessionInterval = {
            startIso: '2026-10-24T22:00:00+02:00',
            endIso: '2026-10-25T06:00:00+01:00',
        };

        const { metrics } = computeIntervalOverlapMetrics(interval, { ...interval });
        expect(metrics!.intersectionMinutes).toBe(540); // 9h, not 8h
        expect(metrics!.unionMinutes).toBe(540);
        expect(metrics!.jaccard).toBe(1);
    });

    describe('rejected pairs (SESSION_INTERVAL_INVALID)', () => {
        it('rejects a missing/empty start timestamp', () => {
            const result = computeIntervalOverlapMetrics(
                { startIso: '', endIso: '2026-08-28T06:00:00Z' },
                { startIso: '2026-08-27T22:00:00Z', endIso: '2026-08-28T06:00:00Z' },
            );
            expect(result).toEqual({ valid: false, reasonCode: 'SESSION_INTERVAL_INVALID', metrics: null });
        });

        it('rejects an unparsable timestamp', () => {
            const result = computeIntervalOverlapMetrics(
                { startIso: 'not-a-date', endIso: '2026-08-28T06:00:00Z' },
                { startIso: '2026-08-27T22:00:00Z', endIso: '2026-08-28T06:00:00Z' },
            );
            expect(result.valid).toBe(false);
            expect(result.reasonCode).toBe('SESSION_INTERVAL_INVALID');
        });

        it('rejects a zero-length Garmin interval', () => {
            const zero: SessionInterval = { startIso: '2026-08-27T22:00:00Z', endIso: '2026-08-27T22:00:00Z' };
            const result = computeIntervalOverlapMetrics(zero, {
                startIso: '2026-08-27T22:00:00Z',
                endIso: '2026-08-28T06:00:00Z',
            });
            expect(result.valid).toBe(false);
            expect(result.reasonCode).toBe('SESSION_INTERVAL_INVALID');
        });

        it('rejects a zero-length Eight Sleep interval', () => {
            const zero: SessionInterval = { startIso: '2026-08-28T02:00:00Z', endIso: '2026-08-28T02:00:00Z' };
            const result = computeIntervalOverlapMetrics(
                { startIso: '2026-08-27T22:00:00Z', endIso: '2026-08-28T06:00:00Z' },
                zero,
            );
            expect(result.valid).toBe(false);
            expect(result.reasonCode).toBe('SESSION_INTERVAL_INVALID');
        });

        it('rejects reversed timestamps (end before start)', () => {
            const reversed: SessionInterval = { startIso: '2026-08-28T06:00:00Z', endIso: '2026-08-27T22:00:00Z' };
            const result = computeIntervalOverlapMetrics(reversed, {
                startIso: '2026-08-27T22:00:00Z',
                endIso: '2026-08-28T06:00:00Z',
            });
            expect(result.valid).toBe(false);
            expect(result.reasonCode).toBe('SESSION_INTERVAL_INVALID');
        });
    });
});

describe('selectBestSessionPairing (PI2)', () => {
    it('multiple sleep sessions / naps: ignores a non-overlapping nap and selects the real overnight session', () => {
        const mainSleep: SessionInterval = { startIso: '2026-08-27T22:00:00Z', endIso: '2026-08-28T06:00:00Z' };
        const nap: SessionInterval = { startIso: '2026-08-27T14:00:00Z', endIso: '2026-08-27T14:45:00Z' };

        const result = selectBestSessionPairing([mainSleep], [nap, mainSleep]);
        expect(result.selected?.eightSleepIndex).toBe(1);
        expect(result.selected?.eightSleep).toEqual(mainSleep);
        expect(result.reasonCodes).toEqual([]); // only one genuinely overlapping candidate
    });

    it('deterministic pairing when multiple candidate sessions plausibly overlap', () => {
        const garminA: SessionInterval = { startIso: '2026-08-27T22:00:00Z', endIso: '2026-08-28T02:00:00Z' };
        const garminB: SessionInterval = { startIso: '2026-08-28T01:00:00Z', endIso: '2026-08-28T06:00:00Z' };
        // Overlaps both Garmin sessions; overlaps garminB more (3h) than garminA (1h).
        const eightSleep: SessionInterval = { startIso: '2026-08-28T01:00:00Z', endIso: '2026-08-28T04:00:00Z' };

        const result = selectBestSessionPairing([garminA, garminB], [eightSleep]);
        expect(result.reasonCodes).toEqual(['MULTIPLE_PAIRING_CANDIDATES']);
        expect(result.selected?.garminIndex).toBe(1); // garminB: strictly larger intersection wins deterministically

        // Re-running with the Garmin sessions reordered must resolve to the same underlying pairing.
        const reordered = selectBestSessionPairing([garminB, garminA], [eightSleep]);
        expect(reordered.selected?.garmin).toEqual(garminB);
    });

    it('returns no selection and no ambiguity code when no session overlaps at all', () => {
        const garmin: SessionInterval = { startIso: '2026-08-27T22:00:00Z', endIso: '2026-08-28T06:00:00Z' };
        const nap: SessionInterval = { startIso: '2026-08-27T14:00:00Z', endIso: '2026-08-27T14:45:00Z' };

        const result = selectBestSessionPairing([garmin], [nap]);
        expect(result.selected).toBeNull();
        expect(result.reasonCodes).toEqual([]);
    });

    it('surfaces SESSION_INTERVAL_INVALID when every candidate pair is technically invalid', () => {
        const zero: SessionInterval = { startIso: '2026-08-27T22:00:00Z', endIso: '2026-08-27T22:00:00Z' };
        const result = selectBestSessionPairing([zero], [zero]);
        expect(result.selected).toBeNull();
        expect(result.reasonCodes).toEqual(['SESSION_INTERVAL_INVALID']);
    });
});

describe('evaluateAnchorEligibility (PI2, ADR-0028 P-PI-9)', () => {
    it('missing anchor abstains with ANCHOR_MISSING, not a negative determination', () => {
        expect(evaluateAnchorEligibility({ present: false, technicallyEligible: false })).toEqual({
            eligible: false,
            reasonCode: 'ANCHOR_MISSING',
        });
    });

    it('a technically present but ineligible anchor abstains with ANCHOR_QUALITY_INSUFFICIENT', () => {
        expect(evaluateAnchorEligibility({ present: true, technicallyEligible: false })).toEqual({
            eligible: false,
            reasonCode: 'ANCHOR_QUALITY_INSUFFICIENT',
        });
    });

    it('a present and technically eligible anchor is usable', () => {
        expect(evaluateAnchorEligibility({ present: true, technicallyEligible: true })).toEqual({
            eligible: true,
            reasonCode: null,
        });
    });
});

describe('computePhysiologicalRelationFeatures (PI2)', () => {
    it('computes all three residuals when every input is present', () => {
        const features = computePhysiologicalRelationFeatures({
            eightSleepRhr: 45,
            garminRhr: 44,
            eightSleepResp: 15,
            garminResp: 14,
            eightSleepHrv: 55,
            garminHrv: 50,
        });

        expect(features.rhrResidual).toBe(1);
        expect(features.respResidual).toBe(1);
        expect(features.hrvLogResidual).toBeCloseTo(Math.log(55) - Math.log(50), 10);
    });

    it('does not zero-fill a missing feature; other features remain independently available', () => {
        const features = computePhysiologicalRelationFeatures({
            eightSleepRhr: 45,
            garminRhr: null, // Garmin RHR unavailable
            eightSleepResp: 15,
            garminResp: 14,
        });

        expect(features.rhrResidual).toBeNull();
        expect(features.respResidual).toBe(1);
        expect(features.hrvLogResidual).toBeNull();
    });

    it('guards the HRV log residual against non-positive or invalid input', () => {
        expect(
            computePhysiologicalRelationFeatures({ eightSleepHrv: 0, garminHrv: 50 }).hrvLogResidual,
        ).toBeNull();
        expect(
            computePhysiologicalRelationFeatures({ eightSleepHrv: -5, garminHrv: 50 }).hrvLogResidual,
        ).toBeNull();
        expect(
            computePhysiologicalRelationFeatures({ eightSleepHrv: 55, garminHrv: undefined }).hrvLogResidual,
        ).toBeNull();
        expect(
            computePhysiologicalRelationFeatures({ eightSleepHrv: Number.NaN, garminHrv: 50 }).hrvLogResidual,
        ).toBeNull();
    });

    it('never fabricates a value from a population mean when everything is missing', () => {
        expect(computePhysiologicalRelationFeatures({})).toEqual({
            rhrResidual: null,
            respResidual: null,
            hrvLogResidual: null,
        });
    });
});
