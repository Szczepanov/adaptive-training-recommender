# Phase 0–5 completion review — 2026-08-09

## Scope and verdict

This follow-up verifies the implementation plans derived from
[`2026-08-08-architecture-review.md`](./2026-08-08-architecture-review.md) against
PR #16's code, with the audit work on `codex/phase-0-5-completion-audit`. The earlier
analysis remains a point-in-time record and is not edited.

**All Phase 0–5 work items are implemented.** The original review is fully closed for
F1–F10 and F13–F17. F11, F12, and F15 are only partially closed: the harness and key
correctness work landed, but the remaining calibration, fatigue-fusion, and operational
controls are not represented as finished work.

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
