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

### Amendment (2026-08-20): respiration rate — median/MAD baseline and comparison-only strain plumbing

Respiration rate's `respiration7dAvg`/`respiration28dAvg`/deltas were computed and persisted
from the start of this ADR but never consumed by `evaluateReadinessAndSafetyEnvelope` --
observed and recorded, not decision-relevant (the pattern `RawMetrics`'s docstring calls out
for other unwired enrichment fields). The v3 work adds a robust baseline and the plumbing
needed to compare a respiration strain candidate without enabling it in production by
default:

1. **Median, not mean, for the respiration baseline** (`calculate_median` in
   `src/garmin_sync/metrics.py`, `BASELINE_COMPUTATION_VERSION` 3). Elevated respiration
   during illness or another transient physiological disturbance can contaminate a trailing
   mean baseline and inflate population stdev. Median/MAD is therefore a reasonable robust
   anomaly-detection candidate. The matching spread estimator is `respiration28dMad`
   (`calculate_mad`, raw MAD multiplied by the normal-consistency constant `1.4826`). That
   scaling makes MAD approximately stdev-comparable under a Gaussian distribution; it does
   **not** make MAD universally equivalent to standard deviation for arbitrary wearable data.
2. **`respirationStrain` exists in `metricStrain` as a latent comparison path**
   (`app/src/engine/rules.ts`), with reference weight `RESPIRATION_STRAIN_WEIGHT = 0.3` and
   `sign = -1` (elevated respiration is adverse, same sign convention as RHR). The weight and
   the 1.0 br/min floor are first-pass modelling heuristics, not calibrated production
   parameters. `mapSnapshotToEngineInput` therefore exposes a `RespirationStrainPolicy`
   selector whose default is `'off'`; normal production calls emit `null` respiration strain
   inputs. Replay/comparison tooling may explicitly request `'median-mad-v1'` to exercise the
   real engine path without duplicating scoring logic.

Compatibility and data-availability rules are strict:

* documents with `baselineComputationVersion < 3` may already contain non-null respiration
  deltas, but those deltas were computed against **mean** baselines and must never enter the
  median/MAD scoring path;
* a v3+ document without a measured `respiration28dMad` is also decision-inert -- the engine
  must not substitute a generic scoring floor for an unavailable personal spread estimate;
* only explicit `'median-mad-v1'` comparison calls with v3+ data **and** a measured MAD may
  forward respiration deltas/MAD into `EngineObjectiveInput`.

The 1.0 br/min floor must not be described as Garmin device/export resolution without direct
provider documentation or raw-data evidence. It is only a candidate scoring floor to be
challenged by replay. Likewise, the evidence supports respiration as a potentially useful
early illness/anomaly signal, but not as a disease-specific detector.

ADR-0024 records the metric-specific estimator policy and the evidence/release criteria that
must be satisfied before this candidate can become live.

### Positive
* Transparent, debuggable strain metrics provided alongside every workout recommendation.
* Accurately distinguishes between temporary acute fatigue and accumulated chronic overtraining.
* Respiration median/MAD data and the real scoring path are available for replay/sensitivity
  analysis without silently changing production recommendations.

### Negative
* Requires maintaining robust baseline calculation algorithms in both Python ingestion (historical calculations) and TypeScript frontend types.
* Respiration now has a second baseline-statistic convention (median/MAD) alongside the
  mean/stdev pair used for HRV, RHR, and sleep score -- a reader of `metrics.py` or
  `rules.ts` has to know which metric uses which, rather than one uniform rule.
* The latent respiration scoring code and reference weight must not be mistaken for validated
  production policy merely because they compile and are testable.

### Amendment (2026-08-20): median/MAD added, observation-only, for sleep/RHR/HRV/steps

