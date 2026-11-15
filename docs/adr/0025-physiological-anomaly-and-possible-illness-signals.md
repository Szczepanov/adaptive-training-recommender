# ADR-0025: Physiological anomaly and possible-illness signals

* **Status:** Accepted (2026-08-21); Amended 2026-11-15 (HA7 two-tier release gate, Stage A–C calibration architecture, `visible-v1` unlock)
* **Date:** 2026-08-21 (amended 2026-11-15)
* **Deciders:** Core Engineering Team
* **Related decisions:** [ADR-0024](./0024-biometric-baseline-estimator-policy.md), [ADR-0052](./0052-user-ledger-and-external-ai-planning-authority.md)
* **Release audit:** [2026-11-15 HA7 visible early-warning release decision](../analysis/2026-11-15-ha7-visible-early-warning-release-decision.md)

---

## Context

The application already combines subjective readiness with Garmin-derived sleep, RHR, HRV,
respiration, activity/load and recovery metrics. It also collects an explicit
`illnessSymptoms` flag. That flag protects a user who already feels ill, but the application
currently has no user-facing capability for a **pre-symptomatic physiological anomaly**.

Wearable research supports the possibility of detecting infection-associated physiological
changes before symptoms in some users. The same literature also shows a substantial
specificity problem: hard training, poor sleep, psychological stress, alcohol, travel and
other disruptions can create the same RHR/HRV/respiration pattern.

ADR-0006/ADR-0024 deliberately keep the current respiration strain path default-off because a
respiration weight inside the training-strain score has not been calibrated. That remains the
correct decision. This ADR does not enable that path. It defines a separate health-anomaly
capability whose output can be evaluated, explained and calibrated independently from the
training-readiness score.

Evidence review and repository audit:

* [`../analysis/2026-08-21-physiological-anomaly-and-illness-risk-research.md`](../analysis/2026-08-21-physiological-anomaly-and-illness-risk-research.md)
* ADR-0006 — reconciled strain telemetry
* ADR-0010 — decision provenance and replay
* ADR-0014 — evidence before live policy cutover
* ADR-0020 — subjective-baseline evidence discipline
* ADR-0024 — metric-specific biometric baseline policy

---

## Decision

### 1. Build a separate physiological-anomaly evaluator

The engine will gain a pure, deterministic evaluator conceptually named
`evaluatePhysiologicalAnomaly`.

It is **not** part of `metricStrain` and does not initially change recommendation mode.

The evaluator produces a versioned, explainable assessment with at least:

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

