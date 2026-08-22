# Health anomaly causality and canonicalization cleanup

## Status

Implementation complete on PR #181; full CI validation is the remaining gate. The PR is stacked on #179 (`fix/close-sick-contact-tristate`) so its normal base does not match the repository's `pull_request -> main` CI filter. For integration validation, #181 may be pointed at `main` temporarily and then restored to the stacked base.

## Context

This is a follow-up to PR #179. It is intentionally stacked on `fix/close-sick-contact-tristate` so the follow-up architecture work is isolated from the morning check-in redesign.

## Implemented goals

1. Garmin-derived RHR/HRV/respiration are the only canonical physiology source.
2. Same-day training cannot retroactively explain overnight/morning physiology.
3. Health-context defaults have one shared constructor/normalizer used by UI and validation/persistence semantics.
4. Strong context changes interpretation without deleting the observed abnormal core signal or resetting its consecutive physiological persistence.
5. Old persisted manual-physiology keys remain readable at the raw migration boundary but are stripped before canonical decision input.
6. Legacy top-level `illnessSymptoms` truth is migrated into nested symptoms when an old context block did not yet contain nested symptom state.

## Implemented details

### Canonical physiology authority

- Removed manual RHR/HRV/respiration fields from `HealthContextCheckin`.
- Removed `manualSupport()` and all `MANUAL_*` evaluator supporting signals.
- Legacy manual keys are accepted only by raw health-context validation so existing Firestore documents do not become invalid; they are not emitted into canonical health-context data.
- Missing Garmin current values/baselines remain unavailable rather than falling back to athlete guesses.
- The stacked #179 caller still passes an old `manualPhysiologyMissing` prop into `HealthContextSection`; #181 keeps this as an explicitly deprecated no-op shim only to avoid a risky whole-file replacement of the large `DailyCheckin.tsx`. It has no UI, persistence, or evaluator behavior and should be deleted after the stack is flattened/when that caller can be edited safely.

### Temporal causality

- `todayTraining` is never used to explain morning RHR/HRV/respiration.
- Explicit hard training yesterday remains a strong RHR/HRV explanation and weak respiration explanation.
- `last3DaysHardSessionsCount` remains a moderate RHR/HRV context because the backend defines it as D-1 through D-3 only; today's activities are explicitly excluded during snapshot construction.
- Regression coverage proves a same-day hard activity added by a later Garmin sync cannot erase an abnormal morning RHR signal.

### Canonical health-context defaults

`createDefaultHealthContext()` / `normalizeHealthContext()` define:

- symptoms: `false`
- alcohol: `0`
- travel: `none`
- heat/sauna: `false`
- dehydration/fluid loss: `false`
- vaccination: `false`
- medication change: `false`
- close sick contact: `false`

The UI consumes the shared normalizer. Any supplied health-context block is normalized before canonical persistence, so new/supplied records store explicit product defaults. A completely absent historical health-context block remains absent instead of being rewritten as an asserted historical negative.

When a legacy document has `illnessSymptoms: true` but its old context map never contained nested `symptoms`, validation migrates that true value into canonical `healthContext.symptoms.present`. Once nested symptoms are explicitly present in raw data, they remain authoritative.

### Context versus physiology

- Core abnormal measurements remain present in `coreSignals` regardless of explanatory context.
- `unexplainedEvidence` continues to mean the current residual lacking strong contextual coverage.
- `persistenceDays` now tracks consecutive adverse core physiology, including days interpreted as `explained_recovery_strain`.
- Service composition seeds persistence from prior adverse core evidence rather than from `unexplainedEvidence.length`, so a strongly explained prior day cannot reset the physiological trace.
- The developer trace label is now `Adverse physiology persistence` to match this contract.

## Safety invariants

- Missing Garmin data never becomes normal.
- Context never fabricates a physiological anomaly.
- Context never deletes an observed abnormal core signal.
- Same-day post-measurement training cannot explain morning physiology.
- The D-1..D-3 hard-session aggregate remains usable because ingestion explicitly excludes today.
- Historical absence of a whole health-context block is not rewritten as an asserted historical negative.
- Supporting Garmin composites do not count as independent core votes.
- Local tissue restrictions remain independent of health-anomaly interpretation.

## Regression coverage added/updated

- canonical health-context default constructor and null normalization
- legacy illness-to-nested-symptom migration
- legacy manual-physiology acceptance + canonical stripping
- no `MANUAL_*` evaluator signals when Garmin physiology is missing
- same-day training causal-leak regression
- safe D-1..D-3 aggregate context regression
- adverse physiology persistence under strong contextual explanation
- service-level persistence across a prior `explained_recovery_strain` assessment
- health-context persistence of explicit product defaults

## Follow-up experiments / separate changes

These are intentionally not mixed into this cleanup because they change detection policy or require additional ingestion/schema evidence:

1. two-normal-day hysteresis before closing an established episode
2. `one strong core signal + >=3 days persistence` as an alternate escalation route
3. exact respiration/device provenance and baseline segmentation on device/source changes
4. optional health-context attestation timestamp for calibration analytics
5. skin-temperature deviation as an additional candidate signal if Garmin provenance is reliable
6. remove the stacked caller's deprecated no-op `manualPhysiologyMissing` prop once `DailyCheckin.tsx` can be edited safely after #179 is flattened
