# Evidence Pack — Readiness, Sleep and HRV

**Date:** 2026-08-30  
**Status:** Implemented as SKR3 evidence migration; recommendation behavior intentionally unchanged.

## Decision question

Which parts of the live readiness model are supported by external sports/physiology evidence, and which parts are product calibration that must remain explicitly heuristic?

This review covers the live decision authority in `engine/rules.ts` and `engine/fatigue.ts`:

- HRV and resting-HR interpretation;
- sleep as a recovery/performance input;
- consumer wearable sleep / proprietary wellness-score limitations;
- acute versus longitudinal interpretation;
- the product's current objective-strain fusion, hard biometric floors and train/modify/recover cut-points;
- the separate internal-response model used by dimensional fatigue.

It deliberately does **not** migrate subjective readiness cut-points, injury/pain restrictions, taper rules, or the shadow-only sleep-recovery classifier.

## Search and appraisal approach

The search prioritized PubMed-indexed guidelines/consensus statements and systematic reviews/meta-analyses. Recent sources were preferred when they materially updated measurement validity or wearable technology. Publication type was not treated as an automatic certainty score.

For each candidate source, the review considered:

- directness to an athlete/readiness decision;
- whether the source evaluated performance/adaptation versus only association;
- measurement protocol and device validity;
- heterogeneity and sample size;
- whether the result justifies a direction of action or only says a signal may be informative;
- whether a numeric threshold was actually validated.

## Evidence selected

### HRV measurement and interpretation

**Carter et al., 2026 — HRV rigor/reproducibility guidelines**  
PMID 42495990; PMCID PMC13477148; DOI `10.1152/ajpheart.00041.2026`.

The guideline is highly relevant to the engine's interpretation boundary. It emphasizes that HRV depends materially on recording signal, duration, environment, posture/behavior, respiration and analytic approach. It explicitly cautions against interpreting HRV as a specific marker of cardiac sympathetic outflow or sympathovagal balance.

**Bellenger et al., 2016 — autonomic HR regulation and training status meta-analysis**  
PMID 26888648; DOI `10.1007/s40279-016-0484-2`.

Autonomic HR indices can move with both positive training adaptation and maladaptive/overreaching states. Direction alone is therefore not a unique readiness classifier; training tolerance and other context are required.

### HRV-guided training

**Düking et al., 2021 — systematic review/meta-analysis**  
PMID 34489178; DOI `10.1016/j.jsams.2021.04.012`.

Eight studies / 198 participants. HRV-guided interventions commonly prescribed fewer moderate/high-intensity sessions. The pooled effect on submaximal physiological outcomes was positive, while performance and VO2peak effects were small and not statistically significant.

**Manresa-Rocamora et al., 2021 — methodological systematic review/meta-analysis**  
PMID 34639599; PMCID PMC8507742; DOI `10.3390/ijerph181910299`.

HRV-guided training improved vagal-related HRV measures, but group-level aerobic-fitness/performance advantages were small/non-significant. Heterogeneous baseline and daily-change methods limit support for a universal decision algorithm.

**Interpretation:** HRV is defensible as one individualized input to adaptive training, especially to avoid unnecessary intensity under adverse trends. Current evidence does not justify an HRV-only hard stop, a universal millisecond threshold, or a claim that one HRV direction uniquely identifies overtraining/readiness.

## Sleep and athletic performance

**Walsh et al., 2021 — athlete sleep consensus**  
PMID 33144349; DOI `10.1136/bjsports-2020-102025`.

Athlete sleep need is individualized. Substantial sleep loss can impair performance; assessment should consider athlete context rather than a single universal duration recommendation or uncritical tracker output.

**Gong et al., 2024 — acute sleep-deprivation systematic review/meta-analysis**  
PMID 39006249; PMCID PMC11246080; DOI `10.2147/NSS.S467531`.

Twenty-seven studies. Acute sleep deprivation impaired overall athletic performance, with heterogeneous effects by sleep-loss pattern and performance domain. This is direct support for treating major sleep loss as decision-relevant, but it is much stronger evidence for substantial deprivation than for small night-to-night changes in a proprietary score.

**Cunha et al., 2023 — sleep-intervention systematic review**  
PMID 37462808; PMCID PMC10354314; DOI `10.1186/s40798-023-00599-z`.

Across 25 intervention studies, increasing sleep opportunity or using naps was the most consistently promising strategy, while the body of high-quality evidence remained limited.

**Interpretation:** sleep belongs in recovery/readiness decisions. The literature does not establish the product's sleep score 50/55 cut-points or a single athlete-independent minimum nightly sleep score.

## Consumer wearable measurement boundary

**Doherty et al., 2024 — living umbrella review of wearable accuracy**  
PMID 39080098; PMCID PMC11560992; DOI `10.1007/s40279-024-02077-2`; PROSPERO CRD42023402703.

The umbrella review included 24 systematic reviews and 249 non-duplicate validation studies. Validation coverage across commercially available devices/metrics was sparse and heterogeneous. Sleep measurement tended to overestimate total sleep time, commonly with >10% mean absolute percentage error.

