# ADR-0047: Fixed-Load Mean Velocity Assessment Series and Identity Architecture

* **Status:** Proposed
* **Date:** 2026-09-30
* **Deciders:** Repository owner
* **Primary issue:** #897 (WP6.6 / Appendix A)
* **Source analysis:** [2026-09-30 physical-capital assessment integration](../analysis/2026-09-30-issue-897-physical-capital-assessment-integration.md)
* **Scoped implementation design:** [2026-09-30 physical-capital assessment history](../plans/2026-09-30-issue-897-physical-capital-assessment-history.md)
* **Extends:** ADR-0023 D-MOBS, ADR-0041 typed strength goals, ADR-0046 first-class raw assessment trials
* **Related:** ADR-0002 user-scoped Firestore isolation, ADR-0033 sports knowledge registry

---

## Context

In strength and power diagnostics, mean concentric velocity (measured via linear position transducers or video velocity analysis such as WL Analysis) at a standardized, fixed submaximal absolute load (e.g. 60 kg bench press, 80 kg back squat) provides a sensitive, low-fatigue indicator of neuromuscular readiness, movement quality, and true force-velocity adaptation. Direct 1RM testing is a valid maximal-strength measure when appropriate, but it is not necessary for frequent longitudinal monitoring. A standardized fixed-load velocity check can provide a lower-cost repeat measure between question-driven maximal tests.

However, the current Performance Outcome Validation (OV) evidence stack (ADR-0023, ADR-0046) enforces a fundamental identity constraint:

$$\text{observationKey} = \text{assessmentAttemptId} : \text{metricId}$$

Each assessment attempt may emit at most **one** canonical observation revision per metric. Furthermore, progress derivation (ADR-0023, `ov-progress-v1`) relies on a single comparison series identity:

$$\text{Series} = (\text{protocolId}, \text{protocolRevision}, \text{metricId}, \text{comparisonSeriesKey})$$

During an October 2026 baseline or subsequent checkpoint, an athlete performing a 1RM test records multiple progressive trials with velocity data across warm-up loads (e.g. 40 kg, 60 kg, 80 kg, 100 kg, 107.5 kg). Storing velocity as raw trial evidence (ADR-0046) preserves the telemetry, but without a canonical observation identity, fixed-load velocity cannot be tracked longitudinally with baseline, delta, and progress evaluation.

Issue #897 WP6.6 requires evaluating the architectural options for fixed-load velocity longitudinal tracking and recommending one normative path.

---

## Evaluation of Architectural Options

### Option A: Dedicated Fixed-Load Protocol per Exercise

#### Description
Create distinct, standardized measurement protocols specifically designed for fixed-load velocity testing:
* `strength-bench-press-fixed-load-velocity` (metric: `mean_concentric_velocity_mps`)
* `strength-back-squat-fixed-load-velocity` (metric: `mean_concentric_velocity_mps`)

The protocol requires series-defining comparison context dimension `test_load_kg` alongside `equipment_setup_id`, `grip_style`, etc. When an athlete tests at 60 kg, the series key hashes `{ equipment_setup_id: "...", test_load_kg: 60 }`. If they subsequently test at 70 kg, a distinct comparison series is automatically established, preventing invalid cross-load velocity comparisons.

The athlete runs this assessment as a dedicated, brief test session (e.g. 3 warm-up sets, then 3 maximal-intent single repetitions at the fixed target load).

#### Trade-offs
* **Pros:**
  1. **Identity-Schema Preserving:** Conforms to ADR-0023 and ADR-0046 without changing the one-observation-per-metric-per-attempt identity or Firestore document shape.
  2. **Bounded Blast Radius:** Reuses `observationKeyFor(attemptId, metricId)` and existing `computeSeriesProgress` logic, while still requiring normal registry/rules additions for the new canonical metric and `test_load_kg` comparison dimension.
  3. **Methodological Rigor:** Standardizes warm-up pacing, rest intervals, and intent specifically for velocity testing rather than treating velocity as an incidental byproduct of a maximal grind.
  4. **Clean Series Separation:** Load changes automatically trigger setup/method comparability boundaries (Decision D1).
