# Sleep-decision-authority Phase 2: transparent derived sleep features (2026-08-29)

Implements Phase 2 of the reviewed sleep-data-for-training-recommendations analysis
([`docs/analysis/2026-08-29-sleep-data-training-recommendations-analysis.md`](2026-08-29-sleep-data-training-recommendations-analysis.md)
§18): source-specific, transparent derived sleep features -- sleep-duration deviation vs
personal baseline, 2-day/3-day accumulated sleep-duration shortfall, and bedtime/wake-time/
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
| `sleepDuration7dMedian`/`28dMedian`/`28dMad` | Historical sleep-duration median/MAD baseline, same pattern as sleep score/RHR/HRV |
| `sleepDurationAccumulated2dDeficitSec`/`3dDeficitSec` | Signed sum of (historical 28d-median baseline − actual) over the most recent N nights with data **through the current night** |
| `bedtime7dCircularMeanMinutes`/`28d...` | Circular-mean bedtime, minutes since local midnight |
| `wakeTime7dCircularMeanMinutes`/`28d...` | Circular-mean wake time |
| `sleepMidpoint7dCircularMeanMinutes`/`28d...` | Circular-mean sleep midpoint |

**`DerivedDeltas`**: `sleepDurationVs7dMedian`/`28dMedian`, `bedtimeDeviationVs7dMinutes`/`28dMinutes`, `wakeTimeDeviationVs7dMinutes`/`28dMinutes`, `sleepMidpointDeviationVs7dMinutes`/`28dMinutes`.

## Design notes

### Accumulated sleep-duration shortfall

The **baseline remains history-only**: the trailing 28-day median excludes the current
snapshot, exactly like the other baseline estimators. The **rolling 2-day/3-day feature is
current-inclusive**, however: today's sleep duration is appended after the historical
window before selecting the most recent N valid nights. This matters operationally -- if
the current night is short, today's snapshot must reflect it immediately rather than
reporting only D-1/D-2 history.

The sum is signed rather than clamping each night to zero: a night above the personal
baseline can offset a prior shortfall inside the same rolling window. Positive = net
shortfall versus the historical personal baseline; negative = net surplus.

Despite the persisted field name `*DeficitSec`, this is **not an estimate of physiological
sleep need or clinical sleep debt**. A person's habitual 28-day median can itself be below
(or above) their individual sleep need. Experimental work estimating potential sleep debt
uses an independently estimated optimal sleep duration and shows substantial individual
variation rather than treating habitual duration as need [R1]. Therefore downstream code
and UI should describe these values as *relative-to-personal-baseline shortfall/surplus*
unless a future model establishes a defensible sleep-need estimate.

"Most recent N nights with data" deliberately preserves this module's existing
gap-tolerance: missing observations are skipped, so a sync gap can make the rolling value
span more than N calendar nights. That is acceptable for observation-only Phase 2, but it
must be revisited before promotion to decision authority; a missing recent night should
not be silently interpreted as evidence of recovery.

### Sleep timing

Bedtime/wake-time/sleep-midpoint use circular mean, not a linear mean/median. Clock times
wrap at midnight (23:50 and 00:10 are 20 minutes apart, not ~23.5 hours), and circular
unit-vector averaging provides a well-defined center for time-of-day data. Deviations use
a signed shortest-arc delta (`calculate_circular_delta_minutes`) for the same reason.
Exactly antipodal values have no unique shorter direction; the implementation uses -720
minutes as the deterministic convention.

Rounded persisted clock baselines are normalized back into **`[0, 1440)`**. This prevents
a floating-point result such as `1439.999...` from rounding to the invalid representation
`1440.0`; midnight is stored as `0.0`.

Sleep timing, including bedtime, wake time, midpoint and regularity, is a recognized sleep
health dimension in systematic reviews, but the literature does not provide a universal
threshold at which an individual's timing deviation should automatically change a training
prescription [R2]. Keeping these fields observation-only pending replay/shadow validation
is therefore intentional.

### Sleep midpoint

Sleep midpoint is computed from real timestamps, not by circularly averaging two
already-converted time-of-day values: `sleep_start + (sleep_end - sleep_start) / 2` on the
absolute UTC instants, then converted to local time-of-day the same way bedtime/wake-time
are. Two bare clock times alone cannot identify which direction is "through the night."

## Verification

Targeted tests cover:

- UTC → configured-local-time conversion, including date rollover;
- midnight wraparound for circular means (`23:50 + 00:10 → 00:00`, not noon);
- persistence normalization (`00:00`, never `1440.0` after rounding);
- signed shortest-arc deltas, including the exactly-antipodal convention;
- accumulated-deficit helper tail selection and signed surplus behavior;
- **current-inclusive** 2-day/3-day accumulated shortfall while keeping the baseline
  historical-only;
- missing timing/duration behavior;
- a full integration-shaped bedtime/wake-time fixture.

The original implementation was also replayed against archived production data using
`rebuild --start-date 2026-08-22 --end-date 2026-08-28` (offline archive replay, zero new
Garmin API calls), producing plausible bedtime (~21:49–22:02 local), wake-time
(~06:01–06:16) and midpoint values across midnight. After the semantic corrections above,
CI is the regression gate; a fresh historical rebuild can be used later to repopulate v6
snapshots with the corrected current-inclusive accumulated values.

## Evidence notes

**[R1]** Kitamura S et al. *Estimating individual optimal sleep duration and potential
sleep debt.* Scientific Reports. 2016. PMID 27775095.
https://pubmed.ncbi.nlm.nih.gov/27775095/

**[R2]** Chaput J-P et al. *Sleep timing, sleep consistency, and health in adults: a
systematic review.* Applied Physiology, Nutrition, and Metabolism. 2020. PMID 33054339.
https://pubmed.ncbi.nlm.nih.gov/33054339/
