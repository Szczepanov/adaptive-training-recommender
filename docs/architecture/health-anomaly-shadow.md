# Health Anomaly Early Warnings, Shadow Observability, and Replay

Implemented architecture for the physiological anomaly evaluator, Tier 1 **`visible-v1`** early warnings, **`illness_anomaly`** D-FLAG integration, and shadow/replay observability under [ADR-0025](../adr/0025-physiological-anomaly-and-possible-illness-signals.md), [ADR-0054](../adr/0054-ha7-visible-early-warning-release-gate.md), and [the 2026-11-15 HA7 release decision](../analysis/2026-11-15-ha7-visible-early-warning-release-decision.md).

## Runtime policy selector and defaults

Runtime gating lives in `app/src/services/healthAnomalyRuntime.ts`:

* `resolveConfiguredHealthAnomalyRuntimePolicy` resolves `VITE_HEALTH_ANOMALY_POLICY` into `HealthAnomalyActiveRuntimePolicy`:
  * **Default (`undefined` / empty string):** `'visible-v1'` (following Tier 1 release on 2026-11-15);
  * **`'visible-v1'` / `'shadow-v1'` / `'off'`:** respected explicitly;
  * **`'tighten-v1'`:** fails safe by clamping to `'visible-v1'` — autonomous training restriction remains inactive until HA9 outcome validation unlocks Tier 2;
  * **Malformed / unrecognized values:** fail closed to `'off'`.
* `runConfiguredHealthAnomalyShadow` executes the active pipeline for `'visible-v1'` and `'shadow-v1'` and is inert on `'off'`, supplying `VISIBLE_V1_HEALTH_ANOMALY_THRESHOLDS` by default when `visible-v1` is active (while preserving `SHADOW_V1_HEALTH_ANOMALY_THRESHOLDS` for diagnostic shadow/replay runs).

Under [ADR-0052](../adr/0052-user-ledger-and-external-ai-planning-authority.md), both `shadow-v1` and `visible-v1` are strictly advisory and never veto or alter training decisions (`EnginePolicy` / `recommendation` outputs remain unchanged).

## Core evaluator, Stage A–C calibration, and state machine

Pure evaluation and feature logic live under `app/src/derived/flags/illnessAnomaly/` (extracted out of `engine/` per ADR-0052):

* **Feature extraction & baselines (`healthAnomalyFeatures.ts`):**
  * `extractSignalObservations` builds rolling 28-day baselines (`HEALTH_ANOMALY_BASELINE_WINDOW_DAYS`) across `rhr` (`mean-stdev-28d`), `respiration` (`median-mad-28d`), and `hrv` (`log-mean-stdev-28d`), paired with `evaluateRespirationElevation`.
  * Supports causal `contaminatedDates` exclusion (dropping strictly prior symptomatic dates `< currentDate` while preserving at least `HEALTH_ANOMALY_EMERGING_BASELINE_OBSERVATIONS` [`7`] clean nights, and recording `contaminatedDaysExcluded` in `AssessmentDataQuality`), wired both into `HealthAnomalyService.assessAndPersist` (via `checkinService.getCheckinsInRangeState`) and into `runHealthAnomalyReplay`.
  * `computeActivityMatchedExpectations` computes stratum-specific expectations (`post_hard_or_high_cost` vs. `post_easy_or_rest`) using empirical-Bayes shrinkage (`HEALTH_ANOMALY_ACTIVITY_SHRINKAGE_PRIOR_DAYS = 5`) toward the clean 28-day baseline, populated live by `HealthAnomalyService.assessAndPersist` via `mapRecoverySnapshotToHealthAnomalyFeatures(snapshot, history, { contaminatedDates })`.
* **Pure evaluation (`healthAnomaly.ts`):** `evaluatePhysiologicalAnomaly` outputs a 6-state assessment (`PhysiologicalAnomalyState`) paired with the 3-concept warning model (`anomalySeverity`, `evidenceQuality`, `state`), `calibrationStage` (`HealthAnomalyCalibrationStage`), and 3-level `EarlyResponseProtocol` (`buildEarlyResponseProtocol`):
  * **`insufficient_evidence`:** emitted whenever `availableCoreSignals === 0` (cold start `< 7` clean nights, stale baselines, or unmeasured day) and no illness symptoms are reported — attaching `INSUFFICIENT_WEARABLE_BASELINE_OR_SIGNALS` with `episodeId: null` and `episodeDay: null` rather than false-reassurance `'normal'`.
  * **`emerging_baseline` (`7–13` clean nights):** applies a conservative `+0.5z` deviation penalty and caps unexplained anomalies at `watch_unexplained` (including when adverse channels only have emerging baselines while a normal channel has a reliable baseline).
  * **`reliable_baseline` (`>= 14` clean nights):** applies `VISIBLE_V1_HEALTH_ANOMALY_THRESHOLDS` (`moderateDeviation: 1.5`, `strongDeviation: 2.5`, `allowFirstNightMultiDomainEscalation: true`, `downgradeResolvingRespiration: true`).
  * **RSA / autonomic coupling guard:** Night-1 RHR + HRV co-deviation without elevated respiration is typed as `correlated_autonomic_only` and stays at `watch_unexplained`; reliable Night-1 `multi_domain_corroborated` (`respiration` + `rhr`/`hrv`) can escalate directly to `possible_illness_or_systemic_stress` when all 3 signals are unexplained with `strongUnexplainedCount >= 1`, `strongUnexplainedCount >= 2`, or `strongUnexplainedCount >= 1 && closeSickContact`.
  * **Resolving respiration & confounder decay:** single resolving respiration tail days (`evaluateRespirationElevation` reporting `status === 'resolving'`) are attenuated (`downgradeResolvingRespiration`), and `vaccination` / `medication_change` confounder coverage steps down from `'strong'` to `'moderate'` once `priorAdverseDays >= 2` (Day 3+).
  * **Dual persistence tracking:** `persistenceDays` tracks consecutive days of adverse core physiology (`explained_recovery_strain` or unexplained), whereas `unexplainedPersistenceDays` (`priorUnexplainedDays`) tracks consecutive days with `unexplainedEvidence.length > 0`, kept identical across `HealthAnomalyService` and `runHealthAnomalyReplay`.
