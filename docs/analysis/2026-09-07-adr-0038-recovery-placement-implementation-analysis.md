# ADR-0038 recovery placement implementation analysis — 2026-09-07

## Status and scope

This is a point-in-time implementation analysis for
[ADR-0038](../adr/0038-engine-generated-recovery-placement.md), reviewed against the head of
PR #455 (`45f5652e96571874d3be900cf3aa42455b902e41`). PR #455 is itself stacked on PR #453,
which corrects effective-dose projection.

This document answers **what is true in the code today and where ADR-0038 must connect**. It
is not an architecture decision and does not change runtime behavior. ADR-0038 remains
`Proposed`; the companion plan in `docs/plans/adr-0038-recovery-placement.md` is therefore
`Draft` until that ADR is accepted.

The audit traced the current coverage, optimizer, planner, performed-training, external-rest,
weekly-allocation, simulation, knowledge-lineage and policy-version seams. Repository code and
accepted ADRs are treated as authority. Where this document recommends a future shape, that is
explicitly labelled as a recommendation rather than current behavior.

## Executive findings

1. **A plan-independent recovery requirement cannot be implemented by inserting one more
   `WeeklyCoverageRequirement` into the current plan-less state.** `buildCoverageState()` returns
   `phase: null`, `coverageSetId: null`, `descriptor: null` without an active plan, and candidate
   coverage classification depends on a non-null phase/descriptor to resolve exact identity.
2. **The existing seven-day coverage counter is not a placement deadline.** Because history is
   evaluated before the candidate date, a recovery on `R` can still satisfy the trailing counter
   while the engine is choosing on `R + 7`; selecting training that day would then create seven
   consecutive recovery-free dates. ADR-0038 needs a separate `dueByDate` signal.
3. **Bootstrap must be a first deadline reference, not a moving history placeholder.** When no
   qualifying recovery is known, a durable `bootstrapDate` acts as the initial deadline reference:
   `dueByDate = bootstrapDate + 7 local calendar days`. The bootstrap date is not itself recovery
   credit. The pre-bootstrap unknown prefix is excluded from the rolling invariant, and the first
   enforceable seven-date window is `bootstrapDate + 1 ... bootstrapDate + 7`.
4. **Recovery identity is inconsistent across descriptors.** The active catalog contains mobility,
   breathwork and cycling-recovery workouts, but Evergreen currently recognizes only
   `recovery_mobility_tissue_01` and `rest_complete_01` for `recovery_or_rest`. The event descriptor
   recognizes mobility, cycling recovery spin and Rest, but not breathwork.
5. **Performed-training facts cannot honestly represent a completed full Rest day.** Their source
   model starts from `PerformedTrainingOccurrence`; deliberate non-training needs a separate
   positive day-outcome/recovery fact rather than a fake occurrence or inference from absent
   telemetry.
6. **Performed recovery facts must retain canonical workout identity.** The current canonical fact
   path already produces `workoutId` for exact coverage credit. A recovery-specific historical fact
   that stores only `performedOccurrenceId` is not replay-self-contained enough to prove exact
   `recovery_or_rest` qualification if later lookup is unavailable or mappings change. Persist the
   canonical `workoutId` and the qualification authority used to validate it; do not require a
   reverse-derived template id because multiple engine templates may intentionally map to one
   workout.
7. **ADR-0035 already provides strong authored-rest identity and should be reused.** The canonical
   persisted/audit contract is `ExternalRestProvenance`; `ExternalRestDecisionProvenance` is the
   override-aware extension (`ExternalRestProvenance & { overridden?: true }`). A generic
   coverage-credit source enum is too weak to preserve that identity.
8. **The forecast D-SUPPORT guard has a real single-candidate hole.** The greedy forecast applies
   allocation viability only when `ranked.length > 1`. An escalated recovery candidate that is the
   sole accepted candidate can therefore skip the viability proof ADR-0038 requires.
