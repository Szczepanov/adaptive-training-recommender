# Phase 0–5 completion review — 2026-08-09

## Scope and verdict

This follow-up verifies the implementation plans derived from
[`2026-08-08-architecture-review.md`](./2026-08-08-architecture-review.md) against
PR #16's code, with the audit work on `codex/phase-0-5-completion-audit`. The earlier
analysis remains a point-in-time record and is not edited.

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
* **`FixedActivity.environment`/`equipment` and `reservedCapacityCost` are not consumed.**
  `schedule.ts`'s `resolveAvailability` derives available equipment only from the athlete's
  standing constraints, never from the day's booked activity; and `reservedCapacityCost` is
  computed but not read by `rankCandidates` or the fatigue projection. `schedule.ts`
  documents `fixed` (movable vs immovable) as "captured on the model but not yet consumed";
  the same is true of these two fields.

Both are Phase-5-scope behaviours, not F11/F12/F15 calibration work, so they are not folded
into those three findings. Reopening Phase 5's `Implemented` status to track them would
misrepresent what shipped (5.3 and 5.6 landed and are exercised by tests); instead they are
carried forward as explicitly Phase-6-owned carryover work — see
[`phase-6-evidence-and-operational-assurance.md`](../plans/phase-6-evidence-and-operational-assurance.md)
6.2a/6.2b — rather than left implied by "all Phase 0–5 work items are implemented."

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
| F11 — calibration record and decision-quality gate | Partial | Phase 0 adds blocking coaching invariants, aggregate scenario bounds, a committed semantic baseline, and CI execution. The requested representative calibration dataset and `calibrate.ts` trigger-frequency report do not exist. |
| F12 — fatigue saturation, fusion, ordering | Partial | History is sorted/asserted and raw external load remains unsaturated. The tested fusion comparison deliberately retains `max()`; its masking limitation remains a documented modelling question rather than a resolved claim. |
| F13 — documentation drift | Closed | The architecture reference documents the live engine, current ADRs are indexed, and `AGENTS.md` reflects schema and module inventory. |
| F14 — clean-clone frontend checks | Closed | `firebase.ts` uses lazy accessors. In a worktree with no `app/.env` and no `VITE_FIREBASE_*` environment variables, `npm run check` passed. |
| F15 — CI and tooling | Partial | CI now runs ruff, mypy, dependency audits, policy-drift checking, and simulations. Coverage thresholds and deployed-Firestore-rule drift detection remain absent. |
| F16 — invisible event plan | Closed | `PlanDefinition` / `PlanBlock` are resolved in `resolveTrainingIntent` and drive active-window objectives. |
| F17 — inert intensity scale | Closed | `PlannedDose` owns both volume and intensity and reads authored plan-block scales. |
| *(not a review finding)* — 5.6 mid-horizon re-resolution | Owned by Phase 6 | `planner.ts` seeds `microcycle.objectives` once at `todayDate`; a taper/contribution-window transition inside the 7-day horizon does not change which objectives are admissible after it. See [phase-6 plan](../plans/phase-6-evidence-and-operational-assurance.md), task 6.2a. |
| *(not a review finding)* — 5.3 fixed-activity wiring | Owned by Phase 6 | `schedule.ts`'s `resolveAvailability` does not read a `FixedActivity`'s `environment`/`equipment`, and `reservedCapacityCost` is computed but not consumed by ranking or fatigue. See [phase-6 plan](../plans/phase-6-evidence-and-operational-assurance.md), task 6.2b. |

## Verification performed

| Check | Result |
|---|---|
| `npm run check` | Passed: TypeScript, ESLint, 486 unit tests (26 skipped), and workout validation. |
| `npm run test:rules` | Passed: 26 Firestore emulator tests. |
| `npm run simulate:scenarios` | Passed: 11 scenarios completed and the aggregate gate passed. |
| `npm run compare:sequence-search` | Both greedy and beam search had zero constraint and golden-week violations; the production decision to retain greedy remains documented in ADR-0015. |
| `uv run pytest`, `uv run ruff check .`, `uv run mypy src/garmin_sync` | Passed: 86 Python tests, lint, and type checking. |
| `node app/scripts/check-policy-drift.mjs <PR-base-SHA>` | Passed after rebasing onto `main`; this branch changes no decision-affecting engine files. |

`simulate:diff` is intentionally not listed as independent verification here: running
`simulate:scenarios` writes the current output to the baseline file first. The committed
Phase 5 baseline change must instead be reviewed from its recorded commit and PR history.

## Remaining work

Phase 0–5 should remain `Implemented`; reopening completed task markers would obscure
the distinction between delivered scope and future work. The remaining work should be
planned separately:

1. Add a synthetic or anonymized representative calibration corpus and a reproducible
   trigger-frequency report for tuned constants (F11).
2. Revisit the retained `max()` fatigue fusion only when new measured-response evidence
   supports an alternative (F12).
3. Add coverage thresholds and a deployed-rules drift check to CI (F15).
4. Re-resolve multi-event objective admissibility when a taper or contribution window
   boundary falls inside the 7-day horizon, instead of carrying the `todayDate`-seeded set
   unchanged (Phase 5.6 residual).
5. Wire `FixedActivity.environment`/`equipment` into `resolveAvailability` and
   `reservedCapacityCost` into ranking/fatigue, or record an explicit decision that they
   should stay unconsumed (Phase 5.3 residual).
