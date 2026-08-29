# Sleep-decision-authority Phase 4/5: status (2026-08-29)

Phase 4 (§18 of the reviewed analysis) calls for walk-forward chronological validation of
`SleepRecoveryEvidence` against real outcomes (workout completion, RPE, next-day
subjective fatigue/readiness, etc.), explicitly warning not to guess-then-lock
classification thresholds without that evidence. This doc is a real-data check of whether
that validation is executable right now, not the validation itself.

## Finding: blocked by data volume, not by code

This account has **23 real `daily_subjective_checkin` records total**, spanning
2026-03-25 to 2026-08-29 (~5 months) -- sparse, roughly 15% day coverage. Pairing each
checkin with the prior night's real, now-fully-backfilled sleep-duration deficit
(`sleepDurationAccumulated2dDeficitSec`/`3dDeficitSec`, `baselineComputationVersion >= 6`,
confirmed present for all 365/365 days in the comparison year after a full rebuild):
**23/23 checkins have a usable prior-night deficit pairing** -- this is the complete
real dataset, not a partial slice; there is no more data to find without more real
checkins being recorded going forward.

No workout-completion, RPE, or power/pace-degradation outcome data was checked for this
pass -- 23 pairs is already too few to say anything about the more basic next-day
subjective outcome, so checking a sparser signal wouldn't change the conclusion.

## The 23 real pairs (raw, not a validated correlation)

| Prior night | 2d deficit | 3d deficit | Checkin date | Readiness | Fatigue | Sleep quality |
|---|---:|---:|---|---:|---:|---:|
| 2026-03-24 | -2940s | +1080s | 2026-03-25 | 7 | 3 | 7 |
| 2026-08-05 | -1672s | -1999s | 2026-08-06 | 8 | 2 | 8 |
| 2026-08-06 | -2754s | -1519s | 2026-08-07 | 8 | 2 | 9 |
| 2026-08-07 | -2814s | -5721s | 2026-08-08 | 8 | 3 | 8 |
| 2026-08-08 | -261s | +18s | 2026-08-09 | 8 | 2 | 10 |
| 2026-08-09 | -4521s | -7362s | 2026-08-10 | 8 | 2 | 8 |
| 2026-08-10 | -3780s | -999s | 2026-08-11 | -- | 5 | -- |
| 2026-08-12 | -1699s | +1220s | 2026-08-13 | -- | 5 | -- |
| 2026-08-14 | -2322s | -1143s | 2026-08-15 | -- | 6 | -- |
| 2026-08-15 | +618s | -1323s | 2026-08-16 | 8 | 3 | 9 |
| 2026-08-16 | +1392s | +948s | 2026-08-17 | 7 | 2 | 8 |
| 2026-08-17 | +2133s | +2930s | 2026-08-18 | 6 | 3 | 9 |
| 2026-08-18 | +93s | +410s | 2026-08-19 | 8 | 2 | 9 |
| 2026-08-19 | -2427s | -611s | 2026-08-20 | 7 | 4 | 7 |
| 2026-08-20 | -5487s | -7211s | 2026-08-21 | 8 | 3 | 8 |
| 2026-08-21 | -2607s | -3311s | 2026-08-22 | 9 | 2 | 9 |
| 2026-08-22 | +840s | -4140s | 2026-08-23 | 8 | 1 | 9 |
| 2026-08-23 | -3120s | -1140s | 2026-08-24 | 8 | 3 | 9 |
| 2026-08-24 | -7441s | -8385s | 2026-08-25 | 9 | 2 | 9 |
| 2026-08-25 | -6301s | -8085s | 2026-08-26 | 8 | 2 | 9 |
| 2026-08-26 | -2718s | -8136s | 2026-08-27 | 8 | 2 | 8 |
| 2026-08-27 | +909s | +759s | 2026-08-28 | 8 | 1 | 8 |
| 2026-08-28 | +3401s | +1340s | 2026-08-29 | 7 | 3 | 7 |

(Positive deficit = net shortfall vs 28d baseline; negative = net surplus. `--` = the
checkin was submitted incomplete -- readiness/sleepQuality genuinely missing, not zero.)

## Reading this table (qualitative, explicitly not a statistical claim)

Eyeballing it: the three largest deficits in the dataset (2026-08-24, -08-25, -08-20, all
beyond -5000s/~83min) are each followed by **low** fatigue (2) and **high** readiness
(8-9) -- the opposite direction from what a "sleep deficit predicts elevated next-day
fatigue" hypothesis would suggest. The three incomplete checkins with the highest reported
fatigue (5, 5, 6) don't correspond to the largest deficits in the table either. No pattern
in the hypothesized direction is visible by eye.

This is **not evidence that sleep deficit doesn't predict next-day recovery** -- N=23,
several fields missing, no control for confounds (training load, illness, the account
owner's own response tendencies), and no correlation coefficient or significance test was
computed, deliberately: reporting a statistic from 23 points with this much missing data
would manufacture false precision. It's also worth noting this codebase has a documented
precedent of exactly this failure mode -- an earlier multisource shadow study was flagged
as possibly fabricated partly because a small-N "finding" looked too clean (see
`docs/analysis/2026-08-27-multisource-shadow-study.md`'s correction notice). The honest
reading of this table is: **inconclusive, insufficient data**, not "no effect" or "inverse
effect."

## What would actually unblock this

More real `daily_subjective_checkin` submissions accumulating over time. This is not a
code or infrastructure gap -- `mapSnapshotToEngineInput`/`evaluateSleepRecoveryEvidence`
already work correctly on real data (verified in Phase 2/3's own analysis docs), and the
full year of `sleepDurationAccumulated2dDeficitSec`/`3dDeficitSec` is now backfilled and
ready to pair against whatever checkin history exists whenever this is revisited. Revisit
once checkin volume is meaningfully larger -- there's no fixed threshold that makes N
"enough," but 23 sparse points over 5 months isn't it.

## Phase 5

Phase 5 ("prospective shadow evaluation": decision changes, false conservative changes,
missed adverse outcomes, user overrides, calibration by session type) requires
`SleepRecoveryEvidence` to actually be computed and observed going forward against real
decisions -- it is inherently a function of elapsed time with the shadow evidence live,
not something to attempt before Phase 4 has anything to validate against. Not started, for
the same reason as Phase 4.
