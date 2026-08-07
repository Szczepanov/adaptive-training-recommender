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

### Positive
* Transparent, debuggable strain metrics provided alongside every workout recommendation.
* Accurately distinguishes between temporary acute fatigue and accumulated chronic overtraining.

### Negative
* Requires maintaining robust baseline calculation algorithms in both Python ingestion (historical calculations) and TypeScript frontend types.
