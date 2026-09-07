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

Nothing in the engine enforces it. No rule, requirement or gate places a recovery day. The
invariant held because projected fatigue accumulated fast enough that the readiness tier
eventually reached `recover` and rest was the only admissible candidate.

PR #453 corrects a state-fidelity defect: the week-ahead ledger charged the full authored
template even when a reduced `activeDose` was the dose actually prescribed. Charging the
prescribed dose instead lowers projected load, and in
`reduced_time_equipment_limited_borderline` the emergent rest day disappears:

```text
merge-base eddacc09:  08-10 recover Rest        08-12 recover Rest    -> 2 rest days
PR #453 head:         08-10 train   walk 30m    08-12 modify str 25m  -> 0 rest days
```

Two `recover`-tier days became `train`-tier. This is not a defect in PR #453 — every
dose-materialization site charges exactly once, and the reduced sessions really are
reduced. The finding is the other way around: **the weekly recovery day was being produced
by an inflated fatigue projection, and correcting the projection removes it.** Any future
fatigue-model correction in the same direction will remove it again.

### Existing machinery, and why it does not cover this

`recovery_or_rest` is already an authored coverage key. It is declared
`requirement: 'required'` in both the event and general coverage sets, and
`buildCoverageState` synthesizes it as a `must_have` requirement with `minimumSessions: 1`
even when the active block's objectives do not mention it
([`coverage.ts:401`](../../app/src/engine/coverage.ts)).

Two deliberate limits keep it from ever placing a day:

1. `deriveRequiredRoleOccurrences` filters it out, so the weekly allocator never reserves a
   date for it ([`weeklyAllocation.ts:140`](../../app/src/engine/weeklyAllocation.ts)) —
   this filter implements an explicit ADR-0018 decision, not an incidental omission;
2. `coverageNeedTierForTemplate` classifies it as deferred support, so an unmet recovery
   minimum ranks at tier 2 and loses to any tier 0/1 candidate
   ([`coverage.ts:519`](../../app/src/engine/coverage.ts)).

Both limits are individually reasonable — recovery should not pre-empt an authored hard
role's preferred date. But there is a third, decisive limit:

```ts
// coverage.ts:357
if (!planDefinition || !block || !descriptor) {
    return { asOfDate, phase: null, activeBlockId: null, coverageSetId: null, descriptor: null, requirements: [] };
}
```

**With no plan definition the coverage state is empty and none of this machinery exists at
all.** The failing scenario is exactly that case; its allocation report is
`outcomes: []`. For an athlete without a plan — the evergreen default — recovery placement
has no representation whatsoever. Promoting `recovery_or_rest` inside the coverage system
would not reach them.

### Relationship to ADR-0035

ADR-0035 governs *authored* rest: a plan author's deliberate instruction to keep a date
free, imported through `external-plan@3` `restDays`. That is plan intent, and ADR-0035 is
careful to keep it separate from physiological state.

This ADR governs the complementary case: **no author supplied one.** The two must not be
conflated. An authored rest directive should satisfy this requirement; this requirement
must never fabricate an authored directive, and must never claim plan provenance it does
not have.

### A second recovery mechanism, and what PR #453 does to it

Coverage is not the only place recovery is modelled. `optimizer.recovery_streak_heuristics`
is an existing, registered and alignment-tested policy
(`policy.optimizer.recovery_streak_heuristics_v1`): across the contiguous prior
non-recovery run, days with `systemicCost >= 0.40` accumulate a streak, and at a count of
three or more with no unresolved objectives, Rest/Mobility receives a 2.0x multiplier while
easy aerobic is suppressed to 0.3x.

Its input is the projected history's `systemicCost`, which PR #453 now writes dose-scaled
rather than authored. That silently moves templates across the 0.40 boundary:

```text
str_full_03   authored 0.45  ->  scaled 0.315   (counted toward the streak; now does not)
end_mod_01    authored 0.70  ->  scaled 0.525   (unaffected)
end_easy_01   authored 0.30  ->  scaled 0.180   (never counted either way)
```

