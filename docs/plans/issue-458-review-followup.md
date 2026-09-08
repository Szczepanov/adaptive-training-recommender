# Issue #458 — review follow-up and final diagnostic semantics

**Status:** final-review errata / implementation addendum

This note supplements `issue-458-sequencing-and-ranking-diagnostics.md`. The original plan is kept intact as implementation history, but several verification statements in it describe the **pre-review** implementation. This addendum is authoritative for the final PR semantics where the two documents differ.

## Why this addendum exists

A second review pass found several observability-only issues after the initial implementation and first corpus run. None changed recommendation selection, but they materially affect how the diagnostics should be interpreted. Preserving the original plan while recording these corrections avoids rewriting history and avoids leaving reviewers with stale conclusions.

## Final semantics

### 1. Adjacent cost-vector overlap is normalized

The original implementation aggregated adjacent overlap as:

```text
sum_d min(previous_decayed[d], current[d])
```

That is not a normalized similarity: its range grows with the number and magnitude of dimensions. The final implementation uses weighted Jaccard / Ružička similarity for the two non-negative cost vectors:

```text
sum_d min(previous_decayed[d], current[d])
------------------------------------------------
sum_d max(previous_decayed[d], current[d])
```

This is bounded to `[0, 1]`, while the dimension-specific lower-body, impact-tissue, and neuromuscular overlap fields remain raw values.

The normalization is a mathematical similarity measure, not a physiological safety threshold. A general reference for the non-negative-vector form is the generalized/weighted Jaccard (Ružička) similarity described here: https://pmc.ncbi.nlm.nih.gov/articles/PMC8567827/

### 2. Residual-fatigue collision is an alignment score, not absolute load

The source analysis intentionally defines:

```text
collision_t = sum_d(F_t[d] * C_t[d]) / max(epsilon, sum_d(C_t[d]))
```

That formula is **scale-invariant**. If the entire selected-session cost vector is scaled down while its dimensional shape stays the same, the collision score does not fall. Therefore a tiny session and a large session targeting the same highly fatigued dimension can have the same collision score.

The final diagnostic now emits `costMagnitude` next to `collision`. Consumers should interpret the pair together:

- `collision` = how strongly the selected cost vector is aligned with fatigued dimensions;
- `costMagnitude` = how much modeled session cost is being applied in total.

Consequently, the original plan's example wording that collision should be near 1 only for a "high-fatigue high-cost" pairing is too strong. High collision requires high fatigue **in the dimensions where cost exists**; it does not by itself establish that the session is large.

This distinction is consistent with the broader training-load literature: no single fatigue/load marker is a definitive decision rule, and monitoring must be interpreted in context rather than as a universal threshold. See Halson, *Monitoring training load to understand fatigue in athletes* (2014): https://pubmed.ncbi.nlm.nih.gov/25200666/

### 3. Tier blocking is separate from same-tier variety/recency reordering

A selected template can differ from the highest-utility accepted template for two conceptually different reasons in the current ranking pipeline:

1. an earlier lexicographic tier differs (`coverageNeedTier`, `recoveryPreferenceTier`, or `benefitTier`);
2. the existing same-tier variety/recency tie-break reorders near-equivalent candidates.

The first implementation counted both as `utilityWinnerBlockedCount`, even when every tier was identical. The final implementation separates them:

- `utilityWinnerDifferentCount`: all days where a strictly higher-utility accepted template exists;
- `utilityWinnerBlockedCount`: only the subset with at least one differing lexicographic tier;
- `utilityWinnerDifferentWithoutTierBlockCount`: same-tier differences, including the existing variety/recency path.

`meanBlockedUtilityGap`, `maxBlockedUtilityGap`, and `blockedByTier` are computed only over true tier-blocked days. This prevents a deliberate same-tier tie-break from being mislabeled as evidence against ordinal tier precedence.

### 4. Recovery placement crosses week boundaries correctly

`recoveryAfterHighCollisionCount` now examines the actual preceding scenario trace even when `weekIndex` changes. A recovery day on the first day of a new week can therefore be credited as following a high-collision day from the end of the previous week.

### 5. Ranking-disagreement reporting is day-level

`opportunityCost.perDay` retains compact disagreement details:

- date / week index;
- selected template id;
- highest-utility accepted template id;
- utility gap;
- exact tier-block booleans;
- whether the selected template advances the required-role proxy.

`npm run report:sequencing` now uses those details for the top-20 ordinal-vs-utility section. It no longer substitutes a case-level maximum when the acceptance criterion asks which concrete selections disagree.

## Verification status

The review follow-up adds regression coverage for:

- scale-invariant collision plus explicit `costMagnitude`;
- weighted-Jaccard/Ružička overlap normalization and `[0,1]` bounds;
- cross-week recovery placement;
- true tier blocking versus same-tier utility-winner differences;
- per-day opportunity-cost detail.

`sequencingMetrics.test.ts` now contains **20 tests** (the parent plan's `17` count was recorded before this review pass). `optimizer.rankingCounterfactual.test.ts` remains at 6 tests.

The full GitHub CI workflow passed on the review-fix code head, including frontend type/lint/static gates, the engine policy-drift gate, frontend unit coverage, Firestore emulator tests, Python checks/tests, and Docker build/compose smoke. This addendum is documentation-only; CI should still be treated as authoritative for the final PR head.

## Important: invalidate the pre-review corpus conclusion until regeneration

The parent plan records a first-run finding that the utility winner was "blocked" on most days in several cases, often by benefit tier. Because the review pass corrected the definition of `utilityWinnerBlockedCount` and normalized adjacent overlap, **do not use those pre-review counts as evidence for a ranking-policy change**.

Before any follow-up ADR or ranking-precedence experiment, regenerate the corpus and report from the final PR head:

```bash
cd app
npm run build:plan-judge-corpus
npm run report:sequencing
```

Only the regenerated day-level tier-blocked cases should be used to estimate how much opportunity cost is actually attributable to coverage/recovery/benefit tier boundaries.

## Interpretation guardrail

This PR remains an observability PR. It does not establish that clustered hard sessions are inherently wrong, that a particular collision/overlap value is unsafe, or that a pure-utility winner should replace the lexicographic selection. Successful endurance programs can intentionally concentrate key work while protecting recovery days; sequencing must be interpreted relative to phase, event demands, athlete response, and hard constraints. See Sandbakk et al., *Best-Practice Training Characteristics Within Olympic Endurance Sports as Described by Norwegian World-Class Coaches* (2025): https://pubmed.ncbi.nlm.nih.gov/40278987/

Any move from diagnostics to a live ranking/spacing policy still requires corpus evidence and the follow-up ADR already called for by the parent analysis.
