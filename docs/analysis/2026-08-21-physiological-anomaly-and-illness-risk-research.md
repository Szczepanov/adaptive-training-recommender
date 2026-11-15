# Physiological anomaly and possible-illness alerting — research review

* **Date:** 2026-08-21 (updated 2026-11-15 for HA7 visible early-warning release decision)
* **Type:** point-in-time research analysis & evidence taxonomy
* **Scope:** consumer-wearable physiology, athlete context, pre-symptomatic respiratory infection signals, confounders, IOC clinical safety boundaries, and implications for this repository
* **Decision authority:** this document records evidence and current-repository facts. [ADR-0025](../adr/0025-physiological-anomaly-and-possible-illness-signals.md) records the design decision; [the HA7 visible early-warning release decision](./2026-11-15-ha7-visible-early-warning-release-decision.md) records the two-tier release gate; [the HA implementation plan](../plans/health-anomaly-and-illness-risk-alerting.md) defines execution.

---

## Executive conclusion

Yes: the scientific literature supports the claim that consumer wearables can sometimes detect a **physiological anomaly associated with an incoming respiratory infection before the user reports symptoms**.

No: the literature does **not** support treating RHR, HRV, respiration, sleep, or a composite wearable score as a disease-specific diagnostic. Prospective studies show the central problem clearly: infection sensitivity can be useful, but specificity and positive predictive value can be poor because hard exercise, poor sleep, psychological stress, alcohol, travel and other disruptions produce overlapping autonomic changes.

That distinction is exactly where this project can improve on a naive wearable alert:

1. the repository already knows whether recent sessions were hard;
2. it already has objective sleep, stress/recovery and personal-baseline data;
3. the daily check-in already captures subjective sleep, fatigue, soreness, mental stress and explicit illness symptoms;
4. travel can already be represented in authored planning context;
5. a small optional check-in context block can add alcohol, jet lag/travel disruption, heat/sauna, dehydration, vaccination/medication change and sick-contact information;
6. therefore the app can ask a better question than "are biometrics abnormal?": **"are biometrics abnormal beyond what the known recovery stressors plausibly explain?"**

The recommended production concept is therefore a **physiological anomaly + explanation model**, with an evidence-gated `possible_illness` interpretation. It is not an illness diagnosis model.

---

## What the repository already has

### Objective signals

`app/src/engine/models.ts` / `EngineObjectiveInput` already exposes:

* resting heart rate and personal-baseline deltas;
* overnight HRV and personal-baseline deltas;
* respiration rate;
* sleep score and sleep duration;
* Body Battery at wake;
* recent hard-session count;
* yesterday/today training summaries;
* step baselines and deltas;
* personal variability estimates for several metrics.

ADR-0006 and ADR-0024 further document observation-only median/MAD baselines for respiration and other metrics. Respiration has a real comparison path in `rules.ts`, but `mapSnapshotToEngineInput` deliberately defaults `RespirationStrainPolicy` to `off`, so respiration does not currently alter production recommendations.

That default-off decision remains correct for the **training strain score**. This research does not justify silently enabling that weight. Instead it motivates a separate, explainable anomaly evaluator whose output can be calibrated independently.

### Known training stress

`EngineObjectiveInput.last_3_days_hard_sessions_count`, `yesterday_training`, `today_training`, per-activity telemetry and completed-session cost already provide context for a separate evaluator to distinguish unexpected deterioration from the expected response to a hard session. The current engine does not itself make that comparison: `evaluateReadinessAndSafetyEnvelope` applies recent hard-session context as a strain penalty, but it does not compare the observed response with an activity-matched expected response or produce a causal explanation — that attribution is the capability this document and ADR-0025 propose.

This is important because intense exercise is a documented source of false-positive infection alerts.

### Subjective data

`DailySubjectiveCheckin` already stores:

* readiness;
* sleep quality;
* fatigue;
* soreness;
* mental stress;
* motivation;
* pain/injury flag;
* `illnessSymptoms`;
* availability and free-text notes.

Today, `mapCheckinToSubjectiveInput` effectively folds `illnessSymptoms` into the same `painFlag` used to force conservative behavior. That is safe but semantically coarse: it handles **known symptoms**, not **possible pre-symptomatic illness**.

