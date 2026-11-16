# Physiological anomaly literature synthesis and three-tier evidence matrix (HA7)

* **Date:** 2026-11-15
* **Type:** point-in-time scientific synthesis and rule-evidence matrix
* **Scope:** updated quantitative literature synthesis, IOC clinical safety governance, and three-tier evidentiary classification for the `visible-v1` early-warning implementation
* **Decision authority:** supports [ADR-0054](../adr/0054-ha7-visible-early-warning-release-gate.md) and [the 2026-11-15 HA7 release decision](./2026-11-15-ha7-visible-early-warning-release-decision.md), building on the original [2026-08-21 physiological anomaly research review](./2026-08-21-physiological-anomaly-and-illness-risk-research.md) without altering that historical document.

---

## Updated quantitative literature review

### 1. Pre-symptomatic retrospective signal discovery (Mishra et al., 2020)

Mishra et al. (*Nature Biomedical Engineering*, 2020) evaluated wearable smartwatch telemetry from **5,262** participants, focusing on **32** confirmed COVID-19 positive cases using **RHR-Diff** and online **HROS-AD** (Heart Rate Over Steps Anomaly Detection):

* **81% (26/32)** of analyzed COVID-19 cases exhibited measurable deviations in resting heart rate, daily steps, or sleep metrics;
* median detection lead time was **~4 days before symptom onset** (extending up to 9+ days prior);
* explicit non-infectious excursions were documented in association with travel, alcohol intake, and acute stress.

Critical appraisal: personal longitudinal baselines and persistence are biologically sound, yet retrospective evaluation on a small positive subset (`n = 32`) inflates apparent reliability and cannot establish prospective false-positive burden or PPV in free-living athletes.

* Reference: https://www.nature.com/articles/s41551-020-00640-6

### 2. Real-time streaming alerting & non-infectious trigger burden (Alavi et al., 2021/2022)

Alavi et al. (*Nature Medicine*, 2021 online / January 2022 print) deployed **NightSignal**, a deterministic streaming finite-state machine comparing overnight resting heart rate and daily step counts against personal baselines across **3,318** primary analyzed participants:

* **80% sensitivity (67/84)** across confirmed SARS-CoV-2 infections (pre-symptomatic and asymptomatic);
* median **3-day** early-warning lead time prior to symptom onset;
* participant survey annotations frequently attributed non-COVID alerts to **intense exercise, alcohol, travel, work/emotional stress, poor sleep, and holiday schedule shifts** — though non-infectious triggers produced shorter streaks (mean **1.15** alert days/person vs. **3.42** in confirmed COVID-19).

Critical appraisal: overnight RHR anchoring and multi-night persistence state machines curb daytime noise, yet single-channel heart-rate excursions remain frequently driven by benign training and lifestyle perturbations.

* Reference: https://pubmed.ncbi.nlm.nih.gov/34845388/

### 3. Controlled human viral challenge across non-COVID pathogens (Grzesiak et al., 2021)

Grzesiak et al. (*JAMA Network Open*, 2021; `4(9):e2128534`) monitored wearable biometrics in participants experimentally inoculated with **H1N1 influenza (`n = 31`)** or **human rhinovirus (`n = 18`)**:

* acute physiological shifts appeared within **12–36 hours post-inoculation**, preceding clinical symptom onset (median rhinovirus onset ~36h; pre-symptomatic predictions evaluated 12–24h prior);
* infection classification reached **78% accuracy** at 12 hours post-inoculation and **88% accuracy** at symptom onset for rhinovirus (up to **92% accuracy** for H1N1);
* severity-trajectory models separated mild vs. moderate illness pre-symptomatically with **~73–90%** accuracy.

Critical appraisal: controlled challenge (`T0` known) proves autonomic/cardiorespiratory responses precede symptoms across common cold and influenza rather than COVID-19 alone; small inpatient cohorts omit training load and free-living prevalence.

* References: https://pubmed.ncbi.nlm.nih.gov/34586364/, https://pmc.ncbi.nlm.nih.gov/articles/PMC8482470/

### 4. Nocturnal respiratory rate & multi-parameter cohorts (Natarajan et al., 2021; COVI-GAPP, 2022)

Natarajan et al. (2021) confirmed wearable nocturnal respiratory rate rises around COVID-19 infection while showing limited sensitivity as a standalone single signal, while COVI-GAPP (2022) demonstrated concurrent multi-parameter excursions across respiratory rate, heart rate, HRV, wrist skin temperature, and perfusion across incubation and pre-symptomatic windows.

