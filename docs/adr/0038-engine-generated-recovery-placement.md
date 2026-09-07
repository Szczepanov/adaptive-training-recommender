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
   date for it ([`weeklyAllocation.ts:140`](../../app/src/engine/weeklyAllocation.ts));
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

### Why this needs a decision, not a resolver fix

Introducing a recovery requirement that applies without a plan definition grants a new
planning authority: a requirement that can outrank discretionary work for every athlete,
including those the coverage system does not currently model at all. ADR-0016 and ADR-0018
established that role and coverage authority is explicit and versioned rather than added
silently to the ranking path. The same precedent applies here.

### Evidence scope

This is a repository contract decision. It fixes the mismatch between an invariant the
repository asserts and a guarantee the engine does not provide. It deliberately does **not**
settle how often an athlete should rest; the specific minimum is left as an open question
below, to be answered against the knowledge registry (ADR-0033) rather than inside this
ADR.

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

**Rejected as insufficient alone.** It has no effect without a plan definition, which is
the failing case. It also risks the outcome the filter was added to prevent: recovery
competing for an authored hard role's nominated date. Retained as a *component* of the
decision below, not as the decision.

### Option D — A plan-independent recovery requirement with deadline escalation

Represent recovery placement as a first-class requirement that exists whether or not a plan
definition does, ranked conservatively until its window is about to close.

## Decision

Adopt **Option D**.

### Requirement model

- A baseline recovery requirement is seeded for every athlete, independent of
  `PlanDefinition`. Where a plan definition exists, the authored `recovery_or_rest`
  requirement continues to be the authority and is not duplicated.
- The requirement uses the existing `WeeklyCoverageRequirement` shape — a rolling
  seven-day window and a minimum session count — so it participates in the ranking path
  already built rather than introducing a parallel one.
- Satisfying exposures are the ones that already carry the `recovery_or_rest` coverage key.
  An ADR-0035 authored rest day satisfies it. A same-day athlete override that replaces
  rest with training does not.

### Ranking authority

- An unmet recovery minimum ranks at deferred-support tier 2 while the window has slack,
  exactly as today. Recovery does not compete with hard roles by default.
- When the days remaining in the window are no more than the still-unmet minimum, the
  requirement escalates to **tier 1**. This mirrors the existing overdue-hard-role repair
  pattern in `coverageNeedTierForTemplate`.
- It never escalates to tier 0. Tier 0 is date-level programming authority reserved for a
  nominated anchor, and recovery must not be able to steal an authored anchor date.
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

1. **What is the minimum?** One recovery exposure per rolling seven days is the smallest
   defensible starting point and matches the existing synthesized requirement, but the
   correct value is likely phase-dependent (a taper or recovery block wants more than a
   build block). This should be answered against the knowledge registry (ADR-0033), not
   hard-coded here.
2. **Does `Mobility/Recovery` satisfy it, or only full `Rest`?** The `recovery_or_rest`
   coverage key currently admits both. `evergreen_health_two_sessions` already shows a
   `mob_01` day being flagged as rest-on-a-train-tier-day, which suggests the two are not
   interchangeable for this purpose.
3. **Interaction with ADR-0036 intraday windows.** A day with two windows is not obviously
   a recovery day because one window is empty. This needs settling before ADR-0036 is
   implemented.
4. **Should the escalation be date-aware rather than count-aware?** Escalating on the last
   available day places recovery at the end of the window, which is not necessarily where
   it belongs. A phase-aware placement preference is the follow-up in the optimization
   analysis's "first-class phase-specific sequence intent" item.

## Implementation notes

This ADR is a decision, not an implementation plan. When implemented:

- `buildCoverageState`'s early return for a missing plan definition is the seam to change,
  not the ranking function — the requirement must exist before it can be ranked.
- The `weeklyAllocation.ts:140` filter should be revisited at the same time (Option C as a
  component): with deadline escalation in the ranking path, an allocator reservation for
  recovery may be unnecessary, and adding both at once risks double-placement.
- No change to `materializeEffectiveDose`, the fatigue half-lives, or cost weights is
  implied or authorized by this ADR.
