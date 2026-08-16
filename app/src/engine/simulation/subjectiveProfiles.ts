import type { DailyReadiness, EngineObjectiveInput, SubjectiveInput } from '../models';

/**
 * Phase 9.5: named subjective *scale-use* profiles -- the personal differences in how
 * athletes report their own readiness that ADR-0020's drift term exists to evaluate.
 *
 * `scenarios.ts`'s `stableReadiness()` returns the same six subjective values every call,
 * so the old synthetic corpus had effectively zero subjective variance. Any relative
 * drift candidate would therefore read as "no effect" for fixture reasons rather than
 * because the idea had been measured. These profiles add deterministic variance shapes
 * matching the five rows in `phase-9-subjective-baselines.md` 9.5.
 *
 * Two consumers:
 *  - `scenarios.ts` samples `subjectiveProfileReadiness` once per chained decision point
 *    to drive the five `subjective_*` fixtures in `SCENARIOS` (`runScenario` takes one
 *    reading per week, so the day offset is a multiple of 7).
 *  - `subjectiveProfiles.test.ts` calls `subjectiveProfileSeries` to build a full daily
 *    series and assert each profile's shape independent of that weekly harness cadence.
 *
 * `computeSubjectiveBaseline` (Phase 9.1) does not exist yet. This module proves only that
 * the fixtures carry the variance/drift shapes future comparison candidates need; it does
 * not choose the final estimator described by ADR-0020 D-SUBJEST.
 */

export const SUBJECTIVE_PROFILE_KINDS = [
    'habitual_low',
    'habitual_high',
    'slow_drifter',
    'noisy_stationary',
    'chronically_sore',
] as const;
export type SubjectiveProfileKind = typeof SUBJECTIVE_PROFILE_KINDS[number];

export interface SubjectiveProfileDayValues {
    readiness: number;
    sleepQuality: number;
    fatigue: number;
    soreness: number;
    stress: number;
    motivation: number;
}

/** Deterministic pseudo-noise in [0, 1), built only from 32-bit integer arithmetic.
 * Avoiding transcendental functions makes the fixture stable across JS engines/architectures
 * as well as repeated runs, which is a better contract for byte-sensitive simulations. */
function pseudoNoise(seed: number, dayIndex: number): number {
    const seedInt = Math.round(seed * 1000) | 0;
    let x = (Math.imul(seedInt, 0x45d9f3b) ^ Math.imul(dayIndex + 1, 0x27d4eb2d)) >>> 0;
    x ^= x >>> 16;
    x = Math.imul(x, 0x7feb352d) >>> 0;
    x ^= x >>> 15;
    x = Math.imul(x, 0x846ca68b) >>> 0;
    x ^= x >>> 16;
    return (x >>> 0) / 0x1_0000_0000;
}

