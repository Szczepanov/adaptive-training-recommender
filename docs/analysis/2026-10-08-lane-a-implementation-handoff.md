# Lane A: issue #897 implementation handoff

**Date:** 2026-10-08
**Evidence baseline:** current worktree `96cdca04`; GitHub issue and PR state fetched on this date.
**Scope of this artifact:** analysis and implementation handoff, not a new delivery status board. Delivery status remains in `docs/plans/README.md` and `docs/plans/performance-outcome-validation.md`.

**Outcome (2026-10-09):** WP6.6 is implemented. `make verify` passed; the desktop/mobile visual suite passed 96 checks; the focused Firestore suite passed 37 tests, including provenance and correction cases; the fixed-load browser journey passed. An independent diff review found no remaining issues. #897 remains open for WP8. Browser reload/offline retry was verified after starting online; cold-offline launch and real-device storage eviction were not checked. The repository-state findings below describe the 2026-10-08 baseline, before this implementation.

## Decision and sequence

Continue [#897](https://github.com/Szczepanov/adaptive-training-recommender/issues/897), with **WP6.6 fixed-load velocity series as the next implementation slice**.

[Tracker #962](https://github.com/Szczepanov/adaptive-training-recommender/issues/962) records ordering rather than current delivery. Its PR B2 checkbox and the local status documents are stale: [PR #963](https://github.com/Szczepanov/adaptive-training-recommender/pull/963) merged on 2026-10-01, and its importer is present in this worktree. [PR #984](https://github.com/Szczepanov/adaptive-training-recommender/pull/984) subsequently delivered parser-v2 rep-boundary hardening. Do not reimplement B2 or silently switch historical parser semantics.

Recommended order:

1. WP6.6 under accepted ADR-0047, with focused capture/reload/retry verification before the 19–25 October baseline.
2. Resolve any demonstrated offline capture loss as a bounded follow-up coordinated with #895; do not infer that structured-session entry durability covers assessment drafts.
3. PR D / WP8 measured-strength goal bridge, block review, and relevant planning Context Brief evidence. Coordinate the versioned brief contract with #813 and #893.

#897 stays open after WP6.6 because WP8 remains part of its acceptance criteria. A future WP6.6 PR must use `Refs #897`, not `Closes #897`.

## Verified current implementation

- `physicalCapitalProtocols.ts` owns immutable physical-capital protocol revisions; `performanceTestingCatalog.ts` supplies athlete-facing definitions and SessionRunner execution.
- `registry.ts` has no `strength_fixed_load_mean_velocity_mps`; `models.ts` / `protocols.ts` have no `test_load_kg` comparison dimension. The dedicated fixed-load protocol IDs are absent from runtime source and Firestore rules.
- `velocityFileImport.ts` `hasVelocityImportSchema` and `velocityProposalToDraftRow` already provide source-neutral WL/OpenBar import gates and bounded draft mapping. Reuse the existing field contract: `load_kg`, `mean_concentric_velocity_mps`, `peak_velocity_mps`, and `successful`.
- `openBarAnalysisImport.ts` `velocityMeasurementMethodId` already resolves WL parser-specific, OpenBar configuration-specific, or manual identities. It rejects incomplete imported provenance. New WL capture uses parser v2; v1 remains replayable.
- `assessmentReducers.ts` `reduceAssessmentTrials` reduces active correction heads, ignores non-valid trials, selects deterministic winners, and records source trial IDs and reducer version. Its `max_valid` reducer does not itself inspect success, locked load, or measurement method.
- `assessmentDerivation.ts` `deriveTrialObservationRevisions` currently receives comparison context separately from trials. Method/load consistency must be checked before reduction/persistence; a user-entered context must not relabel imported evidence.
- `assessmentHistory.ts`, `assessmentProgress.ts`, and `assessmentCsvExport.ts` own existing longitudinal interpretation/export. Do not introduce another trend engine.
- `assessmentExportService.ts` and `assessmentHistoryService.ts` depend on `PHYSICAL_CAPITAL_PROTOCOL_REVISIONS`; adding only catalog cards would omit the new protocols from diagnostic/history reads.

## Implement WP6.6

Use [ADR-0047](../adr/0047-fixed-load-velocity-assessment-series.md), accepted Option A, and [the existing scoped plan](../plans/2026-09-30-issue-897-physical-capital-assessment-history.md) WP6.6. ADR-0046 remains the raw-trial/correction/provenance contract.

1. Add metric `strength_fixed_load_mean_velocity_mps` (`m/s`, `higher_is_better`) and numeric comparison dimension `test_load_kg`. Update registry/rules parity and focused tests together. Retain existing observation identity `${attemptId}:${metricId}`.
2. Add immutable revision-1 protocols `strength-bench-press-fixed-load-velocity` and `strength-back-squat-fixed-load-velocity`. Require exact absolute load, method identity, and equipment/setup identity as series-defining dimensions. Declare 2–3 maximal-intent repetitions, exercise-specific technique/safety instructions, and the complete velocity-import capture schema. Reuse existing session/catalog patterns and supported revision inventories. Do not mutate published 1RM protocols or their shared capture objects.
3. Bind benchmark-eligible trials to the declared load and actual method. A mismatched load can remain practice/invalid audit evidence but cannot become a valid benchmark. Failed, practice, questionable, or invalid trials cannot supply the canonical result. Mixed imported methods cannot be numerically blended or silently relabeled as manual. Reuse `velocityMeasurementMethodId` for WL/OpenBar provenance rather than duplicating its rules.
4. Reduce to the highest eligible **mean concentric velocity**, with deterministic source-trial and algorithm provenance. Prefer existing reducers with explicit validation; extend the bounded reducer contract only if existing semantics cannot express the accepted requirement. Preserve correction and retry behavior and Firestore parity for any extension.
5. Make the dedicated tests available through the existing Testing workflow, history, normalized CSV, and diagnostic JSON. Changed load, parser/method, setup, or incompatible protocol establishes a separate/non-comparable series rather than a numerical trend. Missing reliability evidence must not be replaced with invented noise thresholds.
6. Refresh the existing status owners to record B2 as shipped and WP6.6's actual resulting state. Keep WP8 open. Update living performance-outcome architecture where behavior changes.

### Owned implementation boundary

The implementation agent owns the cohesive WP6.6 slice in `app/src/observations/`, affected assessment services, Testing components, `app/firestore.rules`, focused unit/emulator/E2E fixtures, and directly relevant documentation. It is not alone in the codebase: preserve unrelated edits and accommodate concurrent work.

Reuse `TrialCaptureTable.tsx`, `WlAnalysisImportPanel.tsx`, `OpenBarImportPanel.tsx`, `TestingWorkflow.tsx`, `assessmentCaptureService.ts`, `assessmentTrialService.ts`, and existing catalog/read-model code. Follow compiler errors for the added comparison union member rather than duplicating broad discovery.

Exclude engine selection, new training authority, e1RM replacement, PR D consumers, a general assessment outbox, raw file/video storage, new dependencies, multi-instance observation keys, and synthetic companion attempts from 1RM trials. Evidence-only work should not require a policy-version bump; reassess if a change reaches recommendation behavior.

## Offline boundary: unresolved release evidence

`assessmentDraftStorage.ts` stores UID/attempt-scoped **trial rows**, including imported provenance and local review flags. `TrialCaptureTable.tsx` saves/restores them and clears them after successful save. Browser storage failures are swallowed, so this is conditional local recovery rather than guaranteed durability.

`TestingWorkflow.tsx` keeps comparison setup in React state. Its `startTest` validates that setup but creates an `AssessmentAttempt` without storing it. The row draft does not separately preserve shared comparison setup/default device. Reload recovery for complete fixed-load evidence therefore needs verification; row recovery alone does not establish it.

Final capture is a multi-stage service flow: transaction-backed trial creation, canonical observation writes, then attempt completion. It is not one atomic transaction for the whole assessment. Completed-parent eligibility prevents interrupted saves from entering progress. [Firebase's transaction documentation](https://firebase.google.com/docs/firestore/manage-data/transactions), fetched through Context7 for the installed Firebase 12.19.0 integration, confirms transactions fail offline. Preserve integrity and idempotent retry rather than substituting unconditional offline writes.

Before calling the gym flow ready, demonstrate: import/manual entry; reload with values, provenance, review flags and comparison identity intact or explicitly recoverable; offline save failure without draft loss or false completion; reconnect/retry with one canonical observation and no duplicate physical occurrence. Also distinguish starting online and later losing connectivity from a cold offline launch. Real-device/browser-storage eviction behavior remains a manual check.

If this exposes an architecture-level durability gap, report it against the tracker/#895 coordination item instead of silently expanding WP6.6. The October baseline can already capture raw 1RM velocities; fixed-load series extend longitudinal monitoring, while capture reliability is the immediate operational concern.

## Verification and handback

- Focused tests: registry/protocol/capture validation; exact-load mismatch; failed/invalid/practice trials; deterministic winner/provenance; imported method separation including WL v1/v2 and OpenBar/manual; corrections; immutable historical protocols; comparable/non-comparable history and both exports.
- Extend `firestoreRulesParity.test.ts` and `assessmentTrialRules.emulator.test.ts` for metric/dimension persistence, ownership, and rejected invalid evidence paths.
- Extend `app/tests/e2e/testing-physical-capital.pw.ts` for a dedicated fixed-load attempt through capture, completion, history/export, and the relevant reload/retry states.
- Run `npm run typecheck` (`tsc -b`), lint, focused tests, rules/E2E via repository-managed leased emulators, and finish with `make verify`. Follow `docs/standards/ui-ux.md` and review affected mobile/desktop visual states.
- Use one diff-first code review after implementation. Give the reviewer this scope and changed paths; do not repeat broad discovery. Report changed files, acceptance evidence, actual check results, and remaining durability/PR D limitations.

At the time of the 2026-10-08 analysis, runtime tests and real gym/offline behavior had not been verified. Existing implementation presence and merged status were established from source and GitHub evidence, not a claim that those flows passed then.