This is a change to the input of an alignment-tested policy claim, made without reviewing
that claim. It is **not** the cause of the failing borderline scenario — that scenario's
rest days came from `recover`-tier readiness driven by dimensional fatigue accumulation,
and its selected templates sit below 0.40 at either dose. But it is a real, separate
instance of the same underlying problem, and it means recovery placement is currently
spread across two mechanisms with no single owner.

Whether the streak should count authored or effective `systemicCost` is a question this
ADR raises but does not settle. It should be answered when
`policy.optimizer.recovery_streak_heuristics_v1` is next reviewed.

### Why this needs a decision, not a resolver fix

Introducing a recovery requirement that applies without a plan definition grants a new
planning authority: a requirement that can outrank discretionary work for every athlete,
including those the coverage system does not currently model at all. ADR-0016 and ADR-0018
established that role and coverage authority is explicit and versioned rather than added
silently to the ranking path. The same precedent applies here.

### Evidence scope and knowledge lineage

This is a repository contract decision. It fixes the mismatch between an invariant the
repository asserts and a guarantee the engine does not provide.

The ADR-0033 sports knowledge registry constrains how the eventual minimum may be
justified, and the constraint is largely negative. The registry's on-point claim is
`recovery.training.stress_recovery_balance` (Kellmann et al. recovery consensus): training
stress should be balanced with adequate recovery, and *recovery requirements vary
materially both between athletes and within the same athlete across contexts*. Its recorded
limitation is explicit — the consensus "supports monitoring and individualization, not a
universal fixed 24-, 48- or 72-hour spacing rule."

So a fixed weekly recovery cadence **cannot** be registered as a scientific claim. The
registry's own lineage rules forbid it.

The registry does, however, have an established pattern for exactly this situation: pair
the scientific boundary claim with a separate product-policy claim carrying
`claimType: 'heuristic'`, `evidenceCertainty: 'not_applicable'`, the
`PRODUCT-EVERGREEN-DOSE-V1` source, and an explicit limitation disclaiming physiological
optimality. Two precedents already do this for weekly counts:

- `health.adults.strength.default_upper_target` — three strength sessions per week as a
  bounded default upper target, deliberately separated from the WHO `>=2 days` claim;
- `performance.high_intensity.conditional_weekly_prior` — one high-intensity session as a
  target and no more than two, withheld when recent training evidence is insufficient.

A weekly recovery minimum belongs in that category, not in the scientific one. This is a
constraint on the form of the answer, and it is available now — it does not need to wait
for new evidence review.

`knowledgeCoverage.ts` inventories every decision-authority rule with its classification,
coverage state and research priority. **It contains no item for weekly recovery
placement.** Recovery appears only as `optimizer.recovery_streak_heuristics`,
`readiness.post_recover_buffer` and the spacing gates — all reactive to accumulated load,
none placing a recovery day as a requirement. The absence is itself evidence for this
ADR's premise: the guarantee was never modelled as a rule, so nothing in the inventory
owns it.

## Options considered

### Option A — Re-baseline the four failing expectations

Update `scenarios.test.ts` and `specificityCoverageContract.test.ts` to match the new plans
and merge PR #453 as-is.

**Rejected.** This converts a coaching contract into a description of current behavior. The
regression is user-visible — a real athlete receives a week with no recovery day — while
the bug PR #453 fixes is internal. Re-baselining also destroys the signal: the next time a
fatigue correction removes recovery, no test will notice.

### Option B — Keep charging the full authored dose

Revert the ledger portion of PR #453 and let the projection continue charging the authored
template regardless of prescribed dose.

**Rejected.** This reinstates the incoherence PR #453 exists to remove: the visible plan and
the hidden state used to sequence later days disagree. It also keeps the recovery guarantee
resting on a known-wrong number, which is a guarantee only by accident.

