# ADR-0015: Sequence Planning — Bounded Beam Search Prototype, Adoption Deferred

* **Status:** Accepted (decision: retain the greedy loop; prototype retained, not wired live)
* **Date:** 2026-08-08
* **Deciders:** Core Engineering Team

---

## Context

[`docs/plans/phase-5-sequence-planning.md`](../plans/phase-5-sequence-planning.md) 5.1
observed that `generateWeekAheadPlan` (`planner.ts`) walks its "projected" tier one day at
a time, greedily: each day takes `rankCandidates`' rank-0 pick with no visibility into how
that choice constrains the days that follow. The plan's own example:

```text
Tue threshold / Thu easy aerobic / Sat race-specific        (whole-week judgement)
Tue threshold / Wed threshold / Thu rest / Fri race-specific (greedy, myopic)
```

is a class of judgement the greedy architecture cannot structurally make, even though each
of its six-plus named ranking policies is individually defensible. The plan proposed
bounded beam search (width 10-20, 7-day horizon, small per-day candidate set, hard
constraints rejected before scoring, whole-sequence scoring) as "sufficient" machinery,
and was explicit that **approving the plan approves building and measuring 5.1, not
shipping it regardless of outcome** — an explicit adoption decision, recorded here with
the comparison data, is required either way.

## Decision

**The greedy loop remains the live default.** A working beam-search prototype was built
(`app/src/engine/sequenceSearch.ts`, `beamSearchWeekAheadPlan` /
`generateWeekAheadPlanWithIntentBeamSearch`) and benchmarked against production greedy on
the Phase 0 invariants and the semantic scenario harness. The result is genuinely
positive on the metrics the harness can score — not a negative result — but two real,
unresolved costs (compute overhead, and a materially different rest-day frequency this
harness cannot judge as better or worse on its own) mean adoption is deferred, not
rejected. This satisfies the plan's completion criterion: *"If it does not measurably
improve them, the correct outcome is to record that result and keep the greedy loop —
that is a successful increment, not a failed one."* Here the harness result is positive,
but the decision to defer is deliberate for reasons the harness doesn't capture — see
Consequences.

### Implementation approach

Deliberately maximal reuse, not a parallel engine. Per (branch, day), the prototype calls
the exact same `rankCandidates` Phase-3 lexicographic pipeline the greedy loop uses --
hard-gate rejection (`excludedReasons`) already happens *before* `rankCandidates` returns
a score at all, which is the plan's "reject hard spacing/recovery violations before
scoring" requirement, inherited for free from the Phase 3 prerequisite rather than
reimplemented. What differs:

* **Candidates per day:** the greedy loop keeps only `rankCandidates`' rank-0 result; the
  prototype keeps its top `candidatesPerDay` (default 5) accepted results per branch.
* **Scoring:** each branch accumulates a `cumulativeScore` (sum of each chosen day's
  `utilityScore`) across the whole sequence. Pruning after each day keeps the top
  `beamWidth` (default 15) branches by *cumulative* score, not that day's score alone --
  the mechanism that lets the search prefer a slightly weaker day if it keeps stronger
  options open for the rest of the week.
* Today and tomorrow (confirmed/provisional tiers) are copied verbatim from the greedy
  inputs, unsearched -- this experiment concerns only the "projected" tier's day-by-day
  walk, matching the plan's own framing.

**Correctness check:** with `beamWidth=1, candidatesPerDay=1` the prototype is
mathematically forced to reduce to exactly the greedy algorithm (only one branch, only
one candidate ever considered). `sequenceSearch.test.ts` asserts this produces an
*identical* day-by-day plan to `generateWeekAheadPlan` for the same inputs -- direct
evidence the reused fatigue/objective/ranking wiring is faithful, not a subtly different
reimplementation.

## Comparison data

Produced by `npm run compare:sequence-search`
(`app/scripts/compare-sequence-search.mjs`), which runs every scenario in
`src/engine/simulation/scenarios.ts` through both `generateWeekAheadPlanWithIntent`
(greedy) and `generateWeekAheadPlanWithIntentBeamSearch` (beam, default width 15 /
5 candidates per day), using the identical `runScenario` harness and metrics for each.

| Metric | Greedy | Beam |
|---|---|---|
| Aggregate rest/recovery share (11 scenarios) | 34.5% | 25.1% |
| Aggregate hard constraint violations | 0 | 0 |
| Golden week (`cycling_a_event_build_week`) invariant violations | none | none |
| Wall-clock time, 11 scenarios (multi-week each) | 128ms | 730ms (**5.7x**) |

