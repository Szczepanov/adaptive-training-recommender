# HA7 visible early-warning release decision and two-tier gate redesign

* **Date:** 2026-11-15
* **Type:** release decision and architectural audit
* **Decision authority:** records the release audit, defect taxonomy, and redesigned two-tier gate motivating the 2026-11-15 amendment to [ADR-0025](../adr/0025-physiological-anomaly-and-possible-illness-signals.md) and the updates to [health-anomaly-and-illness-risk-alerting.md](../plans/health-anomaly-and-illness-risk-alerting.md) and [health-anomaly-shadow.md](../architecture/health-anomaly-shadow.md).
* **Scientific context:** [2026-08-21 physiological anomaly and illness-risk review](./2026-08-21-physiological-anomaly-and-illness-risk-research.md)

---

## Executive decision

Release **`visible-v1`** (non-diagnostic physiological early warnings, the 3-level early-response protocol, and the advisory `illness_anomaly` D-FLAG) immediately under a **redesigned Tier 1 personal-baseline-readiness gate**, while keeping **`tighten-v1`** (automatic training-plan restriction) **inactive and gated behind HA9 prospective outcome validation** under **Tier 2**.

Under [ADR-0052](../adr/0052-user-ledger-and-external-ai-planning-authority.md), the frontend operates in **ledger mode** by default: D-FLAGS surface situational physiological signals without exercising an autonomous training veto. Unlocking `visible-v1` aligns health-anomaly telemetry with that ledger architecture, eliminates years-long cold-start lockouts for healthy athletes, fixes six concrete correctness defects discovered during audit, and initiates genuine prospective outcome collection in live daily use.

---

## Audit of why `visible-v1` previously failed closed

Prior to this release decision, health-anomaly detection was structurally silenced in four places across the codebase:

1. **Runtime fail-closed policy selector (`healthAnomalyRuntime.ts`):** `resolveConfiguredHealthAnomalyShadowPolicy` (now retained as an alias for `resolveConfiguredHealthAnomalyRuntimePolicy`) previously defaulted unset environments to `'off'` and explicitly rejected `'visible-v1'` and `'tighten-v1'`, clamping only exact `'shadow-v1'` and forcing every other value back to `'off'`. Even explicit opt-in configuration could not enable visible warnings.
2. **Hardcoded D-FLAG capture lock (`flagCaptureService.ts`):** `FlagCaptureService` persisted `illness_anomaly` solely as `{ state: 'not_yet_supported', severity: null, reasonCode: 'ha7_release_gate_unmet' }` regardless of whether persisted health-anomaly assessments existed.
3. **Hardcoded Today strip lock (`flagStripItems.ts` and `FlagStrip.tsx`):** `Today` flag resolution and rendering similarly froze `illness_anomaly` at `state: 'not_yet_supported'` / `ha7_release_gate_unmet`.
4. **Hardcoded ledger export lock (`buildLedgerExport.ts`):** Derived ledger JSON exports reported `illness_anomaly` as `not_yet_supported` (`ha7_release_gate_unmet`), preventing downstream AI coaches or external planning reviews from seeing evaluated anomaly state or confounder context.

---

## Flaw in the original ADR-0025 HA7 release gate

The original [ADR-0025](../adr/0025-physiological-anomaly-and-possible-illness-signals.md) cutover section required two simultaneous thresholds before transitioning `shadow-v1` -> `visible-v1`:

* at least **60 observed days** with all three core channels non-`unavailable` on at least 80% of days; **and**
* at least **5 distinct anomaly episodes** (`watch_unexplained` or stronger) inside the report window.

That combined rule contained a fundamental conceptual flaw: **it conflated personal physiological baseline readiness with labelled personal illness episodes.**

* **Mathematical baseline readiness** requires only 14–28 nights (and conservatively as few as 7 clean nights with stricter cutoffs) of resting heart rate (`rhr`), overnight `hrv`, and nocturnal `respiration` to parameterize stable personal distributions (`mean-stdev-28d`, `log-mean-stdev-28d`, `median-mad-28d`).
* **Distinct anomaly episodes** depend on infectious exposure and incidence. A healthy, well-recovered athlete may log `0–2` respiratory illnesses per year. Requiring `>= 5` distinct unexplained anomaly episodes meant a healthy athlete with complete sensor coverage remained permanently locked behind `ha7_release_gate_unmet` — receiving zero visibility on their first, second, third, or fourth genuine pre-symptomatic shift.
* Conversely, once non-diagnostic situational visibility (`visible-v1`) is decoupled from autonomous workout restriction (`tighten-v1`), an athlete does **not** need five historical infections to inspect an unexplained `+2.2z` respiration/RHR excursion paired with confounders and an IOC-aligned early-watch protocol. Requiring outcome validation makes sense before **autonomous training restriction** (`tighten-v1`), not before **non-diagnostic biometric awareness** (`visible-v1`).

