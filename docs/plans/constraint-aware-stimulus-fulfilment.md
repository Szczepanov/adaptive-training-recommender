# Constraint-aware stimulus fulfilment — implementation plan

| Field | Value |
|---|---|
| Status | Draft |
| Date | 2026-09-26 |
| Architecture decision | [ADR-0044 (Proposed)](../adr/0044-constraint-aware-requirement-fulfilment.md) |
| Analysis | [2026-09-26 constraint-aware fulfilment](../analysis/2026-09-26-constraint-aware-training-fulfilment.md) |
| Blocked by | ADR-0044 acceptance; canonical decisions in #801–#806 as noted per work package |
| Unlocks | automatic generated doubles/microdoses; honest multi-stimulus constrained planning; richer #813 exposure readout |
| Policy impact | Yes for every live selection/allocation work package |
| Knowledge impact | Yes; ADR-0033 lineage required for all new constants/thresholds |

## 1. Goal

Make weekly planning preserve the intended training portfolio under real constraints without
either:

- creating one standalone session per requirement; or
- claiming that a convenient substitute fully satisfies a requirement it does not actually
  deliver.

The implementation should prefer the **smallest valid portfolio of sessions/modules** that
covers the largest residual required stimulus/capability set inside safety, schedule, load,
spacing and event constraints.

## 2. Scope boundary

This plan does not implement every #801–#806 policy itself. It creates the shared fulfilment
layer that consumes those canonical models.

Do not duplicate:

- performed-training truth;
- injury/readiness policy;
- rolling-load policy;
- exact role coverage;
- intraday accounting;
- capability-specific dose/cadence rules.

## 3. Work packages

### CF0 — Requirement-class contract and diagnostics

**Blocked by:** ADR-0044 acceptance
**Can start independently:** Yes after acceptance

Add a typed requirement-view contract, conceptually:

```ts
type RequirementClass =
  | 'exact_role'
  | 'fractional_stimulus'
  | 'accumulated_dose'
  | 'capability_exposure';

type RequirementStatus =
  | 'satisfied'
  | 'partial'
  | 'unmet'
  | 'blocked'
  | 'deliberately_suspended'
  | 'unknown';

interface RequirementResidual {
  id: string;
  class: RequirementClass;
  target: number;
  completed: number;
  projected: number;
  residual: number;
  priority: 'must_have' | 'should_have' | 'nice_to_have';
  status: RequirementStatus;
  reason?: string;
  sourceAuthority: string;
}
```

Requirements:

- pure derivation from existing canonical owners;
- no new physiological constants;
- exact coverage and stimulus credit remain source-specific;
- `completed` is derived only from canonical performed-training authorities;
- `projected` may reduce a forecast residual but never confirms performed capability;
- diagnostics identify the source authority for each residual;
- no persistence/schema change in CF0 unless replay requires it.

Tests:

- exact role + fractional stimulus can coexist without one satisfying the other;
- over-delivery is capped in residual view;
- unknown source remains unknown;
- blocked/suspended is not converted into zero-target "satisfied."

### CF1 — Residual stimulus value in weekly allocation

**Blocked by:** CF0
**Depends on:** existing `stimulus.ts` and ADR-0018

Extend allocation diagnostics/search scoring so a candidate's value is based on **remaining
required credit**, not gross stimulus.

Rules:

- compute objective/capability credit only through canonical authorities;
- ADR-0014 `deriveObjectiveCredit*` remains the sole objective-credit formula;
- ADR-0033 evidence certainty is provenance, not a numeric credit multiplier;
- cap marginal value at residual requirement;
- exact must-have role remains ahead of optional fractional surplus;
- no new scalar physiological "value";
- existing utility remains a later tie-breaker.

Suggested helper:

```ts
deriveMarginalRequirementContribution(
  residualRequirements,
  canonicalContributions
): RequirementContribution[]
```

Acceptance:

