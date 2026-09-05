# Local AI-judge throughput tuning (VRAM headroom)

## Motivation

The [`judge:e2e:quick` drift diagnosis](2026-09-04-judge-e2e-quick-drift-diagnosis.md)
concluded that PR #387/#388 caused no real engine regression — the
apparent regression was sampling noise from a single 5-sample run of a
local 4B model. The fix for that noise is more samples per case, which
costs more wall-clock time on the same hardware. Before just cranking
`--samples` up on an already ~40-minute run, the local GPU (RTX 3060 Ti,
8GB VRAM) was checked for spare headroom to also raise `--concurrency`,
offsetting the added sample cost.

## What was actually measured (not assumed)

All local model calls run through Ollama (`localhost:11434`, v0.33.3).

1. **Actual token usage vs. configured context window.** `judge:e2e:quick`
   was configured with `--ctx 84000`, but `judge-attempts.jsonl` from the
   run that triggered this investigation showed real usage never exceeded
   54,261 total tokens (prompt + completion) across all 65 recorded
   attempts — 65% of the allocated window. The gap between allocated and
   used context is pure wasted VRAM (KV cache is sized off `num_ctx`, not
   actual usage).
2. **VRAM cost of that context window.** Loading the 4B model
   (`hf.co/empero-ai/Qwen3.8-4B-Distill-GGUF`) at `num_ctx=84000` measured
   5.66GB VRAM (`ollama ps` `size_vram`) — model weights are only ~2.65GB
   on disk, so ~3GB of that is KV cache for a context window mostly going
   unused.
3. **Concurrency headroom, empirically fired at the target context size**
   (not inferred from docs): with `num_ctx` right-sized to 70,000 (28%
   margin over the observed 54,261-token max), firing 3 concurrent
   requests measured **5.1GB VRAM used, 2.9GB free**, at 91% GPU
   utilization — confirmed under the real `judge:e2e:quick` workload
   itself (not just synthetic test calls), with all 3 families genuinely
   processing in parallel rather than queueing.
4. **9B model (used by the non-`--quick` `judge:e2e` and `persona:*`
   scripts) at its existing `--ctx 65536`:** 2 concurrent requests
   measured 5.92GB used / 2.1GB free — tighter than the 4B case, but with
   confirmed room for concurrency=2 (previously unset, defaulting to the
   config's `concurrency: 1`).

Every one of these numbers came from `nvidia-smi` and `ollama ps` reads
during live requests, not from documentation or guesses about model size.

## Changes made (`app/package.json`)

| Script | Before | After | Why |
|---|---|---|---|
| `judge:e2e:quick` / `:resume` | `--samples 5 --ctx 84000 --concurrency 2` | `--samples 10 --ctx 70000 --concurrency 3` | Doubles samples to cut single-run judge noise (the actual ask); rightsizing `--ctx` down to a value still 28% above observed max usage funds the concurrency increase from 2→3 without changing total VRAM footprint materially (5.1GB vs the original 5.66GB single-slot figure) |
| `judge:e2e` / `:resume` | no `--concurrency` flag (defaults to 1) | `--concurrency 2` | Confirmed 2.1GB headroom at the existing `--ctx 65536` for the larger 9B model |
| `persona:local:stability` | no `--concurrency` flag (defaults to 1) | `--concurrency 2` | Same 9B model, smaller default `--ctx` (32768) than `judge:e2e`, so 2-way concurrency has more headroom than the case just measured |
| `judge:e2e:32k` | `run-ai-judge.mjs--provider` (missing space — script was non-functional) | `run-ai-judge.mjs --provider` | Unrelated pre-existing typo found while reading this section; trivial one-line fix |

## Validation

Re-ran `judge:e2e:quick` with the new settings end-to-end. Confirmed via
`ollama ps` and `nvidia-smi` mid-run that the model loaded at
`context_length: 70000`, 3 families were genuinely processing
concurrently, and VRAM held at ~5.1GB/8GB (91% GPU utilization, no CPU
fallback, no OOM) — matching the pre-flight measurement exactly under
real production load, not just a synthetic test payload.

## Follow-up: `check-plan-judge-drift.mjs` had the exact bug this predicted

Re-running `judge:e2e:quick` at the new settings (10 samples, `--ctx 70000`,
`--concurrency 3`) reproduced the same apparent regression as before —
`overall` mean 7.73 → 7.44, worse than the original 5-sample run's 7.73 →
7.54. Doubling samples alone did not make the false-positive go away,
because the drift checker had a real bug: `check-plan-judge-drift.mjs`
already computes per-case, per-dimension MAD (median absolute deviation)
across a run's samples (`aggregateFamilySamples` in
`scripts/ai-judge/aggregate.mjs`, stored as `dimensionMadAverages` per
family in `judge-stability.json`) and already used it to gate the
**family-level** sensitivity comparison with an `INCONCLUSIVE (within noise
±X)` label — but the **dimension-level** comparison (`safety_recovery_fit`,
`goal_event_fit`, ..., and `overall`, i.e. the headline numbers everyone
actually reads) applied a flat `±0.1` threshold with no noise awareness at
all. Worse, even the family-level check only pooled the *current* run's
MAD, never the *baseline's* — so a baseline that happened to be low-variance
by chance still triggered false regressions against a noisier current run.

