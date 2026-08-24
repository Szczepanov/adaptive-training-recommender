# AI plan judge tooling

The AI plan judge is an **offline evaluation harness** around the deterministic training-plan simulator. It is intended to answer two different questions without coupling either one to production recommendation logic:

1. Does the generated corpus obey deterministic safety/capacity invariants?
2. Given the same corpus, does an independent model consider the plans and their sensitivity to changed inputs reasonable?

The committed baseline is evidence for comparison. It is not a production decision rule, and CI never calls a live LLM.

## Scope and baseline boundary

PR #216 establishes the tooling baseline on top of `main`. The judge scripts and simulation helpers are additive; the PR intentionally does **not** change planner decision behavior, `POLICY_VERSION`, or the shared scenario registry. A judge-facing diagnostics wording compatibility step lives in the harness rather than modifying `src/engine/simulation/analyze.ts`.

The first baseline capture was produced from harness commit `5e7115b24a0e3b1bba93bcc624a0d3d27ff9036f` with:

- corpus schema `adaptive-training-recommender/ai-plan-judge-corpus@2`
- 11 sensitivity families / 60 cases
- `familiesSha256 = 553158426a84e5783d6214923ae614871efbffced993d797379eec42fb2061b3`
- local judge model `hf.co/empero-ai/Qwen3.8-9B-Distill-GGUF:Q4_K_M`

That capture was originally made while this branch still carried a null-safe `planner.ts` duration fallback and a policy-version bump. Those shared-engine edits were removed during review because every delivered-dose fixture used by this corpus already carries the required `trainingRecordLike.duration_min`; the fallback therefore did not affect the generated judge packets. Treat the stable `familiesSha256` above as the semantic proof point for the pre-change corpus. `npm run simulate:plan-judge` prints the current families hash so it can be checked directly.

`corpusSha256` is intentionally **not** the stable semantic fingerprint: `corpus.json` includes capture metadata such as commit/timestamp, so its whole-file hash changes across legitimate re-captures. `familiesSha256` fingerprints the actual family packets presented to the judge.

The existing committed baseline contains an absolute Windows path in its historical `source` field because it predates the portability hardening in this PR. New summaries write repository-relative paths, and baseline promotion rejects absolute paths.

### Historical scored-baseline caveat

The first scored baseline also predates the strict runner introduced during review. It passed the previous analyzer's checks for the known synthetic case/family fallback phrases, and the committed summary contains no obvious fallback markers. However, the old runner could also repair individual missing score dimensions or remap a bad case id without leaving a detectable marker in the summary, while raw `judge-scores.jsonl` is intentionally not committed.

For the strongest merge-quality baseline, re-run `npm run judge:local` at the final PR head with the **same local model**, verify that the printed `familiesSha256` is still `553158426a84e5783d6214923ae614871efbffced993d797379eec42fb2061b3`, review `npm run judge:diff`, and promote the strict result with `npm run judge:update-baseline -- --reviewed`. Until that strict re-capture is done, treat the original scored summary as a useful pre-change measurement but not as proof that no old-runner repair occurred.

## Pipeline

Run commands from `app/`.

### 1. Generate the deterministic corpus

```bash
npm run simulate:plan-judge
```

This performs four steps:

1. `simulate-plan-judge.mjs` runs the real simulator and writes the initial family packets.
2. `fix-plan-judge-corpus.mjs` applies harness-only compatibility corrections for planner-facing preferences, injury guardrails, valid evergreen intent, travel constraints, judge context, and scheduled event ownership. This post-pass exists to keep the extracted tooling compatible with the current `main` data contracts; it should eventually be folded into one corpus builder rather than grow indefinitely.
3. `normalize-plan-judge-diagnostics.mjs` reproduces the judge-facing anchor-placement warning wording used by the original baseline without modifying shared engine diagnostics. Keeping that compatibility normalization in the harness preserves the baseline packet contract while leaving `main` engine code untouched.
4. `check-plan-judge-invariants.mjs` verifies the fixed 11-family/60-case corpus shape and deterministic safety/capacity invariants.

