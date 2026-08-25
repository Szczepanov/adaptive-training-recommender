# AI plan judge tooling

The AI plan judge is an **offline evaluation harness** around the deterministic training-plan simulator. It is intended to answer two different questions without coupling either one to production recommendation logic:

1. Does the generated corpus obey deterministic safety/capacity/event-specific invariants?
2. Given the same judging contract, does an independent model consider the plans and their sensitivity to changed inputs reasonable?

The committed baseline is evidence for comparison. It is not a production decision rule, a clinical calibration dataset, or a target that production code should optimize directly against. CI never calls a live LLM.

## Scope and baseline boundary

PR #216 established the true **pre-change** judge baseline on `main` at merge commit `967a37238ebf5b8fb847a0ec6bba8d20e42d53c1`. That baseline intentionally captured the planner before the engine-behavior changes in this PR.

The committed baseline currently records:

- corpus schema `adaptive-training-recommender/ai-plan-judge-corpus@2`
- 11 sensitivity families / 60 cases
- `familiesSha256 = 4e060474fb75d4ecd0b48d20630a857e6ab5a3ca0fddb375deb9bcfec46f3e57`
- prompt SHA-256 `fd815c58cbc079c48c739a41a315820b4e4f32c1efa0b8c90570bed6455db8fb`
- response-schema SHA-256 `ab96127b7dee8fb1bc664897fcfe7d0ff563ba7d7cabf4dd433e1d0b7ed2d21a`
- local judge model `hf.co/empero-ai/Qwen3.8-9B-Distill-GGUF:Q4_K_M`

`familiesSha256` fingerprints the actual generated family packets. It is therefore **expected to change when planner behavior changes**. It is useful for proving exactly what a judge saw, but it is not a requirement for before/after score comparability.

`npm run judge:diff` intentionally uses a narrower comparability contract: prompt, response schema, judge model, family/case set, and score dimensions must remain compatible. The generated corpus commit and family-packet hash are reported as provenance so reviewers can verify that the engine changed while the judging contract stayed stable.

**Do not refresh the committed baseline before reviewing a candidate engine change.** Doing so would replace the pre-change reference with the candidate itself and erase the comparison the baseline exists to provide.

`corpusSha256` is also not a stable semantic fingerprint because `corpus.json` contains capture metadata such as commit/timestamp. Use `familiesSha256` when you need to identify the exact judge packets and the baseline summary when you need to identify the accepted reference scores.

## Pipeline

Run commands from `app/`.

### 1. Generate the deterministic corpus

```bash
npm run simulate:plan-judge
```

The command currently performs four steps:

1. `simulate-plan-judge.mjs` runs the real simulator and writes the initial family packets.
2. `fix-plan-judge-corpus.mjs` applies harness-only compatibility corrections for planner-facing preferences, injury guardrails, valid evergreen intent, travel constraints, judge context, and scheduled-event ownership. It also rewrites the final judge prompt used by the scored run.
3. `normalize-plan-judge-diagnostics.mjs` reproduces judge-facing anchor-placement wording without changing shared engine diagnostics.
4. `check-plan-judge-invariants.mjs` verifies the fixed 11-family/60-case shape plus deterministic feasibility and event-demand assertions.

The post-processing layer exists because the judge tooling was extracted after the original simulator already existed. It is deliberately visible rather than pretending there is one canonical builder. New corpus families should preferentially be implemented in one place; growing an additional chain of corrective post-passes should be avoided. Consolidating the builders is a separate harness refactor because changing the final packets or prompt can invalidate score comparability.

CI runs this deterministic command only. No provider credentials are required.

### Deterministic invariants

Hard truths should be asserted before an LLM sees the corpus. The invariant gate currently verifies, among other things:

- restricted Running never produces a Running recommendation
- `avoid_heavy_lower_body` never selects a matching safety-tagged session
- 45-minute weekday capacity is respected
- the 45-minute criterium-capacity case receives the compact `end_crit_surges_01` race-specific template
- travel equipment/environment/time constraints are respected
- evergreen mode propagates valid evergreen intent and carries no event
- a scheduled event owns its event date; no independent workout is added on top of the fixed event commitment
- criterium and gran-fondo A/B cases produce different selected-template sequences
- the A-priority criterium case actually selects `end_crit_surges_01`, while the A-priority gran-fondo control does not