* **Cons:**
  1. Athlete must perform a dedicated assessment attempt rather than piggybacking on an existing 1RM test.

---

### Option B: Derived Companion Attempts from 1RM Warm-Up Trials

#### Description
When an athlete completes a comprehensive 1RM attempt (`strength-bench-press-1rm`), a post-processing capture reducer inspects the raw trial records. If trials exist at designated standard target loads (e.g. exactly 60.0 kg with valid execution and velocity telemetry), the system synthesizes a companion `AssessmentAttempt`:
* Protocol: `strength-bench-press-fixed-load-velocity`
* Parent / Source: `derivedFromAttempt: 'attempt-1rm-123'`
* Emits a canonical observation linked to the 1RM attempt's trial refs.

#### Trade-offs
* **Pros:**
  1. Captures fixed-load velocity without extra athlete testing overhead during 1RM testing weeks.
  2. Retains the one-observation-per-attempt invariant by minting a separate companion attempt.
* **Cons:**
  1. **Lifecycle Coupling:** If a trial on the primary 1RM attempt is corrected or superseded, cascading re-derivation across multiple attempt documents is required.
  2. **Security Rules Complexity:** Client-side creation of companion attempts creates authorization ambiguities in Firestore rules.
  3. **Warm-Up Non-Standardization:** In a 1RM protocol, submaximal sets are executed as potentiating warm-ups (varying rest periods, varying velocity intent), compromising velocity reliability compared to dedicated testing.

---

### Option C: Multi-Instance Observation Key Extension

#### Description
Extend the canonical observation model to support multiple instances of a metric per attempt by generalizing the observation key:

$$\text{observationKey} = \text{assessmentAttemptId} : \text{metricId} : \text{instanceDiscriminator}$$

where `instanceDiscriminator` could be `load_60kg`.

#### Trade-offs
* **Pros:**
  1. A single multi-load assessment session (e.g. load-velocity profile test) can emit 5 different velocity benchmark points from a single attempt.
* **Cons:**
  1. **Massive Architectural Mutation:** Violates core assumptions across `app/firestore.rules`, `metricObservationService`, `OutcomeMetricBinding`, goal tracking, and progress derivation.
  2. **Security Rule Expansion:** Firestore rules currently validate `resource.data.metricId` against document key parsing. Extending this to arbitrary instance keys opens injection and authorization surface.
  3. **High Migration Cost:** All historical observation heads and revisions would require migration or dual-path handling.

---

## Proposed Recommendation

While this ADR remains **Proposed**, Option A (Dedicated Fixed-Load Protocol per Exercise) is the recommended path for fixed-load velocity assessments. It does not become normative until the ADR is accepted.

### Proposed Decision Rules

1. **Dedicated Protocols:** Fixed-load velocity is modeled as a first-class `MeasurementProtocol`:
   - Bench press: `strength-bench-press-fixed-load-velocity`
   - Back squat: `strength-back-squat-fixed-load-velocity`
2. **Canonical Metric:** Uses metric `mean_concentric_velocity_mps` (unit: `m/s`, direction: `higher_is_better`).
3. **Series-Defining Load:** `test_load_kg` is a required, series-defining comparison context dimension. Any change in test load automatically creates a distinct longitudinal series, marked non-comparable under Decision D1.
4. **Trial Capture:** Each attempt captures 2–3 maximal-velocity repetitions at the locked load. Reducer selects the peak valid mean velocity.
5. **No Observation-Identity Schema Mutation:** The core `observationKey = ${attemptId}:${metricId}` contract remains unaltered.
6. **Registry/rules work is still required:** add `mean_concentric_velocity_mps` and `test_load_kg` through the existing TypeScript registry + Firestore allowlist parity path before any protocol using them can persist canonical evidence.

---

## Consequences

* **Security & Invariants:** No database-shape or observation-key migration is required. `firestore.rules` and the TypeScript registry must still be extended in lockstep for the new metric/dimension, preserving the existing parity tests and data-integrity checks.
* **Progress & History:** Integrates transparently into `AssessmentHistory` and normalized CSV export without special-casing.
* **Athlete Experience:** Clear separation between maximal force capacity (1RM) and neuromuscular movement velocity (fixed load).
