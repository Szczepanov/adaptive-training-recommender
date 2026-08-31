# PR #314 — adverse-recovery and taper evidence notes

Reviewed: 2026-08-31

This note records the evidence boundary used to review the adverse-recovery and taper changes in PR #314. It intentionally separates externally supported direction from product calibration. Exact app thresholds remain heuristics unless a cited source directly validates that threshold and action.

## 1. Taper policy

The active sports-knowledge claim `performance.taper.endurance.pre_event_volume_reduction` is consistent with the 2023 Wang et al. systematic review/meta-analysis: endurance tapers generally benefit from a substantial reduction in training volume while preserving meaningful training intensity. The meta-analysis reported significant time-trial improvement in the subgroup maintaining intensity, while the subgroup decreasing intensity did not show a significant improvement. It also found the strongest volume subgroup signal around a 41–60% reduction.

The engine's exact product contract remains distinct from those population-level effect estimates:

- `intensityScale = 1.0` during the taper;
- `volumeScale` falls linearly toward `0.6` at the event;
- exact A/B taper windows and the 0.6 endpoint are product calibration, not universal physiological constants.

PR #314 briefly introduced an additional five-day intensity reduction to 0.85 and a 0.5 volume endpoint. That created code-to-knowledge-registry drift and weakened the evidence-consistent principle of preserving intensity. The implementation was restored to the registered product contract and a direct alignment regression test was added.

Primary evidence:

- Wang Z, Wang YT, Gao W, Zhong Y. *Effects of tapering on performance in endurance athletes: A systematic review and meta-analysis.* PLoS One. 2023;18(5):e0282838. PMID 37163550. https://pubmed.ncbi.nlm.nih.gov/37163550/
- Bosquet L, Montpetit J, Arvisais D, Mujika I. *Effects of tapering on performance: a meta-analysis.* Med Sci Sports Exerc. 2007;39(8):1358-1365. PMID 17762369. https://pubmed.ncbi.nlm.nih.gov/17762369/

## 2. Subjective fatigue, soreness and stress

Subjective athlete-wellbeing measures are useful training-response signals. Saw, Main and Gastin's systematic review found subjective measures generally more sensitive and consistent than commonly used objective measures for changes in athlete wellbeing across acute and chronic training load.

That evidence supports treating severe self-reported fatigue/stress/soreness seriously. It does **not** validate this product's exact cut-points (`fatigue >= 8`, `stress >= 9`, `soreness >= 8`) or the exact internal fatigue floors attached to them.

Therefore:

- the thresholds are conservative product safety heuristics;
- they should not be described as diagnoses;
- `soreness >= 8` does not by itself prove muscle breakdown;
- the model's 48-hour lower-body/impact decay half-life is a planning calibration, not a biological requirement that every athlete needs exactly 48 hours to recover.

Evidence:

- Saw AE, Main LC, Gastin PB. *Monitoring the athlete training response: subjective self-reported measures trump commonly used objective measures: a systematic review.* Br J Sports Med. 2016;50(5):281-291. PMID 26423706. https://pubmed.ncbi.nlm.nih.gov/26423706/
- Jeffries AC et al. *Single-Item Self-Report Measures of Team-Sport Athlete Wellbeing and Their Relationship With Training Load: A Systematic Review.* Sports Med Open. 2020. PMID 32991706. https://pubmed.ncbi.nlm.nih.gov/32991706/

## 3. HRV, resting heart rate and combined recovery flags

HRV and resting-heart-rate changes can contribute useful context, but direction and magnitude are athlete-specific and affected by sleep, illness, training load, hydration, alcohol, psychological stress and measurement conditions. Existing registry claims correctly require longitudinal, within-athlete interpretation rather than treating a single population threshold as a diagnosis.

The PR's combined recovery rule (HRV delta <= -10, RHR delta >= +5, plus depleted Body Battery) is therefore best interpreted as a conservative **multi-signal escalation heuristic**. Combining concordant signals is preferable to calling one isolated wearable metric diagnostic, but the exact thresholds and their `recover` action are product policy.

Relevant evidence already represented in the registry includes Bosquet et al. (resting HR/overreaching) and Bellenger et al. (autonomic HR regulation/training status).

## 4. Garmin Body Battery

Garmin documents Body Battery as a proprietary composite derived from HRV, stress, sleep quality and activity. Current Garmin manuals classify roughly 5–25 as very low reserve energy (device generation permitting). This supports treating a very low value as useful context, but does not establish a medically validated training-readiness threshold.

Accordingly:

- Body Battery should remain one input among symptoms, subjective state, recent training and other longitudinal signals;
- `<= 20` recover and `<= 35` combined-escalation thresholds are product calibration;
- the app should not imply that Body Battery alone diagnoses overtraining, illness or autonomic dysfunction.

Vendor documentation:

- Garmin Body Battery owner-manual description: HRV, stress, sleep quality and activity are combined into the Body Battery estimate; 5–25 is described as very low reserve energy on current devices. https://www8.garmin.com/manuals/

## 5. Recovery persistence

PR #314 intentionally makes a severe multi-signal recovery state persist into forward planning: the next day is rest/mobility only and the following day is capped at modify-tier systemic cost. This is a conservative planner policy designed to prevent an unrealistically fast rebound when today's snapshot is severe.

The **direction** is defensible: recovery state should not disappear merely because the projection lacks tomorrow's measurements. The exact one-day lock plus second-day cap is not established by the cited literature as a universal recovery duration. It should remain testable policy, not physiological fact.

## 6. Review rule for future changes

When changing recovery or taper behavior:

1. change the code and the corresponding active knowledge/product-policy claim together;
2. add an alignment test when an exact policy scalar is intentionally registered;
3. distinguish evidence-supported direction from internal calibration in comments and PR descriptions;
4. prefer multi-signal, within-athlete context over single wearable thresholds;
5. never translate a model decay constant into an unsupported biological diagnosis or mandatory recovery duration.
