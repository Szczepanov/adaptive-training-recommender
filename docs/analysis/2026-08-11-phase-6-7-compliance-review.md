# Phase 6 and Phase 7 compliance review

**Date:** 2026-08-11  
**Repository state reviewed:** `85c4f76f1165a916cdab76d25d52c2453494b5df`  
**Scope:** Phase 6 evidence/operations, Phase 7A weekly allocation, and Phase 7B training-intent and planning modes.  
**Method:** source and architecture review, plan/ADR cross-check, fresh local validation, emulator execution, synthetic-scenario evidence, and a read-only production Firestore-rules comparison. This is a point-in-time engineering audit, not physiological or clinical validation.

## Verdict

The repository is **functionally compliant with the delivered Phase 6 and Phase 7 work** at the reviewed commit. All fresh validation commands passed, the production Firestore release matched repository rules at the time of review, and the tested engine behavior implements the two accepted Phase 7 ADRs.

Two plan-governance defects and two missing direct regression guards remain:

1. The Phase 7A plan's header says `Approved`, while every work item and acceptance criterion is complete and the plan index says `Implemented`.
2. The Phase 7B plan's header and task board say `Implemented`, while all twelve acceptance checkboxes remain unchecked.
3. The suite does not contain an immutable snapshot/byte-equality guard for `SEPTEMBER_CYCLING_EVENT_SESSION_COVERAGE`; its preservation is supported by current source shape, but is not mechanically proved against a frozen reference.
4. The intended architectural rule that only `planningMode.ts` derives planning mode is documented and followed by the inspected flow, but no static architecture test enforces it.

These are documentation and assurance gaps, not demonstrated recommendation-engine regressions. They should be resolved before treating plan status as the sole evidence of Phase 7 completion.

## Evidence captured

| Check | Result |
|---|---|
| `npm run check` | Passed: TypeScript, ESLint, 715 passing tests, 34 skipped tests, and workout validation (53 exercises, 37 workouts, 16 bindings, 25 session families). |
| `npm run test:rules` | Passed: 34 Firestore emulator tests. |
| `npm run test:coverage` | Passed: frontend V8 coverage 80.34% statements, 75.27% branches, 84.66% functions, 82.31% lines. No threshold is implied by these figures. |
| `uv run pytest --cov=garmin_sync` | Passed: 86 tests; backend coverage 72%. |
| `uv run ruff check .` and `uv run mypy src/garmin_sync` | Both passed. |
| `npm run simulate:diff` | No changed pre-existing baseline scenario was reported. Eleven Phase 6/7 scenarios were reported as new, including the three evergreen fixtures. |
| `npm run simulate:calibrate` | Passed: 24 synthetic scenarios and 413 simulated days; generated a derived-only calibration report. |
| `npm run simulate:fatigue-fusion` | Passed: exercised production `max` and simulation-only `additive` fusion through the real planner. |
| `npm run firestore:rules:drift` | Passed: deployed default Firestore release and local `app/firestore.rules` shared SHA-256 `f48b3c31d8cf659e63c9fd5d313909945159a020b39d4bb68045490b4bf693e5`. |

Generated calibration, coverage, fatigue-comparison, and local rollback artifacts are ignored by Git. The working tree was clean before writing this review.

## Phase 6

