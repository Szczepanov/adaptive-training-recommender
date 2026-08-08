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

### Positive
* Transparent, debuggable strain metrics provided alongside every workout recommendation.
* Accurately distinguishes between temporary acute fatigue and accumulated chronic overtraining.

### Negative
* Requires maintaining robust baseline calculation algorithms in both Python ingestion (historical calculations) and TypeScript frontend types.