/** Signed noise in `[-amplitude, amplitude]`. */
function jitter(seed: number, dayIndex: number, amplitude: number): number {
    return (pseudoNoise(seed, dayIndex) * 2 - 1) * amplitude;
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

/**
 * One day's subjective values for `kind`, at `dayIndex` (0-based days since the profile's
 * own start, not a calendar date). Every metric stays in `[1, 10]`.
 *
 * | Profile | Shape | What it must prove |
 * |---|---|---|
 * | `habitual_low` | Readiness ~3, fatigue ~7, flat | Relative history must not relax an absolute-threshold `modify` (D-SUBJFLOOR). |
 * | `habitual_high` | Readiness ~8, fatigue ~2, flat | A high stable reporter remains `train`, leaving room for a future adverse-drift candidate to detect deterioration. |
 * | `slow_drifter` | Readiness 8 -> 6 over three weeks | Persistent decline exists without crossing today's absolute thresholds. |
 * | `noisy_stationary` | Mean stable, day-to-day swing +/-2 | Noise is not persistent drift. |
 * | `chronically_sore` | Soreness baseline 7, stable | Relative normality must never cancel the existing `soreness > 6` absolute floor. |
 */
export function subjectiveProfileDay(kind: SubjectiveProfileKind, dayIndex: number): SubjectiveProfileDayValues {
    switch (kind) {
        case 'habitual_low': {
            const n = (offset: number) => jitter(1 + offset, dayIndex, 0.4);
            return {
                readiness: clamp(3 + n(0.01), 1, 10), sleepQuality: clamp(4 + n(0.02), 1, 10),
                fatigue: clamp(7 + n(0.03), 1, 10), soreness: clamp(5 + n(0.04), 1, 10),
                stress: clamp(6 + n(0.05), 1, 10), motivation: clamp(4 + n(0.06), 1, 10),
            };
        }
        case 'habitual_high': {
            const n = (offset: number) => jitter(2 + offset, dayIndex, 0.4);
            return {
                readiness: clamp(8 + n(0.01), 1, 10), sleepQuality: clamp(8 + n(0.02), 1, 10),
                fatigue: clamp(2 + n(0.03), 1, 10), soreness: clamp(2 + n(0.04), 1, 10),
                stress: clamp(2 + n(0.05), 1, 10), motivation: clamp(8 + n(0.06), 1, 10),
            };
        }
        case 'slow_drifter': {
            const driftDays = 21;
            const progress = clamp(dayIndex / driftDays, 0, 1);
            const readiness = 8 - progress * 2;
            const sleepQuality = 7 - progress;
            const motivation = 7 - progress;
            const n = (offset: number) => jitter(3 + offset, dayIndex, 0.2);
            return {
                readiness: clamp(readiness + n(0.01), 1, 10), sleepQuality: clamp(sleepQuality + n(0.02), 1, 10),
                fatigue: clamp(4 + n(0.03), 1, 10), soreness: clamp(4 + n(0.04), 1, 10),
                stress: clamp(4 + n(0.05), 1, 10), motivation: clamp(motivation + n(0.06), 1, 10),
            };
        }
        case 'noisy_stationary': {
            const n = (offset: number) => jitter(4 + offset, dayIndex, 2);
            return {
                readiness: clamp(6 + n(0.01), 1, 10), sleepQuality: clamp(6 + n(0.02), 1, 10),
                fatigue: clamp(4 + n(0.03), 1, 10), soreness: clamp(4 + n(0.04), 1, 10),
                stress: clamp(4 + n(0.05), 1, 10), motivation: clamp(6 + n(0.06), 1, 10),
            };
        }
        case 'chronically_sore': {
            const n = (offset: number) => jitter(5 + offset, dayIndex, 0.3);
            return {
                readiness: clamp(6 + n(0.01), 1, 10), sleepQuality: clamp(6 + n(0.02), 1, 10),
                fatigue: clamp(4 + n(0.03), 1, 10), soreness: clamp(7 + n(0.04), 1, 10),
                stress: clamp(4 + n(0.05), 1, 10), motivation: clamp(6 + n(0.06), 1, 10),
            };
        }
    }
}

/** `days` consecutive daily samples starting at `dayIndex` 0. */
export function subjectiveProfileSeries(kind: SubjectiveProfileKind, days: number): SubjectiveProfileDayValues[] {
    return Array.from({ length: days }, (_, dayIndex) => subjectiveProfileDay(kind, dayIndex));
}

/**
 * Adapts one day's profile values into a full `DailyReadiness`, using neutral objective
 * defaults so mode determination is driven by the subjective side alone.
 *
 * Duplicates `scenarios.ts`'s stable objective defaults rather than importing the scenario
 * list, keeping this fixture module independent of the corpus definition.
 */
export function subjectiveProfileReadiness(
    kind: SubjectiveProfileKind,
    dayIndex: number,
    objectiveOverrides: Partial<EngineObjectiveInput> = {},
): DailyReadiness {
    const values = subjectiveProfileDay(kind, dayIndex);
    const subjective: SubjectiveInput = {
        ...values,
        timeAvailable: 60, painFlag: false, alreadyTrainedToday: false, preferredModalityToday: null,
    };
    const objective: EngineObjectiveInput = {
        total_steps: 8000, sleep_score: 80, sleep_duration_min: 440, rhr: 50, rhr_7d_avg: 50, rhr_delta: 0,
        hrv_weekly_avg: 50, hrv_last_night: 50, hrv_delta: 0, respiration: 14, body_battery_wake: 80,
        last_3_days_hard_sessions_count: 0, yesterday_training: null, today_training: null,
        sleep_score_delta_7d: 0, rhr_delta_28d: 0, hrv_delta_28d: 0, sleep_score_delta_28d: 0,
        hrv_stdev_28d: 8.5, rhr_stdev_28d: 3.5, sleep_score_stdev_28d: 7.8,
        ...objectiveOverrides,
    };
    return { subjective, objective };
}