| Item | Assessment | Verified implementation and evidence |
|---|---|---|
| 6.1 Baseline ownership | Pass | `simulate-scenarios.mjs`, `simulate-diff.mjs`, and `simulate-update-baseline.mjs` separate report generation, comparison, and reviewed mutation. CI runs the scenario generator then rejects a changed committed baseline. |
| 6.2 Correctness carryovers | Pass | `planner.ts`, `periodization.ts`, `schedule.ts`, and their integration tests implement date-specific multi-event re-resolution and fixed-activity time, credit, and dimensional-load semantics. `architecture.test.ts`, `planner.test.ts`, and `trainingIntentAcceptance.test.ts` cover conservative missing load, no double-counting, live day-0/day-1 handling, and explicit day-wide travel context. |
| 6.2c Credit versus weekly coverage | Pass | `coverage.ts`, `fixedActivityIdentity.ts`, `planSchedule.ts`, and `coverageOccurrence.test.ts` preserve exact authored programming-role identity separately from adaptation credit. The Phase 7A allocator is the recorded resolution for the historical role-loss interaction. |
| 6.3 Scenario contract | Pass | `simulation/scenarios.ts` supports plural events, initial history, fixed activities, date-level readiness, preference/profile inputs, and tagged synthetic cases. The current corpus includes multi-event, travel, external-load, completion-confidence, and reduced-capacity boundaries. |
| 6.4 Traces and calibration evidence | Pass | `simulation/analyze.ts` emits one compact derived trace per simulated decision and `buildCalibrationReport` aggregates modes, gates, fixed-activity activation, objective outcomes, and contributor transitions. The fresh report covers 24 cases / 413 simulated days and explicitly labels itself non-clinical. |
| 6.5 Rules authority and drift | Pass with operational limitation | `check-firestore-rules-drift.mjs`, `deploy-firestore-rules.mjs`, and `rollback-firestore-rules.mjs` implement the selected local-operator workflow. The reviewed production release was `projects/adaptive-training-recommender/releases/cloud.firestore`, pointing to ruleset `8564ac3b-05c3-45eb-aa10-0cc4834ac496`, and matched local source. `firestore-rules-deployment.md` documents test, pre/post comparison, explicit confirmation, and rollback. |
| 6.6 Coverage visibility | Pass | `vite.config.ts` writes V8 text/JSON/HTML frontend reports; `.github/workflows/ci.yml` publishes frontend and Python artifacts. The fresh frontend and backend coverage runs succeeded without a vanity threshold. |
| 6.7 Fatigue-fusion evidence gate | Pass | `fatigue.ts` defaults production callers to `max`; `runFatigueFusionComparison` invokes the real planner under a simulation-only `additive` selector. The fresh 24-case comparison recorded 167 changed selections, 299 higher peak-fatigue days, 21 additional rest/recovery selections, seven additional objective misses, and no reduction in constraint violations. Retaining `max` is evidence-backed. |

### Phase 6 operational qualification

The local workflow is intentionally not a protected GitHub environment or scheduled CI check. It satisfies the repository's current, owner-selected manual deployment model because deployment is explicit, rules-only, tested, hash-verified, and rollback-capable. It does **not** independently detect console drift while the operator is absent, enforce a second-person approval, or retain a central deployment audit trail. Those are sensible future operational upgrades if deployment ownership expands; they are not a failed Phase 6 code contract.

## Phase 7A — weekly allocation and safe role reservations

### Verified behavior

`weeklyAllocation.ts` implements ADR-0018's exact-occurrence ledger, deterministic bounded stateful search, typed outcomes, and explicit unresolved-search-budget state. `planner.ts` calls the shared `evaluateProjectedDate` seam for both allocation and greedy forecast selection, recomputes reservations after each planned day, protects reserved dates, and lets true recover-tier behavior override allocation.

The allocation report is not inferred from selected sessions after the fact:

- `WeekAheadPlan.allocationReport` carries the typed source outcomes;
- `simulation/analyze.ts` preserves them in every simulated week and treats an untyped miss as a quality warning;
- `simulate-scenarios.mjs` renders status, reason, and moved-date evidence from that report; and
- `WeekAheadStrip.tsx` renders the same forecast evidence without presenting it as completed training.

`weeklyAllocation.test.ts` covers exact identity, distinct-date placement, jointly infeasible assignments, safety versus projected-fatigue attribution, relocation, deterministic caps, and bounded-search behavior. `weeklyAllocationPlanner.test.ts` covers the shared gate path, discretionary-support protection, determinism, and the stated p95/p99 performance gate. The fresh test run passed.

The scenario assertions in `scenarios.test.ts` cover healthy Build/Specificity fulfillment, fresh versus stressed behavior, recovery-clear behavior, typed misses, and no dangling forecast reservations. The fresh semantic diff reported no changed existing baseline fixture.

### Compliance assessment

Functionally, 7A passes its acceptance contract. The only noncompliance is documentary: `phase-7-weekly-allocation-and-role-reservations.md` has all work items and acceptance checks complete, while its header remains `Approved`. This contradicts `docs/plans/README.md`, which already lists 7A as `Implemented`.

## Phase 7B — training intent, capacity, and first-class modes

### Verified behavior