9. **The current simulation recovery metric does not prove ADR-0038.** `restOrRecoveryDayCount`
   counts by broad category (`Rest` or `Mobility/Recovery`), while ADR-0038 requires exact mapped
   identity in every complete seven-local-date window. It also does not report maximum
   non-recovery streak.
10. **Simulation completion semantics are intentionally stronger than live evidence semantics.**
    `toCompletedExposure()` converts a simulated selected day into a completed exposure, which is a
    valid assumed-adherence simulation device but must not be copied into the live historical-Rest
    path.
11. **Knowledge-governance infrastructure already supports the required epistemic distinction.**
    The Sports Knowledge Registry supports `heuristic`, `not_applicable`, and `product_policy`, and
    already contains the scientific boundary claim `recovery.training.stress_recovery_balance`.
    ADR-0038 should add an explicit product-policy claim rather than reinterpret that scientific
    claim as a one-in-seven physiological rule.

## 1. Current runtime flow

### 1.1 Coverage is plan/block scoped

`app/src/engine/coverage.ts` currently owns exact weekly-role coverage. The key state shape is
`CoverageState`, whose identity context is a plan phase plus coverage-set descriptor. On a valid
active plan block, `buildCoverageState()`:

- derives the active block and descriptor;
- creates requirements from active plan objectives;
- synthesizes one required `recovery_or_rest` requirement when the active descriptor says that key
  is required and the plan did not already author it;
- counts exact canonical or fallback coverage history inside the trailing window;
- exposes the state to `coverageNeedTierForTemplate()`.

Without a plan, active block or descriptor it returns an empty state with null identity context.
That behavior is correct for **authored weekly-role coverage**. It is the reason ADR-0038 should not
pretend that product-policy recovery is an authored plan block.

### 1.2 Candidate coverage need is identity-driven

`coverageNeedTierForTemplate()` resolves a template's coverage keys through the state's descriptor
and phase. The current tier semantics are:

- tier 0 for nominated/date-authoritative hard roles or hard repair where applicable;
- tier 1 for immediately fillable non-deferred minimums;
- tier 2 for anchor-timed/deferred support minimums and unmet targets;
- tier 3 when the candidate does not advance explicit coverage.

`recovery_or_rest` is deliberately a deferred-support key, so under existing authored coverage it
stays tier 2. ADR-0038 adds a **deadline escalation to tier 1**, but never tier 0.

The important implementation consequence is that plan-independent recovery needs its own
identity-bearing state. A null descriptor cannot classify an otherwise valid recovery candidate.

### 1.3 Plan-less optimizer fallback cannot create that authority today

`buildOptimizationContext()` falls back to:

```ts
buildCoverageState(
  resolvePlanDefinitionForEvent(focusEvent, options.authoredPlanBlocks),
  date,
  coverageHistory,
)
```

`resolvePlanDefinitionForEvent()` returns a plan only for a cycling event. Although
`buildEvergreenPlanDefinition()` exists, it requires resolved strategy/capacity/packed-budget
inputs and is not the fallback used by optimizer ranking.

The planner also supplies an explicit coverage state only when it already has a plan definition.
Therefore the plan-less path is structurally incapable of promoting a recovery candidate today.

**Conclusion:** do not solve ADR-0038 by manufacturing an Evergreen `PlanDefinition` solely to make
coverage ranking work. That would imply authored plan/block authority that does not exist and could
accidentally introduce Evergreen aerobic/strength requirements. Use Evergreen only as the
**recovery exact-identity descriptor** for product-policy fallback.

## 2. Deadline and bootstrap semantics are separate from coverage counters

`buildCoverageState()` uses an `asOfDate`-exclusive history interval. With a seven-day rolling
window, the preceding seven dates are eligible history while the engine is ranking the current
candidate date.

Consider a qualifying recovery on date `R`:

- on `R + 6`, the recovery is still inside the prior-history window;
- on `R + 7`, the same recovery can still be visible to an `asOfDate`-exclusive historical
  minimum check before today's candidate is selected;
- if the engine then selects non-recovery work on `R + 7`, the seven dates `R + 1 ... R + 7`
  contain no recovery.

So `minimumSessions`, `fulfilledSessions`, `rollingWindowDays` and the current
`WeeklyCoverageRequirement.windowEnd` cannot by themselves encode ADR-0038's placement boundary.
The latter is also a plan/block boundary, not a recovery deadline.

### 2.1 Known recovery reference

For the latest qualifying historical or current-forecast projected recovery on local date `R`:

```text
referenceDate = R
dueByDate = R + 7 local calendar days
```

On `dueByDate`, urgency must already be tier 1 before ranking.

### 2.2 Unknown-history bootstrap contract

When `latestQualifyingRecoveryDate` is unknown but a stable `bootstrapDate` exists:

```text
referenceDate = bootstrapDate
dueByDate = bootstrapDate + 7 local calendar days
```

The bootstrap date is a **deadline reference only**. It must not be emitted as a recovery fact or
counted as a qualifying exposure.

Boundary semantics are explicit:

- the unknown prefix before `bootstrapDate` is outside the enforceable rolling invariant;
- the bootstrap date itself is the policy-enrollment/reference boundary, not a synthetic Rest day;
- the first complete enforceable seven-date window is
  `bootstrapDate + 1 ... bootstrapDate + 7`;
- on `bootstrapDate + 7`, a qualifying recovery is tier 1 before candidate selection if no real
  qualifying recovery has appeared since bootstrap;
- a real qualifying recovery before that boundary replaces bootstrap as the reference and moves the
  next deadline to `realRecoveryDate + 7`;
- recomputing tomorrow must reuse the same durable bootstrap date; using each new `asOfDate` would
  postpone the first deadline indefinitely.

This is the implementation contract implied by ADR-0038's stable-bootstrap requirement. If the ADR
decider wants a different grace-window interpretation, the ADR itself should be amended before
activation rather than allowing implementations to choose different boundaries.

## 3. Exact recovery identity audit

### 3.1 Catalog truth

`app/src/workouts/catalog/recovery.ts` contains active recovery workouts including:

- `recovery_mobility_tissue_01`;
- `recovery_breathwork_01`.

The broader catalog also exposes `cycling_recovery_spin_01` and canonical Rest.

### 3.2 Coverage descriptor truth

`app/src/workouts/event-plan.ts` currently maps:

**September cycling event `recovery_or_rest`:**

- `recovery_mobility_tissue_01`;
- `cycling_recovery_spin_01`;
- `rest_complete_01`.

**Evergreen `recovery_or_rest`:**

- `recovery_mobility_tissue_01`;
- `rest_complete_01`.

This produces two concrete gaps against ADR-0038's baseline product-policy minimum identity set:

- Evergreen omits `recovery_breathwork_01`;
- Evergreen omits `cycling_recovery_spin_01`.

There is also a cross-descriptor question: the event descriptor omits breathwork even though it is
an active recovery identity. ADR-0038 requires descriptor differences to be intentional and tested.
The implementation should either add breathwork to event `recovery_or_rest` as well or document a
specific reason for excluding it; it should not leave the discrepancy accidental.

The event descriptor's separate `recovery_spin` key is not a conflict. The workout can serve a
recovery role while remaining excluded from `aerobic_volume`; ledgers are intentionally independent.

## 4. Historical truth needs a recovery-day fact boundary

### 4.1 Performed active recovery is already representable

`app/src/engine/performedTrainingFacts.ts` derives exact coverage credit when a canonical performed
occurrence carries an exact workout identity found in the active descriptor. That is the correct
path for a performed mobility, breathwork or recovery-spin session once mappings are complete.

It deliberately does not fabricate role credit from generic modality alone. That matches ADR-0038.