* References: https://pubmed.ncbi.nlm.nih.gov/34526602/, https://pubmed.ncbi.nlm.nih.gov/35728900/

### 5. Prospective false-positive burden & low workplace PPV (Esmaeilpour et al., 2024)

Esmaeilpour et al. (*JMIR Formative Research*, 2024; `8:e53716`) prospectively evaluated sleeping-period RHR, respiratory rate, and HRV alerts in healthcare workers (**559** enrolled; **470** completed baseline follow-up):

* **665** positive alerts -> **512** tested -> **63** confirmed respiratory infections;
* alerts preceded symptom/test confirmation by an average of **~2.3 days**;
* estimated false-positive prediction rate was ~2% per day, yielding a **PPV of only 4–10%**;
* post-alert questionnaires identified **intense exercise, poor sleep, emotional stress, and alcohol** as common confounders.

Critical appraisal: verification bias (testing primarily post-alert or post-symptom) prevents exact unbiased sensitivity estimation, while 4–10% PPV confirms that user-facing diagnosis claims ("you are getting sick") would systematically mislead athletes.

* References: https://formative.jmir.org/2024/1/e53716/, https://pubmed.ncbi.nlm.nih.gov/39018555/

### 6. Garmin activity-matched baselines (Gaur et al., 2024)

Gaur et al. (*JMIR Formative Research*, 2024; `8:e53977`) prospectively monitored **59 participants** over **8 months** using **Garmin Fenix 6/6s** devices streaming continuous PPG interbeat intervals and step counts paired with daily health logs. Their pipeline compared resting HR/HRV features against **activity-matched personal baselines conditioned on 5-minute and 30-minute intraday step-count bins** rather than a single unconditional personal baseline.

Critical appraisal: shows that activity-conditioned baselines are feasible on Garmin hardware, but does not demonstrate that they reduce false positives from physical exertion — the study did not compare false-positive rates against an unconditional baseline, and illness confirmation was incomplete. A reduction in exertion-driven false positives is therefore a **hypothesis** this repository adopts, not a demonstrated result. In addition, because Gaur et al. conditioned on intraday 5- and 30-minute step-count bins rather than previous-day training-session strata (`post_hard_or_high_cost` vs. `post_easy_or_rest`), this repository's `ActivityStratum` mapping is an **informed extrapolation (Tier 2)** regularized via **empirical-Bayes shrinkage** (`HEALTH_ANOMALY_ACTIVITY_SHRINKAGE_PRIOR_DAYS`) toward the clean 28-day baseline.

* References: https://pmc.ncbi.nlm.nih.gov/articles/PMC11339560/, https://pubmed.ncbi.nlm.nih.gov/39110968/

### 7. Large randomized trial sensitivity vs. specificity trade-off (COVID-RED / Zwiers et al., 2025)

The COVID-RED randomized single-blinded crossover trial (Zwiers, Brakenhoff et al., *PLOS ONE*, 2025; `20(6):e0325116`; **17,825** subjects) compared Ava-bracelet wearable + symptom alerting against a symptom-diary control:

* experimental period sensitivity reached **93.8–99.2%** (day-level **45–52%**) and shifted detection earlier (median **0 vs. 7 days** before positive PCR), vs. symptom-diary sensitivity (**43.3–46.4%** period; **28–33%** day-level);
* however, experimental period specificity dropped to **0.8–4.2%** (day-level **38–50%**) vs. **65.0–66.4%** period specificity (**93–97%** day-level) for symptom diaries, creating heavy alert burden without reducing clinical severity on its own.

Critical appraisal: maximizing sensitivity at the expense of specificity creates severe alert fatigue; early-warning UX must prioritize specificity guards, causal confounder explanation, and actionable response guidance.

* References: https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0325116, https://pubmed.ncbi.nlm.nih.gov/40471995/

### 8. IOC clinical consensus governance & red-flag / RTS boundaries (Schwellnus et al., 2022)

The International Olympic Committee (IOC) consensus statement on acute respiratory illness in athletes (Schwellnus et al., *Br J Sports Med*, 2022 — **Part 1:** `56(19):1066–1088`; **Part 2:** `56(11):630–640`) defines athlete safety boundaries:

* **Rejection of the anatomical "neck check":** localized above-the-neck symptoms do not guarantee absence of systemic viremia or myocardial risk;
* **Systemic red flags:** fever, generalized myalgia, chest pain, disproportionate dyspnea/breathlessness, unexplained resting tachycardia/palpitations, and syncope/dizziness contraindicate strenuous exercise and warrant clinical assessment;
* **Myocarditis vigilance & staged RTS:** though clinically overt post-viral myocarditis/pericarditis in athletic registries is relatively rare (`<3%`), training hard during systemic illness remains the primary preventable risk, requiring progressive symptom-led return-to-sport (RTS).