### Travel context

`AuthoredPlanBlock` already has a canonical `travel` phase. The anomaly evaluator should consume known travel automatically. The check-in should only ask for travel/jet-lag context when the structured plan does not fully explain the disruption (for example an unplanned flight, late arrival, or unexpected time-zone shift).

---

## Evidence review

### 1. Pre-symptomatic changes are real, but early retrospective results were optimistic

Mishra et al. (*Nature Biomedical Engineering*, 2020) evaluated wearable smartwatch telemetry from a cohort of **5,262** participants, focusing on **32** confirmed COVID-19 positive cases using two algorithms: **RHR-Diff** (retrospective resting heart rate differential intervals) and **HROS-AD** (online Heart Rate Over Steps Anomaly Detection). Key quantitative metrics:

* **81% (26/32)** of analyzed COVID-19 cases exhibited measurable deviations in resting heart rate, daily steps, or sleep metrics;
* detection occurred at a median lead time of **~4 days before symptom onset** (extending up to 9+ days prior in several cases);
* explicit non-infectious excursions were documented in association with travel, alcohol intake, and acute stress.

Critical appraisal: personal longitudinal baselines and sustained persistence are biologically justified, but retrospective analysis on a small positive case subset (`n = 32`) inflates apparent reliability and cannot establish prospective false-positive burden or positive predictive value (PPV) in free-living athletes.

Reference: https://www.nature.com/articles/s41551-020-00640-6

### 2. Real-time streaming alerting proves pre-symptomatic lead time alongside frequent non-infectious triggers

Alavi et al. (*Nature Medicine*, 2021 online / January 2022 print) deployed **NightSignal**, a deterministic streaming finite-state machine comparing overnight resting heart rate and daily step counts against personal baselines, in a large prospective smartwatch cohort (**3,318** primary analyzed participants across Snyder lab monitoring phases). Key quantitative metrics:

* **80% sensitivity (67/84)** across confirmed SARS-CoV-2 infections (both pre-symptomatic and asymptomatic);
* median **3-day** early-warning lead time prior to symptom onset;
* participant survey annotations frequently attributed non-COVID red alerts to non-infectious stressors including **intense exercise, alcohol consumption, travel, emotional/work stress, poor sleep, and winter holiday schedule shifts** — though non-infectious triggers produced shorter alert streaks (mean **1.15** alert days/person vs. **3.42** in confirmed COVID-19).

Critical appraisal: overnight RHR anchoring + multi-night persistence state machines reduce daytime exercise artifacts, yet single-channel heart-rate excursions are still frequently driven by benign training/lifestyle perturbations.

Reference: https://pubmed.ncbi.nlm.nih.gov/34845388/

### 3. Controlled human viral challenge confirms biological latency across non-COVID respiratory pathogens

Grzesiak et al. (*JAMA Network Open*, 2021; `4(9):e2128534`) ran a controlled viral-challenge study monitoring wearable biometric sensors in participants experimentally inoculated with **H1N1 influenza (`n = 31`)** or **human rhinovirus (`n = 18`)** alongside non-infected controls. Key quantitative metrics:

* models detected acute physiological changes within **12–36 hours post-inoculation**, prior to clinical symptom onset (median rhinovirus onset ~36 hours post-inoculation; predictions evaluated 12–24 hours pre-symptomatically);
* infection classification reached **78% accuracy** at 12 hours post-inoculation and **88% accuracy** at symptom onset for rhinovirus (and up to **92% accuracy** for H1N1);
* severity-trajectory models separated mild vs. moderate illness pre-symptomatically with **~73–90%** accuracy depending on pathogen and window.

Critical appraisal: controlled challenge (`T0` known) proves autonomic/cardiorespiratory responses precede symptoms even for common cold and influenza rather than being SARS-CoV-2-specific; however, small inpatient challenge cohorts (`n = 31`, `n = 18`) omit training load and real-world prevalence, so clinical specificity/PPV remain uncalibrated.

References:

* https://pubmed.ncbi.nlm.nih.gov/34586364/
* https://pmc.ncbi.nlm.nih.gov/articles/PMC8482470/

