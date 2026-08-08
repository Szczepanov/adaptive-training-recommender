# ADR-0014: Objective Credit V2 and Honest Delivered Load

* **Status:** Accepted
* **Date:** 2026-08-08
* **Deciders:** Core Engineering Team

---

## Decision

The engine uses one fractional objective-credit ledger. `stimulus.ts`
`deriveObjectiveCredit` is the only objective-specific credit calculation;
`microcycle.ts` `creditObjectivesFromStimulus` accumulates its result in
`WeeklyObjective.completedCredit`, and `requiredCredit` determines whether an objective
remains unresolved. `completedExposures` is retained only as a compatibility projection
for older UI/report readers.

Keyword matching in `updateMicrocycleProgress` remains the documented last-resort path when
an external record has no usable stimulus profile. It no longer updates a parallel counter:
a keyword match contributes a conservative `0.5` compatibility credit to the same
`completedCredit` ledger. This makes replay independent of whether structured evidence or a
legacy fallback record is encountered first while still preventing one keyword-only record
from resolving a one-credit objective by itself.

The currently available evidence supports stimulus-vector contribution, delivered duration,
and an independently supplied completion ratio. For endurance/power objectives, when both
planned and completed duration are measured, credit is scaled by
`completedDurationMin / plannedDurationMin` (clamped to 0..1); an independently supplied
`completionRatio` scales that result separately. `strength_maintenance` deliberately does
not use elapsed duration as a proxy for useful sets or relative load. Credit rules do not
claim to evaluate effort count, interval recovery, aerobic-load context, or event context
until those signals are collected with provenance.

`WorkoutStimulusProfile` has eight required canonical axes. Persisted legacy-only records
are converted at `readStimulusProfile`; canonical values always win per axis and a valid
legacy rename may backfill only a missing corresponding canonical axis. Every supplied
canonical or legacy value must be a finite number in the documented `0..1` range. Conflicts
are logged, and malformed values make the record `DataState.INVALID` rather than allowing
`NaN` or out-of-range credit into the ledger. The former repository-wide `0.8` and `0.7`
derivations are not recreated. A record with neither vocabulary is also
`DataState.INVALID`, never a zero-stimulus profile.

Completed-load cost is the existing six-dimensional base cost scaled by delivered duration
relative to a comparable catalog session and, where independently supplied, completion
ratio. Unknown modalities receive no invented reference duration.

`PlannedDose` has separate `volume` and `intensity` components. In ADR-0012 explicit mode,
the active authored `PlanBlock` owns both values exactly; generic days-to-event
periodization is used only when there is no active authored plan block. This prevents the
September travel (`0.6 / 0.8`) and taper (`0.5 / 1.0`) blocks from being overwritten by a
generic phase scale. Volume reaches the execution-dose ceiling; intensity gates hard
candidates only below the established Base-phase 0.8 scale. The immutable recommendation
audit stores both planned and execution doses.

Forecast planning does not mutate completed evidence. Future recommendations accumulate in
`WeeklyObjective.projectedCredit`; subsequent projected days use
`completedCredit + projectedCredit` to determine forecast outstanding objectives. The
planner's displayed `objectiveCredits` and `addressesObjectives` are derived from the same
V2 `deriveObjectiveCredit` result as the authoritative live ledger, including fractional
credit. The former V1 `stimulusCoverage >= 0.6` display gate is no longer a second planning
credit model.

Training-history ingestion sorts chronological input before replay. Fatigue retains a raw,
unsaturated external-load state and exposes a clamped projection for ranking. The current
external/internal fusion remains `max()`. The Phase 0 scenario harness compared it with
the monotonic capped-addition candidate, `min(1, external + internal)`: `max()` produced
58.9% rest/recovery days (169/287), while capped addition produced 70.4% (202/287).
Both trajectories violate the current aggregate recovery-share gate. The evidence therefore
supports only **retaining `max()` for now because this candidate is worse**; it does not
establish `max()` as a safe or validated fusion model. A different fusion model requires
new measured-response evidence and calibration.

### Cutover evidence amendment

The original Phase 4 plan required one iteration of a parallel V1/V2 shadow run before
cutover. That gate is amended here rather than leaving a knowingly deprecated credit model
live in parallel. V1's semantics are already identified as defects: a hard `0.6` coverage
threshold discards legitimate partial work, keyword matching can misclassify modality/type,
and V1 has no delivered-duration semantics.

The cutover gate is therefore a deterministic semantic-divergence regression matrix plus
the scenario harness, with every intended divergence named and tested. The required matrix
covers at minimum:

1. qualifying stimulus below the old `0.6` coverage threshold earns fractional V2 credit
   instead of V1's zero;
2. abbreviated endurance work earns less credit than the same stimulus delivered for the
   planned duration;
3. malformed persisted stimulus (`string`, `NaN`, or outside `0..1`) is rejected instead of
   entering the ledger;
4. keyword-only compatibility evidence contributes the documented `0.5` credit to the same
   ledger and is order-independent with structured evidence;
5. qualification failures still earn zero credit; and
6. forecast recommendations update `projectedCredit`, not `completedCredit`.

These are intentional, explainable divergences rather than unexplained shadow drift. Any
future change outside this matrix must either add an explicit reviewed divergence or fail
regression. The broader scenario harness remains a release gate for coaching-policy effects;
its current aggregate recovery-share failure is still unresolved and is not waived by this
credit-model amendment.

## Consequences

* Partial work remains unresolved until enough fractional credit accumulates, even if a
  legacy display counter shows that a session contributed.
* An abbreviated endurance session no longer receives the same objective credit as the same
  stimulus delivered for the full planned duration.
* Keyword-only legacy evidence remains usable but is explicitly lower-confidence and cannot
  resolve a one-credit objective in one hit.
* Malformed persisted stimulus cannot inject `NaN` into objective progress.
* Projected recommendations remain distinguishable from completed evidence.
* An authored travel/taper block owns its exact planned volume and intensity.
* Long and abbreviated completed sessions no longer contribute identical external cost.
* A taper can reduce duration while retaining quality eligibility.
* `max()` fusion is retained as the status quo, not declared safe; the release approval
  remains gated by simulation evidence. The 2026-08-08 scenario run reported a 58.9%
  aggregate recovery share, outside its current 5–40% bound; this is recorded as a release
  blocker, not normalized away.

## Code references

* `stimulus.ts` `deriveObjectiveCredit` and `readStimulusProfile`
* `microcycle.ts` `creditObjectivesFromStimulus`, `updateMicrocycleProgress`, and `getUnresolvedObjectives`
* `planner.ts` `applyProjectedObjectiveCredits` and V2 planning-credit projection
* `completedTraining.ts` `scaleCostByDeliveredDose`
* `fatigue.ts` `buildFatigueStateFromHistory` and `applyCompletedSessionLoad`
* `trainingIntent.ts` `resolvePlannedDoseForDate`; `optimizer.ts` `isIntensityClassAdmissible`
* `phase4ReviewFixes.test.ts` cutover-divergence and regression matrix
