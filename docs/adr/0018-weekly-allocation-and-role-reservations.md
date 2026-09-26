# ADR-0018: Weekly Allocation, Safe Role Reservations, and Explicit Misses

* **Status:** Accepted
* **Date:** 2026-08-10
* **Deciders:** Core Engineering Team / repository owner
* **Source analysis:** [PR #17 semantic-baseline follow-up](../analysis/2026-08-10-pr17-semantic-baseline-follow-up.md)

## Context

PR #17 established that recover-tier behaviour is not the semantic-baseline blocker.
Complete Rest must remain first in a true recover tier, persistently stressed athletes may
recover more than healthy athletes, and the recovery-clear scenario returns to train-tier
days. The remaining failure is that healthy and fresh cycling Build/Specificity windows
can leave a required authored role unfulfilled even while safe capacity remains.

`planner.ts` `generateWeekAheadPlan` is intentionally greedy. It receives today's and
tomorrow's selected recommendations as seeds, then chooses one later day at a time.
`resolveWeeklyAnchors` nominates dates, but nominations are ranking modifiers, not
reservations. A supporting session can therefore consume the spacing or projected
freshness required by a later event-specific or sustained-quality role. When a later
candidate is excluded by `evaluateRecoveryConstraints` or by the projected fatigue
ceiling, the planner selects Rest and the missed role is visible only indirectly through
coverage/simulation diagnostics.

ADR-0043 adds a rolling catalog-load envelope to this same feasibility path. Committed
fixed/overlay load can exhaust that envelope before a required role is considered; a
nominated anchor and the Extra Recovery Margin preference do not create capacity.

ADR-0015 measured a beam-search prototype and deliberately retained greedy production
planning. The follow-up finding identifies a coverage-allocation contract; it does not by
itself approve beam-search adoption or a global fatigue-threshold change.

## Decision

### D-RESERVE — allocate eligible required role occurrences before supporting work

For the forecast portion of a rolling week, the planner will derive one allocation request
per still-unfulfilled **minimum** coverage occurrence. It will allocate only the authored,
currently active coverage roles and their exact catalogue identities. Target-only coverage,
generic adaptation credit, display title, modality, and category do not create a
reservation. The occurrence source is ADR-0017's D-CAP packing mapping: a session may
bundle only the role keys granted together by one exact `PlanSessionCoverage` identity;
the allocator neither fabricates a bundle nor splits an authored bundle into fictitious
sessions.

The allocator chooses a deterministic, stateful, one-session-per-date reservation search.
Starting from immutable today/tomorrow seeds, it chooses the most constrained remaining
occurrence, tries exact candidate date/template assignments in stable order, applies the
real projected state transition, and recurses. It maximises fulfilled required occurrences;
deterministic ties use the requirement's deadline/date and stable role/template identifiers.
This proves that the selected reservation set is jointly feasible under fatigue, spacing,
anchor protection, and projected history rather than merely connecting individually
feasible date edges. `recovery_or_rest` remains satisfied by the existing coverage ledger
and recovery policy; it does not reserve a discretionary training date.

Today's and tomorrow's selected recommendations are immutable seeds, not candidates to
be rewritten. Their coverage and fatigue effects are applied before allocation. A seed may
leave a role impossible; it is reported, never retroactively changed.

### D-BOUND — reservation and viability search have one deterministic budget

The reservation horizon is the next seven local dates. A search examines at most 14
required occurrences (the current profile maximum), at most seven dates and four
exact date/template candidates per occurrence, and at most 1,024
state-transition nodes. Depth is bounded by the examined occurrence count. A node is
counted immediately before applying one candidate's projected-state transition, including
failed transitions; root construction and deterministic sorting do not consume a node.

The same `WeeklyAllocationSearchBudget` applies to every D-SUPPORT viability check. Search
prunes only a branch whose current fulfilled count plus remaining occurrence count cannot
exceed the best known count; equal-cardinality branches are pruned because stable traversal
order keeps the first such result.
Occurrences are ordered by deadline, coverage key, ordinal, and stable occurrence id;
search chooses the most constrained remaining occurrence first. For each occurrence, root
date/template candidates are sorted by date then template id. The cap retains the first
exact candidate on each date in that order, then fills remaining slots with same-date
alternatives in the same order. When more than four dates are eligible, only the first four
dates fit the cap. A candidate set larger than the four-per-occurrence cap leaves an
unplaced occurrence unresolved because its omitted candidates were not proved infeasible;
the planner must not call that occurrence infeasible.

On a node, depth, date/candidate, or occurrence cap, return the deterministic best jointly
feasible partial allocation found so far and mark each unproven remainder
`unresolved_search_budget`. It is neither a safety-forced `missed` occurrence nor evidence
that no feasible assignment exists. A supporting candidate is not admitted when its
viability check exhausts budget before proving that it preserves the incumbent allocation.
Wall-clock time is deliberately not a semantic cut-off, because it would make equal inputs
produce different plans on different devices; the operational acceptance budget is p95
≤100 ms and p99 ≤150 ms for the fixed live-sized scenario fixture. Exceeding it is a
performance failure to optimise/cache, not permission to change allocation semantics.

### D-FEASIBILITY — use the production eligibility path and revalidate after every pick

Reservation feasibility is not a second rules engine. It must use the same availability,
phase, planned-intensity, injury, recovery/spacing, and fatigue-tier filtering path as
`generateWeekAheadPlan` and `rankCandidates`.

After every selected forecast day, remaining reservations are recalculated against the
new projected fatigue and history. On a reserved date the planner selects a candidate that
fulfils that reserved occurrence. A safe role may move to a later jointly feasible date;
it is not lost merely because its original nominated/allocated date changed.

### D-SUPPORT — a selected forecast session may not destroy all safe allocations

On every train/modify forecast date, the selected candidate is admissible only if applying
its projected cost/history preserves the maximum achievable **stateful** required-role
reservation count and any earlier-deadline reservation it would otherwise invalidate. This
is a bounded one-step viability check, not horizon-wide utility search. On an unreserved
date this protects required roles from discretionary support work. On a reserved date the
ranking pool is constrained to exact-role candidates when they survive the date gates, but
the chosen exact candidate must still preserve the other required occurrences; satisfying
the current reservation does not authorize starving a later one.
It prevents a reduced-dose strength/support session, an unnecessarily costly exact-role
substitute, or a discretionary Rest day from consuming the only safe quality or
event-specific opportunity, while continuing to permit the selection whenever another safe
allocation remains.

Hard safety and feasibility still outrank role fulfilment. A recover-tier ceiling remains
Rest-first; no reservation can force training through it. Rest is not made an optimisation
target or capped by percentage.

On a train/modify-tier date, a Rest selection consumes the date and therefore receives the
same stateful viability proof as any other selection. It is used as the safe fallback only
when preservation is proven; if bounded search cannot prove preservation, the plan carries
an explicit `unresolved_search_budget` outcome rather than silently treating Rest as proof.
In a true recover tier, Rest-first outranks this proof: Rest is selected without forcing
unsafe training, the remaining search is recomputed, and any resulting loss is reported as
a recover-tier safety consequence rather than as a discretionary scheduling defect.

### D-BUDGET — allocate required roles inside the committed rolling envelope

The feasibility hierarchy is explicit:

1. clinical, injury, readiness, acute-fatigue, taper, and daily-capacity gates;
2. fixed activities and schedule overlays as committed load;
3. the rolling catalog-load envelope from ADR-0043;
4. required-role allocation inside the remaining envelope;
5. anchor placement as a soft timing preference;
6. ranking preferences, including Extra Recovery Margin.

Anchors never bypass the rolling envelope. `conservativeBias` does not change budget limits,
budget admission, or role-reservation topology. It may change an effective modify-tier dose
through the ordinary readiness path; that dose is then charged normally by ADR-0043. A
supporting candidate that cannot prove preservation of a higher-priority required-role
witness must not fall through to the highest-ranked candidate. The same preservation rule
applies on reserved dates: fulfilling the current occurrence is not enough if the selected
exact candidate would consume the last feasible witness for another required occurrence.
The planner must select a proven-safe alternative/fallback or surface an unresolved
allocation result.

### D-MISS — forecast role misses are first-class diagnostics

`WeekAheadPlan` will expose the shared `WeeklyRoleAllocationReport` for every required
occurrence; the simulator and week-ahead UI consume and render that model, never rebuild it
from recommendations. Each immutable occurrence has `id`, coverage-set id, coverage key,
authored session identity, active-plan-window start/end, phase, and zero-based ordinal. Its
id is the canonical serialization of those fields, so filtering order and projected coverage
cannot change it.
The report carries the original nominated date (nullable), assigned date (nullable), exact
template/workout identity (nullable), `status`, `wasMoved`, and typed diagnostics.

`status` is mutually exclusive: `reserved` is a current forecast assignment; `fulfilled`
is retained only when a selected forecast recommendation fulfils it; `missed` is terminal
only after exhaustive in-budget proof of infeasibility; and `unresolved_search_budget`
means no conclusion. `moved` is not a terminal status: `wasMoved` records that a
reservation changed from its nominated/previous assigned date while retaining the same
occurrence id. Valid transitions are unallocated → reserved → fulfilled/missed, or
unallocated → missed; a reallocation is reserved → reserved with `wasMoved: true`.

A terminal miss has one primary typed reason and optional observed blockers:
`no_exact_candidate`, `hard_safety_or_recovery`, `daily_ledger_capacity`,
`rolling_load_budget`, `projected_fatigue`, `fixed_seed`, or `no_conflict_free_date`.
`unresolved_search_budget` is never encoded as one of these reasons. The report is forecast
evidence, not a completed-exposure credit and not a substitute for the persisted
recommendation audit.

### D-NO-BEAM — retain the existing greedy production path

`sequenceSearch.ts` remains an experimental comparison path under ADR-0015. This decision
adds a deterministic allocation pre-pass and viability check to the production greedy
planner; it neither imports the beam-search wrapper nor changes its adoption status.

## Consequences

### Positive

* Healthy, eligible cycling roles are planned as a weekly allocation problem rather than
  incidental winners of day-by-day utility ranking.
* A safety-forced omission is explicit and distinguishable from a scheduling defect.
* Existing hard gates, exact coverage identity, and Rest-first recover behaviour retain
  their authority.

### Negative

* Repeated feasibility/search calculations add bounded planner work and need a measured
  latency budget.
* Reservation metadata is another forecast surface that must stay aligned with the actual
  selected days and simulator output.
* This improves local allocation but does not prove that a bounded whole-week search is
  unnecessary; ADR-0015 remains the record for that later decision.

## Amendments

### 2026-09-26 — support-tier occurrences (issue #801)

Issue #801 adds a required occurrence that must not compete with the roles above: the second
weekly strength/power exposure in a cycling event build (`compact_strength`, authored only for
durable `strength_muscle` intent). Such an occurrence carries `reservationTier: 'support'`.
This amends D-RESERVE, D-BOUND, D-SUPPORT and D-MISS as follows; untiered ("primary")
occurrences keep every original rule.

* **D-RESERVE.** Reservation is two-pass. Pass 1 is the original maximum-cardinality search
  over primary occurrences only, so primary outcomes are identical to a week without support
  occurrences. Pass 2 places support occurrences only on dates pass 1 left free, never on a
  date nominated to a primary occurrence or on a weekly quality/event-specific anchor date
  while that anchor's role is still pending, with every primary reservation held fixed; a
  support pick that would invalidate a later primary reservation is inadmissible.
* **D-BOUND.** Each pass uses the same `WeeklyAllocationSearchBudget`. Exhaustion in the
  support pass is reported only on support outcomes and never marks the primary allocation
  unresolved. Pass 2's check that fixed later primary reservations survive a support pick
  evaluates outside the transition count; it is bounded by (support templates x later primary
  reservations) per evaluated date and is covered by the live-sized latency gate with a
  support role present.
* **D-SUPPORT.** Preservation compares allocations by primary occurrences first and total
  occurrences second (`allocationValuePreserved`). A pick that keeps the count by trading a
  primary occurrence for a support occurrence is degradation.
* **D-MISS.** A support occurrence may be `missed` with the added typed reason
  `subordinate_to_required_roles` when the primary allocation, rather than a safety or
  capacity gate, left it no admissible date. This is a policy outcome, not the exhaustive
  infeasibility proof the original `missed` rule requires for primary occurrences.

Policy lineage: `policy.event.cycling_build_strength_support_v1` (ADR-0033). Current behavior:
`docs/architecture/recommendation-engine.md`.

## References

* Implementation plan: [Phase 7A](../plans/phase-7-weekly-allocation-and-role-reservations.md)
* [PR #17 semantic-baseline follow-up](../analysis/2026-08-10-pr17-semantic-baseline-follow-up.md)
* [ADR-0015](./0015-sequence-planning-and-session-role-model.md) — prototype retained, adoption deferred
* [ADR-0016](./0016-adaptation-credit-and-weekly-coverage.md) — exact role coverage and safety authority
* [ADR-0043](./0043-rolling-catalog-load-budget.md) — hard rolling catalog-load envelope
* `app/src/engine/planner.ts`, `optimizer.ts`, `coverage.ts`, `sequenceSearch.ts`
