# AI judge Phase 5–6: calibration controls and reference audit

**Status:** In progress
**Blocked by:** none — Phase 4 is merged on `origin/main`
**Unlocks:** an evidence-based judge/model retention decision and, separately, a reviewed judge-contract baseline migration

**Implementation state:** all planned code, fixtures, tests, commands, and operating docs are
complete on `codex/ai-judge-phase5-6`; merge/PR review is still pending. The installed 4B
model now provides a quick local smoke path. A provenance-compatible multi-model reference
comparison remains an optional operational follow-up.

## Goal

Evaluate the AI judge before treating it as consequential planner-regression evidence, then
provide an opt-in workflow for comparing the same frozen controls across the current local
judge and reference evaluators. This work changes only offline evaluation tooling. It does
not change recommendation selection, production safety policy, or the committed planner
baseline.

## Interpretation of the source proposal

This plan implements the attached proposal's numbered Phase 5 and Phase 6 sections:

- Phase 5: a small, high-information judge self-test/calibration suite;
- Phase 6: a periodic reference/jury audit over completed self-test runs.

The proposal's later PR-slicing section uses “PR 6” for a different activity: migrating the
judge response contract and committed score baseline. That migration is deliberately not
included here. The self-test and reference evidence must exist before deciding whether the
current Q4 judge, the scoring contract, or the baseline should change.

## Current-state findings

1. `run-ai-judge.mjs` already supplies provider selection, deterministic seeds, strict
   structured output, attempt telemetry, and model/runtime provenance that the self-test can
   reuse.
2. The latest Phase 4 implementation derives provider output requirements from each runtime
   schema and strictly validates pairwise responses. Phase 5 can reuse that generic provider
   seam without adding contract-specific adapter branches.
3. `judge-packet@2` correctly strips planner diagnostics from primary scoring. Calibration
   fixtures should preserve source diagnostics separately and prove that blind packets do
   not expose them.
4. The existing 11-family/60-case corpus is a planner sensitivity corpus, not a gold/control
   suite for the evaluator. Reusing it as calibration truth would conflate planner behavior
   with judge correctness.
5. `check-plan-judge-drift.mjs` correctly treats model changes as comparability breaks. A
   reference audit should compare calibration metrics explicitly rather than weakening that
   guard.

## Decisions

### D-AJCAL-1 — frozen fixture contract

Commit a versioned calibration fixture set under
`app/scripts/fixtures/ai-judge-calibration/`. Each case contains only factual athlete,
constraint, plan, comparison, and optional source-diagnostic data. Expectations live in a
separate file so the judge never sees labels, allowed ranges, forbidden claims, or required
evidence paths.

### D-AJCAL-2 — strict evaluator response

Use a dedicated structured response with:

- a stable response schema identifier;
- exactly one result for every requested calibration case;
- an anchored ordinal absolute class;
- a reaction classification;
- a stable preferred-plan identity for pairwise cases;
- JSON Pointer evidence references;
- separate observations, speculative hypotheses, and parameter candidates;
- an explicit diagnostic assessment.

The semantic validator rejects missing, duplicate, or unknown cases; invalid evidence
pointers; unsupported preferred-plan identities; non-speculative hypotheses; and malformed
output. The runner never synthesizes missing evidence.

### D-AJCAL-3 — ranges and classes, not perfect decimals

Expected results use ordinal ranges and allowed classes. Calibration metrics report observed
behavior but have no merge-gating threshold in this phase. The initial evidence distribution
must be reviewed before any threshold is proposed.

### D-AJCAL-4 — primary blindness is structural

`sourceDiagnostics` may exist in a fixture so an adversarial control can model a false or
missing warning. The primary calibration packet builder excludes that field. Diagnostic
assessment is therefore expected to remain `not_shown` in blind-primary cases. Diagnostic
truth is never allowed to anchor the primary quality verdict.

### D-AJCAL-5 — reference audit consumes immutable completed runs

The Phase 6 workflow compares two or more self-test summary/provenance artifacts supplied by
the operator. It does not silently call extra paid models, infer credentials, or run a panel
on ordinary development checks. Each evaluator is run explicitly with `judge:self-test`,
then the completed artifacts are passed to `judge:reference-audit`.

### D-AJCAL-6 — no model or baseline promotion

The audit reports human-label agreement, stability, order bias, evidence validity,
unsupported claims, tokens, and runtime. It does not select a winner automatically and does
not update `docs/analysis/plan-judge-baseline.json`.

## Work items

### 5.1 [x] Add the frozen calibration corpus

**Files:**

- `app/scripts/fixtures/ai-judge-calibration/cases.jsonl`
- `app/scripts/fixtures/ai-judge-calibration/expected.json`
- `app/scripts/fixtures/ai-judge-calibration/README.md`

