# AI judge calibration and reference-audit operations

This runbook covers the offline evaluator self-test and periodic reference/jury audit introduced in Phase 5–6. It is operational guidance only: neither workflow changes production recommendation selection, safety policy, the judge response contract, or the committed planner baseline.

Run all commands from `app/`.

## Choose the run type

Use the standard local self-test when collecting evidence about the current judge:

```bash
npm run judge:self-test
```

This uses the standard local model, three samples, deterministic derived seeds, and thinking enabled unless explicitly overridden.

Use the quick self-test only as a development smoke check:

```bash
npm run judge:self-test:quick
```

The quick wrapper uses the 4B local quick model, one sample, thinking disabled, and two-control batches. Do not compare a quick run with a standard run as if model quality were the only changed variable: model, thinking mode, and possibly inference profile differ.

Run an explicitly selected evaluator under a distinct label when collecting reference evidence:

```bash
npm run judge:self-test:run -- \
  --provider local \
  --model <ollama-model> \
  --samples 3 \
  --run-label local-reference
```

For a priced cloud run, provide both pricing values or neither:

```bash
npm run judge:self-test:run -- \
  --provider openai \
  --model <reference-model> \
  --samples 3 \
  --run-label cloud-reference \
  --input-cost-per-million <usd> \
  --output-cost-per-million <usd>
```

## Run labels are evidence identities

Artifacts live under:

```text
artifacts/ai-plan-judge/self-test/<run-label>/
```

A run label must resolve to one safe path component. `.` and `..` are rejected. Reusing a label means reusing an evidence identity, so use a new label when intentionally changing evaluator configuration unless you explicitly want to replace the old run with `--fresh`.

## Fresh vs resume

Use `--fresh` when you intentionally want to replace the artifacts for a run label:

```bash
node scripts/run-ai-judge-self-test.mjs \
  --provider local \
  --run-label local-q4 \
  --fresh
```

A fresh run clears accepted-sample and attempt logs and removes stale completed summaries before scoring starts. This prevents an old completed summary from being mistaken for the new in-progress run.

Use `--resume` only for the same immutable run:

```bash
node scripts/run-ai-judge-self-test.mjs \
  --provider local \
  --run-label local-q4 \
  --resume
```

Resume now fails closed. Existing artifacts are never silently discarded when the manifest is missing, the accepted-sample log is malformed, or immutable provenance differs. The command exits and tells the operator to either use `--fresh` intentionally or choose a new run label.

This behavior is deliberate: a failed resume is safer than mixing evidence from two evaluator configurations.

## Immutable resume provenance

The manifest binds the completed/partial evidence to:

- fixture, expectation, case-set, prompt, response-schema, and runtime-schema hashes;
- provider and model name;
- local model digest and quantization when Ollama exposes them;
- sample count, base seed, seed strategy, thinking mode, batch size, and batch count;
- an inference-profile fingerprint.

The inference profile records non-secret settings that can affect output, including adapter type, request timeout, and for local execution `num_ctx` and `num_predict`. Endpoint values are hashed rather than written in plaintext, so a different endpoint changes identity without persisting a potentially sensitive local/cloud URL.

Because the model digest is part of resume identity, a mutable Ollama tag that resolves to different model bytes cannot silently reuse samples from the earlier digest.

## Evidence artifacts

Each run contains:

```text
self-test-manifest.json
self-test-attempts.jsonl
self-test-samples.jsonl
self-test-summary.json
self-test-summary.md
```

`self-test-attempts.jsonl` is the attempt ledger. It records accepted and rejected attempts, error classification, token counts where available, context length, schema-enforcement state, and elapsed time.

`self-test-samples.jsonl` contains only semantically validated accepted batch responses. Invalid JSON, unresolved evidence pointers, wrong cardinality, and other rejected outputs do not become accepted calibration evidence.

`self-test-summary.json` includes calibration metrics plus runtime telemetry. In addition to invocation wall-clock time, the summary records `acceptedInferenceMs`, the sum of accepted provider inference durations. That value is more useful than wall-clock time when a run is resumed because the second invocation may reuse earlier accepted batches.

For providers that report whether native structured output was enforced, the summary also records `schemaEnforcedResponses`, `schemaFallbackResponses`, and `schemaEnforcementRate`. JavaScript semantic validation still applies when a provider falls back from native schema enforcement.

## Interpreting evidence validity

`evidenceReferenceValidity` describes accepted self-test evidence. Accepted responses have already passed JSON-Pointer validation against the exact packet supplied to the evaluator, so this metric is an invariant of accepted rows rather than a measure of how often the model initially emitted malformed references.

Use `self-test-attempts.jsonl` to understand retry/rejection behavior. Do not interpret 1.000 accepted-reference validity as proof that the model never produced an invalid reference on a rejected attempt.

## Reference/jury audit

After producing at least two completed compatible runs:

```bash
npm run judge:reference-audit -- \
  --run artifacts/ai-plan-judge/self-test/local-q4 \
  --run artifacts/ai-plan-judge/self-test/local-reference \
  --run artifacts/ai-plan-judge/self-test/cloud-reference
```

The comparator fails closed when the frozen evaluation contract differs, including suite/fixture/expectation, prompt, response/runtime schema, case set, samples, seeds, seed strategy, or batch size.

Provider/model differences are allowed because they are the purpose of a reference audit. The report also shows the evaluator axes that changed between each pair:

- provider;
- model;
- model digest;
- quantization;
- thinking mode;
- inference profile.

If multiple axes change, treat the comparison as confounded. For example, a standard 9B/thinking-on run versus a quick 4B/thinking-off run can characterize the two evaluator configurations, but it cannot attribute the difference to model size alone.

The report includes native-schema enforcement rate and accepted inference duration when available, alongside calibration agreement, repeatability, bias, evidence discipline, tokens, and cost.

## What the audit must not do

A reference audit does not:

- select a winner automatically;
- switch the production or default judge model;
- define physiological thresholds;
- migrate the judge response contract;
- update `docs/analysis/plan-judge-baseline.json`;
- become a live-LLM CI gate.

Any consequential model or contract change requires a separate reviewed decision based on the frozen controls, failure details, stability, operational cost, and domain review.