---

## Six implementation defects identified and fixed

Auditing the HA0–HA6 shadow implementation uncovered six behavioral defects that needed resolution before visible release:

| # | Defect | Impact Before Fix | Fix Implemented |
|---|---|---|---|
| 1 | **False-reassurance `normal` on missing data** | `evaluatePhysiologicalAnomaly` returned `state: 'normal'` whenever `adverseAnomalies.length === 0`, even when `availableCoreSignals === 0` (no wearable nights / stale baseline / cold start). Users with missing data were silently told physiology looked normal. | Added `'insufficient_evidence'` to `PhysiologicalAnomalyState` (`evidenceQuality: 'insufficient'`, caution `'INSUFFICIENT_WEARABLE_BASELINE_OR_SIGNALS'`, `episodeId: null`, `episodeDay: null`). `evaluateIllnessAnomalyFlag` maps `insufficient_evidence` and `availableCoreSignals === 0` to `state: 'missing'`, `reasonCode: 'no_core_signals'`. |
| 2 | **Persistence discrepancy between live service and replay** | `HealthAnomalyService` forwarded `priorAssessment.persistenceDays` (which advances on `explained_recovery_strain`), whereas `runHealthAnomalyReplay` reset persistence when the previous day had `unexplainedEvidence.length === 0`. An athlete transitioning from hard-session strain into unexplained strain behaved differently in live production vs. replay. | Track both `persistenceDays` (consecutive adverse core physiology days) and `unexplainedPersistenceDays` (`priorUnexplainedDays`, consecutive days with `unexplainedEvidence.length > 0`) consistently in `evaluatePhysiologicalAnomaly`, `HealthAnomalyService`, and `runHealthAnomalyReplay`. |
| 3 | **Two-night escalation delay & missing Level 1 early-response guidance** | Strong Night-1 multi-domain corroborated cardiorespiratory anomalies (`respiration` + `RHR`/`HRV`) were forced down to `watch_unexplained` until Night 2, sacrificing the 1–3 day pre-symptomatic lead time documented by Alavi et al. (`NightSignal`), Grzesiak et al., and Esmaeilpour et al. Meanwhile, mild/watch states had no structured actionable guidance. | Separated `correlated_autonomic_only` (RHR + HRV without respiration; stays `watch_unexplained` on Night 1) from `multi_domain_corroborated` (respiration + RHR/HRV). Added `allowFirstNightMultiDomainEscalation` (`VISIBLE_V1_HEALTH_ANOMALY_THRESHOLDS`) for Night-1 strong multi-domain deviations or moderate multi-domain + `closeSickContact`, plus `buildEarlyResponseProtocol` (`none`, `level_1_early_watch`, `level_2_persistent_or_corroborated`, `level_3_symptoms_reported`) with IOC red-flag screening and 3-stage RTS guidance. |
| 4 | **Lagging 28-day median tail prolonging resolving respiration alerts** | When nocturnal respiration peaked transiently and had already returned toward normal (`evaluateRespirationElevation` reporting `status === 'resolving'`: `deltaVs7d <= 0` while `deltaVs28d > 0`), the sluggish 28-day baseline still tagged recovery nights as elevated. | Enabled `downgradeResolvingRespiration: true` on `VISIBLE_V1_HEALTH_ANOMALY_THRESHOLDS`, preventing a resolving 7d respiration trajectory from falsely sustaining an active anomaly alert. |
| 5 | **Baseline contamination from prior symptomatic days** | Sustained autonomic disturbances during reported symptomatic days remained inside the 28-day reference window, inflating baseline centers and variances and masking real anomalies on recovery or relapse days. | Added causal contamination exclusion in `extractSignalObservations` / `mapRecoverySnapshotToHealthAnomalyFeatures`: strictly prior symptomatic dates (`< currentDate`) in `contaminatedDates` are excluded while preserving at least `HEALTH_ANOMALY_EMERGING_BASELINE_OBSERVATIONS` clean nights and recording `AssessmentDataQuality.contaminatedDaysExcluded`; actively wired in `runHealthAnomalyReplay` (`HealthAnomalyService.assessAndPersist` does not yet pass prior symptomatic date lists live). |
| 6 | **Indefinite `strong` confounder suppression from vaccination or medication changes** | Reporting `recentVaccination` or `medicationChange` produced `'strong'` coverage across all three core channels indefinitely whenever active, preventing persistent Day 3+ systemic strain from escalating. | Capped `'vaccination'` and `'medication_change'` explanation strength at `'moderate'` once `priorAdverseDays >= 2` (Day 3+), reflecting expected 24–48 hour acute reactogenicity while letting persistent anomalies re-surface. |