* References: https://doi.org/10.1136/bjsports-2022-105759, https://doi.org/10.1136/bjsports-2022-105567

### 9. HRV confounding and alcohol wearable telemetry (2024; 2026)

A 2024 HRV confounding review (`https://pubmed.ncbi.nlm.nih.gov/39165281/`) and a 2026 wearable alcohol cohort (`https://pubmed.ncbi.nlm.nih.gov/41801993/`) confirm strong non-infectious nocturnal RHR elevation and HRV suppression after exercise, heat, stress, and dose-dependent alcohol intake.

---

## Three-tier evidence matrix for implemented rules

Every rule in `healthAnomaly.ts`, `healthAnomalyFeatures.ts`, `healthAnomalyOutcome.ts`, `healthAnomalyService.ts`, and `illnessAnomalyFlag.ts` maps to one of three evidentiary tiers:

### Tier 1 — Directly supported by peer-reviewed evidence

| Rule / Mechanism | Primary Implementation | Evidentiary Grounding |
|---|---|---|
| Personal 28-day baselines replacing population cutoffs | `extractSignalObservations` (`mean-stdev-28d`, `log-mean-stdev-28d`, `median-mad-28d`) | Mishra et al. (2020), Alavi et al. (2021/2022), Natarajan et al. (2021), COVI-GAPP (2022), [ADR-0024](../adr/0024-biometric-baseline-estimator-policy.md) |
| Overnight RHR elevation as core adverse feature | `extractSignalObservations` (`rhr`), `evaluatePhysiologicalAnomaly` | Mishra et al. (2020), Alavi et al. (`NightSignal`, 2021/2022), Esmaeilpour et al. (2024) |
| Log-domain overnight HRV suppression as core adverse feature | `extractSignalObservations` (`hrv`, `log-mean-stdev-28d`), `evaluatePhysiologicalAnomaly` | COVI-GAPP (2022), Esmaeilpour et al. (2024), Gaur et al. (2024), 2024 HRV review, [ADR-0024](../adr/0024-biometric-baseline-estimator-policy.md) |
| Nocturnal respiration rate elevation as core channel | `extractSignalObservations` (`respiration`, `median-mad-28d`), `evaluateRespirationElevation` | Natarajan et al. (2021), COVI-GAPP (2022), Esmaeilpour et al. (2024) |
| Structured non-infectious confounder attribution (hard load, short sleep, stress, alcohol within 24h, travel/jet lag, heat, dehydration, vaccination/meds) | `evaluatePhysiologicalAnomaly` (`explanations`, `ContextExplanation`) | Mishra et al. (2020), Alavi et al. (2021/2022), Esmaeilpour et al. (2024), 2026 alcohol wearable cohort |
| Non-diagnostic wording separating physiological anomaly from clinical diagnosis | `EarlyResponseProtocol.nonDiagnosticNotice`, `HealthAnomalyCard` copy | Esmaeilpour et al. (2024; 4–10% PPV), COVID-RED (2025; low wearable specificity) |
| Explicit symptomatic override, rejection of "neck check", IOC red-flag screen, and staged return-to-sport (RTS) guidance | `symptoms_reported` state, `buildEarlyResponseProtocol` (`level_3_symptoms_reported`, `redFlagWarnings`, `returnToSportGuidance`) | Schwellnus et al. (2022; IOC Consensus Parts 1 & 2) |

### Tier 2 — Informed physiological / statistical extrapolation

