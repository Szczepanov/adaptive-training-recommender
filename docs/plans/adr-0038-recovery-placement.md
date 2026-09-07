# ADR-0038 recovery placement implementation plan

**Status:** Draft — ADR-0038 is Proposed  
**Tracks:** [ADR-0038](../adr/0038-engine-generated-recovery-placement.md), PR #455  
**Blocked by:** acceptance of ADR-0038 / PR #455 before runtime activation  
**Unlocks:** explicit plan-independent recovery placement, rolling seven-date recovery invariant, recovery deadline diagnostics  
**Builds on:** PR #453 effective-dose projection; ADR-0016 exact coverage identity; ADR-0018 weekly-role allocation/D-SUPPORT; ADR-0033 knowledge governance; ADR-0034 canonical performed-training occurrences; ADR-0035 authored rest; ADR-0036 schedule windows  
**Source analysis:** [2026-09-07 ADR-0038 implementation analysis](../analysis/2026-09-07-adr-0038-recovery-placement-implementation-analysis.md)

---

## Overview

ADR-0038 turns recovery placement from an emergent consequence of projected fatigue into an
explicit product-policy requirement:

- at least one qualifying recovery exposure in every seven consecutive local calendar dates;
- no more than six consecutive non-recovery dates once history is authoritative or a stable
  bootstrap epoch exists;
- exact recovery identity, not category/title similarity;
- tier 2 while there is slack, tier 1 on the due date or overdue, never tier 0;
- no ADR-0018 reservation for recovery;
- no completed Rest inferred from missing provider/wearable data.

This plan deliberately separates **domain truth**, **historical provenance**, **ranking behavior**
and **evaluation**. The runtime policy should not be activated until those layers are present and
knowledge/policy-version governance is complete.

The preferred implementation is a small recovery-placement state/fact layer composed into the
existing `coverageNeedTier` axis. Do not fabricate an Evergreen `PlanDefinition` or widen
`PerformedTrainingOccurrence` to mean a non-training Rest day.

## Goals

1. Give plan-less athletes exact recovery identity authority without pretending an authored plan
   exists.
2. Compute an explicit recovery deadline that cannot drift or fail on the `R + 7` boundary.
3. Keep projected recovery and historical recovery separate.
4. Reuse canonical performed-training facts for active recovery and ADR-0035 provenance for
   authored Rest.
5. Add a positive, auditable historical path for engine-generated complete Rest.
6. Escalate qualifying recovery through the existing ordinal ranking model without bypassing hard
   gates or ADR-0018 D-SUPPORT.
7. Make misses, unknown history and deferrals observable.
8. Register the exact scalar/identity/escalation as product policy and bump `POLICY_VERSION` when
   behavior activates.
9. Replace the weak simulation smoke assertion with a deterministic exact-identity rolling-window
   invariant while retaining useful coarse metrics.

## Non-goals

This work does **not**:

- change fatigue half-lives or load weights to force Rest indirectly;
- make one complete Rest day a universal physiological recommendation;
- turn `recovery_or_rest` into `RequiredRoleOccurrence` or a reserved weekly slot;
- infer Rest from absent telemetry;
- grant recovery coverage by broad `Mobility/Recovery` category;
- redefine readiness `train` / `modify` / `recover`;
- solve ADR-0036 day-level aggregation for future same-date doubles;
- settle the separate `optimizer.recovery_streak_heuristics` effective-vs-authored-cost question;
- re-baseline unrelated PR #453 scenario changes automatically.

---

# Architecture target

## A. Recovery placement state is separate from authored coverage state

Introduce a pure recovery-policy state resolver, preferably in a cohesive module such as
`app/src/engine/recoveryPlacement.ts` (final file name may change during implementation).

The state must carry, directly or equivalently:

- policy id/version;
- `asOfDate`;
- identity authority: `product_policy` or `authored_coverage`;
- exact `coverageSetId` and phase used for recovery lookup;
- historical state: `known` or `unknown`;
- latest qualifying recovery date when known;
- stable bootstrap date when needed;
- `dueByDate`;
- overdue state;
- historical/projected satisfaction relevant to the current forecast.

