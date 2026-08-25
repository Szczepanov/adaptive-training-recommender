# AI judge calibration fixtures

This directory is the frozen, high-information control suite used to evaluate the offline AI
judge. It is not a planner corpus, a clinical dataset, or production training policy.

- `cases.jsonl` contains factual packets and optional source diagnostics. The primary packet
  builder removes `category`, presentation metadata, expectations, and `sourceDiagnostics`
  before model evaluation.
- `expected.json` contains frozen ordinal ranges, allowed classes, required evidence paths,
  and forbidden unsupported claims. It is never sent to the judge.

The suite intentionally uses clear controls. Expected outputs are ranges/classes rather than
perfect decimal scores. Numeric physiological parameter candidates are forbidden because the
synthetic cases contain no repeated athlete-specific calibration evidence. These initial
repository expectations are review inputs; they must not be described as human/expert-certified
or used as merge gates until domain review and repeated real runs support that use.

When changing a fixture, change its expectation in the same review and treat the resulting
fixture/expectation hashes as a new calibration contract. Do not reuse earlier reference-audit
results across that boundary.