- a multi-stimulus workout does not earn extra value for an already-complete objective;
- a threshold ride with authored aerobic stimulus gets partial aerobic objective value;
- the same ride does not clear an unmet long-anchor exact role;
- result is deterministic/replayable.

### CF2 — Training-module / microdose catalog contract

**Blocked by:** ADR-0044; preferably #802/#803 canonical metadata decisions
**Can partially start:** schema/validator spike only

Add a structured module contract rather than creating many new monolithic workouts.

Required fields:

- stable id/version/status;
- bounded duration;
- equipment/environment;
- safety/contraindication tags;
- stimulus/cost profile;
- movement/capability composition when available;
- eligible delivery modes: standalone / embedded / second window;
- intent: development / maintenance / microdose;
- stable materialized identity so the active coverage descriptor can decide exact role credit;
  the module itself grants no role.

Initial modules should be minimal and evidence-aligned, for example:

- compact strength-maintenance module;
- upper-body/trunk maintenance module;
- power primer/maintenance module once #802 lands;
- small movement-family modules once #803 lands.

Do **not** add a generic "10 minute strength counts as strength" rule.

Tests:

- module schema validation;
- unavailable equipment rejects module;
- contraindication rejects module;
- module stimulus/cost survives prescription materialization;
- default module earns no exact primary-role coverage;
- embedded module does not create a second full-session count.

### CF3 — BUILD / MAINTAIN / MICRODOSE delivery state

**Blocked by:** CF0 + policy claim for each affected family

Introduce an explicit delivery state for requirements. It should answer:

> is the current block trying to develop this quality, maintain it, or merely avoid a long
> absence?

The current block/intent remains the owner of priority; the fulfilment layer only applies the
approved downgrade path when capacity is insufficient.

Rules:

- BUILD -> MAINTAIN/MICRODOSE allowed only if policy says so;
- downgrade reason is recorded;
- no automatic upgrade from favorable readiness;
- taper/recovery may intentionally suspend;
- no "catch-up debt" from intentionally suspended taper work.

### CF4 — Automatic intraday secondary packing

**Blocked by:** CF0–CF3 and live canonical modules
**Consumes:** ADR-0036 only; does not alter it

Add a bounded second-window search for generated work.

Algorithm sketch:

1. begin from the already-resolved weekly primary allocation;
2. identify residual must/should requirements;
3. enumerate only explicit unused windows;
4. generate eligible compact/module candidates;
5. apply standard equipment/environment/safety/spacing gates;
6. simulate the shared daily ledger debit;
7. compare marginal residual coverage;
8. reuse ADR-0018 D-SUPPORT viability to prove that the candidate preserves the incumbent
   maximum achievable exact required-role allocation under projected state;
9. reserve the best bounded candidate only after that proof, then recompute remaining
   reservations/residuals;
10. mark PM decision provisional;
11. before launch, rerun ADR-0036 reassessment and atomically claim capacity.

Constraints:

- maximum one generated secondary occurrence per unused window in v1;
- no new window inferred;
- no more weekly required dose because more windows exist;
- no automatic same-session merge in v1;
- explicit fragmentation penalty/tie-breaker after requirement coverage so the engine does not
  create needless snacks.

Acceptance:

- 35-min cycling-primary quality AM + home-gym strength PM when two windows exist;
- identical athlete with one window gets no invented double;
- PM can be cancelled after adverse AM response without undoing AM credit;
- shared daily minutes/cost cannot be double-spent;
- fixed/authored intraday bundle retains authority over generated secondary work;
- protected rest blocks all generated work.

### CF5 — Aerobic cross-credit and dose separation

**Blocked by:** #806 design/implementation

Wire four separately visible aerobic concepts:

1. `aerobicEndurance` stimulus;
2. total aerobic duration by intensity domain;
3. low-intensity support dose/range;
4. long aerobic/durability anchor.

Rules:

- tempo/threshold may earn `aerobicEndurance` stimulus;
- actual duration is counted in its true intensity domain;
- low-intensity minutes are not manufactured from intensity multipliers;
- long-anchor exact role is not cleared by short accumulated work unless #806 explicitly
  decides that policy;
- time-constrained plans may show "aerobic stimulus adequate; low-intensity volume below
  target" as a valid state.

Acceptance scenarios:

- 35-min threshold + two 30-min Z2 sessions;
- 70-min threshold only;
- multiple 20-min easy rides;
- one 120-min long ride;
- same weekly minutes with different intensity distribution.

### CF6 — Capability integration

**Blocked by:** #802–#805 as each canonical model lands

Consume capability outputs; never rebuild their rules.

Expected integrations:

- #802 power;
- #803 movement-family composition;
- #804 impact/running/jump exposure;
- #805 multidirectional/skill exposure.

The fulfilment layer only needs:

- current target/residual;
- valid qualifying candidate/module identities;
- blocked/suspended state;
- cost;
- deadline/max-gap if canonical policy supplies one.

One session/module may contribute to multiple capabilities through explicit metadata.

### CF7 — Constraint-degradation policy

**Blocked by:** CF1–CF6 sufficient coverage

Implement the degradation repertoire with a versioned policy-selected ordering. The sequence
below is the proposed initial product heuristic, not an evidence-derived physiological law:

1. full dose;
2. valid compression;
3. same-day consolidation;
4. BUILD -> MAINTAIN/MICRODOSE;
5. cross-credit;
6. safe substitution;
7. typed shortfall/suspension.

This should be a small orchestration layer. It must not encode family-specific science.
Any ordering/tie-break that changes live selection requires ADR-0033 product-policy lineage.

Diagnostics must state which operation was used.

### CF8 — Context brief/UI explanation

**Blocked by:** CF0 and incremental canonical integrations
**Related:** #813

Main already contains #813's read-only stressor/physical-capability ledger. CF8 extends that
existing read model as canonical #802–#806 outputs become available; it does not create a
second exposure/completion ledger.

Expose a bounded summary such as:

```text
Threshold quality: satisfied (Tue)
Aerobic stimulus: satisfied (quality + endurance)
Low-intensity volume: 78% of target — time constrained
Primary strength: satisfied (Mon)
Second strength/power support: maintenance microdose planned (Tue PM)
Impact/COD: deliberately suspended — active tissue restriction
Long aerobic anchor: unmet — no feasible 100+ min window
```

Do not reconstruct policy in the renderer.

## 4. Priority / search policy

Preserve ADR-0018's incumbent feasibility hierarchy and reservation topology: hard
safety/readiness/taper/daily-capacity gates; committed fixed/overlay load; the ADR-0043 rolling
catalog-load envelope; then exact required-role allocation and D-SUPPORT preservation. ADR-0036
adds the shared intraday ledger for same-day capacity; it does not reorder weekly authority.

Within the remaining feasible support space, the proposed residual ordering is:

1. canonical minimum accumulated dose / overdue capability floors;
2. BUILD stimulus;
3. MAINTAIN/MICRODOSE residuals;
4. modality preference/logistics;
5. optional surplus utility.

A capability becomes an ADR-0018 exact must-have only when its canonical owner explicitly
defines that role. The support ordering is a product-policy heuristic and must be registered,
versioned and alignment-tested before it changes live selection.

## 5. Evidence/knowledge work

Before any CF work changes recommendations, add ADR-0033 claims for:

- microdose maintenance policy by family;
- BUILD -> MAINTAIN transition conditions;
- any fragmentation/second-window packing heuristic that changes selection;
- any accumulated-dose formula;
- capability cadence/max gaps;
- any cross-credit threshold not already contained in authored stimulus profiles.

Keep claims explicit about evidence class. Knowledge evidence certainty must not be multiplied
into ADR-0014 objective credit; it governs policy authority/limitations instead. The following
are **not** established physiological constants:

- 10/15/20-minute universal strength minimum;
- one universal same-day separation;
- fixed threshold-to-Z2 time conversion;
- one universal maximum gap for power/impact/COD;
- one universal benefit-per-minute scale.

## 6. Deterministic scenario matrix

Build matched scenarios varying one constraint at a time.

| Family | A | B | Expected distinction |
|---|---|---|---|
| Time | 90 min/day | 30–35 min/day | compression/microdose/shortfall, not modality accident |
| Windows | one/day | AM + PM | doubles only in B |
| Equipment | full gym | KB/bodyweight only | explicit equivalent modules only |
| Tissue | green | impact blocked | impact suspended; aerobic/strength shared work may continue |
| Recovery | green | adverse | PM/optional microdose removed first |
| Phase | base | race/taper | general capability may intentionally shrink/suspend |
| Priority | cycling BUILD | strength BUILD | same-day freshness order changes |
| History | novice | established | athlete-relative floors/envelopes differ |

Required assertions:

- zero safety/eligibility violations;
- zero daily/rolling load overspend;
- no exact-role inflation from cross-credit;
- no session-count double counting for embedded modules;
- no fabricated availability;
- deterministic replay;
- typed reasons for every residual must-have.

## 7. Performance guardrails

The search must remain bounded.

Recommended initial limits:

- only residual must/should requirements generate secondary candidates;
- only explicit unused windows are searched;
- one generated secondary occurrence per window;
- only catalog/module candidates already eligible for the date;
- prune candidates with zero residual contribution;
- cap equivalent candidates per requirement using existing ranking order.

These are algorithmic bounds, not training-policy constants.

Add a perf regression adjacent to `weeklyAllocationPlanner.perf.test.ts`.

## 8. Rollout

### Stage A — shadow diagnostics
CF0 + CF1 in diagnostics only. Compare current selected week with the hypothetical
residual-aware portfolio.

### Stage B — module authoring, no automatic placement
CF2/CF3. Modules can be used by authored/external plans and test fixtures.

### Stage C — shadow intraday packer
CF4 computes suggestions but cannot change persisted recommendation.

### Stage D — opt-in generated secondary work
Activate for one constrained persona family after simulations and judge review.

### Stage E — broader activation
Only after #806 and enough #802–#805 capability families are canonical.

Each activation gets a new `POLICY_VERSION`. Baseline refresh is a separate reviewed commit.

## 9. Repository changes expected when implementation starts

Likely touch points:

- `app/src/engine/models.ts` — requirement residual types;
- `app/src/engine/stimulus.ts` — reuse the existing canonical objective-credit primitive;
  do not add a competing credit formula;
- a small fulfilment/residual module under `app/src/engine/` — clamp canonical contributions
  to residual requirements and expose diagnostics;
- `app/src/engine/weeklyAllocation.ts` — integrate residual support without weakening
  ADR-0018 required-role reservation/D-SUPPORT;
- `app/src/engine/weeklyDosePacking.ts` — consume accumulated/capability targets;
- `app/src/engine/planner.ts` — bounded multi-window secondary proposal;
- `app/src/engine/intradayBundlePlacement.ts` / existing services — reuse, not duplicate;
- `app/src/workouts/*` — module catalog/metadata;
- `app/src/knowledge/*` — claims/coverage/alignment;
- `app/scripts/ai-judge/*` — matched constraint persona families;
- `docs/architecture/recommendation-engine.md` — only after behavior is live.

## 10. Definition of done for the architecture initiative

The initiative is complete when the engine can explain and prove, for a constrained week:

1. what was originally required;
2. what exact roles remain;
3. what secondary stimulus was already delivered by those sessions;
4. what was compressed/microdosed/consolidated;
5. what accumulated dose remains;
6. what capability is blocked/suspended;
7. why no safer/better feasible portfolio exists inside the searched space.

The success criterion is **not** "all boxes are always green." It is "maximize valid
requirement fulfilment while never lying about equivalence or capacity."