Add 20–40 high-information controls spanning:

- hard restrictions, capacity, fixed-event ownership, and equipment feasibility;
- appropriate non-reaction to mild isolated signals;
- deliberate overreaction and underreaction;
- event-demand specificity;
- verbosity, label, order, and false-diagnostic adversarial pairs;
- weekly-anchor versus explicit persistent temporal semantics;
- unsupported internal-root-cause discipline.

Every fixture has a category and stable case ID. Pair/order controls declare a stable group
and plan identities so consistency can be measured independently of A/B presentation.

**Done when:** fixture loading proves unique IDs, exact expectation coverage, valid category
metadata, valid JSON Pointers in expectation rules, and 20–40 cases.

### 5.2 [x] Add schema, packet builder, and semantic validator

**Files:**

- `app/scripts/ai-judge/selfTestSchema.mjs`
- `app/scripts/ai-judge/selfTest.mjs`
- `app/scripts/ai-judge/providers/*.mjs`

Generate a strict runtime JSON Schema for each batch. Reuse Phase 4's schema-derived provider
instructions so the same provider adapter serves pointwise, pairwise, and self-test contracts.
Build blind-primary packets that omit fixture expectations and `sourceDiagnostics`.

Validate all output again after provider schema enforcement. Resolve every JSON Pointer
against the exact packet sent to the model. Keep parameter candidates separate and reject
them for controls where numeric proposals are forbidden.

**Done when:** malformed output, unknown cases, invalid pointers, duplicated results,
unsupported preferred plan IDs, leaked expectations, and leaked diagnostics are rejected by
unit tests.

### 5.3 [x] Compute calibration metrics without inventing gates

**File:** `app/scripts/ai-judge/selfTest.mjs`

Compute:

- exact/range pass rate for absolute ordinal classes;
- reaction-class accuracy;
- quadratic weighted kappa against the frozen ordinal target;
- pairwise/order consistency using stable plan IDs;
- test/retest agreement and score dispersion across samples;
- false-positive rate for misleading diagnostic controls;
- JSON Pointer evidence-reference validity;
- forbidden unsupported-claim count/rate;
- forbidden parameter-candidate count/rate;
- per-category results and failed-control details.

All divisions handle empty denominators explicitly. Metrics retain raw counts as well as
rates so a small corpus cannot imply false precision.

**Done when:** deterministic unit fixtures reproduce the expected metrics, including perfect,
mixed, and empty-subset cases.

### 5.4 [x] Add the self-test runner and durable artifacts

**Files:**

- `app/scripts/run-ai-judge-self-test.mjs`
- `app/package.json`

Reuse `resolveJudgeConfig`, provider adapters, deterministic seed derivation, Ollama
preflight, retry classification, and atomic writes. Support explicit provider/model,
`--samples`, `--seed`, `--thinking`, `--fresh`, and `--resume`. Preserve raw accepted samples
and attempt telemetry before producing an aggregate calibration summary.

Write under `artifacts/ai-plan-judge/self-test/<run-label>/`:

- `self-test-manifest.json`;
- `self-test-attempts.jsonl`;
- `self-test-samples.jsonl`;
- `self-test-summary.json`;
- `self-test-summary.md`.

The manifest binds fixture, expectation, prompt, runtime-schema, model, provider, packet
version, sample, and seed provenance. Resume is allowed only when the immutable identity
matches.

**Done when:** a mocked end-to-end run can resume without rescoring accepted sample IDs and
the summary can be reproduced from raw samples.

### 6.1 [x] Add the opt-in reference/jury audit comparator

**Files:**

- `app/scripts/audit-ai-judge-jury.mjs`
- `app/scripts/ai-judge/juryAudit.mjs`
- `app/package.json`

Accept two or more completed self-test summary paths. Fail closed if fixture/expectation,
prompt, response schema, case set, or sample policy is incompatible. Treat model/provider
differences as the intended comparison axis and retain them in every row.

Produce:

- `artifacts/ai-plan-judge/reference-audit/latest/reference-audit.json`;
- `artifacts/ai-plan-judge/reference-audit/latest/reference-audit.md`.

Compare frozen-control agreement, kappa, repeatability, order consistency, misleading
diagnostic false positives, evidence validity, unsupported claims, token use, and runtime.
Surface ties and missing measurements; do not rank models by a hidden composite score.

**Done when:** compatible model-different runs compare successfully, incompatible contracts
fail with the exact mismatched field, and Markdown contains enough provenance for review.

### 6.2 [x] Document the operating workflow and interpretation boundary

**Files:**

- `docs/analysis/ai-plan-judge.md`
- this plan

Document:

