# PR #292 review — evergreen priority fairness and time-cap invariants

**Date:** 2026-08-29
**PR:** #292 — `fix(engine): fix endurance+strength priority starvation and time-cap dose overrun`

## Scope reviewed

The review followed both reported failures through the live engine path rather than treating the PR tests as sufficient proof:

- evidence-backed evergreen requirement priority resolution;
- weekly dose packing under a shared priority-tier session ceiling;
- training-cap eligibility and downstream automatic dose adjustment;
- legacy-template to canonical-workout coverage identity and duration-credit semantics;
- Running/no-bike evergreen scheduling through the concrete optimizer;
- feasibility of same-tier capacity reservations against actual remaining time windows;
- preservation of constrained long windows during placement;
- policy-version governance for persisted recommendation changes.

Lint/static-analysis findings are intentionally outside this review scope.

## Finding 1 — fixed equal-share packing could strand usable required capacity

The PR correctly prevented the first `required` requirement from consuming the whole `minSessions` ceiling. Its first implementation used an even share of the remaining tier capacity, however. That introduced a second edge case:

- requirement A still needs 4 sessions;
- requirement B still needs 1 session;
- 5 required-tier slots remain.

A fixed split could allow A only 3 slots, B would use its single slot, and the loop would finish with one unused weekly slot while A still had a satisfiable required shortfall.

### Resolution

`packWeeklyDose` now estimates remaining feasible session demand for each same-priority peer. Scarce tier room is distributed proportionally to that demand while reserving at least one occurrence for later peers that can still use a remaining availability window.

This preserves both invariants:

1. a feasible same-priority peer cannot be starved merely because it is processed later;
2. capacity is not left idle while the current tier has a satisfiable shortfall.

A regression covers the asymmetric 4-session aerobic + 1-session strength case and requires all five available sessions to be used with no shortfall.

## Finding 2 — time-cap enforcement still depended on an authored `easierDose`

The PR's first time-cap fix only auto-adjusted a wide-range template when the template already had an `easierDose` whose maximum fit the day cap. That left two uncovered cases:

1. wide-range eligible templates with no authored easier dose (for example `cycling_technical_01`, authored as 30–55 min);
2. `modify` mode, where the existing condition could select an authored easier dose even when that easier dose's maximum still exceeded the day cap.

The eligibility contract intentionally uses `durationMin`: a 30–55 minute session should remain eligible on a 40-minute day because a valid execution exists. Rejecting all templates whose authored `durationMax` exceeds the cap would therefore be too strict.

### Resolution

`eligibleTemplates` now keeps the same minimum-duration feasibility rule but decorates eligible `SessionTemplate` values whose authored maximum exceeds the resolved cap with a cap-safe dose variation before ranking:

- prefer the authored easier variation when it can start within the cap;
- if its upper bound still exceeds the cap, narrow that upper bound and scale its dose ratio proportionally;
- if no authored easier variation can start within the cap, derive a duration-only variation from the base template;
- do not mutate the catalog object or its authored base duration range.

The existing downstream auto-dose path can therefore always apply a fitting variation when `durationMax` exceeds availability, including on `modify` days.

Regression tests cover both a real no-`easierDose` catalog template and a synthetic authored-easier-dose-overrun case.

## Finding 3 — policy identity was stale

The PR changes `rules.ts` behavior and therefore can alter persisted recommendation decisions. The repository's policy-drift CI gate correctly rejected the original head because `POLICY_VERSION` still matched `main`.

### Resolution

`POLICY_VERSION` is bumped to:

`2026-08-evergreen-priority-time-cap-v1`

This is a behavioral version, not a CI-only workaround.

## Finding 4 — Running/no-bike aerobic coverage was declared but structurally unreachable

A follow-up diagnostic used the exact `endurance + strength_muscle` persona path and showed that Findings 1–3 were fixed at the strategy/packing layer: aerobic and strength both received non-zero required coverage. The concrete Running/no-bike plan could still become strength-only, however.

The failure was downstream in the legacy coverage bridge:

- evergreen `aerobic_volume` explicitly accepts `running_easy_continuous_01`;
- legacy `end_easy_02` resolves to that canonical workout;
- `coverageKeysForExposure` intentionally requires an aerobic exposure to meet the canonical workout's `minimumMin` before granting `aerobic_volume` credit;
- the canonical run minimum is 30 minutes, but `end_easy_02` was authored with `durationMin: 20`;
- therefore `coverageKeysForTemplate(end_easy_02, 'general')` could never return `aerobic_volume`, so the optimizer had no Running candidate capable of repairing the required role.

The Cycling mirror did not fail because `end_easy_01` and `cycling_zone2_standard_01` both use a 30-minute minimum.

### Cardinality review

