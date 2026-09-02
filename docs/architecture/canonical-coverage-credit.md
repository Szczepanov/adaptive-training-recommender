# Canonical weekly coverage credit authority

**Status:** implemented by ADR-0034 PR 3 (`feat/canonical-coverage-credit`)

## Purpose

Weekly programming-role coverage must use the same canonical performed-training occurrence truth as recent-exposure spacing without collapsing the two concepts into one ledger.

The architecture deliberately separates:

1. **Occurrence identity** — `PerformedTrainingOccurrence` answers which provider/app records describe one physical session.
2. **Broad performed exposure** — `PerformedExposureFact` answers what can safely be said about the performed session for recency/spacing.
3. **Programming-role semantics** — `CoverageCreditFact` answers whether that occurrence satisfies an authored coverage role such as `primary_strength`.
4. **Coverage-state eligibility** — `buildCoverageState()` applies the active plan phase, rolling window, required/target counts, and dose constraints such as the aerobic minimum duration.

A downstream consumer must not use layer 2 to reconstruct a decision already made by layer 3.

## Why the semantic ledger is authoritative

A canonical exposure may carry an exact `workoutId`, but the programming role of that workout is coverage-set scoped. For example, `strength_bodyweight_full_body_01` is `primary_strength` in the evergreen general coverage set but `compact_strength` in the September cycling-event set.

Therefore the live path derives `CoverageCreditFact` using the same `CoverageSetDescriptor` that the recommendation decision will consume. `buildCoverageState()` then accepts only canonical exact credits whose `coverageSetId` matches the active descriptor.

This prevents a fact derived under one plan vocabulary from being silently reclassified under another.

## Canonical no-credit is also authoritative

`creditKind: 'none'` is an explicit semantic result, not missing data. A generic Garmin Strength activity can prove that strength happened for spacing while still failing to prove the exact full-body role.

When the canonical credit ledger is present:

- `exact` may satisfy the matching authored role;
- `semantic_confident` remains disabled in PR 3 until a separate policy defines it;
- `none` never satisfies a role;
- a credit for another `coverageSetId` never satisfies the active set;
- absence of a positive credit for an occurrence is authoritative and must not trigger a workout-id fallback.

This fail-closed behavior is what preserves the cutover plan's D1 separation between recency and exact role fulfillment.

## Legacy and projection compatibility

Forecasts and deterministic tests can contain hypothetical future completions that do not exist yet as canonical occurrences. Legacy/projected `CoverageHistoryEntry` values therefore continue to use descriptor lookup from `workoutId` / `templateId` when no canonical semantic ledger is present.

The distinction is structural:

- canonical performed facts with a `coverageCredits` ledger -> semantic ledger is authoritative, including an empty positive-credit set;
- legacy/projected history without that ledger -> existing descriptor lookup remains available.

An explicitly empty canonical performed-facts snapshot remains authoritative over legacy completed history.

### Prepared snapshots

The legacy Firestore `TrainingHistorySnapshot` builder does not yet embed descriptor-scoped performed facts. Reusing such a prepared snapshot therefore must not suppress the canonical occurrence read. `resolveTrainingIntent()` reuses embedded canonical facts only when their revision proves they were derived for the active coverage set; otherwise the live path re-fetches canonical facts for that descriptor.

Injected/custom history providers remain self-contained for deterministic tests and simulations and can continue to omit canonical facts.

### Week-ahead projections

The week-ahead planner keeps two histories on purpose:

- operational/projected history for fatigue, spacing and objective simulation;
- coverage history containing canonical completed role facts plus hypothetical projected entries.

Completed canonical facts are never reconstructed from the rolling planner's legacy history. Today/tomorrow/forecast recommendations are added with `source: 'projected'`, so they contribute to `projectedSessions` rather than falsely appearing in `completedSessions`.

This preserves canonical truth while still allowing hypothetical future sessions to participate in feasibility and weekly-role allocation.

## Dose and phase remain coverage-state concerns

Canonical role identity does not bypass existing plan constraints.

`buildCoverageState()` still verifies that a credited key exists in the active descriptor and phase. For `aerobic_volume`, it also preserves the catalog minimum-duration rule: knowing that an occurrence executed `cycling_zone2_standard_01` is not enough if the performed duration is below the authored minimum.

This keeps the semantic boundary clean:

- fact layer: *which role identity is proven?*
- coverage layer: *is that proven role eligible in this plan window and was enough dose performed?*

## Revision identity

`PerformedTrainingFactsSnapshot.revision` includes the active `coverageSetId` as well as the occurrence revision inputs. This is required because `coverageCredits` are descriptor-scoped semantic facts: the same physical occurrence can legitimately yield a different role set under `evergreen_general` and `september_cycling_event`.

Without coverage-set scope in the revision, two semantically different snapshots could alias in cache, audit, or replay consumers even though their `coverageCredits` differ.

## Invariants

1. One active canonical occurrence can award a given exact role at most once.
2. App + Garmin sources attached to one occurrence cannot double-count coverage.
3. Provider modality alone cannot invent exact role identity.
4. Canonical `none` cannot be resurrected by downstream workout-id inference.
5. Credits are valid only for the coverage set under which they were derived.
6. `semantic_confident` is observational only until an explicit policy enables it.
7. Phase and minimum-dose checks still apply after semantic cutover.
8. Legacy/projected histories retain their existing fallback because projected sessions may not have canonical occurrence facts yet.
9. Snapshot revisions cannot alias two coverage-set interpretations of the same occurrence set.
10. Prepared legacy history snapshots cannot suppress the live canonical fact read.
11. Rolling week-ahead projections cannot turn canonical completed facts back into legacy-derived role credit.
12. Hypothetical recommendations count as projected coverage, not completed coverage.

## Regression coverage

`canonicalCoverageCreditCutover.test.ts` covers the PR 3 acceptance matrix: exact full-body and bodyweight roles, compact-strength non-substitution, generic Garmin no-credit, app+Garmin deduplication, source-order independence, unknown/legacy observability, and authoritative empty canonical history.

`canonicalCoverageCreditAuthority.test.ts` adds architectural regressions for:

- canonical role differing from what a workout-id reclassification would infer;
- cross-coverage-set credit leakage;
- authoritative `creditKind: 'none'`;
- disabled `semantic_confident` credit;
- preservation of the aerobic minimum-duration gate;
- exposure-only projection/test compatibility;
- projected-vs-completed coverage accounting.

`trainingIntentCanonicalFacts.test.ts` verifies that prepared legacy snapshots do not suppress canonical reads, matching scoped facts are reused, and mismatched coverage-set facts are re-fetched.

`performedTrainingFactsService.revision.test.ts` verifies that empty and non-empty snapshots with identical physical-occurrence inputs receive different revisions when derived under different coverage sets.

## Rollout boundary

This PR cuts weekly role accounting to canonical semantic identity, but it does not remove all legacy recommendation-history reconstruction. Late-sync invalidation/history revision remains PR 4, and retirement of recommendation-specific reconciliation remains PR 5 under the existing cutover plan.
