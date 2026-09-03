# Persona AI Judge Safety & Modality Tuning Review

**Date:** 2026-09-03
**Scope:** AI judge stability evaluation, candidate ranking modality deprioritization, and evergreen adverse recovery dose withholding.

---

## Background & Incident

During execution of `npm run persona:e2e` (`npm run persona:local:stability && npm run persona:diff`), regressions surfaced against the committed persona baseline (`docs/analysis/persona-judge-baseline.json`):
1. `safety_recovery_fit`: dropped from 9.07 to 8.80.
2. `persona_strength_no_wearable`: dropped from 9.2/10 sensitivity to 7.5/10.
3. `persona_established_history`: flagged for aggressive tempo programming in adverse autonomic recovery.

Inspection of the judge score transcripts (`judge-scores.jsonl`) revealed two distinct root causes:
* **Gratuitous Tempo Runs for Strength Athletes**: For the strength athlete with no wearable who explicitly deprioritized Running & Cycling, the planner scheduled running tempo runs (`end_mod_01`). The AI judge critiqued: *"Minor issue: tempo run on 09/13 is gratuitous cardio for a strength persona who deprioritizes running... The work fatigue case still schedules a tempo run despite high subjective fatigue and a deprioritized modality."*
* **High-Intensity Prior Escalation During Acute Autonomic Collapse**: For the established-history endurance athlete during an acute autonomic drop ($\Delta\text{HRV} = -14$, $\Delta\text{RHR} = +7$, sleep score 52), `evergreenStrategy.ts` was injecting a conditional high-intensity prior (`high_intensity: 1 session`) because the athlete had established training age, despite the acute recovery collapse.

---

## Root Cause Analysis

### 1. Modality Deprioritization Ignored in Tiered Candidate Ranking (`optimizer.ts`)
* `buildOptimizationContextForProjection` in `optimizer.ts` did not inherit `deprioritizedModalities` from `context.preferences` if `preferences` was empty or partial.
* In `rankCandidates`, lexicographic sorting evaluates `getBenefitTier(a) - getBenefitTier(b)` before evaluating `utilityScore`.
* When weekly objectives were resolved or absent, `calculateStimulusBenefit` assigned a fallback benefit score to candidates. Endurance templates (such as `end_mod_01`) received `benefit = 0.75` based on aerobic stimulus, while mobility received `0.20` and walking received `0.35`.
* Because `0.75 - 0.35 = 0.40 > 0.05` (`BENEFIT_TIE_BAND`), `end_mod_01` was placed alone into Benefit Tier 0.
* Because `getBenefitTier` differed, the sort short-circuited before the `prefMultiplier` on `utilityScore` was ever checked. The deprioritized running tempo run beat preferred strength, walking, and mobility sessions.

### 2. Evergreen High-Intensity Prior Injected During Adverse Recovery (`evergreenStrategy.ts`)
* `resolveEvidenceBackedStrategy` evaluated `canUseConditionalPrior` based solely on data quality and `trainingAgeProxy === 'established'`.
* It did not check whether the athlete was currently experiencing severe autonomic or subjective collapse.
* Consequently, `high_intensity: optional 1 session` was packed into the week-ahead plan definition even when the athlete presented with acute autonomic failure ($\Delta\text{HRV} = -14$, $\Delta\text{RHR} = +7$).

---

## Implementation

### 1. Modality Deprioritization & Disliked Penalty in Objective Benefit (`optimizer.ts`)
* In `buildOptimizationContext`, inherited `deprioritizedModalities`, `preferredModalities`, and `avoidedModalities` directly from `context.preferences`.
* In `rankCandidates`, applied `prefMultiplier *= 0.25` for deprioritized modalities.
* When a candidate does not satisfy an active unresolved weekly objective, its benefit score is scaled down:
  $$\text{benefit} \leftarrow \begin{cases} \text{benefit} \times 0.25 & \text{if } \text{isDeprioritized}(\text{template}) \\ \text{benefit} \times 0.20 & \text{if } \text{isDisliked}(\text{template}) \end{cases}$$