CI runs this deterministic command only. No provider credentials are required.

Two future-behavior assertions are deliberately deferred to the engine-behavior follow-up:

- a `<=45 min` capacity case receiving a feasible cycling race-specific session
- criterium vs gran-fondo demand producing distinct template sequences

The invariant script still reports the current event-demand sequence distances so the follow-up has an explicit before/after signal.

### 2. Run the model judge

Local model:

```bash
npm run judge:local
```

Cloud provider selected from environment credentials:

```bash
npm run judge:run
```

Fast/cheap provider mode where supported:

```bash
npm run judge:quick
```

The npm wrappers regenerate the deterministic corpus and use `--fresh`. For an interrupted run, invoking `node scripts/run-ai-judge.mjs` without `--fresh` can reuse already validated family responses **only when** the run manifest still matches the exact families, prompt, response schema, model, and provider.

### Evidence-integrity rule

Judge output is evidence, so the runner does not invent or remap it.

A family response is accepted only when it contains:

- the exact response schema and family id
- exactly the expected case ids, with no duplicates or substitutions
- every required score in `[0, 10]`
- confidence in `[0, 1]`
- all required list/rationale fields
- a complete `familyAssessment`

Malformed, truncated, incomplete, or misidentified responses are retried and then fail. Missing scores are **not** filled from `overall`; missing cases do **not** receive default scores; an invalid case id is never reassigned to another case. The analyzer validates the evidence again before producing a summary.

The run writes `artifacts/ai-plan-judge/latest/judge-run-manifest.json`, which binds resumable results to:

- `familiesSha256`
- prompt SHA-256
- response-schema SHA-256
- resolved judge model
- judge provider

This prevents a stale family score file from being silently reused after the corpus or judging contract changes.

## Analyze and compare

Analyze an existing score file:

```bash
npm run analyze:plan-judge
```

Compare the current summary with the committed baseline:

```bash
npm run judge:diff
```

The diff checker refuses to treat runs as comparable when the prompt, response schema, family/case set, score dimensions, or judge model changed. For exploratory model-to-model comparisons only, explicitly opt in:

```bash
npm run judge:diff -- --allow-model-change
```

Normal score movements are reported but do not fail by default. To make regressions a non-zero exit for an explicit experiment/gate:

```bash
npm run judge:diff -- --fail-on-regression
```

LLM scores are noisy. Prefer repeated family/case patterns, deterministic invariants, and a same-model rerun over a one-off decimal delta.

## Promote a reviewed baseline

A new baseline should be exceptional and review-driven:

```bash
npm run judge:diff
npm run judge:update-baseline -- --reviewed
```

Baseline promotion refuses to write when:

- the summary is malformed/incomplete
- the source path is machine-local/absolute
- provenance is missing or `unknown`
- corpus/families/prompt/schema/scores hashes do not match the current artifacts
- the corpus was not generated from the current Git `HEAD`

This prevents accidentally committing an old summary after code changed.

## Blind A/B policy comparison

```bash
npm run simulate:blind-ab
```

This produces:

- `artifacts/simulation-reports/blind-ab/latest/report.md` — reviewer-facing Alpha/Beta report
- `artifacts/simulation-reports/blind-ab/latest/blind-ab.json` — blinded structured results
- `artifacts/simulation-reports/blind-ab/latest/unblinding-key.json` — candidate mapping and seed

Review `report.md` before opening the unblinding key. Alpha/Beta assignment is derived from a random seed by default. Set `BLIND_AB_SEED` to reproduce the same assignment.

## What belongs in a follow-up engine PR

A baseline/tooling PR should not make production planning behavior look better before the baseline is recorded. Engine changes suggested by judge results belong in a separate PR, with this baseline as the comparison point. In particular, the compact criterium template and event-demand differentiation assertions are intentionally outside this PR.
