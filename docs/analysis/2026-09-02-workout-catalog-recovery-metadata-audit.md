# Workout Catalog Recovery Metadata Audit (SKR3 W3)

**Date:** 2026-09-02
**Status:** Completed
**Focus Family:** `spacing.hard_lower_body_recovery` (Domain: `session_spacing`, Classification: `product_heuristic`, Status: `partial`, Impact: `high`, Safety: `high`, Priority: `p1`)
**Parent Plan:** `docs/plans/2026-09-02-skr3-completion-plan.md` (§3, Workstream W3)

---

## 1. Executive Summary

As part of completing the Sports Knowledge Registry migration (SKR3), Workstream W3 audited every active workout in `app/src/workouts/catalog/` for declared recovery metadata (`loadProfile.recoveryHours` and `eligibility.minimumDaysAfterHardLowerBody`).

### Key Findings
1. **Universal Recovery Hours:** All 46 catalog workouts declare finite `recoveryHours` within the range $[0, 96]$, validated to stay within the canonical band $[0, 168]$ (7 days).
2. **Spacing Overrides:** 21 of 46 workouts declare `eligibility.minimumDaysAfterHardLowerBody` (18 workouts declare 1 day; 3 workouts declare 2 days).
3. **High Lower-Body Interaction:** 10 workouts whose associated engine template has `lowerBodyCost >= 0.6` declare `minimumDaysAfterHardLowerBody: 1`. This authored override permits back-to-back hard lower-body scheduling in `optimizer.ts:evaluateRecoveryConstraints`, diverging from the 48-hour neuromuscular recovery boundary (`strenuousLowerBodyResidualFatigue`).
4. **Protective Mitigation:** In most practical scenarios, consecutive placement is blocked by `RECOVERY_WINDOW_UNELAPSED` because these 10 workouts declare `recoveryHours: 48` or higher (which converts to $\lceil 48 / 24 \rceil = 2$ calendar days). However, an unelapsed recovery window only blocks candidates where `isHardOrAnchorCandidate` is true (`systemicCost >= 0.5` or anchor category).
5. **Coverage Conclusion:** `spacing.hard_lower_body_recovery` correctly remains **`partial` at P1** in `knowledgeCoverage.ts`. The scientific boundary is registered (`strenuousLowerBodyResidualFatigue`), the 2-day product fallback is registered (`hardLowerBodySpacing`), but the individual catalog overrides remain authored product heuristics that weaken the spacing rule. Resolving this behavior requires a dedicated `POLICY_VERSION` increment and simulation calibration.

---

## 2. Complete Catalog Enumeration