The current fact model is also important for future persistence: `CoverageCreditFact` carries the
canonical `workoutId`, and `PerformedExposureFact` carries `performedOccurrenceId` plus exact
workout/template identity when proven. `templateIdForWorkoutId()` intentionally refuses ambiguous
reverse inference when more than one engine template maps to one workout.

Therefore recovery qualification should use canonical `workoutId` as the required replay identity.
A template id may be copied only when it was directly authoritative or unambiguous; it must not be
fabricated to make the recovery fact look more specific.

### 4.2 Complete Rest is not performed training

A full Rest day is the deliberate absence of a training occurrence. Encoding it as a
`PerformedTrainingOccurrence` would corrupt the meaning of that canonical domain and make later
spacing/adherence logic treat non-training as training.

Likewise, `CoverageCreditSource = 'completed' | 'projected' | 'fixed_activity'` cannot preserve why
a Rest date is trustworthy. It cannot distinguish:

- an exact performed active-recovery occurrence;
- an authored external-plan rest directive;
- an engine-generated Rest recommendation that was later reconciled;
- unknown history.

**Recommendation:** introduce a small recovery-specific fact boundary, for example a
`RecoveryPlacementFact` / `RecoveryDayOutcomeFact`, rather than widening performed-training truth.
The exact name is implementation detail; the semantic separation is not.

A useful source union would preserve identity rather than reducing everything to `completed`:

```ts
type RecoveryFactSource =
  | {
      kind: 'performed_recovery';
      performedOccurrenceId: string;
      workoutId: string;
      qualification: {
        coverageSetId: CoverageSetId;
        phase: PlanPhase;
        coverageKey: 'recovery_or_rest';
      };
      templateId?: string; // metadata only when directly authoritative/unambiguous
    }
  | {
      kind: 'authored_rest';
      planId: string;
      revision: number;
      contentHash: string;
      restDirectiveId: string;
      resolvedDate: string;
      overridden?: true;
    }
  | {
      kind: 'engine_rest_day_outcome';
      recommendationAuditId: string;
      policyVersion: string;
      reconciliationRevision: string;
    };
```

The fields above are a recommended domain shape, not current repository types. Existing persisted
identifiers should be reused where available rather than duplicated under new names.

For `performed_recovery`, replay/validation must prove that the persisted `workoutId` belongs to
`recovery_or_rest` under the recorded qualification authority. A future implementation may instead
reference an immutable canonical-fact snapshot that already guarantees those fields, but an opaque
occurrence id plus a mutable lookup is insufficient by itself.

### 4.3 Generated Rest requires positive closure, not missing telemetry

Within one week-ahead forecast, a selected Rest can be counted as `projected`; this is necessary so
later forecast dates sequence coherently.

Across daily recomputation, yesterday's recommendation is only intent. A historical Rest fact
should require:

1. a persisted recommendation/audit proving that canonical Rest was actually the selected planning
   outcome for that local date;
2. a post-day canonical occurrence reconciliation state that is **authoritative/complete enough**
   to say whether contradictory performed training occurred;
3. no contradictory performed occurrence replacing the Rest recommendation.

An absent provider activity by itself is not item 2. If reconciliation completeness is unknown,
historical recovery state remains `unknown` and no completed Rest credit is minted.

This is the most important data-trust boundary in the implementation. It should be expressed by a
pure reconciliation function fed explicit facts, not by asking the optimizer to infer absence.

## 5. ADR-0035 authored Rest is reusable provenance

`app/src/engine/models.ts` defines `ExternalRestProvenance` as the persisted/audit identity for an
authored rest directive: plan id, revision, immutable content hash, `restDirectiveId`, and resolved
date. `Recommendation.decisionTrace.externalRest` and the persisted audit use that base contract.

`app/src/engine/externalRestProvenance.ts` defines:

```ts
type ExternalRestDecisionProvenance = ExternalRestProvenance & {
  overridden?: true;
};
```

