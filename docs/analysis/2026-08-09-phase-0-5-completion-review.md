# Phase 0–5 completion review — 2026-08-09

## Scope and verdict

This follow-up verifies the implementation plans derived from
[`2026-08-08-architecture-review.md`](./2026-08-08-architecture-review.md) against
PR #16's code, with the audit and Phase 6 planning work on
`codex/phase-0-5-completion-audit`. The earlier analysis remains a point-in-time record
and is not edited.

**Phases 0–5 are implemented; three original findings and two Phase 5 residual gaps are
not fully closed.** The original review is fully closed for F1–F10, F13–F14, and F16–F17.
F11, F12, and F15 are only partially closed: the harness and key correctness work landed,
but the remaining calibration, fatigue-fusion, and operational controls are not
represented as finished work.

Two further gaps surfaced during Phase 5's own implementation, are not original review
findings, and are not yet closed:

* **Multi-event objectives are not re-resolved mid-horizon.** `planner.ts`'s
  `generateWeekAheadPlan` seeds `microcycle.objectives` — including which Phase 5.6
  contributor objectives survive `resolveMultiEventObjectives` — once at `todayDate`, then
  carries that set unchanged through every later day of the 7-day loop. A taper authority
  or contributor crossing a window boundary strictly inside the horizon is not reflected in
  which objectives are admissible afterward. This is recorded in-code as a known, deliberate
  gap (see the per-day loop comment in `planner.ts`), not something this audit discovered.
* **Fixed activities are calendar blockers but not yet full projected exposures.**
  `schedule.ts` deducts duration and computes `reservedCapacityCost`, but that scalar is not
  consumed by ranking or fatigue and `expectedStimulus` is not projected into objective
  credit. The activity's `environment`/`equipment` describe its venue and must not be
  naively treated as a whole-day restriction for an unrelated session; true travel/day
  restrictions need explicit day-context semantics. `fixed: false` is also deliberately
  not rescheduled while greedy planning remains production behavior.

Both are Phase-5-scope behaviours, not F11/F12/F15 calibration work, so they are not folded
into those three findings. Reopening Phase 5's `Implemented` status to track them would
misrepresent what shipped; instead they are carried forward as explicitly Phase-6-owned
correctness work in task 6.2.

PR #17 has now started Phase 6 with **6.1 baseline ownership implemented**: normal scenario
runs no longer overwrite the committed semantic baseline, baseline updates require the
explicit reviewed command, and CI verifies the baseline remains unchanged during normal
simulation.

## Finding reconciliation

| Finding | Status | Current evidence |
|---|---|---|
| F1 — injury gate | Closed | `TrainingSettings.injuries` flows through `mapContextFromGoalsAndTrainingSettings`; `injuryPolicy.ts` and `provenance.test.ts` cover hard restrictions and a non-zero audit count. |
| F2 — Garmin credit | Closed | `completedTraining.ts` derives inferred stimulus and evidence tier; `microcycle.test.ts` covers Garmin-only objective credit. |
| F3 — anti-stacking | Closed | The optimizer uses dated, role-aware recovery constraints rather than modality-count multipliers. |
| F4 — divergent optimizer calls | Closed | `buildOptimizationContext` is used from both `rules.ts` and `planner.ts`, with parity coverage in `optimizer.test.ts`. |
| F5 — optimistic next-day strip | Closed | `Home.tsx` stores `selectedNextDayTier` and uses it for the next-day recommendation. |
| F6 — recommendation immutability | Closed | `firestore.rules` enforces schema ratcheting and revision archival; the emulator suite covers rewrites, downgrades, and legal updates. |
| F7 — inconsistent credit models | Closed | ADR-0014 and `stimulus.ts` establish the fractional ledger; compatibility credit is documented as fallback only. |
| F8 — incomplete stimulus vocabulary | Closed | Canonical axes are validated at the persistence boundary and consumed downstream. |
| F9 — two selection paths | Closed | `evaluateReadinessAndSafetyEnvelope` is the shared readiness boundary; the live selection path is the optimizer. |
| F10 — undocumented policy / frozen version | Closed | ADR-0010, ADR-0011, and ADR-0014 document the policy surfaces. The merged Phase 5 work sets `POLICY_VERSION` to `2026-08-phase5-sequence-planning-v1` and marks the preceding version audit-only; this branch adds replay regression coverage for that classification. `check-policy-drift.mjs` passes against `main`. |
| F11 — calibration record and decision-quality gate | Partial | Phase 0 adds blocking coaching invariants, aggregate scenario bounds, a committed semantic baseline, and CI execution. Phase 6.1 now makes baseline ownership safe, but the representative calibration corpus and trigger-frequency report still do not exist. |
| F12 — fatigue saturation, fusion, ordering | Partial | History is sorted/asserted and raw external load remains unsaturated. The tested fusion comparison deliberately retains `max()`; its masking limitation remains a documented modelling question rather than a resolved claim. |
| F13 — documentation drift | Closed | The architecture reference documents the live engine, current ADRs are indexed, and `AGENTS.md` reflects schema and module inventory. |
| F14 — clean-clone frontend checks | Closed | `firebase.ts` uses lazy accessors. In a worktree with no `app/.env` and no `VITE_FIREBASE_*` environment variables, `npm run check` passed. |
| F15 — CI and tooling | Partial | CI runs ruff, mypy, dependency audits, policy-drift checking, simulations, and now guards baseline immutability. Coverage reporting and deployed-Firestore-rule drift detection remain absent. |
| F16 — invisible event plan | Closed | `PlanDefinition` / `PlanBlock` are resolved in `resolveTrainingIntent` and drive active-window objectives. |
| F17 — inert intensity scale | Closed | `PlannedDose` owns both volume and intensity and reads authored plan-block scales. |
| *(not a review finding)* — 5.6 mid-horizon re-resolution | Owned by Phase 6 | `planner.ts` seeds `microcycle.objectives` once at `todayDate`; a taper/contribution-window transition inside the 7-day horizon does not change which objectives are admissible after it. Phase 6.2a specifies date-correct re-resolution with historical credit preservation. |
| *(not a review finding)* — 5.3 fixed-activity projection | Owned by Phase 6 | Fixed activities reserve calendar time, but expected stimulus/cost are not yet projected through objective credit and adjacent-day fatigue. Phase 6.2b defines the missing exposure semantics without overloading venue metadata as a day-wide restriction. |