---

## Incremental signal value beyond existing readiness flags

Because `app/src/derived/flags/recoveryBeyondBaseline.ts` (`evaluateRecoveryBeyondBaseline`) and `app/src/derived/flags/illnessRiskSymptom.ts` (`evaluateIllnessRiskSymptom`) already exist in the `D-FLAGS` catalog, release requires confirming that `evaluatePhysiologicalAnomaly` provides materially distinct signal rather than duplicating readiness strain:

| Dimension | Existing Readiness / Strain (`evaluateRecoveryBeyondBaseline`) | Health Anomaly (`evaluatePhysiologicalAnomaly`) |
|---|---|---|
| **Physiological channels** | HRV (`7d` vs `28d` delta), RHR (`7d` vs `28d` delta), Sleep Score (`7d` vs `28d` delta + `< 50` floor). **No respiration rate.** | **Nocturnal respiration rate (`median-mad-28d`)**, **log-domain HRV (`log-mean-stdev-28d`)**, and **RHR (`mean-stdev-28d`)**, enriched by `evaluateRespirationElevation` (`deltaVs7d` / `deltaVs28d`). |
| **Multi-day state & episodes** | Strictly single-day stateless evaluation (`clear` / `active` / `missing`). | Stateful multi-day episode tracking (`episodeId`, `episodeDay`), distinguishing `persistenceDays` from `unexplainedPersistenceDays`. |
| **Confounder & training context** | Does not attribute deviations to alcohol, travel/jet lag, heat, dehydration, vaccination/meds, short sleep, or sick contacts, nor condition on activity stratum. | Explicit `ContextExplanation` attribution plus empirical-Bayes **activity-matched expectations** (`computeActivityMatchedExpectations`, shrinking `post_hard_or_high_cost` / `post_easy_or_rest` residuals with `HEALTH_ANOMALY_ACTIVITY_SHRINKAGE_PRIOR_DAYS` toward clean 28d baseline). |
| **Correlated vs. multi-domain separation** | No explicit RSA/autonomic coupling distinction. | Separates `correlated_autonomic_only` (RHR + HRV alone) from `multi_domain_corroborated` (respiration + RHR/HRV) to prevent autonomic double-counting. |
| **Missingness behavior** | Requires all 3 inputs to declare `clear` (`missing` otherwise). | Now symmetrically enforces `insufficient_evidence` (`availableCoreSignals === 0` and asymptomatic), mapping to `no_core_signals` in `evaluateIllnessAnomalyFlag`. |
| **User response & outcome loop** | Informational flag severity (`moderate` / `high`) only. | Outputs 3-concept model (`anomalySeverity`, `evidenceQuality`, `state`), structured 3-level `EarlyResponseProtocol` (actions, reassess timing, IOC red-flag warnings, staged RTS), and prospective 24–72h outcome capture (`HealthAnomalyFollowupCard` + `summarizePersonalOutcomeCalibration`). |

Summary: readiness flags capture coarse cardiovascular + sleep strain after training; `evaluatePhysiologicalAnomaly` isolates **respiration-corroborated and confounder-adjusted systemic anomalies** with multi-day episode continuity and an explicit non-diagnostic athlete protocol.

---

## Three-stage calibration architecture & warning model

The released evaluator organizes athlete maturation across three progressive stages (`HealthAnomalyCalibrationStage`):

* **Stage A — Personal baseline readiness:**
  * `insufficient_evidence` (`< 7` clean nights, stale baseline, or `0` core signals measured today) -> emits `state: 'insufficient_evidence'`; never falsifies health as `'normal'`.
  * `emerging_baseline` (`7–13` clean nights, `HEALTH_ANOMALY_EMERGING_BASELINE_OBSERVATIONS` to `< HEALTH_ANOMALY_MIN_BASELINE_OBSERVATIONS`) -> evaluates with a conservative `+0.5z` deviation penalty (`2.0z` moderate / `3.0z` strong) and caps unexplained output at `watch_unexplained`.
  * `reliable_baseline` (`>= 14` clean nights within the 28-day window) -> full `VISIBLE_V1_HEALTH_ANOMALY_THRESHOLDS` sensitivity including Night-1 `multi_domain_corroborated` escalation when warranted.
