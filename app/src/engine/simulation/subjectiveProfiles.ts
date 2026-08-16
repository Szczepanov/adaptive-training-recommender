import type { DailyReadiness, EngineObjectiveInput, SubjectiveInput } from '../models';

/**
 * Phase 9.5: named subjective *scale-use* profiles -- the personal differences in how
 * athletes report their own readiness that ADR-0020's drift term exists to correct.
 *
 * `scenarios.ts`'s `stableReadiness()` returns the same six subjective values every call,
 * so every synthetic athlete in the corpus has zero subjective variance today: 7d and 28d
 * averages are identical everywhere, and a z-score-based drift term would read as exactly
 * zero on the whole corpus. Running 9.6's comparison against that corpus would report "no
 * effect" as an artefact of the fixtures, not evidence about the idea (see the plan's
 * "Why this comes before Phase 9" for the identical shadow-mode reasoning). These profiles
 * fix that without inventing a data source: the shapes are chosen to match the five rows
 * in `phase-9-subjective-baselines.md` 9.5's table.
 *
 * Two consumers:
 *  - `scenarios.ts` samples `subjectiveProfileReadiness` once per chained decision point
 *    to drive the five `subjective_*` fixtures in `SCENARIOS` (`runScenario` only takes one
 *    reading per week -- see its `readinessForDate` doc comment -- so the day offset passed
 *    in is always a multiple of 7; the underlying generator is genuinely daily-resolution
 *    for the other consumer below).
 *  - `subjectiveProfiles.test.ts` calls `subjectiveProfileSeries` to build a full daily
 *    series and assert each profile's shape (non-zero stdev, the drifter's early/late
 *    averages actually diverging, ...) independent of the weekly sampling cadence.
 *
 * `computeSubjectiveBaseline` (Phase 9.1) does not exist yet -- gated on ADR-0020
 * acceptance, per the plan's precondition -- so nothing here is wired into a real 7d/28d
 * baseline computation or into `DailyReadiness.subjectiveBaseline` (Phase 9.2, likewise
 * gated). This module only proves the *fixtures* have the variance shape 9.6 will need;
 * the real baseline math is 9.1's job once the ADR is accepted.
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

/** Deterministic, reproducible pseudo-noise in [0, 1) -- no `Math.random`, so a scenario
 *  run (and `simulate:diff`'s byte-for-byte comparison) stays identical run to run. A hash
 *  of `(seed, dayIndex)` rather than a smooth sine wave, so consecutive days don't look
 *  like a periodic wave -- real day-to-day variance has no period. */
function pseudoNoise(seed: number, dayIndex: number): number {
    const x = Math.sin(seed * 12.9898 + dayIndex * 78.233) * 43758.5453;
    return x - Math.floor(x);
}

/** Signed noise in `[-amplitude, amplitude]`. */
function jitter(seed: number, dayIndex: number, amplitude: number): number {
    return (pseudoNoise(seed, dayIndex) * 2 - 1) * amplitude;
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

/**
 * One day's subjective values for `kind`, at `dayIndex` (0-based days since the *profile's*
 * own start -- not a calendar date). Every metric stays in `[1, 10]`.
 *
 * | Profile | Shape | What it must prove |
 * |---|---|---|
 * | `habitual_low` | Readiness ~3, fatigue ~7, flat | Drift does not relax an absolute-threshold `modify` (D-SUBJFLOOR) -- soreness/fatigue already keep this athlete off `train` today, with no drift term involved. |
 * | `habitual_high` | Readiness ~8, fatigue ~2, flat | A high, flat baseline stays `train`; the far-away absolute floor is exactly why a real decline from here would need a drift term to catch early. |
 * | `slow_drifter` | Readiness 8 -> 6 over three weeks | The case the term exists for: currently invisible to every absolute threshold, must become visible to a 7d-vs-28d comparison. |
 * | `noisy_stationary` | Mean stable, day-to-day swing +/-2 | Must **not** read as decline -- noise is not drift. |
 * | `chronically_sore` | Soreness baseline 7, stable | The safety case: already forces `modify` via the existing `soreness > 6` absolute floor and must keep doing so, never habituating to "normal". |
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
            // Linear decline over the first 21 days (three weeks), then holds at the
            // decayed level -- it does not recover on its own. "Never crossing an absolute
            // threshold" is asserted in subjectiveProfiles.test.ts and scenarios.test.ts,
            // not assumed here.
            const driftDays = 21;
            const progress = clamp(dayIndex / driftDays, 0, 1);
            const readiness = 8 - progress * 2; // 8 -> 6
            const sleepQuality = 7 - progress * 1; // 7 -> 6
            const motivation = 7 - progress * 1; // 7 -> 6
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
 * defaults so mode determination is driven by the subjective side alone -- the point of
 * this corpus is isolating subjective variance, not adding a second confound.
 *
 * Duplicates `scenarios.ts`'s `stableReadiness()` defaults rather than importing it: that
 * keeps this module free of any dependency on the scenario list, the same reasoning
 * `externalSession.ts` gives for duplicating `EXTERNAL_MODIFY_MAX_SYSTEMIC_COST` instead of
 * importing it from `rules.ts`.
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
