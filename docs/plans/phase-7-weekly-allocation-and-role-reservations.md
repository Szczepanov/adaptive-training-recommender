# Phase 7A — Weekly allocation and safe role reservations

* **Status:** `Implemented`
* **Blocked by:** Baseline review remains blocked until this plan's acceptance criteria
  pass; PR #17's current semantic baseline remains unchanged.
* **Unlocks:** reviewed semantic-baseline acceptance for healthy/fresh cycling scenarios;
  explicit explanation of safety-forced weekly-role misses.
* **Decision:** [ADR-0018](../adr/0018-weekly-allocation-and-role-reservations.md)
* **Source analysis:** [2026-08-10 PR #17 semantic-baseline follow-up](../analysis/2026-08-10-pr17-semantic-baseline-follow-up.md)

## Goal

Guarantee that every eligible, authored minimum cycling role is allocated a safe forecast
opportunity before supporting work is chosen. When readiness or a hard constraint makes a
role impossible, preserve safety and record the miss instead of silently substituting
unrelated work.

## Preconditions

1. PR #17 is merged and its recovery-clear scenario remains green.
2. ADR-0018 is accepted. The allocator must not be implemented as an unreviewed ranking
   multiplier or a hidden beam-search cutover.
3. The existing event-plan coverage mapping remains the authority for role identity;
   `SEPTEMBER_CYCLING_EVENT_SESSION_COVERAGE` is not recalibrated in this increment.

## Verified current behaviour

`planner.ts` `generateWeekAheadPlan` applies today's and tomorrow's recommendations as
seeds and greedily ranks each later date. `resolveWeeklyAnchors` nominates a quality and
event-specific date, but `optimizer.ts` `rankCandidates` treats these as ordering signals.
`coverage.ts` `coverageNeedTierForTemplate` can prioritise an unmet role only after a date
is reached; it cannot reserve the date or protect a future one.

Consequently, `evaluateRecoveryConstraints` can exclude a later required cycling
candidate after supporting strength/work has been seeded into projected history. The
current recovery-specific fallback in `generateWeekAheadPlan` protects one escaped case,
but is intentionally narrow and cannot allocate all required roles. The PR #17 follow-up
observed this as three-of-four weekly event-specific/quality coverage in healthy and
fresh cycling scenarios despite available capacity.

## Work items

### 7A.1 `[x]` Define allocation inputs and outcomes

**Current:** `CoverageState` knows requirements and `WeekAheadPlan` reports only selected
days, objective credits, and dropped contributor objectives. Neither represents a
forecast role occurrence or a reason it could not be placed.

**Change:** add a pure `engine/weeklyAllocation.ts` domain module. Define:

* `RequiredRoleOccurrence`: immutable `id`, coverage-set id, coverage key, authored session
  identity, plan phase, active-plan-window start/end, zero-based occurrence ordinal, label,
  and exact eligible template/workout identities for one remaining *minimum* session.
  Derive its id by canonical serialization of `coverageSetId | windowStart | windowEnd |
  phase | coverageKey | authoredSessionIdentity | ordinal`; canonical-sort those fields
  before enumeration. `authoredSessionIdentity` is the stable coverage-record identity, not
  a selected candidate. The id is independent of candidate filtering and projected coverage.
  Deduplicate by this same identity, not by title/modality or selection order.
* `RoleReservation`: occurrence id, nullable nominated date, selected date/template or
  workout identity, and `wasMoved`. A single exact `PlanSessionCoverage` identity may
  reserve a bundled set of its explicitly granted role keys; no inferred or merely similar
  coverage can bundle roles, and separate identities are not artificially split.
* `WeeklyRoleAllocationOutcome`: mutually exclusive `reserved`, `fulfilled`, `missed`, or
  `unresolved_search_budget`, plus `wasMoved` annotation (not a terminal `moved` status).
  Valid lifecycle is unallocated -> reserved -> fulfilled/missed, unallocated -> missed,
  or reserved -> reserved after reallocation with `wasMoved: true`. A terminal miss has
  primary reason `no_exact_candidate`, `hard_safety_or_recovery`, `projected_fatigue`,
  `fixed_seed`, or `no_conflict_free_date`, with optional observed blockers. Budget
  exhaustion is never converted to a safety miss or free-text reason.
* `WeeklyRoleAllocationReport`, added to `planner.ts` `WeekAheadPlan`.

Derive occurrence count from `WeeklyCoverageRequirement.minimumSessions` minus exact,
deduplicated existing/projected coverage. Include only active authored minimum roles;
target-only roles remain ordinary optimizer benefit. `recovery_or_rest` is reported by the
normal coverage ledger but creates no training reservation. One candidate can satisfy only
the exact coverage keys already granted by `coverage.ts`; no modality/category inference
is introduced.

**Done when:** `weeklyAllocation.test.ts` proves that a two-session required role creates
two distinct deterministic occurrence ids, completed/projected occurrences reduce the
count idempotently without changing remaining ids, target-only/recovery-only requirements
do not reserve a training date, and the simulator/UI consume the same serialized outcome
rather than reconstructing status or reason.

### 7A.2 `[x]` Extract one projected-date evaluation seam

**Current:** `generateWeekAheadPlan` locally combines availability, phase eligibility,
reserved fixed-activity cost, fatigue-tier filtering, projected history, planned dose,
and `rankCandidates`. Copying that logic into an allocator would create a second policy
path and drift from hard-gate behaviour.

**Change:** extract a pure planner helper (for example `evaluateProjectedDate`) from
`planner.ts`. Given the projected state and a date, it returns the accepted/rejected
candidates, the effective fatigue tier, exact hard-exclusion reasons, coverage state, and
the next-state effect for a candidate. It must call `buildOptimizationContext` and
`rankCandidates`; it must retain the existing `PROJECTED_FATIGUE_*` filtering rather than
recreating those constants in `weeklyAllocation.ts`.

Use this helper in both the existing greedy loop and allocation feasibility checks. Apply
today/tomorrow seed exposure, fixed-activity stimulus/cost, and authored-plan blocks
before the first allocation is built.

**Done when:** existing `planner.test.ts` output is unchanged with allocation disabled,
and focused tests show the helper rejects the same candidate/reasons as
`rankCandidates` for time, equipment, injury, phase, intensity, spacing, anchor
protection, and recover/modify fatigue ceilings.

### 7A.3 `[x]` Reserve jointly feasible required occurrences deterministically

**Current:** `resolveWeeklyAnchors` can nominate two dates but does not allocate coverage
roles, account for multiple occurrences, or distinguish a nomination from a feasible
session.

**Change:** add `resolveWeeklyRoleReservations` in `weeklyAllocation.ts`. It is a bounded,
deterministic DFS/backtracking search over **minimum required role occurrences only**, not
over all utility-ranked workout sequences:

1. start with today's/tomorrow's immutable seed state;
2. choose the remaining occurrence with fewest accepted exact candidate assignments;
3. try date/template assignments in deterministic order, applying 7A.2's actual projected
   fatigue/history transition before recursing;
4. retain the jointly feasible solution that fulfils the most occurrences.

Its one `WeeklyAllocationSearchBudget` is: seven forecast dates, at most 14 occurrences,
four canonically ordered exact date/template candidates per occurrence, depth at most the
examined occurrence count, and 1,024 projected-state-transition nodes. Count a node before
the transition (including a rejection); sorting/root setup costs no nodes. Prune only when
current fulfilled plus remaining occurrences cannot beat the best known cardinality, and
retain equality for stable tie-breaks. If any cap is reached, return the deterministic
best-known jointly feasible partial allocation and mark all unproven remainders
`unresolved_search_budget`, never `missed`. A candidate list larger than the per-occurrence
cap itself triggers that status for unexamined alternatives. There is no wall-clock result
cut-off: p95 <=50 ms and p99 <=100 ms on the fixed live-sized fixture are performance gates,
not non-deterministic planning semantics.

When more than one jointly feasible solution has equal cardinality, use this stable order:

1. earliest active-plan-window end date;
2. fewest remaining feasible dates for the occurrence;
3. authored coverage key, then template id, then date.

This order is a deterministic allocation tie-break, not a coaching-benefit score. Only a
role exhausted within the declared search domain is recorded as missed with an observed
reason; a budget-truncated role is unresolved. Neither is converted to an arbitrary
template. Existing anchor dates are candidate preferences only: a reservation may use
another safe date and must report that move.

**Done when:** tests cover competing roles for one date, multiple occurrences of one role,
a role that must move off an anchor nomination, and a no-branch safety exclusion. A
regression proves two assignments individually feasible from the seed state but jointly
infeasible after the first state transition; the solver must not reserve both. All
reservations contain only exact eligible identities and never violate a hard gate. Cap
tests prove identical input yields the same best-known partial result and a typed unresolved
outcome; performance fixtures meet the p95/p99 gates.

### 7A.4 `[x]` Protect reservations while retaining greedy day selection

**Current:** a locally useful support candidate can remove the only later safe role
opportunity; the loop discovers that only after it has selected the support day.

**Change:** wire reservations into `generateWeekAheadPlan` without importing
`sequenceSearch.ts`:

* On a reserved date, rank only candidates that fulfil the reserved occurrence. If the
  dynamic state makes them unsafe, recompute the remaining matching and move the
  occurrence when possible.
* On an unreserved date, simulate each otherwise accepted supporting candidate **and
  discretionary Rest** through the shared helper and the same `WeeklyAllocationSearchBudget`.
  Exclude it when it reduces the maximum achievable stateful required-role reservation count,
  invalidates an earlier-deadline reservation, or exhausts budget before proving preservation.
  This is the ADR-0018 bounded viability check.
* If a role becomes impossible, select the normal safe fallback (including Rest-first in
  recover tier) and emit the typed miss. A true recover-tier Rest selection is not subject
  to viability veto: safety wins, remaining reservations are recomputed, and its loss is
  safety-attributed. Never force a session, lower a fatigue threshold, or choose
  Mobility/Recovery merely to reduce a miss count.
* Remove or generalise the narrow `beganAfterHardRaceSpecificExposure` fallback only when
  its escaped-case protection is subsumed by a dedicated allocation regression test.

**Done when:** a low-cost/full-body support candidate may be selected when another safe
quality/event-specific allocation remains, but is rejected when it would destroy the
last one; the same is true of discretionary Rest. A hard recovery ceiling produces a
safety-attributed `missed` outcome and Rest rather than an unsafe training pick.

### 7A.5 `[x]` Surface allocation evidence in simulator and week-ahead UI

**Current:** `simulation/analyze.ts` can report missed anchor nominations but cannot say
whether a required role was feasible, reserved, moved, fulfilled, or safety-forced out.

**Change:** carry `WeekAheadPlan.allocationReport` through `simulation/analyze.ts` into
per-week and aggregate scenario metrics. Add explicit warnings for an eligible required
role missed without a typed safety/feasibility reason. Update the week-ahead view in
`components/Home.tsx` to state a moved or missed required role and its reason; do not
present a forecast miss as completed training or a recommendation-audit event.

**Done when:** a deterministic fixture produces one moved and one safety-forced missed
role; report JSON/Markdown and the UI fixture expose the same occurrence ids/statuses.

### 7A.6 `[x]` Add acceptance regressions, review policy impact, and update documentation

**Current:** scenario tests measure objectives and anchor hits but not complete required
coverage allocation. The committed semantic baseline is deliberately unreviewed.

**Change:**

* Add focused unit tests in `weeklyAllocation.test.ts` and `planner.test.ts` for 7A.1–7A.4.
* Extend `simulation/scenarios.ts`, `scenarios.test.ts`, and
  `goldenWeek.test.ts` with role-allocation assertions. Normal and fresh cycling
  Build/Specificity windows must fulfil every *eligible* required authored role:
  sustained quality, event-specific cycling, true aerobic volume, and primary strength.
* Keep a persistently stressed counterpart: it may recover more and may miss a role only
  with a typed safety/feasibility outcome. Keep the recovery-clear scenario: its healthy
  week must regain train-tier days.
* Re-run the existing `>=48 h` key-cycling spacing, anchor-protection, injury/equipment,
  Firestore-emulator, and policy-version checks. `POLICY_VERSION` must bump because the
  forecast recommendation decision changes; add the preceding version to
  `HISTORICAL_POLICY_VERSIONS`.
* Update `docs/architecture/recommendation-engine.md` to replace the description of
  anchor-only weekly shaping with allocation/reservation behaviour. Update this plan,
  ADR-0018, and the simulation baseline only through the reviewed baseline workflow.

**Done when:** `npm run check`, `npm run test:rules`, `npm run simulate:scenarios`,
`npm run simulate:diff`, and `node scripts/check-policy-drift.mjs <base-sha>` pass. The
semantic baseline is updated only after the acceptance criteria below pass in review.

**Status:** completed. The focused allocation, scenario, policy-drift and Firestore-rule
suites passed; the reviewed workflow refreshed
`docs/analysis/simulation-baseline.json`. The baseline now includes PR #17's rest-first
movement and this increment's allocation correction.

## Acceptance criteria

- [x] Normal and fresh cycling Build/Specificity windows fulfil every eligible authored
  minimum role: sustained quality, event-specific cycling, true aerobic volume, and
  primary strength.
- [x] A fresh athlete never misses such a role solely because a discretionary support or
  discretionary Rest selection consumed its last safe opportunity.
- [x] A persistently stressed athlete may have more recovery than a healthy trajectory;
  any missed required role is explicit and safety/feasibility-attributed.
- [x] Acute stress followed by healthy readiness still regains projected train-tier days.
- [x] Modify-tier work remains observable where safe/productive; it is not created by
  lowering the recover threshold or by making rest share an objective.
- [x] No new spacing, anchor-protection, injury, equipment, phase, intensity, or
  emulator-rule violation is introduced.
- [x] Greedy remains the production path; ADR-0015's beam-search adoption status is
  unchanged.
- [x] Reviewed semantic-baseline acceptance.

## Task board

| Item | Status | Depends on | Done when |
|---|:---:|---|---|
| 7A.1 Allocation inputs and outcomes | `[x]` | ADR-0018 | Exact minimum-role occurrences and typed outcomes are unit-tested |
| 7A.2 Shared projected-date evaluation | `[x]` | 7A.1 | Allocation and greedy use the same hard-gate path |
| 7A.3 Stateful reservation search | `[x]` | 7A.1–7A.2 | Jointly feasible reservations preserve exact identities and report no-branch roles |
| 7A.4 Greedy reservation protection | `[x]` | 7A.2–7A.3 | Support cannot reduce viable required-role allocation |
| 7A.5 Simulator and UI evidence | `[x]` | 7A.1, 7A.4 | Moved/missed outcome is visible consistently |
| 7A.6 Regression, policy, and docs review | `[x]` | 7A.1–7A.5 | Acceptance suite and reviewed-baseline workflow pass |

## Risks and rollback

* **Latency:** The semantic node/depth/date/candidate caps above bound search; the fixed
  live-sized fixture must meet p95 <=50 ms and p99 <=100 ms. If it does not, cache pure
  date-evaluation/search inputs or reduce an explicitly reviewed cap; do not silently
  switch to beam search or wall-clock-dependent allocation.
* **Over-constrained plans:** Reservations apply only to minimum authored roles and only
  while an exact safe matching exists. If they crowd out legitimate support work, inspect
  the allocation report and adjust the authored coverage requirement in a separately
  reviewed change, not the safety gates.
* **Incorrect role identity:** Preserve ADR-0016's exact identity contract. Roll back the
  allocator if it grants coverage through category/title/modality inference.
* **Regression:** Revert the allocation wiring and policy bump together if a hard safety
  or golden-week contract fails. Do not edit the semantic baseline to hide the failure.

## Out of scope

* Adopting or deleting `sequenceSearch.ts`.
* Recalibrating `PROJECTED_FATIGUE_RECOVER_THRESHOLD`, Rest percentage, template cost, or
  coverage minima.
* Changing evergreen/non-event planning, which remains the separate
  [Phase 7B training-intent proposal](./phase-7-training-intent-and-planning-modes.md).
* Persisting forecast allocation outcomes as completed training or changing historical
  recommendation replay.
