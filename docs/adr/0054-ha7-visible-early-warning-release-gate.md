# ADR-0054: HA7 visible early-warning two-tier release gate and Stage A–C calibration

* **Status:** Accepted
* **Date:** 2026-11-15
* **Deciders:** Core Engineering Team
* **Supersedes (in part):** [ADR-0025](./0025-physiological-anomaly-and-possible-illness-signals.md) — only its `shadow-v1 -> visible-v1` cutover gate, rollout default `'off'`, and single-stage state contract. Disposition of each ADR-0025 `shadow-v1 -> visible-v1` prerequisite:
  * *Minimum 5-episode count* — **superseded** by per-athlete Stage A/B baseline readiness (§1, §3).
  * *60-observed-day window with ≥ 80% three-channel coverage* — **superseded** as a cohort cutover prerequisite; per-athlete readiness and explicit missingness (`insufficient_evidence`) replace it.
  * *Healthy-day unexplained-alert noise bound* — **superseded** as a pre-cutover prerequisite; healthy-day burden is measured prospectively from HA6 follow-up outcomes and gates `tighten-v1` (HA9 flip-burden ceiling), not `visible-v1`.
  * *Stability across two non-overlapping observation windows* — **superseded** as a pre-cutover prerequisite for `visible-v1`; not carried into HA9.
  * *Rollback condition* — **retained in part**: the policy selector still reverts to `shadow-v1` (or `'off'`) through `resolveConfiguredHealthAnomalyRuntimePolicy`, but the automatic 14-day trigger against HA7-report bounds is superseded, because no cohort HA7 report with such bounds exists; reverting is an owner decision.
  * ADR-0025's `visible-v1 -> tighten-v1` gate is **retained** unchanged (Tier 2 / HA9).
* **Related decisions:** [ADR-0024](./0024-biometric-baseline-estimator-policy.md), [ADR-0052](./0052-user-ledger-and-external-ai-planning-authority.md), [ADR-0053](./0053-firestore-rules-scope.md)
* **Supporting analyses:** [2026-11-15 HA7 visible early-warning release decision](../analysis/2026-11-15-ha7-visible-early-warning-release-decision.md), [2026-11-15 physiological anomaly literature & calibration evidence](../analysis/2026-11-15-physiological-anomaly-literature-and-calibration-evidence.md)

---

## Context

[ADR-0025](./0025-physiological-anomaly-and-possible-illness-signals.md) introduced a standalone health-anomaly evaluator (`evaluatePhysiologicalAnomaly`) independent of `metricStrain`, together with a `shadow-v1 -> visible-v1` cutover gate requiring both:

* at least **60 observed days** with all three core channels non-`unavailable` on at least 80% of days; **and**
* at least **5 distinct anomaly episodes** (`watch_unexplained` or stronger) inside the report window.

Auditing the HA0–HA6 shadow pipeline exposed two structural issues:

1. **Conflation of baseline readiness with infection incidence:** a healthy athlete experiencing `0–2` respiratory illnesses per year remained permanently locked behind `ha7_release_gate_unmet` across `healthAnomalyRuntime.ts`, `flagCaptureService.ts`, `flagStripItems.ts`, and `buildLedgerExport.ts`, receiving zero early-warning visibility on their first four genuine pre-symptomatic shifts. Meanwhile, under [ADR-0052](./0052-user-ledger-and-external-ai-planning-authority.md), the app defaults to **ledger mode**, where `D-FLAGS` are purely advisory without autonomous workout veto authority.
2. **Six behavioral and calibration correctness gaps:** false-reassurance `'normal'` on zero measured core signals, persistence discrepancy between `HealthAnomalyService` and `runHealthAnomalyReplay`, two-night delay even on strong multi-domain cardiorespiratory shifts (`respiration` + `rhr`/`hrv`) alongside missing early-response guidance, lagging 28-day respiration median tails during resolving recovery, baseline contamination from prior symptomatic nights, and indefinite `'strong'` confounder masking from vaccination/medication changes.

---

## Decision Outcome

We **partially supersede [ADR-0025](./0025-physiological-anomaly-and-possible-illness-signals.md)** by decoupling **non-diagnostic advisory visibility (`visible-v1`)** from **autonomous training restriction (`tighten-v1`)** under a **Two-Tier Release Gate**, backed by a **three-stage calibration architecture (Stage A–C)** and a **three-concept warning model**.

### 1. Redesigned Two-Tier Release Gate

* **Tier 1 — Advisory visibility (`visible-v1`) [APPROVED & DEFAULT]:**
  * `resolveConfiguredHealthAnomalyRuntimePolicy` defaults unset environments to `'visible-v1'` (explicit `'off'` and `'shadow-v1'` remain supported).
  * Authorizes per-athlete visibility based on Stage A/B physiological baseline readiness, explicit missingness semantics, non-diagnostic wellness language, zero workout veto under [ADR-0052](./0052-user-ledger-and-external-ai-planning-authority.md), IOC-aligned clinical red-flag screening + staged return-to-sport (RTS) guidance, and prospective HA6 outcome collection (`HealthAnomalyFollowupCard`).
  * Unlocks `HealthAnomalyCard` on `Home` and live `illness_anomaly` `D-FLAG` capture/strip/export via `evaluateIllnessAnomalyFlag` (replacing hardcoded `ha7_release_gate_unmet`).