### 4. Respiratory rate adds useful information but is not sufficiently sensitive alone

Natarajan et al. validated wearable-derived nocturnal respiratory rate and showed that respiratory rate can rise around COVID-19 infection. In the reported infection window, only a subset of infected users exceeded a large fixed increase, demonstrating both usefulness and limited sensitivity of respiration as a single signal.

Implication: respiration should be a core independent channel, not the sole detector. Its main value in this project is that a persistent rise may add information when RHR/HRV changes could otherwise be explained by training stress.

Reference: https://pubmed.ncbi.nlm.nih.gov/34526602/

### 5. Multi-parameter prospective cohorts show pre-symptomatic physiology changes

The COVI-GAPP prospective cohort measured respiratory rate, heart rate, HRV, wrist skin temperature and perfusion. Multiple parameters changed across incubation/presymptomatic/symptomatic periods.

Implication: multi-signal agreement is more defensible than a single-threshold rule. Device availability matters: this repository should use the channels actually available from Garmin rather than inventing missing temperature evidence.

Reference: https://pubmed.ncbi.nlm.nih.gov/35728900/

### 6. The most relevant prospective validation exposes the false-positive and PPV problem

Esmaeilpour et al. (*JMIR Formative Research*, 2024; `8:e53716`) prospectively validated a pre-symptomatic ARI alert model using sleeping-period RHR, respiratory rate, and HRV in healthcare workers (**559** enrolled; **470** completed baseline follow-up and received predictions). Key quantitative observations:

* **665** positive alerts were generated; **512** alerts were followed by respiratory-virus testing, confirming **63** respiratory infections;
* early-warning alerts occurred an average of **~2.3 days** before test/symptom confirmation (up to 6–8 days prior);
* estimated false-positive prediction rate was ~2% per day, yielding a **PPV of only 4–10%** in that workplace incidence setting;
* post-alert questionnaires identified **intense exercise, poor sleep, emotional stress, and excessive alcohol** as key alternative explanations.

Critical appraisal: because systematic viral testing occurred primarily after positive alerts or reported symptoms (verification bias), unbiased sensitivity and specificity across un-alerted days could not be isolated cleanly. The low PPV proves that telling an athlete "you are getting sick" overstates the evidence; the product must separate **anomaly detection** from **cause attribution** and explicitly consume known confounders.

References:

* https://formative.jmir.org/2024/1/e53716/
* https://pubmed.ncbi.nlm.nih.gov/39018555/

### 7. Garmin data supports activity-matched personal anomaly detection

Gaur et al. (*JMIR Formative Research*, 2024; `8:e53977`) prospectively monitored **59 participants** over **8 months** using **Garmin Fenix 6/6s** devices streaming continuous PPG interbeat intervals and step counts paired with daily health logs. Their health-risk pipeline evaluated heart-rate/HRV features against **individual activity-matched baselines** rather than a single unconditional personal mean.

Critical appraisal: directly validates Garmin wearable signal capture plus activity-strata conditioning as a practical mechanism for suppressing post-exertion false positives. Because single-athlete training cohorts still have sparse days in extreme strata, this repository uses **empirical-Bayes shrinkage** (`HEALTH_ANOMALY_ACTIVITY_SHRINKAGE_PRIOR_DAYS` toward the clean 28-day baseline) rather than unregularized bin-only means.

References:

* https://pmc.ncbi.nlm.nih.gov/articles/PMC11339560/
* https://pubmed.ncbi.nlm.nih.gov/39110968/

### 8. A large randomised prospective trial confirms the sensitivity/specificity trade-off and null severity outcome

The COVID-RED randomized single-blinded crossover trial (Zwiers, Brakenhoff et al., *PLOS ONE*, 2025; `20(6):e0325116`; **17,825** randomized subjects) compared wearable-assisted (Ava bracelet RHR, respiratory rate, skin temperature, HRV) + symptom algorithms against a symptom-diary control algorithm. Key quantitative findings:

* the experimental wearable algorithm achieved very high period sensitivity (**93.8–99.2%**; day-level **45–52%**) and shifted alerts earlier (median **0 vs. 7 days** prior to positive PCR test), compared with symptom-diary sensitivity (**43.3–46.4%** period; **28–33%** day-level);
* however, experimental period specificity dropped to **0.8–4.2%** (day-level **38–50%**) vs. **65.0–66.4%** period specificity (**93–97%** day-level) for symptom diaries alone, creating a heavy false-positive alert burden without demonstrating reduced clinical disease severity from wearable alerting alone.

Critical appraisal: "earlier" detection is achievable at population scale, but maximizing sensitivity at the expense of specificity generates unacceptable alert fatigue and does not itself prevent severe clinical courses without an actionable response protocol.

References:

* https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0325116
* https://pubmed.ncbi.nlm.nih.gov/40471995/

### 9. Sports medicine consensus rejects the "neck check" and defines red-flag & return-to-sport boundaries

The International Olympic Committee (IOC) consensus statement on acute respiratory illness in athletes (Schwellnus et al., *Br J Sports Med*, 2022 — **Part 1:** acute respiratory infections, `56(19):1066–1088`; **Part 2:** non-infective acute respiratory illness, `56(11):630–640`) synthesizes clinical safety governance for athletes:

* **Rejection of the anatomical "neck check":** the legacy rule allowing training with localized "above-the-neck" symptoms lacks robust clinical evidence; viral infections with mild upper-respiratory signs can still involve systemic viremia and myocardial risk;
* **Systemic red flags:** fever, generalized myalgia, chest pain, disproportionate dyspnea/breathlessness, unexplained resting tachycardia/palpitations, and syncope/dizziness are contraindications to strenuous exercise and warrant training cessation plus medical evaluation;
* **Myocarditis vigilance:** while clinically overt post-viral myocarditis/pericarditis prevalence in updated athletic registries is relatively rare (`<3%`), continuing intense exercise during active systemic infection remains the primary preventable hazard;
* **Staged return-to-sport (RTS):** recovery should follow a symptom-led progressive sequence (symptom-free rest/baseline check -> light aerobic test -> progressive sport-specific re-introduction), pausing if systemic symptoms or disproportionate strain recur.

References:

* https://doi.org/10.1136/bjsports-2022-105759 (Part 1)
* https://doi.org/10.1136/bjsports-2022-105567 (Part 2)

### 10. HRV is highly confounded

A 2024 review of HRV interpretation lists physiological, disease, lifestyle and environmental influences including physical activity, alcohol and heat.

Implication: HRV is a valuable core channel, but it cannot be treated as a specific immune marker. The repository should follow ADR-0024 and evaluate HRV in an appropriate personal/log-domain baseline rather than assuming raw-domain median/MAD is universally correct.

Reference: https://pubmed.ncbi.nlm.nih.gov/39165281/

### 11. Alcohol produces exactly the direction of change that can look like illness/recovery strain

A large 2026 wearable cohort reported dose-dependent acute increases in nocturnal RHR and reductions in HRV after alcohol consumption.

Implication: alcohol is worth one low-friction check-in field because it can explain a common false-positive pattern. The implementation should not ask for alcohol when it is not useful to the decision; a compact `0 / 1 / 2 / 3+ drinks` input is sufficient for the first model.

Reference: https://pubmed.ncbi.nlm.nih.gov/41801993/

### 12. Athlete-specific evidence argues for context, not a universal biomarker

Sports literature shows that high training load is associated with upper-respiratory symptoms in some cohorts, while small athlete studies have found inconsistent predictive value from resting HRV/RHR alone. Athlete monitoring therefore benefits from combining training load, physiology and subjective state rather than declaring one biomarker predictive.

Examples:

* https://pubmed.ncbi.nlm.nih.gov/22151281/
* https://pubmed.ncbi.nlm.nih.gov/24282199/
* https://pubmed.ncbi.nlm.nih.gov/33262041/

---

## Evidence hierarchy for the app

The evaluator should distinguish **distinct candidate physiological channels** from
**context/composites**.

### Core anomaly channels

These are the strongest first-pass distinct candidate channels available in the repository.
"Distinct" is a claim about the physiological concept each channel targets, not a proven
statistical independence claim: some wearable methods estimate respiration rate from
heartbeat-interval variability via respiratory sinus arrhythmia, so RHR/HRV and
device-estimated respiration can be correlated rather than independent, depending on how the
device derives respiration. Do not label them "independent channels" until that is checked for
the device data actually used.

