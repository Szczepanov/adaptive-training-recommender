# Issue #859 analysis — date-scoped #804 mechanical spacing

**Date:** 2026-09-28  
**Issue:** [#859](https://github.com/Szczepanov/adaptive-training-recommender/issues/859)  
**Baseline:** `main` @ `616f7fe9` (`feat(training-occurrence): add historical TO4 replay path (#886)`)  
**Related:** [#804](https://github.com/Szczepanov/adaptive-training-recommender/issues/804), [#805](https://github.com/Szczepanov/adaptive-training-recommender/issues/805), [PR #855](https://github.com/Szczepanov/adaptive-training-recommender/pull/855), [ADR-0018](../adr/0018-weekly-allocation-and-role-reservations.md), [ADR-0033](../adr/0033-sports-knowledge-registry.md), [ADR-0044](../adr/0044-constraint-aware-requirement-fulfilment.md)

This document is a point-in-time architecture/code audit. The executable work order is
[the issue #859 implementation plan](../plans/2026-09-28-issue-859-date-scoped-mechanical-spacing.md).

## Executive conclusion

Issue #859 is real, reproducible from the current ownership boundaries, and narrower than a
mechanical-progression redesign.

The defect is caused by **scope conflation**:

- `evaluateMechanicalStageProgression` owns stage, tissue-response and source-policy safety state;
- its no-consecutive-calendar-day check is inherently **date-local**;
- `resolveEvergreenPlan` evaluates that verdict once at the planning date;
- `buildEvergreenPlanDefinition` then copies the verdict's exact eligible-workout allow-list into the
  seven-day `mechanical_exposure` coverage requirement.

Therefore a mechanical exposure on D-1 makes the D0 verdict `eligible: false` with
`eligibleWorkoutIds: []`, and that empty list becomes a week-wide planning constraint. D1–D6 never get
a chance to become mechanically eligible even though the product rule only intended to reject D0.

The recommended correction is to **split authority by temporal scope**:

1. keep stage, tissue-response, illness, pain/guardrail and 14-day re-entry semantics in the shared
   `MechanicalProgressionVerdict`;
2. remove only the consecutive-day test from that horizon-wide verdict;
3. derive consecutive-day spacing independently for every planning date from the actual/projected
   mechanical history already available to `buildCoverageState` / `evaluateProjectedDate`;
4. enforce that candidate gate only while the current plan carries #804's `mechanical_exposure`
   requirement.

That fourth constraint is important. PR #855 briefly implemented a global date-scoped optimizer gate and
then reverted it because it also blocked mechanical-identity workouts (notably ordinary easy running)
for athletes whose current plan had no #804 mechanical requirement. Issue #859 should fix #804's
temporal scope without silently turning #804 into a universal rule for every runner.

No new physiological threshold is required. The existing no-consecutive-calendar-day rule remains a
conservative product heuristic; only its planning scope changes.

## 1. Current execution trace

### 1.1 Mechanical evidence is already separate and sufficiently wide

`resolveTrainingIntent` owns the #804/#857 mechanical evidence stream through
`resolveMechanicalExposureEvidence`.

When the evergreen context can emit a mechanical requirement, the engine can read a dedicated 28-day
mechanical establishment window without widening operational fatigue/objective history. The progression
evaluator itself still uses its own 14-day continuity window.

This is the correct separation and should not change for #859.

### 1.2 The shared progression verdict mixes horizon-wide and date-local decisions

`evaluateMechanicalStageProgression` currently evaluates, in one object:

- active `avoid_high_impact`, knee swelling and acute pain hard blocks;
- the previous-calendar-day mechanical exposure rule;
- current pain;
- illness;
- tissue response / follow-up sufficiency;
- >=14-day re-entry;
- response-gated stage progression/retention;
- the exact eligible mechanical workout set for the resolved stage.

The previous-calendar-day branch returns `status: 'withheld'`, `eligible: false`, and an empty
`eligibleWorkoutIds` array. Every other consumer therefore sees spacing as indistinguishable from a
true horizon-wide source suspension.

### 1.3 Evergreen resolves that verdict once

`resolveEvergreenPlan` calls `resolveEvergreenMechanicalProgression` once using the plan's start date.

The same resolved object is then used for two separate purposes:

- #804's exact mechanical workout allow-list passed to `buildEvergreenPlanDefinition`;
- #805 fulfilment state in `resolveCapabilityMaintenancePlan`.

If the plan starts one day after a mechanical exposure, both consumers inherit a week-wide false
negative.

### 1.4 Plan definition freezes the false negative into the weekly requirement

`buildEvergreenPlanDefinition` copies
`mechanicalProgression.eligible ? mechanicalProgression.eligibleWorkoutIds : []`
onto the `mechanical_exposure` requirement.

An empty `eligibleWorkoutIds` means fail closed for the requirement's planning window. This is correct
for a genuine source-policy block; it is wrong for a one-day spacing condition.

### 1.5 The forecast already has the right dynamic state seam

The important existing architecture is in `planner.ts`:

- `evaluateProjectedDate` builds a `CoverageState` for the exact date being evaluated;
- `generateWeekAheadPlan` maintains actual plus already-selected projected history;
- the weekly allocator's `AllocationDateEvaluator` evaluates tentative assignments through the same
  projected-date path;
- when testing a tentative assignment on date D, later evaluations receive that assignment in projected
  history in chronological order.

This means the engine already has enough state to express the desired rule correctly:

> if date D-1 contains an exact mechanical identity, reject mechanical candidates on D; otherwise do not
> reject them for adjacency.

No second allocator, separate forecast engine, or static weekly date mask is needed.

## 2. Why recomputing the full progression verdict per future date is the wrong default

The issue allows either “evaluate the progression verdict per projected date” or “keep the stage verdict
horizon-wide and apply spacing per date”. The second option better matches the current evidence model.

Future forecast dates do not have future observed tissue-response check-ins. Re-evaluating the entire
progression verdict for D+3/D+5 would force one of several undesirable semantics:

- pretend the planning-date check-in is valid on every future date;
- treat the absence of a future check-in as new missing evidence and change stage semantics;
- project tissue response that has not happened;
- create a second distinction between performed and projected stage evidence.

The engine already treats completed capability evidence as different from projected fulfilment under
ADR-0044 D9. #859 should preserve that boundary.

The stage/tissue verdict should therefore remain a planning-time capability statement. Only the
calendar adjacency constraint should move to the date evaluator.

## 3. Why a static not-before date is also insufficient

#805 already uses `candidateWorkoutNotBeforeDates` for capability cadence. That mechanism is not enough
for #859.

A static not-before date can express “yesterday was mechanical, so earliest is tomorrow”. It cannot
express a new adjacency created by the allocator itself:

1. Monday's performed mechanical exposure makes Tuesday ineligible.
2. The allocator tentatively places a mechanical occurrence on Thursday.
3. Friday must now become ineligible.
4. Saturday can be eligible again.

Because tentative assignments can create new spacing constraints during search, the rule must be
evaluated from **projected history at each date**, not precomputed once from the starting history.

ADR-0018's `AllocationDateEvaluator` is explicitly designed for this kind of stateful feasibility.

## 4. Post-mortem of the temporary PR #855 implementation

PR #855 briefly carried a technically useful prototype for #859 before the change was intentionally
removed from #805's scope.

The temporary sequence did the following:

- commit `33b690cc` removed spacing from `evaluateMechanicalStageProgression`;
- commit `d22a3682` added a date-scoped `mechanicalSpacingBlocked` flag to `CoverageState`;
- commit `ba0da6eb` added `CONSECUTIVE_MECHANICAL_DAYS` as an optimizer exclusion;
- commit `6932648d` aligned the prior-exposure identity test with `mechanicalIdentityFor`;
- commits `1a41689`, `3c5be819`, `59d3375c` and `5c9c70d3` added test, knowledge and architecture coverage.

Those commits were then explicitly reverted/removed by commits including `4fe43512`,
`a62902dc`, `29477347`, `743af995`, `795bb43e`, `220aa84e` and `80e3130a`.

### What the prototype got right

It found the correct dynamic seam:

- date-scoped state belongs downstream of the shared progression verdict;
- `CoverageState` is rebuilt per projected date;
- the optimizer is the shared candidate hard-gate path;
- projected assignments can affect later dates;
- a stable exclusion reason makes allocation diagnostics honest.

### What it got wrong

The prototype made the date-scoped gate effectively **global**:

`coverageState.mechanicalSpacingBlocked && mechanicalIdentityFor(candidateWorkoutId)`

did not require the plan to own an active #804 `mechanical_exposure` policy.

That matters because several catalog workouts are mechanical identities for credit/progression purposes
while also being ordinary sport training. `running_easy_continuous_01`, for example, is a Stage-2
mechanical identity with `planningUse: 'incidental_credit'`.

The active persona suite contains an established endurance-only case whose invariant requires preserving
ordinary easy-run volume. A universal adjacency gate changed that non-#804 athlete's recommendations.
PR #855 correctly treated that as a scope leak because #805 was default-off and was not allowed to
change unrelated recommendations.

For #859, the useful prototype should be recovered **with one additional ownership condition**:
date-scoped mechanical spacing is active only when #804's mechanical requirement is present in the
current plan.

## 5. Target semantic model

### 5.1 Horizon-wide source-policy state

These remain in `MechanicalProgressionVerdict` and continue to affect the full current planning horizon
until a new real decision/check-in is available:

| Condition | Current semantic | #859 target |
|---|---|---|
| `avoid_high_impact` | blocked | unchanged |
| knee swelling / acute pain guardrail | blocked | unchanged |
| current pain | blocked | unchanged |
| illness | withheld | unchanged |
| severe/adverse tissue response | withheld/regress | unchanged |
| missing follow-up evidence | hold advancement / fail closed | unchanged |
| >=14-day continuity gap | re-entry at Stage 1 | unchanged |
| stage retention/progression | response-gated | unchanged |

The issue explicitly requires these to remain horizon-wide unless separately revisited.

### 5.2 Date-scoped sequencing state

Only this rule moves:

| Condition | Current semantic | #859 target |
|---|---|---|
| exact mechanical identity on previous calendar date | whole verdict withheld | only current candidate date rejects mechanical identities |

The target remains a **calendar-day** rule, not a scientific assertion of a universal 48-hour recovery
interval.

### 5.3 Preserve existing identity semantics

#859 should not redefine what counts as a “mechanical exposure”.

The current progression path maps performed history through `mechanicalIdentityFor` before evaluating
spacing. The temporary PR #855 implementation initially used `grantsMechanicalExposureCredit`, then
corrected itself to `mechanicalIdentityFor`.

The implementation should preserve the current behavior: an exact catalog mechanical identity on D-1 is
the adjacency trigger. Do not silently make readiness-modified variants, contact count, generic
`impactTissue` cost, modality, category or free-text labels new spacing authorities in this issue.

Any change to those semantics deserves its own product-policy review.

## 6. Recommended implementation boundary

### 6.1 `mechanicalProgression.ts`: separate capability from adjacency

Remove the consecutive-calendar-day early return from `evaluateMechanicalStageProgression`.

Add a small pure helper owned by the same policy module, conceptually:

`hasAdjacentMechanicalExposure(targetDate, history): boolean`

The helper should:

- inspect only exposures before `targetDate`;
- resolve exact workout identity from `workoutId`, or from canonical template mapping when needed;
- return true only when an exact `mechanicalIdentityFor` exposure exists on D-1;
- use local-calendar date arithmetic (`addDaysToLocalDateString` / existing date helpers);
- not inspect tissue response or stage.

Keeping this helper with #804's progression policy prevents `coverage.ts` from inventing a second
definition of “mechanical identity”.

### 6.2 `coverage.ts`: derive a date-scoped policy fact only when #804 is active

Extend `CoverageState` with an explicit date-scoped spacing fact, for example
`mechanicalSpacingBlocked`.

`buildCoverageState` should compute it from its date-specific actual/projected history **only when the
resolved plan contains the `mechanical_exposure` requirement**.

This is the key scope guard missing from the reverted #855 prototype.

The boolean is not coverage credit and must not depend on whether yesterday's exposure earned
`mechanical_exposure` role credit. It is a sequencing fact derived from exact mechanical identity.

### 6.3 `optimizer.ts`: hard-exclude exact mechanical candidates on that date

When `coverageState.mechanicalSpacingBlocked` is true, reject candidates whose exact mapped workout has
a `mechanicalIdentityFor` entry with stable reason `CONSECUTIVE_MECHANICAL_DAYS`.

Do not infer from:

- `Running` or `Field` modality;
- `impactTissue` cost;
- category;
- title;
- stimulus profile.

The gate is exact-identity based.

Because the state bit is produced only for plans with #804's requirement, endurance-only plans without
#804 remain unchanged.

### 6.4 `weeklyAllocation.ts`: classify the new exclusion as feasibility

Add `CONSECUTIVE_MECHANICAL_DAYS` to the allocator's safety/recovery exclusion set.

Usually the allocator should simply move the mechanical occurrence to the next feasible non-adjacent
date. If every remaining date is blocked or otherwise infeasible, the miss should be reported as a typed
hard safety/recovery miss rather than `no_conflict_free_date`.

### 6.5 #805: consume the horizon-wide verdict, let allocation handle adjacency

`evaluateCapabilityMaintenance` currently treats any ineligible `mechanicalVerdict` as a deliberate
source suspension. That remains correct for illness, pain/guardrail and severe tissue-state withholding.

After spacing leaves the shared verdict, a capability that is due on a planning date immediately after a
mechanical exposure can remain `plannable` when a later due-window date has capacity. Its placement is
then subjected to the per-date adjacency gate by the shared allocator/ranker.

This is the intended fix for the #805 symptom: “yesterday was mechanical” is no longer
`deliberately_suspended/mechanical_withheld` for the entire week.

## 7. Test matrix

The implementation needs tests at each ownership boundary, not one end-to-end assertion.

### Progression evaluator

- yesterday mechanical + otherwise healthy evidence: verdict remains eligible at the held stage;
- illness still withholds;
- current pain / active mechanical guardrail still blocks;
- severe adverse tissue response still withholds/regresses;
- >=14-day gap still returns Stage 1;
- missing follow-up still blocks advancement without creating a spacing decision.

### Date-scoped spacing helper / coverage state

- #804 requirement present + D-1 exact mechanical identity => spacing blocked;
- same history evaluated for D+1 (two-day gap) => not blocked;
- no #804 requirement + D-1 easy run mechanical identity => not blocked by #804 spacing;
- non-mechanical workout on D-1 => not blocked;
- template-only projected history resolves through canonical workout identity;
- a tentative allocator mechanical assignment on D creates the block on D+1.

### Optimizer / allocation

- exact mechanical candidate receives `CONSECUTIVE_MECHANICAL_DAYS` only under scoped block;
- non-mechanical candidates remain admissible;
- allocator skips adjacent date and reserves the same required occurrence later when feasible;
- if no later feasible date exists, the observed blocker classifies as hard safety/recovery;
- two mechanical required/support occurrences cannot become adjacent through tentative assignment ordering.

### #805 integration

- due capability + mechanical exposure yesterday + later capacity => `plannable`, placement later in horizon;
- true #804 illness/severe-tissue/source suspension => still `deliberately_suspended`;
- active clinical block => still clinical/guardrail state;
- no #804 requirement => #805 keeps its current unknown/absent semantics rather than acquiring a new global gate.

### Persona/simulation regression

The established endurance-history persona that exposed the PR #855 scope leak must remain unchanged in
its easy-run invariant when it does not carry #804 mechanical policy.

The cycling-primary/broad-athleticism and #805 deterministic cycle tests should additionally prove the
positive behavior: a mechanical touch on D-1 blocks D0, not D1–D6, and a newly projected touch blocks
only its own following date.

## 8. Knowledge and policy implications

This is a recommendation-behavior change and is explicitly covered by ADR-0033 / ADR-0044 D10.

Implementation must:

1. revise `policy.evergreen.mechanical_exposure_v1` from its current v3 wording to state that:
   - stage/tissue/source-policy eligibility is shared over the planning horizon;
   - no-consecutive-calendar-day spacing is a date-scoped candidate constraint;
   - it is active only under #804's mechanical-exposure policy;
   - actual and projected exact mechanical history can create the adjacent-date block;
   - the exact calendar threshold remains product policy, not an evidence-derived biological cliff;
2. increment the claim version (expected next semantic revision: v4) and review date;
3. update `mechanicalExposurePolicyAlignment.test.ts` to pin the new ownership/scoping language and
   remove the #859 known-limitation assertion;
4. update `docs/architecture/recommendation-engine.md`;
5. bump `POLICY_VERSION` from whatever value is current when the implementation PR starts, preserving
   that predecessor in the policy history.

The research classification should **not** change. The repository's cited bone/tendon sources support
progressive mechanical loading but do not validate a universal 48-hour rule:

- Robling & Turner, 2009, *Mechanical signaling for bone modeling and remodeling*:
  https://pubmed.ncbi.nlm.nih.gov/19817708/
- Bohm, Mersmann & Arampatzis, 2015, tendon-loading systematic review/meta-analysis:
  https://pubmed.ncbi.nlm.nih.gov/27747846/

The broader minimum-dose review by Spiering et al. also emphasizes that athlete-specific maintenance
minimums are insufficiently established:
https://pubmed.ncbi.nlm.nih.gov/33629972/

So #859 is an architecture correction to an existing heuristic, not an evidence-driven threshold change.

## 9. Architecture compliance

The recommended design fits the existing accepted architecture:

- **ADR-0018:** tentative assignments are replayed through one production projected-date feasibility path;
  dynamic spacing belongs there rather than in a static weekly mask.
- **ADR-0033:** recommendation-changing heuristic scope stays registered and alignment-tested.
- **ADR-0044 D9:** performed evidence and projected fulfilment remain distinct; a projected mechanical
  occurrence affects future feasibility but does not become performed tissue-response evidence.
- **ADR-0044 D10:** policy constant/selection behavior changes require lineage and `POLICY_VERSION`.
- **No new ADR is required** if implementation follows this scope. A new ADR would be warranted only if
  the project decides to make mechanical adjacency global outside #804, change what counts as a
  mechanical exposure, or change the calendar threshold itself.

## 10. Risks and controls

| Risk | Control |
|---|---|
| Repeating the PR #855 scope leak | Compute/enforce spacing only when the active plan contains #804's `mechanical_exposure` requirement; pin endurance-only persona behavior. |
| Static dates fail after a tentative future placement | Derive from `evaluateProjectedDate` history on every date/assignment state; do not encode as one initial not-before date. |
| Future projections accidentally advance/regress stage from nonexistent check-ins | Keep `MechanicalProgressionVerdict` horizon-wide; move only adjacency. |
| Projected sessions become “performed” tissue evidence | Use them only for date feasibility; do not feed them into response-gated stage advancement. |
| Candidate gate broadens from exact identity to modality/category | Use `mechanicalIdentityFor` on canonical workout identity only. |
| #805 reports false deliberate suspension | Remove adjacency from shared verdict; add integration test for later-window placement. |
| Other real withholds become date-local by accident | Unit-test illness, pain/guardrail and severe tissue cases explicitly. |
| Policy drift CI fails | Update claim/alignment + `POLICY_VERSION` in the same implementation PR. |

## 11. Out of scope

Issue #859 should not:

- change the no-consecutive-calendar-day threshold;
- introduce a universal 48-hour physiological claim;
- change the 14-day #804 continuity/re-entry window;
- change #805's 14-day/max-gap capability cadence;
- fix #858's simulation duration-fidelity limitation;
- alter event-directed field-maintenance policy;
- forecast future tissue-response check-ins;
- change mechanical workout identity, stage mapping or variant-credit rules;
- turn generic running/impact cost into #804 spacing authority;
- add a new persistence schema.

## 12. Decision

Proceed with the **split-scope design**:

> #804 stage/tissue/source-policy eligibility remains horizon-wide; consecutive-calendar-day
> mechanical spacing becomes a dynamic date-scoped hard candidate gate derived from actual/projected
> exact mechanical identity, and that gate exists only while #804's `mechanical_exposure` requirement
> is active.

This addresses the issue's intended behavior, preserves the existing safety fail-closed rules, reuses the
canonical projected-date feasibility path, and avoids the non-#804 recommendation regression that caused
the first #859 prototype to be removed from PR #855.
