> **Update 2026-09-05:** the recommendation below (bump samples) was
> implemented and confirmed the diagnosis, but also surfaced a real bug in
> `check-plan-judge-drift.mjs` itself — the dimension-level comparison had
> no noise-band awareness at all. See
> [2026-09-05-local-judge-vram-tuning.md](2026-09-05-local-judge-vram-tuning.md)
> for the fix and its results.

# Diagnosis: `judge:e2e:quick` regression after PR #387 / #388

## Summary

`npm run judge:e2e:quick` (local 4B AI plan judge, 5 samples, 13 sensitivity
families / 68 cases) reported a broad regression versus the committed
baseline (`docs/analysis/plan-judge-baseline.4b.json`, generated 2026-09-02):
overall mean score 7.73 → 7.54, with 13 of 17 notable family/dimension diffs
scored as regressions — most visibly `event_demand` (8.5 → 7.0, "priority
level doesn't meaningfully change the plan") and a recurring "underreacts to
adverse objective recovery" theme across `interactions`,
`conflicting_tissue_vs_wearable`, and `subjective_recovery`.

The baseline predates two merged engine PRs (2026-09-03): #387
(`fix(engine): enforce modality deprioritization in candidate ranking and
withhold evergreen intensity during adverse recovery`) and #388
(`feat(auth,engine): add first-class email authentication and wearable-free
recommendation support`, which also bumped `POLICY_VERSION`). Both were the
prime suspects.

**Conclusion: neither PR caused this. The regression is judge sampling
noise, not an engine behavior change.**

## How this was verified

Rather than trust the LLM judge's qualitative rationale at face value, the
actual engine output was diffed directly (no LLM involved) across three
commits, using the AI-judge corpus builder (`build-plan-judge-corpus.mjs`),
which runs the real planner against the same 68 fixed corpus cases:

- `59384c76` (parent of #387, i.e. pre-both PRs)
- `d5df6e7c` (#387 merged, #388 not yet merged)
- current `HEAD` (`bdeba354`, both PRs merged)

For every one of the 13 families, `categoryDistribution` and
`fatigueTierDayCounts` in `engineSummary` were **byte-identical** across all
three commits, for every case. Concretely:

- `event_demand`: the priority-A/B benefit multiplier (`1.40` vs `1.25` in
  `optimizer.ts`) *is* applied — internal `bestBenefitScore`/`selectedBenefitScore`
  diagnostics scale by exactly that ratio — but it never changes which
  candidate template wins the ranking. Selected sessions for
  `judge_demand_crit_A` and `judge_demand_crit_B` are identical. This code
  path is untouched by #387/#388's diff, so it's a **pre-existing property**
  of the ranking algorithm, not a regression.
- `interactions`, `conflicting_tissue_vs_wearable`, `subjective_recovery`:
  zero output differences at all across all three commits. #388's only
  change to the relevant code (`hasWearableObjectiveData` in `rules.ts`)
  affects rationale **wording** only when wearable data is *absent*; every
  corpus case here supplies full wearable data, so the new branch never even
  triggers.

Since the underlying plans are provably unchanged, the score deltas reported
by `check-plan-judge-drift.mjs` reflect run-to-run variance in a single
5-sample pass of a quantized local 4B model (`hf.co/empero-ai/Qwen3.8-4B-Distill-GGUF`),
not a code regression.

## Contrast with `persona:e2e`

The persona judge (9B model, 30 cases / 9 families) run the same day showed
a **net improvement** (8.49 → 8.71 overall, 8/9 families flat-or-up). This is
consistent with #387/#388 being genuinely-intended, reviewed changes with no
adverse side effects — the plan-judge's apparent regression doesn't fit a
coherent causal story tied to either PR, whereas persona's improvement does
line up with #387's stated intent (better modality/adverse-recovery
handling).

## Recommendation

No engine code change is warranted from this run. If plan-judge drift
detection is to be trusted going forward without manual re-verification
like this, consider:

1. Increasing `--samples` for `judge:e2e:quick` (currently 5) to reduce
   single-run variance before treating a drift-check regression as
   actionable, and/or averaging multiple fresh runs before comparing to
   baseline.
2. Noting in `check-plan-judge-drift.mjs`'s output that "regression" at low
   sample counts on a small quantized local model warrants an engine-output
   diff (as done here) before assuming a real behavior change — this repo's
   corpus/engineSummary tooling already makes that diff cheap and fast (no
   LLM calls needed), unlike this document's ad hoc reproduction.

No baseline update is needed here either: the current
`plan-judge-baseline.4b.json` already reflects the same engine behavior as
`HEAD`, so a fresh judge run against it should be treated as noisy rather
than re-baselined.
