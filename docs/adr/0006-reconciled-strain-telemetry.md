# ADR-0006: Reconciled Strain Telemetry & Baseline Drift Scoring

* **Status:** Accepted
* **Date:** 2026-08-07
* **Deciders:** Core Engineering Team

---

## Context and Problem Statement

Training recommendations often fail when evaluating biometric metrics in isolation (e.g. single-day HRV drop vs. cumulative 4-week accumulated strain). A single bad night's sleep does not always mean an athlete is overtrained, nor does a good sleep score guarantee recovery if 28-day baseline metrics show chronic downward drift.

---

## Decision Outcome

We introduced a **reconciled strain telemetry model** in the recommendation engine ([`app/src/engine/rules.ts`](../../app/src/engine/rules.ts)):

1. **Strain Decomposition**:
   Total objective strain is decomposed into distinct, explainable sub-scores:
   * **Acute Deviation (`acuteDeviation`)**: 7-day metric deviations from baseline (HRV drop, elevated RHR, sleep deficit, step overload).
   * **Multi-Day Baseline Drift (`multiDayDrift`)**: Persistent 28-day vs 7-day baseline degradation tracking chronic fatigue accumulated over weeks.
   * **Contextual Penalties**: Explicit modifiers for recent hard sessions, waking body battery deficits, sleep floor violations, and user conservative bias settings.
2. **Reconciled Telemetry Attachment**:
   Every generated recommendation includes a structured `strainTelemetry` payload detailing raw inputs, calculated weights, and penalty breakdowns.
3. **Automated Human Rationale Generation**:
   The engine automatically synthesizes decision-relevant baseline trends into user-facing bullet points (e.g. *"HRV is 12% below 28-day baseline while 7-day RHR remains elevated by +4 bpm"*).

---

## Code References

* [`app/src/engine/models.ts`](../../app/src/engine/models.ts) — Telemetry types, recommendation contracts, and rationale models.
* [`app/src/engine/rules.ts`](../../app/src/engine/rules.ts) — Acute deviation, drift calculation, and training mode selection rules.

---

## Consequences

### Amendment (2026-08-08): completed-load replay and fusion evidence

External fatigue replay now consumes the six-dimensional cost after
`completedTraining.ts` `scaleCostByDeliveredDose` applies measured duration and any
independent completion ratio. `fatigue.ts` retains unsaturated raw external load while
ranking consumes its clamped projection.

ADR-0014 completed the planned harness comparison between the current
`max(external, internal)` fusion and the tested capped-addition candidate
`min(1, external + internal)`. Capped addition produced a materially higher recovery share
than `max()` and was therefore the worse candidate in that comparison. The engine **retains
`max()` for now because the tested alternative performed worse**; this is not evidence that
`max()` is safe, calibrated, or validated. The aggregate scenario recovery-share gate
remains the release authority for subsequent policy changes, and any new fusion model
requires new measured-response evidence plus a recorded comparison.

### Amendment (2026-08-20): respiration rate — median/MAD baseline and strain wiring

Respiration rate's `respiration7dAvg`/`respiration28dAvg`/deltas were computed and persisted
from the start of this ADR but never consumed by `evaluateReadinessAndSafetyEnvelope` --
observed and recorded, not decision-relevant (the pattern `RawMetrics`'s docstring calls out
for other unwired enrichment fields). Two changes close that gap:

1. **Median, not mean, for the respiration baseline** (`calculate_median` in
   `src/garmin_sync/metrics.py`, `BASELINE_COMPUTATION_VERSION` 3). Elevated respiration
   during illness is exactly the deviation this baseline exists to detect, so a trailing
   window that itself contains a prior illness episode drags a *mean* baseline upward and
   desensitizes detection for weeks afterward. The median resists that contamination. The
   matching spread estimator, `respiration28dMad` (`calculate_mad`, median absolute
   deviation scaled by 1.4826), replaces population stdev as the strain z-score denominator
   for the same reason -- see both functions' docstrings.
2. **`respirationStrain` wired into `metricStrain`** (`app/src/engine/rules.ts`), weighted
   at `RESPIRATION_STRAIN_WEIGHT = 0.3` (comparable to RHR) with `sign = -1` (elevated
   respiration is worse, same convention as RHR). This is now decision-relevant: it can move
   `objectiveStrain` and therefore `mode`. Like `HRV_STRAIN_WEIGHT`/`RHR_STRAIN_WEIGHT`/
   `SLEEP_STRAIN_WEIGHT`, the weight is a first-pass heuristic, not yet run through the
   9.6-style sensitivity/simulation harness.

Documents written before `baselineComputationVersion` 3 lack `respiration28dMad` and hold a
*mean* (not median) in `respiration7dAvg`/`respiration28dAvg` -- readers must check the
version rather than assume either. `respiration_delta`/`respiration_delta_28d`/
`respiration_mad_28d` on `EngineObjectiveInput` are optional for the same reason,
following the `steps_*` fields' precedent for a later addition; `metricStrain` reads a
missing value as `null`, which resolves to zero strain contribution, not fabricated signal.