### Authority resolution

1. Resolve normal authored `CoverageState` exactly as today.
2. If the active authored state contains `recovery_or_rest`, use its descriptor/phase as recovery
   exact-identity authority. Do not add a duplicate product requirement.
3. Otherwise use `EVERGREEN_GENERAL_COVERAGE_SET` and phase `general` **only for recovery identity**.
4. Do not create a fake plan id, block id, authored objective, allocator occurrence, or unrelated
   Evergreen coverage requirement.

This preserves ADR-0016 exact identity while keeping provenance truthful.

## B. Recovery facts are not all performed-training facts

Define a recovery-specific historical input/fact abstraction. It may be called
`RecoveryPlacementFact`, `RecoveryDayOutcomeFact`, or similar, but it must distinguish source kinds
rather than collapse them into generic `completed` credit.

Required source classes:

1. **Performed active recovery** — backed by canonical `PerformedTrainingOccurrence` plus exact
   workout identity.
2. **Authored Rest** — backed by ADR-0035 external-rest provenance: plan id, revision, content hash,
   directive id, resolved date and override state.
3. **Engine-generated complete Rest** — backed by persisted recommendation/audit identity plus a
   post-day canonical occurrence reconciliation result proving the day can be adjudicated and no
   contradictory performed occurrence replaced the recommendation.

Projected recovery selections stay forecast-only and are not promoted into historical truth by the
planner itself.

## C. One ranking axis, composed urgency

Keep optimizer ordering based on the existing `coverageNeedTier`. Add a recovery-placement tier
helper and compose the two sources of urgency:

```text
final coverage need = min(existing authored coverage tier, recovery placement tier)
```

ADR-0038 helper semantics:

| Candidate | Slack before due date | Due/overdue |
| --- | ---: | ---: |
| exact qualifying recovery identity | 2 | 1 |
| anything else | 3 | 3 |

It never returns tier 0.

All existing hard eligibility/safety/readiness gates run before the ordinal tier can win selection.

## D. Deadline is explicit

For latest qualifying historical/projected recovery `R`, compute the next due date as `R + 7`
local calendar days. The current `WeeklyCoverageRequirement.windowEnd` remains a plan/block boundary
and must not become this deadline.

Unknown-history bootstrap uses a stable epoch supplied by composition/persistence. It must not be
recomputed from each invocation's `asOfDate`.

## E. D-SUPPORT remains authoritative

Keep `recovery_or_rest` filtered from `deriveRequiredRoleOccurrences()`.

On train/modify-tier dates, a discretionary recovery pick must pass the same weekly-role viability
proof even if it is the **only accepted ranked candidate**. Remove or replace the current
`ranked.length > 1` shortcut with a condition based on whether a live allocation can be harmed.

If D-SUPPORT blocks escalated recovery, record a typed ADR-0038 diagnostic. Do not manufacture a
D-MISS allocator occurrence for recovery.

---

# Work packages

## RP0 — Freeze contracts and pure recovery state

**Status:** blocked by ADR-0038 acceptance for behavior; pure scaffolding may be prepared earlier  
**Depends on:** PR #455  
**Behavior change:** none if kept disconnected from live ranking

### Work

- Introduce pure recovery-placement domain types and resolver.
- Implement local-date deadline arithmetic: latest `R` -> `dueByDate = R + 7`.
- Represent `known` vs `unknown` history explicitly.
- Accept stable bootstrap epoch as an input; never synthesize it from each current date.
- Resolve `product_policy` vs `authored_coverage` identity authority without fabricating plan/block
  provenance.
- Add pure helper for ADR-0038 tier (`3/2/1`, never `0`).
- Add typed diagnostic/reason vocabulary early so later work packages do not invent strings.

### Likely files

