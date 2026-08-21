# Physiological anomaly and possible-illness alerting — research review

* **Date:** 2026-08-21
* **Type:** point-in-time analysis
* **Scope:** consumer-wearable physiology, athlete context, pre-symptomatic respiratory infection signals, confounders, and implications for this repository
* **Decision authority:** this document records evidence and current-repository facts. ADR-0025 records the design decision; the implementation plan defines execution.

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

`EngineObjectiveInput.last_3_days_hard_sessions_count`, `yesterday_training`, `today_training`, per-activity telemetry and completed-session cost already let the system distinguish an athlete who unexpectedly deteriorated from an athlete who completed a hard session that plausibly explains next-morning autonomic suppression.

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

Mishra et al. (Nature Biomedical Engineering, 2020) analysed smartwatch data in COVID-19 cases and found detectable changes in resting heart rate/activity around illness, often before reported symptom onset. Their prototype real-time logic used sustained deviation from a personal baseline, not a population threshold. The paper also explicitly observed non-infectious excursions associated with travel, alcohol and stress.

Implication: personal baseline and persistence are scientifically reasonable; an elevated RHR episode is not infection-specific.

Reference: https://www.nature.com/articles/s41551-020-00640-6

### 2. Respiratory rate adds useful information but is not sufficiently sensitive alone

Natarajan et al. validated wearable-derived nocturnal respiratory rate and showed that respiratory rate can rise around COVID-19 infection. In the reported infection window, only a subset of infected users exceeded a large fixed increase, demonstrating both usefulness and limited sensitivity of respiration as a single signal.

Implication: respiration should be a core independent channel, not the sole detector. Its main value in this project is that a persistent rise may add information when RHR/HRV changes could otherwise be explained by training stress.

Reference: https://pubmed.ncbi.nlm.nih.gov/34526602/

### 3. Multi-parameter prospective cohorts show pre-symptomatic physiology changes

The COVI-GAPP prospective cohort measured respiratory rate, heart rate, HRV, wrist skin temperature and perfusion. Multiple parameters changed across incubation/presymptomatic/symptomatic periods.

Implication: multi-signal agreement is more defensible than a single-threshold rule. Device availability matters: this repository should use the channels actually available from Garmin rather than inventing missing temperature evidence.

Reference: https://pubmed.ncbi.nlm.nih.gov/35728900/

### 4. The most relevant prospective validation exposes the false-positive problem

Esmaeilpour et al. (JMIR Formative Research, 2024) prospectively evaluated an alert algorithm using sleeping-period RHR, respiratory rate and HRV in health-care workers.

Key observations:

* 470 participants completed the study;
* 665 positive alerts were generated;
* 512 alerts were followed by respiratory-virus testing;
* 63 of those tests confirmed respiratory infection;
* estimated false-positive rate per prediction-day was about 2%;
* PPV was only about 4-10% in that population/incidence setting;
* post-alert questionnaires identified intense exercise, poor sleep, stress and excessive alcohol as important alternative explanations.

Implication: a user-facing message such as "you are getting sick" would overstate the evidence. The app should instead separate **anomaly detection** from **cause attribution** and explicitly consume those confounders.

References:

* https://formative.jmir.org/2024/1/e53716/
* https://pubmed.ncbi.nlm.nih.gov/39018555/

### 5. Garmin data can support activity-matched personal anomaly detection

Gaur et al. (JMIR Formative Research, 2024) prospectively monitored 59 participants for eight months using Garmin Fenix 6 devices, daily health reports, and an automated anomaly pipeline. Their health-risk score compared heart-rate/HRV features against **individual activity-matched baselines**, not simply one unconditional reference distribution.

Implication: this repository has an unusually good opportunity because it already owns training-session context. A future personalised model can learn the expected next-day biometric response after easy, moderate and hard days, then score the residual rather than treating normal post-training suppression as unexplained illness evidence.

References:

* https://pmc.ncbi.nlm.nih.gov/articles/PMC11339560/
* https://pubmed.ncbi.nlm.nih.gov/39110968/

