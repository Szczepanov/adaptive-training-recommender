# ADR-0038: Engine-Generated Recovery Placement as a Requirement

* **Status:** Proposed
* **Date:** 2026-09-07
* **Deciders:** Repository owner
* **Source analysis:** [PR #453](https://github.com/Szczepanov/adaptive-training-recommender/pull/453) review; [recommender optimization analysis](../analysis/2026-09-07-recommender-optimization-opportunities.md)

## Context

`scenarios.test.ts` has asserted a cross-scenario invariant since the simulation harness
existed:

```ts
expect(result.restOrRecoveryDayCount).toBeGreaterThan(0);
```

Nothing in the engine currently guarantees that outcome. The invariant held because
projected fatigue accumulated quickly enough that the readiness tier eventually reached
`recover` and Rest became the only admissible candidate.

PR #453 corrects a state-fidelity defect: the week-ahead ledger previously charged the full
authored template even when a reduced `activeDose` was the dose actually prescribed.
Charging the prescribed dose lowers projected load, and in
`reduced_time_equipment_limited_borderline` the emergent recovery day disappears.

That is not a defect in PR #453. It exposes a separate contract gap: a user-visible recovery
property was asserted by tests but produced only as an accidental consequence of inflated
fatigue.

This ADR decides the shape of an explicit recovery-placement policy. It deliberately uses
**recovery exposure** rather than **full rest day**: a qualifying active-recovery identity
may satisfy the policy. This is a product scheduling policy, not a claim that every athlete
physiologically requires one complete day without training every seven days.

## Existing machinery and the gaps it leaves

`recovery_or_rest` already exists as a required coverage key in the event and Evergreen
coverage descriptors. When an active plan block exists, `buildCoverageState` can synthesize
it as a `must_have` `WeeklyCoverageRequirement` with a minimum of one session.

Three existing boundaries prevent that from becoming a general recovery-placement
contract:

1. `deriveRequiredRoleOccurrences` deliberately filters `recovery_or_rest`, implementing
   ADR-0018's decision that recovery does not reserve a discretionary training date.
2. `coverageNeedTierForTemplate` treats `recovery_or_rest` as deferred support, so an unmet
   minimum normally remains behind hard weekly roles.
3. `buildCoverageState` returns an empty state when there is no active plan block or no
   descriptor. A plan-less athlete therefore has no recovery requirement at all.

There is an additional implementation constraint that matters to Option D below:
`coverageNeedTierForTemplate` can classify a candidate only when `CoverageState` has both a
non-null phase and a descriptor capable of mapping exact workout identity to a coverage
key. Merely inserting a requirement into `requirements[]` while leaving plan-less
`phase`/`descriptor` null would create a requirement that can never rank a recovery
candidate above tier 3.

### Existing recovery-streak heuristic

Coverage is not the only recovery mechanism. `optimizer.recovery_streak_heuristics` is an
existing, registered and alignment-tested product policy. Across the contiguous prior
non-recovery run, days with `systemicCost >= 0.40` contribute to a streak. At a count of
three or more with no unresolved objectives, Rest/Mobility receives a positive multiplier
while easy aerobic work is suppressed.

PR #453 changes the projected-history `systemicCost` input from authored dose to effective
dose. That can move a template across the `0.40` threshold. It is a real policy-lineage
question, but it is not the cause of the failing plan-less scenario and this ADR does not
settle it.

## Evidence boundary

This decision is primarily a repository-contract decision: tests assert a recovery property
that the engine does not own explicitly.

The sports evidence constrains how the policy may be described. The active Sports Knowledge
Registry claim `recovery.training.stress_recovery_balance` records the recovery consensus
position that training stress and recovery must be balanced, while responses to training
and recovery vary materially both between athletes and within the same athlete across
contexts.

An independent evidence check for this review is consistent with that boundary:

* Kellmann et al., *Recovery and Performance in Sport: Consensus Statement* (2018) stresses
  systematic monitoring and inter-/intra-individual variability rather than a universal
  fixed recovery interval: https://pubmed.ncbi.nlm.nih.gov/29345524/
* Li et al., *Effectiveness of Recovery Strategies After Training and Competition in
  Endurance Athletes: An Umbrella Review* (2024) found no particular recovery strategy with
  consistently demonstrated benefit across the endurance literature:
  https://pubmed.ncbi.nlm.nih.gov/38753045/
* Sandbakk et al., *Best-Practice Training Characteristics Within Olympic Endurance Sports
  as Described by Norwegian World-Class Coaches* (2025) describes high low-intensity volume,
  concentrated key-workout days and systematic load-recovery control, with substantial
  sport-specific variation rather than one universal weekly rest structure:
  https://pubmed.ncbi.nlm.nih.gov/40278987/

Therefore the exact cadence in this ADR must be registered as `claimType: 'heuristic'` with
`evidenceCertainty: 'not_applicable'`. It must not be presented as a scientific requirement.
The scientific claim is the boundary supporting individualized stress/recovery management;
the exact scalar is product policy.

## Options considered

### Option A — Re-baseline the failing expectations

Update the tests to match the new plans and merge PR #453 as-is.

**Rejected.** This converts a user-visible contract into a description of current behavior
and removes the only regression signal showing that recovery placement was emergent.

### Option B — Keep charging the full authored dose

Revert the effective-dose projection correction so fatigue continues to force recovery.

**Rejected.** The visible prescription and hidden planning state would disagree again.
Recovery would still depend on a known-wrong load value.

### Option C — Reserve recovery as a required role occurrence

Remove the `deriveRequiredRoleOccurrences` filter and let the weekly allocator reserve a
date for `recovery_or_rest`.

**Rejected.** ADR-0018 explicitly decided that `recovery_or_rest` does not reserve a
discretionary training date. It also would not solve the plan-less identity problem by
itself.

### Option D — Plan-independent recovery requirement with deadline escalation

Represent a product-policy recovery requirement independently of active plan presence,
keep it deferred while there is scheduling slack, then raise its coverage urgency before a
seven-day recovery-free span can close.

## Decision

Adopt **Option D** as the proposed v1 contract, subject to the implementation and acceptance
requirements below.

### Product-policy scalar

For v1:

* minimum: **one qualifying recovery exposure**;
* interval: **every seven consecutive local calendar dates**;
* equivalent invariant: there may be at most **six consecutive non-recovery dates** once
  the policy has authoritative history or a stable bootstrap epoch;
* policy type: **product heuristic**, not a physiological optimum.

This deliberately settles the implementation scalar rather than leaving an ADR that cannot
be implemented or alignment-tested. A later policy version may make the cadence
phase-dependent or athlete-dependent after evidence and outcome calibration.

### Plan-less identity authority

A plan-independent requirement still needs exact identity authority. The implementation
must not return a synthetic requirement with `phase: null` and `descriptor: null`, because
`coverageNeedTierForTemplate` would then return tier 3 for every candidate.

When no active authored `recovery_or_rest` requirement exists:

* `EVERGREEN_GENERAL_COVERAGE_SET` is the exact-identity authority for the baseline product
  policy;
* recovery lookup uses the `general` phase;
* this **does not** synthesize an authored `PlanDefinition`, an authored block, or any
  Evergreen aerobic/strength requirement that was not otherwise produced by the planning
  path;
* audit/trace must identify the authority as product policy rather than plan provenance.

The code may represent that with an explicit authority field or an equivalent recovery-only
coverage context. It must not overload `activeBlockId` to pretend a plan exists.

If an active authored `recovery_or_rest` requirement exists, it remains authoritative and
the baseline product requirement is not duplicated.

### Exact satisfying identities

ADR-0016 exact-identity semantics remain intact. **Category alone never grants recovery
coverage.** A generic `Mobility/Recovery` category is not sufficient unless the workout is
explicitly mapped to `recovery_or_rest` by the active identity authority.

For the baseline product policy, implementation must make the Evergreen mapping complete
for the recovery identities the product actually offers. At minimum it must include:

* `rest_complete_01`;
* `recovery_mobility_tissue_01`;
* `recovery_breathwork_01`;
* `cycling_recovery_spin_01`.

The cycling recovery spin still does **not** earn `aerobic_volume`; the ledgers remain
independent. This closes the current descriptor inconsistency where the event coverage set
recognizes the spin as recovery but Evergreen does not, and avoids making a plan-less
cyclist's legitimate active-recovery prescription invisible to the new policy.

### Deadline semantics

The existing trailing-window counters are not, by themselves, a placement deadline.
`WeeklyCoverageRequirement.windowEnd` currently describes a plan/block boundary and must
not be reused as the recovery due date.

For a latest qualifying recovery exposure on local date `R`, the next recovery exposure is
**due no later than `R + 7 days`**. On that due date, recovery urgency must already be tier 1,
even though a trailing history calculation that excludes the candidate date may still see
`R` and report the old minimum as fulfilled.

This distinction is essential. Without it the engine can schedule training on `R + 7`,
creating the recovery-free window `R + 1 ... R + 7` and violating the stated invariant.

The implementation therefore needs an explicit or derived `dueByDate`/deadline signal
separate from the historical minimum counter.

#### Bootstrap and missing-history behavior

Absence of a recorded workout is not proof that the athlete rested, and absence of a
recorded recovery exposure is not automatically proof that the athlete did not recover.
The implementation must distinguish **authoritative no-recovery history** from **unknown
history**.

A brand-new or history-incomplete athlete must use a stable bootstrap epoch for the policy;
the deadline may not slide forward every time the rolling plan is recomputed. The exact
storage/source of that epoch is an implementation choice, but the acceptance test must
prove that repeated daily recomputation cannot postpone recovery indefinitely.

### Projected recovery versus historical recovery

Within one week-ahead forecast, an engine-selected recovery identity may count as
`projected` coverage so later projected days can be sequenced coherently.

Across daily recomputation, however, yesterday's recommendation must not become completed
recovery merely because the engine recommended it. The historical ledger needs positive,
auditable evidence:

* a performed exact active-recovery workout can enter through canonical performed-training
  facts;
* an ADR-0035 authored rest directive can enter through the authored-rest bridge below;
* an engine-generated complete Rest day requires a day-outcome fact derived from the
  persisted recommendation/audit decision and post-day canonical occurrence reconciliation.

Missing telemetry alone must never manufacture a completed Rest fact. If a contradictory
performed occurrence replaced the recommended Rest, the Rest credit is removed/withheld.

This may require a dedicated day-outcome/recovery fact rather than forcing deliberate
non-training through `PerformedTrainingOccurrence`.

### How an ADR-0035-authored rest day satisfies it

ADR-0035 `restDays` is a plan directive, not a training session. To satisfy the recovery
policy without inventing a workout, the directive materializes a `recovery_or_rest`
coverage fact on its resolved plan-local date.

That fact must carry enough provenance to preserve ADR-0035 replay identity, including the
plan identity/revision/content hash, directive id and resolved date. The current generic
`CoverageCreditSource` shape is not sufficient to express that provenance by itself; the
implementation must extend the fact/provenance model rather than pretending the directive
was a completed or projected workout.

An `athleteOverridesAuthoredRest` decision removes or suppresses that rest fact. Normal
recovery placement can then resume.

### Allocation, D-SUPPORT and miss reporting

ADR-0018 remains authoritative:

> `recovery_or_rest` remains satisfied by the existing coverage ledger and recovery policy;
> it does not reserve a discretionary training date.

Therefore `recovery_or_rest` is not promoted to `RequiredRoleOccurrence` and the existing
filter remains.

On a train/modify-tier date, an escalated recovery selection remains subordinate to
D-SUPPORT viability. The implementation must verify that the viability proof is not skipped
merely because recovery is the only ranked candidate; candidate-count shortcuts must not
turn an ADR-0018 protected required role into collateral damage.

Because recovery takes no allocator reservation, D-MISS does not report it. ADR-0038 needs
its own typed diagnostic for:

* deadline closed unfulfilled;
* recovery escalated;
* D-SUPPORT rejected escalated recovery;
* recovery deferred because of a hard safety/availability constraint;
* historical recovery state unknown rather than unmet.

### Ranking authority

* With slack before `dueByDate`, qualifying recovery remains deferred-support **tier 2**.
* On `dueByDate`, or when already overdue, qualifying recovery becomes **tier 1**.
* It never escalates to tier 0.
* Every hard safety, clinical, availability, equipment and readiness gate still runs before
  this ordering participates.

This is a statement about ADR-0016/ADR-0018 coverage-need ordering, not ADR-0011's separate
post-gate anchor modifiers. ADR-0011's "anchors nudge; they do not command" remains true for
those modifiers. The existing `coverageNeedTierForTemplate` comment describing tier 0 as
"date-level programming authority" should be re-scoped when that function is touched; it is
a lexicographic ranking key, not global authorship authority.

### Separation from readiness

Recovery placement does not assert physiological `recover` mode.
`evaluateReadinessAndSafetyEnvelope` continues to compute `train` / `modify` / `recover`
from its own inputs. A well-recovered athlete may therefore have a `train` verdict on a day
where the product-policy recovery requirement selects Rest or active recovery.

Keeping the two facts separate preserves audit truth and matches ADR-0035's separation of
plan intent from physiological state.

## Acceptance tests

The existing `restOrRecoveryDayCount > 0` assertion remains useful as a coarse smoke metric,
but it is far too weak to prove a seven-day invariant over a multi-week simulation. The
implementation is not complete without deterministic tests for all of the following:

1. **Rolling-window invariant:** every complete seven-local-date window after bootstrap has
   at least one qualifying recovery exposure.
2. **Boundary day:** a recovery on `R` followed by six non-recovery days makes `R + 7` a
   tier-1 recovery deadline before the candidate is selected.
3. **Plan-less ranking:** product-policy recovery receives exact identity authority and can
   actually move from tier 2 to tier 1; `descriptor: null`/`phase: null` cannot silently
   neuter it.
4. **Stable bootstrap:** repeated daily recomputation cannot keep pushing an unknown-history
   recovery deadline forward.
5. **Exact identity:** unmapped generic Mobility/Recovery does not satisfy the policy;
   mapped Rest, mobility/breathwork and cycling recovery-spin identities do.
6. **Authored rest bridge:** an ADR-0035 rest directive satisfies recovery with directive
   provenance; an athlete override removes that credit.
7. **Generated Rest history:** a projected Rest counts inside the current forecast but is
   not promoted to historical completed recovery without the explicit day-outcome path.
8. **Contradictory training:** performed training that replaces a recommended Rest prevents
   completed Rest credit.
9. **D-SUPPORT:** a plan-less case where recovery would otherwise consume the last feasible
   required-role opportunity proves that escalation is still subordinate to viability,
   including the single-ranked-candidate edge case.
10. **Miss diagnostics:** an unfulfilled recovery deadline is observable even though D-MISS
    has no `WeeklyRoleAllocationReport` occurrence for it.
11. **Cross-descriptor consistency:** Evergreen and event recovery mappings intentionally
    differ only where documented, and `cycling_recovery_spin_01` is recovery without
    becoming aerobic-volume credit.

## Observability

The decision trace must record:

* policy id/version;
* authority (`product_policy` versus authored coverage);
* latest qualifying recovery date when known;
* `dueByDate` and whether the requirement is overdue;
* minimum/fulfilled/projected state;
* whether tier escalation applied;
* chosen recovery identity when selected;
* rejection/defer reason when escalation did not produce recovery;
* whether historical recovery state was `known` or `unknown`.

Simulation output should expose both recovery count and maximum consecutive non-recovery
days. This makes erosion measurable rather than hiding it behind a single pass/fail count.

## Knowledge lineage and policy governance

Per ADR-0033, implementation is incomplete without all of the following:

* a product-policy claim such as
  `policy.load_recovery.weekly_recovery_placement_v1`, stating the exact one-in-seven
  cadence, qualifying identity rule and tier-1 deadline escalation;
* `claimType: 'heuristic'`, `evidenceCertainty: 'not_applicable'`, source
  `PRODUCT-EVERGREEN-DOSE-V1`, and a limitation explicitly disclaiming universal
  physiological optimality;
* a reference to `recovery.training.stress_recovery_balance` as the scientific boundary;
* a `knowledgeCoverage.ts` inventory item in `readiness_recovery` or `session_spacing`;
* alignment tests binding the registered policy to the implemented scalar, qualifying
  identities and escalation behavior;
* a `POLICY_VERSION` bump when runtime behavior is implemented.

## Consequences

### Positive

* The repository stops relying on inflated fatigue to produce a tested recovery property.
* PR #453 can preserve effective-dose state fidelity without silently deleting recovery
  placement.
* Plan-less athletes gain explicit recovery scheduling authority with exact identity.
* Recovery becomes observable as a deadline policy rather than an emergent optimizer side
  effect.
* Active recovery remains possible; the ADR does not require a scientifically unsupported
  universal full rest day.

### Negative

* Runtime implementation changes plans for athletes who currently have no active authored
  recovery requirement.
* The one-in-seven scalar is deliberately product policy and will require outcome/simulation
  calibration.
* Historical complete-Rest credit needs a positive day-outcome representation; this is more
  work than treating missing activity as rest, but preserves data-trust semantics.
* Existing Evergreen recovery identity mapping needs an explicit expansion and alignment
  update.

### Neutral

The other PR #453 expectation changes (`race_specific_endurance`, train-tier recovery
warnings and `sustained_quality` placement) are not automatically fixed by this ADR. They
must be re-run and reviewed after implementation rather than bulk re-baselined.

