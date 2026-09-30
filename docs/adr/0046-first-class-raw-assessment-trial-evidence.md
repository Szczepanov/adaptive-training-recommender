# ADR-0046: First-Class Raw Assessment Trial Evidence

* **Status:** Proposed
* **Date:** 2026-09-30
* **Deciders:** Repository owner
* **Primary issue:** #897
* **Source analysis:** [2026-09-30 physical-capital assessment integration](../analysis/2026-09-30-issue-897-physical-capital-assessment-integration.md)
* **Scoped implementation design:** [2026-09-30 physical-capital assessment history](../plans/2026-09-30-issue-897-physical-capital-assessment-history.md)
* **Extends:** ADR-0023 D-MOBS and the implemented Performance Outcome Validation (OV) evidence architecture
* **Related:** ADR-0034 performed-training reconciliation, ADR-0039 body-composition observations, ADR-0041 typed strength/speed/power goals

---

## Context

The implemented OV stack already owns immutable measurement-protocol revisions, assessment attempts, canonical metric-observation revisions, comparison-series identity, progress derivation and testing through the ordinary session runner.

That model intentionally stores one canonical value per metric per assessment attempt. The planned October 2026 physical-capital baseline includes repeated jump/throw/sprint trials plus squat/bench load-by-load attempts and supplementary WL Analysis velocity. Discarding those raw trials would make later audit, correction and reproducibility weak; encoding every raw field as a canonical metric would pollute the outcome registry and break the existing one-observation-per-metric identity.

Issue #897 therefore needs one additional evidence layer without creating a new physical-capital subsystem or granting assessment evidence recommendation authority.

## Decision outcome

### D-AT-OWNER — OV remains the sole assessment-evidence owner

Raw assessment trials extend the existing OV measurement path. They do not create a second testing domain, progress engine, recommendation input or independent implementation/status authority.

`docs/plans/performance-outcome-validation.md` remains the canonical OV status board. Outcome evidence stays a sidecar to planning/selection unless a later accepted architecture decision grants authority.

### D-AT-IDENTITY — protocol ID and revision stay separate

`MeasurementProtocol.id` is a stable semantic identifier and `MeasurementProtocol.revision` is the numeric immutable revision.

Do not embed revision tokens such as `@1` in protocol IDs. Catalog/test-definition IDs may continue to use their existing `-r1` naming convention when that is part of the catalog identity.

### D-AT-PROTOCOL — capture and reducer semantics are immutable evidence contracts

For a multi-trial protocol, the bounded raw-field schema and deterministic reducer declarations are part of the evidence protocol semantics. They must be persisted/versioned with the immutable `MeasurementProtocol` revision or an equally immutable companion that the protocol revision references.

`PerformanceTestDefinition` may supply presentation/layout hints for those stable field IDs, but it must not be the sole semantic owner. A later catalog/UI release must not reinterpret historical trials by changing a field type, unit or reducer under the same protocol revision. Existing summary-only protocols remain valid through additive optional fields.

### D-AT-TRIAL — repeated attempts are first-class raw evidence

A physical assessment attempt may own zero or more immutable raw trial records below the user-scoped assessment attempt, conceptually:

```text
users/{userId}/assessment_attempts/{attemptId}/trials/{trialId}
```

A trial carries parent attempt identity, stable ordinal, validity, bounded structured values/context, source/device provenance and creation time.

Raw capture fields are declared by the protocol/test capture schema. They are not automatically entries in the canonical `MetricDefinition` registry.

Examples include load, success/miss, RPE, WL Analysis mean/peak velocity, start/peak cadence and left/right cycling balance.

### D-AT-CORRECTION — raw evidence is corrected by append-only supersession

A stored trial is immutable.

Correcting an erroneous trial creates a new trial record that references the superseded trial and records a correction reason. Reducers use the current unsuperseded trial for each ordinal. Historical source evidence remains available for audit/replay.

A canonical observation correction cannot be used as a substitute for correcting its erroneous raw source trial.

### D-AT-REDUCE — canonical observations remain the progress/reporting layer

Bundled multi-trial protocols declare small deterministic, versioned reducers such as:

- maximum valid result;
- highest technically valid successful load.

Reducers consume validated current trial evidence and emit the existing canonical `MetricObservationRevision` outcome values. Raw trials do not enter `deriveProgress()` directly.

Derived canonical observations retain the reducer/algorithm version and typed source-evidence references. Trial IDs must not be written into `derivedFromObservationIds`, because that field promises observation identities. Introduce an additive typed evidence-reference contract while preserving existing observation-to-observation provenance.

The first additive reference kind is an assessment-trial reference carrying the parent `assessmentAttemptId` plus `trialId`. For a trial-only derived summary, a non-empty typed trial-evidence reference list satisfies source-provenance validation. An observation-derived summary must continue to provide non-empty `derivedFromObservationIds`; mixed derivations retain both forms when both source kinds are actually consumed. Trial references must be unique and must name the same assessment attempt as the derived canonical observation.

