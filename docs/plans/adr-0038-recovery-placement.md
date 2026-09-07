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

This plan deliberately separates **domain truth**, **historical provenance**, **ranking behavior**,
**evaluation**, and **activation**. Runtime behavior must not become the default live policy merely
because ranking plumbing exists. The deterministic rolling-window invariant and corpus review are a
precondition for activation and for the `POLICY_VERSION` bump.

The preferred implementation is a small recovery-placement state/fact layer composed into the
existing `coverageNeedTier` axis. Do not fabricate an Evergreen `PlanDefinition` or widen
`PerformedTrainingOccurrence` to mean a non-training Rest day.

## Goals

1. Give plan-less athletes exact recovery identity authority without pretending an authored plan
   exists.
2. Compute an explicit recovery deadline that cannot drift or fail on the `R + 7` boundary.
3. Define deterministic bootstrap semantics for incomplete history.
4. Keep projected recovery and historical recovery separate.
5. Reuse canonical performed-training facts for active recovery and ADR-0035 provenance for
   authored Rest.
6. Add a positive, auditable historical path for engine-generated complete Rest.
7. Escalate qualifying recovery through the existing ordinal ranking model without bypassing hard
   gates or ADR-0018 D-SUPPORT.
8. Make misses, unknown history and deferrals observable.
9. Register the exact scalar/identity/escalation as product policy.
10. Prove the exact-identity rolling-window invariant and review corpus deltas **before** enabling
    the live behavior or bumping `POLICY_VERSION`.

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
- re-baseline unrelated PR #453 scenario changes automatically;
- introduce a permanent user-facing feature flag solely for staging this implementation.

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
- the deadline reference kind/date (`qualifying_recovery` or `bootstrap`) or an equivalent field;
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

1. **Performed active recovery** — backed by canonical `PerformedTrainingOccurrence`, canonical
   `workoutId`, and the exact recovery qualification authority used to validate that identity.
2. **Authored Rest** — backed by the canonical ADR-0035 persisted/replay contract
   `ExternalRestProvenance`; override adjudication may use the existing
   `ExternalRestDecisionProvenance = ExternalRestProvenance & { overridden?: true }` extension.
3. **Engine-generated complete Rest** — backed by persisted recommendation/audit identity plus a
   post-day canonical occurrence reconciliation result proving the day can be adjudicated and no
   contradictory performed occurrence replaced the recommendation.

Projected recovery selections stay forecast-only and are not promoted into historical truth by the
planner itself.

For performed active recovery, `workoutId` is the required exact replay identity. A `templateId` may
be retained as metadata only when it was directly authoritative or reverse inference is unambiguous;
the current performed-facts implementation intentionally refuses ambiguous workout -> template
inference.

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

## D. Deadline and bootstrap are explicit

For latest qualifying historical/projected recovery `R`:

```text
referenceDate = R
dueByDate = R + 7 local calendar days
```

The current `WeeklyCoverageRequirement.windowEnd` remains a plan/block boundary and must not become
this deadline.

For unknown history with a durable bootstrap date `B`:

```text
referenceDate = B
dueByDate = B + 7 local calendar days
```

Bootstrap semantics are deliberately explicit:

- `B` is a **deadline reference**, not a synthetic recovery fact;
- the unknown prefix before `B` is excluded from the enforceable rolling invariant;
- the first complete enforceable seven-date window is `B + 1 ... B + 7`;
- on `B + 7`, qualifying recovery is tier 1 before candidate selection when no real recovery has
  appeared since bootstrap;
- a real qualifying recovery before the first deadline replaces `B` as the next reference;
- `B` must be durable and reused across daily recomputation; it must never default to each new
  `asOfDate`.

This closes an ambiguity in the current Proposed ADR. Before ADR-0038 is accepted, keep PR #455
aligned with this bootstrap interpretation (or change this plan if the owner chooses a different
explicit grace-window contract).

## E. D-SUPPORT remains authoritative

Keep `recovery_or_rest` filtered from `deriveRequiredRoleOccurrences()`.

On train/modify-tier dates, a discretionary recovery pick must pass the same weekly-role viability
proof even if it is the **only accepted ranked candidate**. Remove or replace the current
`ranked.length > 1` shortcut with a condition based on whether a live allocation can be harmed.

