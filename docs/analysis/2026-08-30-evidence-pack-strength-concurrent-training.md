# Evidence Pack — Strength + Concurrent Training

**Date:** 2026-08-30
**Status:** Implemented as an SKR3 evidence migration; recommendation behavior intentionally unchanged.

## Decision question

What does the current evidence support about adding strength training to endurance programs and sequencing strength with endurance work, and which exact scheduling/dose rules in the engine remain product calibration rather than scientific constants?

This pack deliberately separates two questions that are often conflated:

1. **Chronic adaptation:** does supplemental strength training improve endurance-athlete outcomes, and does concurrent endurance + resistance training broadly compromise adaptation?
2. **Scheduling policy:** does the evidence justify the product's exact weekly strength targets, 0–1-day heavy-strength/key-cycling exclusion, systemic-cost thresholds, or workout-specific recovery hours?

The answer is stronger for the first question than the second.

## Search and appraisal approach

The review prioritized recent systematic reviews, meta-analyses and umbrella reviews, then used older sequence-specific synthesis where it still answers a narrower question not superseded by the newer umbrella evidence. Publication type was not treated as an automatic certainty score.

Appraisal emphasized:

- trained endurance-athlete directness;
- running- and cycling-specific outcomes;
- performance/economy or efficiency versus VO2max;
- resistance-training method and dose heterogeneity;
- sequence effects versus same-day/calendar-day separation;
- chronic adaptation versus acute residual fatigue and key-session quality;
- certainty/risk-of-bias limitations and representation of highly trained/elite athletes.

## Evidence selected

### Supplemental strength training for endurance athletes

**Ramos-Campo et al., 2025 — endurance-strength umbrella review**
PMID 40153564; DOI `10.1519/JSC.0000000000005056`.

The umbrella review synthesized 17 systematic reviews, 12 of which included meta-analysis. Supplemental strength training was generally favorable for endurance performance and running economy, while VO2max was not consistently improved. Confidence in many included reviews was low or critically low, which limits claims that one strength method, frequency or loading scheme is universally optimal.

**Llanos-Lagos et al., 2024 — running systematic review/meta-analysis**
PMID 38627351; PMCID PMC11258194; DOI `10.1007/s40279-024-02018-z`.

High-load and combined strength methods improved middle- and long-distance running performance. VO2max, vVO2max and maximum metabolic steady-state outcomes were not significantly improved. Programs were heterogeneous in frequency, duration and method, and certainty ranged from very low to moderate.

**Llanos-Lagos et al., 2026 — cycling systematic review/meta-analysis**
PMID 40632222; PMCID PMC12881108; DOI `10.1007/s00421-025-05883-2`.

Across 17 studies / 262 endurance cyclists, heavy strength training improved cycling efficiency, anaerobic power and pooled cycling performance. VO2max, pVO2max and MMSS were not significantly improved. The authors rated certainty low, so the review supports the direction of benefit more strongly than any exact prescription.

### Concurrent endurance + resistance training

**Held et al., 2026 — concurrent-training umbrella review**
PMID 41762427; DOI `10.1007/s40279-026-02401-y`; PROSPERO CRD42025646460.

The umbrella review synthesized 17 meta-analyses covering 144 studies and 1,492 healthy participants. Concurrent training broadly developed aerobic and strength-related qualities, with strength, power and hypertrophy outcomes generally comparable with resistance training alone. The synthesis did not identify a robust universal sequence effect. Highly trained and elite athletes were comparatively sparse, so sport-specific key-session scheduling still needs judgment.

**Eddens et al., 2018 — concurrent sequence meta-analysis**
PMID 28917030; PMCID PMC5752732; DOI `10.1007/s40279-017-0784-1`.

The older sequence-specific synthesis found some lower-body dynamic-strength sensitivity to exercise order, but did not establish that all athletes need a full-calendar-day separation between modalities. The newer umbrella evidence reduces confidence in treating one sequence as universally superior.

## Claim decisions

### `performance.endurance.strength_training.performance_support`

**Decision:** active, moderate-certainty, conditional intervention claim.

Supported interpretation:

- strength training belongs in endurance programming when aligned with athlete goals and recovery capacity;
- performance gains can occur through economy/efficiency, strength/power and related mechanisms;
- lack of a VO2max increase does not imply lack of endurance-performance benefit;
- high-load and combined methods are evidence-supported options.