- new `app/src/engine/recoveryPlacement.ts` and `.test.ts`;
- small exported types from existing engine models only if cross-boundary persistence requires them;
- no `POLICY_VERSION` bump while not connected to live recommendation behavior.

### Tests

- slack/due/overdue tier transitions;
- `R + 7` boundary;
- unknown-history state;
- stable bootstrap repeated-recompute test;
- authored authority wins over baseline product authority without duplication;
- plan-less product authority has Evergreen descriptor + `general` phase but no fake plan/block id.

### Exit criteria

A pure deterministic function can answer: **what is the recovery authority, what historical state is
known, when is recovery due, and what urgency does a qualifying candidate receive?** No optimizer
change yet.

---

## RP1 — Complete exact recovery identity

**Status:** planned  
**Depends on:** RP0  
**Behavior change:** exact coverage/fact semantics may change; review persistence/replay impact before merge

### Work

- Make baseline Evergreen `recovery_or_rest` recognize at minimum:
  - `rest_complete_01`;
  - `recovery_mobility_tissue_01`;
  - `recovery_breathwork_01`;
  - `cycling_recovery_spin_01`.
- Verify every identity resolves from engine template -> canonical workout id correctly.
- Preserve `cycling_recovery_spin_01` as recovery-only with respect to `aerobic_volume`.
- Decide/document event-descriptor breathwork behavior. Prefer semantic consistency unless an
  explicit event-specific exclusion is intended.
- Add descriptor-alignment tests so future catalog additions cannot silently create mismatched
  recovery semantics.

### Likely files

- `app/src/workouts/event-plan.ts`;
- relevant coverage/descriptor tests;
- potentially catalog/prescription mapping tests if reverse identity is ambiguous.

### Tests

- four baseline identities qualify under product-policy authority;
- unmapped `Mobility/Recovery` category does not qualify;
- recovery spin does not receive aerobic-volume credit;
- event/evergreen recovery sets differ only by an explicitly asserted exception set.

### Exit criteria

Exact identity is deterministic and complete enough for ADR-0038. No broad category fallback exists.

---

## RP2 — Historical recovery facts, authored-rest bridge and bootstrap persistence

**Status:** planned  
**Depends on:** RP0, RP1  
**Behavior change:** historical recovery state becomes available, but ranking activation can remain off

This is the highest data-trust-risk package and should be reviewed independently from ranking.

### Work A — performed active recovery

- Translate canonical performed-training exact coverage into recovery facts.
- Preserve performed occurrence id and exact workout id.
- Generic modality/category remains insufficient.

### Work B — ADR-0035 authored Rest bridge

- Reuse `ExternalRestProvenance` / `ExternalRestDecisionProvenance` source identity.
- Credit a resolved authored rest date only under the ADR-0038/0035 contract.
- Explicit `overridden: true` suppresses the authored-rest recovery fact.
- Do not create a fake workout or `PerformedTrainingOccurrence`.

### Work C — generated complete-Rest day outcome

Add a pure post-day reconciliation step that receives:

- persisted recommendation/audit proving canonical Rest was selected for the date;
- policy/replay identity needed to tie that decision to the correct version;
- canonical performed-occurrence reconciliation state for that date;
- contradictory performed occurrences, if any.

Emit a historical Rest fact only when the reconciliation state is authoritative enough to close the
day and no contradictory training replaced Rest. If completion is unknown, emit/retain `unknown` —
not Rest.

**Do not use “provider returned nothing” as closure.**

### Work D — stable bootstrap

- Select a durable owner for recovery-policy bootstrap date.
- Prefer an existing stable account/history/audit boundary if it is semantically authoritative;
  otherwise persist a first-policy-evaluation/enrollment date.
- Read the epoch at composition time and pass it into the pure resolver.
- Add migration/backward-compatibility behavior for existing athletes with no stored epoch.
- The first generated epoch may be created once, but must not slide on future recomputation.

### Decision gate: authored-rest adherence contradiction

Before RP2 is considered complete, decide the case where:

- an ADR-0035 Rest directive exists;
- no explicit in-app override was recorded;
- canonical performed training later appears on the same date.