The final two checks matter because generic sequence distance is too weak on its own: an unrelated recovery or strength shuffle could make two plans technically different without proving event-demand specificity reached workout selection.

### 2. Run the model judge

Local model:

```bash
# Standard local evaluation (1 sample, fresh)
npm run judge:local

# Multi-sample stability measurement (5 samples, fresh)
npm run judge:local:stability

# Quick local evaluation
npm run judge:local:quick
```

Cloud provider selected from environment credentials:

```bash
npm run judge:run
```

Fast/cheap provider mode where supported:

```bash
npm run judge:quick
```

Resume an interrupted run (reusing validated family results if the run manifest matches):

```bash
npm run judge:local:resume
npm run judge:local:quick:resume
# or for cloud:
npm run judge:resume
npm run judge:quick:resume
```

The fresh npm wrappers (`npm run judge:local`, `npm run judge:local:stability`, `npm run judge:local:quick`, `npm run judge:run`, `npm run judge:quick`) regenerate the deterministic corpus and pass `--fresh`. The resume commands or directly running `node scripts/run-ai-judge.mjs` with `--resume` (or without `--fresh`) can reuse already validated family sample responses **only when** the run manifest still matches the exact families, prompt, response schema, model, provider, and sample configuration.

### Multi-sample repeatability & stability (`--samples N`)

Single 9B Q4 model invocations have non-zero run-to-run dispersion. The harness supports deterministic multi-sample evaluation:
- Use `--samples N` (e.g. `--samples 5` or `npm run judge:local:stability`)
- Seeds for each sample are derived deterministically: `hash(baseSeed + ":" + familyId + ":" + sampleIndex)`
- Raw validated samples are saved to `artifacts/ai-plan-judge/latest/judge-samples.jsonl`
- Robust aggregation is computed across samples: **Median** scores, **MAD** (Median Absolute Deviation), min/max, and categorical agreement
- Metrics are persisted to `artifacts/ai-plan-judge/latest/judge-stability.json`
- An aggregate `judge-scores.jsonl` is exported matching the standard schema for backward compatibility.

### Blind primary scoring packet (`--blind` / `judge-packet@2`) & diagnostic split

To prevent the AI judge from anchoring on the engine's internal diagnostic warnings (e.g. `qualityWarnings`, `violations`, `utility`, `rejectionCounts`), the runner supports blind primary evaluation:
- `npm run judge:local:blind` or `--packet-version v2` / `--blind`:
  - Strips all internal planner opinions/diagnostics from the primary prompt packet.
  - Presents clean athlete inputs (`readiness`, `events`, `preferences`, `constraints`, `recentTraining`, `fixedActivities`).
  - Computes deterministic descriptive plan features in pure JavaScript (`totalPlannedDurationMin`, `cumulativeSystemicCost`, `hardSessionCount`, `consecutiveHardDaysMax`, `modalityDistribution`, `daysFromLastHardSessionToEvent`).
- Optional secondary diagnostic audit pass (`npm run judge:local:audit` or `--with-diagnostics-audit`):
  - Cross-checks whether engine diagnostic warnings accurately reflect the plan or represent potential false alarms / masked defects.
  - Persists audit telemetry to `artifacts/ai-plan-judge/latest/judge-diagnostic-audit.jsonl` without modifying primary score artifacts.

### Native structured outputs & runtime schema

For Ollama and OpenAI-compatible providers, the runner dynamically compiles a per-family JSON Schema containing:
- `const` family ID and schema string
- `enum` matching exactly the expected case IDs for that family
- Numeric intervals $[0, 10]$ for all 7 required score dimensions
- Interval $[0, 1]$ for confidence
- `additionalProperties: false`

