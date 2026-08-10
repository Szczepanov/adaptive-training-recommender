# Phase 0–5 completion review — 2026-08-09

## Scope and verdict

This follow-up verifies the implementation plans derived from
[`2026-08-08-architecture-review.md`](./2026-08-08-architecture-review.md) against
PR #16's code, with the audit and Phase 6 planning work on
`codex/phase-0-5-completion-audit`. The earlier analysis remains a point-in-time record
and is not edited.

**Phases 0–5 are implemented; F11, F12, and F15 remain the only findings not fully
closed.** The original review is fully closed for F1–F10, F13–F14, and F16–F17. F11, F12,
and F15 are only partially closed: the harness and key correctness work landed, but the
remaining calibration, fatigue-fusion, and operational controls are not represented as
finished work.

Two further gaps surfaced during Phase 5's own implementation and were not original review
findings. Both are now closed by Phase 6.2, landed in this same PR:

* **Multi-event objectives were not re-resolved mid-horizon.** `planner.ts`'s
  `generateWeekAheadPlan` seeded `microcycle.objectives` once at `todayDate` and carried
  that set unchanged through the rest of the 7-day loop. Fixed by `reconcileObjectivesForDate`
  (new), which re-resolves the day's objective definition before ranking every day the loop
  itself picks a template, reconciling onto the running credit ledger by `ObjectiveKey`
  (D6-A). This transitively also fixed same-event Build→Specificity/taper transitions the
  original Phase 5.6 gap description didn't single out, not only multi-event ones.
* **Fixed activities were calendar blockers but not projected exposures.** `schedule.ts`
  computed a scalar `reservedCapacityCost` that nothing consumed, and `expectedStimulus`
  was never projected into objective credit. Fixed by a dimensional
  `reservedCapacityCostProfile` (D6-C: no invented default), consumed by planner.ts's
  same-day ranking and, at end of day, folded into next-day fatigue and objective credit
  through the same canonical credit primitive as a structured exposure. `environment`/
  `equipment` remain activity-only metadata (D6-B); a true day-wide restriction requires an
  explicit new `FixedActivity.availabilityContextOverride`, not the activity's own venue
  fields.

Neither residual was folded into F11/F12/F15 (they are Phase-5-scope behaviours, not
calibration work), and Phase 5's `Implemented` status was not reopened to track them, per
the plan given in the prior revision of this document. See
[`phase-6-evidence-and-operational-assurance.md`](../plans/phase-6-evidence-and-operational-assurance.md)
6.2a/6.2b for the full change description and test list.

PR #17 has now landed Phase 6.1 (baseline ownership) and 6.2 (both correctness
carryovers): normal scenario runs no longer overwrite the committed semantic baseline,
baseline updates require the explicit reviewed command, CI verifies the baseline remains
unchanged during normal simulation, and `POLICY_VERSION` is bumped to
`2026-08-phase6-correctness-carryovers-v1` for the 6.2 behavior change (the preceding
`2026-08-phase5-sequence-planning-v1` version is now itself historical/audit-only, with
replay regression coverage added for that classification).

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
| *(not a review finding)* — 5.6 mid-horizon re-resolution | Closed (Phase 6.2a) | `reconcileObjectivesForDate` (`planner.ts`) re-resolves objective admissibility per projected day and reconciles credit by `ObjectiveKey` (D6-A); dated drop trace via `DroppedContributorObjective.date`. Covered by `planner.test.ts`'s "Phase 6.2a" tests. |
| *(not a review finding)* — 5.3 fixed-activity projection | Closed (Phase 6.2b) | `schedule.ts`'s `reservedCapacityCostProfile` is consumed by planner.ts's same-day ranking and end-of-day fatigue/credit projection; `availabilityContextOverride` gives day-wide restriction explicit semantics (D6-B/D6-C). Covered by `architecture.test.ts` and `planner.test.ts`'s "Phase 6.2b" tests. |

## Verification performed

| Check | Result |
|---|---|
| `npm run check` | Passed after Phase 6.2: TypeScript, ESLint, 502 unit tests (26 skipped), and workout validation. |
| `npm run test:rules` | Passed: 26 Firestore emulator tests (unchanged -- 6.2 touches no `firestore.rules`). |
| `npm run simulate:scenarios` | Passed: 11 scenarios completed and the aggregate gate passed. |
| `npm run simulate:diff` | Semantic diff reviewed and explained (six A-event scenarios' weekly `threshold_quality` target correctly drops once mid-week taper stops demanding it; stressed-trajectory category mix shifts because a race-specific session now lands on the correct side of a phase boundary) and folded into the reviewed baseline via `simulate:update-baseline -- --reviewed`. `simulate:diff` now reports no differences against the committed baseline. |
| `npm run compare:sequence-search` | Both greedy and beam search had zero constraint and golden-week violations; the production decision to retain greedy remains documented in ADR-0015. |
| `uv run pytest`, `uv run ruff check .`, `uv run mypy src/garmin_sync` | Passed: 86 Python tests, lint, and type checking (no Python files touched by 6.2). |
| `node app/scripts/check-policy-drift.mjs origin/main` | Passed: `planner.ts`/`periodization.ts`/`schedule.ts`/`models.ts` changed and `policy.ts`'s `POLICY_VERSION` was bumped in the same commit. |

`simulate:diff` is once again an independent comparison after Phase 6.1: the preceding
`simulate:scenarios` command no longer rewrites its baseline input. CI additionally runs
`git diff --exit-code -- ../docs/analysis/simulation-baseline.json` immediately after the
scenario gate, so a future accidental baseline write is blocking rather than silently
self-approving the diff.

## Remaining work

The detailed execution plan is
[`phase-6-evidence-and-operational-assurance.md`](../plans/phase-6-evidence-and-operational-assurance.md).
In priority order:

1. **Expand the deterministic scenario contract (6.3).** Add multiple events, initial
   history, fixed activities, date-level readiness, and targeted cases exercising the two
   now-closed carryovers plus load/readiness/evidence boundaries.
2. **Build the F11 evidence layer (6.4).** Add daily decision traces, a synthetic
   policy-regression corpus, and a reproducible trigger-frequency report. Do not market
   synthetic cases as physiological calibration and do not auto-tune thresholds.
3. **Add coverage visibility (6.6).** Publish frontend/backend coverage in CI without an
   arbitrary global threshold.
4. **Close Firestore deployment assurance (6.5)** once the production project and
   deployment owner are known.
5. **Revisit fatigue fusion (6.7) only after evidence exists.** Production `max()` remains
   valid unless a documented failure mode and a contract-safe candidate justify a change.

Phase 6.1 (baseline ownership) and 6.2 (both Phase 5 correctness carryovers) are complete
in this PR and are no longer part of the remaining work list.