Fixed both gaps in `app/scripts/check-plan-judge-drift.mjs`:

- Loads the baseline's own stability record (`docs/analysis/plan-judge-stability{,.4b}.json`,
  referenced by the baseline's `stabilitySource` field, which existed but
  was never read by this script).
- Pools per-case dimension MADs across every family into one mean-MAD figure
  per dimension (`safety_recovery_fit`, ..., `overall`), from both baseline
  and current stability records, and applies the same `INCONCLUSIVE`
  labeling the family-level check already had.
- Family-level check now pools baseline + current MAD too, not just current.

Result on the same 10-sample run: **all 7 dimension rows (including
`overall`) now correctly report `INCONCLUSIVE`**, and family-level false
positives dropped from 2 to 1 (`recent_training` and `delivered_dose_variance`
flipped to `INCONCLUSIVE`; `planning_modes_overlays` remains flagged).

That one holdover is itself informative: both the baseline and current runs
recorded **zero intra-run MAD** for `planning_modes_overlays` (every sample
within each run scored identically), yet the two runs still disagree with
each other (8.5 vs 8.0). Both runs use the same deterministic
`baseSeed=424242` with `seedStrategy: derived`, so per-sample seeds are
identical between runs — meaning **Ollama/llama.cpp inference at
temperature 0.1 is not perfectly reproducible run-to-run even with an
identical seed**, plausibly due to GPU batched-decoding numerics varying
with concurrency/batch composition. This is a real limit of using
intra-run MAD as a noise proxy: it can't see variance that only shows up
*between* separately-launched runs. A fully rigorous fix would need
either `temperature: 0` (if the model/quantization tolerates it without
quality loss) or noise estimated from repeated independent runs rather
than repeated samples within one run — left as a follow-up, not implemented
here.

## What was deliberately not changed

- **Concurrency was not pushed past what was empirically measured** (e.g.
  to 4+, or by setting `OLLAMA_NUM_PARALLEL` explicitly). This machine's
  8GB card is shared with the user's desktop session; the ~2-3GB of
  headroom left at concurrency=3 (4B) / concurrency=2 (9B) is intentional
  margin, not squeezed to the limit.
- **The 9B model's `--ctx 65536` was left alone** for `judge:e2e` even
  though its own token telemetry wasn't re-checked for right-sizing
  headroom the way the 4B/quick path was — only concurrency was added
  there. A follow-up could repeat the same attempts-file analysis for
  `judge:e2e` specifically before touching its context window.
- **Sample count was only bumped for `judge:e2e:quick`**, per the actual
  ask; `judge:e2e` and `persona:local:stability` keep `--samples 5`.