1. how to run the current 9B Q4 self-test and the non-gating 4B quick smoke test;
2. how to save/run an optional Q5/Q6 or cloud reference under a distinct label;
3. how to compare completed runs;
4. which metrics require expert review;
5. why the audit is periodic and not part of CI;
6. why no model switch, score-contract migration, or committed baseline update follows
   automatically.

**Done when:** an operator can reproduce the workflow without reading implementation code.

## Tests to add

- `selfTest.test.ts`
  - fixture cardinality, uniqueness, expectation coverage, and diagnostic stripping;
  - dynamic schema cardinality and case enums;
  - strict result validation and JSON Pointer resolution;
  - forbidden hypothesis and parameter-candidate handling;
  - exact/range accuracy, quadratic weighted kappa, order consistency, diagnostic false
    positives, and test/retest agreement.
- `providers.test.ts`
  - pointwise, pairwise, and self-test requests receive only their own contract instructions.
- `juryAudit.test.ts`
  - compatible multi-model comparison;
  - exact contract mismatch diagnostics;
  - stable JSON/Markdown rendering with ties and unavailable metrics.
- `config.test.ts`
  - self-test run-label and repeated reference-run path parsing where applicable.

## Acceptance criteria

- [x] The committed fixture set contains 20–40 frozen high-information controls across all
      eight required categories.
- [x] The primary self-test packet contains neither expected labels nor source diagnostics.
- [x] Provider-native schema enforcement and local semantic validation both apply.
- [x] Every accepted observation/judgment evidence reference resolves to the sent packet.
- [x] Unsupported causal claims and forbidden numeric parameter candidates are visible as failures.
- [x] Classification, kappa, order consistency, repeatability, false-positive, evidence, and
      unsupported-claim metrics include raw counts.
- [x] Self-test artifacts are provenance-bound, resumable, and atomically finalized.
- [x] Reference audit requires two compatible completed runs and compares model differences
      without weakening normal drift comparability.
- [x] No live LLM call is added to CI or `npm run check`.
- [x] The committed planner baseline is unchanged.
- [x] Targeted AI-judge tests, the full frontend check, and the production frontend build pass.

## Verification evidence

- `npm run check`: 225 test files passed, 6 skipped; 2,222 tests passed, 124 skipped;
  TypeScript, ESLint, and the 176-exercise/38-workout catalog validation passed.
- `npm run build:bundle`: production Vite/PWA bundle completed.
- AI-judge target suite: 15 files / 82 tests passed after the Phase 4 `main` sync.
- Real Ollama structured-output smoke: the current Q4 model completed all 22 controls under
  the synced contract with one sample and no accepted malformed evidence. The report-only run
  produced 15/22 absolute-range matches, 20/22 reaction matches, 11/22 full-control matches,
  2/2 order-consistent pairs, zero misleading-diagnostic false positives, and zero forbidden
  unsupported/numeric-threshold claims. This is development smoke evidence, not a gate.
- The attempted large reference model was stopped and unloaded at the user's request. The
  optional live jury comparison will not use it; comparator behavior is covered by deterministic
  tests meanwhile.
- Real 4B quick smoke: `hf.co/empero-ai/Qwen3.8-4B-Distill-GGUF` completed all 22 controls
  in 11 two-control batches with one sample, thinking disabled, and 110/110 accepted evidence
  references. It produced 13/22 absolute-range matches, 15/22 reaction matches, 9/22 full-control
  matches, and 2/2 order-consistent pairs. This characterizes a fast development evaluator only;
  standard/stability runs retain the 9B Q4 model.

## Risks and rollback

- **Fixture truth is underspecified.** Keep expectations on clear controls, use allowed ranges
  and classes, and expose individual failures for expert review. Roll back disputed fixtures
  independently without changing runner semantics.
- **A custom contract increases evaluator load.** Keep batches small, schema-constrained, and
  provenance-visible. A failed/truncated batch is rejected and resumable.
- **Provider capability differences look like model differences.** Record schema-enforcement
  mode, provider, model, runtime, context, tokens, and timing. The audit never collapses them
  into one score.
- **Self-test labels become accidental production policy.** Keep the suite offline and assert
  no imports from engine selection code. Numeric parameter proposals remain non-actionable.
- **Reference calls cost money.** The audit consumes explicitly supplied completed runs and
  never invokes extra providers by default.

Rollback consists of removing the new commands/modules/fixtures and documentation. No
Firestore data, recommendation policy, production artifact, or committed judge baseline is
mutated by this work.

## Out of scope

- updating `docs/analysis/plan-judge-baseline.json`;
- changing `adaptive-training-recommender/ai-plan-judge-response@1`;
- choosing or installing a replacement judge model;
- defining merge-gating thresholds;
- changing planner/recommendation behavior;
- consolidating the plan-judge corpus builder;
- adding acute/persistent trajectories to the planner sensitivity corpus;
- running a multi-model panel in normal CI.
