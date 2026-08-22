# Health anomaly causality and canonicalization cleanup

## Context

This plan is a follow-up to PR #179. It is intentionally stacked on `fix/close-sick-contact-tristate` so the follow-up architecture work is isolated from the morning check-in redesign.

## Goals

1. Make Garmin-derived RHR/HRV/respiration the only canonical physiology source.
2. Prevent same-day training from retroactively explaining overnight/morning physiology.
3. Centralize health-context defaults so UI, persistence, validation, and evaluator semantics cannot drift.
4. Keep physiological anomalies visible even when a strong contextual explanation exists; context changes interpretation, not whether the abnormal measurement occurred.
5. Preserve backward compatibility for old persisted documents without letting legacy fields enter canonical decision input.

## Non-goals in this PR

The following ideas remain shadow/follow-up work because they change detection policy or require ingestion/schema evidence beyond this cleanup:

- episode closing hysteresis
- persistent single-core-signal escalation
- new core signals such as skin temperature
- device/source-specific respiration provenance migration
- health-context attestation analytics

## Implementation sequence

### 1. Remove manual physiology from canonical paths

- Remove manual RHR/HRV/respiration fields from `HealthContextCheckin`.
- Remove manual physiology props/UI compatibility plumbing.
- Remove `manualSupport()` and `MANUAL_*` supporting signals from the evaluator.
- Continue accepting legacy manual keys at the raw validation boundary only so old Firestore documents remain readable; strip them from validated canonical output.
- Add regression tests proving legacy keys are ignored and missing Garmin physiology remains unavailable.

### 2. Fix temporal causality

- Treat only prior-day/relevant pre-measurement training as an explanation of morning RHR/HRV/respiration.
- Explicitly exclude `todayTraining` from the morning physiological explanation path.
- Add a regression test where an abnormal morning signal remains unexplained after a hard same-day activity appears in a later Garmin sync.

### 3. Canonicalize health-context defaults

Create one shared default constructor/normalizer with:

- symptoms: `false`
- alcohol: `0`
- travel: `none`
- heat/sauna: `false`
- dehydration/fluid loss: `false`
- vaccination: `false`
- medication change: `false`
- close sick contact: `false`

Use it for new check-ins, UI normalization, and validation of supplied health-context blocks. Historical documents with no health-context block remain historically absent rather than being silently rewritten.

### 4. Preserve anomaly evidence under contextual explanations

- Keep adverse core signals in the unexplained/persistence trace instead of deleting them solely because a contextual explanation is `strong`.
- Record strong context as competing/explanatory evidence.
- Preserve `explained_recovery_strain` as an interpretation state when all adverse signals have strong contextual coverage, while retaining the underlying physiological evidence for traceability and persistence analysis.
- Add tests showing vaccination/training/poor sleep cannot erase a measured anomaly from the trace.

## Safety invariants

- Missing Garmin data never becomes normal.
- Context never fabricates a physiological anomaly.
- Context never deletes an observed abnormal core signal.
- Same-day post-measurement training cannot explain morning physiology.
- Historical missing context is not rewritten as an asserted historical negative.
- Supporting Garmin composites do not count as independent core votes.
- Local tissue restrictions remain independent of health-anomaly interpretation.

## Test plan

- health-context validation/parser migration tests
- UI default-constructor tests
- evaluator manual-signal removal tests
- same-day causality regression
- contextual-explanation trace/persistence regressions
- full frontend CI, Firestore rules, simulations, Python suites, dependency audits, Docker build

## Follow-up experiments

After this cleanup is stable, evaluate in shadow mode:

1. two-normal-day hysteresis before closing an established episode
2. `one strong core signal + >=3 days persistence` as an alternate escalation route
3. exact respiration/device provenance and baseline segmentation on device/source changes
4. optional health-context attestation timestamp for calibration analytics
5. skin-temperature deviation as an additional candidate signal if Garmin provenance is reliable