That is not a competing persisted identity. It is the decision-time extension used to express the
ADR-0035 explicit athlete override while retaining all base replay fields.

The ADR-0038 authored-rest bridge should therefore:

1. treat `ExternalRestProvenance` as the canonical persisted/replay source identity;
2. consume `ExternalRestDecisionProvenance` (or an equivalent adapter) where override adjudication
   is available;
3. validate the base provenance with the existing replay path before minting recovery credit;
4. suppress recovery credit when the extension reports `overridden: true`;
5. never translate authored Rest into a fake workout or generic `completed` coverage source.

One edge remains deliberately unresolved by ADR-0038: it explicitly says an athlete override
removes authored-rest credit, but does not define what to do if the athlete ignores an authored Rest
without using the explicit override path and a canonical performed occurrence later appears on that
date. The implementation must not invent that policy silently. Resolve this during the historical-
fact work package; the safest candidate is to treat contradictory performed training as
non-fulfillment, but that requires ADR/owner confirmation because authored Rest is plan intent, not
an adherence fact.

## 6. D-SUPPORT has a concrete single-candidate bypass

ADR-0018 deliberately filters `recovery_or_rest` from `deriveRequiredRoleOccurrences()`. That is
correct and should remain unchanged: recovery is not a reserved weekly role.

The forecast planner instead protects discretionary selections with `preservesAllocation()`. It
first replays incumbent reservations through `allocationSurvives()` and, if necessary, runs the
bounded reservation search again.

The current guard is:

```ts
const viabilityApplies = !reservation
    && fatigueTier !== 'recover'
    && allocation.fulfilledCount > 0
    && ranked.length > 1;
```

The `ranked.length > 1` shortcut means a single accepted candidate bypasses D-SUPPORT entirely. For
normal ranking this may have been an optimization, but it violates ADR-0038's explicit acceptance
case: a due recovery candidate cannot consume the last feasible required-role opportunity merely
because it is the only ranked candidate.

**Recommended correction:** make viability depend on whether the tentative discretionary pick can
affect a live allocation, not on how many candidates survived. A sole candidate may still need to
be rejected/deferred with a typed recovery diagnostic if preserving required-role feasibility is
possible only by not consuming that date.

Do not apply this viability rule in readiness `recover` mode if existing hard-recovery semantics
intentionally dominate allocator goals; ADR-0038's D-SUPPORT statement is specifically about an
escalated recovery selection on train/modify-tier dates.

## 7. Simulation currently measures a different property

`ScenarioResult.restOrRecoveryDayCount` is incremented when category is `Rest` or
`Mobility/Recovery`. That is broader than ADR-0038 exact-identity credit and says nothing about
placement. A 28-day scenario with one recovery on day 1 passes `> 0` while violating every later
seven-day window.

The implementation needs a policy-aware derived metric:

- qualifying recovery dates by exact workout identity under the applicable recovery authority;
- maximum consecutive non-recovery dates after authoritative bootstrap;
- every complete seven-local-date window after bootstrap contains at least one qualifying recovery;
- the pre-bootstrap unknown-history prefix is reported/excluded rather than silently counted as
  failure or success;
- the bootstrap date itself is not counted as a recovery exposure.

Keep `restOrRecoveryDayCount` as a coarse descriptive metric if useful, but it must not be the ADR
invariant.

### Simulation/live semantic boundary

`toCompletedExposure()` converts a simulated `WeekAheadDay` into a completed exposure. The scenario
harness therefore assumes adherence to the simulated selection when it rolls into later weeks. That
is a valid simulation convention and useful for deterministic multi-week tests.

It is **not** evidence that live code may convert yesterday's recommendation into a completed Rest.
Live historical Rest still requires the positive day-outcome/reconciliation path described above.
Tests should name this difference explicitly so a future refactor does not make simulation
convenience the production truth model.

