# Evidence Pack — Readiness, Sleep, HRV, RHR and Respiration

**Date:** 2026-08-30
**Status:** Implemented as SKR3 evidence migration; recommendation behavior intentionally unchanged.

## Decision question

Which parts of the live objective-readiness model are supported by external sports/physiology evidence, and which parts are product calibration that must remain explicitly heuristic?

This review covers the live decision authority in `engine/rules.ts` and `engine/fatigue.ts`:

- HRV interpretation and HRV-guided training;
- resting-heart-rate interpretation;
- sleep as a recovery/performance input;
- consumer wearable sleep / proprietary wellness-score limitations;
- resting/nocturnal respiration as a longitudinal context signal;
- acute versus longitudinal interpretation;
- the product's current objective-strain fusion, hard biometric floors and train/modify/recover cut-points;
- the separate internal-response model used by dimensional fatigue.

It deliberately does **not** migrate subjective readiness cut-points, injury/pain restrictions, taper rules, or the shadow-only sleep-recovery classifier.

## Search and appraisal approach

The search prioritized PubMed-indexed guidelines/consensus statements, systematic reviews/meta-analyses and large or prospective cohorts when the evidence question was measurement/longitudinal detection rather than an intervention. Recent sources were preferred when they materially updated measurement validity or wearable technology. Publication type was not treated as an automatic certainty score.

For each candidate source, the review considered:

- directness to an athlete/readiness decision;
- whether the source evaluated performance/adaptation versus only association or detection;
- measurement protocol and device validity;
- within-athlete versus between-athlete interpretation;
- heterogeneity and sample size;
- whether the result justifies a direction of action or only says a signal may be informative;
- whether a numeric threshold was actually validated;
- conflicts, sponsorship/device affiliation and generalizability where relevant.

## Evidence selected

### HRV measurement and interpretation

**Carter et al., 2026 — HRV rigor/reproducibility guidelines**
PMID 42495990; PMCID PMC13477148; DOI `10.1152/ajpheart.00041.2026`.

The guideline is highly relevant to the engine's interpretation boundary. HRV depends materially on recording signal, duration, environment, posture/behavior, respiration and analytic approach. It cautions against interpreting HRV as a specific marker of cardiac sympathetic outflow or sympathovagal balance.

**Bellenger et al., 2016 — autonomic HR regulation and training-status meta-analysis**
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

## Resting heart rate

**Bosquet et al., 2008 — overreaching systematic review/meta-analysis**
PMID 18308872; DOI `10.1136/bjsm.2007.042200`.

Competitive-athlete overload studies showed a short-term increase in resting HR, but the effect was modest relative to ordinary day-to-day variability. The review explicitly concluded that HR/HRV fluctuations need to be compared with other overreaching signs and symptoms to become meaningful.

**Quer et al., 2020 — 92,457-person longitudinal wearable cohort**
PMID 32023264; PMCID PMC7001906; DOI `10.1371/journal.pone.0227709`.

Daily resting HR differed substantially between people but was much more stable within a person over time. This is strong support for a personal-baseline architecture and weak support for population-normal readiness thresholds. The cohort was a broad adult population, not an athlete intervention study, so its role is baseline interpretation rather than training prescription.

**Interpretation:** resting HR is a useful contextual and longitudinal signal. It is nonspecific and is influenced by training stress, illness, hydration, heat, sleep, medication, alcohol and emotional stress. The reviewed evidence does not establish `+6 bpm`, the 1.5 bpm variability floor, product weight `0.3`, the 10 bpm internal-response saturation, or any population-normal resting-HR value as a universal training-action threshold.

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

**Interpretation:** sleep belongs in recovery/readiness decisions. The literature does not establish the product's sleep-score 50/55 cut-points or a single athlete-independent nightly score threshold.

## Consumer wearable measurement boundary

**Doherty et al., 2024 — living umbrella review of wearable accuracy**
PMID 39080098; PMCID PMC11560992; DOI `10.1007/s40279-024-02077-2`; PROSPERO CRD42023402703.

The umbrella review included 24 systematic reviews and 249 non-duplicate validation studies. Validation coverage across commercially available devices/metrics was sparse and heterogeneous. Sleep measurement tended to overestimate total sleep time, commonly with material error.

**Schyvens et al., 2024 — Fitbit/Garmin/WHOOP versus polysomnography systematic review**
PMID 38557808; PMCID PMC11004611; DOI `10.2196/52192`.

Garmin Vivosmart 4 and comparable devices can provide useful sleep estimates, but sleep duration/staging accuracy remains imperfect versus polysomnography. The review does not validate Garmin Body Battery or an app-specific sleep-score readiness threshold.

**Interpretation:** longitudinal wearable data can be useful, but a vendor composite score must not inherit the authority of PSG or validated ECG/HRV measurement. Device generation, firmware and proprietary algorithms matter.

## Resting/nocturnal respiration

Respiration has a materially weaker evidence path to *training readiness* than HRV, RHR or sleep. The best evidence found supports measurement validity, within-person longitudinal stability and illness/anomaly context rather than an athlete training-action rule.

**Natarajan et al., 2021 — wearable respiratory-rate measurement and COVID-19 cohort**
PMID 34526602; PMCID PMC8443549; DOI `10.1038/s41746-021-00493-6`.

