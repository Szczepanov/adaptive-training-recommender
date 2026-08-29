# PR #292 review — evergreen priority fairness and time-cap invariants

**Date:** 2026-08-29  
**PR:** #292 — `fix(engine): fix endurance+strength priority starvation and time-cap dose overrun`

## Scope reviewed

The review followed both reported failures through the live engine path rather than treating the PR tests as sufficient proof:

- evidence-backed evergreen requirement priority resolution;
- weekly dose packing under a shared priority-tier session ceiling;
- training-cap eligibility and downstream automatic dose adjustment;
- policy-version governance for persisted recommendation changes.

Lint/static-analysis findings are intentionally outside this review scope.

## Finding 1 — fixed equal-share packing could strand usable required capacity

The PR correctly prevented the first `required` requirement from consuming the whole `minSessions` ceiling. Its first implementation used an even share of the remaining tier capacity, however. That introduced a second edge case:

- requirement A still needs 4 sessions;
- requirement B still needs 1 session;
- 5 required-tier slots remain.

A fixed split could allow A only 3 slots, B would use its single slot, and the loop would finish with one unused weekly slot while A still had a satisfiable required shortfall.

### Resolution

`packWeeklyDose` now estimates remaining session demand for each same-priority peer from the best eligible per-session dose. Scarce tier room is distributed proportionally to that demand while reserving at least one occurrence for later peers that still need coverage.

This preserves both invariants:

1. a same-priority peer cannot be starved merely because it is processed later;
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

## Resulting behavioral invariants

- Explicit `endurance` remains a required evergreen adaptation when selected.
- Same-priority required adaptations share scarce capacity without first-processed starvation.
- Uneven same-priority demand can consume leftover capacity instead of stranding it.
- A template is excluded only when its minimum duration cannot fit the resolved daily cap.
- If a wide-range `SessionTemplate` is otherwise eligible, the ranked value has a cap-safe dose variation whose maximum does fit.
- Automatic `train`/`modify` dose selection therefore does not need every catalog template to author a bespoke easier variant merely to respect a hard time cap.
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