| Rule / Mechanism | Primary Implementation | Rationale & Bounded Assumption |
|---|---|---|
| Conditioning nocturnal RHR/HRV expectations on previous-day training-activity strata (`ActivityStratum`) with empirical-Bayes shrinkage (`HEALTH_ANOMALY_ACTIVITY_SHRINKAGE_PRIOR_DAYS`) | `computeActivityMatchedExpectations` (`post_hard_or_high_cost` vs. `post_easy_or_rest`) | Extrapolates Gaur et al. (2024) (which used 5- and 30-minute intraday Garmin step-count bins) to previous-day training strata; regularized toward clean 28d baseline when stratum counts are small |
| Separating `correlated_autonomic_only` (RHR + HRV without respiration) from `multi_domain_corroborated` (respiration + RHR/HRV) | `evaluatePhysiologicalAnomaly` (`evidenceQuality`: `HealthAnomalyEvidenceQuality`) | Prevents double-counting shared cardiac vagal/sympathetic variance or RSA coupling across HRV and RHR alone |
| Explicit missingness state (`insufficient_evidence`) when `availableCoreSignals === 0` and asymptomatic | `evaluatePhysiologicalAnomaly`, `evaluateIllnessAnomalyFlag` | Avoids conflating unmeasured or cold-start days with `normal`; prevents false reassurance |
| Contamination-protected clean 28-day baseline recomputation (excluding strictly prior `< date` symptomatic days down to `>= 7` clean observations) | `extractSignalObservations` (`contaminatedDates`, `baselineMaturity`), wired live in `HealthAnomalyService.assessAndPersist` and in `runHealthAnomalyReplay` | Prevents sustained symptomatic autonomic spikes from inflating baseline center/scale and masking ongoing illness |
| Downgrading lagging 28-day respiration elevations when 7-day respiration trend has reversed (`status === 'resolving'`) | `VISIBLE_V1_HEALTH_ANOMALY_THRESHOLDS` (`downgradeResolvingRespiration: true`) + `evaluateRespirationElevation` | Prevents stale high values inside the 28d median window from falsely extending an anomaly tail during recovery |
| Time-decaying reactogenicity window for vaccination / medication confounders (`strong` -> `moderate` at `priorAdverseDays >= 2`) | `evaluatePhysiologicalAnomaly` confounder handling | Acute post-vaccine/med autonomic responses peak over 24–48h; persistent Day 3+ anomalies re-surface for attention |
| Dual persistence counters (`persistenceDays` vs. `unexplainedPersistenceDays`) across live evaluation and replay | `PhysiologicalAnomalyAssessment`, `HealthAnomalyService`, `runHealthAnomalyReplay` | Ensures `explained_recovery_strain` -> unexplained transitions neither erase prior strain nor skip unexplained streak counting |

### Tier 3 — Exploratory product heuristics requiring ongoing replay monitoring

| Rule / Mechanism | Primary Implementation | Open Calibration Question (Monitor via Replay / HA9) |
|---|---|---|
| Exact deviation thresholds (`moderateDeviation: 1.5`, `strongDeviation: 2.5`) and `emerging_baseline` (`7–13` nights) `+0.5z` penalty (`2.0z` / `3.0z`, capped at `watch_unexplained`) | `VISIBLE_V1_HEALTH_ANOMALY_THRESHOLDS` (`emergingHistoryCount: 7`, `minimumHistoryCount: 14`) | Measure false-alert rate per 30 days across `emerging` vs. `reliable` baseline cohorts |
| First-night multi-domain corroborated escalation (`possible_illness_or_systemic_stress` on Night 1 when reliable `respiration` + `rhr`/`hrv` are unexplained and either all 3 signals are unexplained with `strongUnexplainedCount >= 1`, `strongUnexplainedCount >= 2`, or `strongUnexplainedCount >= 1 && closeSickContact`) | `VISIBLE_V1_HEALTH_ANOMALY_THRESHOLDS` (`allowFirstNightMultiDomainEscalation: true`), `evaluatePhysiologicalAnomaly` | Track Day-1 escalated false-positive rate vs. lead-time gain against 2-night gating in `runHealthAnomalyReplay` |
| `closeSickContact` pairing with a strong unexplained multi-domain shift (`strongUnexplainedCount >= 1 && closeSickContact`) to allow Night-1 escalation | `evaluatePhysiologicalAnomaly` (`closeSickContact` plausibility modifier) | Evaluate incremental PPV/recall when recent exposure is logged; moderate-only shifts remain `watch_unexplained` on Night 1 |
| Personal outcome calibration readiness bar (`priorEpisodesCount >= 3` and resolved outcomes `>= 3`, strictly `< asOfDate` in `Europe/Warsaw`) | `summarizePersonalOutcomeCalibration` (`calibrationEligible`), wired live via `HealthAnomalyService.assessAndPersist` + `healthAnomalyOutcomeRepository.listForUser` | Verify stability of personal false-positive / progression rates before using personal summaries to tune cutoffs |
| Automatic training-plan restriction (`tighten-v1` policy) | `resolveConfiguredHealthAnomalyRuntimePolicy` (clamps `'tighten-v1'` -> `'visible-v1'`) | Deferred until HA9 prospective labelled outcome validation (`>= 90` days, `>= 3` resolved labelled episodes, measured healthy-day flip burden) |