Restricting the ledger scaling to genuine time-cap reductions (excluding the modify-tier
auto-reduction) was tested as a narrower form of this option. It fixed one failing
assertion and broke a different one, leaving the count unchanged — the reduction is
dominated by real time-cap reductions, not by the modify-tier path. It is not a viable
middle ground.

### Option C — Promote `recovery_or_rest` to a required role occurrence

Remove the `weeklyAllocation.ts:140` filter so the allocator reserves a date for recovery
like any other required role.

**Rejected.** Three reasons, in increasing order of decisiveness. It has no effect without
a plan definition, which is the failing case. It risks the outcome the filter was added to
prevent: recovery competing for an authored hard role's nominated date. And ADR-0018
already decided the point — "`recovery_or_rest` remains satisfied by the existing coverage
ledger and recovery policy; it does not reserve a discretionary training date." Adopting
Option C would require overturning an accepted ADR, which this one does not propose to do.

### Option D — A plan-independent recovery requirement with deadline escalation

Represent recovery placement as a first-class requirement that exists whether or not a plan
definition does, ranked conservatively until its window is about to close.

## Decision

Adopt **Option D**.

### Requirement model

- A baseline recovery requirement is seeded for every athlete, independent of
  `PlanDefinition`.
- Deduplication is against an **active authored `recovery_or_rest` requirement**, not
  against the presence of a `PlanDefinition`. `buildCoverageState` also returns an empty
  state when a plan definition exists but the date falls outside any block, or the
  descriptor cannot be resolved. Keying on plan presence would suppress the baseline
  requirement in exactly those cases while no authored requirement exists to replace it.
  Where an active authored requirement is present it remains the authority and the
  baseline is not seeded.
- The requirement uses the existing `WeeklyCoverageRequirement` shape — a rolling
  seven-day window and a minimum session count — so it participates in the ranking path
  already built rather than introducing a parallel one.
- Satisfying exposures are the ones that already carry the `recovery_or_rest` coverage key.
  A same-day athlete override that replaces rest with training does not satisfy it.

### How an ADR-0035-authored rest day satisfies it

ADR-0016 permits coverage only through explicit authored identity, and ADR-0035 defines
`restDays` as a plan-level directive that is deliberately *not* a session occurrence. The
two need an explicit bridge, or the engine can place generated recovery on a date the plan
already closed to training.

The directive **materializes a `recovery_or_rest` coverage exposure** on its resolved
plan-local date; it is not counted by a second, parallel path. That keeps ADR-0016's
authored-identity rule intact, gives the exposure the same shape as any other coverage
credit, and makes the requirement satisfied by construction on an authored rest date rather
than by a special case in the ranking path.

Two consequences follow, and both are intended:

- an authored rest date cannot also attract generated recovery, because the requirement is
  already met;
- an ADR-0035 override (`athleteOverridesAuthoredRest`) removes the materialized exposure
  along with the rest, so the requirement becomes unmet again and normal placement resumes.

The materialized exposure must carry the directive's provenance, so audit can distinguish
authored rest from engine-placed recovery. It must not be attributed to a template or
workout the plan did not author.

### Allocation, viability and miss reporting

ADR-0018 already rules on this and this ADR does **not** overturn it:

> `recovery_or_rest` remains satisfied by the existing coverage ledger and recovery policy;
> it does not reserve a discretionary training date.

So the baseline requirement is **not** promoted to a `RequiredRoleOccurrence` and takes no
allocator reservation. The `deriveRequiredRoleOccurrences` filter stays. Escalation is a
change to ranking order only.

D-SUPPORT already covers the resulting selection, and the escalated recovery is subordinate
to it:

> On a train/modify-tier unreserved date, a discretionary Rest selection consumes the date
> and therefore receives the same stateful viability proof as any supporting selection. It
> is rejected when it would remove the last proven required-role allocation.

An escalated tier-1 recovery candidate on a train- or modify-tier date is therefore still
subject to that proof and may be rejected by it. In a true recover tier, ADR-0018's
Rest-first rule already outranks the proof and nothing here changes that.