This is sent in the provider request (`format: schema` in Ollama, `response_format: { type: "json_schema" }` in OpenAI). If an OpenAI-compatible endpoint rejects the strict `json_schema` request with HTTP 400 (unsupported keyword or strict mode unavailable), the runner retries once with `response_format: { type: "json_object" }`, which drops native schema enforcement for that call. Strict post-validation in JavaScript always applies regardless of enforcement mode, and verifies cardinality, non-empty rationales, and absence of synthetic fallback phrases.

### Thinking mode & inference telemetry

- Configure reasoning mode via `--thinking on|off` or `JUDGE_THINKING=on|off`.
- Attempt telemetry is logged to `artifacts/ai-plan-judge/latest/judge-attempts.jsonl`, tracking prompt/completion tokens, duration, and context utilization (`promptTokens / contextLength`).
- If context utilization enters the high-water zone ($> 75\%$), a warning is emitted; truncation errors (`doneReason: 'length'`) fail fast and are never accepted as valid evidence.

### Model selection via CLI

Override the judge model directly on the command line without modifying environment variables using `--model <name>` (or `--model=<name>`):

```bash
# Evaluate with a custom local Ollama model
node scripts/run-ai-judge.mjs --provider local --fresh --model qwen2.5-coder:14b

# Evaluate with a specific cloud model
node scripts/run-ai-judge.mjs --provider openai --fresh --model gpt-4o-mini
```

### Network & inference timeout

Per-request inference timeouts are enforced via `AbortSignal.timeout` to prevent hung local models or stalled network requests from blocking the harness:
- Local default: `600s` (10 minutes per family evaluation)
- Cloud default: `180s` (3 minutes per family evaluation)
- Configurable via `JUDGE_TIMEOUT_MS` (or `LOCAL_TIMEOUT_MS` / `REQUEST_TIMEOUT_MS`) environment variables.

## Evidence-integrity rule

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

## Temporal semantics of the corpus

The multi-day output needs to be interpreted according to how the simulator advances time.

For each simulated week, the scenario provides a readiness snapshot at the **weekly anchor date**. That snapshot is used for the current-day recommendation and seeds the next-day branch. The remaining forecast days are then produced by the week-ahead planner using projected fatigue, accumulated completed exposures, constraints, objectives, and event context. After the simulated week is added to history, the scenario advances seven days and asks for readiness again.

Therefore a case that returns the same adverse snapshot on every scenario callback represents **repeated adverse weekly anchor observations**, not a literal claim that identical HRV, sleep, soreness, and subjective scores persisted unchanged every day for 14 days.

This matters when interpreting judge rationales. Statements such as “the athlete was severely fatigued for the entire 14-day plan” overstate what the packet establishes. Acute-versus-persistent daily recovery trajectories are valuable future corpus coverage, but adding them changes the evidence contract and should be reviewed/re-baselined explicitly rather than smuggled into an engine-calibration PR.

### Effective prescribed dose in simulation

When production returns an automatic `activeDose` (for example an easier variant on a `modify` day), the simulator materializes that effective prescription before it writes the day trace, accumulated history, or judge packet. Duration, cost and stimulus therefore represent the prescribed reduced dose rather than the catalog template's nominal full dose. Template identity remains stable so workout/coverage identity is not lost.

This is an evidence-integrity rule: a judge must not see `mode: modify` paired with full-dose load, and the following simulated week must not inherit fatigue/objective credit as though the dose reduction never happened.

## Analyze and compare

Analyze an existing score file:

```bash
npm run analyze:plan-judge
```

Compare the current candidate summary with the committed pre-change baseline:

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

LLM scores are noisy. Prefer deterministic invariants, repeated family/case patterns, a same-model rerun, and direct plan inspection over one-off decimal deltas.

To compare with the most recent compatible historical run rather than the committed baseline:

```bash
npm run judge:diff:prev
```

`judge:diff:prev` fails closed when there is no eligible prior artifact. New diff artifacts persist the previous run's own model/provider, prompt hash, response-schema hash, exact family/case-set fingerprint and counts. Legacy diff artifacts that do not carry that immutable provenance are intentionally treated as non-comparable; the checker never fills missing historical provenance from the current candidate.

### Judge uncertainty before gating

