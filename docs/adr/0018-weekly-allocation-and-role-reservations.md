# ADR-0018: Weekly Allocation, Safe Role Reservations, and Explicit Misses

* **Status:** Proposed
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

ADR-0015 measured a beam-search prototype and deliberately retained greedy production
planning. The follow-up finding identifies a coverage-allocation contract; it does not by
itself approve beam-search adoption or a global fatigue-threshold change.

## Decision

### D-RESERVE — allocate eligible required role occurrences before supporting work

For the forecast portion of a rolling week, the planner will derive one allocation request
per still-unfulfilled **minimum** coverage occurrence. It will allocate only the authored,
currently active coverage roles and their exact catalogue identities. Target-only coverage,
generic adaptation credit, display title, modality, and category do not create a
reservation.

The allocator chooses a deterministic, one-session-per-date matching between those role
occurrences and feasible candidate dates. It maximises the number of required occurrences
that can be represented; deterministic ties use the requirement's deadline/date and
stable role/template identifiers. `recovery_or_rest` remains satisfied by the existing
coverage ledger and recovery policy; it does not reserve a discretionary training date.

Today's and tomorrow's selected recommendations are immutable seeds, not candidates to
be rewritten. Their coverage and fatigue effects are applied before allocation. A seed may
leave a role impossible; it is reported, never retroactively changed.

### D-FEASIBILITY — use the production eligibility path and revalidate after every pick

Reservation feasibility is not a second rules engine. It must use the same availability,
phase, planned-intensity, injury, recovery/spacing, and fatigue-tier filtering path as
`generateWeekAheadPlan` and `rankCandidates`.

After every selected forecast day, remaining reservations are recalculated against the
new projected fatigue and history. On a reserved date the planner selects a candidate that
fulfils that reserved occurrence. A safe role may move to a later feasible date; it is not
lost merely because its original nominated/allocated date changed.

### D-SUPPORT — supporting work may not destroy all safe allocations

On an unreserved date, a supporting candidate is admissible only if applying its projected
cost/history preserves the maximum achievable required-role matching cardinality and any
earlier-deadline reservation it would otherwise invalidate. This is a bounded one-step
viability check, not horizon-wide utility search.
It prevents a reduced-dose strength/support session from consuming the only safe quality
or event-specific opportunity, while continuing to permit it whenever another safe
allocation remains.

Hard safety and feasibility still outrank role fulfilment. A recover-tier ceiling remains
Rest-first; no reservation can force training through it. Rest is not made an optimisation
target or capped by percentage.

### D-MISS — forecast role misses are first-class diagnostics

`WeekAheadPlan` will expose an allocation report for every required occurrence:
`reserved`, `fulfilled`, `moved`, or `missed`. A miss must include a typed reason:
unavailable/no exact candidate, hard safety or recovery exclusion, projected fatigue
ceiling, fixed seed, or no conflict-free date. The simulator and week-ahead UI consume the
same report. The report is forecast evidence, not a completed-exposure credit and not a
substitute for the persisted recommendation audit.

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

* Repeated feasibility/matching calculations add bounded planner work and need a measured
  latency budget.
* Reservation metadata is another forecast surface that must stay aligned with the actual
  selected days and simulator output.
* This improves local allocation but does not prove that a bounded whole-week search is
  unnecessary; ADR-0015 remains the record for that later decision.

## References

* Implementation plan: [Phase 7A](../plans/phase-7-weekly-allocation-and-role-reservations.md)
* [PR #17 semantic-baseline follow-up](../analysis/2026-08-10-pr17-semantic-baseline-follow-up.md)
* [ADR-0015](./0015-sequence-planning-and-session-role-model.md) — prototype retained, adoption deferred
* [ADR-0016](./0016-adaptation-credit-and-weekly-coverage.md) — exact role coverage and safety authority
* `app/src/engine/planner.ts`, `optimizer.ts`, `coverage.ts`, `sequenceSearch.ts`