This is a model, validator **and persistence-rules** contract. `MetricObservationRevision`, `assertValidMetricObservationRevision`, the Firestore observation-revision allowlist/derived-source rule, and their unit/emulator tests must change together. Existing historical derived revisions that contain only `derivedFromObservationIds` remain valid unchanged. Non-derived observations may carry neither observation-derivation IDs nor typed derivation-evidence references.

### D-AT-RAWFIELDS — raw trial fields and canonical outcome metrics are different vocabularies

Only stable longitudinal benchmark outputs belong in the metric registry for the first slice:

- squat/bench use existing `strength_1rm_kg`;
- broad jump, wall-touch CMJ and medicine-ball throw get explicit benchmark metrics;
- the standardized 6 s cycling sprint gets explicit 1 s peak-power and 5 s mean-power metrics.

Peak cadence, start cadence, left/right cycling balance, lift success/miss, RPE and WL Analysis velocity remain structured raw/context fields initially.

Fixed-load bar velocity may become a canonical comparable series only after its identity explicitly includes the exercise, exact absolute load and material measurement/setup identity. Peak velocity remains secondary unless a later use case proves otherwise.

Left/right cycling balance is descriptive context only and is not a standalone corrective target.

### D-AT-BODYMASS — relative values retain source-specific body-mass provenance

ADR-0039 keeps provider and manual body-mass series separate. There is no abstract cross-source canonical weight to silently use.

W/kg or body-mass-relative 1RM may be derived only from an explicitly selected acceptable same-day body-mass evidence point. The derived value retains that source/reference. If such a point is unavailable, the relative value is unavailable; no cross-source substitution or manually entered duplicate ratio is created.

### D-AT-GOALS — measured assessment evidence does not silently change goal semantics

ADR-0041 distinguishes exercise-subject strength goals from performance-test goals.

Performance-test goals may resolve matching canonical observations through their test/protocol identity. Exercise-subject strength goals currently resolve current capability from the strength/e1RM profile. A future measured squat/bench 1RM bridge therefore requires an explicit canonical exercise mapping and resolver behavior that keeps tested 1RM distinguishable from e1RM.

Protocol identity alone must not be treated as exercise identity, and adding an assessment metric does not automatically make it goal-eligible.

### D-AT-OCCURRENCE — assessment evidence does not create a second workout

The testing `SessionRunner` execution is the physical workout. Assessment attempts, trials and metric observations are evidence records about that execution.

The implementation must verify the completed-training/reconciliation path so one physical testing session contributes at most one completed-training exposure, including when provider activity evidence also exists.

### D-AT-AUTHORITY — evidence only

Nothing in this ADR grants assessment outcomes, trial values or progress labels authority over readiness, eligibility, ranking, weekly allocation, dose or session selection.

Any such activation requires the existing separate outcome-to-planning architecture/ship decision and associated policy-version/replay evidence.

## Consequences

### Positive

- preserves all meaningful raw attempts without weakening the canonical benchmark model;
- keeps correction history auditable;
- keeps the metric registry bounded to real longitudinal outputs;
- preserves protocol comparability and derivation provenance;
- avoids duplicate body-mass truth and duplicate completed-workout exposure;
- remains compatible with the existing OV evidence-only authority boundary.

### Costs

- adds one user-scoped trial evidence collection and its rules/emulator coverage;
- adds a bounded capture-schema vocabulary plus deterministic reducers;
- requires additive typed derivation evidence references;
- requires explicit correction/supersession handling instead of simple mutable rows;
- measured strength-goal integration remains additional work rather than falling out automatically from protocol identity.

## Rejected alternatives

### Store only the best result

Rejected because failed/practice/valid trial history, source correction and derivation provenance would be lost.

### Store every raw value as a MetricObservationRevision

Rejected because raw attempt fields are not all longitudinal performance outcomes and the current observation identity is one metric per assessment attempt.

### Mutate raw trials in place

Rejected because canonical summaries could no longer be replayed against the historical evidence that originally produced them.

### Put assessment trial IDs into derivedFromObservationIds

Rejected because the field's semantic contract promises observation IDs.

### Treat any available body mass as interchangeable

Rejected by ADR-0039 source/provenance rules.

### Let assessment completion create a second training-history record

Rejected because assessment evidence and performed-training identity have different lifecycles and one physical workout must not be counted twice.

## References

- [Performance outcome evidence architecture](../architecture/performance-outcome-evidence.md)
- [Performance outcome validation plan](../plans/performance-outcome-validation.md)
- [ADR-0023](./0023-multidomain-session-authoring-execution-and-evidence.md)
- [ADR-0039](./0039-longitudinal-body-composition-and-fueling-observations.md)
- [ADR-0041](./0041-strength-speed-power-performance-goals.md)