* **Stage C personal outcome calibration (`healthAnomalyOutcome.ts`):** `summarizePersonalOutcomeCalibration` scans strictly causal outcome records (`< asOfDate` in `Europe/Warsaw` across `sourceAssessment.date`, `updatedAt`, `symptomOnset.date`, and `respiratoryTest.testedOn`), sets `calibrationEligible: true` (`calibrationStage: 'outcome_calibrated'`) once `priorEpisodesCount >= 3 && resolvedCount >= 3`, and is queried live by `HealthAnomalyService.assessAndPersist` via `healthAnomalyOutcomeRepository.listForUser`.

## Visible UX, Early-Response Protocol, and D-FLAG integration

* **Home early-warning card (`HealthAnomalyCard.tsx`, mounted in `Home.tsx`):**
  * Renders non-diagnostic guidance when physiology warrants attention (`watch_unexplained`, `possible_illness_or_systemic_stress`, `symptoms_reported`, and structured context summaries) without flooding healthy normal days.
  * Displays `anomalySeverity`, `evidenceQuality`, measured channel deltas/explanations, `EarlyResponseProtocol` (`level_1_early_watch`, `level_2_persistent_or_corroborated`, `level_3_symptoms_reported`), IOC consensus red-flag screen + 3-stage return-to-sport (RTS) guidance, explicit `nonDiagnosticNotice`, and inline trigger for `HealthAnomalyFollowupCard` (`followupPromptEligible`).
* **`illness_anomaly` D-FLAG integration (`illnessAnomalyFlag.ts`):**
  * `FlagCaptureService` (`app/src/services/flagCaptureService.ts`), `resolveTodayFlagStripItems` (`app/src/derived/flags/flagStripItems.ts`), `FlagStrip.tsx`, and `buildLedgerExport` (`app/src/ledger/export/buildLedgerExport.ts`) consume live persisted `HealthAnomalyAssessmentRevision` records via `evaluateIllnessAnomalyFlag` instead of clamping to `ha7_release_gate_unmet`.
  * `state === 'insufficient_evidence'` or `availableCoreSignals === 0` maps deterministically to D-FLAG `state: 'missing'`, `reasonCode: 'no_core_signals'`.
  * `D-FLAGS` remain strictly advisory in ledger mode with zero workout veto.

## User-scoped Firestore persistence and rules

`HealthAnomalyService`, `healthAnomalyPersistence.ts`, and `healthAnomalyOutcomeService.ts` persist records strictly scoped to `users/{userId}/` (enforced by `app/rules/07-health-anomalies.rules`):

* `health_anomaly_assessments`: immutable append-only same-day `HealthAnomalyAssessmentRevision` documents (`anomalySeverity`, `evidenceQuality`, `calibrationStage`, `unexplainedPersistenceDays`, `earlyResponse`, `activityMatchedExpectations`, `personalCalibration`, `dataQuality`, `explanations`, `coreSignals`, `supportingSignals`).
* `health_anomaly_episodes`: continuous episode summary records grouping consecutive unexplained/anomaly days (`watch_unexplained`, `possible_illness_or_systemic_stress`, `symptoms_reported`) and pausing cleanly on `'insufficient_evidence'` / `'normal'`.
* `health_anomaly_outcomes`: separate append/update prospective HA6 follow-up documents (`HealthAnomalyOutcomeRecord`: symptoms developed, onset timestamp, optional test result, retrospective explanation attribution) referencing the immutable assessment revision and never mutating past assessment snapshots.

## Shadow diagnostics and deterministic replay

* **Detailed Data panel (`HealthAnomalyShadowPanel.tsx`):** renders when `configuredHealthAnomalyShadowPolicy() !== 'off'`, displaying `HealthAnomalyShadowTrace` (current assessment `state` including the `insufficient_evidence` label, `evidenceLevel`, `mode`, policy versions, active `episodeId` / `episodeDay`, `persistenceDays`, core signal evidence/coverage/age/scale checks, recovery & check-in context, explanations, and residual/supporting evidence) plus `HealthAnomalyFollowupCard`. (`baselineMaturity`, `contaminatedDaysExcluded`, multi-day episode timelines, and replay policy comparison tables live in `HealthAnomalyAssessmentRevision` telemetry and `healthAnomalyReplay.ts` rather than in the Detailed Data UI.)
* **Deterministic replay (`healthAnomalyReplay.ts` and `npm run evidence:health-anomaly`):** `runHealthAnomalyReplay` evaluates historical snapshots deterministically (wiring causal prior symptomatic `contaminatedDates` exclusions across the replay history) using `CANDIDATE_HEALTH_ANOMALY_REPLAY_POLICIES` (`shadow-v1` vs. `VISIBLE_V1_HEALTH_ANOMALY_THRESHOLDS` and variants) and emits `policySummaries` (`HealthAnomalyPolicyReplaySummary`) alongside `renderHealthAnomalyReplayMarkdown` so alert burden, Night-1 multi-domain escalation frequency, resolving-tail reductions, and outcome lead time stay continuously measurable.
