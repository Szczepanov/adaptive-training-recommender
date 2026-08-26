# Scientific Validation & Closed Feedback Loop

* **Capability prefix:** `SV`
* **Status:** `In progress`
* **Approved:** 2026-08-26
* **Blocked by:** none for evidence-only data modeling and analytical modules (`SV0`–`SV5`); `SV6` longitudinal calibration requires multi-block real athlete history.
* **Unlocks:** Signal information-value quantification, short vs. long baseline calibration, collinearity diagnostics, complete closed feedback loop telemetry, counterfactual regret tracking, and prospective real-world outcome validation.
* **Source analysis:** [`2026-08-26-scientific-and-recommendation-quality-validation.md`](../analysis/2026-08-26-scientific-and-recommendation-quality-validation.md)
* **Review hardening:** [`2026-08-26-scientific-validation-review-hardening.md`](../analysis/2026-08-26-scientific-validation-review-hardening.md)
* **Origin / architecture reused:** ADR-0010 (Replay & provenance), ADR-0013 (Injury constraints), ADR-0020 (Subjective baselines), ADR-0023 (Multidomain session evidence), ADR-0025 (Physiological anomaly evaluation), and OV (Performance outcome validation).

> **This is an evidence and calibration capability, not an immediate recommendation-policy mutation.**
> `SV*` modules collect, reconcile, and derive evidence regarding recommendation efficacy, athlete adherence, recovery trajectories, and regret. They operate as analysis sidecars and do not silently modify same-day selection weights without an explicit, versioned ADR.

> **Counterfactual labels are observational heuristics, not causal estimates.**
> A single realized session reveals only the observed outcome. Alternate outcomes remain unobserved and must be treated as candidate comparisons for later prospective calibration rather than asserted facts.

---

## Goal

Instrument and validate the closed adaptive training loop:

```text
Evidence
  -> Recommendation
  -> Athlete Decision (accept / scale / substitute / reject)
  -> Completed Session (dose reconciliation)
  -> Prospective Recovery & Performance Outcome (24-72h recovery, OV benchmarks, illness/injury)
  -> Calibration & Counterfactual Regret Analysis
  -> Versioned Policy Refinement
```

The capability must answer:
1. Does each input signal (HRV, RHR, Sleep, Respiration, Load, Soreness) materially improve daily decisions?
2. Are $7\text{d}$ rolling acute windows and $28\text{d}$ chronic reference baselines optimally balanced for signal-to-noise ratio?
3. Are highly correlated or nonlinearly dependent signals being double-counted across cascading stress states?
4. How often does the athlete modify or reject engine recommendations, and what reasons are reported?
5. Which recommendation/athlete-decision patterns are prospectively associated with favorable or adverse multi-day recovery and performance?
6. What is the operational regret-label rate, and which candidate counterfactuals should be tested prospectively?

---

## Non-goals

This plan does **not**:
* Replace prospective human/field outcomes with offline LLM judge agreement;
* Create a single opaque "AI confidence" scalar;
* Silently adjust production fatigue decay half-lives or readiness gates before calibration evidence is reviewed;
* Override athlete agency or force locked execution;
* Leak user health data across user isolation boundaries;
* Claim causal effects or known counterfactual outcomes from a single-session observational record.

---

## Delivery Graph

```text
SV0: Architecture Contract & Analysis Baseline
  |
  v
SV1: Closed-Loop Telemetry & Feedback Domain Models
  |
  +-------------------------------+
  |                               |
  v                               v
SV2: Signal Information Value    SV3: Counterfactual Regret
     & Collinearity Analytics         & Usefulness Evaluator
  |                               |
  +-------------------------------+
  |
  v
SV4: Outcome & Shadow Integration (BlockOutcomeReport & ShadowLogRow)
  |
  v
SV5: Verification Suite & Scenario Invariant Assurance
  |
  v
SV6: Multi-Block Prospective Calibration Synthesis
```

---

## Task Board