interface PhysiologicalAnomalyAssessment {
  state: PhysiologicalAnomalyState;
  evidenceLevel: 'none' | 'low' | 'moderate' | 'high';
  anomalySeverity: HealthAnomalySeverity;
  evidenceQuality: HealthAnomalyEvidenceQuality;
  calibrationStage: HealthAnomalyCalibrationStage;
  coreSignals: CoreSignalEvidence[];
  supportingSignals: SupportingSignalEvidence[];
  explanations: ContextExplanation[];
  unexplainedEvidence: string[];
  persistenceDays: number;
  unexplainedPersistenceDays?: number;
  earlyResponse: EarlyResponseProtocol;
  activityMatchedExpectations?: ActivityMatchedSignalExpectation[];
  personalCalibration?: PersonalOutcomeCalibrationSummary | null;
  dataQuality: AssessmentDataQuality;
  policyVersion: string;
}
```

#### 2026-11-15 Amendment — Three-stage calibration architecture & three-concept warning model

To replace the original catch-22 cutover gate and eliminate six runtime correctness defects documented in [the 2026-11-15 HA7 release decision](../analysis/2026-11-15-ha7-visible-early-warning-release-decision.md), the evaluator operates across three calibration stages (`HealthAnomalyCalibrationStage`):

1. **Stage A — Personal baseline readiness:**
   * **`insufficient_evidence` (`< 7` clean observations or `availableCoreSignals === 0`):** when all three core channels are `unavailable` and no illness symptoms are reported, emit `state: 'insufficient_evidence'` (with caution `INSUFFICIENT_WEARABLE_BASELINE_OR_SIGNALS`, `episodeId: null`, `episodeDay: null`) rather than false-reassurance `'normal'`.
   * **`emerging_baseline` (`7–13` clean observations):** evaluates wearable deviations with a conservative `+0.5z` threshold penalty and caps unexplained escalation at `watch_unexplained`.
   * **`reliable_baseline` (`>= 14` clean observations within 28 days):** enables full `VISIBLE_V1_HEALTH_ANOMALY_THRESHOLDS` sensitivity.
2. **Stage B — Contamination protection & activity-matched adaptation:**
   * Causally excludes strictly prior symptomatic nights (`< currentDate`) via `contaminatedDates` (currently wired into `runHealthAnomalyReplay`) while preserving at least `HEALTH_ANOMALY_EMERGING_BASELINE_OBSERVATIONS` clean nights.
   * Computes empirical-Bayes shrunk `activityMatchedExpectations` (`post_hard_or_high_cost` vs. `post_easy_or_rest`) live in `HealthAnomalyService.assessAndPersist` via `mapRecoverySnapshotToHealthAnomalyFeatures(snapshot, history)` so expected post-exercise shifts are attributed cleanly rather than conflated with systemic anomalies.
3. **Stage C — Causal personal outcome calibration:**
   * `summarizePersonalOutcomeCalibration` is implemented as a pure calibration/schema helper aggregating strictly causal prior outcome records (`< asOfDate`), reporting `calibrationEligible: true` (`outcome_calibrated`) only after `priorEpisodesCount >= 3 && resolvedCount >= 3` (not yet queried live by `HealthAnomalyService`).

Every visible assessment separates **`anomalySeverity`** (deviation strength), **`evidenceQuality`** (`insufficient | emerging | single_channel | correlated_autonomic_only | multi_domain_corroborated`), and **`state`** (`PhysiologicalAnomalyState`), paired with a structured 3-level **`EarlyResponseProtocol`** (`none`, `level_1_early_watch`, `level_2_persistent_or_corroborated`, `level_3_symptoms_reported`) embedding IOC consensus red-flag warnings and staged return-to-sport guidance.

Exact TypeScript names may change during implementation. The semantic separation may not.

### 2. Core physiological channels are RHR, respiration and HRV

The initial independent anomaly channels are:

1. resting heart rate;
2. respiration rate;
3. HRV.

Each is interpreted relative to the athlete's own baseline and only when data coverage is
sufficient.

Estimator details remain governed by ADR-0024. In particular:

* respiration may use the median/MAD candidate when its version/coverage requirements hold;
* RHR must compare appropriate robust/mean/EWMA candidates rather than assuming one estimator;
* HRV must compare current raw-domain behavior with a log-domain candidate and must not assume
  that raw-domain median/MAD is automatically correct.

Thresholds, weights and persistence windows are versioned policy, not physiological facts.

#### Deterministic coverage rules

`evaluatePhysiologicalAnomaly` must apply the following minimum-data rules before it scores any
channel, so that `watch_unexplained` and `possible_illness_or_systemic_stress` never rest on
data the evaluator effectively fabricated:

* **Minimum observations** — each channel requires a baseline window with at least the
  observation count ADR-0024 defines for its estimator (for example the v3+ respiration
  median/MAD minimum). Fewer observations produces `CoreSignalEvidence.status = 'unavailable'`
  for that channel, never `'normal'`.
* **Baseline age** — a baseline older than its policy-defined refresh window is treated as stale
  and downgrades the channel to `unavailable` rather than being scored against a stale
  reference.
* **Missing or failed-quality current value / cold start** — a missing, non-finite, or quality-flagged current value produces `unavailable` for that channel. `unavailable` is evidence-neutral: it must not be interpreted as `normal` and must not silently drop out of the multi-signal count. When all three core channels are `unavailable` and no illness symptoms are reported, `evaluatePhysiologicalAnomaly` must emit `state: 'insufficient_evidence'` rather than `'normal'`.
* **Evidence required for `watch_unexplained`** — at least one core channel at `moderate_anomaly` or stronger with `status != 'unavailable'` (or emerging-baseline conservative threshold `+0.5z`), and no explanation strong enough to cover it; Night-1 `correlated_autonomic_only` (RHR + HRV without respiration) also caps at `watch_unexplained`.
* **Evidence required for `possible_illness_or_systemic_stress`** — requires `reliable_baseline` maturity (`>= 14` clean nights) and either multi-day unexplained persistence (`unexplainedPersistenceDays >= persistenceDaysForEscalation` with multi-signal qualification) or, under `VISIBLE_V1_HEALTH_ANOMALY_THRESHOLDS.allowFirstNightMultiDomainEscalation`, a first-night **`multi_domain_corroborated`** cardiorespiratory pattern (`respiration` + `rhr`/`hrv`) reaching strong deviation or moderate deviation paired with `closeSickContact`. A single-channel anomaly, however strong, cannot alone reach `possible_illness_or_systemic_stress`.
* Resolving respiration trajectories (`evaluateRespirationElevation` reporting `status === 'resolving'`) are attenuated when `downgradeResolvingRespiration` is enabled so 28-day median lag does not extend recovery tails; Day 3+ acute vaccination/medication confounders (`priorAdverseDays >= 2`) cap at `'moderate'` coverage.
* Exact minimum-observation counts, baseline windows, and `minimumCoreSignalsForMultiSignal`/`persistenceDaysForEscalation` values are versioned policy calibrated via replay and Stage C outcome tracking, not fixed constants in UI code.

### 3. Garmin composite metrics are supporting/context signals, not independent votes

Sleep Score, Body Battery, Garmin stress, HRV Status and Training Readiness share upstream
information. The evaluator must not add them as if each were an independent sensor channel.

They may be used to:

* describe recovery state;
* corroborate a broad systemic-stress pattern;
* explain why the existing readiness engine is conservative;
* improve user-facing rationale.

They must not manufacture high illness confidence by double-counting shared HRV/sleep/stress
inputs.

#### The bound on `supportingSignals`

`supportingSignals` are explanatory/contextual only. They:

* may adjust `explanations` and user-facing rationale;
* must not raise `evidenceLevel`;
* must not count toward `minimumCoreSignalsForMultiSignal`;
* must not independently trigger a transition to `possible_illness_or_systemic_stress`.

Only `coreSignals` (RHR, respiration, HRV) can satisfy the multi-signal qualification for
`possible_illness_or_systemic_stress`. A future revision that wants a supporting signal to
contribute a bounded amount of evidence requires a versioned, explicitly capped contribution
defined in a follow-up ADR/policy revision, not an implicit weight inside the evaluator.

### 4. Known alternative explanations are first-class structured inputs

The evaluator explicitly represents plausible non-infectious explanations rather than
subtracting undocumented points from an illness score.

#### Automatically derived context

Use existing data wherever possible:

* recent hard/very-hard training and completed-session cost;
* sleep duration/score and existing subjective sleep quality;
* Garmin/subjective stress;
* structured authored travel context;
* activity/steps change.

Do not ask the user to re-enter facts the app already knows.

#### Compact optional check-in context

Extend the daily check-in with structured fields for the most important remaining
confounders/priors:

* alcohol in the previous 24 h (`0`, `1`, `2`, `3+` drinks);
* unplanned travel / jet lag / unusually late arrival;
* unusual heat/sauna exposure;
* dehydration / significant fluid loss;
* recent vaccination or medication change;
* known close sick contact / household illness;
* optional `other disruption` note.

The exact UX may collapse these behind an "Anything unusual since yesterday?" row. Absence of
an answer means **unknown**, not `false`, unless the user explicitly submits `none`.

### 5. Explicit symptoms stay authoritative and tighten-only

`illnessSymptoms` remains a direct safety input. A user reporting illness symptoms must not
be made more permissive because wearables look normal.

The anomaly capability may eventually add detail to symptom reporting (symptom type, severity,
onset), but it must preserve the existing conservative semantics.

### 6. No disease diagnosis and no pseudo-probability

Before calibration, user-visible output must not say:

* "you have an infection";
* "you are getting COVID/flu";
* "72% chance you are sick" or any other unvalidated percentage.

Approved semantics are:

* **insufficient evidence** — fewer than `HEALTH_ANOMALY_EMERGING_BASELINE_OBSERVATIONS` (`7`) clean nights, stale baselines, or zero core channels measured today without symptoms; never masked as `normal`;
* **normal** — measured wearable channels sit within personal expectations and no symptoms are reported;
* **explained recovery strain** — physiology is altered but known training/recovery context is a plausible explanation;
* **unusual physiology — watch** — one or more signals are unusual (including Night-1 `correlated_autonomic_only` or emerging-baseline deviations) and no strong explanation is present;
* **possible illness or systemic stress** — a `multi_domain_corroborated` or multi-day persistent unexplained pattern resembles systemic stress/illness patterns seen in wearable studies;
* **symptoms reported** — the athlete has explicitly reported illness symptoms.

`possible illness` is a hypothesis label, never a diagnosis.

### 7. Confounders change explanation, not truth

Hard training, alcohol, travel or poor sleep do not make an observed RHR/HRV/respiration
change disappear. The assessment records both:

1. the physiological anomaly evidence; and
2. how much of that pattern is plausibly explained by known context.

For example, RHR up + HRV down after a very hard session with normal respiration can be
classified as `explained_recovery_strain`. The same pattern plus persistent elevated
respiration on a subsequent easy/rest day can escalate because the original explanation no
longer covers the whole observation.

This avoids the false precision of arbitrary "-2 illness points for hard training" logic.

### 8. Persistence is a separate evidence dimension

A single anomalous night and a multi-night pattern are not equivalent.

The evaluator tracks both consecutive adverse core-physiology days (`persistenceDays`) and consecutive unexplained anomaly days (`unexplainedPersistenceDays`) consistently across live evaluation (`HealthAnomalyService`) and deterministic replay (`runHealthAnomalyReplay`). Persistent unexplained patterns escalate `watch_unexplained` to `possible_illness_or_systemic_stress`, while `multi_domain_corroborated` patterns (`respiration` + `rhr`/`hrv`) can qualify on Night 1 under `VISIBLE_V1_HEALTH_ANOMALY_THRESHOLDS.allowFirstNightMultiDomainEscalation` without diluting `persistenceDays` semantics.

### 9. Rollout is staged (advisory `visible-v1` active; `tighten-v1` gated)

Add a policy selector with semantics equivalent to:

```ts
type HealthAnomalyPolicy =
  | 'off'
  | 'shadow-v1'
  | 'visible-v1'
  | 'tighten-v1';
