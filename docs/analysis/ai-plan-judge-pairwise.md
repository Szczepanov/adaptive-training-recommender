# AI plan judge: pairwise sensitivity contract

This note documents the runtime contract for the pairwise sensitivity path introduced by `--pairwise`. It complements `docs/analysis/ai-plan-judge.md` and focuses on behavior that differs from the established pointwise judge.

## Score-scale boundary

The existing pointwise judge remains on its historical **0..10 numeric contract**. This is intentional: pointwise `judge-samples.jsonl`, `judge-scores.jsonl`, aggregation, and baseline diffing must stay directly comparable with previously accepted runs.

`--rubric-scale <0-4|0-10>` controls **pairwise sensitivity scoring only**:

- `0-4` (default for pairwise): anchored integer rubric
  - `4 = Exemplary`
  - `3 = Sound`
  - `2 = Marginal`
  - `1 = Flawed`
  - `0 = Unsafe`
- `0-10`: numeric compatibility mode for pairwise experiments

`rubricTo10Point` and `tenPointToRubric` are explicit conversion helpers. Invalid/out-of-range values are rejected rather than silently clamped.

## Directed edge semantics

Each entry in `edges.mjs` is a canonical directed comparison:

`baseline (edge.from) -> perturbed (edge.to)`

The edge owns:

- `axis`
- `expectedDirection`
- `expectedMagnitude`

Pairwise output must report both the expected contract and the model-observed direction:

- `expectedDirection`: echoed edge contract
- `expectedMagnitude`: echoed edge contract
- `actualDirection`: judge assessment of the observed baseline-to-perturbed plan change
- `actualResponseAssessment`: `underreaction | appropriate | overreaction`

This distinction prevents the evaluator from merely repeating the expected direction without stating what it believes actually happened.

## Order-swap position-bias check

`--check-position-bias` evaluates the same semantic edge twice:

1. display baseline in slot A and perturbed case in slot B
2. display perturbed case in slot A and baseline in slot B

The packet always includes `comparisonRoles.baselineCaseId` and `comparisonRoles.perturbedCaseId`. Those roles do **not** change when display slots are swapped. Therefore:

- `actualDirection` and `actualResponseAssessment` should remain semantically stable
- `A_better` / `B_better` preferences should invert when the same underlying case remains preferred
- `equal` and `both_flawed` should remain unchanged

Two separate stability metrics are produced:

- **Position Bias Index**: fraction of pairs whose slot-relative preference fails the expected inversion/symmetry rule
- **Order Instability Index**: fraction of pairs that fail any swap-consistency rule (preference, actual direction, appropriateness assessment, or score tolerance)

This separation avoids labeling ordinary stochastic score/direction disagreement as proven position preference bias.

## Strict evidence validation

Native provider schema enforcement is useful but not sufficient. OpenAI-compatible providers can fall back from `json_schema` to `json_object`, and some providers enforce only a subset of JSON Schema.

Every pairwise response is therefore post-validated in JavaScript before it is accepted. Validation checks:

- exact pairwise schema id and family id
- exact displayed `caseA` / `caseB` ids
- exact echoed expected direction and magnitude
- valid `actualDirection`
- valid `actualResponseAssessment`
- confidence in `[0, 1]`
- non-empty evidence
- valid preference
- score bounds/type for the configured pairwise scale
- non-empty rationale

Malformed responses are retried and ultimately fail closed; they are never normalized into synthetic evidence.

## Provider prompt contract

Provider adapters derive their required root fields from the active JSON Schema. They must not hard-code pointwise fields such as `caseScores` and `familyAssessment`, because the same adapters are used for pairwise responses.

This applies to Ollama, OpenAI-compatible endpoints, DeepSeek, and Gemini.

## Artifacts and resume behavior

Pairwise rows are written to:

`artifacts/ai-plan-judge/latest/judge-pairwise.jsonl`

Swap metrics and edge-derived family summaries are attached under each family entry in:

`artifacts/ai-plan-judge/latest/judge-stability.json`

A family with no registered/evaluated edges is explicitly reported as `coverage: "uncovered"`; its edge-derived ratio and scores are `null`, not a perfect score. This keeps absent comparison coverage distinct from positive sensitivity evidence.

Pointwise samples remain independently resumable. Pairwise rows are currently **rebuilt on every pairwise run**, including `--resume`. The pairwise file is truncated before rebuilding so resumed runs cannot append duplicate edge rows. This is deliberate until pairwise results receive their own provenance-aware cache.

Run-manifest compatibility includes the base seed, seed strategy, pairwise flag, position-bias flag, and pairwise rubric scale. Changing any of those invalidates reuse of a supposedly identical run configuration.

## Failure mode expectations

The pairwise path must fail closed when:

- a registered edge references a case missing from the family packet
- provider output identifies the wrong displayed cases
- a 0..4 score is fractional
- required evidence is empty
- actual direction or response assessment is outside the declared enum

These are harness integrity failures, not judge opinions, and should never be converted into a low score or ignored row.