ADR-0038 explicitly defines override suppression but does not fully specify this unrecorded
adherence violation. Do not encode a silent assumption. Recommended default for owner review:
contradictory performed training means the date was not a recovery date, while preserving the
original authored intent in audit provenance.

### Likely files

The exact persistence seam must be selected after tracing existing recommendation-audit and
canonical-occurrence composition. Expected touch points include:

- `app/src/engine/performedTrainingFacts.ts` or a recovery-specific adapter beside it;
- `app/src/engine/externalRestProvenance.ts` / existing external-rest composition;
- recommendation audit/replay persistence and validation modules;
- user/history composition for bootstrap epoch;
- Firestore rules/tests only if a new persisted field/document is introduced.

### Tests

- exact performed recovery -> historical recovery fact;
- generic performed mobility without exact identity -> no fact;
- authored Rest -> fact with full provenance;
- authored Rest explicit override -> no recovery credit;
- generated Rest recommendation alone -> no historical fact;
- generated Rest + authoritative clean reconciliation -> historical fact;
- generated Rest + contradictory performed occurrence -> no fact;
- incomplete/unknown reconciliation -> history remains unknown;
- repeated daily planning reads the same bootstrap date.

### Exit criteria

The live composition boundary can supply a trustworthy recovery history without treating non-training
as a performed workout and without interpreting missing telemetry as Rest.

---

## RP3 — Integrate deadline urgency into ranking and close D-SUPPORT hole

**Status:** planned  
**Depends on:** RP0-RP2  
**Behavior change:** yes — this is the primary ADR-0038 activation seam

### Work A — optimizer context

- Build/attach `RecoveryPlacementState` for every recommendation/planner call, including plan-less
  athletes.
- Use active authored recovery authority when present; otherwise use recovery-only Evergreen
  authority.
- Keep normal `CoverageState` unchanged for authored weekly-role allocation.

### Work B — ranking

- Add `recoveryNeedTierForTemplate()` or equivalent exact-identity helper.
- Compose it with existing `coverageNeedTierForTemplate()` into the one ordinal coverage tier.
- Preserve hard gates before sorting.
- Preserve readiness recovery-style preference as a separate later ordering concern; a deadline
  makes recovery urgent, not necessarily full Rest.
- Ensure tier 1 recovery may beat tier 2/3 discretionary work but never tier 0 programming
  authority.

### Work C — D-SUPPORT

- Replace the `ranked.length > 1` condition with semantics that run viability whenever a
  non-reserved train/modify-tier discretionary pick could reduce the currently achievable required
  role count.
- A sole escalated recovery candidate must therefore be tested.
- If recovery is rejected/deferred by D-SUPPORT, retain the required-role feasible path and add a
  typed recovery diagnostic.
- Do not add recovery to `RequiredRoleOccurrence` or D-MISS.

### Work D — rationale/decision trace

The selected recommendation/forecast trace must expose:

- policy id/version;
- authority;
- history state;
- latest qualifying recovery date if known;
- bootstrap date when used;
- `dueByDate`;
- overdue state;
- whether tier escalation applied;
- selected qualifying identity when recovery wins;
- typed reason when recovery was deferred/rejected.

### Tests

- plan-less slack -> tier 2;
- plan-less due day -> tier 1 and recovery can win ranking;
- active authored recovery authority deduplicates product fallback;
- recovery never reaches tier 0;
- hard safety/availability/readiness exclusion still wins over deadline;
- single accepted recovery candidate runs D-SUPPORT;
- D-SUPPORT preserves an otherwise feasible required role and reports ADR-0038 deferral;
- recover-tier existing semantics remain unchanged where ADR-0038 does not own authority.

### Exit criteria

Live and forecast ranking enforce the ADR without creating a new allocator reservation or bypassing
hard constraints.

---

## RP4 — Observability and deterministic simulation invariant

**Status:** planned  
**Depends on:** RP3  
**Behavior change:** diagnostics/evaluation only beyond RP3 behavior