If D-SUPPORT blocks escalated recovery, record a typed ADR-0038 diagnostic. Do not manufacture a
D-MISS allocator occurrence for recovery.

## F. Activation is a separate boundary from implementation plumbing

Ranking code, diagnostics, knowledge metadata and simulation metrics may be developed before the
policy becomes the default live recommendation behavior. The live composition seam must remain
explicitly disconnected/default-off until the deterministic simulation invariant and corpus review
have passed.

Use the smallest repository-native staging mechanism available: an explicit internal activation
input at the composition seam, or simply keep the new state/ranking path disconnected from the
production callsite until the activation PR. Do not create a permanent end-user feature flag unless
another requirement independently needs one.

`POLICY_VERSION` changes only in the same reviewed boundary that turns ADR-0038 into live decision
behavior.

---

# Work packages

## RP0 — Freeze contracts and pure recovery state

**Status:** blocked by ADR-0038 acceptance for behavior; pure scaffolding may be prepared earlier  
**Depends on:** PR #455  
**Behavior change:** none if kept disconnected from live ranking

### Work

- Introduce pure recovery-placement domain types and resolver.
- Implement local-date deadline arithmetic:
  - latest recovery `R` -> `dueByDate = R + 7`;
  - no known recovery + stable bootstrap `B` -> `dueByDate = B + 7`.
- Represent `known` vs `unknown` history explicitly.
- Represent bootstrap as a deadline reference, never as recovery credit.
- Exclude the pre-bootstrap unknown prefix from the rolling invariant; first enforceable window is
  `B + 1 ... B + 7`.
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
- no known recovery + bootstrap `B` => first deadline `B + 7`;
- bootstrap `B` is not counted/emitted as recovery;
- pre-bootstrap unknown prefix excluded and first enforced window is `B + 1 ... B + 7`;
- real recovery before first bootstrap deadline becomes the new reference;
- stable bootstrap repeated-recompute test;
- authored authority wins over baseline product authority without duplication;
- plan-less product authority has Evergreen descriptor + `general` phase but no fake plan/block id.

### Exit criteria

A pure deterministic function can answer: **what is the recovery authority, what historical state is
known, which date is the deadline reference, when is recovery due, and what urgency does a
qualifying candidate receive?** No optimizer change yet.

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
- Preserve `cycling_recovery_spin_01` as recovery-only for `aerobic_volume` purposes.
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
**Behavior change:** historical recovery state becomes available, but ranking activation remains off

This is the highest data-trust-risk package and should be reviewed independently from ranking.

### Work A — performed active recovery

- Translate canonical performed-training exact coverage into recovery facts.
- Preserve:
  - `performedOccurrenceId`;
  - canonical `workoutId`;
  - qualification authority (`coverageSetId`, phase, and `recovery_or_rest` key or an immutable
    equivalent snapshot/reference).
- Keep `templateId` only as optional metadata when directly authoritative/unambiguous.
- Generic modality/category remains insufficient.
- Replay must revalidate the persisted `workoutId` against the recorded qualification authority, or
  resolve an immutable canonical fact snapshot that guarantees the same relationship. An opaque
  occurrence id plus a mutable lookup is insufficient.

### Work B — ADR-0035 authored Rest bridge

Use one canonical provenance contract rather than two competing identities:

- `ExternalRestProvenance` is the persisted/audit/replay identity already carried by
  `Recommendation.decisionTrace.externalRest` and recommendation audit;
- `ExternalRestDecisionProvenance` is the existing override-aware extension of that base contract,
  not a replacement persisted schema;
- validate the base `ExternalRestProvenance` through the existing replay path before crediting a
  resolved authored Rest;
- when decision-time provenance reports `overridden: true`, suppress authored-rest recovery credit;
- preserve the original base provenance in audit;
- do not create a fake workout or `PerformedTrainingOccurrence`.

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
- For a generated bootstrap `B`, first due date is `B + 7`; persist `B` before it can affect future
  recomputation.
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