## 8. Knowledge and policy governance are ready for this policy

`app/src/knowledge/sportsKnowledge.ts` already supports:

- `claimType: 'heuristic'`;
- `evidenceCertainty: 'not_applicable'`;
- `sourceType: 'product_policy'`.

It also contains the active scientific claim
`recovery.training.stress_recovery_balance`, whose limitations explicitly reject universal fixed
recovery windows. That is the correct scientific boundary.

ADR-0038 requires a separate product-policy claim
`policy.load_recovery.weekly_recovery_placement_v1` with source `PRODUCT-EVERGREEN-DOSE-V1`, plus
inventory/alignment coverage. The existing `knowledgeCoverage.ts` domains already include both
`readiness_recovery` and `session_spacing`.

`app/src/engine/policy.ts` currently identifies live decision behavior as
`2026-09-h4-intraday-reassessment-v1`. The ADR-0038 activation boundary must bump `POLICY_VERSION`
and move the superseded version into the historical list according to the existing convention.

No policy-version bump belongs in this documentation PR, and no future implementation PR should
bump the version before the deterministic simulation invariant and corpus review required for
activation have passed.

## 9. Recommended architecture

The lowest-risk design is a **recovery-specific state/fact layer composed into the existing
coverage ranking key**, rather than broadening authored coverage or allocator semantics.

### 9.1 Recovery placement state

Recommended conceptual shape:

```ts
interface RecoveryPlacementState {
  asOfDate: string;
  policyId: 'weekly_recovery_placement_v1';
  authority: 'product_policy' | 'authored_coverage';
  coverageSetId: CoverageSetId;
  phase: PlanPhase;
  historyState: 'known' | 'unknown';
  latestQualifyingRecoveryDate: string | null;
  bootstrapDate: string | null;
  deadlineReference: {
    kind: 'qualifying_recovery' | 'bootstrap';
    date: string;
  } | null;
  dueByDate: string | null;
  overdue: boolean;
  fulfilledHistorical: boolean;
  projectedRecoveryDates: string[];
}
```

This is an architectural recommendation, not a required literal TypeScript interface. The required
properties are the semantics from ADR-0038. `deadlineReference` is recommended because it prevents
callers from mistaking `bootstrapDate` for a completed recovery fact.

Authority resolution should be:

1. if active authored coverage already contains `recovery_or_rest`, use that descriptor/phase as
   exact-identity authority and do not duplicate a baseline requirement;
2. otherwise use `EVERGREEN_GENERAL_COVERAGE_SET` + `general` **for recovery identity only**;
3. never synthesize `activeBlockId`, plan id or unrelated Evergreen role requirements.

### 9.2 Candidate tier composition

Keep one lexicographic coverage-need key in optimizer ranking:

```text
finalCoverageNeedTier = min(
  existingAuthoredCoverageTier,
  adr0038RecoveryPlacementTier
)
```

where the recovery-policy helper returns:

- `3` for non-qualifying identities;
- `2` for qualifying recovery with deadline slack;
- `1` on `dueByDate` or overdue;
- never `0`.

This lets ADR-0016/0018 continue owning the sort axis while preventing recovery policy from
masquerading as a hard authored anchor.

### 9.3 History composition

Build recovery history from explicit source facts:

- canonical exact performed recovery occurrences with persisted `workoutId` and qualification
  authority;
- ADR-0035 authored-rest facts with canonical `ExternalRestProvenance` and override adjudication;
- reconciled engine-Rest day-outcome facts;
- projected selections only inside the current forecast.

Dedupe by source identity/date semantics explicitly. Do not reuse performed-occurrence ids for
non-training days.

### 9.4 Bootstrap source

The pure policy resolver should receive a stable `bootstrapDate`/epoch as input. The composition
layer must source it durably; it must not default to the current `asOfDate` on every invocation.
Candidate durable sources include a persisted policy-enrollment/first-evaluation date or an existing
account/history boundary if that boundary is already authoritative for this purpose.

