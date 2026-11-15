# Health anomaly and possible-illness alerting

* **Capability:** HA
* **Status:** **Partially complete (`visible-v1` + `illness_anomaly` D-FLAG live; `tighten-v1` / HA9 gated)**
* **Implementation status:** HA0/HA1 (`#162`, `#168`), HA2–HA4 (`#166`, `#165`), HA5 (`#171`, `#173`), and HA6.1–HA6.3 (`#174`) are merged on `main`. On 2026-11-15 (`feat/health-anomaly-visible-early-warnings`), the HA7 two-tier release decision unlocked Tier 1 **`visible-v1`** (default runtime policy, Stage A–C calibration scaffolding, 3-level early-response protocol, `HealthAnomalyCard` on `Home`, live `illness_anomaly` D-FLAG capture/strip/export, and HA6 follow-up prompt eligibility).
* **Blocked by:** Tier 1 (`visible-v1`) is unblocked and shipped. Tier 2 **HA9** (`tighten-v1` automatic training-plan restriction) remains blocked on prospective labelled outcome evidence (`>= 90` observed days in `visible-v1` and `>= 3` outcome-labelled episodes) and [ADR-0052](../adr/0052-user-ledger-and-external-ai-planning-authority.md) authority review.
* **Unlocks:** non-diagnostic pre-symptomatic physiological early warnings (`visible-v1`); live `illness_anomaly` D-FLAG telemetry; prospective athlete-specific calibration; later HA9 `tighten-v1` review
* **Decision:** [ADR-0025](../adr/0025-physiological-anomaly-and-possible-illness-signals.md) (partially superseded by [ADR-0054](../adr/0054-ha7-visible-early-warning-release-gate.md))
* **Release Decision:** [2026-11-15 HA7 visible early-warning release decision](../analysis/2026-11-15-ha7-visible-early-warning-release-decision.md)
* **Research:** [2026-08-21 physiological anomaly and illness-risk review](../analysis/2026-08-21-physiological-anomaly-and-illness-risk-research.md) and [2026-11-15 literature & calibration evidence](../analysis/2026-11-15-physiological-anomaly-literature-and-calibration-evidence.md)

---

## Goal

Add a production-quality, explainable capability that can detect an unusual physiological
pattern from wearable + subjective data, account for known alternative explanations such as
hard training, poor sleep, stress, alcohol and travel, and eventually surface a conservative
`possible illness or systemic stress` warning when evidence supports it.

The capability must **not** become a diagnostic classifier and must **not** silently enable the
existing respiration strain weight.

The implementation sequence is deliberately evidence-first:

```text
schema/context -> baseline features -> pure evaluator -> append-only assessment
               -> shadow replay -> prospective follow-up labels
               -> visible anomaly UX -> only then consider tighten-only training gating
```

---

## Non-goals

This plan does not:

* diagnose COVID, influenza or any other disease;
* produce a user-visible disease probability before calibration;
* enable `RespirationStrainPolicy='median-mad-v1'` in normal readiness calls;
* replace the existing readiness/safety evaluator;
* replace explicit `illnessSymptoms` handling;
* add a generic ML classifier before enough personal labelled data exists;
* sum Garmin Sleep Score + Stress + Body Battery + Training Readiness as independent illness votes;
* require the user to manually report hard training, sleep or stress already known to the app.

---

## Target architecture

### New pure policy layer