| Requirement area | Evidence |
|---|---|
| Persisted intent and ownership | `TrainingIntentProfile` is modelled in `models.ts`, strictly validated in `validation.ts`, stored through `trainingIntentProfileService.ts`, and protected by `firestore.rules`. `trainingIntentProfileService.test.ts` and the emulator test cover shape, ownership, timestamps, capacity bounds, and extraneous fields. Composer input carries profile and preferences independently rather than merging their fields. |
| Effective planning mode | `planningMode.ts` owns `resolvePlanningContext`: an eligible legacy/no-profile event remains event-directed; explicit evergreen suppresses event strategy; no eligible event becomes evergreen. `planningMode.test.ts` verifies structured cycling and demand-derived non-cycling event capability. |
| Dose before capacity/packing | `evergreenStrategy.ts` derives requirements and provenance before `trainingCapacity.ts` resolves usable windows; `weeklyDosePacking.ts` then packs only exact authored roles. `trainingCapacity.test.ts` proves equal session counts can have different usable minutes; `weeklyDosePacking.test.ts` proves distinct shortfall semantics. |
| Evergreen coverage | The named `EVERGREEN_GENERAL_COVERAGE_SET`, `EVERGREEN_PACKING_COVERAGE`, `planSchedule.ts`, and `coverage.ts` produce a non-empty eventless coverage state. `evergreenPlan.test.ts` proves an eventless eligible template does not stay at constant tier 3 and that strength development needs an explicit packed evergreen requirement. |
| Taper containment | `taperPolicy.ts` refuses a priority-derived taper for `general_target` while retaining a cycling event default. `taperPolicy.test.ts` covers both no-taper and explicit-taper paths. |
| Surface and scenario integration | `Preferences.tsx`, `trainingIntentProfileService.ts`, `WeekAheadStrip.tsx`, and the architecture document describe the split. The fresh synthetic run included 2-session health, 4-session balanced, and 6-session strength-leaning evergreen fixtures. |
| Policy and compatibility | `policy.ts` records current `2026-08-session-packing-tiebreaker-v1` and retains Phase 7 historical policy versions. The fresh semantic diff reported only new Phase 6/7 fixtures and no existing scenario changes. |

The fresh calibration report is also consistent with the Phase 7B boundary: the three evergreen scenarios run as explicit-profile cases, while old profile-less event-directed fixtures remain in the baseline comparison set.

### Acceptance evidence that is indirect or missing

The implementation and fresh validation support most 7B acceptance claims, but the plan's unchecked list should not be mass-converted to completed without recording the following qualifications.

- **Profile-less eventless coherent week:** `planningMode.test.ts` proves mode resolution and the existing `no_event_base_phase` scenario runs across the shared simulation path, but there is no single named acceptance test that asserts the complete no-profile, no-event week is coherent and non-empty. The evidence is indirect, not absent.
- **September coverage immutability:** current code retains `SEPTEMBER_CYCLING_EVENT_SESSION_COVERAGE` as the event-directed descriptor, but no test compares it to a frozen canonical snapshot. This is the clearest missing direct regression guard.
- **Mode-authority exclusivity:** comments and the inspected call graph keep mode derivation in `planningMode.ts`; no static test prevents a future module from reintroducing `focusEvent === null` as a mode decision.
- **Plan status:** all 7B acceptance criteria remain unchecked despite the plan header and task board claiming implementation. The checkboxes should be resolved individually with the evidence above, preserving the two direct-test gaps rather than treating them as passed by status alone.

## Documentation and assurance actions

These actions follow from the audit; none requires a recommendation-policy redesign.

1. Change the 7A plan header from `Approved` to `Implemented`, or explicitly state why a fully accepted and delivered plan is not implemented.
2. Reconcile 7B's acceptance checkboxes with specific test/script evidence. Mark only claims that are actually demonstrated.
3. Add a frozen serialization/snapshot regression for `SEPTEMBER_CYCLING_EVENT_SESSION_COVERAGE`.
4. Add a focused architecture test that rejects planning-mode derivation outside `planningMode.ts` (prefer an AST-aware check over an unrestricted text search).
5. If local Firestore deployment remains the operating model, schedule the existing read-only drift command on the operator machine and retain its output, or explicitly accept that drift detection is pre-deployment/manual only.

## Conclusion

Phase 6 is implemented and operational under its selected local deployment model. Phase 7A and 7B are implemented in code and pass the fresh test/simulation evidence reviewed here. The repository should not create a new Phase 8 merely to redo this work. The appropriate follow-up is narrow: correct Phase 7 plan status/evidence bookkeeping and add the two missing regression guards.