### Work

- Extend planner/recommendation diagnostics with typed recovery-placement state.
- Extend `ScenarioResult` with at least:
  - exact qualifying recovery count;
  - maximum consecutive non-recovery dates;
  - rolling seven-date violation count/details;
  - unknown-history prefix/coverage state where applicable;
  - recovery deadline miss/defer count by reason.
- Compute qualifying recovery using exact mapped identity, not category.
- Retain `restOrRecoveryDayCount` as a descriptive smoke metric if useful, clearly labelled as
  category-based.
- Add a deterministic invariant helper that checks every complete seven-local-date window after
  bootstrap.
- Make scenario output distinguish deadline success from “recovery happened eventually”.
- Ensure simulator assumed-adherence conversion (`toCompletedExposure`) is documented/tested as a
  simulation convention and is not imported into live historical truth.

### Likely files

- `app/src/engine/simulation/analyze.ts`;
- scenario invariant tests / simulation artifact builders;
- plan-judge invariant packet if recovery metrics are surfaced there;
- planner diagnostics types.

### Tests

- one recovery in a 28-day plan is insufficient if later windows violate the invariant;
- exact mapped recovery qualifies, category-only recovery-looking template does not;
- recovery on `R + 7` closes the boundary correctly;
- max streak reports 6 for a compliant sequence;
- forced safety/availability miss is visible with reason instead of silently changing the
  invariant source of truth.

### Exit criteria

A scenario result can answer **where the recovery contract was satisfied or missed and why**, not
only how many Rest/Mobility days existed.

---

## RP5 — Knowledge governance, policy version and activation proof

**Status:** planned  
**Depends on:** RP1, RP3, RP4; must ship no later than live behavior activation  
**Behavior change:** policy/replay metadata; final activation proof

### Knowledge registry

In `app/src/knowledge/sportsKnowledge.ts`:

- add `KNOWLEDGE_CLAIM_IDS.weeklyRecoveryPlacementPolicy` (name may follow local convention) with
  value `policy.load_recovery.weekly_recovery_placement_v1`;
- statement includes one qualifying exact recovery identity per seven consecutive local dates and
  tier-1 deadline escalation;
- `claimType: 'heuristic'`;
- `maturity: 'heuristic'`;
- `evidenceCertainty: 'not_applicable'`;
- source `PRODUCT-EVERGREEN-DOSE-V1` exactly as ADR-0038 requires;
- limitations explicitly state that the one-in-seven cadence is product policy, not a universal
  physiological optimum;
- keep `recovery.training.stress_recovery_balance` as the scientific boundary, not the scalar's
  scientific proof.

### Knowledge coverage

Add an `ENGINE_KNOWLEDGE_COVERAGE` item in `readiness_recovery` or `session_spacing` with exact code
refs to:

- cadence/deadline constant/resolver;
- qualifying identity authority;
- ranking escalation seam.

Add/update policy-alignment tests binding the registry claim to the implementation:

- interval = 7 dates;
- max non-recovery streak = 6;
- qualifying exact identities;
- slack tier 2;
- due/overdue tier 1;
- never tier 0.

### Policy version

When runtime recommendation behavior activates:

- bump `app/src/engine/policy.ts::POLICY_VERSION` to a unique ADR-0038 recovery-placement version;
- move the prior live value into `HISTORICAL_POLICY_VERSIONS` following repository convention;
- update audit/replay tests so old persisted decisions remain readable but are not silently
  re-executed under the new policy.

### Validation

From `app/`, run the repository-supported gates:

```bash
npm run check
npm run simulate:scenarios
npm run simulate:plan-judge
```

For a behavior-changing PR, also run the relevant persona/general judge comparison flow used by the
repository and inspect deterministic plan changes before considering baseline updates. AI judge
score movement is secondary to deterministic ADR invariants.

Do not update committed baselines simply to make a test green. Every changed recovery placement and
unrelated PR #453 difference should be classified.

### Exit criteria