## Verification performed

| Check | Result |
|---|---|
| `npm run check` | Passed before the Phase 6.1 script/doc follow-up: TypeScript, ESLint, 486 unit tests (26 skipped), and workout validation. |
| `npm run test:rules` | Passed: 26 Firestore emulator tests. |
| `npm run simulate:scenarios` | Passed: 11 scenarios completed and the aggregate gate passed. Phase 6.1 changes this command so it no longer writes the committed baseline. |
| `npm run compare:sequence-search` | Both greedy and beam search had zero constraint and golden-week violations; the production decision to retain greedy remains documented in ADR-0015. |
| `uv run pytest`, `uv run ruff check .`, `uv run mypy src/garmin_sync` | Passed: 86 Python tests, lint, and type checking. |
| `node app/scripts/check-policy-drift.mjs <PR-base-SHA>` | Passed after rebasing onto `main`; the Phase 6.1 work changes tooling/docs, not decision-affecting engine files. |

After Phase 6.1, `simulate:diff` is once again an independent comparison: the preceding
`simulate:scenarios` command no longer rewrites its baseline input. CI additionally runs
`git diff --exit-code -- ../docs/analysis/simulation-baseline.json` immediately after the
scenario gate, so a future accidental baseline write is blocking rather than silently
self-approving the diff.

## Remaining work

The detailed execution plan is
[`phase-6-evidence-and-operational-assurance.md`](../plans/phase-6-evidence-and-operational-assurance.md).
In priority order:

1. **Close the Phase 5 correctness carryovers (6.2).** Re-resolve multi-event objectives on
   the date a taper/contribution boundary changes, preserving historical credit; and treat
   fixed activities as explicit projected exposures for time, objective credit, same-day
   capacity, and adjacent-day fatigue.
2. **Expand the deterministic scenario contract (6.3).** Add multiple events, initial
   history, fixed activities, date-level readiness, and targeted cases for the two
   carryovers plus load/readiness/evidence boundaries.
3. **Build the F11 evidence layer (6.4).** Add daily decision traces, a synthetic
   policy-regression corpus, and a reproducible trigger-frequency report. Do not market
   synthetic cases as physiological calibration and do not auto-tune thresholds.
4. **Add coverage visibility (6.6).** Publish frontend/backend coverage in CI without an
   arbitrary global threshold.
5. **Close Firestore deployment assurance (6.5)** once the production project and
   deployment owner are known.
6. **Revisit fatigue fusion (6.7) only after evidence exists.** Production `max()` remains
   valid unless a documented failure mode and a contract-safe candidate justify a change.

Phase 6.1 baseline ownership is complete in this PR and is no longer part of the remaining
work list.