This did **not** justify changing the legacy bridge to map one engine template to multiple canonical workouts. Coverage is already many-to-many at the role layer: a single canonical workout can satisfy multiple explicit roles where the descriptor says so. For example, `cycling_event_specific_endurance_01` legitimately earns both `outdoor_event_specific` and `short_surges`, and an existing regression asserts that behavior.

Keeping one canonical execution identity per legacy template therefore remains useful: it prevents vague stimulus overlap from silently substituting for an authored role. If a workout genuinely satisfies multiple roles, that belongs in the coverage descriptor rather than in ambiguous template-to-workout fan-out.

### Duration-semantics decision

The 30-minute floor is retained rather than weakened. Completed/projected aerobic credit should continue to depend on the actual exposure duration, so a 20- or 29-minute run does not suddenly count as the same weekly aerobic-volume unit as the authored 30+ minute continuous prescription.

The fix aligns the legacy run with that contract instead:

- `end_easy_02.durationMin` is now 30 minutes;
- its cap-safe `easierDose` is exactly 30 minutes and remains continuous running;
- the shorter jog/walk behavior stays represented by the distinct `end_easy_03` / `running_walk_run_01` path, which intentionally does not earn full `aerobic_volume` credit;
- the harder 45–60 minute continuous-run dose remains available.

This also closes a subtle 30-minute-day edge case: leaving the old 15–25 minute easier dose on a 30–40 minute base template would allow the optimizer to select the right coverage identity and then auto-apply a dose that could not actually earn that coverage.

### Regression coverage

Two levels now protect the production path:

1. `coverage.test.ts` asserts that both Cycling and Running continuous-aerobic legacy templates can resolve `aerobic_volume`, while a 29-minute Running exposure still does not receive credit and a 30-minute exposure does.
2. `evergreenPlanner.test.ts` uses a Running-preferred, **no-indoor-bike** `endurance + strength_muscle` profile and asserts the concrete week-ahead plan contains `end_easy_02`, contains no `end_easy_01`, and still carries both aerobic and primary-strength allocations.

This is intentionally stronger than checking the abstract allocation report alone, because the original follow-up failure occurred after allocation had already succeeded.

## Finding 5 — fairness reservation could reserve a slot for an impossible later peer

The demand-aware allocator introduced for Finding 1 initially estimated how many sessions each later peer still needed from dose alone. It did not ask whether any **remaining time window could actually fit that peer's role**.

That creates a different stranded-capacity case. For example:

- two 30-minute required-tier windows remain;
- aerobic work can use 30-minute windows and still needs both;
- a later same-priority strength role requires 45 minutes;
- the naive fairness calculation reserves one of the two windows for strength even though strength cannot use either window;
- aerobic receives one session, strength receives none, and the second 30-minute slot remains unused.

### Resolution

The fair-share demand estimator now evaluates the unused availability windows themselves:

- for each requirement, it considers only exact permitted roles;
- for each unused window, it calculates the best dose from a role that actually fits that window;
- it estimates session demand by accumulating those feasible per-window doses until the remaining requirement is met or feasible windows are exhausted;
- later peers with zero feasible remaining windows reserve zero tier capacity.

The allocator still preserves a slot for a later peer when that peer can genuinely use one; it simply no longer sacrifices usable capacity to an impossible reservation.

A regression uses two 30-minute windows with a 30-minute aerobic role and a 45-minute strength role. Both windows must go to aerobic, while strength is reported explicitly as a goal-required shortfall rather than silently stranding a session.

## Finding 6 — cardinality reservation alone did not preserve the later peer's viable window

Even an availability-aware reservation can fail if placement consumes the wrong concrete window. With one 30-minute window and one 45-minute window, a 30-minute aerobic role and a later 45-minute strength role are jointly feasible. The previous placement tie-breaker could still put aerobic into the earlier 45-minute window, leaving only 30 minutes for strength and turning a feasible two-role week into a strength shortfall.

### Resolution

Within the same delivered role dose, placement now uses a **best-fit window** before the legacy spacing tie-breaker:

- prefer the shortest unused window that can fit the selected role;
- preserve longer windows for later roles that may have no shorter alternative;
- only then apply the existing spacing preference and deterministic identity/date tie-breaks.

This is a standard anti-fragmentation scheduling invariant and does not weaken dose or spacing policy. A regression with 30- and 45-minute windows requires aerobic to use the 30-minute slot and strength to retain the 45-minute slot, with both required roles satisfied and no shortfall.

## Finding 7 — the cap-safe dose adjustment never reached forecast days

Re-running `judge:e2e:quick` after Findings 1-6 landed showed `judge_pref_45min` had genuinely improved (5.0 -> 6.0) but was still flagged: two sessions on a 45-minute-capped weekday still advertised a 30-60 minute range. Cross-referencing the generated plan day-by-day against day-of-week showed only the "today" and "tomorrow" evaluations (2 of every 7 days) were fixed; every forecast day (the other 5) still showed the raw, uncapped range.