The respiration amendment above changed that metric's persisted baseline because its old
mean/stdev baseline was dormant at the time of the estimator change. Sleep score, RHR, and
HRV are different: their mean/stdev baselines are live inputs to `metricStrain` today, and
steps' mean (`steps_7d_avg`) is a live input to `fatigue.ts`'s ambulatory-surge check
(`steps28dStdev` itself is currently dormant). Swapping any of those outright would change
real recommendations without the evidence this project requires first -- ADR-0014 set that
bar explicitly: a live decision function changes only after measured-response evidence and a
recorded comparison.

So this step is **additive only**: `BASELINE_COMPUTATION_VERSION` 4 adds
`sleepScore7dMedian`/`28dMedian`/`28dMad`, `restingHr7dMedian`/`28dMedian`/`28dMad`,
`hrv7dMedian`/`28dMedian`/`28dMad`, and `steps7dMedian`/`28dMedian`/`28dMad` (plus the
matching `*Vs7dMedian`/`*Vs28dMedian` deltas on `DerivedDeltas`) computed *alongside* the
existing mean/stdev fields, not replacing them. Nothing in `rules.ts` or `fatigue.ts` reads
these yet.

Crucially, these fields do **not** imply that median/MAD is the preferred future estimator for
all four metrics. ADR-0024 records the current research-based candidate set:

* RHR: compare robust median for anomaly detection against mean/EWMA for gradual drift;
* HRV: compare median/MAD against log-domain rolling mean plus CV/SD rather than assuming a
  robust cutover;
* sleep score: keep personal baselines descriptive and compare them against absolute and
  short multi-night semantics because the score is a bounded vendor composite;
* steps: separate habitual-activity baseline semantics from actual mechanical/load semantics,
  and test weekday-aware baselines.

Documents written before `baselineComputationVersion` 4 simply lack these fields
(`undefined`, not `null`) -- readers must treat them as optional. `app/src/engine/models.ts`
mirrors them on `DailyRecoverySnapshot.derived` for the same reason, but they are
deliberately **not** threaded into `EngineObjectiveInput`/`adapters.ts`.

### Amendment (2026-08-20): median/MAD extended to body battery wake, stress, training readiness

Same additive-only posture as the amendment above, extended to three more metrics: body
battery wake, stress (avg/max), and training readiness score. The difference from the
sleep/RHR/HRV/steps amendment is that none of these three had *any* baseline before --
body battery wake is read live in `rules.ts` (`BODY_BATTERY_LOW_ANCHOR`,
`BODY_BATTERY_RECOVER_THRESHOLD`) but only against fixed absolute thresholds, never a
personal baseline; stress and training readiness are `CanonicalDailyMetrics`'s own
"metric enrichment" fields, its docstring already flagging them as "not yet consumed...
expose to rules only after measuring real-world availability".

`BASELINE_COMPUTATION_VERSION` 5 adds `bodyBatteryWake7dMedian`/`28dMedian`/`28dMad`,
`stressAvg7dMedian`/`28dMedian`/`28dMad`, `stressMax7dMedian`/`28dMedian`/`28dMad`, and
`trainingReadinessScore7dMedian`/`28dMedian`/`28dMad`, plus the matching
`*Vs7dMedian`/`*Vs28dMedian` deltas. `_build_and_store_snapshot` in `service.py` also passes
`bodyBatteryWake`/`stress`/`trainingReadiness` into `compute_derived_metrics`'s `raw_current`
argument so the observation-only deltas can be computed.

These metrics must remain observation-only until correlation/double-counting is addressed.
Garmin's stress, sleep, Body Battery and Training Readiness are overlapping composites rather
than independent physiological channels; blindly summing positive strain weights for all of
them would count substantially shared HRV/sleep/stress information multiple times. ADR-0024
requires either a weak Garmin-composite prior or the project's own constituent-signal model
to be evaluated explicitly rather than summing both.

Same absence/optionality rule as before: documents written before `baselineComputationVersion`
5 lack these fields entirely, and none of it is threaded into `EngineObjectiveInput`.