Not supported as universal science:

- exactly two or three strength sessions per week for every athlete;
- one universal `%1RM`, repetition range or progression rate;
- treating a strength session as direct VO2max training;
- assuming all endurance disciplines and athlete levels respond identically.

### `performance.concurrent.sequence.goal_priority`

**Decision:** active, moderate-certainty, conditional intervention claim.

Supported interpretation:

- endurance and resistance training can coexist without a universal chronic "interference" penalty across all outcomes;
- when work is colocated, order can reasonably reflect the athlete's priority and the quality needed from the important session;
- acute fatigue and key-session protection remain legitimate reasons to separate work even when same-day concurrent training is physiologically permissible.

Not supported as universal science:

- resistance must always precede endurance;
- endurance must always precede resistance;
- all heavy lower-body strength and key endurance work require a full calendar day between them;
- the engine's exact systemic-cost thresholds or workout-specific recovery-hour metadata.

## Mapping to current engine policy

This is deliberately a **lineage-deepening pack**, not a coverage-inflation pack.

### Existing covered product policies that remain heuristic

`evergreen.strength_default_upper_target`

- Current product upper target: three strength sessions/week.
- The new evidence supports strength as useful training, but does not validate `3` as a universal physiological maximum or optimum.

`spacing.strength_key_cycling_adjacency`

- Current product rule protects heavy lower-body strength and key cycling from same/adjacent-day placement.
- The concurrent-training literature supports context-aware scheduling and key-session protection, but does not establish this exact 0–1-day rule as a universal adaptation requirement.

### Still partial

`spacing.hard_lower_body_recovery`

- The default scientific/product boundary already has explicit lineage.
- It remains **partial / P1** because catalog-specific `recoveryHours` and `minimumDaysAfterHardLowerBody` values can override the fallback and still require workout-by-workout audit.

### Still uncovered

`optimizer.stimulus_benefit_weights`

- Strength evidence does not justify copying pooled effect sizes into the optimizer's utility weights.
- Those weights remain **uncovered / P2** calibration until they receive their own model/evidence treatment.

## Coverage impact

No coverage state changes are made in this pack.

Current inventory remains:

| Metric | Value |
|---|---:|
| Total policy families | 47 |
| Covered | 15 |
| Partial | 1 |
| Uncovered | 26 |
| Not applicable | 5 |
| P0 backlog | 5 |
| High-impact uncovered | 13 |
| High-safety uncovered | 4 |

That is intentional. Better evidence does not require inventing a new covered engine family when the relevant scheduling family already has explicit scientific + product-policy lineage.

## Why recommendation behavior does not change

The evidence strengthens confidence in the architecture but does not identify a clearly superior replacement for the current exact scheduling/dose cut-points.

Therefore this PR does **not** change:

- strength session-count defaults;
- heavy-strength/key-cycling adjacency;
- hard-lower-body recovery thresholds;
- workout `recoveryHours` metadata;
- optimizer strength benefit weights;
- session eligibility, ranking or prescription logic.

`POLICY_VERSION` remains unchanged.

Any future change to those values should be a separate decision-policy PR with simulation/counterfactual testing and, where possible, athlete-specific outcome calibration.

## Tests and registry safeguards

The pack adds regression tests that:

- validate the complete cross-domain registry;
- pin stable PMID/PMCID/DOI/PROSPERO identities;
- preserve the performance/economy-versus-VO2max distinction;
- prevent sequence evidence from becoming a universal same-day/separation rule;
- assert that exact strength targets and adjacency rules remain product heuristics;
- assert that hard-lower-body recovery remains partial and optimizer weights remain uncovered;
- assert that coverage totals do not change merely because lineage becomes richer.

## Next pack

Evidence Pack 5 will address **Taper + Fueling**.

The taper side can legitimately retire `periodization.taper_windows_volume` from the remaining P0 backlog if the registered claim cleanly separates evidence-supported pre-event taper principles from exact product timing/volume calibration and from post-event recovery.

Fueling will be treated differently: the current engine does not yet give fueling recommendations decision authority, so the pack should establish reusable scientific claims without pretending a nonexistent runtime policy has become covered.