### 6. A large randomised prospective trial confirms the sensitivity/specificity trade-off

The COVID-RED trial (PLOS ONE, 2025; 17,825 randomised participants) compared wearable-plus-symptom indications with symptom-only indications. Wearable-assisted indications could occur earlier, but the experimental algorithm overestimated infections and had substantially worse specificity in the reported analyses.

Implication: "earlier" is achievable, but a high-sensitivity system can become unusably noisy. This project should optimise **alert usefulness and explanation quality**, not sensitivity alone.

References:

* https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0325116
* https://pubmed.ncbi.nlm.nih.gov/40471995/

### 7. HRV is highly confounded

A 2024 review of HRV interpretation lists physiological, disease, lifestyle and environmental influences including physical activity, alcohol and heat.

Implication: HRV is a valuable core channel, but it cannot be treated as a specific immune marker. The repository should follow ADR-0024 and evaluate HRV in an appropriate personal/log-domain baseline rather than assuming raw-domain median/MAD is universally correct.

Reference: https://pubmed.ncbi.nlm.nih.gov/39165281/

### 8. Alcohol produces exactly the direction of change that can look like illness/recovery strain

A large 2026 wearable cohort reported dose-dependent acute increases in nocturnal RHR and reductions in HRV after alcohol consumption.

Implication: alcohol is worth one low-friction check-in field because it can explain a common false-positive pattern. The implementation should not ask for alcohol when it is not useful to the decision; a compact `0 / 1 / 2 / 3+ drinks` input is sufficient for the first model.

Reference: https://pubmed.ncbi.nlm.nih.gov/41801993/

### 9. Athlete-specific evidence argues for context, not a universal biomarker

Sports literature shows that high training load is associated with upper-respiratory symptoms in some cohorts, while small athlete studies have found inconsistent predictive value from resting HRV/RHR alone. Athlete monitoring therefore benefits from combining training load, physiology and subjective state rather than declaring one biomarker predictive.

Examples:

* https://pubmed.ncbi.nlm.nih.gov/22151281/
* https://pubmed.ncbi.nlm.nih.gov/24282199/
* https://pubmed.ncbi.nlm.nih.gov/33262041/

---

## Evidence hierarchy for the app

The evaluator should distinguish **independent physiological channels** from **context/composites**.

### Core anomaly channels

These are the strongest first-pass independent channels available in the repository:

1. **RHR** — adverse direction: higher than personal baseline.
2. **Respiration rate** — adverse direction: higher than personal baseline.
3. **HRV** — adverse pattern usually lower than personal baseline, but ADR-0024 correctly warns that unusually high HRV can also be abnormal; use a two-sided personal-normality model internally and treat the common low-HRV direction as the illness/recovery feature.

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

---

## Why not produce an illness probability now?

A percentage such as "72% chance you are getting sick" would look precise but would not be calibrated for this athlete, device, infection prevalence or data-collection behavior.

PPV changes sharply with prevalence, and prospective wearable studies show that many alerts correspond to non-infectious stressors. Until the project has prospective labels, the UI should use calibrated-to-semantics categories such as:

* normal;
* explained strain;
* unusual physiology — watch;
* possible illness/systemic stress;
* symptoms reported.

The persisted assessment may carry an internal ordinal evidence score for replay, but the user should not see a pseudo-probability until calibration supports it.

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

Synthetic scenarios are useful for threshold behavior but cannot authorize user-facing `possible illness` wording on their own.

---

## Recommendation

Proceed with the capability, but frame it as **health anomaly detection with explicit alternative-explanation handling**.

The repository is already unusually well positioned for this because training load, sleep/stress, subjective state and personal baselines are available. Adding a compact check-in context for alcohol/travel/other disruptions should reduce avoidable false positives and, more importantly, make the alert explanation honest.

Do not enable the existing respiration strain weight as a shortcut. Build a separate, default-off evaluator, collect prospective outcomes, and only then promote an evidence-backed subset of states into visible alerts and tighten-only training decisions.