- exact performed recovery -> historical recovery fact with `workoutId` + qualification authority;
- stored performed-recovery identity that cannot be revalidated -> no exact recovery credit;
- generic performed mobility without exact identity -> no fact;
- authored Rest -> fact with canonical `ExternalRestProvenance`;
- authored Rest explicit override via decision extension -> no recovery credit while base audit
  provenance remains intact;
- generated Rest recommendation alone -> no historical fact;
- generated Rest + authoritative clean reconciliation -> historical fact;
- generated Rest + contradictory performed occurrence -> no fact;
- incomplete/unknown reconciliation -> history remains unknown;
- repeated daily planning reads the same bootstrap date and therefore the same first deadline.

### Exit criteria

The live composition boundary can supply a trustworthy recovery history without treating non-training
as a performed workout, without interpreting missing telemetry as Rest, and without relying on
mutable lookup to recover exact performed-recovery identity.

---

## RP3 — Integrate deadline urgency into ranking and close D-SUPPORT hole

**Status:** planned  
**Depends on:** RP0-RP2  
**Behavior change:** behavior-bearing implementation, but must remain default-off/disconnected until RP4/RP5B activation

### Work A — optimizer context

- Build/attach `RecoveryPlacementState` for recommendation/planner calls, including plan-less
  athletes, through a staging seam that tests can exercise without making it live by default.
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

### Work D — minimum typed rationale/decision trace

The staged recommendation/forecast trace must expose enough typed state for RP4 to prove behavior:

- policy id/version identifier (not necessarily the live `POLICY_VERSION` yet);
- authority;
- history state;
- latest qualifying recovery date if known;
- bootstrap/deadline reference when used;
- `dueByDate`;
- overdue state;
- whether tier escalation applied;
- selected qualifying identity when recovery wins;
- typed reason when recovery was deferred/rejected.

### Tests

- plan-less slack -> tier 2;
- plan-less due day -> tier 1 and recovery can win staged ranking;
- active authored recovery authority deduplicates product fallback;
- recovery never reaches tier 0;
- hard safety/availability/readiness exclusion still wins over deadline;
- single accepted recovery candidate runs D-SUPPORT;
- D-SUPPORT preserves an otherwise feasible required role and reports ADR-0038 deferral;
- recover-tier existing semantics remain unchanged where ADR-0038 does not own authority;
- default production composition remains unchanged before activation.

### Exit criteria

The staged ranking path enforces ADR-0038 semantics and D-SUPPORT correctly in deterministic tests,
but production recommendation behavior is not switched over yet.

---

## RP4 — Observability and deterministic simulation invariant

**Status:** planned  
**Depends on:** RP3  
**Behavior change:** diagnostics/evaluation only while activation remains off

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
- Exclude the pre-bootstrap prefix and never count `bootstrapDate` itself as recovery.
- Make scenario output distinguish deadline success from “recovery happened eventually”.
- Ensure simulator assumed-adherence conversion (`toCompletedExposure`) is documented/tested as a
  simulation convention and is not imported into live historical truth.
- Re-run the existing scenario corpus and plan-judge artifacts with the staged policy enabled; classify
  every changed recovery placement and every unrelated PR #453 delta rather than bulk re-baselining.

### Likely files

- `app/src/engine/simulation/analyze.ts`;
- scenario-invariant tests / simulation artifact builders;
- plan-judge invariant packet if recovery metrics are surfaced there;
- planner diagnostics types.

### Tests

- one recovery in a 28-day plan is insufficient if later windows violate the invariant;
- exact mapped recovery qualifies, category-only recovery-looking template does not;
- bootstrap date does not satisfy the first `B + 1 ... B + 7` window;
- recovery on `R + 7` closes the boundary correctly;
- max streak reports 6 for a compliant sequence;
- forced safety/availability miss is visible with reason instead of silently changing the
  invariant source of truth;
- deterministic corpus review has no unexplained recovery-placement deltas.

### Exit criteria

A scenario result can answer **where the recovery contract was satisfied or missed and why**, and
the existing corpus has been reviewed with the staged policy enabled. This proof is required before
live activation.

---

## RP5A — Knowledge governance before activation

**Status:** planned  
**Depends on:** RP1, RP3  
**Behavior change:** metadata/alignment only; no live activation and no `POLICY_VERSION` bump

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