| Workout ID | Modality | Category | Recovery Hours | Min Days After Hard LB | Template IDs | Max Template Lower-Body Cost |
| :--- | :--- | :--- | :---: | :---: | :---: | :---: |
| `cycling_easy_spin_01` | cycling | easy_endurance | 6 | — | `end_easy_01` | 0.20 |
| `cycling_recovery_spin_01` | cycling | recovery | 4 | — | `end_easy_01` | 0.20 |
| `cycling_endurance_steady_01` | cycling | easy_endurance | 18 | — | `end_easy_01` | 0.20 |
| `cycling_endurance_long_01` | cycling | easy_endurance | 24 | — | `end_easy_01` | 0.20 |
| `cycling_cadence_drills_01` | cycling | technical_skill | 18 | — | `end_easy_01` | 0.20 |
| `cycling_pedaling_smoothness_01` | cycling | technical_skill | 18 | — | `end_easy_01` | 0.20 |
| `cycling_tempo_continuous_01` | cycling | tempo | 30 | — | `end_mod_02` | 0.50 |
| `cycling_tempo_intervals_01` | cycling | tempo | 30 | — | `end_mod_02` | 0.50 |
| `cycling_sweetspot_3x10_01` | cycling | tempo | 36 | — | `end_mod_02` | 0.50 |
| `cycling_controlled_threshold_4x8_01` | cycling | threshold | 48 | **1** | `end_hard_02` | **0.80** |
| `cycling_over_under_3x12_01` | cycling | over_under | 54 | **1** | `end_hard_02` | **0.80** |
| `cycling_race_simulation_50_01` | cycling | race_simulation | 72 | **2** | `end_race_sim_01` | **0.60** |
| `cycling_event_specific_endurance_01` | cycling | race_simulation | 48 | **1** | `end_race_specific_01` | 0.35 |
| `cycling_gap_closing_01` | cycling | surge_tolerance | 48 | **1** | — | 0.00 |
| `running_walk_run_01` | running | easy_endurance | 24 | **1** | — | 0.00 |
| `running_easy_continuous_01` | running | easy_endurance | 24 | **1** | `end_easy_02` | 0.30 |
| `running_strides_foundation_01` | running | technical_skill | 18 | — | `end_easy_02` | 0.30 |
| `running_aerobic_progression_01` | running | easy_endurance | 30 | — | `end_mod_01` | 0.55 |
| `running_threshold_intervals_01` | running | threshold | 42 | — | `end_mod_01` | 0.55 |
| `running_tempo_continuous_01` | running | tempo | 30 | — | `end_mod_01` | 0.55 |
| `running_hill_bounds_01` | running | surge_tolerance | 42 | — | `end_hard_03` | **0.80** |
| `running_hill_repeats_01` | running | threshold | 42 | — | `end_hard_03` | **0.80** |
| `running_vo2_4x4_01` | running | threshold | 48 | **1** | `end_hard_01` | **0.80** |
| `running_long_run_01` | running | easy_endurance | 48 | **1** | `run_long_01` | **0.78** |
| `running_race_pace_01` | running | threshold | 42 | **1** | `run_race_pace_01` | **0.78** |
| `strength_bodyweight_full_body_01` | strength | full_body_strength | 24 | — | `str_full_02` | **0.80** |
| `strength_full_body_maintenance_01` | strength | full_body_strength | 48 | **1** | `str_full_01`, `str_full_03` | **0.80** |
| `strength_posterior_chain_01` | strength | full_body_strength | 30 | — | `str_lower_01` | **1.00** |
| `strength_lower_body_01` | strength | full_body_strength | 48 | **1** | `str_lower_01` | **1.00** |
| `strength_upper_body_support_01` | strength | full_body_strength | 24 | — | `str_full_02` | 0.30 |
| `strength_reactive_power_01` | strength | power_maintenance | 36 | **1** | `str_power_01` | 0.40 |
| `strength_movement_prep_01` | strength | mobility_prep | 12 | — | `str_full_02` | 0.30 |
| `strength_race_week_primer_01` | strength | power_maintenance | 24 | **1** | — | 0.00 |
| `field_controlled_maintenance_01` | field | field_maintenance | 48 | **2** | `field_maint_01` | **0.70** |
| `field_sprint_mechanics_foundation_01` | field | technical_skill | 30 | **1** | `field_technical_01` | **0.60** |
| `field_acceleration_braking_01` | field | technical_skill | 42 | **2** | `field_technical_02` | **0.60** |
| `cycling_vo2_6x3_01` | cycling | threshold | 48 | **1** | `end_hard_02` | **0.80** |
| `cycling_vo2_variable_01` | cycling | threshold | 48 | **1** | `end_hard_02` | **0.80** |
| `cycling_vo2_short_30_15_01` | cycling | threshold | 42 | **1** | `end_hard_02` | **0.80** |
| `cycling_taper_sharpening_01` | cycling | surge_tolerance | 36 | **1** | `end_taper_sharpen_01` | 0.25 |
| `field_taper_primer_01` | field | field_maintenance | 24 | — | `field_technical_01` | **0.60** |
| `rest_complete_01` | recovery | complete_rest | 0 | — | `rest_01` | 0.00 |
| `recovery_mobility_flow_01` | mobility | mobility_flow | 12 | — | `mob_01` | 0.00 |
| `recovery_walk_spin_01` | recovery | active_recovery | 16 | — | `mob_01` | 0.00 |
| `recovery_targeted_release_01` | mobility | soft_tissue | 12 | — | `mob_01` | 0.00 |
| `recovery_posture_reset_01` | mobility | posture_reset | 16 | — | `mob_01` | 0.00 |