* **Stage B — Contamination protection & activity-matched adaptation:**
  * Causal clean-window recomputation (`extractSignalObservations` / `mapRecoverySnapshotToHealthAnomalyFeatures`) excludes strictly prior symptomatic nights (`< currentDate`) when `contaminatedDates` are provided (actively wired in `runHealthAnomalyReplay`) while keeping `>= 7` clean points.
  * `computeActivityMatchedExpectations` is invoked live by `HealthAnomalyService.assessAndPersist` via `mapRecoverySnapshotToHealthAnomalyFeatures(snapshot, history)` to separate `post_hard_or_high_cost` vs. `post_easy_or_rest` baseline shifts using empirical-Bayes shrinkage (`HEALTH_ANOMALY_ACTIVITY_SHRINKAGE_PRIOR_DAYS`).
* **Stage C — Causal personal outcome calibration:**
  * `summarizePersonalOutcomeCalibration` is implemented as a pure calibration/schema helper aggregating strictly causal prior outcome records (`< asOfDate` across `sourceAssessment.date`, `updatedAt`, `symptomOnset.date`, `respiratoryTest.testedOn`); not yet queried live by `HealthAnomalyService`.
  * Marks `calibrationEligible: true` (`calibrationStage: 'outcome_calibrated'`) only once `priorEpisodesCount >= 3` and `resolvedCount >= 3`, preventing small-sample overfitting while collecting prospective precision/false-positive feedback via `HealthAnomalyFollowupCard`.

Every daily assessment separates three distinct user-facing concepts:

1. **`anomalySeverity` (`HealthAnomalySeverity`):** `none | mild | moderate | strong` — magnitude of measured deviation.
2. **`evidenceQuality` (`HealthAnomalyEvidenceQuality`):** `insufficient | emerging | single_channel | correlated_autonomic_only | multi_domain_corroborated` — evidential independence and baseline maturity.
3. **`state` (`PhysiologicalAnomalyState`):** `insufficient_evidence | normal | explained_recovery_strain | watch_unexplained | possible_illness_or_systemic_stress | symptoms_reported` — causal interpretation driving the 3-level `EarlyResponseProtocol`.

---

## Redesigned two-tier release gate

| Release Tier | Target Mode & Surfaces | Required Evidence / Safety Gate | Current Status (2026-11-15) |
|---|---|---|---|
| **Tier 1: Advisory visibility (`visible-v1`)** | Default runtime policy (`resolveConfiguredHealthAnomalyRuntimePolicy` -> `'visible-v1'`); `HealthAnomalyCard` on `Home`; live `illness_anomaly` in `FlagCaptureService`, `FlagStrip`, and `buildLedgerExport`; enhanced replay (`policySummaries`). | 1. Stage A personal baseline readiness (`insufficient_evidence` `< 7`, conservative `emerging` `7–13`, full `reliable` `>= 14`).<br>2. Explicit missingness handling (zero false-reassurance `normal`).<br>3. Non-diagnostic wellness language (`EarlyResponseProtocol.nonDiagnosticNotice` + language audit tests).<br>4. Zero autonomous workout veto (advisory under ADR-0052).<br>5. IOC consensus red-flag screen + 3-stage RTS guidance + prospective 24–72h outcome capture. | **APPROVED & ACTIVE** |
| **Tier 2: Autonomous training tightening (`tighten-v1`)** | Would allow validated anomaly alerts to restrict planned training intensity/volume automatically (`EnginePolicy` tightening / HA9). | 1. HA9 prospective outcome report covering `>= 90` observed days with reliable 3-channel coverage.<br>2. `>= 3` prospectively outcome-labelled episodes (`HealthAnomalyOutcomeRecord`) in personal history.<br>3. Measured healthy-day restriction / flip-burden ceiling and positive comparative utility over existing readiness metrics.<br>4. Explicit safety-authority review under [ADR-0052](../adr/0052-user-ledger-and-external-ai-planning-authority.md). | **INACTIVE / GATED** (`'tighten-v1'` clamps to `'visible-v1'` at runtime) |
