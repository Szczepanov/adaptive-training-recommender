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
for older UI/report readers. Keyword matching in `updateMicrocycleProgress` is the
documented last-resort path when an external record has no usable stimulus profile.

The currently available evidence supports stimulus-vector contribution and completion
ratio only. Credit rules therefore do not claim to evaluate effort count, interval recovery,
aerobic-load context, or event context until those signals are collected with provenance.

`WorkoutStimulusProfile` has eight required canonical axes. Persisted legacy-only records
are converted at `readStimulusProfile`; canonical values always win, conflicts are logged,
and the former repository-wide `0.8` and `0.7` derivations are not recreated.

Completed-load cost is the existing six-dimensional base cost scaled by delivered duration
relative to a comparable catalog session and, where independently supplied, completion
ratio. Unknown modalities receive no invented reference duration. `PlannedDose` has
separate `volume` and `intensity` components: volume reaches the execution-dose ceiling;
intensity gates hard candidates only below the established Base-phase 0.8 scale. The
immutable recommendation audit stores both planned and execution doses.

Training-history ingestion sorts chronological input before replay. Fatigue retains a raw,
unsaturated external-load state and exposes a clamped projection for ranking. The current
external/internal fusion remains `max()`: no replacement is selected until the Phase 0
harness compares candidates against coaching invariants.

## Consequences

* Partial work remains unresolved until enough fractional credit accumulates, even if a
  legacy display counter shows that a session contributed.
* Long and abbreviated completed sessions no longer contribute identical external cost.
* A taper can reduce duration while retaining quality eligibility.
* The fusion-model decision and release approval remain gated by simulation evidence. The
  2026-08-08 scenario run reported a 58.9% aggregate recovery share, outside its current
  5–40% bound; this is recorded as a release blocker, not normalized away.

## Code references

* `stimulus.ts` `deriveObjectiveCredit` and `readStimulusProfile`
* `microcycle.ts` `creditObjectivesFromStimulus` and `getUnresolvedObjectives`
* `completedTraining.ts` `scaleCostByDeliveredDose`
* `fatigue.ts` `buildFatigueStateFromHistory` and `applyCompletedSessionLoad`
* `trainingIntent.ts` `resolvePlannedDose`; `optimizer.ts` `isIntensityClassAdmissible`
