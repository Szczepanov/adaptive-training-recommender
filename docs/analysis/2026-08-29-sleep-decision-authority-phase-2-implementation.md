# Sleep-decision-authority Phase 2: transparent derived sleep features (2026-08-29)

Implements Phase 2 of the reviewed sleep-data-for-training-recommendations analysis
([`docs/analysis/2026-08-29-sleep-data-training-recommendations-analysis.md`](2026-08-29-sleep-data-training-recommendations-analysis.md)
§18): source-specific, transparent derived sleep features -- sleep-duration deviation vs
personal baseline, 2-day/3-day accumulated sleep-duration deficit, and bedtime/wake-time/
sleep-midpoint deviation. Deliberately observation-only, same as this codebase's v4/v5
baseline batches: nothing here changes what `rules.ts` or `fatigue.ts` reads today.

## Scope decisions

- **Garmin Direct only.** Matches the architecture these features actually extend
  (`compute_derived_metrics` in `src/garmin_sync/metrics.py`, which already computes every
  other precomputed baseline `rules.ts` reads). Eight Sleep still isn't wired into any
  decision path (`MULTISOURCE_FUSION_POLICY` defaults to `'off'`, D-8S-NO-AUTHORITY
  stands) -- an Eight-Sleep-side equivalent via `multisourceBaselines.ts` would be
  Eight-Sleep-scoped data feeding nothing, the same gap Phase 1 already found for its
  extended metrics.
- **Sleep-opportunity-before-key-session excluded.** Everything else in this phase is
  backward-looking snapshot enrichment (today's night vs. historical baseline). This one
  feature is forward-looking (needs tomorrow's plan) and belongs in the scheduling layer
  (`planner.ts`/`microcycle.ts`/`schedule.ts`), not `compute_derived_metrics`. Left for a
  separate pass once that architecture is investigated.

## Where this lives, and why

Sleep-score deltas (`sleep_score_delta_7d`/`28d`) aren't computed client-side in the TS
engine -- they're precomputed server-side in Python
(`compute_derived_metrics`/`DerivedDeltas`/`DerivedMetrics`) at sync/backfill time and
stored as `derived.deltas.*`/`derived.*` fields on `daily_recovery_snapshots`, just read
by `rules.ts` via `adapters.ts`. `app/src/engine/multisourceBaselines.ts` is a separate,
TS-side calculator for the Eight-Sleep/Google-Health shadow pipeline -- not what Garmin's
live numbers use. This phase follows the *first* pattern (Python, `compute_derived_metrics`),
extending it the same way the existing v4 (median/MAD for sleep score/RHR/HRV/steps) and
v5 (body battery/stress/training readiness) batches did. `BASELINE_COMPUTATION_VERSION`
5 → 6.

## New fields

**`DerivedMetrics`** (all observation-only, absent on documents written before v6):

| Field | What |
|---|---|
| `sleepDuration7dMedian`/`28dMedian`/`28dMad` | Sleep-duration median/MAD baseline, same pattern as sleep score/RHR/HRV |
| `sleepDurationAccumulated2dDeficitSec`/`3dDeficitSec` | Signed sum of (28d-median-baseline − actual) over the most recent N nights with data |
| `bedtime7dCircularMeanMinutes`/`28d...` | Circular-mean bedtime, minutes since local midnight |
| `wakeTime7dCircularMeanMinutes`/`28d...` | Circular-mean wake time |
| `sleepMidpoint7dCircularMeanMinutes`/`28d...` | Circular-mean sleep midpoint |

**`DerivedDeltas`**: `sleepDurationVs7dMedian`/`28dMedian`, `bedtimeDeviationVs7dMinutes`/`28dMinutes`, `wakeTimeDeviationVs7dMinutes`/`28dMinutes`, `sleepMidpointDeviationVs7dMinutes`/`28dMinutes`.

## Design notes

**Accumulated deficit is signed**, not clamped to zero per night before summing: a night
above baseline can offset a prior deficit within the same window. Positive = net shortfall,
negative = net surplus (same sign convention as Eight Sleep's already-shipped
`sleep_debt_seconds`). "Most recent N nights with data" reuses the rest of this file's
existing gap-tolerance (`calculate_median`/`calculate_average` already silently work
around missing days) -- it is not strictly the last N *calendar* nights when there's a
sync gap, and this is called out explicitly in the field's docstring rather than assumed.

**Bedtime/wake-time/sleep-midpoint use circular mean, not median** -- the only deliberate
departure from this module's v3+ median-baseline convention. Clock times wrap at midnight
(23:50 and 00:10 are 20 minutes apart, not ~23.5 hours), and there's no single
universally-agreed circular median, while circular mean via unit-vector averaging is a
standard, well-defined technique for time-of-day/circadian-phase data. Deviations use a
signed shortest-arc delta (`calculate_circular_delta_minutes`), not linear subtraction,
for the same reason.

**Sleep midpoint is computed from real timestamps**, not by circularly averaging two
already-converted time-of-day values: `sleep_start + (sleep_end - sleep_start) / 2` on the
absolute UTC instants, then converted to local time-of-day the same way bedtime/wake-time
are. Two bare clock times alone can't say which direction is "through the night."

## Verification

549 → 579 tests (37 in `test_metrics.py`, up from 19), covering: UTC→Warsaw conversion
(including date-rollover), the midnight-wraparound case explicitly (1430min + 10min →
~0min, not ~720min the naive linear mean would give), signed shortest-arc deltas in both
directions, accumulated-deficit's tail-selection and net-surplus behavior, and a full
integration test with real-shaped bedtime/wake-time fixtures. mypy/ruff clean.

Verified against real production data via `rebuild --start-date 2026-08-22 --end-date
2026-08-28` (offline, archive-replay, zero new Garmin API calls) -- see the commit for the
resulting real `derived.*`/`derived.deltas.*` values on `daily_recovery_snapshots`.