### Knowledge coverage/alignment

Add an `ENGINE_KNOWLEDGE_COVERAGE` item in `readiness_recovery` or `session_spacing` with exact code
refs to:

- cadence/deadline constant/resolver;
- qualifying identity authority;
- ranking escalation seam.

Add/update policy-alignment tests binding the registry claim to the staged implementation:

- interval = 7 dates;
- max non-recovery streak = 6;
- qualifying exact identities;
- bootstrap first deadline = `B + 7`, with `B` not counted as recovery;
- slack tier 2;
- due/overdue tier 1;
- never tier 0.

### Exit criteria

The ADR-0038 heuristic is discoverable and mechanically aligned to the staged implementation before
activation, without claiming the behavior is already the live policy version.

---

## RP5B — Activation, replay version and final proof

**Status:** planned  
**Depends on:** RP4, RP5A  
**Behavior change:** **yes — sole live activation boundary**

### Preconditions

Before changing production composition or `POLICY_VERSION`:

- RP4 exact-identity rolling invariant passes;
- maximum non-recovery streak and bootstrap-boundary tests pass;
- D-SUPPORT single-candidate test passes;
- miss/defer diagnostics are typed;
- scenario and plan-judge corpus deltas have been reviewed and classified;
- ADR #455 is Accepted (or owner explicitly authorizes activation) and its bootstrap wording is
  aligned with the implementation contract;
- knowledge registration/alignment from RP5A is green.

### Activation

- Connect/enable the tested `RecoveryPlacementState` + ranking path at the normal live recommendation
  composition seam.
- In the same reviewable activation boundary, bump
  `app/src/engine/policy.ts::POLICY_VERSION` to a unique ADR-0038 recovery-placement version.
- Move the prior live value into `HISTORICAL_POLICY_VERSIONS` following repository convention.
- Update audit/replay tests so old persisted decisions remain readable but are not silently
  re-executed under the new policy.
- Re-run the deterministic validation after the final production wiring; do not assume staged and
  production composition are equivalent without the final proof.

### Validation

From `app/`, run repository-supported gates:

```bash
npm run check
npm run simulate:scenarios
npm run simulate:plan-judge
```

For the behavior-changing activation PR, also run the relevant persona/general judge comparison flow
used by the repository and inspect deterministic plan changes before considering baseline updates.
AI judge score movement is secondary to deterministic ADR invariants.

Do not update committed baselines simply to make a test green. Every changed recovery placement and
unrelated PR #453 difference should be classified.

### Exit criteria

Live recommendation behavior uses the already-proven ADR-0038 policy; the knowledge claim is aligned,
the new replay policy version records that activation, and deterministic integration/simulation
validation still passes after production wiring.

---

# Recommended PR cut-line

The work packages above describe semantics. For reviewability, implement them as a short stack rather
than one large runtime PR.

## Implementation PR A — policy model + exact identity

**Contains:** RP0 + RP1 pure/domain work.  
**Goal:** establish exact identities, bootstrap semantics and deadline state with exhaustive unit
tests, without changing live selection.

Suggested title:

`feat(engine): model ADR-0038 recovery placement state and identity`

## Implementation PR B — historical recovery truth

**Contains:** RP2.  
**Goal:** establish performed-active-recovery, authored-rest and engine-Rest day-outcome facts plus
stable bootstrap persistence/reconciliation.

Suggested title:

`feat(engine): add auditable ADR-0038 recovery history facts`

This PR should be independently reviewed for data-trust, persistence and replay correctness.

## Implementation PR C — staged ranking + governance

**Contains:** RP3 + RP5A.  
**Goal:** implement deadline tier escalation, close single-candidate D-SUPPORT, add minimum typed
trace and register/alignment-test policy lineage **without enabling the live path or bumping
`POLICY_VERSION`**.

Suggested title:

`feat(engine): stage ADR-0038 recovery ranking and governance`

The new behavior must remain default-off/disconnected from production composition. This PR exists so
simulation can exercise the real ranking path before activation.

## Implementation PR D — simulation proof + activation

**Contains:** RP4 + RP5B.  
**Goal:** prove the rolling invariant and bootstrap semantics, review corpus deltas, then activate
the already-tested path and bump `POLICY_VERSION` in the same final review boundary.