The exact ADR-0038 heuristic is discoverable in the knowledge registry, mechanically aligned with
code, recorded in the policy version, and validated across unit/integration/simulation layers.

---

# Recommended PR cut-line

The work packages above describe semantics. For reviewability, implement them as a short stack
rather than one large runtime PR.

## Implementation PR A — policy model + exact identity

**Contains:** RP0 + RP1 pure/domain work.  
**Goal:** establish exact identities and deadline state with exhaustive unit tests, without changing
live selection if practical.

Suggested title:

`feat(engine): model ADR-0038 recovery placement state and identity`

## Implementation PR B — historical recovery truth

**Contains:** RP2.  
**Goal:** establish performed-active-recovery, authored-rest and engine-Rest day-outcome facts plus
stable bootstrap persistence/reconciliation.

Suggested title:

`feat(engine): add auditable ADR-0038 recovery history facts`

This PR should be independently reviewed for data-trust, persistence and replay correctness.

## Implementation PR C — ranking activation + governance

**Contains:** RP3 plus the behavior-bearing parts of RP5.  
**Goal:** activate deadline tier escalation, fix single-candidate D-SUPPORT, register policy lineage,
and bump `POLICY_VERSION` in the same reviewable behavior boundary.

Suggested title:

`feat(engine): enforce ADR-0038 recovery placement deadlines`

Do not land live behavior without the knowledge claim/alignment tests and policy version.

## Implementation PR D — simulation/diagnostic proof

**Contains:** RP4 plus final corpus/baseline review from RP5.  
**Goal:** prove rolling-window behavior and expose misses/streaks in deterministic artifacts.

Suggested title:

`test(sim): verify ADR-0038 rolling recovery invariant`

If diagnostics are required to safely review PR C, move their minimal typed trace fields into C and
leave aggregate simulation reporting in D.

---

# Dependency graph

```text
PR #453 effective-dose projection
        |
        v
PR #455 / ADR-0038 accepted
        |
        v
A: policy state + exact identity
        |
        v
B: historical facts + bootstrap
        |
        v
C: ranking + D-SUPPORT + knowledge + POLICY_VERSION
        |
        v
D: simulation invariant + corpus review
```

Parallelism is intentionally limited. Historical Rest truth must exist before ranking relies on it,
and policy governance must accompany activation rather than follow later as cleanup.

---

# ADR acceptance matrix

| ADR-0038 acceptance requirement | Primary package | Proof |
| --- | --- | --- |
| 1. Every seven-date window has recovery | RP4 | deterministic rolling-window invariant |
| 2. `R + 7` boundary escalates before selection | RP0/RP3 | pure deadline + ranking integration test |
| 3. Plan-less exact identity and tier 2->1 | RP0/RP3 | no-plan optimizer test with recovery authority |
| 4. Stable bootstrap | RP0/RP2 | repeated daily recomputation with same persisted epoch |
| 5. Exact identities only | RP1 | descriptor/catalog identity tests |
| 6. ADR-0035 authored Rest bridge | RP2 | provenance/override test |
| 7. Projected Rest != historical Rest | RP2/RP4 | forecast-vs-history boundary test |
| 8. Contradictory training suppresses generated Rest | RP2 | reconciliation test |
| 9. D-SUPPORT incl. single candidate | RP3 | last-feasible-role scenario |
| 10. Miss diagnostic outside D-MISS | RP3/RP4 | typed deadline/defer trace assertion |
| 11. Cross-descriptor consistency | RP1 | explicit descriptor-difference/alignment test |

---

# Detailed behavior scenarios

## Scenario S1 — known recent recovery, plenty of slack

History has exact recovery on Monday. On Tuesday-Friday, qualifying recovery is tier 2. Normal
higher-priority training roles may win. No readiness mode is fabricated.

## Scenario S2 — boundary day

History has exact recovery on Monday and no qualifying recovery Tuesday-Sunday. The next Monday is
`dueByDate`; recovery is tier 1 **before** ranking that Monday. Selecting non-recovery without an
explicit higher-authority blocker would be an ADR violation.