Because recovery takes no reservation, D-MISS does not report it: an unmet recovery
requirement produces no `WeeklyRoleAllocationReport` outcome. That is consistent, but it
means an unfulfilled recovery requirement is currently invisible. This ADR requires a
separate diagnostic for it (see Observability) rather than forcing recovery into the
reservation model to inherit D-MISS.

**Required acceptance test:** a plan-less scenario in which supporting work would otherwise
consume the only remaining recovery opportunity, proving that escalation occurs before the
window closes and that D-SUPPORT still governs the selection.

### Ranking authority

- An unmet recovery minimum ranks at deferred-support tier 2 while the window has slack,
  exactly as today. Recovery does not compete with hard roles by default.
- When the days remaining in the window are no more than the still-unmet minimum, the
  requirement escalates to **tier 1**. This mirrors the existing overdue-hard-role repair
  pattern in `coverageNeedTierForTemplate`.
- It never escalates to tier 0. Within the ADR-0016 coverage-need ordering that
  `coverageNeedTierForTemplate` implements, tier 0 is reserved for a candidate matching the
  role nominated for that date, so recovery must not be able to displace a nominated anchor
  through the coverage tier.

  This is a statement about the coverage-need ordering, not about ADR-0011. ADR-0011's
  "anchors nudge; they do not command" is scoped to its own three post-gate modifiers —
  the ×1.35 role boost, the ×0.3 adjacency suppression and the variety tie-break — which
  are multipliers and tie-breaks applied after hard gates. The coverage-need tier is a
  separate, later mechanism introduced by ADR-0016/ADR-0018 and is a lexicographic sort
  key, not a multiplier. Both statements are true of their own mechanism, and nothing here
  changes either. The `coverage.ts` comment describing tier 0 as "date-level programming
  authority" is loose wording for a ranking key and would be better re-scoped when that
  function is next touched.
- Every hard safety, clinical, availability, equipment and readiness gate continues to run
  before this ordering participates, unchanged.

### Separation from readiness

This requirement places a recovery day; it does not assert that the athlete is in
`recover` mode. `evaluateReadinessAndSafetyEnvelope` continues to compute
`train` / `modify` / `recover` from readiness and safety inputs alone, and its verdict
remains observable and auditable unchanged. A well-recovered athlete may hold a `train`
verdict on a day this requirement places recovery, exactly as ADR-0035 allows for authored
rest. Keeping both facts is more truthful and keeps replay interpretable.

### Observability

The requirement and its escalation must be visible before they are trusted:

- the decision trace records the recovery requirement's state and whether escalation
  applied on the evaluated date;
- an unmet recovery requirement is reported explicitly. Because recovery takes no allocator
  reservation it is invisible to D-MISS, so it needs its own diagnostic rather than a
  silent absence — including whether the window closed unfulfilled, and whether D-SUPPORT
  rejected an escalated recovery candidate;
- the simulation harness reports recovery placement as a metric, not only as a pass/fail
  invariant, so a future change that erodes it is measurable rather than binary;
- `restOrRecoveryDayCount > 0` remains asserted, but becomes a consequence of an enforced
  requirement rather than an emergent property of fatigue arithmetic.

## Consequences

### Positive

- The repository stops asserting a guarantee it does not implement.
- PR #453's state-fidelity correction can land without trading an internal bug for a
  user-visible regression.
- Recovery placement becomes measurable, so future fatigue-model work can be evaluated
  against it instead of silently eroding it.
- Plan-less athletes gain recovery representation they currently have none of.

### Negative

- Plans change for every athlete without a plan definition. This is the intended effect,
  but it is a behavior change with no opt-out and needs simulation review before merge.
- Some scenario baselines will legitimately move. Those must be reviewed individually
  rather than re-baselined in bulk, or this ADR reproduces Option A by a longer route.
- A new requirement in the ranking path is a new way for candidate selection to be
  surprising. The observability requirements above are not optional.