* **Tier 2 — Autonomous training tightening (`tighten-v1`) [INACTIVE / GATED BEHIND HA9]:**
  * Any configured `'tighten-v1'` policy continues to fail safe by clamping to `'visible-v1'` inside `resolveConfiguredHealthAnomalyRuntimePolicy`.
  * Unlocking `'tighten-v1'` still requires a separate HA9 prospective outcome report (`>= 90` observed days with reliable 3-channel coverage, `>= 3` prospectively outcome-labelled episodes, measured healthy-day flip burden ceiling, and explicit safety-authority review under [ADR-0052](./0052-user-ledger-and-external-ai-planning-authority.md)).

### 2. Three-Concept Warning Model and Extended Assessment Contract

`PhysiologicalAnomalyAssessment` adds explicit separation of:

```ts
type PhysiologicalAnomalyState =
  | 'insufficient_evidence'
  | 'normal'
  | 'explained_recovery_strain'
  | 'watch_unexplained'
  | 'possible_illness_or_systemic_stress'
  | 'symptoms_reported';

type HealthAnomalySeverity = 'none' | 'mild' | 'moderate' | 'strong';
type HealthAnomalyEvidenceQuality =
  | 'insufficient'
  | 'emerging'
  | 'single_channel'
  | 'correlated_autonomic_only'
  | 'multi_domain_corroborated';
type HealthAnomalyCalibrationStage =
  | 'insufficient_evidence'
  | 'emerging_baseline'
  | 'reliable_baseline'
  | 'outcome_calibrated';
type EarlyResponseLevel =
  | 'none'
  | 'level_1_early_watch'
  | 'level_2_persistent_or_corroborated'
  | 'level_3_symptoms_reported';
```

Every visible assessment carries `anomalySeverity`, `evidenceQuality`, `calibrationStage`, `unexplainedPersistenceDays`, `earlyResponse` (`EarlyResponseProtocol`), `activityMatchedExpectations`, and causal `personalCalibration` summary telemetry — never an uncalibrated disease probability percentage.

### 3. Three-Stage Calibration Architecture (Stage A–C)

1. **Stage A — Personal baseline readiness:**
   * **`insufficient_evidence` (`< 7` clean observations or `availableCoreSignals === 0` without symptoms):** emits `state: 'insufficient_evidence'` (`INSUFFICIENT_WEARABLE_BASELINE_OR_SIGNALS`, `episodeId: null`, `episodeDay: null`), which `evaluateIllnessAnomalyFlag` maps to D-FLAG `state: 'missing'`, `reasonCode: 'no_core_signals'`. Never emits false-reassurance `'normal'`.
   * **`emerging_baseline` (`7–13` clean observations, `HEALTH_ANOMALY_EMERGING_BASELINE_OBSERVATIONS`):** applies a conservative `+0.5z` deviation penalty (`2.0z` moderate / `3.0z` strong) and caps unexplained anomalies at `watch_unexplained`. If anomalous channels only have emerging baselines while a normal channel has a reliable baseline, `calibrationStage` stays `'emerging_baseline'` and escalation to `possible_illness_or_systemic_stress` remains blocked.
   * **`reliable_baseline` (`>= 14` clean observations within 28 days):** enables full `VISIBLE_V1_HEALTH_ANOMALY_THRESHOLDS` sensitivity (`moderateDeviation: 1.5`, `strongDeviation: 2.5`).
2. **Stage B — Contamination protection & activity-matched adaptation:**
   * `HealthAnomalyService.assessAndPersist` queries prior check-ins via `checkinService.getCheckinsInRangeState` and `runHealthAnomalyReplay` tracks prior symptomatic dates to pass strictly causal `contaminatedDates` (`< date`) into `mapRecoverySnapshotToHealthAnomalyFeatures` / `extractSignalObservations`, excluding prior symptomatic nights while retaining at least `HEALTH_ANOMALY_EMERGING_BASELINE_OBSERVATIONS` clean observations and recording `contaminatedDaysExcluded`.
   * `computeActivityMatchedExpectations` computes empirical-Bayes shrunk (`HEALTH_ANOMALY_ACTIVITY_SHRINKAGE_PRIOR_DAYS`) post-training strata expectations (`post_hard_or_high_cost` vs. `post_easy_or_rest`) live and in replay.