### Positive
* Transparent, debuggable strain metrics provided alongside every workout recommendation.
* Accurately distinguishes between temporary acute fatigue and accumulated chronic overtraining.
* Respiration-rate elevation -- one of the earliest, most specific illness signals -- now
  actually influences the recommended training mode instead of being recorded and ignored.

### Negative
* Requires maintaining robust baseline calculation algorithms in both Python ingestion (historical calculations) and TypeScript frontend types.
* Respiration now has a second baseline-statistic convention (median/MAD) alongside the
  mean/stdev pair used for HRV, RHR, and sleep score -- a reader of `metrics.py` or
  `rules.ts` has to know which metric uses which, rather than one uniform rule.

### Amendment (2026-08-20): median/MAD added, observation-only, for sleep/RHR/HRV/steps

The respiration amendment above swapped that metric's baseline outright because it was
*dormant* -- computed but never read by the engine, so changing what it meant changed no
real decision. Sleep score, RHR, and HRV are the opposite: their mean/stdev baselines are
live inputs to `metricStrain` today, and steps' mean (`steps_7d_avg`) is a live input to
`fatigue.ts`'s ambulatory-surge check (`steps28dStdev` itself is currently dormant, same as
respiration was). Swapping any of those outright would change real recommendations without
the evidence this project requires first -- ADR-0014 set that bar explicitly: "any new
fusion model requires new measured-response evidence plus a recorded comparison" before a
live decision function changes.

So this step is **additive only**: `BASELINE_COMPUTATION_VERSION` 4 adds
`sleepScore7dMedian`/`28dMedian`/`28dMad`, `restingHr7dMedian`/`28dMedian`/`28dMad`,
`hrv7dMedian`/`28dMedian`/`28dMad`, and `steps7dMedian`/`28dMedian`/`28dMad` (plus the
matching `*Vs7dMedian`/`*Vs28dMedian` deltas on `DerivedDeltas`) computed *alongside* the
existing mean/stdev fields, not replacing them. Nothing in `rules.ts` or `fatigue.ts` reads
these yet -- they exist so a future comparison harness (extending `simulate:scenarios`/the
replay tooling, or a script over the ADR-0005 raw archive) can measure how often and by how
much a median/MAD baseline would have changed `mode` before any of these four metrics'
live statistic is actually replaced. That comparison, and any resulting cutover, is
deliberately **not** part of this amendment.

Documents written before `baselineComputationVersion` 4 simply lack these fields
(`undefined`, not `null`) -- readers must treat them as optional. `app/src/engine/models.ts`
mirrors them on `DailyRecoverySnapshot.derived` for the same reason, but they are
deliberately **not** threaded into `EngineObjectiveInput`/`adapters.ts`: unlike respiration's
fields, nothing downstream of the canonical snapshot is meant to consume them yet.

### Amendment (2026-08-20): median/MAD extended to body battery wake, stress, training readiness

Same additive-only posture as the amendment above, extended to three more metrics: body
battery wake, stress (avg/max), and training readiness score. The difference from the
sleep/RHR/HRV/steps amendment is that none of these three had *any* baseline before --
body battery wake is read live in `rules.ts` (`BODY_BATTERY_LOW_ANCHOR`,
`BODY_BATTERY_RECOVER_THRESHOLD`) but only against fixed absolute thresholds, never a
personal baseline; stress and training readiness are `CanonicalDailyMetrics`'s own
"metric enrichment" fields, its docstring already flagging them as "not yet consumed...
expose to rules only after measuring real-world availability" -- the same posture this
amendment applies, just spelled out as a concrete baseline computation now available to
measure.

`BASELINE_COMPUTATION_VERSION` 5 adds `bodyBatteryWake7dMedian`/`28dMedian`/`28dMad`,
`stressAvg7dMedian`/`28dMedian`/`28dMad`, `stressMax7dMedian`/`28dMedian`/`28dMad`, and
`trainingReadinessScore7dMedian`/`28dMedian`/`28dMad`, plus the matching
`*Vs7dMedian`/`*Vs28dMedian` deltas. `_build_and_store_snapshot` in `service.py` had to
start passing `bodyBatteryWake`/`stress`/`trainingReadiness` into `compute_derived_metrics`'s
`raw_current` argument (it previously only passed sleep/RHR/HRV/respiration/steps) --
without that, every delta for these three metrics would resolve to `None` regardless of
window data, since a delta needs today's value alongside the baseline. No `POLICY_VERSION`
bump: `rules.ts`/`fatigue.ts` are unchanged.

Same absence/optionality rule as before: documents written before `baselineComputationVersion`
5 lack these fields entirely, and none of it is threaded into `EngineObjectiveInput`.