Do not turn a one-off decimal movement into a merge gate. Before using `--fail-on-regression` as a consequential policy gate, characterize same-model repeatability on the frozen baseline (multiple fresh runs with the same prompt/schema/model), then interpret family-level movement relative to that observed run-to-run variation. A change smaller than ordinary judge variation should be reported as inconclusive rather than as a physiological or algorithmic regression.

For high-impact behavior changes, prefer repeated same-model scoring plus the blinded A/B helper and direct plan inspection. This uncertainty procedure is evaluation policy only; it must not be converted into production recovery thresholds.

## Calibration interpretation guardrails

The judge is useful for finding suspicious behavior. It is not evidence that a particular physiological cutoff is correct.

- A repeated complaint such as “poor sleep should reduce load” can justify testing a policy variant; it does not establish that a sleep score of exactly `55` is a universal boundary.
- HRV-guided training has supportive evidence, but published reviews emphasize individualized baselines/reference methods and do not validate one universal absolute HRV delta as a hard gate (PMID 34639599).
- Experimental sleep-loss literature supports performance impairment after insufficient sleep, but effect size depends on protocol, timing, task, and athlete context; it does not validate a proprietary wearable sleep-score threshold as a clinical truth (PMID 39006249; PMID 35708888).
- Endurance taper evidence supports materially reducing volume while generally retaining training intensity/frequency rather than equating taper quality with the number of complete rest days (PMID 37163550).
- Criterium racing is genuinely stochastic and repeated-power dominant, with frequent short high-power efforts; that supports a repeated-surge specialist template and direct criterium-vs-gran-fondo invariants (PMID 30589619; PMID 19124890).

These references support behavioral principles and test design. They should not be copied into production as numeric constants without athlete-specific validation or prospective evidence.

## Promote a reviewed baseline

A new baseline should be exceptional and review-driven. For an engine behavior PR, the normal order is:

```bash
npm run judge:local
npm run judge:diff
```

Use the same judge model as the committed baseline for a score comparison intended to measure engine drift. Review deterministic invariants, plan diffs, family-level score changes, and the raw judge rationales before deciding whether the candidate should become the new reference.

Only **after** the candidate behavior has been accepted as the new reference should the baseline be promoted:

```bash
npm run judge:update-baseline -- --reviewed
```

Prefer an explicit follow-up or clearly isolated baseline-promotion commit so reviewers can still see the pre-change comparison during the behavior review.

Baseline promotion refuses to write when:

- the summary is malformed/incomplete
- the source path is machine-local/absolute
- provenance is missing or `unknown`
- corpus/families/prompt/schema/scores hashes do not match the current artifacts
- the corpus was not generated from the current Git `HEAD`

This prevents accidentally committing an old summary after code changed. It does **not** mean a behavior PR should overwrite the old reference before comparison.

## Blind A/B policy comparison

```bash
npm run simulate:blind-ab
```

This produces:

- `artifacts/simulation-reports/blind-ab/latest/report.md` — reviewer-facing Alpha/Beta report
- `artifacts/simulation-reports/blind-ab/latest/blind-ab.json` — blinded structured results
- `artifacts/simulation-reports/blind-ab/latest/unblinding-key.json` — candidate mapping and seed

Review `report.md` before opening the unblinding key. Alpha/Beta assignment is derived from a random seed by default. Set `BLIND_AB_SEED` to reproduce the same assignment.

## Behavior-PR review boundary

This PR is the candidate engine behavior measured against the pre-change baseline established by #216. It is valid for its generated family-packet hash to change; that is the expected consequence of changed recommendations. What must stay stable for a scored before/after comparison is the judging contract described above.

Two follow-ups should remain separate because they intentionally change the evaluation contract rather than merely engine behavior:

1. add acute-versus-persistent daily recovery trajectories so recovery sensitivity can be judged with explicit temporal semantics
2. consolidate the initial corpus builder and compatibility post-pass into one canonical builder, followed by an explicit baseline migration if the resulting packets or prompt change

Until those are done, reviewers should interpret this corpus as synthetic policy-regression evidence, not clinical calibration or proof of real-world usefulness.
