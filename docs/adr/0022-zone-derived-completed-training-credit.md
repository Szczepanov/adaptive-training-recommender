# ADR-0022: Zone-Derived Completed-Training Credit Is a Measured Candidate

* **Status:** Accepted
* **Date:** 2026-08-17
* **Deciders:** Repository owner
* **Related:** [ADR-0010](./0010-decision-provenance-and-audit-replay.md), [ADR-0014](./0014-objective-credit-v2-and-honest-load.md), [ADR-0020](./0020-subjective-baselines-in-readiness-mode.md)

> **Acceptance boundary.** This ADR approves a default-off candidate and the evidence
> needed to assess it. It does not approve enabling zone-derived credit in production.
> Production activation requires a later recorded ship decision, an audit-provenance
> contract, a `POLICY_VERSION` bump, and reviewed simulation plus real-history evidence.

## Context

Garmin activity summaries already let the engine infer a completed-session stimulus from
modality, intensity, Training Effect (TE), and training load. The per-activity ingestion
path now optionally adds exact seconds in seven cycling power zones. Those observations
are more granular than TE, but granularity alone does not establish a valid
zone-to-adaptation coefficient.

Replacing the current profile immediately would repeat the modelling error called out by
D-FUSE and D-SUBJCAL: choosing constants before measuring their consequences. It would
also overstate the evidence. Power-zone time can describe where work occurred; it cannot,
by itself, prove fatigue resistance, identify the authored interval set, or establish
that one minute in a zone has the same value across athletes and sessions.

## Decision

### D-ZONETIER — refine `measuredEffort`; do not add a stronger tier

A complete power-zone distribution from one of ADR-0005's accepted Garmin cycling type
keys may refine the stimulus estimate of a Garmin cycling
event within the existing `measuredEffort` tier. It does not create a new
`EvidenceTier`. An adherence-confirmed catalog match remains `exactPrescribedMatch` and
keeps its authored stimulus profile.

Some provider type keys (`road_biking`, `mountain_biking`, `virtual_ride`) are not
recognized by the legacy substring classifier. The enabled candidate may identify those
explicit accepted power-bearing keys as Cycling for objective qualification, while
preserving the existing TE-derived cost. The selector-off path remains unchanged.

The confidence discount therefore remains the existing `inferred` weight. More detailed
input is not silently promoted to exact knowledge of the workout's intent.

### D-ZONEFEATURE — extracted evidence is explicit and reproducible

The decision-side feature record contains, at minimum:

* seconds and share for each power zone;
* total observed power-zone seconds and coverage relative to activity duration;
* NP, IF, and VI when present; and
* the candidate policy identifier and any fallback reason.

Feature extraction is pure. Missing, partial, duplicate, non-finite, or zero-total zone
data cannot become a candidate. It degrades to the current TE-derived profile.

### D-ZONEMAP — the first candidate is a direct zone-share projection

The reference candidate `power-zones-direct-share-v1` maps observed time shares without
fitted multipliers:

```text
aerobicEndurance = Z2 share + Z3 share
thresholdPower   = Z4 share
vo2MaxPower      = Z5 share
repeatedSurges   = Z6 share
sprintPower      = Z7 share
```

Z1 is recovery/unclassified low work and earns no adaptation axis in this candidate.
`fatigueResistance` remains the TE-derived value because zone totals do not encode
late-session durability. Strength axes remain zero for cycling. Delivered-duration and
confidence scaling continue to happen once, in ADR-0014's existing credit function.

This mapping is an auditable reference candidate, not a claim that zone share is a
validated physiological dose-response function. A different mapping needs a new named
candidate and a side-by-side report; it must not silently change `v1`.

### D-ZONESELECT — production defaults to TE and has no ambient switch

The selector is an explicit engine argument with `training_effect` as its default. No
browser setting, environment variable, Firestore field, or production composition path
enables the candidate. The comparison harness may select `power_zones_direct_share_v1`.

With the selector off, the completed-event and exposure outputs remain identical to the
pre-candidate path. A default-off implementation does not bump `POLICY_VERSION`, matching
ADR-0020's policy-version rule. Enabling it on any deciding production path requires a
bump and moving the outgoing value to `HISTORICAL_POLICY_VERSIONS`.

### D-ZONECOST — zones do not alter fatigue cost in this decision

This candidate changes only `estimatedStimulus`. Existing TE/intensity-derived cost and
ADR-0014 delivered-dose scaling stay authoritative. NP, IF, VI, HR zones, and interval
fade remain evidence fields until separately calibrated; they do not add fatigue.

### D-LAPFADE — lap fade is descriptive and requires an explicit matched set

Lap fade compares the first and last positive-power laps from caller-supplied matched lap
indexes. The feature reports signed power change and non-negative fade percentage. It
does not guess which laps form an interval set and does not affect credit or readiness.

Every result is attributed to the normalized activity's Warsaw-local start date. A
session that crosses midnight remains on its start date; elapsed lap duration never
recomputes the calendar day through UTC.

### D-ZONESHIP — real history may reject or defer the candidate

The measurement report compares TE-derived and candidate objective credit over a bounded
real-history window, reports coverage and disagreements, and runs the synthetic semantic
diff with the production selector off. Synthetic data proves mechanics only. Sparse
eligible history, systematic disagreement without outcome labels, or no demonstrated
decision-quality improvement are sufficient reasons to keep the candidate off.

"Do not ship" and "defer for more observations" are successful outcomes of the
measurement stage when supported by the report.

## Consequences

### Positive

* The finer Garmin signal can be evaluated without changing live recommendations.
* Every candidate value is reconstructible from normalized, bounded evidence.
* Missing power data and non-cycling activities preserve current behavior.
* The evidence ladder and exact adherence authority remain coherent.

### Negative

* The direct-share candidate is intentionally conservative and may under-credit useful
  work that a physiological model would recognize.
* Power-zone history will initially be sparse because historical detail backfill remains
  excluded by ADR-0005's bounded-fetch amendment.
* A useful production model still needs outcome-labelled evidence; finer telemetry does
  not remove that calibration obligation.

## References

* `app/src/engine/garminTelemetryEvidence.ts`
* `app/src/engine/completedTraining.ts`
* `app/src/engine/stimulus.ts` `deriveObjectiveCreditFromProfile`
* `docs/plans/garmin-activity-telemetry-ingestion.md`