When no qualifying recovery is known, `bootstrapDate` is the deadline reference and
`dueByDate = bootstrapDate + 7`. It is not a qualifying recovery fact. The pre-bootstrap unknown
prefix is excluded, and the first enforced seven-date window is the seven dates strictly after the
bootstrap boundary.

The exact storage owner should be selected during the history/provenance implementation slice after
tracing existing user/audit persistence. The invariant is more important than the storage location:
**the same athlete and same historical state must not acquire a later bootstrap deadline just
because the planner was recomputed tomorrow.**

## 10. Expected code seams

| Area | Current seam | Expected ADR-0038 work |
| --- | --- | --- |
| Policy state | `engine/coverage.ts` | Prefer new recovery-placement state/helper; compose with coverage rather than fabricate plan state |
| Exact identity | `workouts/event-plan.ts`, catalog mappings | Complete Evergreen mappings; resolve/document event breathwork consistency |
| Performed recovery | `engine/performedTrainingFacts.ts` | Reuse exact `workoutId`; persist qualification authority for recovery facts |
| Authored Rest | `engine/externalRestProvenance.ts`, ADR-0035 resolution | Treat `ExternalRestProvenance` as canonical persisted identity; use override-aware adapter without fake occurrence |
| Engine Rest history | recommendation/audit + canonical occurrence reconciliation | Add positive day-outcome fact/reconciliation boundary |
| Ranking | `engine/optimizer.ts`, `engine/planner.ts` | Compose recovery tier 2/1 into existing coverage tier |
| Allocation viability | `engine/planner.ts`, `engine/weeklyAllocation.ts` | Remove single-candidate bypass for applicable train/modify discretionary picks; do not reserve recovery |
| Diagnostics | recommendation/planner decision trace | Add typed recovery authority/deadline/rejection fields |
| Simulation | `engine/simulation/analyze.ts` | Exact-identity rolling invariant + max non-recovery streak + bootstrap-prefix semantics |
| Knowledge | `knowledge/sportsKnowledge.ts`, `knowledgeCoverage.ts`, alignment tests | Register heuristic policy and bind code scalar/identity/escalation |
| Replay/version | `engine/policy.ts` and audit/replay tests | Bump policy version only at reviewed live activation after simulation proof |

File names for a new recovery module/fact type are intentionally not mandated here; the plan may
choose the smallest cohesive module after implementation begins.

## 11. Test matrix implied by the audit

The implementation should prove at least these layers independently.

### Pure policy tests

- latest recovery `R` => `dueByDate = R + 7`;
- no known recovery + bootstrap `B` => `dueByDate = B + 7`;
- bootstrap date is not emitted/counted as recovery;
- first enforceable window is `B + 1 ... B + 7` and pre-bootstrap history is excluded;
- due day is tier 1 before candidate selection;
- slack days are tier 2;
- overdue remains tier 1, never tier 0;
- unknown history is distinct from known unmet history;
- a real recovery before the bootstrap deadline becomes the next deadline reference;
- stable bootstrap does not move across repeated recomputation.

### Identity tests

- mapped Rest, mobility, breathwork and cycling recovery spin qualify;
- category-only/unmapped recovery-looking templates do not qualify;
- cycling recovery spin does not gain `aerobic_volume`;
- event/evergreen differences are intentional and snapshot/alignment tested.

### Historical truth tests

- exact performed active recovery qualifies with canonical `workoutId` retained;
- replay rejects/does not credit a performed recovery whose stored identity cannot be validated
  under its recorded qualification authority;
- projected Rest qualifies only within current forecast;
- recommendation alone does not create historical Rest;
- authoritative reconciled Rest outcome does;
- contradictory performed training suppresses generated-Rest credit;
- incomplete reconciliation yields `unknown`, not Rest;
- authored Rest carries exact ADR-0035 `ExternalRestProvenance`;
- override-aware provenance suppresses authored-rest credit without changing base replay identity.

