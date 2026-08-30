# Evidence Pack — Strength + Concurrent Training

**Date:** 2026-08-30
**Status:** Implemented as an SKR3 evidence migration; recommendation behavior intentionally unchanged.

## Decision question

What does the current evidence support about adding strength training to endurance programs and sequencing strength with endurance work, and which exact scheduling/dose rules in the engine remain product calibration rather than scientific constants?

This pack deliberately separates three questions that are often conflated:

1. **Strength as an endurance intervention:** can supplemental strength improve endurance-athlete outcomes?
2. **Chronic concurrent adaptation:** does combining endurance + resistance broadly compromise adaptation, and does exercise order materially change long-term outcomes?
3. **Acute scheduling cost:** how much residual fatigue should be allowed before a key sport-specific session?

The evidence is useful for the first two questions. It is much less direct for the third, so acute key-session protection remains product policy rather than a literature-derived fixed interval.

## Search and appraisal approach

The review prioritized recent systematic reviews, meta-analyses and umbrella reviews, then used older sequence-specific synthesis and an elite-athlete consensus where they answer narrower questions not fully resolved by the newest umbrella evidence. Publication type was not treated as an automatic certainty score.

Appraisal emphasized:

- trained endurance-athlete directness;
- running- and cycling-specific outcomes;
- performance/economy or efficiency versus VO2max;
- resistance-training method and dose heterogeneity;
- certainty/risk-of-bias limitations;
- chronic adaptation versus acute residual fatigue;
- sequence effects versus same-day/calendar-day separation;
- representation of highly trained/elite athletes.

## Evidence selected

### Supplemental strength training for endurance athletes

**Ramos-Campo et al., 2025 — endurance-strength umbrella review**
PMID 40153564; DOI `10.1519/JSC.0000000000005056`.

The umbrella review synthesized 17 systematic reviews, 12 of which included meta-analysis. Supplemental strength training was generally favorable for endurance performance and running economy, while VO2max was not consistently improved. Most included reviews were rated low or critically low confidence, which limits certainty and prevents a universal strength prescription.

**Llanos-Lagos et al., 2024 — running systematic review/meta-analysis**
PMID 38627351; PMCID PMC11258194; DOI `10.1007/s40279-024-02018-z`.

High-load and combined strength methods improved middle- and long-distance running performance. VO2max, vVO2max and maximum metabolic steady-state outcomes were not significantly improved. Programs were heterogeneous in frequency, duration and method, and certainty ranged from very low to moderate.

**Llanos-Lagos et al., 2026 — cycling systematic review/meta-analysis**
PMID 40632222; PMCID PMC12881108; DOI `10.1007/s00421-025-05883-2`.

Across 17 studies / 262 endurance cyclists, heavy strength training improved cycling efficiency, anaerobic power and pooled cycling performance. VO2max, pVO2max and MMSS were not significantly improved. The authors rated certainty low, so the review supports the direction of benefit more strongly than any exact prescription.

### Concurrent endurance + resistance training

**Held et al., 2026 — concurrent-training umbrella review**
PMID 41762427; DOI `10.1007/s40279-026-02401-y`; PROSPERO CRD42025646460.

The umbrella review synthesized 17 meta-analyses covering 144 studies and 1,492 healthy participants. Concurrent training broadly developed aerobic and strength-related qualities, with pooled strength, power and hypertrophy outcomes generally comparable with resistance training alone.

Training modality — simultaneous, same day or different day — did not significantly moderate pooled outcomes. Overall sequence effects were not significant, but the review's practical interpretation favors resistance-before-endurance when strength or hypertrophy is the primary target; sequence appears less important for aerobic development. Highly trained and elite athletes were sparse.

This is evidence about **chronic adaptation**. It does not quantify how much acute fatigue is acceptable before a particular key cycling/running session.

**Eddens et al., 2018 — concurrent sequence meta-analysis**
PMID 28917030; PMCID PMC5752732; DOI `10.1007/s40279-017-0784-1`.

The sequence-specific synthesis found a lower-body dynamic-strength benefit from resistance-before-endurance, while several other outcomes did not show a sequence effect. It did not establish that all athletes need a full-calendar-day separation between modalities.

**Bangsbo et al., 2025 — elite-athlete consensus**
PMID 40781883; PMCID PMC12334928; DOI `10.1111/sms.70112`.

