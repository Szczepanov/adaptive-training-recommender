# Sleep-decision-authority Phase 3: shadow SleepRecoveryEvidence (2026-08-29)

Implements Phase 3 of the reviewed sleep-data-for-training-recommendations analysis
([`docs/analysis/2026-08-29-sleep-data-training-recommendations-analysis.md`](2026-08-29-sleep-data-training-recommendations-analysis.md)
§18): a shadow-only categorical evidence concept built on Phase 2's derived sleep-duration/
timing baselines
([`docs/analysis/2026-08-29-sleep-decision-authority-phase-2-implementation.md`](2026-08-29-sleep-decision-authority-phase-2-implementation.md)).

## Genuinely shadow

`evaluateSleepRecoveryEvidence()` (`app/src/engine/sleepRecoveryEvidence.ts`) is a pure
function of `DailyReadiness` -- it reads `objective`/`subjective`, never mutates either,
and is called from nowhere in `rules.ts`/`fatigue.ts`. Nothing changes today's training
recommendations.

## Wiring

Phase 2's Python-computed fields (`snapshot.derived.deltas.sleepDurationVs7dMedian` etc.)
weren't reachable from the TS engine at all yet. Extended following the established
`respiration_delta` precedent (optional fields on `EngineObjectiveInput`, gated on
`baselineComputationVersion >= N` in `adapters.ts`, not the individual field's own
null-ness):

- `EngineObjectiveInput` gains `sleep_duration_delta_7d_min`/`28d_min`,
  `sleep_duration_accumulated_2d_deficit_min`/`3d_deficit_min`, and
  `bedtime`/`wake_time`/`sleep_midpoint_deviation_7d_min`/`28d_min` -- all optional,
  gated on `baselineComputationVersion >= 6`.
- `mapSnapshotToEngineInput` converts the Python side's seconds to minutes for the
  duration/deficit fields; the circular time-of-day deviations are already minutes on
  the Python side and pass through unconverted.

## `SleepRecoveryEvidence`

Matches the reviewed analysis's proposed interface (§18 Phase 3) exactly: `state`
(`normal`/`minor_disruption`/`meaningful_sleep_deficit`/`persistent_sleep_deficit`/
`uncertain`), `confidence` (`high`/`moderate`/`low`), `acuteDurationDeficitMin`,
`accumulated2dDeficitMin`/`3dDeficitMin`, `subjectiveConcordance`,
`physiologicalConcordance`, and `evidence: string[]`.

**Sign convention note**: `acuteDurationDeficitMin` is `-sleep_duration_delta_7d_min`
(baseline minus current), so positive means a short night -- matching
`accumulated2d/3dDeficitMin`'s existing convention rather than
`EngineObjectiveInput`'s own `current - baseline` convention. Documented explicitly on
the field to avoid the exact class of sign-convention confusion this whole plan has
already found real bugs from (Eight Sleep's `sleep_debt_seconds`, `social_jetlag_seconds`).

## Classification: a first cut, not a validated model

Per the reviewed analysis's own promotion criteria (§14), thresholds get tuned against
real outcomes in Phase 4/5 (replay/prospective evaluation) before any activation
decision. Named constants (`PERSISTENT_ACCUMULATED_3D_DEFICIT_MIN = 90`,
`MEANINGFUL_ACUTE_DEFICIT_MIN = 60`, `MEANINGFUL_ACCUMULATED_2D_DEFICIT_MIN = 60`,
`MINOR_ACUTE_DEFICIT_MIN = 20`, subjective-quality thresholds at 5/6 on the 1-10 scale) so
tuning later is a one-line change, not a rewrite.

- `persistent_sleep_deficit` requires **both** a large 3-day accumulated deficit **and**
  tonight itself being short -- a large accumulated deficit alone, with a genuine
  recovery/surplus night, is a different situation (already recovering) and is
  deliberately not classified the same way.
- `confidence` tracks how much history backs the classification (mature 28d baseline +
  3-night accumulated deficit → `high`), not the deficit's magnitude -- a large deficit
  computed from a barely-mature baseline is still a low-confidence read.
- `subjectiveConcordance`/`physiologicalConcordance` are `null`, not a guessed boolean,
  whenever there's no real signal to compare against (uncertain state, or no HRV/RHR
  delta available at all).

## Verification

Phase 3 is TS-only -- the Python suite is untouched (600 tests, unchanged). Frontend:
2708 tests pass (15 new in `sleepRecoveryEvidence.test.ts`, 3 new in `adapters.test.ts`
covering the version-gating and unit-conversion behavior), typecheck/lint clean,
workout-catalog validation unaffected.