### Planner/allocation tests

- plan-less recovery actually gets tier 2/1 using Evergreen recovery authority;
- no synthetic authored plan/block appears in trace;
- single accepted escalated-recovery candidate still runs D-SUPPORT on train/modify tier;
- recovery remains absent from `RequiredRoleOccurrence` and D-MISS;
- safety/readiness/availability hard gates remain dominant.

### Simulation/end-to-end tests

- every complete seven-date window after bootstrap contains exact qualifying recovery;
- bootstrap date itself does not satisfy the first window;
- maximum non-recovery streak <= 6 when no higher-priority hard constraint prevents it;
- prevented/deferred deadline is reported rather than hidden;
- existing scenario corpus and judge artifacts are re-run before activation, with expectation changes
  reviewed individually rather than bulk re-baselined.

## 12. Risks and decisions to close before activation

### R1 — Authored-rest adherence contradiction

ADR-0035 models authored intent and explicit override. ADR-0038 should decide whether a later
canonical performed occurrence on an authored-rest date, without an explicit app override, also
suppresses recovery credit. Do not guess at runtime.

### R2 — History completeness signal

The engine needs a trustworthy distinction between `known no recovery` and `unknown`. If canonical
occurrence reconciliation cannot currently declare a date complete, add that state before granting
engine-generated historical Rest.

### R3 — Intraday aggregation

ADR-0038 explicitly defers ADR-0036 day-level aggregation. Do not let a Rest/recovery item in one
window mark a date as recovery if another hard training occurrence happened in another window until
a day-level rule is accepted.

### R4 — Soft deadline versus hard constraints

A missed product-policy deadline must be observable but must not bypass clinical, injury,
availability, equipment or readiness constraints. Tests must cover “deadline missed because no
admissible recovery identity exists” as a legitimate diagnostic state, not force an invalid pick.

### R5 — Evaluation/activation ordering

Knowledge registration and ranking plumbing can be prepared before live activation, but the policy
must not become the default live decision path or bump `POLICY_VERSION` until deterministic rolling-
window simulation, miss/defer diagnostics and corpus review are complete. This avoids declaring a
new replay policy version before the acceptance invariant that motivates the ADR has been proven.

### R6 — Bootstrap policy ownership

The concrete `bootstrapDate + 7` grace-window interpretation closes an ambiguity necessary for a
deterministic implementation. Because it is behavior-bearing, ADR #455 should be kept aligned with
this interpretation before ADR-0038 is accepted. If the owner chooses a different bootstrap window,
change the ADR and this plan together before runtime activation.

### R7 — Evaluation drift

PR #453 changes effective projected dose and ADR-0038 will deliberately change recovery placement.
Judge/simulation deltas should therefore be interpreted with deterministic recovery diagnostics,
not by preserving old snapshots at all costs.

## Evidence boundary check

The repository's ADR framing remains appropriate. Current endurance-recovery evidence supports
individualized stress/recovery management and does not establish a universal one-rest-or-recovery-
exposure-per-seven-days physiological rule. The one-in-seven scalar should therefore remain a
registered product heuristic rather than be upgraded into a scientific claim. This implementation
analysis does not add a new evidence assertion beyond the ADR's existing evidence boundary.

## Conclusion

ADR-0038 fits the existing architecture if implemented as a **plan-independent recovery policy
state with exact identity and explicit deadline**, composed into the existing coverage-need ranking
axis. The dangerous shortcuts are also clear: a fake Evergreen plan, trailing-window-only deadline,
a sliding bootstrap, category-based credit, opaque performed-recovery provenance, “no activity
means Rest”, and skipping D-SUPPORT when only one recovery candidate survives.

The companion implementation plan converts these findings into ordered work packages and PR
cut-lines without activating behavior while ADR-0038 remains Proposed.