### `SV0`: Architecture & Audit Baseline
- [x] Author `docs/analysis/2026-08-26-scientific-and-recommendation-quality-validation.md`.
- [x] Author `docs/plans/scientific-validation-and-feedback-loop.md`.

### `SV1`: Closed-Loop Domain Models & Validation (`app/src/feedback/`)
- [x] Define `feedbackModels.ts`:
  - `AthleteDecisionAction` (`accepted`, `scaled_down`, `scaled_up`, `substituted`, `rejected_rest`, `rejected_train_harder`).
  - `DoseReconciliation` (duration, work kJ, zone distribution, hold compliance).
  - `RecoveryTrajectory` (24h, 48h, 72h autonomic rebound, subjective tissue recovery).
  - `CounterfactualRegret` (classification, confidence, counterfactual alternative).
  - `SubjectiveUtility` (Likert utility score 1–5, coaching value).
- [x] Implement `feedbackValidation.ts` with fail-closed schema parsing, finite/range guards, and nested referential integrity.
- [x] Implement unit tests in `feedbackValidation.test.ts`.

### `SV2`: Signal Information Value & Collinearity Analytics (`app/src/engine/analytics/`)
- [x] Implement `signalFidelityEvaluator.ts`:
  - Quantify signal variance and exploratory normalized mutual information.
  - Compute Pearson collinearity matrix across HRV, RHR, Sleep, Respiration, Load, Soreness, and Readiness.
  - Assess $7\text{d}$ vs. $28\text{d}$ baseline stability on identical endpoint dates and expose insufficient-history state.
- [x] Implement unit tests in `signalFidelityEvaluator.test.ts`.

### `SV3`: Counterfactual Regret & Usefulness Evaluator (`app/src/feedback/`)
- [x] Implement `regretEvaluator.ts`:
  - Pure rule-based observational regret classifier.
  - Identifies `optimal_choice`, `overreaching_crash`, `unnecessary_forfeiture`, and `injury_exacerbation` while preserving an explicit `inconclusive` path.
  - Counterfactual alternatives are hypotheses/candidate comparisons, not asserted causal outcomes.
- [x] Implement strict `SubjectiveUtility` validation in `feedbackValidation.ts`.
- [x] Implement unit tests in `regretEvaluator.test.ts` and utility-schema coverage in `feedbackValidation.test.ts`.

### `SV4`: Outcome & Shadow Integration
- [x] Update `app/src/outcomes/blockOutcome.ts` to include feedback loop metrics in `BlockOutcomeReport`, via a new pure `app/src/outcomes/feedbackLoopEvidence.ts` read model (`deriveFeedbackLoopEvidence`) that aggregates `ClosedLoopFeedbackRecord[]` into decision-action counts, an operational regret-label rate (excluding `inconclusive`), and utility/dose-compliance averages. Additive only — evidence never participates in `verdict`.
- [x] Update `app/src/engine/shadowLog.ts` to include athlete decision and regret telemetry (`athleteDecisionAction`, `regretClass`, `regretConfidence`, `athleteDeclaredRegret`, `utilityScore`, `coachingHelpfulness`) in shadow log rows, sourced from an optional `feedbackRecord` on `ShadowLogDayInput`.
- [x] Verify test suite compatibility across `blockOutcome.test.ts` and `shadowLog.test.ts`; added `feedbackLoopEvidence.test.ts`.

### `SV5`: Verification & Invariant Assurance
- [x] Run full unit test suite (`npm test`) on the final review head — 2312 passed, 124 skipped.
- [x] Run scenario simulation suite (`npm run simulate:scenarios`) on the final review head — 32 scenarios simulated.
- [x] Run baseline diff (`npm run simulate:diff`) ensuring zero unintended drift in live decision policy — no semantic differences found.

### `SV6`: Multi-Block Prospective Calibration Synthesis
- [ ] Accumulate sufficient real-athlete history across multiple blocks before estimating signal marginal value or policy changes.
- [ ] Compare candidate baseline windows and signal combinations using prospective outcomes, not only offline agreement.
- [ ] Review any proposed production threshold/weight change through an explicit versioned ADR/policy update.