Suggested title:

`feat(engine): prove and activate ADR-0038 recovery placement`

If RP4 discovers a semantic defect, fix/review it in this PR (or a child fix) before activation; do
not flip the live composition seam merely because PR D was opened.

---

# Dependency graph

```text
PR #453 effective-dose projection
        |
        v
PR #455 / ADR-0038 accepted or explicitly authorized for scaffolding
        |
        v
A: policy state + exact identity
        |
        v
B: historical facts + bootstrap persistence
        |
        v
C: staged ranking + D-SUPPORT + knowledge alignment
   (production behavior remains off; no POLICY_VERSION bump)
        |
        v
D: deterministic simulation invariant + corpus review
   -> only after proof: connect live composition + bump POLICY_VERSION
```

Parallelism is intentionally limited. Historical Rest truth must exist before ranking relies on it,
and behavior must be proven in deterministic simulation before replay metadata declares it to be the
live policy.

---

# ADR acceptance matrix

| ADR-0038 acceptance requirement | Primary package | Proof |
| --- | --- | --- |
| 1. Every seven-date window has recovery | RP4/RP5B | deterministic rolling-window invariant before/after activation |
| 2. `R + 7` boundary escalates before selection | RP0/RP3 | pure deadline + staged ranking integration test |
| 3. Plan-less exact identity and tier 2->1 | RP0/RP3 | no-plan optimizer test with recovery authority |
| 4. Stable bootstrap | RP0/RP2/RP4 | `B + 7` first deadline, prefix exclusion, repeated recomputation |
| 5. Exact identities only | RP1 | descriptor/catalog identity tests |
| 6. ADR-0035 authored Rest bridge | RP2 | canonical provenance/override test |
| 7. Projected Rest != historical Rest | RP2/RP4 | forecast-vs-history boundary test |
| 8. Contradictory training suppresses generated Rest | RP2 | reconciliation test |
| 9. D-SUPPORT incl. single candidate | RP3 | last-feasible-role scenario |
| 10. Miss diagnostic outside D-MISS | RP3/RP4 | typed deadline/defer trace assertion |
| 11. Cross-descriptor consistency | RP1 | explicit descriptor-difference/alignment test |
| Knowledge/policy lineage | RP5A | registry + inventory + scalar/identity/tier alignment tests |
| Live activation/replay version | RP5B | RP4 proof gate + production wiring + `POLICY_VERSION` bump/replay tests |

---

# Detailed behavior scenarios

## Scenario S1 — known recent recovery, plenty of slack

History has exact recovery on Monday. On Tuesday-Friday, qualifying recovery is tier 2. Normal
higher-priority training roles may win. No readiness mode is fabricated.

## Scenario S2 — boundary day

History has exact recovery on Monday and no qualifying recovery Tuesday-Sunday. The next Monday is
`dueByDate`; recovery is tier 1 **before** ranking that Monday. Selecting non-recovery without an
explicit higher-authority blocker would be an ADR violation.

## Scenario S3 — unknown history with bootstrap

No authoritative recovery is known. Durable bootstrap is Monday `B`. `B` is not credited as Rest;
pre-`B` history is excluded. The first enforceable window is Tuesday through the following Monday
(`B + 1 ... B + 7`), and the following Monday is tier 1 before selection if no real qualifying
recovery occurred. Daily recomputation continues to use the same `B`.

## Scenario S4 — plan-less athlete

No event/plan exists. `CoverageState` may remain empty for authored weekly roles, while
`RecoveryPlacementState` uses Evergreen/general exact recovery authority. A due recovery candidate
can therefore rank tier 1 without a fake `activeBlockId`.

## Scenario S5 — authored recovery coverage

An active plan already contains `recovery_or_rest`. The policy uses the active authored descriptor
as identity authority and does not add a second baseline requirement. Deadline diagnostics still
expose ADR-0038 placement state.

## Scenario S6 — generated Rest yesterday, history not reconciled

Yesterday's audit says canonical Rest, but occurrence/provider reconciliation is incomplete. Today's
historical recovery state is `unknown`; the engine does not award completed Rest merely because no
activity is visible yet.