### Neutral

- The three other assertions failing on PR #453 — `cycling_gran_fondo_A`'s
  `race_specific_endurance` resolution, `evergreen_health_two_sessions`'s train-tier rest
  warning, and the specificity coverage contract's `sustained_quality` placement — are
  **not** addressed here. They must be re-examined after this change lands, since
  deliberate recovery placement may resolve some of them and will certainly change all of
  them.

## Open questions

1. **What is the minimum?** The *form* of the answer is settled by the knowledge lineage
   above: a product-policy heuristic claim, not a scientific one, following
   `health.adults.strength.default_upper_target`. The value is not settled. One recovery
   exposure per rolling seven days is the smallest defensible starting point and matches
   the requirement `buildCoverageState` already synthesizes; whether it should be
   phase-dependent (a taper or recovery block plausibly wants more than a build block) is
   open, and `recovery.training.stress_recovery_balance` argues for individualization
   without supplying a number.
2. **Does `Mobility/Recovery` satisfy it, or only full `Rest`?** The registry already takes
   a position worth inheriting rather than relitigating: the streak in
   `buildHistoryFeatureSummary` is broken by either category, and
   `policy.optimizer.recovery_streak_heuristics_v1`'s mixed-recovery rule deliberately
   *alternates* between them at 1.40x. Existing policy therefore treats both as recovery,
   with an alternation preference. The counter-signal is
   `evergreen_health_two_sessions`, where a `mob_01` day is flagged as rest-on-a-train-tier
   day — but that is a warning about placing recovery on a day the athlete was ready to
   train, which is a placement question, not evidence that mobility is not recovery.
   Proposed resolution: both satisfy it; revisit only if placement quality suffers.
3. **Should the streak count authored or effective `systemicCost`?** Raised by PR #453's
   change to the projected-history value (see above). Owned by
   `policy.optimizer.recovery_streak_heuristics_v1`, not by this ADR, but it should not be
   left unreviewed.
4. **Interaction with ADR-0036 intraday windows.** A day with two windows is not obviously
   a recovery day because one window is empty. This needs settling before ADR-0036 is
   implemented.
5. **Should the escalation be date-aware rather than count-aware?** Escalating on the last
   available day places recovery at the end of the window, which is not necessarily where
   it belongs. A phase-aware placement preference is the follow-up in the optimization
   analysis's "first-class phase-specific sequence intent" item.

## Implementation notes

This ADR is a decision, not an implementation plan. When implemented:

- `buildCoverageState`'s early returns are the seam to change, not the ranking function —
  the requirement must exist before it can be ranked. Note there are several early returns,
  not one: a missing plan definition, a date outside every block, and an unresolvable
  descriptor all produce an empty state, and the baseline requirement must survive all of
  them.
- The `weeklyAllocation.ts:140` filter stays. It implements ADR-0018's decision that
  `recovery_or_rest` does not reserve a discretionary training date, and this ADR places
  recovery through ranking escalation instead.
- No change to `materializeEffectiveDose`, the fatigue half-lives, or cost weights is
  implied or authorized by this ADR.

Per ADR-0033, the implementation is not complete without knowledge lineage. It must add:

- a product-policy claim (`policy.load_recovery.weekly_recovery_placement_v1`) stating the
  exact minimum and escalation rule, sourced to `PRODUCT-EVERGREEN-DOSE-V1`, with a
  limitation disclaiming physiological optimality and referencing
  `recovery.training.stress_recovery_balance` as its scientific boundary;
- a `knowledgeCoverage.ts` inventory item in the `readiness_recovery` or `session_spacing`
  domain, classified `product_heuristic`, with `codeRefs` naming the requirement seam and
  the ranking function;
- a policy-alignment test asserting the registered claim matches the implemented constants,
  matching the pattern in `loadIntensityRecoveryPolicyAlignment.test.ts` and
  `optimizerScoringPolicyAlignment.test.ts`.
