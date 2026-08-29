# Eight Sleep real within-session WASO: root cause and reinstatement (2026-08-29)

Follow-up to
[`docs/analysis/2026-08-29-eight-sleep-stage-sum-invariant-check.md`](2026-08-29-eight-sleep-stage-sum-invariant-check.md),
which found the stage-sum invariant "does not hold" and deferred Phase 1 item #4
(persisting a real awake-in-bed/out-of-bed metric) pending investigation. That
investigation is done: the invariant does hold, the original check had a methodology bug,
and item #4 is implemented.

## Root cause

The original check summed only the `sessions[]` entry matching `mainSessionId` (the same
single-session resolution used for the algorithm-version fields). Eight Sleep's day-level
`deepDuration`/`remDuration`/`lightDuration` aggregate **across all sessions that occurred
that day**, not just the main one -- confirmed via a real probe of 2025-10-28, a two-session
night (main sleep + a second, shorter session):

| | Session 1 (`stageSummary`) | Session 2 (`stageSummary`) | Sum | Day-level |
|---|---:|---:|---:|---:|
| deep | 6150 | 1560 | 7710 | **7710** |
| rem | 6360 | 0 | 6360 | **6360** |
| light | 17190 | 1530 | 18720 | **18720** |

Exact match. 6/73 sampled nights had 2+ sessions in the original sweep -- enough to produce
the "0/64 light matches" pattern the earlier check saw, since every multi-session night was
silently undercounted.

## Corrected invariant: 64/64

Re-ran the sweep summing `sessions[].stageSummary` (not raw `sessions[].stages` segments --
`stageSummary` is Eight Sleep's own precomputed per-session breakdown, a better source than
manually re-deriving totals) across **all** sessions per day:

| Check | Matches |
|---|---|
| deep | 64/64 |
| rem | 64/64 |
| light | 64/64 |

Same result as Garmin's `sleepLevels` invariant. There is no real Eight Sleep data-quality
issue here.

## `stageSummary` is richer than expected

Beyond `deepDuration`/`remDuration`/`lightDuration`, each session's `stageSummary` includes:
`awakeDuration`, `outDuration`, `wasoDuration`, and a before/between/after-sleep awake
breakdown (`awakeBeforeSleepDuration`/`awakeBetweenSleepDuration`/`awakeAfterSleepDuration`).
`wasoDuration` is a real, Eight-Sleep-precomputed Wake After Sleep Onset value -- not
something derived by summing raw stage segments.

## `wasoDuration` validated against Garmin's real WASO

Cross-device check: `wasoDuration` (summed across all sessions) vs. Garmin's genuine
within-session `awakeSleepSec`, restricted to 34 nights (of 64 sampled) where total sleep
duration agreed within 30 minutes and no bed-move was flagged:

| | Value |
|---|---|
| Correlation | **r = 0.461** |
| Mean absolute delta | 9.0 min |
| Garmin mean | 524s |
| Eight Sleep mean | 881s |

For comparison: the removed presence-minus-sleep proxy had r=0.17 and a ~115min/night mean
(vs. Garmin's ~11min) -- an obviously wrong concept, not device disagreement. REM sleep's
own cross-device correlation, already treated as real physiological signal disagreement (not
a units bug) in the earlier stage-comparison analysis, was r=0.44. `wasoDuration`'s r=0.461
sits in the same range: a real, moderate, device-disagreement-typical correlation, not the
order-of-magnitude mismatch that flagged the original proxy as broken.

## Decision and implementation

Per user decision: reinstate `METRIC_SLEEP_STAGE_AWAKE_SECONDS`, sourced from
`sessions[].stageSummary.wasoDuration` summed across all sessions, minimal scope (no
`outDuration` or the before/between/after-sleep breakdown for now -- can revisit later).
Deliberately reuses the same metric name Google Health's true within-session WASO already
uses, rather than a distinct name, since the validated correlation makes this genuinely the
same concept now (unlike the removed proxy).

Implemented in `eight_sleep_mapper.py` (`NORMALIZER_VERSION` 6→7), verified against real
data via a 3-day backfill (`sleep_stage_awake_seconds`: 180s/300s/180s, all plausible), 3 new
tests (single-session extraction, cross-session summing even when algorithm versions are
correctly left ambiguous, absent when no session has `stageSummary`).

Authority classification unchanged: `METRIC_SLEEP_STAGE_AWAKE_SECONDS` remains
`research_only` in `OBSERVATION_AUTHORITY` -- r=0.461 is real signal but still moderate, well
short of the bar the reviewed sleep-decision-authority analysis sets for training-decision
use.