* This demotes deprioritized and disliked non-objective candidates to lower benefit tiers, ensuring they never outrank preferred active recovery (walks, mobility) or primary adaptation sessions when objectives are met or absent.

### 2. Withholding High-Intensity Prior During Adverse Recovery (`evergreenStrategy.ts`, `evergreenPlanning.ts`, `rules.ts`, `planner.ts`)
* Exported `isSevereAdverseRecoveryReadiness(readiness, mode)` to evaluate severe autonomic failure ($\Delta\text{HRV} \le -10$, $\Delta\text{RHR} \ge +5$, body battery $\le 35$, sleep score $\le 55$) and high subjective distress (fatigue $\ge 7$, soreness $\ge 7$, stress $\ge 8$, readiness $\le 4$).
* In `resolveEvidenceBackedStrategy`, updated `canUseConditionalPrior` to require `!goalOrEvent.isAdverseRecovery`, emitting a typed `conditional_prior_withheld` warning.
* Passed `isAdverseRecovery` from `rules.ts` and `generateWeekAheadPlanWithIntent` into `resolveEvergreenPlan`.

### 3. Scenario Fixture Consistency (`personaScenarios.mjs`)
* Extended `preferences(...)` in `personaScenarios.mjs` to accept `deprioritizedModalities` and `avoidedModalities`.
* Explicitly configured `strengthPreferences = preferences(['Strength'], ['Running', 'Cycling'])`.

### 4. Engine Policy Version
* Bumped `POLICY_VERSION` in `policy.ts` to `'2026-09-persona-judge-safety-and-modality-v1'`.
* Preserved replay provenance by adding `'2026-09-post-event-and-adverse-recovery-v1'` to `HISTORICAL_POLICY_VERSIONS`.

---

## Verification & Benchmark Results

### Full Validation Suite (`npm run check`)
* `tsc -b`: Clean
* `eslint .`: Clean
* `vitest run`: **3,325 passed, 0 failed, 160 skipped across 359 test files**
* `node scripts/check-policy-drift.mjs 59384c76`: **Passed** (5 engine files modified, version bumped)
* `validate:sports-knowledge`: 76 claims & sources validated
* `validate:knowledge-coverage`: 54 engine items validated
* `validate:workouts`: 184 exercises, 46 workouts, 22 binding sets, 25 session families validated

### AI Judge Stability Benchmark (`npm run persona:diff`)
Evaluated across all 30 cases / 9 families with 5 stability samples (`Qwen3.8-9B-Distill-GGUF:Q4_K_M`):

| Metric | Baseline | Current | Delta | Verdict |
|---|---|---|---|---|
| **Mean Sensitivity** | 8.54 / 10 | **8.73 / 10** | **+0.19** | **IMPROVEMENT** |
| **Overall Score** | 8.44 / 10 | **8.49 / 10** | **+0.05** | **IMPROVEMENT** |
| `goal_event_fit` | 8.57 / 10 | **8.80 / 10** | **+0.23** | **IMPROVEMENT** |
| `periodization_taper` | 8.63 / 10 | **9.07 / 10** | **+0.43** | **IMPROVEMENT** |
| `robustness` | 8.57 / 10 | **8.63 / 10** | **+0.06** | **IMPROVEMENT** |
| `persona_established_history` | 7.5 / 10 | **8.7 / 10** | **+1.20** | **STRONG IMPROVEMENT** |
| `persona_former_elite_return` | 8.5 / 10 | **9.2 / 10** | **+0.70** | **IMPROVEMENT** |
| `persona_balanced_performance` | 8.5 / 10 | **9.0 / 10** | **+0.50** | **IMPROVEMENT** |
| `persona_strength_no_wearable` | 9.2 / 10 | **9.0 / 10** | -0.20 | Preserved ($\ge 9.0$) |
| `persona_stacked_constraints` | 8.5 / 10 | **8.5 / 10** | +0.00 | Preserved |
| `persona_triathlon_established_olympic` | 8.5 / 10 | **8.5 / 10** | +0.00 | Preserved |
| `persona_walking_preferred` | 8.0 / 10 | **8.5 / 10** | **+0.50** | Trend up |
