# Scientific Validation & Closed Feedback Loop

* **Capability prefix:** `SV`
* **Status:** `In progress`
* **Approved:** 2026-08-26
* **Blocked by:** none for evidence-only data modeling and analytical modules (`SV0`–`SV5`); `SV6` longitudinal calibration requires multi-block real athlete history.
* **Unlocks:** Signal information-value quantification, short vs. long baseline calibration, collinearity diagnostics, complete closed feedback loop telemetry, counterfactual regret tracking, and prospective real-world outcome validation.
* **Source analysis:** [`2026-08-26-scientific-and-recommendation-quality-validation.md`](../analysis/2026-08-26-scientific-and-recommendation-quality-validation.md)
* **Origin / architecture reused:** ADR-0010 (Replay & provenance), ADR-0013 (Injury constraints), ADR-0020 (Subjective baselines), ADR-0023 (Multidomain session evidence), ADR-0025 (Physiological anomaly evaluation), and OV (Performance outcome validation).

> **This is an evidence and calibration capability, not an immediate recommendation-policy mutation.**
> `SV*` modules collect, reconcile, and derive evidence regarding recommendation efficacy, athlete adherence, recovery trajectories, and regret. They operate as analysis sidecars and do not silently modify same-day selection weights without an explicit, versioned ADR.

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
3. Are highly correlated signals being double-counted across cascading stress states?
4. How often does the athlete modify or reject engine recommendations, and what are the primary causal drivers?
5. Did following (or overriding) a recommendation result in favorable or adverse multi-day recovery and performance?
6. What is the counterfactual regret rate (*"Would a different recommendation have produced a better outcome?"*)?

---

## Non-goals

This plan does **not**:
* Replace prospective human/field outcomes with offline LLM judge agreement;
* Create a single opaque "AI confidence" scalar;
* Silently adjust production fatigue decay half-lives or readiness gates before calibration evidence is reviewed;
* Override athlete agency or force locked execution;
* Leak user health data across user isolation boundaries.

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
- [ ] Define `feedbackModels.ts`:
  - `AthleteDecisionAction` (`accepted`, `scaled_down`, `scaled_up`, `substituted`, `rejected_rest`, `rejected_train_harder`).
  - `DoseReconciliation` (duration, work kJ, zone distribution, hold compliance).
  - `RecoveryTrajectory` (24h, 48h, 72h autonomic rebound, subjective tissue recovery).
  - `CounterfactualRegret` (classification, confidence, counterfactual alternative).
  - `SubjectiveUtility` (Likert utility score 1–5, coaching value).
- [ ] Implement `feedbackValidation.ts` with strict schema parsing and error guards.
- [ ] Implement unit tests in `feedbackValidation.test.ts`.

### `SV2`: Signal Information Value & Collinearity Analytics (`app/src/engine/analytics/`)
- [ ] Implement `signalFidelityEvaluator.ts`:
  - Quantify signal variance contribution and mutual information.
  - Compute collinearity correlation matrix across HRV, RHR, Sleep, Respiration, Load, and Soreness.
  - Assess $7\text{d}$ vs. $28\text{d}$ baseline stability and noise damping under perturbation.
- [ ] Implement unit tests in `signalFidelityEvaluator.test.ts`.

### `SV3`: Counterfactual Regret & Usefulness Evaluator (`app/src/feedback/`)
- [ ] Implement `regretEvaluator.ts`:
  - Pure rule-based counterfactual regret classifier.
  - Identifies `optimal_choice`, `overreaching_crash`, `unnecessary_forfeiture`, and `injury_exacerbation`.
- [ ] Implement unit tests in `regretEvaluator.test.ts`.

### `SV4`: Outcome & Shadow Integration
- [ ] Update `app/src/outcomes/blockOutcome.ts` to include feedback loop metrics in `BlockOutcomeReport`.
- [ ] Update `app/src/engine/shadowLog.ts` to include athlete decision and regret telemetry in shadow log rows.
- [ ] Verify test suite compatibility across `blockOutcome.test.ts` and `shadowLog.test.ts`.

### `SV5`: Verification & Invariant Assurance
- [ ] Run full unit test suite (`npm test`).
- [ ] Run scenario simulation suite (`npm run simulate:scenarios`).
- [ ] Run baseline diff (`npm run simulate:diff`) ensuring zero unintended drift in live decision policy.