---

## 3. Structural Analysis & Risk Assessment

### 3.1 Hard Lower-Body Spacing Mechanism (`optimizer.ts`)
The optimizer evaluates two recovery checks for hard lower-body work:
```ts
// Check 1: recovery window from yesterday's recoveryHours
if (isHardOrAnchorCandidate && histSummary.hasActivePriorRecoveryWindow) {
    reasons.push('RECOVERY_WINDOW_UNELAPSED');
}

// Check 2: minimum days after any hard lower-body session
const candidateLowerBodyCost = template.costProfile?.lowerBody ?? (STRENGTH_CATEGORIES.includes(template.category) ? 0.6 : 0);
if (candidateLowerBodyCost >= 0.6) {
    const minGapDays = options.resolveMinimumDaysAfterHardLowerBody?.(template.id) ?? 2;
    const hasViolation = histSummary.priorHardLowerBodyGaps.some(diff => diff < minGapDays);
    if (hasViolation) reasons.push('HARD_LOWER_BODY_SPACING_VIOLATION');
}
```

### 3.2 The 1-Day Override Behavior
When a workout declares `minimumDaysAfterHardLowerBody: 1`:
- `minGapDays` evaluates to `1`.
- If yesterday (`diff === 1`) had `lowerBodyCost >= 0.6`, `diff < minGapDays` evaluates to `1 < 1 === false`.
- Consequently, `HARD_LOWER_BODY_SPACING_VIOLATION` **does not fire**.
- For non-anchor workouts where `systemicCost < 0.5` (or when the preceding session had `recoveryHours < 48`), the candidate can be scheduled on consecutive calendar days.

### 3.3 Coaching & Physiology Rationale for the Overrides
Reviewing the authored workouts reveals why these overrides were introduced:
- **Cycling Quality (`cycling_controlled_threshold_4x8_01`, `cycling_vo2_6x3_01`):** Non-impact, concentric pedal mechanics produce far lower delayed-onset muscle soreness and mechanical damage than running or heavy squats. Coaches often allow threshold cycling the day after moderate lower-body work if systemic freshness permits.
- **Running Easy Continuous / Walk-Run:** Lower impact endurance runs were given `minimumDaysAfterHardLowerBody: 1` to prevent complete scheduling lockout in high-frequency training blocks.
- **Full Body Strength:** Lower-body strength was authored with 1-day spacing in early iterations before the 2-day default was standardized across the engine.

---

## 4. Enforcement & Validation

To prevent unvalidated drift in recovery metadata:
1. **Schema Validation (`validateWorkoutLibrary` in `app/src/workouts/validation.ts`):**
   - Enforces $0 \le \text{recoveryHours} \le 168$ (finite number).
   - Enforces $1 \le \text{minimumDaysAfterHardLowerBody} \le 7$ (integer).
2. **Automated Test Suite (`workoutRecoveryMetadata.test.ts`):**
   - Verifies the bounds for all 46 active workouts.
   - Audits modality distribution.
   - Asserts reject behavior on invalid values.
3. **Execution Script:** `npm run validate:workouts` executes this check during CI and pre-flight dev server start.

---

## 5. SKR Coverage Status

- **Classification:** `product_heuristic`
- **Coverage:** `partial`
- **Research Priority:** `p1`
- **Safety Impact:** `high`
- **Rationale:** The underlying scientific boundary (`strenuousLowerBodyResidualFatigue`) is registered with direct literature citations. The 2-day product fallback (`hardLowerBodySpacing`) is registered with alignment testing. However, the catalog's 1-day overrides remain empirical heuristics that loosen safety constraints. Retaining `partial` at P1 is the honest, evidence-grounded classification until behavior remediation is prioritized under a formal `POLICY_VERSION` increment.
