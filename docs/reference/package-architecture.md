# Package Architecture Reference

Detailed routing reference for coding agents and contributors. This inventory was moved out of
the root `AGENTS.md` so always-loaded instructions remain small and the semantic-discovery policy
cannot be pushed beyond conservative client instruction budgets.

**Authority rule:** this file is a routing aid, not a generated manifest. If it disagrees with the
repository tree, the repository tree wins; update this reference when you find drift.

```text
src/garmin_sync/
  config.py            # Typed Settings & validation
  dates.py             # Europe/Warsaw date provider
  models.py            # Schema Version 3 models (ADR-0002); provenance records (ADR-0010)
  canonical.py         # Vendor-neutral canonical metric/activity models
  provider.py          # WearableProvider protocol (vendor-neutral boundary)
  garmin_client.py     # Garmin API wrapper with exponential backoff
  garmin_provider.py   # Garmin adapter; the ONLY module allowed to know Garmin response shapes
  token_store.py       # LocalTokenStore & GcsTokenStore abstraction
  firestore_repository.py # Firestore user-scoped repository
  metrics.py           # Pure baseline and intensity classification math
  mapper.py            # Provider-neutral snapshot assembly over canonical.py types
  archive.py           # Immutable raw payload archive (ADR-0005)
  audit.py             # Sync completeness reporting
  service.py           # Daily sync, backfill, rebuild orchestrator
  coordination.py      # Multi-user ingestion coordination and batch runs
  account_link.py      # Multi-user Garmin account linking and token storage
  account_link_api.py  # Local/remote HTTP API for account linking workflows
  base_api.py          # Shared JSON request-handler base for the link API services
  connection_status.py # Client-visible provider connection status reconciliation (ADR-0029)
  error_reporting.py   # Sanitized error classification/reporting -- never emits health values
  migrate_user_data.py # User-scoped data migration between uids (planned, summarized, redacted)
  workout_export.py    # FIT/TCX workout export integration
  google_health_auth.py     # Google Health OAuth tokens & refresh locking (MS4, ADR-0027)
  google_health_client.py   # Google Health v4 raw list endpoint client (MS5)
  google_health_mapper.py   # Raw v4 data points -> CanonicalHealthObservation + provenance (MS6)
  google_health_provider.py # RecoveryObservationProvider over Google Health (MS3/MS6)
  google_health_account_link.py     # Browser-redirect OAuth account linking for Google Health
  google_health_account_link_api.py # Separate HTTP service for that linking flow
  webhook_receiver.py  # Google Health webhook signature verification & subscriber (MS9)
  health_observation_service.py # Multi-source observation sync, archive & persistence (MS7/MS8)
  health_probe.py      # Google Health source-provenance probe runner (MS0)
  equivalence.py       # Garmin direct vs Google Health transport equivalence analyzer (MS10)
  multisource_audit.py # Multisource coverage/baseline/cross-source shadow audit (MS14)
  presence_filter.py   # @deprecated secondary-source concordance filter; superseded by PI
  identity_eligibility.py   # Fail-closed effective-identity eligibility projection (PI5, ADR-0028)
  identity_replay_export.py # Real-data exporter for the PI8 historical identity replay
  training_occurrence_export.py # #646 TO4 record export + in-memory TO5 FIT identity aggregates
  eight_sleep_config.py    # Configuration for the opt-in direct Eight Sleep transport (ADR-0030)
  eight_sleep_client.py    # Minimal read-only client for Eight Sleep's private API
  eight_sleep_mapper.py    # Eight Sleep trends -> ADR-0027 source-aware observations
  eight_sleep_provider.py  # RecoveryObservationProvider over direct Eight Sleep ingestion
  eight_sleep_probe.py     # Sanitized local probe; never prints secrets or health values
  eight_sleep_equivalence.py # Eight Sleep direct vs Google Health equivalence (ES9)
  fit_activity.py      # Strict in-memory decoding boundary for Garmin FIT downloads (ADR-0031)
  fit_workout_identity.py # Versioned fingerprint for a device-recorded structured workout (ADR-0034)
  hr_fidelity.py       # Shadow-only exercise HR trace fidelity assessment (ADR-0031)
  _hr_fidelity_detectors.py # Deterministic artifact candidates for hr_fidelity (HRF3)
  _hr_fidelity_timing.py    # Timer-window, sampling and coverage primitives for hr_fidelity (HRF3)
  cli.py               # Argument parsing and entry points

app/src/engine/
  models.ts            # Domain models, event schemas, microcycle & strain telemetry
  rules.ts             # Adaptive rules engine (acute/drift strain, mode hierarchy & rationale)
  templates.ts         # Session template catalog & systemic load caps with dual profiles
  validation.ts        # Input schema validators & sanitizers
  schedule.ts          # Multi-layered schedule availability & location context resolution
  periodization.ts     # Structured event demand profiles & continuous phase weighting
  microcycle.ts        # Weekly training objectives & exposure progress tracker
  fatigue.ts           # 6-dimensional fatigue state, exponential decay & internal response
  optimizer.ts         # Benefit vs cost utility optimization candidate selector
  eligibility.ts       # The single hard-gate resolver (time/equipment/environment/guardrails)
  trainingIntent.ts    # Composes periodization + objectives + fatigue + planned dose (ADR-0009)
  trainingHistory.ts   # TrainingHistoryProvider boundary; Firestore impl is injected
  trainingHistorySnapshot.ts # Immutable, revisioned bounded history (ADR-0010)
  completedTraining.ts # Garmin/adherence reconciliation into completed exposures
  dataState.ts         # AVAILABLE / MISSING / INVALID / UNAVAILABLE read semantics
  dose.ts              # Planned dose x clinical ceiling x athlete adjustment
  planner.ts           # Rolling 7-day projection & weekly anchor pre-pass (ADR-0008/0011)
  provenance.ts        # Builds the persisted RecommendationAudit
  replay.ts            # Verifies a persisted decision against its own audit
  decisionContext.ts   # #872: write-once, content-hashed same-day decision-context capture (provenance only, not yet replayable)
  policy.ts            # POLICY_VERSION -- bump when a decision-affecting change lands
  stimulus.ts          # V2 fractional objective credit; the live credit authority (ADR-0014)
  planningMode.ts      # THE single authority for effective planning mode (ADR-0017)
  planSchedule.ts      # PlanDefinition / PlanBlock / plan objective definitions
  planningOverlays.ts  # Authored travel overlays applied to planned dose (ADR-0012)
  planningCandidate.ts # Planner <-> workout-library boundary; per-workout spacing data
  coverage.ts          # Exact weekly programming-role coverage, distinct from credit (ADR-0016)
  weeklyAllocation.ts  # Required weekly-role reservations & typed misses (ADR-0018)
  evergreenPlanning.ts # Evergreen plan resolution entry point (ADR-0017)
  evergreenStrategy.ts # Evidence-backed adaptation dose requirements
  trainingCapacity.ts  # Real sessions/minutes/windows that bound dose packing
  weeklyDosePacking.ts # Maps dose requirements onto exact workout identities
  injuryPolicy.ts      # Structured injury constraints & tissue-response tightening
  taperPolicy.ts       # Event taper window resolution
  safetyCheckin.ts     # Minimum-safety check-in gate & provisional recommendation
  composer.ts          # Decision composer combining readiness, context brief, and intent
  contextBrief.ts      # Recovery context brief; daily (2d, morning) / full (14d, planning) / diagnostic (14d) purposes
  healthAnomaly.ts     # Pure physiological anomaly & possible-illness evaluator (ADR-0025)
  healthAnomalyFeatures.ts # Anomaly-grade baseline feature mappings (RHR/HRV/respiration)
  healthAnomalyOutcome.ts  # Prospective outcome follow-up label resolver
  healthAnomalyReplay.ts   # Historical replay runner for health anomaly telemetry
  externalSession.ts   # Adjudicates ONE imported session on ONE day (ADR-0019). Pure
  externalSessionProfiles.ts # Imported session -> cost/stimulus/GateableSession shim
  externalPlacement.ts # Imported plan -> dates; missed-session proposals
  externalCritique.ts  # Advisory weekly review of a placed plan week (D-CRITIQUE)
  externalPlanHash.ts  # Canonical SHA-256 of a stored revision; replay anchor (D-IMMUT)
  authoredSessionGates.ts # Adjudicates authored occurrences against readiness/gates (ADR-0023)
  scheduleWindows.ts   # ADR-0036 D-WINDOW: versioned athlete schedule windows; structure only
  localInstant.ts      # ADR-0036 D-TIME: local wall-clock -> instant; fails closed on DST gaps
  dailyLedger.ts       # ADR-0036 D-LEDGER: as-of daily minute/systemic-cost accounting boundary
  intradayLedgerInputs.ts # Builds today's LedgerEntry[] from resolved occurrence/execution facts
  fixedActivityLedger.ts  # Adapts a persisted fixed activity to the D-LEDGER accounting boundary
  fixedActivityCostProfile.ts # Shared six-dimension cost reduce over a fixed activity's expectedCost
  intradayBundlePlacement.ts # ADR-0036 D-PLACEMENT: binds a bundle's members to real windows
  intradayReassessment.ts # ADR-0036 D-REASSESS: fresh as-of verdict before a later session starts
  intradayDecision.ts  # ADR-0036 D-AUDIT: write-once intraday decision records & replay verification
  externalRestProvenance.ts # ADR-0035 authored-rest identity, incl. explicit same-day override marker
  recoveryPlacement.ts # ADR-0038: exact recovery identity; product-policy vs authored authority
  recoveryFacts.ts     # ADR-0038 RP2: performed/authored/generated recovery truth derivation
  blockIntent.ts       # ADR-0037: per-objective intent, dose envelopes, protected roles (H5a)
  blockIntentReplay.ts # ADR-0037 D-REPLAY: canonical semantic projection & SHA-256 hash
  progressionReview.ts # ADR-0037: pure report-only progression review; no selection authority (H5b)
  sequenceIntent.ts    # Derived sequencing preference; shapes soft ranking only, never gates
  occupationalLoad.ts  # Physical-work check-in -> occupational strain context (issues #459-461)
  sequenceSearch.ts    # Phase 5.1 beam-search prototype -- measured, NOT in any live path
  shadowAgreement.ts   # Phase 9.0: pure engine-vs-athlete verdict classifier (evidence only)
  shadowLog.ts         # Phase 9.0: pure day-row joiner + CSV renderer for export
  subjectiveBaseline.ts # Phase 9.1: pure recent-vs-long subjective baseline
  subjectiveDriftAudit.ts # Phase 9.7: compact SubjectiveDriftAudit shape + replay validation
  decisionEvidence.ts  # Pure evidence ranking, DoD deltas, boundary classification, confidence tiers
  adapters.ts           # mapSnapshotToEngineInput and the other read-model -> engine input mappers
  validationCore.ts     # Validates untyped external input (raw Firestore docs/client payloads)
  dataConfidence.ts     # Read-confidence classification shared across context/composer
  eventPresets.ts       # Preset user-event -> demand-profile mapping (goalToUserEvent)
  checkinCompletion.ts  # isCompletedSubjectiveCheckin / hasCompletedSubjectiveCheckinForDecision
  fixedActivityIdentity.ts # Resolves a FixedActivity's catalog identity & occurrence key
  firestoreTrainingHistory.ts # Firestore-backed TrainingHistoryProvider implementation
  microcycleHistory.ts  # @deprecated -- import the TrainingHistoryProvider boundary from trainingHistory.ts instead
  sessionChoiceEligibility.ts # Gates select_alternative choice options against resolved injury restrictions (D-MCHOICE)
  contextBriefActivityTelemetry.ts # Per-activity telemetry: full tables (diagnostic) or bounded digest (planning)
  contextBriefPlanningHandoff.ts # Upcoming external-plan/recovery-timeline context for planning handoff
  contextBriefPurpose.ts # Export purposes (morning/planning/diagnostic), section titles, goal/use-instruction renderers
  contextBriefRecovery.ts # Objective wearable + body-composition sections of the context brief
  contextBriefRecoverySynthesis.ts # Explanatory multisignal recovery synthesis for the brief; no decision authority (#812)
  briefPlanAuthority.ts # Reconciles persisted verdict + imported occurrence into one brief authority outcome (#810)
  trainingSettingsSchema.ts # Persisted TrainingSettings schema version gate (current v3, supports v2)
  strengthSessionLifecycle.ts # Strength session state machine (new/in_progress/... transitions)
  strengthSessionValidation.ts # Shared persisted/UI bounds for ADR-0021 strength-session data
  knowledgeLineage.ts   # Sports-knowledge-registry provenance lineage (ADR-0033)
  healthContextDefaults.ts # Canonical defaults for a newly reported health-context block
  healthContextValidation.ts # Health-context/symptom check-in raw-input validator
  healthAnomalyModels.ts # HA domain models: anomaly features, thresholds, rationale, respiration elevation
  respirationElevation.ts # Respiration-elevation status/evidence evaluator feeding healthAnomalyModels
  garminTelemetryEvidence.ts # Power-zone feature extraction & direct-share stimulus candidate (measured, off by default)
  garminTelemetryComparison.ts # compareGarminZoneCredit -- TE-derived vs power-zone credit comparison report
  crossSourceTelemetry.ts # Cross-source sensor agreement/data-quality telemetry (MS13, ADR-0027)
  multisourceBaselines.ts # Source-specific robust 7d/28d median+MAD baseline calculator (MS12, ADR-0024/0027)
  multisourceFusion.ts  # Multi-source recovery evidence fusion evaluator (MS15, ADR-0027)
  coPresenceValidator.ts # @deprecated secondary-source identity/session concordance validator; superseded by PI
  identityFeatures.ts   # Cross-source night/session pairing & physiological relation features (PI2, ADR-0028)
  identityLineage.ts    # Provenance-lineage independence evaluation feeding identity attribution (PI2)
  identityAttribution.ts # Shadow-only ternary physiological-identity evaluator with abstention (PI4)
  identityEligibility.ts # Pre-baseline effective-identity eligibility boundary (PI5, D-PID-PREBASE)
  identityPassport.ts   # Versioned Physiological Identity Passport model + historical bootstrap (PI3)
  identityProvenance.ts # Replay-oriented identity provenance for ADR-0010 recommendation audits (PI6)
  identityReplay.ts     # Historical out-of-sample shadow replay of the PI2/PI3 pipeline (PI8)
  identityReviewUi.ts   # Pure selection/copy/mapping logic for the suspicious-night review UI (PI7)
  activityHrFidelity.ts # getHrUseAuthority -- per-use-case HR authority status (ALLOWED/BOUNDED/OBSERVATIONAL/BLOCKED) (HRF5)
  activityHrFidelityAdapters.ts # HR-dependent field/training-load/effect authority adapters over activityHrFidelity
  activityHrFidelityReplay.ts # Deterministic shadow-only HR-fidelity replay/report over real activity history (HRF7)
  sleepRecoveryEvidence.ts # Sleep-decision-authority evidence evaluator (2026-08-29 sleep-decision-authority plan)
  performedTrainingFacts.ts # Canonical occurrence -> facts & weekly role credit derivation (ADR-0034)
  strengthSpacingPolicy.ts # Pure resistance training spacing & recovery candidate suppression
  simulation/          # Scenario harness: runAllScenarios, decision-quality metrics, drift comparisons
  testing/             # Adversarial PRNG generators & property testing runner
  tests/safety/        # Adversarial domain scenarios, safety invariants, wellness language audit

app/src/sessions/
  models.ts            # Source-neutral session definitions, prescriptions, occurrences, executions
  validation.ts        # Canonical schema validators for definitions, prescriptions, occurrences, entries
  sessionDefinitionResolver.ts # Pinned revision / occurrence resolution and hash verification
  sessionDefinitionHash.ts # Canonical SHA-256 content hashing of definition and prescription
  sessionDefinitionDiff.ts # M3.7: fine-grained content diff between two definition revisions
  inputProfiles.ts     # Input card profiles (repetition, duration, distance, check-offs, gauges)
  performedComparison.ts # Planned vs completed steps, volume, omissions, hold duration
  legacyStrengthAdapter.ts # Two-way bridge between legacy strength_sessions and session_executions
  catalogSessionAdapter.ts # Adapts catalog templates to source-neutral SessionDefinition
  canonicalWorkoutAdapter.ts # Adapts canonical (Garmin/import) workouts to SessionDefinition
  externalPlanV2.ts    # M3.6: external-plan@2 imported-plan envelope
  externalSessionAdapter.ts # Imported external session -> SessionDefinition shim
  externalPlanV3.ts    # external-plan@3 (ADR-0035) -- adds plan-level `restDays` directives
  externalPlanV4.ts    # external-plan@4 (ADR-0036 D-SCHEMA) -- adds session-level `intraday` requests
  externalPlanAny.ts   # Type-only union across v2/v3/v4, kept separate to avoid an import cycle
  restEventTiming.ts   # Pure start/adjust/close transitions for one performed rest interval
  choiceResolution.ts  # Athlete-facing effective view from recorded branch-point choices (D-MCHOICE)
  groupProgression.ts  # Repeating-rotation execution-mode step sequencing
  occurrenceReconciliation.ts # M4.3: companion occurrence identity & duplicate reconciliation
  sessionDraft.ts       # In-progress authored-definition draft field mutations
  sessionLaunch.ts       # Persisted definition + immutable execution snapshot pairing to run it
  restTiming.ts          # Advisory rest countdown resolution after a logged entry
  loadDisplay.ts         # Human-readable, source-neutral load copy (never resolves to kg)
  stepDisplay.ts         # Athlete-facing step label fallback order (title -> exercise name -> id)

app/src/responses/
  models.ts             # M5.1: SessionResponse linkage & non-tissue session facts (ADR-0023 D-MRESP)
  validation.ts         # Pure SessionResponse validator; self-contained, distinct lifecycle from sessions/
  followupSchedule.ts   # M5.2: which body regions a completed session's movements make worth follow-up
  outcome.ts             # M5.3: deriveSessionOutcome -- passed/caution/reactive/unknown evidence summary
  outcomeReport.ts       # M5.3: deterministic report/export over SessionOutcome[]

app/src/observations/
  models.ts             # Canonical metric observation definitions, series, and attempts
  validation.ts         # Strict observation schema validators and comparability gates
  identityModels.ts     # Physiological Identity Passport & measurement-trust contracts (PI1, ADR-0028)
  protocols.ts           # Testing-protocol definitions consumed by the observation registry
  registry.ts             # Observation/protocol lookup and registration
  observationCanonical.ts # Canonicalization of raw observation input into the shared model
  manualAdapter.ts        # Manually-entered observation -> canonical model adapter
  reliability.ts          # Evidence-provenance reliability metadata (source + statistic, not a probability model)
  performanceTestingCatalog.ts # Catalog of structured performance-testing protocols
  progress.ts             # Series comparison and true-change interpretation against noise thresholds
  testingWorkflow.ts      # Testing-session workflow state machine
  comparability.ts        # Canonical comparison-series construction & comparability gate

app/src/outcomes/
  evaluationSpec.ts       # OV: OutcomeEvaluationSpec/metric-binding contracts & validators
  evaluationHash.ts       # OV: canonical content hash of an outcome evaluation snapshot
  blockOutcome.ts         # OV: deriveBlockOutcome -- on_track/mixed/off_track/insufficient_evidence verdict
  blockOutcomeReport.ts   # OV: block outcome -> CSV/JSON export + metric progress rows
  blockProcessEvidence.ts # OV: deriveBlockProcessEvidence -- key-role/completed-session process evidence
  feedbackLoopEvidence.ts # OV: deriveFeedbackLoopEvidence -- decision-action & counterfactual-regret counts
  policySegments.ts       # OV: policy-version/planning-mode segment bookkeeping for evaluation windows

app/src/knowledge/
  sportsKnowledge.ts   # Core schema, validation, and foundational load/intensity/readiness claims (ADR-0033)
  sportsKnowledgeRegistry.ts # Canonical aggregate registry of all Git-backed domain knowledge modules
  knowledgeCoverage.ts # 54-family engine coverage inventory, classification, and research backlog (SKR2)
  optimizerScoringKnowledge.ts # Product-policy claims for candidate selection and fatigue/stimulus weights (SKR3 W2a)
  stimulusHeuristicsKnowledge.ts # Product-policy claims for stimulus credit, fatigue fusion, and planning priors (SKR3 W2b)
  periodizationEventDemandKnowledge.ts # Scientific boundaries and product presets for periodization (SKR3 W1)
  injuryPainKnowledge.ts # Tissue-response, severity scaling, and standing injury restriction claims (SEP)
  readinessCardiorespiratoryKnowledge.ts # RHR and respiration monitoring claims
  subjectiveReadinessKnowledge.ts # Subjective readiness claims + mode-threshold policy claims
  strengthConcurrentKnowledge.ts # Concurrent strength/endurance performance & sequencing claims
  strengthWarmupKnowledge.ts # General and specific warm-up protocol claims
  taperFuelingKnowledge.ts # Pre-event taper boundaries and fueling/hydration claims
  athleteEvidence.ts   # Identity-scoped athlete-specific evidence contracts, domain models, and validator (SKR4)
  athleteEvidencePolicy.ts # Pure policy refinement engine and safety monotonicity evaluator (SKR4)
  knowledgeFreshness.ts # Deterministic review-cadence classification and due/stale reporting (SKR5)
```

**Before changing engine behaviour**, read `docs/architecture/recommendation-engine.md`
(the two selection paths) and the relevant ADR. Known divergences between the ADRs and the
code are tracked in `docs/analysis/2026-08-08-architecture-review.md`, with remediation
sequenced in `docs/plans/`.

---

See [`AGENTS.md`](../../AGENTS.md) for the always-on workflow, semantic-navigation routing,
verification contract, and documentation precedence.