**Schyvens et al., 2024 — Fitbit/Garmin/WHOOP versus polysomnography systematic review**  
PMID 38557808; PMCID PMC11004611; DOI `10.2196/52192`.

Garmin Vivosmart 4 and comparable devices can provide useful sleep estimates, but sleep duration/staging accuracy remains imperfect versus polysomnography. The review does not validate Garmin Body Battery or an app-specific sleep-score readiness threshold.

**Interpretation:** longitudinal wearable data can be useful, but a vendor composite score must not inherit the authority of PSG or validated ECG/HRV measurement. Device generation, firmware and proprietary algorithms matter.

## Claim decisions

### Scientific claims added

| Claim | Certainty | Authority | What it supports |
|---|---|---|---|
| `readiness.hrv.contextual_individualized_monitoring` | moderate | conditional | Consistent, longitudinal, contextual HRV can inform recovery/adaptation; isolated HRV is not readiness truth. |
| `readiness.hrv.guided_training.conditional_value` | low | conditional | HRV may guide conservative intensity adjustment; performance superiority remains small/inconsistent. |
| `readiness.sleep.loss_impairs_performance` | moderate | conditional | Meaningful acute sleep loss is performance-relevant; sleep opportunity can matter. |
| `readiness.sleep.consumer_wearable_measurement_limits` | moderate | informational | Wearable sleep estimates/proprietary scores have measurement/validation limits. |

### Product-policy claims added

The following exact policies remain `heuristic / not_applicable` scientific certainty:

- `policy.readiness.physiological_strain_model_v1`
  - HRV/RHR/sleep/respiration weights 0.5/0.3/0.2/0.3;
  - variability floors 3 ms / 1.5 bpm / 4 points / 1 br/min;
  - z cap 2.0;
  - multi-day multiplier 1.5.
- `policy.readiness.absolute_device_floors_v1`
  - sleep score <50 adds 0.5;
  - Body Battery deficit below 50, full at 25, max 0.3;
  - Body Battery <=20 forces recover;
  - Easy envelope below BB 30 or sleep score 55.
- `policy.readiness.acute_biometric_floors_v1`
  - RHR +6 bpm with >=0.6 contribution;
  - HRV -15 ms with >=1.0 contribution.
- `policy.readiness.mode_score_thresholds_v1`
  - modify at 1.0;
  - recover at 2.2;
  - conservative preference +0.4.
- `policy.readiness.internal_response_strain_model_v1`
  - HRV saturation 15 ms;
  - RHR saturation 10 bpm;
  - sleep strain below 75;
  - current signal-fusion coefficients.

These claims improve auditability. They do **not** convert the numbers into evidence-derived physiological cut-points.

## Coverage migration

Five P0 families move from uncovered to covered:

1. `readiness.physiological_strain_model`
2. `readiness.absolute_device_floors`
3. `readiness.acute_biometric_floors`
4. `readiness.mode_score_thresholds`
5. `fatigue.internal_response_model`

Coverage changes:

| Metric | Before | After |
|---|---:|---:|
| Covered | 10 | 15 |
| Partial | 1 | 1 |
| Uncovered | 31 | 26 |
| Not applicable | 5 | 5 |
| P0 backlog | 10 | 5 |
| High-impact uncovered | 18 | 13 |
| High-safety uncovered | 5 | 4 |

Remaining P0 families are intentionally visible:

- subjective readiness thresholds;
- injury tissue-response severity;
- injury region restriction mapping;
- generic pain envelope mapping;
- taper windows/volume.

## Why behavior does not change in this PR

The current architecture already contains several evidence-consistent safeguards:

- personal variability rather than only universal absolute HRV/RHR deltas;
- acute and multi-day trend components;
- multiple objective signals rather than HRV alone;
- subjective symptoms and known training load remain independent authority;
- missing historical fields contribute zero rather than fabricated adverse evidence;
- recommendation restriction is staged (`train` / `modify` / `recover`) rather than a binary biomarker veto.

The research does not identify a clearly superior replacement set of weights or thresholds that could responsibly be applied without athlete-specific validation. A behavior change here would therefore substitute one arbitrary calibration for another while pretending to be evidence-driven.

`POLICY_VERSION` is intentionally unchanged. Any future retuning should be a separate decision-policy PR with simulation, counterfactual analysis and athlete-outcome calibration.

## Tests added

- Scientific-vs-product epistemic-boundary tests.
- HRV isolated-dip behavior against personal variability.
- RHR +6 bpm and HRV -15 ms current hard-floor alignment.
- Sleep-score 49/50 penalty boundary.
- Body Battery 20/21 recover boundary.
- Internal-response normalization/fusion coefficient alignment.

These tests intentionally pin the **current product policy** so future threshold changes cannot silently leave stale claim text behind.

## Follow-up

Highest-value next evidence work is not more HRV papers. It is:

1. subjective readiness / fatigue / soreness threshold authority;
2. high-safety injury and pain restriction mapping;
3. taper/event-preparation policy;
4. later, calibration of readiness action thresholds using recommendation audits and athlete-specific outcomes.