Add a small pure module (now in `app/src/derived/flags/illnessAnomaly/`, ADR-0052 #1144 PR1-1):

```text
app/src/derived/flags/illnessAnomaly/healthAnomaly.ts
app/src/derived/flags/illnessAnomaly/healthAnomaly.test.ts
```

The evaluator is synchronous and pure. History-dependent features (baselines, persistence,
recent context) arrive precomputed, consistent with the repository's existing readiness and
subjective-baseline architecture.

### Composition boundary

A composer/service gathers:

* today's `DailyRecoverySnapshot`;
* today's `DailySubjectiveCheckin`;
* recent assessment history for persistence;
* recent completed-session / hard-session context;
* structured travel context;
* optional user-entered health context.

It maps those into a dedicated `HealthAnomalyInput` and calls the pure evaluator.

Do **not** overload `EngineObjectiveInput` with every health-context field. That type is the
training-readiness contract. Keep the health-anomaly contract separate and explicitly map the
few overlapping wearable fields.

### Policy selector

The pure contract defines four policies:

```ts
export type HealthAnomalyPolicy =
  | 'off'
  | 'shadow-v1'
  | 'visible-v1'
  | 'tighten-v1';
```

Originally during HA0–HA6 development, production defaulted to `'off'` while shadow telemetry accumulated. Following the 2026-11-15 HA7 Tier-1 release decision, **runtime active resolution defaults omitted/empty configuration to `'visible-v1'`**, while Tier 2 (`'tighten-v1'`) remains clamped to `'visible-v1'`.

#### Fail-closed policy resolution

Policy parsing separates pure contract validation from active runtime defaults:

* **Pure evaluator parser (`resolveHealthAnomalyPolicy` / `readHealthAnomalyPolicy` in `healthAnomaly.ts`):** accepts only the four exact strings (`'off' | 'shadow-v1' | 'visible-v1' | 'tighten-v1'`); omitted, invalid, malformed, or thrown config reads resolve strictly to `'off'`.
* **Runtime environment selector (`resolveConfiguredHealthAnomalyRuntimePolicy`, with alias `resolveConfiguredHealthAnomalyShadowPolicy` in `healthAnomalyRuntime.ts`):**
  * omitted or empty `VITE_HEALTH_ANOMALY_POLICY` defaults to `'visible-v1'`;
  * `'off'`, `'shadow-v1'`, and `'visible-v1'` resolve as configured;
  * `'tighten-v1'` fails safe by clamping to `'visible-v1'` (keeping automatic training restriction inactive);
  * any unrecognized or malformed string fails closed to `'off'`.

---

## Canonical data contracts

The exact TypeScript names may change, but the semantics should remain stable.

### 1. Daily check-in context

Extend `DailySubjectiveCheckin` in `app/src/engine/models.ts` with an optional block so old
documents remain valid:

```ts
export interface HealthContextCheckin {
  /** Unknown when omitted. Explicit zero means user answered none. */
  alcoholDrinksLast24h?: 0 | 1 | 2 | 3; // 3 means 3+

  travelDisruption?:
    | 'none'
    | 'local_or_no_timezone'
    | 'timezone_shift'
    | 'late_arrival_or_disrupted_sleep';
  timezoneShiftHours?: number | null;

  unusualHeatOrSauna?: boolean | null;
  dehydrationOrFluidLoss?: boolean | null;
  recentVaccination?: boolean | null;
  medicationChange?: boolean | null;
  closeSickContact?: boolean | null;
  otherDisruption?: string | null;

  /** Optional richer successor to the current boolean. */
  symptoms?: {
    present: boolean;
    onset?: 'today' | 'yesterday' | '2_3_days' | 'earlier' | null;
    severity?: 'mild' | 'moderate' | 'severe' | null;
    types?: Array<
      | 'sore_throat'
      | 'congestion'
      | 'cough'
      | 'fever_or_chills'
      | 'headache_or_body_aches'
      | 'gastrointestinal'
      | 'unusual_fatigue'
      | 'other'
    >;
  };
}
```

Implementation constraint: preserve `illnessSymptoms` as the existing compatibility/safety
field. During migration, `healthContext.symptoms?.present === true` sets
`illnessSymptoms=true`; old documents with only `illnessSymptoms` continue to work.

### 2. Core evidence

```ts
export type HealthCoreSignal = 'rhr' | 'respiration' | 'hrv';

export interface CoreSignalEvidence {
  signal: HealthCoreSignal;
  status: 'unavailable' | 'normal' | 'moderate_anomaly' | 'strong_anomaly';
  direction: 'high' | 'low' | 'two_sided' | null;
  currentValue: number | null;
  baselineValue: number | null;
  scaleValue: number | null;
  standardizedDeviation: number | null;
  estimator: string | null;
  baselineVersion: number | null;
}
```

`standardizedDeviation` is an internal comparison statistic, not a promise that the input is
Gaussian.

### 3. Explanations

```ts
export type ContextExplanationKind =
  | 'hard_training'
  | 'short_or_poor_sleep'
  | 'psychological_stress'
  | 'alcohol'
  | 'travel_or_jetlag'
  | 'heat_or_sauna'
  | 'dehydration'
  | 'vaccination'
  | 'medication_change'
  | 'other';

export interface ContextExplanation {
  kind: ContextExplanationKind;
  strength: 'weak' | 'moderate' | 'strong';
  explainsSignals: HealthCoreSignal[];
  evidence: string[];
}
```

Do not reduce this structure to one opaque `confounderPenalty`.

### 4. Assessment

Use ADR-0025's updated 6-state vocabulary (`insufficient_evidence` ensures missing/cold-start channels are never mislabelled as `normal`) and 3-concept model (`anomalySeverity`, `evidenceQuality`, `state`):

```ts
export type PhysiologicalAnomalyState =
  | 'insufficient_evidence'
  | 'normal'
  | 'explained_recovery_strain'
  | 'watch_unexplained'
  | 'possible_illness_or_systemic_stress'
  | 'symptoms_reported';
```

Assessment telemetry includes:

* policy version and calibration stage (`HealthAnomalyCalibrationStage`);
* `anomalySeverity` and `evidenceQuality` (`HealthAnomalyEvidenceQuality`);
* data-quality/coverage flags (including `baselineMaturity` and `contaminatedDaysExcluded`);
* core evidence and `activityMatchedExpectations`;
* supporting evidence;
* explanations and unexplained evidence;
* dual persistence/episode metadata (`persistenceDays` and `unexplainedPersistenceDays`);
* 3-level early-response protocol (`earlyResponse`);
* user-facing rationale tokens and causal Stage C `personalCalibration`;
* optional later outcome label.

---

# Implementation work items

## HA0 — repository contract and zero-behavior-change scaffolding

**Status:** complete on `main` (#162 for HA0.1; #166/#165 for the HA0.2 composition boundary)

### HA0.1 Add types and policy selector

Initial historical scaffolding files (subsequently extracted from `engine/` to `app/src/derived/flags/illnessAnomaly/` under [ADR-0052](../adr/0052-user-ledger-and-external-ai-planning-authority.md)):

* `app/src/derived/flags/illnessAnomaly/healthAnomalyModels.ts`
* `app/src/derived/flags/illnessAnomaly/healthAnomaly.ts`
* `app/src/services/healthAnomalyRuntime.ts` (`resolveConfiguredHealthAnomalyRuntimePolicy`)

Steps:

1. Add `HealthAnomalyPolicy` with `off` as the default.
2. Add the assessment/input/evidence types above.
3. Implement an `off` path returning `null` or an explicit disabled result.
4. Ensure no call site changes recommendation behavior.
5. Add unit tests proving default behavior is inert.

Acceptance criteria:

* app compiles;
* existing recommendation snapshots/tests are unchanged;
* no `rules.ts` weight or threshold changes;
* no user-facing alert appears.

### HA0.2 Add a composition boundary

Prefer a dedicated composer/service rather than putting history reads inside
`healthAnomaly.ts`.

Tentative files:

```text
app/src/services/healthAnomalyService.ts
app/src/services/healthAnomalyService.test.ts
```

Responsibilities:

* gather today's canonical inputs;
* gather only the prior assessment/history needed for persistence;
* resolve structured travel context;
* map to `HealthAnomalyInput`;
* call the pure evaluator;
* persist only when the policy is not `off`.

Acceptance criteria:

* `healthAnomaly.ts` contains no Firestore calls;
* missing optional history degrades to a one-day assessment rather than failing the page.

---

## HA1 — check-in context without unnecessary user burden

**Status:** complete on `main` (#162; validation/rules follow-up #168)

### HA1.1 Extend the canonical check-in schema

Files likely affected:

* `app/src/engine/models.ts`;
* `app/src/services/checkinService.ts`;
* validation helpers / Firestore rules used by check-in writes;
* tests for check-in persistence and legacy documents.

Rules:

* new block is optional;
* missing means unknown, not automatically false;
* preserve `schemaVersion` compatibility or increment it consistently with repository
  conventions;
* old documents deserialize without migration.

### HA1.2 Add compact DailyCheckin UI

Files:

* `app/src/components/DailyCheckin.tsx`;
* `app/src/components/DailyCheckin.css`;
* component tests.

Recommended interaction:

**Anything unusual since yesterday?**

One-tap chips / compact rows:

* Alcohol: `None / 1 / 2 / 3+`;
* Travel/jet lag: `No / Travel / Time-zone shift / Late arrival`;
* `Heat/sauna`;
* `Dehydration/fluid loss`;
* `Vaccination`;
* `Medication change`;
* `Close sick contact`;
* `Other`.

Do not ask:

* "hard training?" — already derived;
* "poor sleep?" — wearable + subjective sleep already exist;
* "high stress?" — Garmin/subjective stress already exist.

Keep the section collapsed/compact so a normal check-in remains fast.

### HA1.3 Upgrade illness symptoms without breaking the current safety flag

When the user turns illness symptoms on, optionally reveal:

* onset;
* severity;
* symptom-type chips.

`illnessSymptoms` remains the compatibility flag consumed by existing code.

#### Migration and validation contract

This single contract applies consistently in `validateCheckin`, `parseSubjectiveCheckin`, and
`app/firestore.rules` — not just in the UI:

* **Precedence when both fields are present.** `healthContext.symptoms.present` is the
  authoritative source once supplied; it wins over any independently-written `illnessSymptoms`
  value on the same write.
  * `symptoms.present === true` sets `illnessSymptoms = true`.
  * `symptoms.present === false` sets `illnessSymptoms = false` (explicit clear).
  * `healthContext.symptoms` omitted entirely leaves the legacy `illnessSymptoms` field
    untouched — omission is not the same as `present: false`.
* **Allowed nested combinations.** `onset`, `severity` and `types` are only meaningful, and
  only accepted, when `symptoms.present === true`. When `present === false` or `symptoms` is
  absent, `onset`/`severity`/`types` must be absent or `null`; a write that sets them alongside
  `present: false` (or without `present`) is an invalid nested state and is rejected.
* **Finite `timezoneShiftHours` bounds.** When supplied, `timezoneShiftHours` must be a finite
  number in `[-14, 14]` (covering real-world UTC offsets); `null`/omitted means unknown.
  Values outside that range or non-finite values are rejected.
* **Firestore rules enforce the same shape**, not only ownership/date: reject documents where
  `healthContext.symptoms.present` is `false`/absent but onset/severity/types are set, and
  reject `timezoneShiftHours` outside `[-14, 14]`. Rules validation is best-effort mirroring of
  `validateCheckin`; the app-side validator remains the primary gate.

Acceptance criteria:

* a legacy check-in (no `healthContext`) behaves exactly as before;
* new context round-trips through persistence;
* clearing `symptoms.present` (`true -> false`) updates `illnessSymptoms` consistently and
  clears/rejects any now-invalid nested onset/severity/types;
* no context field is required to submit a check-in;
* `validateCheckin`, `parseSubjectiveCheckin` and `app/firestore.rules` agree on the contract
  above.

Required tests (`validateCheckin`, `parseSubjectiveCheckin`, and `test:rules`):

* legacy-only — only `illnessSymptoms` set, no `healthContext`;
* context-only — `healthContext.symptoms.present` set, no legacy `illnessSymptoms` on the write;
* conflicting — both fields present with different values, confirms `healthContext` wins;
* clear-flow — `present: true` followed by `present: false`, confirms `illnessSymptoms` clears
  and stale onset/severity/types are rejected or cleared;
* invalid-range — `timezoneShiftHours` outside `[-14, 14]` or non-finite is rejected;
* invalid-nested-state — onset/severity/types set while `present` is `false`/absent is rejected.

---

## HA2 — anomaly-grade baseline features

**Status:** complete on `main` (#165); no readiness-policy cutover

### HA2.1 Respiration

Reuse the ADR-0024 v3+ median/MAD baseline when available. Do not reuse
`mapSnapshotToEngineInput`'s default-off training-strain gate as the health-anomaly gate;
health anomaly gets its own explicit mapper/policy.

Requirements:

* baseline computation version >= 3;
* measured `respiration28dMad` exists;
* preserve missingness rather than fabricating a denominator;
* record whether precise interval-derived or fallback respiration was used if that provenance
  is available.

### HA2.2 RHR

ADR-0024 says anomaly detection should compare robust and conventional candidates.

Implement observation/replay features for at least:

1. current mean/stdev path;
2. median/MAD path;
3. optional EWMA/slow-trend feature for separating acute anomaly from fitness drift.

Do not choose the winner from architecture preference. The shadow report chooses.

### HA2.3 HRV

Add an illness/anomaly candidate appropriate to HRV distribution:

1. preserve current raw-domain features;
2. add log-domain rolling baseline/scale candidate where mathematically valid;
3. keep median/MAD candidate for comparison;
4. explicitly identify what `hrvOvernightAvg` represents before naming the feature as
   LnRMSSD or applying literature thresholds one-to-one.

### HA2.4 Data-quality gate

Per signal record:

* history count;
* recent-day coverage;
* baseline age/window;
* zero/near-zero scale;
* missing current value;
* suspected quantization/ties where relevant.

The evaluator must be able to say `unavailable`. One missing signal must not be interpreted as
normal.

**Zero-scale behavior must be deterministic.** When a channel's scale (MAD/stdev) is zero or
below a documented near-zero epsilon, the default is `status = 'unavailable'` — never a
standardized deviation computed by dividing by (near-)zero. A specific non-escalating fallback
(for example, treating an exactly-zero-variance history as `'normal'` when history count is
otherwise sufficient and the current value equals the baseline exactly) is only permitted when
it is explicitly documented in the policy and covered by a unit test proving it cannot produce
`moderate_anomaly`/`strong_anomaly`/infinite evidence from zero variance. Every threshold policy
must pass a test asserting zero/near-zero scale never yields `moderate_anomaly`, `strong_anomaly`,
or an infinite/NaN standardized deviation.

Acceptance criteria:

* historical/rebuilt snapshots can produce the same feature contract;
* current-day value never enters its own reference baseline;
* no baseline estimator cutover changes existing readiness recommendations.

---

## HA3 — deterministic anomaly + explanation evaluator

**Status:** complete on `main` (#166/#165 plus review fixes); shadow-only semantics

### HA3.1 Core signal categorisation

Start with policy parameters rather than hard-coded physiological truths:

```ts
interface HealthAnomalyThresholdPolicy {
  moderateDeviation: number;
  strongDeviation: number;
  minimumCoreSignalsForMultiSignal: number;
  persistenceDaysForEscalation: number;
}
```

Initial values exist only for shadow replay and must be labelled candidate values.

Behavior:

* RHR: high-side anomaly;
* respiration: high-side anomaly;
* HRV: primary adverse direction low-side, while retaining a two-sided "outside normal
  range" diagnostic trace so unusually high HRV is not called universally good.

### HA3.2 Explanation resolver

Implement explicit rule families, each returning `ContextExplanation[]`.

#### Hard training

Inputs:

* `last3DaysHardSessionsCount`;
* yesterday/today training summary;
* preferably repository six-dimensional delivered-session cost and timing when available.

Expected pattern:

* strongly explains RHR-up / HRV-down immediately after a hard session;
* only weakly explains persistent multi-night respiration elevation by default;
* explanatory strength decays with time/recovery days.

Do not encode this as a fixed illness-score subtraction.

#### Poor sleep

Use both objective and subjective sleep. Avoid double-counting them as independent illness
signals. The explanation can be stronger when both agree.

#### Psychological stress

Use subjective mental stress as direct evidence. Garmin stress is supporting evidence, not an
independent vote because it overlaps HRV.

#### Alcohol

Use dose category and recency. Expected pattern primarily covers RHR-up / HRV-down and sleep
disruption.

#### Travel/jet lag

Resolve structured `AuthoredPlanBlock` first; merge optional check-in disruption. Keep
"travel occurred" separate from "sleep was disrupted" so the evaluator can explain what it
actually observed.

#### Heat/dehydration/vaccination/medication change

Treat as explicit alternative systemic-stress explanations with conservative semantics.
They may explain the anomaly but should not be used to declare the user safe to train hard.

### HA3.3 Residual/unexplained evidence

After explanation resolution, derive an explicit list of signal evidence not strongly covered
by known context.

Example:

```text
Observed:
- RHR strong high anomaly
- HRV moderate low anomaly
- respiration strong high anomaly

Explained by hard training:
- RHR: strong
- HRV: strong
- respiration: weak

Residual:
- strong respiration anomaly
```

If the residual persists into the next easy/rest day, escalation becomes plausible.

### HA3.4 State machine

Candidate semantics:

1. `symptoms_reported` — explicit symptoms; highest semantic priority.
2. `normal` — no meaningful core anomaly.
3. `explained_recovery_strain` — meaningful anomaly exists but known context plausibly covers
   the important pattern.
4. `watch_unexplained` — meaningful residual anomaly without symptoms.
5. `possible_illness_or_systemic_stress` — persistent/multi-signal residual pattern meeting
   evidence-gated policy.

Important: `possible_illness_or_systemic_stress` is not allowed in visible production until
HA7 evidence authorizes the wording.

### HA3.5 Rationale tokens

Generate structured rationale before human copy:

```ts
{
  facts: [
    { code: 'RHR_ABOVE_BASELINE', value: 6, unit: 'bpm' },
    { code: 'RESPIRATION_ABOVE_BASELINE', value: 1.8, unit: 'br/min' },
    { code: 'PERSISTENCE', value: 2, unit: 'days' }
  ],
  explanations: ['NO_RECENT_HARD_SESSION', 'SLEEP_NEAR_NORMAL'],
  cautions: ['NOT_A_DIAGNOSIS']
}
```

UI copy is rendered from these facts; do not persist only a prose sentence.

Acceptance criteria:

* pure deterministic unit tests;
* same inputs + policy version => same assessment;
* no state becomes more reassuring because symptoms/injury exist;
* no correlated Garmin composite can independently push the state to possible illness.

---

## HA4 — persistence, revisions and episode tracking

**Status:** complete on `main` (#166/#165 plus persistence review fixes)

### HA4.1 Append-only assessment revisions

Follow ADR-0010's same-day revision principle.

Recommended logical model:

```text
users/{userId}/health_anomaly_assessments/{date}/revisions/{revisionId}
```

or reuse an existing generic decision-revision primitive if one already exactly fits.

Persist:

* effective local date;
* computed timestamp;
* policy version;
* source snapshot/check-in identifiers or timestamps;
* baseline versions;
* full structured assessment telemetry;
* whether the revision was shadow/visible/tighten;
* whether an alert was actually shown;
* optional outcome label added later as a separate append/update event according to existing
  journal conventions.

#### Immutable, replayable identity

Do not rely on a generic revision primitive's numeric counter or timestamp alone. Define:

* **`revisionId`** — derived from an immutable source-revision identifier or a normalized input
  fingerprint (a stable hash of the exact source snapshot/check-in identifiers, baseline
  versions and policy version that produced the assessment), not a wall-clock timestamp.
  Timestamps alone cannot distinguish "recomputed with the same inputs" from "recomputed after
  a late sync changed the inputs."
* **Idempotency key** — deterministic from `(effective local date, source snapshot/check-in
  revisions, policy version, baseline/threshold policy version, mode)`. Recomputing with an
  unchanged key must not create a duplicate revision; recomputing with a changed key (a source
  revision changed) creates a new revision per ADR-0010's append-only principle.
* **Immutable threshold values** — each policy version resolves to a fixed, immutable set of
  `HealthAnomalyThresholdPolicy` values at compute time; a later change to the *current* policy
  version must not retroactively alter what an already-persisted revision recorded as its
  effective thresholds.
* **Outcome labels stay outside the immutable revision.** A later follow-up label (HA6) is
  written as a separate append/update event referencing the assessment/episode, never as a
  mutation of the assessment revision that produced the original alert (see ADR-0025's privacy
  section on keeping outcome labels separate from live scoring/replay).
* **Late and out-of-order updates.** A late Garmin sync, corrected sample, or backfilled
  baseline that changes a source revision after the original assessment was computed produces a
  *new* revision under the same `{date}` with a new `revisionId`/idempotency key; it does not
  overwrite the earlier revision. The episode-identity logic (HA4.2) treats a late-arriving
  revision using the source data's effective date, not the recompute wall-clock time, and must
  not use future information to backdate an episode's start.

### HA4.2 Episode identity

Consecutive related anomaly days need a stable episode id so the app can distinguish:

* one 3-day event;
* three independent one-day alerts.

Candidate rule for shadow mode:

* continue an episode while anomaly evidence remains present on adjacent observed days;
* close after a configurable number of normal/insufficient days;
* never backdate an episode using future information in the live evaluator.

Store `episodeId`, `episodeDay`, and previous state.

### HA4.3 Firestore isolation and validation

Update Firestore rules/tests for new user-scoped paths and check-in fields.

Acceptance criteria:

* user A cannot read/write user B assessments;
* malformed enum/range values are rejected by app validation and where feasible by Firestore
  rules;
* same-day recompute creates/references a revision rather than erasing prior shown output.

---

## HA5 — shadow mode and developer observability

**Status:** complete on `main` (PR #171, 2026-08-21)

### HA5.1 Enable explicit shadow computation

Normal user-facing production still shows nothing. A feature/config selector opts the target
user/environment into `shadow-v1`.

### HA5.2 DataView debug panel

Extend `app/src/components/DataView.tsx` with a **Health anomaly (shadow)** section showing:

* state/evidence level;
* current core values;
* baseline + scale + standardized deviation;
* estimator/baseline version;
* data quality;
* recent hard-training context;
* sleep/stress context;
* check-in context;
* explanation coverage;
* residual evidence;
* persistence/episode id;
* policy version.

This should be the first UI surface because it makes calibration errors visible without
causing user behavior changes.

### HA5.3 Replay/evidence script

Add a script analogous to existing evidence tooling, for example:

```text
scripts/health_anomaly_evidence.py
```

or TypeScript if it can more faithfully reuse the actual evaluator.

It should consume real/rebuilt history and emit machine-readable + markdown summary data.

Required report columns per day:

* date;
* RHR/respiration/HRV evidence;
* candidate estimator outputs;
* known hard-session context;
* sleep/stress/context flags;
* assessment state under each candidate policy;
* whether explicit symptoms were reported;
* future 24/48/72h symptom labels for retrospective evaluation only.

Important: future symptoms are labels in the report, never live input to the day's evaluator.

---

## HA6 — prospective label loop and calibration

**Status:** **HA6.1–HA6.4 implemented** (`#174` merged prospective outcome labels + Firestore persistence; `feat/health-anomaly-visible-early-warnings` added Stage B empirical-Bayes activity-matched expectations via `computeActivityMatchedExpectations`, causal Stage C `summarizePersonalOutcomeCalibration`, and eligible Home follow-up prompts via `HealthAnomalyFollowupCard`). Ongoing outcome collection continues in `visible-v1` to support future HA9 validation.

### HA6.1 Low-friction outcome capture

When an episode occurred, ask later — not repeatedly on every screen — what happened.

Suggested follow-up:

**What best explains the unusual recovery signals?**

* I developed illness symptoms;
* Hard training/recovery;
* Poor sleep;
* Alcohol;
* Travel/jet lag;
* Stress;
* Heat/dehydration;
* Vaccination/medication;
* Nothing obvious;
* Other / not sure.

Allow update because the answer can change: "nothing obvious" today may become "symptoms"
tomorrow.

### HA6.2 Symptom-onset timestamp

If symptoms later develop, capture approximate onset. This enables honest lead-time analysis.

### HA6.3 Optional test confirmation

If the user voluntarily records a positive/negative respiratory test, store it as a distinct
label source. Do not require a test and do not treat absence of a test as negative.

### HA6.4 Stage B activity-matched expectations & Stage C outcome calibration (implemented)

Implemented deterministically without uncalibrated ML weights:

* **Stage B (`computeActivityMatchedExpectations` & causal `contaminatedDates`):** separates `post_hard_or_high_cost` vs. `post_easy_or_rest` strata using clean prior observations (`extractSignalObservations`, excluding strictly prior symptomatic dates `< date`) and empirical-Bayes shrinkage (`HEALTH_ANOMALY_ACTIVITY_SHRINKAGE_PRIOR_DAYS`) toward the overall 28-day baseline, wired live in `HealthAnomalyService.assessAndPersist` (via `checkinService.getCheckinsInRangeState` + `mapRecoverySnapshotToHealthAnomalyFeatures`) and in `runHealthAnomalyReplay`.
* **Stage C (`summarizePersonalOutcomeCalibration`):** aggregates strictly causal prior outcome records (`< asOfDate` in `Europe/Warsaw` across source assessment, update, onset, and test timestamps) and gates `calibrationEligible: true` (`calibrationStage: 'outcome_calibrated'`) on `priorEpisodesCount >= 3` and resolved outcomes `>= 3`; wired live in `HealthAnomalyService.assessAndPersist` via `healthAnomalyOutcomeRepository.listForUser`.

---

## HA7 — release report for visible alerts

**Status:** **Complete (2026-11-15 Two-Tier Gate Redesign)** — see [2026-11-15 HA7 visible early-warning release decision](../analysis/2026-11-15-ha7-visible-early-warning-release-decision.md) and [ADR-0054](../adr/0054-ha7-visible-early-warning-release-gate.md).

### Summary of the HA7 decision

* **Flaw resolved:** requiring `>= 60` observed days **and** `>= 5` distinct anomaly episodes locked healthy athletes behind `ha7_release_gate_unmet` indefinitely by conflating physiological baseline readiness (`7–28` nights) with illness incidence.
* **Tier 1 unlocked (`visible-v1`):** approved on Stage A personal baseline readiness (`insufficient_evidence` `< 7` clean nights -> conservative `emerging_baseline` `7–13` nights -> `reliable_baseline` `>= 14` nights), explicit missingness semantics, non-diagnostic wellness language, IOC red-flag/RTS safety boundaries, and zero workout veto.
* **Tier 2 remains gated (`tighten-v1` / HA9):** automatic training restriction stays clamped to `'visible-v1'` in `resolveConfiguredHealthAnomalyRuntimePolicy` until HA9 prospective outcome evidence (`>= 90` observed days, `>= 3` outcome-labelled episodes) authorizes a separate decision.

The historical HA7 checklist items below remain tracked continuously in `runHealthAnomalyReplay` (`policySummaries`) and Stage C calibration rather than blocking visibility on healthy athletes:

### Data quality

* observed days;
* coverage per core signal;
* number of days with all 3 / 2 / 1 core signals;
* baseline-ready fraction;
* zero-scale / quantization failures.

### Alert burden

* assessments by state per 30 observed days;
* number of unique episodes;
* repeated alert days per episode;
* unexplained alerts on days the athlete retrospectively considered healthy.

### Confounder attribution

For each candidate state, report overlap with:

* hard training;
* sleep deficit;
* high stress;
* alcohol;
* travel;
* heat/dehydration;
* vaccination/medication;
* unknown.

### Illness labels

When enough events exist:

* sensitivity around labelled illness episodes;
* specificity / false-alert rate on labelled healthy periods;
* PPV for `possible_illness_or_systemic_stress`;
* lead time to symptoms;
* 24/48/72h follow-up tables.

Do not hide the base rate. PPV without illness prevalence/episode count is misleading.

### Added value vs existing readiness

Report:

* anomaly warnings on days readiness already chose recovery;
* anomaly warnings on days readiness would otherwise allow hard work;
* candidate hard-session suppressions;
* whether the anomaly capability changes a decision or merely explains it better.

### Cutover decision (Recorded 2026-11-15)

* **Chosen option:** **ship Tier 1 `visible-v1`** (`insufficient_evidence`, `explained_recovery_strain`, `watch_unexplained`, `possible_illness_or_systemic_stress` with `EarlyResponseProtocol`, `symptoms_reported`, and live advisory `illness_anomaly` D-FLAG); **keep Tier 2 `tighten-v1` inactive** pending HA9 evidence.

---

## HA8 — user-facing alert surfaces

**Status:** **Implemented (`visible-v1` active default)** — implemented on `feat/health-anomaly-visible-early-warnings`:

* `HealthAnomalyCard` (`app/src/components/HealthAnomalyCard.tsx`) mounted in `Home.tsx`, surfacing non-diagnostic `anomalySeverity`, `evidenceQuality`, 3-level `EarlyResponseProtocol` (`level_1_early_watch`, `level_2_persistent_or_corroborated`, `level_3_symptoms_reported`), IOC red-flag warnings, 3-stage RTS guidance, explanations, and inline HA6 follow-up trigger when eligible;
* `illness_anomaly` D-FLAG unlocked across `FlagCaptureService` (`flagCaptureService.ts`), `resolveTodayFlagStripItems` (`flagStripItems.ts`), `FlagStrip.tsx`, and `buildLedgerExport.ts` (replacing hardcoded `ha7_release_gate_unmet`; reporting `missing` / `no_core_signals` on `insufficient_evidence` or unmeasured nights);
* `HealthAnomalyShadowPanel.tsx` renders the `insufficient_evidence` label alongside current episode (`episodeId` / `episodeDay`) and signal/explanation traces when `configuredHealthAnomalyShadowPolicy() !== 'off'`, while multi-policy replay summary tables (`policySummaries`) live in `healthAnomalyReplay.ts`.

### HA8.1 Home alert card

Add a dedicated `HealthAnomalyCard` rather than burying the state inside the generic readiness
score.

Tentative files:

```text
app/src/components/HealthAnomalyCard.tsx
app/src/components/HealthAnomalyCard.css
app/src/components/HealthAnomalyCard.test.tsx
app/src/components/Home.tsx
```

Recommended messages:

#### Info — explained recovery strain

Title: **Recovery signals are off baseline**

Body example:

> RHR and HRV are outside your usual range. Yesterday's hard session and shorter sleep are a
> plausible explanation. No separate illness warning today.

This is optional to show; avoid noisy cards after every normal hard workout.

#### Caution — unexplained watch

Title: **Unusual physiology today**

Body example:

> RHR, HRV and/or respiration are outside your usual range and we don't have a strong training,
> sleep, alcohol or travel explanation yet. Watch for symptoms and re-check after the next
> night.

#### Warning — possible illness/systemic stress

Title: **Possible illness or other systemic stress**

Body example:

> Several recovery signals are unusually stressed and the pattern is persisting without a
> clear explanation. This can happen before illness, but wearables cannot diagnose the cause.

Detail rows should show what changed and what explanations were considered.

#### Safety — symptoms reported

Title: **Illness symptoms reported**

Body example:

> You reported symptoms. Keep today conservative and prioritize recovery. Wearable metrics do
> not override your symptom report.

### HA8.2 Avoid alarm fatigue

Rules:

* do not render a green "all clear" card every day;
* one episode should update, not create multiple stacked warnings;
* suppress repeated identical copy unless state/evidence meaningfully changes;
* allow detail expansion for metrics/explanations;
* make `not a diagnosis` clear without turning every card into legal boilerplate.

### HA8.3 Optional notifications

Push/browser notifications are out of the first visible cut. First validate whether the Home
surface is useful. Notification delivery can be a later opt-in capability after alert burden is
known.

---

## HA9 — tighten-only training integration

**Status:** respiration shadow evidence implemented through HA9-R2; `visible-v1` Tier 1 ships zero workout veto; Tier 2 (`tighten-v1`) remains **inactive** (`resolveConfiguredHealthAnomalyRuntimePolicy` clamps `'tighten-v1'` -> `'visible-v1'`) and blocked by HA9 labelled prospective evidence (`>= 90` observed days in `visible-v1` + `>= 3` outcome-labelled episodes) and [ADR-0052](../adr/0052-user-ledger-and-external-ai-planning-authority.md) authority review.

The scoped implementation decomposition and current personal-history replay findings are in
[`respiration-elevation-training-tightening.md`](./respiration-elevation-training-tightening.md).
That addendum refines how respiration may contribute to HA9: a discrete current-elevation
signal is evaluated in shadow first, while the rejected broad
`RespirationStrainPolicy='median-mad-v1'` production shortcut remains off. The addendum does
not authorize `tighten-v1`; HA7/HA9 evidence and a separate release decision still govern.

### HA9.1 Add a health gate after readiness evaluation

Only `tighten-v1` can alter the training result.

Invariant:

```text
health gate may make the recommendation more conservative;
health gate may never make it more permissive.
```

Candidate behavior to evaluate, not pre-authorize:

* `watch_unexplained`: rationale only or cap maximal work;
* `possible_illness_or_systemic_stress`: suppress/defer hard and maximal sessions, suggest easy
  aerobic/mobility/rest depending on the existing safety envelope;
* `symptoms_reported`: preserve existing symptom-driven conservative handling.

### HA9.2 External-plan adjudication

If an externally authored session is hard/key, the health gate must participate in the same
final safety/adjudication path rather than only changing internally generated workouts.

### HA9.3 Weekly-plan interaction

A one-day health anomaly should not rewrite the whole macrocycle. The normal replanning logic
handles downstream consequences after a hard session is deferred/skipped.

Acceptance criteria:

* no `recover -> train` or `modify -> train` flip can originate from health anomaly;
* injury/tissue restrictions still dominate where relevant;
* external-plan and internal-plan surfaces agree on the health gate;
* every changed recommendation explains that health anomaly caused the tightening.

---

## HA10 — testing matrix

### Unit tests — evaluator

At minimum:

1. all core signals normal -> `normal`;
2. RHR high alone after hard training -> explained or low evidence, never possible illness;
3. RHR high + HRV low after hard training, respiration normal -> explained recovery strain;
4. RHR high + HRV low + respiration high, no context -> unexplained watch;
5. same pattern persists -> candidate escalation under shadow threshold policy;
6. symptoms true + normal wearables -> `symptoms_reported`;
7. symptoms true + perfect-looking readiness -> still symptoms state;
8. missing respiration -> evaluator does not fabricate normal respiration;
9. zero/near-zero MAD/scale -> signal `unavailable` by default, or an explicitly documented
   non-escalating fallback per HA2.4, but never `moderate_anomaly`/`strong_anomaly` or infinite
   evidence;
10. alcohol explains RHR/HRV but not automatically all respiration evidence;
11. travel + poor sleep can explain more than travel alone;
12. correlated Garmin composites cannot independently escalate state;
13. unusual high HRV is retained as out-of-range telemetry, not labelled universally positive;
14. policy `off` -> no assessment side effects.

### Adapter/composer tests

* exact mapping from `DailyRecoverySnapshot`;
* baseline-version compatibility;
* hard-session derivation;
* structured travel merge with manual travel disruption;
* old check-in without `healthContext`;
* new symptom details mapping to legacy `illnessSymptoms`.

### Persistence tests

* append-only same-day revisions;
* user scoping;
* malformed context enum/range rejection;
* episode continuation/closure;
* follow-up label attachment/audit.

### UI tests

* normal state renders no health card;
* shadow mode renders nothing on Home;
* visible caution/warning copy matches state;
* metric detail handles missing signal gracefully;
* 44px+ mobile touch targets for new check-in chips;
* context section remains optional;
* screen-reader labels do not rely on color alone.

### Replay tests

Include deterministic synthetic fixtures for:

* healthy baseline;
* hard-training recovery;
* alcohol night;
* travel + short sleep;
* two-night unexplained respiratory/autonomic anomaly;
* symptomatic illness with and without wearable anomaly;
* missing/quantized respiration;
* conflicting subjective/objective signals.

Synthetic fixtures validate behavior, not release calibration.

---

## Recommended PR sequence

Keep implementation reviewable and protect production behavior.

### PR HA-A — contracts + check-in context — **merged 2026-08-21 (#162)**

* HA0.1 types/policy;
* HA1 schema/UI/persistence;
* all defaults inert;
* no evaluator visible yet.

### PR HA-B — baseline/anomaly features — **merged 2026-08-21 (#165)**

* HA2 feature plumbing;
* no recommendation change;
* debug-only evidence.

### PR HA-C — pure evaluator + persistence — **merged 2026-08-21 (#166; integrated/followed by #165 review fixes)**

* HA3 + HA4;
* policy `shadow-v1` explicit only;
* append-only assessment revisions.

### PR HA-D — shadow observability + replay — **merged (#171, CI fix #173)**

* HA5;
* DataView panel;
* evidence script/report.

### PR HA-E — prospective follow-up labels — **PR #174, `feat/health-anomaly-ha-e`**

* HA6.1–HA6.3 (outcome capture, symptom onset, optional respiratory test);
* owner-scoped `health_anomaly_outcomes` Firestore rules with reference integrity to the immutable assessment revision;
* follow-up form mounted only under the Detailed Data shadow surface;
* no illness probability, no Home alert, no recommendation/training input;
* HA6.4 deliberately deferred.

### PR HA-F — visible anomaly UX & D-FLAG release — **implemented (`feat/health-anomaly-visible-early-warnings`)**

* 2026-11-15 HA7 two-tier release decision (`2026-11-15-ha7-visible-early-warning-release-decision.md`) and [ADR-0054](../adr/0054-ha7-visible-early-warning-release-gate.md);
* six defect fixes (`insufficient_evidence`, unified `unexplainedPersistenceDays`, Night-1 multi-domain corroboration + `EarlyResponseProtocol`, resolving respiration downgrade, causal clean-window baseline exclusion wired live + in replay, Day 3+ acute confounder cap) plus Stage B `computeActivityMatchedExpectations` and Stage C `summarizePersonalOutcomeCalibration` (wired live via `HealthAnomalyService.assessAndPersist`);
* `visible-v1` default runtime policy, `HealthAnomalyCard` on `Home`, live `illness_anomaly` D-FLAG in capture/strip/export, and enhanced `runHealthAnomalyReplay` (`policySummaries`).

### PR HA-G — training gate — **blocked by HA9 Tier-2 release decision**

Remains inactive (`'tighten-v1'` clamps to `'visible-v1'`) until separate HA9 prospective outcome evidence authorizes training restriction.

Do not combine HA-F and HA-G. User-visible early warnings remain advisory until prospective outcome evidence justifies altering training recommendations.

---

## Definition of done for the capability

The capability is not "done" merely because the evaluator compiles.

For **shadow capability complete**:

* check-in context exists and is optional;
* core anomaly features have data-quality gates;
* evaluator is pure/versioned;
* explanations are structured;
* assessments are append-only/replayable;
* DataView exposes the trace;
* real history can be replayed;
* production recommendation behavior remains unchanged.

All eight bullets are satisfied on `main` (`#171`, `#173`).

For **visible capability complete**:

* dated HA7 release decision exists (`2026-11-15-ha7-visible-early-warning-release-decision.md`);
* `insufficient_evidence`, explained, unexplained watch, corroborated stress, and symptom states/early-response copy are rendered cleanly via `HealthAnomalyCard` and `illness_anomaly` D-FLAG;
* alert burden is bounded, activity-conditioned, contamination-protected, and episode-aware;
* all UI copy uses non-diagnostic wellness framing with explicit IOC red-flag and RTS boundaries;
* HA6 outcome follow-up (`HealthAnomalyFollowupCard` + `summarizePersonalOutcomeCalibration`) captures prospective labels in live use.

All five bullets are satisfied on `feat/health-anomaly-visible-early-warnings`.

For **training integration complete** (Tier 2 / HA9 — **pending**):

* a separate Tier-2 / HA9 evidence review authorizes un-clamping `tighten-v1`;
* hard-session suppression is measured on prospective labelled outcomes;
* internal and external-plan decisions use the same gate under ADR-0052;
* health anomaly can only tighten;
* audit telemetry identifies every changed recommendation.

---

## Current continuation checklist

Continue from shipped Tier 1 (`visible-v1`) rather than reverting or re-gating it:

1. Read [ADR-0025](../adr/0025-physiological-anomaly-and-possible-illness-signals.md), [ADR-0054](../adr/0054-ha7-visible-early-warning-release-gate.md), [ADR-0024](../adr/0024-biometric-baseline-estimator-policy.md), [ADR-0052](../adr/0052-user-ledger-and-external-ai-planning-authority.md), [the 2026-11-15 HA7 release decision](../analysis/2026-11-15-ha7-visible-early-warning-release-decision.md), [the 2026-11-15 literature & calibration evidence](../analysis/2026-11-15-physiological-anomaly-literature-and-calibration-evidence.md), this plan, and `docs/architecture/health-anomaly-shadow.md`.
2. Keep `'visible-v1'` active as the default non-diagnostic early-warning policy; opt out only via explicit `VITE_HEALTH_ANOMALY_POLICY=off` or `shadow-v1`.
3. Accumulate real prospective HA6 episode follow-ups (`HealthAnomalyOutcomeRecord`) and run `runHealthAnomalyReplay` (`policySummaries`) to monitor false-alert rate per 30 days, Night-1 multi-domain corroboration yield, and `calibrationEligible` readiness across athletes.
4. Keep `'tighten-v1'` clamped to `'visible-v1'` until `>= 90` observed days in `visible-v1` and `>= 3` outcome-labelled episodes support a separate HA9 Tier-2 release decision.