3. **Stage C — Causal personal outcome calibration:**
   * `HealthAnomalyService.assessAndPersist` loads prior user outcomes via `healthAnomalyOutcomeRepository.listForUser` and computes `summarizePersonalOutcomeCalibration(outcomes, date)` using strict `Europe/Warsaw` calendar-date causal boundaries (`< asOfDate` across `sourceAssessment.date`, `updatedAt`, `symptomOnset.date`, and `respiratoryTest.testedOn`).
   * Unlocks `calibrationEligible: true` (`calibrationStage: 'outcome_calibrated'`) once `priorEpisodesCount >= 3` and resolved outcomes `>= 3`.
   * Immutable revision identity (`HealthAnomalySourceIdentity`) includes optional `previousAssessmentRevisionId`, `contaminatedDates`, `personalCalibrationRevision`, and `supersedesRevisionId` (validated by `isSourceIdentity` and `app/rules/07-health-anomalies.rules`) so upstream history or outcome edits generate fresh immutable revisions without `revisionId` collisions. When an identity repeats an older same-date revision that is no longer latest, `HealthAnomalyService` sets `supersedesRevisionId` to the latest revision so a fresh immutable revision becomes latest; a repeat of the latest stays idempotent.

### 4. Multi-Domain Corroboration, RSA Guard, Persistence, and Confounders

* **Autonomic coupling vs. multi-domain corroboration:** Night-1 `rhr` + `hrv` co-deviation without elevated `respiration` is classified as `correlated_autonomic_only` and stays at `watch_unexplained` (adjusting wording when `respiration` is `unavailable` vs. `normal`). Under `VISIBLE_V1_HEALTH_ANOMALY_THRESHOLDS.allowFirstNightMultiDomainEscalation`, reliable Night-1 `multi_domain_corroborated` (`respiration` + `rhr`/`hrv`) escalates to `possible_illness_or_systemic_stress` only when:
  * all 3 core channels are unexplained and `strongUnexplainedCount >= 1`; or
  * `strongUnexplainedCount >= 2`; or
  * `strongUnexplainedCount >= 1 && closeSickContact` (at least one strong unexplained signal alongside a sick contact). Moderate-only multi-domain deviations with `closeSickContact` remain `watch_unexplained` until persistence (`unexplainedPersistenceDays >= 2`) or stronger elevation.
* **Resolving respiration & acute confounder decay:** `downgradeResolvingRespiration: true` attenuates single resolving respiration recovery tails (`evaluateRespirationElevation` reporting `status === 'resolving'`); `vaccination` and `medication_change` confounder coverage steps down from `'strong'` to `'moderate'` once `priorAdverseDays >= 2` (Day 3+).
* **Dual persistence & diagnostic-read safety:** `persistenceDays` tracks consecutive adverse core-physiology days while `unexplainedPersistenceDays` tracks consecutive `unexplainedEvidence.length > 0` days identically across `HealthAnomalyService` and `runHealthAnomalyReplay`. Live UI and flag capture read diagnostics (`getLatestForDateWithDiagnostics`), withholding follow-up prompts and marking `illness_anomaly` `'invalid'` whenever `unreadableCount > 0`.

---

## Consequences

### Positive

* Healthy athletes receive immediate, well-calibrated, non-diagnostic physiological awareness and structured recovery protocols instead of years-long `ha7_release_gate_unmet` silence.
* Live production (`HealthAnomalyService.assessAndPersist`) and offline replay (`runHealthAnomalyReplay`) share aligned causal contamination protection, dual persistence accounting, and personal outcome calibration lineage.
* Tier 2 (`tighten-v1`) remains structurally locked until HA9 prospective outcome evidence validates recommendation flips.

### Negative / Risks

* `visible-v1` relies on conservative Tier 2/3 statistical bounds (`emerging_baseline` penalty, shrinkage prior, Night-1 corroboration criteria) that must be continuously audited in `runHealthAnomalyReplay` (`policySummaries`) and HA6 outcome collection.
* Preserving [ADR-0025](./0025-physiological-anomaly-and-possible-illness-signals.md) immutably means readers consulting `ADR-0025` directly must follow the `Superseded` link to this ADR for the active HA7 contract.

---

## References

* Core evaluator & thresholds: `app/src/derived/flags/illnessAnomaly/healthAnomaly.ts`
* Feature extraction & clean-window baselines: `app/src/derived/flags/illnessAnomaly/healthAnomalyFeatures.ts`
* Outcome schema & Stage C causal calibration: `app/src/derived/flags/illnessAnomaly/healthAnomalyOutcome.ts`
* Live orchestration & immutable source identity: `app/src/services/healthAnomalyService.ts`, `app/src/services/healthAnomalyPersistence.ts`, `app/src/services/healthAnomalyOutcomeService.ts`
* Flag & UI consumers: `app/src/derived/flags/illnessAnomaly/illnessAnomalyFlag.ts`, `app/src/services/flagCaptureService.ts`, `app/src/components/HealthAnomalyCard.tsx`, `app/src/components/FlagStrip.tsx`
* Security rules: `app/rules/07-health-anomalies.rules`