1. **RHR** — adverse direction: higher than personal baseline.
2. **Respiration rate** — adverse direction: higher than personal baseline.
3. **HRV** — adverse pattern usually lower than personal baseline, but ADR-0024 correctly warns that unusually high HRV can also be abnormal; use a two-sided personal-normality model internally and treat the common low-HRV direction as the illness/recovery feature.

Before using channel agreement as evidence for `possible_illness_or_systemic_stress`, the
evaluator requires:

* **device-specific signal validation** — confirm how the connected device derives respiration
  rate (direct sensor vs. HRV-derived) so the evaluator knows whether RHR/HRV and respiration
  can share a common source signal;
* **within-person correlation checks** — measure this athlete's own historical RHR/HRV/
  respiration correlation during replay rather than assuming population-level independence;
* **a cap or adjustment for correlated evidence** — when two channels are found to be
  correlated for a given device/athlete, their joint agreement contributes less than two fully
  independent channels' worth of evidence toward `minimumCoreSignalsForMultiSignal`
  (ADR-0025 §2).

The system should require adequate baseline coverage and data quality before scoring any channel.

### Supporting physiological/behavioral evidence

These help interpret the core anomaly but should not all receive independent additive weights:

* sleep duration and Sleep Score;
* subjective sleep quality;
* Body Battery;
* Garmin stress;
* Garmin Training Readiness;
* steps/activity suppression;
* fatigue/readiness/motivation.

Garmin Stress, Body Battery, HRV Status, Sleep Score and Training Readiness share upstream information. Summing them as independent evidence would create false confidence through double-counting.

### Known alternative explanations

The first production context set should be:

* recent hard/very-hard training — **automatic**, not asked;
* poor/short sleep — **automatic + existing subjective input**;
* elevated psychological stress — **automatic + existing subjective input**;
* alcohol in the previous 24 h — quick check-in input;
* travel / jet lag / unusually late arrival — structured plan first, check-in fallback;
* unusual heat/sauna exposure — quick optional input;
* dehydration / GI fluid loss — quick optional input;
* recent vaccination or medication change — optional input;
* known close sick contact / household illness — optional input that changes prior plausibility, not physiology;
* other unusual disruption — optional free-text/detail fallback.

The model should store these as **explanations**, not simply subtract arbitrary points from an illness score.

---

## Proposed causal/explanation logic

A useful v1 should be rule-based and traceable before any ML model is introduced.

### Example A — likely explained recovery strain

* RHR elevated;
* HRV suppressed;
* respiration normal;
* very hard session yesterday;
* sleep somewhat shortened;
* no illness symptoms.

Interpretation: physiological strain is real, but hard training/sleep provide a strong explanation. User-facing state can be `explained_recovery_strain`; the normal readiness engine remains responsible for training modification.

### Example B — unexplained anomaly worth watching

* RHR elevated;
* HRV suppressed;
* respiration elevated;
* no hard training in the relevant window;
* normal sleep duration;
* no alcohol/travel/high-stress explanation;
* no symptoms yet.

Interpretation: `watch_unexplained`. The UI should say the physiology is unusually stressed and no obvious explanation is present. Do not say the user is infected.

### Example C — possible early illness/systemic stress

* same multi-signal pattern persists or strengthens for a second night;
* particularly if respiration remains elevated;
* recovery/easy day did not normalize the pattern;
* no strong alternative explanation;
* optionally a sick contact or subtle subjective fatigue appears.

Interpretation: evidence-gated `possible_illness_or_systemic_stress`. This is the earliest state that should eventually be allowed to suppress a planned hard session, and only after prospective validation.

### Example D — symptoms reported

* user reports illness symptoms regardless of wearable anomaly.

Interpretation: explicit symptomatic safety state. Existing conservative behavior remains authoritative. Wearable data may explain the alert but must not override the symptom report in the permissive direction.

### Example E — insufficient wearable evidence

* all core channels (`rhr`, `respiration`, `hrv`) are `unavailable` (cold-start `< 7` nights, sensor gap, or stale baseline);
* no illness symptoms are reported.