## Scenario S7 — generated Rest reconciled cleanly

Yesterday's audit says canonical Rest and post-day canonical reconciliation is authoritative with no
contradictory performed occurrence. A recovery-day outcome fact is emitted and becomes the latest
qualifying recovery date.

## Scenario S8 — generated Rest contradicted by training

Yesterday's audit says Rest, but canonical performed training exists. The generated Rest does not
become historical recovery.

## Scenario S9 — authored Rest override

ADR-0035 directive resolves to the date. Base `ExternalRestProvenance` remains the audit/replay
identity, while the decision-time extension reports `overridden: true`. No authored recovery credit
is emitted; actual performed/reconciled outcome decides history.

## Scenario S10 — due recovery conflicts with last feasible required role

Athlete is train/modify tier. Recovery is due and is the only accepted ranked recovery candidate,
but consuming today would reduce the achievable ADR-0018 required-role count. D-SUPPORT runs despite
`ranked.length === 1`; recovery is deferred/rejected with a typed reason and the required role is
preserved.

## Scenario S11 — hard availability blocks recovery

Recovery is overdue but no qualifying recovery identity fits a hard availability/equipment/safety
constraint. The engine does not force an invalid session. It emits a deadline miss/defer diagnostic
that names the hard blocker.

## Scenario S12 — activation gate

Staged simulation satisfies exact-identity rolling windows and corpus review is clean. Only then does
the final PR connect the live composition seam and bump `POLICY_VERSION`; the same deterministic
checks are re-run against that production wiring.

---

# Rollout and review checklist

Before declaring ADR-0038 implemented:

- [ ] ADR-0038 is Accepted, or owner explicitly authorizes implementation while Proposed.
- [ ] Bootstrap semantics (`B + 7`, `B` not recovery, pre-`B` prefix excluded) are aligned with the
      accepted ADR wording.
- [ ] No runtime path fabricates an authored plan/block for baseline recovery.
- [ ] Exact identity set is complete and descriptor differences are deliberate.
- [ ] Recovery deadline is not `WeeklyCoverageRequirement.windowEnd`.
- [ ] Bootstrap date is durable and cannot slide.
- [ ] Performed recovery retains canonical `workoutId` + replayable qualification authority.
- [ ] Projected Rest cannot leak into historical completed recovery.
- [ ] Missing telemetry alone cannot create Rest.
- [ ] Canonical ADR-0035 `ExternalRestProvenance` is preserved end-to-end; override extension is not
      confused with a second persisted identity.
- [ ] Authored-rest contradiction semantics are explicitly decided.
- [ ] `recovery_or_rest` remains absent from allocator reservations.
- [ ] Single-candidate D-SUPPORT test passes.
- [ ] Recovery deadline diagnostics are typed and replay/audit safe.
- [ ] Knowledge claim + inventory + alignment tests exist before activation.
- [ ] Production behavior remains unchanged through PR C; no early `POLICY_VERSION` bump.
- [ ] RP4 simulation invariant uses exact identity and every seven-date window after bootstrap.
- [ ] RP4 corpus/plan-judge deltas are reviewed and classified before activation.
- [ ] `POLICY_VERSION` is bumped only with the final live composition switch in RP5B.
- [ ] `npm run check` passes in the activation PR.
- [ ] `npm run simulate:scenarios` passes with reviewed plan deltas.
- [ ] `npm run simulate:plan-judge` invariants pass.
- [ ] Relevant persona/general judge deltas are inspected; baselines are updated only after semantic
      review.
- [ ] PR #453-related non-recovery expectation changes are not mislabeled as ADR-0038 fixes.

---

## Definition of done

ADR-0038 is done only when a live recommendation can explain, with replayable provenance:

> which recovery authority applied, what exact prior recovery facts were trusted, when recovery was
> due, whether urgency escalated, which exact identity satisfied it (or why none could), and why the
> choice did not violate a higher-authority safety/availability/readiness/weekly-role constraint.

The implementation is not done merely because the staged ranking path exists. It is done only after
that path satisfies the deterministic rolling-window/corpus proof and the final activation boundary
records the new live policy version.

A plan that merely happens to contain a Rest/Mobility day is not sufficient proof.