```

* `off` — no evaluator/output.
* `shadow-v1` — compute/persist/debug only; no user-facing alert and no training change.
* `visible-v1` — default active policy as of 2026-11-15: shows non-diagnostic anomaly severity, evidence quality, explanations, the 3-level early-response protocol, and unlocks the advisory `illness_anomaly` D-FLAG without exercising any workout veto.
* `tighten-v1` — a validated alert may tighten training decisions, never loosen them. **Remains inactive:** `resolveConfiguredHealthAnomalyRuntimePolicy` clamps any configured `'tighten-v1'` to `'visible-v1'` until HA9 validation unlocks it.

Original HA0–HA6 development started at `'off'` / `'shadow-v1'`; following the 2026-11-15 HA7 two-tier redesign, unset production environments default to `'visible-v1'` while explicit `'off'` and `'shadow-v1'` remain available for opt-out or diagnostic replay, and `'tighten-v1'` stays fail-safe clamped to `'visible-v1'`.

#### Privacy, retention and access controls

`shadow-v1` persistence is still collection of sensitive health and behavioral data and is
governed by these controls from the moment it is enabled, not only at `visible-v1`:

* **Purpose limitation and consent** — health-anomaly data is collected only to compute and
  explain this athlete's own assessment. No cross-user aggregation, model training on other
  users, or secondary use without separate explicit consent.
* **Field minimization** — only the fields listed in this ADR and the implementation plan (core
  signal values, structured explanations, optional check-in context, symptom detail, outcome
  label) may be persisted. Do not persist raw wearable payloads beyond what §11 requires for
  replay.
* **Free-text bounds and redaction** — `otherDisruption` and any free-text note is
  length-bounded, stored as opaque user content, excluded from server logs/telemetry, and never
  used as evaluator input beyond presence/absence.
* **Retention and deletion** — assessment revisions, check-in context and outcome labels follow
  the repository's existing user-data retention/deletion path (ADR-0002 user scoping);
  deleting a user's data deletes health-anomaly records with it. A default retention window is
  set as versioned policy, not left unbounded.
* **Authorized access** — reads are scoped to the owning user via existing Firestore
  user-isolation rules (ADR-0002); no service role reads across users outside an explicit,
  audited operational need.
* **Export minimization** — the HA5.3 replay/evidence tooling reads only the fields it needs
  and must not bulk-dump raw check-in free text or cross-user data.
* **Logging redaction** — application/error logs must not include raw symptom text, free-text
  disruption notes, or other identifiable health context; log structured codes/enums only.
* **Outcome labels are stored separately from the live assessment record.** A follow-up label
  (§12) is a distinct, separately timestamped append/update event, never a mutation of the
  original assessment revision, and it must never be read by the live evaluator or by
  point-in-time replay of an earlier date — only by later analysis/calibration tooling that is
  explicitly reading history.

### 10. Training integration, when eventually enabled, is tighten-only

A future validated high-confidence state may suppress/defer hard or maximal work.

It must never:

* turn `recover` into `modify/train`;
* relax pain/injury restrictions;
* override explicit illness symptoms in a permissive direction;
* add intensity because the anomaly score is low.

The existing readiness/safety envelope remains the training authority. Health anomaly is an
additional conservative gate only after evidence authorizes `tighten-v1`.

### 11. Every assessment is replayable and attributable

Persist enough provenance to reconstruct why an assessment occurred:

* date/time and policy version;
* baseline computation versions;
* raw/current values used;
* standardized/personal-baseline deviations;
* data coverage/quality;
* automatically derived hard-training/sleep/stress/travel context;
* user-entered context;
* symptoms;
* persistence/episode state;
* state transitions;
* eventual follow-up label when available;
* **source-level replay inputs**, specifically:
  * the source record's date/timestamp for every input used (Garmin recovery-snapshot date,
    check-in date, and any revision/sync identifier those records carry);
  * the evaluation timezone (`Europe/Warsaw` local date, per repository convention);
  * the exact evaluation window boundaries used per channel (baseline window start/end,
    persistence-lookback window);
  * the exact estimator inputs — which estimator/version produced each baseline and scale, and
    the raw sample count/coverage that estimator consumed.

Assessment time, values and policy versions alone do not identify which observations were used.
Late Garmin syncs, corrected samples, local-date changes, or baseline backfills can silently
change what a naive recomputation sees, so the source-level fields above must be persisted
independently of any aggregate revision number.

Same-day recomputation must follow the append-only revision principles from ADR-0010 rather
than overwriting the history that produced an earlier alert. Reuse ADR-0010's immutable
revision fields where they directly apply, but do not rely on ADR-0010's aggregate decision
revision alone to reconstruct which source observations fed a given assessment — persist the
source-level identifiers above so an assessment stays deterministically replayable regardless of
what happens to unrelated decision state.

### 12. Prospectively learn the athlete's alternative explanations and outcomes

After an anomaly episode, the product may ask a low-friction follow-up such as:

* symptoms developed;
* no illness developed;
* hard training likely explained it;
* alcohol;
* travel/jet lag;
* poor sleep/stress;
* heat/dehydration;
* unknown/other.

This label is evidence, not ground truth unless supported by a test/diagnosis. It enables
later personal calibration and activity/context-matched expected-response models.

No personalised ML model is approved by this ADR. Deterministic versioned rules come first;
ML becomes a separate decision when enough labelled history exists.

---

## User-facing severity semantics and early-response protocol

| Early-Response Level | State | Example message | Training effect (`visible-v1` vs. `tighten-v1`) |
|---|---|---|---|
| `none` | `insufficient_evidence` | "Not enough baseline wearable data yet — continuing passive collection." | none (`illness_anomaly` D-FLAG reports `missing` / `no_core_signals`) |
| `none` | `normal` | No health alert. | none |
| `none` | `explained_recovery_strain` | "Your recovery signals are off baseline, but yesterday's hard training / short sleep is a plausible explanation." | none beyond existing readiness / athlete discretion |
| `level_1_early_watch` | `watch_unexplained` | "Early physiology watch — mild/single-channel or Day-1 autonomic shift without a clear confounder. Stay hydrated, monitor how you feel, and avoid forcing maximal strain." | advisory only (`visible-v1`); zero automatic veto |
| `level_2_persistent_or_corroborated` | `possible_illness_or_systemic_stress` | "Multi-domain or persistent physiological anomaly without a clear training/lifestyle explanation. Consider easing intensity to aerobic/recovery work, check red-flag symptoms, and reassess tomorrow." | advisory only in `visible-v1`; plan tightening remains gated behind HA9 (`tighten-v1`) |
| `level_3_symptoms_reported` | `symptoms_reported` | "You reported illness symptoms. Prioritize rest, monitor IOC red-flag symptoms (fever, chest pain, disproportionate breathlessness, systemic aches), and follow staged return-to-sport before resuming hard work." | conservative symptom safety handling active; zero permissive override |

The detail view shows **`anomalySeverity`**, **`evidenceQuality`**, and **`why`** (for example `RHR +6 bpm vs baseline`, `respiration +1.8 br/min`, `HRV below normal range`, `2nd night`, `no hard session`), alongside structured explanations (`short sleep`, `2 drinks`, `post-hard training`) and prospective 24–72h outcome capture (`HealthAnomalyFollowupCard`).

---

## Evidence required before each cutover

### `off` -> `shadow-v1`

Requires only implementation correctness, data-quality gates, tests and no production
behavior change.

### Tier 1 (`shadow-v1` -> `visible-v1` — Redesigned 2026-11-15 HA7 Gate)

The original 2026-08-21 gate required both `>= 60` observed days and `>= 5` distinct anomaly episodes before entering `visible-v1`. As audited in [the 2026-11-15 HA7 release decision](../analysis/2026-11-15-ha7-visible-early-warning-release-decision.md), requiring five personal illness/anomaly episodes conflated physiological baseline readiness with illness incidence and permanently locked out healthy athletes (while forcing `flagCaptureService` and `buildLedgerExport` to hardcode `ha7_release_gate_unmet`).

Under the **2026-11-15 Two-Tier Gate Redesign**, **Tier 1 (`visible-v1` + advisory `illness_anomaly` D-FLAG)** is authorized on **per-athlete Stage A/B physiological baseline readiness + safety-guard compliance** rather than prior illness episode count:

* **Personal baseline readiness:** `emerging_baseline` (`>= 7` clean nights via `HEALTH_ANOMALY_EMERGING_BASELINE_OBSERVATIONS`, applying conservative `+0.5z` deviation thresholds and capping unexplained alerts at `watch_unexplained`) -> `reliable_baseline` (`>= 14` clean nights within the 28-day window); `< 7` clean nights or zero core signals emits explicit `insufficient_evidence`.
* **Contamination & activity hygiene (Stage B):** strictly prior symptomatic nights are excluded causally from rolling baselines while empirical-Bayes activity-matched shrinkage (`HEALTH_ANOMALY_ACTIVITY_SHRINKAGE_PRIOR_DAYS`) reduces post-training false positives.
* **Non-diagnostic & advisory bounds:** UI and D-FLAGS remain strictly non-diagnostic (zero PPV pseudo-probabilities, explicit `nonDiagnosticNotice`), adhere to [ADR-0052](./0052-user-ledger-and-external-ai-planning-authority.md) zero-veto advisory authority, embed IOC consensus red-flag / 3-stage RTS boundaries, and collect HA6 prospective outcomes (`summarizePersonalOutcomeCalibration`).
* **Ongoing telemetry & rollback:** `runHealthAnomalyReplay` (`policySummaries`) continues monitoring alert rate per 30 days, multi-domain corroboration rate, context-explained fraction, and outcome conversion; any unacceptable false-alarm spike can revert runtime policy via environment selector (`shadow-v1` or `off`) without code edits.

### Tier 2 (`visible-v1` -> `tighten-v1` — Remains Gated Behind HA9)

Automatic training restriction (`tighten-v1`) remains **inactive** (`resolveConfiguredHealthAnomalyRuntimePolicy` clamps `'tighten-v1'` to `'visible-v1'`). Authorizing autonomous training tightening requires evidence that the gate improves safety/decision quality without causing an unacceptable rate of unnecessary hard-session suppression, backed by actual recommendation flips and athlete outcomes. Synthetic scenarios alone cannot authorize this cutover.

#### Numeric gate and ownership

* **Minimum observation window:** at least 90 observed days in `visible-v1` with recorded
  athlete-facing alerts, covering at least 3 distinct anomaly episodes with a recorded outcome
  label (§12/HA6).
* **Confidence requirement:** report actual recommendation flips (how often the gate would have
  changed the training recommendation) and their outcomes; unnecessary hard-session suppression
  (episodes later explained as non-illness) must not exceed a stated versioned ceiling
  (candidate starting point: no more than 1 in 5 suppressions retrospectively found
  unnecessary).
* **Decision owner:** the engineering owner recorded in this ADR's `Deciders` field approves the separate Tier-2 / HA9 training-gate report before `tighten-v1` can ever be un-clamped.
* **Rollback condition:** if `tighten-v1` produces recommendation flips later judged
  unnecessary at a rate exceeding the stated ceiling over any rolling 30-day window, the policy
  selector reverts to `visible-v1` immediately and a corrective report is required before
  re-attempting `tighten-v1`.

The candidate numeric ceilings above are starting points for the HA9 training-gate report to confirm or refine with real outcome data rather than subjective cutoffs.

---

## Consequences

### Positive

* Adds the pre-symptomatic capability the product currently lacks without pretending a
  consumer wearable is a diagnostic device.
* Uses the repository's rich training context to address the strongest known false-positive
  source rather than ignoring it.
* Adds alcohol/travel/other context only where the app cannot infer it itself.
* Keeps correlated Garmin composites from multiplying confidence.
* Produces an explainable assessment that can be replayed and personally calibrated.
* Preserves existing conservative symptom/injury behavior.

### Negative

* Requires another versioned policy/evidence pipeline instead of a simple respiration weight.
* Optional check-in context increases schema and UX complexity.
* Prospective validation takes time because true illness episodes are sparse.
* A single-athlete model may never support a well-calibrated disease probability; categorical
  anomaly messaging may remain the correct long-term product.

---

## Rejected alternatives

### Enable `RespirationStrainPolicy='median-mad-v1'` in production

Rejected. It changes training strain without solving illness attribution and without the
replay evidence ADR-0024 requires.

### One aggregate "illness score" from every Garmin metric

Rejected. It double-counts overlapping Garmin composites and hides why the score changed.

### Treat hard training/alcohol/travel as simple negative points

Rejected. Those factors explain specific signal patterns with different strengths and time
courses. A traceable explanation model is preferable to undocumented score subtraction.

### Train a classifier immediately

Rejected. The repository does not yet have enough prospective, personally labelled illness
and confounder episodes to justify model complexity or calibrated probabilities.

---

## References

Research synthesis, release decision, and direct links are maintained in:

* [`../analysis/2026-08-21-physiological-anomaly-and-illness-risk-research.md`](../analysis/2026-08-21-physiological-anomaly-and-illness-risk-research.md)
* [`../analysis/2026-11-15-ha7-visible-early-warning-release-decision.md`](../analysis/2026-11-15-ha7-visible-early-warning-release-decision.md)