Interpretation: `insufficient_evidence`. Do not mask unmeasured or cold-start nights as `normal`; report explicit missingness cleanly while baseline history accumulates.

---

## Why not produce an illness probability now?

A percentage such as "72% chance you are getting sick" would look precise but would not be calibrated for this athlete, device, infection prevalence or data-collection behavior.

PPV changes sharply with prevalence, and prospective wearable studies show that many alerts correspond to non-infectious stressors. Until personal longitudinal outcome calibration matures, the UI should use explicit state categories:

* insufficient evidence (no core wearable channels measured and no symptoms reported — never masked as `normal`);
* normal;
* explained strain;
* unusual physiology — watch;
* possible illness/systemic stress;
* symptoms reported.

The persisted assessment records `anomalySeverity`, `evidenceQuality`, `calibrationStage`, and `earlyResponse` alongside the causal state, without surfacing an uncalibrated probability percentage.

---

## Three-tier evidence matrix for system rules

To keep engineering honest about which components rest on direct clinical/cohort validation versus statistical engineering or product judgment, every implemented rule in `healthAnomaly.ts`, `healthAnomalyFeatures.ts`, `healthAnomalyOutcome.ts`, and `illnessAnomalyFlag.ts` maps to one of three evidence tiers:

### Tier 1 — Directly supported by peer-reviewed evidence

| Rule / Mechanism | Primary Implementation | Evidentiary Grounding |
|---|---|---|
| Personal 28-day baselines replacing population cutoffs | `extractSignalObservations` (`mean-stdev-28d`, `log-mean-stdev-28d`, `median-mad-28d`) | Mishra et al. (2020), Alavi et al. (2021/2022), Natarajan et al. (2021), COVI-GAPP (2022), ADR-0024 |
| Overnight RHR elevation as core adverse feature | `extractSignalObservations` (`rhr`), `evaluatePhysiologicalAnomaly` | Mishra et al. (2020), Alavi et al. (`NightSignal`, 2021/2022), Esmaeilpour et al. (2024) |
| Log-domain overnight HRV suppression as core adverse feature | `extractSignalObservations` (`hrv`, `log-mean-stdev-28d`), `evaluatePhysiologicalAnomaly` | COVI-GAPP (2022), Esmaeilpour et al. (2024), Gaur et al. (2024), 2024 HRV confounding review, ADR-0024 |
| Nocturnal respiration rate elevation as core channel | `extractSignalObservations` (`respiration`, `median-mad-28d`), `evaluateRespirationElevation` | Natarajan et al. (2021), COVI-GAPP (2022), Esmaeilpour et al. (2024) |
| Structured non-infectious confounder attribution (hard load, short sleep, stress, alcohol within 24h, travel/jet lag, heat, dehydration, vaccination/meds) | `evaluatePhysiologicalAnomaly` (`explanations`, `ContextExplanation`) | Mishra et al. (2020), Alavi et al. (2021/2022), Esmaeilpour et al. (2024), 2026 alcohol wearable cohort |
| Conditioning heart-rate/HRV residuals on training-activity strata | `computeActivityMatchedExpectations` (`ActivityStratum`: `post_hard_or_high_cost` vs. `post_easy_or_rest`) | Gaur et al. (2024; Garmin Fenix 6 activity-matched baselines) |
| Non-diagnostic wording separating physiological anomaly from clinical infection diagnosis | `EarlyResponseProtocol.nonDiagnosticNotice`, `HealthAnomalyCard` copy | Esmaeilpour et al. (2024; 4–10% PPV), COVID-RED (2025; low wearable specificity) |
| Explicit symptomatic override, rejection of anatomical "neck check", IOC red-flag warnings, and staged return-to-sport (RTS) guidance | `symptoms_reported` state, `buildEarlyResponseProtocol` (`level_3_symptoms_reported`, `redFlagWarnings`, `returnToSportGuidance`) | Schwellnus et al. (2022; IOC Consensus Parts 1 & 2) |

### Tier 2 — Informed physiological / statistical extrapolation

