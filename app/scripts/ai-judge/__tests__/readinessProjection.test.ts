import { describe, expect, it } from 'vitest';
import { decayAcuteReadinessTowardBaseline, projectedRecoveryBaseline } from '../readinessProjection.mjs';

describe('decayAcuteReadinessTowardBaseline', () => {
  it('returns acute values toward baseline without rewriting chronic metrics', () => {
    const readiness = {
      subjective: { readiness: 3, fatigue: 8 },
      objective: { hrv_delta: -14, hrv_delta_28d: -14, sleep_score: 50, sleep_score_delta_28d: -24 },
    };
    const baseline = {
      subjective: { readiness: 7, fatigue: 3 },
      objective: { hrv_delta: 0, hrv_delta_28d: 2, sleep_score: 80, sleep_score_delta_28d: 1 },
    };

    const weekTwo = decayAcuteReadinessTowardBaseline(readiness, baseline, 7);

    expect(weekTwo.subjective.readiness).toBeGreaterThan(6.6);
    expect(weekTwo.subjective.fatigue).toBeLessThan(3.5);
    expect(weekTwo.objective.hrv_delta).toBeGreaterThan(-1.5);
    expect(weekTwo.objective.sleep_score).toBeGreaterThan(77);
    expect(weekTwo.objective.hrv_delta_28d).toBe(-14);
    expect(weekTwo.objective.sleep_score_delta_28d).toBe(-24);
    expect(readiness.subjective.readiness).toBe(3);
  });

  it('preserves missing readings and does not change the initial day', () => {
    const readiness = { subjective: { readiness: null }, objective: { hrv_delta: null } };
    expect(decayAcuteReadinessTowardBaseline(readiness, { subjective: { readiness: 8 }, objective: { hrv_delta: 0 } }, 7))
      .toEqual(readiness);
    expect(decayAcuteReadinessTowardBaseline(readiness, {}, 0)).toEqual(readiness);
    expect(decayAcuteReadinessTowardBaseline(readiness, {}, Number.NaN)).toEqual(readiness);
  });

  it('derives a recovery baseline without filling missing sensors or rewriting chronic readings', () => {
    const baseline = projectedRecoveryBaseline({
      subjective: { readiness: 3, fatigue: 8, soreness: 7 },
      objective: { hrv_delta: -14, hrv_delta_28d: -14, rhr_delta: null, body_battery_wake: null },
    });
    expect(baseline.subjective).toMatchObject({ readiness: 7, fatigue: 3, soreness: 3 });
    expect(baseline.objective).toMatchObject({ hrv_delta: 0, hrv_delta_28d: -14, rhr_delta: null, body_battery_wake: null });
  });

  it('uses within-scenario rolling HRV and RHR anchors when they are available', () => {
    const baseline = projectedRecoveryBaseline({
      subjective: { readiness: 7, fatigue: 3, soreness: 2 },
      objective: {
        hrv_weekly_avg: 70, hrv_last_night: 45, hrv_delta: -25,
        rhr_7d_avg: 48, rhr: 60, rhr_delta: 12,
      },
    });
    expect(baseline.objective).toMatchObject({
      hrv_weekly_avg: 70, hrv_last_night: 70, hrv_delta: 0,
      rhr_7d_avg: 48, rhr: 48, rhr_delta: 0,
    });
  });

  it('does not coerce missing subjective readings into synthetic baseline values', () => {
    const readiness = {
      subjective: { readiness: null, sleepQuality: null, fatigue: null, soreness: null, stress: null },
      objective: { hrv_delta: null },
    };
    expect(projectedRecoveryBaseline(readiness)).toEqual(readiness);
  });
});