## Deferred questions

1. Should `optimizer.recovery_streak_heuristics` count authored or effective
   `systemicCost` after PR #453? This belongs to that registered policy, not ADR-0038.
2. How does a recovery **date** interact with ADR-0036 intraday windows? A free PM window
   does not make a hard AM-training date a recovery date. The intraday implementation must
   define a day-level aggregation rule before automatic doubles ship.
3. Should future policy versions use phase-aware or athlete-specific cadence/placement
   rather than the v1 one-in-seven product prior? This needs calibration rather than an
   unsupported constant in this ADR.
4. Should the engine optimize recovery placement earlier than the deadline using
   phase-specific sequence intent? Deadline escalation is a safety net for the product
   contract, not a claim that the last legal day is the best recovery day.

## Implementation boundaries

This ADR is still a decision record, not the implementation PR. It does **not** authorize:

* reverting `materializeEffectiveDose` or PR #453's state-fidelity correction;
* changing fatigue half-lives or cost weights to force Rest indirectly;
* turning recovery into an ADR-0018 reservation;
* inferring completed Rest from missing wearable/provider data;
* granting coverage by category/title similarity;
* conflating a recovery placement with readiness `recover` mode.

The implementation should touch the smallest seams that make the contract explicit:
coverage authority/state, recovery deadline calculation, exact recovery identity mappings,
Rest-day outcome provenance, ranking escalation, diagnostics, knowledge lineage and tests.