| Rule / Mechanism | Primary Implementation | Rationale & Bounded Assumption |
|---|---|---|
| Separating `correlated_autonomic_only` (RHR + HRV without respiration) from `multi_domain_corroborated` (respiration + RHR/HRV) | `evaluatePhysiologicalAnomaly` (`evidenceQuality`: `HealthAnomalyEvidenceQuality`) | Prevents double-counting shared cardiac vagal/sympathetic variance or RSA coupling across HRV and RHR alone |
| Explicit missingness state (`insufficient_evidence`) when `availableCoreSignals === 0` and asymptomatic | `evaluatePhysiologicalAnomaly`, `evaluateIllnessAnomalyFlag` | Avoids conflating unmeasured days with `normal`; prevents false reassurance |
| Contamination-protected clean 28-day baseline recomputation (excluding strictly prior `< currentDate` symptomatic days down to `>= 7` clean observations) | `extractSignalObservations` (`contaminatedDates`, `baselineMaturity`; wired in `runHealthAnomalyReplay`) | Prevents sustained symptomatic autonomic spikes from inflating baseline center/scale and masking ongoing illness |
| Empirical-Bayes shrinkage of activity-matched expectations (`HEALTH_ANOMALY_ACTIVITY_SHRINKAGE_PRIOR_DAYS = 5`) toward overall clean 28d baseline | `computeActivityMatchedExpectations` | Regularizes `post_hard_or_high_cost` / `post_easy_or_rest` means when an athlete has few observations in one stratum |
| Downgrading lagging 28-day respiration elevations when 7-day respiration trend has already reversed (`status === 'resolving'`) | `VISIBLE_V1_HEALTH_ANOMALY_THRESHOLDS` (`downgradeResolvingRespiration: true`) + `evaluateRespirationElevation` | Prevents stale high values inside the 28d median window from falsely extending an anomaly tail during recovery |
| Time-decaying reactogenicity window for vaccination / medication confounders (`strong` -> `moderate` at `priorAdverseDays >= 2`) | `evaluatePhysiologicalAnomaly` confounder handling | Acute post-vaccine/med autonomic responses peak over 24–48h; persistent Day 3+ anomalies should re-surface for attention |
| Dual persistence counters (`persistenceDays` vs. `unexplainedPersistenceDays`) across `HealthAnomalyService` and `runHealthAnomalyReplay` | `PhysiologicalAnomalyAssessment`, `HealthAnomalyService`, `runHealthAnomalyReplay` | Ensures an `explained_recovery_strain` -> unexplained transition neither erases prior physiological strain nor skips unexplained streak counting |

### Tier 3 — Exploratory product heuristics requiring ongoing replay monitoring

| Rule / Mechanism | Primary Implementation | Open Calibration Question (Monitor via Replay / HA9) |
|---|---|---|
| Exact deviation thresholds (`moderateDeviation: 1.5`, `strongDeviation: 2.5`) and `emerging_baseline` (`7–13` nights) `+0.5z` penalty (`2.0z` / `3.0z`, capped at `watch_unexplained`) | `VISIBLE_V1_HEALTH_ANOMALY_THRESHOLDS` (`emergingHistoryCount: 7`, `minimumHistoryCount: 14`) | Measure false-alert rate per 30 days across `emerging` vs. `reliable` baseline cohorts |
| First-night multi-domain corroborated escalation (`possible_illness_or_systemic_stress` on Night 1 if strong multi-domain or moderate multi-domain + sick contact) and 3-level `EarlyResponseProtocol` tiers | `VISIBLE_V1_HEALTH_ANOMALY_THRESHOLDS` (`allowFirstNightMultiDomainEscalation: true`), `buildEarlyResponseProtocol` | Track Day-1 escalated false-positive rate vs. lead-time gain against 2-night gating in `runHealthAnomalyReplay` |
| `closeSickContact` lowering the unexplained multi-domain escalation threshold by one step | `evaluatePhysiologicalAnomaly` (`closeSickContact` plausibility modifier) | Evaluate incremental PPV/recall when recent exposure is logged |
| Personal outcome calibration readiness bar (`priorEpisodesCount >= 3 && resolvedCount >= 3` strictly `< asOfDate`) | `summarizePersonalOutcomeCalibration` (`calibrationEligible`) | Verify stability of personal false-positive / progression rates before using personal summaries to tune cutoffs |
| Automatic training-plan restriction (`tighten-v1` policy) | `resolveConfiguredHealthAnomalyRuntimePolicy` (clamps `'tighten-v1'` -> `'visible-v1'` until HA9 validation) | Deferred until HA9 prospective labelled outcome validation (`>= 90` days, `>= 3` resolved labelled episodes, measured healthy-day flip burden) |