The consensus supports individualized concurrent programming in elite sport and explicitly permits multiple training modalities on the same day. It is useful practical context for athlete-specific scheduling, but it is not a randomized estimate of acute residual fatigue and is therefore linked as partially direct evidence rather than used to manufacture a fixed recovery interval.

## Claim decisions

### `performance.endurance.strength_training.performance_support`

**Decision:** active, **low-certainty**, conditional intervention claim.

Supported interpretation:

- strength training can improve endurance performance and economy/efficiency in trained runners and cyclists;
- performance gains can occur through economy/efficiency, strength/power and related mechanisms without a reliable VO2max increase;
- high-load and combined methods are evidence-supported options.

Why certainty is low rather than moderate:

- the cycling meta-analysis explicitly rated certainty low;
- the running review ranged from very low to moderate;
- the umbrella review reported low or critically low confidence for most included reviews;
- the claim intentionally generalizes across running and cycling rather than inheriting the best certainty from one outcome or subgroup.

Not supported as universal science:

- exactly two or three strength sessions per week for every athlete;
- one universal `%1RM`, repetition range or progression rate;
- treating a strength session as direct VO2max training;
- assuming all endurance disciplines and athlete levels respond identically.

### `performance.concurrent.sequence.goal_priority`

**Decision:** active, moderate-certainty, conditional intervention claim with a **chronic** horizon.

Supported interpretation:

- endurance and resistance training can coexist without a universal chronic interference penalty across all outcomes;
- resistance-before-endurance is the better-supported order when lower-body strength or hypertrophy is the primary adaptation target;
- sequence appears less important when aerobic development is the primary outcome;
- pooled chronic evidence does not support a universal requirement for a full calendar day between modalities.

Not supported as universal science:

- resistance must always precede endurance regardless of goal;
- endurance must always precede resistance;
- sequence never matters;
- same-day training guarantees that a later key sport-specific session will be unaffected by acute fatigue;
- all heavy lower-body strength and key endurance work require a full calendar day between them;
- the engine's exact systemic-cost thresholds or workout-specific recovery-hour metadata.

The claim deliberately excludes `session_quality` as an evidence outcome. Acute key-session quality is a separate decision problem from chronic adaptation and should receive dedicated evidence if the product later wants to calibrate recovery intervals scientifically.

## Mapping to current engine policy

This is deliberately a **lineage-deepening pack**, not a coverage-inflation pack.

### Existing covered product policies that remain heuristic

`evergreen.strength_default_upper_target`

- Current product upper target: three strength sessions/week.
- The evidence supports strength as useful training, but does not validate `3` as a universal physiological maximum or optimum.

`spacing.strength_key_cycling_adjacency`

- Current product rule protects heavy lower-body strength and key cycling from same/adjacent-day placement.
- Chronic concurrent-training evidence permits same-day programming in some contexts and does not establish this exact 0–1-day rule as a universal adaptation requirement.
- The guardrail can still be a reasonable conservative product choice for protecting key-session quality; that acute cost is simply not quantified by the registered chronic claim.

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

The evidence strengthens the scientific boundary but does not identify a clearly superior replacement for the current exact scheduling/dose cut-points.

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
- keep the cross-sport strength claim at low certainty unless a future evidence review explicitly justifies an upgrade;
- preserve the resistance-before-endurance nuance for strength/hypertrophy without turning it into a universal order;
- keep the concurrent claim chronic and prevent `session_quality` from being silently claimed as a directly synthesized outcome;
- preserve the same-day/different-day evidence boundary and elite-consensus lineage;
- assert that exact strength targets and adjacency rules remain product heuristics;
- assert that hard-lower-body recovery remains partial and optimizer weights remain uncovered;
- assert that coverage totals do not change merely because lineage becomes richer.

## Next pack

Evidence Pack 5 will address **Taper + Fueling**.

The taper side can legitimately retire `periodization.taper_windows_volume` from the remaining P0 backlog if the registered claim cleanly separates evidence-supported pre-event taper principles from exact product timing/volume calibration and from post-event recovery.

Fueling will be treated differently: the current engine does not yet give fueling recommendations decision authority, so the pack should establish reusable scientific claims without pretending a nonexistent runtime policy has become covered.
