# Scientific Validation PR Review Hardening

**Date:** 2026-08-26
**PR:** #228
**Scope:** review corrections for the initial `SV1`–`SV3` implementation. These changes remain evidence-sidecar work and do not mutate production recommendation policy.

## Review findings

### 1. Baseline-window comparison used different calendar populations

The original `evaluateBaselineWindowStability()` generated the 7-day rolling-mean series from day 7 onward while the 28-day series started only on day 28. Comparing the variance of those two differently dated series can confound window length with regime/trend changes in the extra early period.

**Correction:** compute both 7-day and 28-day means only for endpoints where the 28-day window exists. The two variance estimates now use identical endpoint dates. The result also exposes `comparisonPoints` and `sufficientData`; a single chronic-window endpoint is not treated as an empirical variance estimate.

### 2. Presentation rounding could change collinearity classification

The original Pearson coefficient was rounded to three decimals before the `|r| >= threshold` decision. A raw value such as `0.6996` therefore became `0.700` and was incorrectly promoted across a `0.70` threshold.

**Correction:** thresholding uses the unrounded coefficient. Rounding is presentation-only.

### 3. Pearson correlation alone misses nonlinear redundancy

Pearson correlation is useful for linear dependence, but two signals can contain strongly overlapping information with near-zero Pearson `r` when their relationship is nonlinear.

**Correction:** pairwise diagnostics now include a deterministic, discretized normalized mutual-information estimate. It is deliberately treated as an **exploratory dependence diagnostic**, not a causal or calibrated predictive score. The estimator requires adequate paired sample count and returns `null` for zero entropy or insufficient history.

### 4. "Strict" feedback validation still admitted malformed scientific telemetry

The initial parsers accepted or silently normalized several invalid states, including:

- `NaN` / `Infinity` in durations or work;
- negative/non-finite zone seconds;
- hold compliance outside `0..100` or malformed values silently converted to `null`;
- fractional step-omission counts;
- invalid `athleteDeclaredRegret` values silently converted to `null`;
- malformed counterfactual alternatives silently converted to `null`;
- permissive timestamps without a required timezone/offset;
- no parser for `RecoveryTrajectory`, `SubjectiveUtility`, or the aggregate `ClosedLoopFeedbackRecord`.

**Correction:** validation now fails closed on malformed telemetry, validates all modeled closed-loop record types, bounds Likert/readiness/soreness fields, validates temporal ordering, and enforces top-level/nested date and recommendation-reference consistency.

### 5. The regret classifier overstated causal certainty

A single observed decision/outcome pair never reveals the unobserved counterfactual. The initial rules made causal claims such as a lower dose "would have preserved" adaptation and inferred `unnecessary_forfeiture` merely because the athlete looked fresh after taking rest. Freshness after rest is partly an outcome of the rest itself, so that logic is circular.

The original `injury_exacerbation` rule also treated high post-session soreness as proof of exacerbation without requiring worsening from the pre-session state.

**Correction:**

- counterfactual alternatives are described as **candidate comparisons**, not known alternate outcomes;
- overreaching regret requires a higher-than-recommended athlete decision plus corroborated 48-hour suppression;
- suppression after following the recommendation is `inconclusive`, not automatically blamed on the recommendation;
- possible tissue exacerbation requires meaningful worsening from a symptomatic baseline and explicitly states that the label is not a clinical diagnosis or causal proof;
- unnecessary forfeiture requires both sustained 24/48-hour freshness **and** athlete-declared regret after rejecting a `proceed` recommendation;
- ambiguous observations remain `inconclusive` rather than being forced into a success/failure class;
- default `optimal_choice` confidence is bounded because absence of an adverse signal is not proof of causal optimality.

## Scientific interpretation guardrails

1. **Association is not causation.** The regret classifier is an operational labeler for prospective calibration, not a causal estimator.
2. **Mutual information is exploratory.** Discretized NMI is sensitive to binning and sample size; do not set production gates from it without prospective calibration and stability analysis.
3. **Window-damping metrics are descriptive.** Overlapping rolling windows are autocorrelated. Use the metric to compare candidate window behavior, not for classical independent-sample inference.
4. **No policy mutation in SV1–SV3.** These changes instrument and characterize evidence only. Any recommendation-weight/gate change still requires a versioned policy/ADR decision.
5. **Missing/invalid data must be visible.** Invalid telemetry is rejected and insufficient history is labeled explicitly rather than represented as apparently normal zero variance.

## Verification added in this review

Targeted tests now cover:

- nonlinear dependence with near-zero Pearson correlation;
- raw-vs-rounded collinearity threshold behavior;
- aligned 7d/28d baseline endpoints and insufficient-history reporting;
- finite/range/integer schema validation;
- full recovery, utility, and aggregate closed-loop record parsing;
- nested date/recommendation referential integrity;
- counterfactual-causality guardrails in regret classification.

The repository CI remains the authoritative whole-repository verification gate after the review commit is pushed.