The cause: `resolveTimeCapDoseAdjustment`'s logic (Finding 2) only lived inline in `rules.ts`'s `evaluateTrainingWithIntent`, which is the function behind "today" and "tomorrow" only. Every other day in a real week is produced by `planner.ts`'s `generateWeekAheadPlanWithIntent`, a wholly separate greedy loop with its own candidate ranking -- it never called that logic at all, and `WeekAheadDay` (its per-day type) had no field to carry an active dose in the first place. Confirmed directly: `grep -n "easierDose|activeDose" src/engine/planner.ts` returned nothing before this fix. Production impact is real, not test-only: `WeekAheadStrip.tsx` renders `day.template.durationMin/durationMax` straight from this same type, so the same uncapped duration was shown in the actual week-ahead UI for most of any real week.

### Resolution

- `resolveTimeCapDoseAdjustment` and a new `materializeEffectiveDose` (bakes an active dose's duration *and* proportionally-scaled cost/stimulus into a template, for display/trace purposes only) moved to `optimizer.ts` so both call sites share one implementation. `rules.ts` now calls the shared function instead of the logic it used to inline.
- `generateWeekAheadPlanWithIntent`'s forecast loop calls `resolveTimeCapDoseAdjustment` for every pick and attaches the result to the pushed `WeekAheadDay`.
- `WeekAheadDay` gained optional `activeDose`/`adjustment` fields, mirroring `Recommendation`'s existing shape. `template` itself is deliberately left untouched everywhere in `planner.ts` -- an earlier version of this fix materialized the adjusted dose directly into `template`, which changed the duration/stimulus/cost that downstream coverage-credit and cross-week history accounting keyed off, and broke three unrelated, previously-passing multi-week scenario tests (objective resolution counts shifted). Keeping `template` as the authored catalog identity and only exposing the adjustment as a sibling field avoids that: coverage/history bookkeeping is provably unaffected (full suite stayed green), and a display consumer opts in explicitly.
- `analyze.ts`'s `traceFromForecastDay` now materializes `day.activeDose` into the trace the same way `traceFromRecommendation` already did for today/tomorrow, so the judge/simulation harness sees the adjusted duration. `analyze.ts`'s own `materializeEffectiveSimulationTemplate` is now a re-export of the shared `optimizer.ts` function rather than a separate implementation.
- `WeekAheadStrip.tsx` (the only production UI reading these durations) now renders `activeDose`'s duration when present instead of `template`'s own.

### Regression coverage

`planner.test.ts` adds a scenario with a 45-minute hard cap and a cycling-preferring, indoor-bike-equipped profile: at least one forecast day (`dayOffset >= 2`, not just today/tomorrow) picks a template whose authored `durationMax` exceeds 45, and asserts it carries an `activeDose` whose own `durationMax` fits, plus a matching `adjustment`. The full engine suite (1619 tests) and the previously-regressing scenario tests both stay green.

## Resulting behavioral invariants

- Explicit `endurance` remains a required evergreen adaptation when selected.
- Same-priority required adaptations share scarce capacity without first-processed starvation.
- Uneven same-priority demand can consume leftover capacity instead of stranding it.
- Same-tier capacity is reserved only for later peers that can actually fit a remaining availability window.
- Flexible roles use the shortest fitting window before spacing tie-breaks, preserving constrained long windows for later roles.
- An impossible peer remains an explicit shortfall; it does not consume or strand a feasible peer's capacity.
- A template is excluded only when its minimum duration cannot fit the resolved daily cap.
- If a wide-range `SessionTemplate` is otherwise eligible, the ranked value has a cap-safe dose variation whose maximum does fit.
- Automatic `train`/`modify` dose selection therefore does not need every catalog template to author a bespoke easier variant merely to respect a hard time cap.
- Canonical workout identity may satisfy multiple explicit coverage roles; legacy templates do not need ambiguous many-workout identities to get multi-role credit.
- The Running and Cycling continuous-aerobic legacy bridges both have a reachable 30-minute base floor.
- Sub-30-minute Running exposures remain distinct from full `aerobic_volume` credit.
- A Running-preferred athlete without an indoor bike still has a concrete candidate that can satisfy required evergreen aerobic coverage.
- Every day of a generated week -- today, tomorrow, and every forecast day alike -- applies the same cap-safe dose adjustment, not just the first two.
- A displayed session duration never advertises past a day's resolved time cap in the production week-ahead view, not only in the single-day recommendation.
- Persisted decisions produced by this behavior carry a distinct policy version.

## Verification targets

The PR CI is expected to validate:

- policy-version drift gate;
- TypeScript compilation;
- full Vitest suite/coverage;
- workout catalog validation;
- Firestore rule tests;
- deterministic simulation and plan-judge invariant gates;
- bundle build and dependency audit.

Static/lint-only findings are not review blockers for this task, per request.