Both remain within the Phase 0 aggregate rest-day bound (`[5%, 40%]`, see
`scripts/simulate-scenarios.mjs`). Per-scenario, beam search **resolved a weekly
objective that greedy left unresolved** in three of eleven scenarios
(`cycling_gran_fondo_A`, `cycling_criterium_A`, `general_target_generic`), and never left
unresolved an objective greedy resolved. This is the concrete form of the plan's
hypothesis: the whole-sequence view sometimes avoids a myopic day-N pick that would have
blocked a day-(N+2) opportunity, and that shows up as more objectives actually getting
satisfied within the week, not just a different-looking plan.

Beam search also chose **fewer Mobility/Recovery days and more active training days**
in nearly every scenario (see `artifacts/sequence-search-comparison/comparison.json`,
regenerable, gitignored) -- a real, systematic behavioral shift, not incidental noise.

## Consequences

### Positive
* A genuine, reusable prototype exists (`sequenceSearch.ts`), built on exactly the
  Phase 3 lexicographic primitives the plan named as prerequisite, with a hard
  correctness check (`beamWidth=1` degeneracy) against the production algorithm.
* On every metric the Phase 0 harness can score, beam search is at least as good as
  greedy and strictly better on objective resolution in several scenarios, with zero new
  hard-constraint or golden-week violations.
* The golden-week coaching contract (`goldenWeek.test.ts`) now runs against *both*
  algorithms permanently, not just as a one-off comparison script -- a durable regression
  guard for the prototype, and a documented reference point if this decision is revisited.

### Negative / why adoption is deferred, not rejected
* **~5.7x compute overhead** for the same scenarios. ADR-0008 §3 already flags that the
  week-ahead strip recomputes on every dashboard load; this multiplier needs profiling
  against real single-call latency (not just the batch scenario-harness total) and,
  likely, memoization before it could ship, exactly as the plan's own risk section
  anticipated ("Measure before shipping; memoise the pre-pass if needed").
* **A materially different rest-day frequency is a coaching judgement call, not a
  correctness question.** Both 34.5% and 25.1% satisfy the Phase 0 bound; which is
  *better* for real athlete outcomes (recovery adequacy, adherence, injury risk) is not
  something an automated invariant harness can decide, and this repository's stated
  practice is not to make that call unilaterally in the same session that built the
  prototype being evaluated.
* **Depth of blast radius.** `generateWeekAheadPlan` is the live path for every user's
  week-ahead strip. A first-pass, single-session prototype -- however well it reuses
  existing primitives -- has not had the review cycles, edge-case testing, or staged
  rollout the existing greedy loop has accumulated across Phases 0-4.

### Recorded follow-up (not committed to a timeline)
Before revisiting adoption: (1) profile single-call latency and add memoization if
needed; (2) get explicit product/coaching sign-off on the rest-day-frequency shift,
informed by the comparison data above; (3) expand scenario coverage (multi-event,
injury-constrained, fixed-activity-heavy weeks) before trusting the comparison beyond
the 11 scenarios exercised here.

## Code References

* [`app/src/engine/sequenceSearch.ts`](../../app/src/engine/sequenceSearch.ts) — the beam-search prototype and its `generateWeekAheadPlanWithIntent`-compatible wrapper.
* [`app/src/engine/sequenceSearch.test.ts`](../../app/src/engine/sequenceSearch.test.ts) — unit tests, including the `beamWidth=1` greedy-degeneracy correctness check.
* [`app/src/engine/goldenWeek.test.ts`](../../app/src/engine/goldenWeek.test.ts) — the golden-week coaching contract, run against both algorithms.
* [`app/scripts/compare-sequence-search.mjs`](../../app/scripts/compare-sequence-search.mjs) — the comparison harness (`npm run compare:sequence-search`).
* [`app/src/engine/simulation/analyze.ts`](../../app/src/engine/simulation/analyze.ts) — `runScenario`'s `planGenerator` parameter, the seam this comparison is built on.
* [`app/src/engine/planner.ts`](../../app/src/engine/planner.ts) — the unchanged, live `generateWeekAheadPlan`; several small pure helpers were exported (no behavior change) for `sequenceSearch.ts` to reuse rather than duplicate.

---

## Related decisions

* [ADR-0008: Rolling 7-Day Week-Ahead Planning](./0008-week-ahead-planning.md) — the greedy loop and confidence tiers this experiment measured itself against; §3's live-recompute cost concern is exactly what beam search's 5.7x overhead needs to clear before adoption.
* [ADR-0007: Adaptive Multi-Sport Engine Architecture](./0007-adaptive-multisport-engine-architecture.md) — the 6-tier engine and lexicographic ranking this prototype reuses rather than reimplements.