## Scenario S3 — plan-less athlete

No event/plan exists. `CoverageState` may remain empty for authored weekly roles, while
`RecoveryPlacementState` uses Evergreen/general exact recovery authority. A due recovery candidate
can therefore rank tier 1 without a fake `activeBlockId`.

## Scenario S4 — authored recovery coverage

An active plan already contains `recovery_or_rest`. The policy uses the active authored descriptor
as identity authority and does not add a second baseline requirement. Deadline diagnostics still
expose ADR-0038 placement state.

## Scenario S5 — generated Rest yesterday, history not reconciled

Yesterday's audit says canonical Rest, but occurrence/provider reconciliation is incomplete. Today's
historical recovery state is `unknown`; the engine does not award completed Rest merely because no
activity is visible yet.

## Scenario S6 — generated Rest reconciled cleanly

Yesterday's audit says canonical Rest and post-day canonical reconciliation is authoritative with no
contradictory performed occurrence. A recovery-day outcome fact is emitted and becomes the latest
qualifying recovery date.

## Scenario S7 — generated Rest contradicted by training

Yesterday's audit says Rest, but canonical performed training exists. The generated Rest does not
become historical recovery.

## Scenario S8 — authored Rest override

ADR-0035 directive resolves to the date but persisted provenance has `overridden: true`. No authored
recovery credit is emitted; the actual performed/reconciled outcome decides history.

## Scenario S9 — due recovery conflicts with last feasible required role

Athlete is train/modify tier. Recovery is due and is the only accepted ranked recovery candidate,
but consuming today would reduce the achievable ADR-0018 required-role count. D-SUPPORT runs despite
`ranked.length === 1`; recovery is deferred/rejected with a typed reason and the required role is
preserved.

## Scenario S10 — hard availability blocks recovery

Recovery is overdue but no qualifying recovery identity fits a hard availability/equipment/safety
constraint. The engine does not force an invalid session. It emits a deadline miss/defer diagnostic
that names the hard blocker.

---

# Rollout and review checklist

Before declaring ADR-0038 implemented:

- [ ] ADR-0038 is Accepted, or owner explicitly authorizes implementation while Proposed.
- [ ] No runtime path fabricates an authored plan/block for baseline recovery.
- [ ] Exact identity set is complete and descriptor differences are deliberate.
- [ ] Recovery deadline is not `WeeklyCoverageRequirement.windowEnd`.
- [ ] Bootstrap date is durable and cannot slide.
- [ ] Projected Rest cannot leak into historical completed recovery.
- [ ] Missing telemetry alone cannot create Rest.
- [ ] ADR-0035 provenance is preserved end-to-end.
- [ ] Authored-rest contradiction semantics are explicitly decided.
- [ ] `recovery_or_rest` remains absent from allocator reservations.
- [ ] Single-candidate D-SUPPORT test passes.
- [ ] Recovery deadline diagnostics are typed and replay/audit safe.
- [ ] Simulation invariant uses exact identity and every seven-date window.
- [ ] Knowledge claim + inventory + alignment tests exist.
- [ ] `POLICY_VERSION` is bumped with live behavior.
- [ ] `npm run check` passes.
- [ ] `npm run simulate:scenarios` passes with reviewed plan deltas.
- [ ] `npm run simulate:plan-judge` invariants pass.
- [ ] Relevant persona/general judge deltas are inspected; baselines are updated only after semantic
      review.
- [ ] PR #453-related non-recovery expectation changes are not mislabeled as ADR-0038 fixes.

## Definition of done

ADR-0038 is done only when a live recommendation can explain, with replayable provenance:

> which recovery authority applied, what exact prior recovery facts were trusted, when recovery was
> due, whether urgency escalated, which exact identity satisfied it (or why none could), and why the
> choice did not violate a higher-authority safety/availability/readiness/weekly-role constraint.

A plan that merely happens to contain a Rest/Mobility day is not sufficient proof.