Wearable nocturnal respiratory-rate estimates agreed well with sleep-study reference data in a small validation set. A 10,000-person cohort showed relatively low short-term within-person variation, while a separate infected cohort showed longitudinal respiratory-rate elevations in some participants. The work was Fitbit-affiliated and does not validate sports-readiness decisions.

**Esmaeilpour et al., 2024 — prospective respiratory-infection wearable model validation**
PMID 39018555; PMCID PMC11292157; DOI `10.2196/53716`.

The prospective model used sleeping resting HR, respiratory rate and HRV together rather than respiratory rate in isolation. Alerts sometimes preceded respiratory infections, but positive predictive value was low in the study population. False-positive alerts were associated with intense exercise, poor sleep, emotional stress and alcohol, which is important evidence against calling respiratory rate a specific illness signal.

**Interpretation:** nocturnal/resting respiratory rate can be useful as a stable personal-context signal and can contribute to a multivariate anomaly assessment. Evidence reviewed here does **not** justify describing it as a specific illness detector, a standalone readiness marker, or a reason by itself to stop training. It does not validate the current `1 br/min` variability floor, `0.3` readiness weight, shared z cap or chronic multiplier.

The existing `engine/rules.ts` comment that describes elevated respiration as one of the "earliest, most specific" signs of illness is scientifically too strong. This evidence pack supersedes that interpretation in the knowledge layer: respiration is **contextual and nonspecific**. The comment itself is not changed in this behavior-preserving PR because the repository's current policy-drift gate mechanically treats any edit to `rules.ts` as a decision-policy change requiring a `POLICY_VERSION` bump. A later drift-gate refinement can permit comment-only correction without changing policy identity.

## Claim decisions

### Scientific claims added

| Claim | Certainty | Authority | What it supports |
|---|---|---|---|
| `readiness.hrv.contextual_individualized_monitoring` | moderate | conditional | Consistent, longitudinal, contextual HRV can inform recovery/adaptation; isolated HRV is not readiness truth. |
| `readiness.hrv.guided_training.conditional_value` | low | conditional | HRV may guide conservative intensity adjustment; performance superiority remains small/inconsistent. |
| `readiness.rhr.contextual_individualized_monitoring` | moderate | conditional | Repeated RHR can contribute to training/recovery monitoring when interpreted against the athlete's own baseline and context. |
| `readiness.sleep.loss_impairs_performance` | moderate | conditional | Meaningful acute sleep loss is performance-relevant; sleep opportunity can matter. |
| `readiness.sleep.consumer_wearable_measurement_limits` | moderate | informational | Wearable sleep estimates/proprietary scores have measurement/validation limits. |
| `readiness.respiration.longitudinal_contextual_signal` | low | informational | Resting/nocturnal RR can contribute longitudinal anomaly context but is not a specific illness or standalone readiness marker. |

### Product-policy claims

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

## Registry structure

This pack adds `readinessCardiorespiratoryKnowledge.ts` for the RHR/respiration evidence and `sportsKnowledgeRegistry.ts` as the canonical aggregate surface. The aggregate registry validates all domain sources/claims together so modularizing knowledge does not weaken global duplicate-ID, external-identifier or lifecycle checks.

This structure is intentional: domain evidence can grow without making the original `sportsKnowledge.ts` a single ever-expanding file, while CI still sees one canonical registry.

## Coverage migration

The original readiness pack moved five P0 families from uncovered to covered:

1. `readiness.physiological_strain_model`
2. `readiness.absolute_device_floors`
3. `readiness.acute_biometric_floors`
4. `readiness.mode_score_thresholds`
5. `fatigue.internal_response_model`

The RHR/respiration extension does **not** increase that count. These families were already marked covered; instead, it makes the lineage complete and more direct by adding dedicated RHR and respiration scientific boundaries rather than allowing HRV/sleep evidence to stand in for them.

Current coverage remains:

| Metric | Before readiness pack | Current |
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
- multiple objective signals rather than any one biomarker alone;
- respiration contributes to the composite rather than having a standalone hard floor;
- subjective symptoms and known training load remain independent authority;
- missing historical fields contribute zero rather than fabricated adverse evidence;
- recommendation restriction is staged (`train` / `modify` / `recover`) rather than a binary biomarker veto.

The research does not identify a clearly superior replacement set of weights or thresholds that could responsibly be applied without athlete-specific validation. A behavior change here would therefore substitute one arbitrary calibration for another while pretending to be evidence-driven.

`POLICY_VERSION` is intentionally unchanged. Any future retuning should be a separate decision-policy PR with simulation, counterfactual analysis and athlete-outcome calibration.

## Tests added

- Scientific-vs-product epistemic-boundary tests.
- HRV isolated-dip behavior against personal variability.
- Small RHR elevation inside personal variability remains contextual.
- RHR +6 bpm and HRV -15 ms current hard-floor alignment.
- Respiration +2 br/min / 1 br/min MAD contributes 0.6 strain but does not independently force modify.
- Sleep-score 49/50 penalty boundary.
- Body Battery 20/21 recover boundary.
- Internal-response normalization/fusion coefficient alignment.
- Aggregate registry validation across core and cardiorespiratory modules.

These tests intentionally pin the **current product policy** so future threshold changes cannot silently leave stale claim text behind.

## Follow-up

Highest-value next evidence work is not more objective biomarker papers. It is:

1. subjective readiness / fatigue / soreness threshold authority;
2. high-safety injury and pain restriction mapping;
3. taper/event-preparation policy;
4. later, calibration of readiness action thresholds using recommendation audits and athlete-specific outcomes.
