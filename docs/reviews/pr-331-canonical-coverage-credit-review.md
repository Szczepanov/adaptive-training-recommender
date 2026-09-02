# PR 331 Review Note: Canonical Weekly Coverage Credit Cutover (PR 3 / ADR-0016 / ADR-0034)

**Date**: 2026-09-02
**Author**: Antigravity
**Branch**: `feat/canonical-coverage-credit`
**Status**: Ready for Review / Merge

---

## 1. Context & Motivation

Following the 2026-09-01 incident where an easy generic Garmin strength session was followed on 2026-09-02 by the recommender prioritizing `Reduced Full-body Strength Maintenance` (`str_full_03`) citing `Weekly Stimulus Target (Full-body Strength)`:
- **PR 1 (PR #328)** introduced canonical occurrence facts (`PerformedExposureFact` and `CoverageCreditFact`).
- **PR 2 (PR #329)** added resistance training spacing policy (`strengthSpacingPolicy.ts`) suppressing consecutive strength sessions.
- **PR 3** cuts weekly coverage credit derivation over to canonical occurrence truth (`resolveCoverageHistory()`) so that weekly role coverage and stimulus targets faithfully reflect performed structured workouts while preventing generic wearable strength from masquerading as catalog strength workouts.

---

## 2. Key Architectural Decisions

1. **Pure Functional History Resolution (`coverage.ts`)**:
   - Implemented `coverage.ts` `resolveCoverageHistory()`, which accepts both canonical performed training facts (`PerformedTrainingFactsSnapshot` / `CoveragePerformedFacts`) and legacy history.
   - When canonical facts are supplied (even if empty, representing zero sessions performed), they are strictly authoritative and do not fall back to legacy history.
   - Polymorphic handling allows both typed `PerformedExposureFact` and legacy `CompletedExposure` / `RecentHistoryEntry` without loss of duration, modality, or stable occurrence identity.

2. **Integration into Engine Entry Points**:
   - In `optimizer.ts` `buildOptimizationContext()`, `coverageState` is constructed from canonical occurrence facts via `resolveCoverageHistory(intent.performedTrainingFacts, intent.history)`.
   - In `rules.ts` `evaluateTrainingWithIntent()`, the evergreen coverage state builder now receives `resolveCoverageHistory(intent.performedTrainingFacts, intent.history)` rather than defaulting to empty history.
   - In `planner.ts` `evaluateProjectedDate()`, coverage state incorporates canonical completed coverage plus separately tagged projected history.

3. **Strict Coverage Identity Alignment**:
   - `primary_strength` in `EVERGREEN_GENERAL_COVERAGE_SET` is only fulfilled by exact full-body workouts: `strength_full_body_maintenance_01` and `strength_bodyweight_full_body_01`.
   - `strength_compact_power_01` awards `compact_strength` credit and never falsely satisfies `primary_strength`.
   - Generic Garmin strength emits `creditKind: 'none'` with `reasonCode: 'generic_modality_only'`, ensuring no false `primary_strength` credit is awarded.
   - Reconciled occurrences merging app execution and provider telemetry award exactly 1 credit, never 2.
   - Canonical credits are descriptor-scoped and only consumed for the active coverage set.

4. **Legacy occurrence identity remains idempotent**:
   - `CompletedExposure.occurrenceKey` is now preserved by `coverageHistoryFromCompletedExposures()`.
   - This is required because fallback coverage must distinguish two real executions of the same workout on the same day while still collapsing replay of the same occurrence.
   - Regression tests cover both directions: distinct occurrence keys count separately; repeated use of the same key counts once.

5. **Policy Version Bump**:
   - Bumped `policy.ts` `POLICY_VERSION` to `'2026-09-canonical-coverage-credit-v1'`.
   - Maintained immutable audit replay lineage by prepending `'2026-09-canonical-strength-spacing-v1'` to `HISTORICAL_POLICY_VERSIONS`.

---

## 3. Test Coverage

- Added comprehensive canonical cutover coverage in `canonicalCoverageCreditCutover.test.ts` and `canonicalCoverageCreditAuthority.test.ts`:
  - Exact `strength_full_body_maintenance_01` structured execution awards one `primary_strength` credit and drops need tier to 3.
  - Exact `strength_bodyweight_full_body_01` awards one `primary_strength` credit.
  - `strength_compact_power_01` does not award `primary_strength` credit.
  - Generic Garmin strength does not award `primary_strength` credit.
  - App + Garmin merged occurrence awards exactly one credit, not two.
  - Exact catalog identity survives source arrival in either order.
  - Unknown/legacy identity remains uncredited for `primary_strength` but observable.
  - `resolveCoverageHistory()` treats empty canonical array `[]` as authoritative over legacy history.
  - Cross-coverage-set credits fail closed.
  - `semantic_confident` remains disabled pending an explicit policy.
  - Aerobic minimum-duration gating survives the semantic cutover.
- Added `legacyCoverageOccurrenceIdentity.test.ts`:
  - two distinct same-day executions of the same exact workout remain two coverage credits;
  - replay of the same legacy occurrence key remains idempotent and counts once.

---

## 4. Verification

Earlier branch verification before the final occurrence-identity follow-up reported:

- `tsc -b`: 0 errors.
- `eslint .`: 0 warnings, 0 errors.
- `vitest run`: 348 test files passed (3,242 unit tests passing).
- `vite build`: production client bundle built successfully.
- sports knowledge claims & workout catalog validations: passed.

The final follow-up commits were reviewed source-first and add focused regression tests, but no GitHub Actions workflow run was attached to the latest head at review time. Do not treat the earlier executable verification as proof for those final commits; rerun the repository check/build pipeline before merge if CI does not start automatically.