---

## Personal learning opportunity

This repository can become substantially more useful than a static literature-derived rule because it is single-athlete longitudinal software.

For every anomaly episode, collect the eventual outcome:

* symptoms developed within 24 h / 48 h / 72 h;
* no illness developed;
* hard training explained it;
* alcohol explained it;
* travel/jet lag explained it;
* poor sleep/stress/heat/dehydration explained it;
* unknown.

Over time, this enables two improvements:

1. **context-matched expected response** — learn how this athlete's RHR/HRV/respiration normally respond to hard sessions, short sleep and alcohol;
2. **personal alert calibration** — estimate which multi-signal patterns have historically preceded illness for this athlete.

The first implementation should stay deterministic and versioned; personalised statistical/ML calibration becomes justified only after sufficient labelled episodes exist.

---

## Required validation before production illness wording

A shadow/replay report should measure at least:

* data coverage per core channel;
* number of core-signal anomalies per 30 observed days;
* isolated RHR / isolated HRV / isolated respiration alert rate;
* multi-signal agreement rate;
* alert persistence distribution;
* alert frequency after hard training, alcohol, poor sleep, travel and high stress;
* fraction of anomaly episodes fully/partly explained by known context;
* fraction followed by reported illness symptoms within 24/48/72 h;
* lead time to symptom onset;
* false-positive burden on healthy days;
* how often a proposed alert would have suppressed a hard session;
* whether the alert adds information beyond the existing readiness recommendation;
* per-policy confusion matrices once enough labelled episodes exist.

Outcome labels must match what the validation claim actually needs. A missing reported symptom
does not establish that a day was healthy — the JMIR Formative Research prospective study cited
above only tested users after a positive alert, treated un-acted alerts as negative by default,
and still reported a PPV of only 4-10% in that population. Reusing "no reported symptom = healthy
day" the same way would inherit that bias. The report must therefore:

* use **separate outcome labels** rather than one healthy/sick axis: lab-confirmed infection,
  other respiratory illness, self-reported symptoms without confirmation, explicit confounder
  (hard training/alcohol/travel/sleep/stress/heat/dehydration), and unknown/no follow-up;
* give **alert and non-alert periods the same observation and testing opportunity** — do not
  compare a heavily-followed-up alert period against a passively-observed non-alert period;
* **freeze baselines and policy inputs at assessment time** during replay, so a later baseline
  recompute cannot retroactively change what an earlier date's assessment would have shown;
* **not authorize `possible_illness_or_systemic_stress`** from symptom-follow-up metrics alone —
  require it alongside the data-quality and multi-signal-persistence evidence from ADR-0025 §2.

Synthetic scenarios are useful for threshold behavior but cannot authorize user-facing `possible illness` wording on their own.

---

## Recommendation

Proceed with **non-diagnostic physiological anomaly early warnings (`visible-v1`) paired with explicit alternative-explanation handling, a structured 3-level early-response protocol, and prospective outcome collection**, while keeping automatic training-plan restriction (`tighten-v1`) inactive pending HA9 outcome validation.

The repository is already unusually well positioned for this because training load, sleep/stress, subjective state, personal 28-day baselines, and activity-matched expectations are available. Do not require prior labelled illness episodes (`>= 5`) before surfacing non-diagnostic early warnings to a healthy athlete: Stage A baseline readiness (`7–13` emerging nights with conservative thresholds -> `14–28` reliable baseline nights) safely unlocks visible warnings (`HealthAnomalyCard`, `illness_anomaly` advisory D-FLAG) alongside honest `insufficient_evidence` missingness states, IOC clinical red-flag guidance, and 24–72h outcome capture.

See [the HA7 visible early-warning release decision](./2026-11-15-ha7-visible-early-warning-release-decision.md) for the full release audit and redesigned two-tier gate.
