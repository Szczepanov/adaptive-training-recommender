# HRF — Activity Heart-Rate Measurement Fidelity & Decision Authority

* **Status:** `Draft`
* **Proposed:** 2026-08-29
* **Blocked by:** HRF0 real-account FIT provenance spike; acceptance of [ADR-0031](../adr/0031-activity-heart-rate-measurement-fidelity-and-evidence-authority.md)
* **Unlocks:** source-aware HR trust, artifact-resistant HR-zone/load interpretation, safe max-HR/threshold/decoupling gating, and athlete/device/activity-specific HR reliability calibration
* **Source analysis:** [`2026-08-29-activity-hr-measurement-confidence-analysis.md`](../analysis/2026-08-29-activity-hr-measurement-confidence-analysis.md)
* **Decision record:** [ADR-0031](../adr/0031-activity-heart-rate-measurement-fidelity-and-evidence-authority.md)
* **Related plans:** [`garmin-activity-telemetry-ingestion.md`](./garmin-activity-telemetry-ingestion.md), [`physiological-identity-passport-and-measurement-trust.md`](./physiological-identity-passport-and-measurement-trust.md), [`scientific-validation-and-feedback-loop.md`](./scientific-validation-and-feedback-loop.md), [`health-anomaly-and-illness-risk-alerting.md`](./health-anomaly-and-illness-risk-alerting.md)

> **Not a top-level phase.** `HRF*` is a bounded measurement-fidelity capability, like `PI*`, `MS*`, `HA*`, `OV*`, and `SV*`.

> **Safety posture:** low HR measurement confidence removes or bounds HR-derived evidence. It must never independently lower readiness, increase physiological strain, create an illness/anomaly conclusion, or imply poor workout execution.

> **Activation posture:** HRF0–HRF7 are additive/shadow work. No production recommendation behavior changes until HRF8 produces reviewed evidence and a separate activation decision is accepted.

---

## Goal

Introduce an explicit, replayable **activity heart-rate measurement fidelity layer** that answers:

> **How trustworthy is the HR evidence recorded for this activity, and for which downstream use is it trustworthy enough?**

The capability must preserve the distinction between:

1. sensor/device presence;
2. HR source provenance;
3. sensor technology;
4. activity/motion difficulty for that technology;
5. actual trace quality and coverage;
6. fitness for a specific downstream use.

The Garmin implementation should use original FIT evidence where available, but contracts must remain provider-neutral.

---

## Non-goals

This plan does **not**:

- diagnose arrhythmias or cardiovascular disease;
- convert measurement confidence into readiness;
- claim wrist HR is universally bad;
- claim chest-strap HR is infallible ground truth;
- infer artifact solely because HR is high/unusual;
- persist raw FIT files or full high-frequency HR series into ordinary Firestore activity documents;
- make high-frequency HR part of the daily recommendation payload;
- activate HR-derived training-load changes merely because fidelity metadata exists;
- replace the physiological identity passport;
- build an opaque ML quality model in v1;
- treat missing FIT/source metadata as negative evidence;
- use one scalar confidence threshold for every HR-derived feature.

---

## Governing invariants

| ID | Invariant |
|---|---|
| **P-HRF-1** | Measurement fidelity is separate from physiological state. Low HR confidence removes/bounds evidence; it never lowers readiness by itself. |
| **P-HRF-2** | Device presence is not equivalent to sample provenance. |
| **P-HRF-3** | External HR sensor presence does not imply electrode chest strap unless product/technology evidence supports it. |
| **P-HRF-4** | Garmin source switching may produce legitimate mixed-source activities; `mixed_possible` is not synonymous with poor signal quality. |
| **P-HRF-5** | Trace quality can downgrade any hardware prior, including a chest strap. |
| **P-HRF-6** | A clean trace cannot automatically upgrade a difficult wrist/activity combination to `HIGH` without sufficient provenance or personal validation. |
| **P-HRF-7** | Fitness for use is use-case-specific. A trace may be displayable while blocked for max-HR, threshold, decoupling or health inference. |
| **P-HRF-8** | Severe missingness/dropout is not repaired into high confidence by interpolation. |
| **P-HRF-9** | Artifact detection uses independent context when available and never treats another HR-derived child metric as independent corroboration. |
| **P-HRF-10** | HR-derived child features inherit the parent trace's authority. |
| **P-HRF-11** | Provider-specific FIT field names stay at the Garmin boundary; engine contracts remain provider-neutral. |
| **P-HRF-12** | FIT/trace parsing failure must not fail the core activity sync. |
| **P-HRF-13** | No raw real-account FIT fixture is committed. |
| **P-HRF-14** | Personal calibration is evaluated out of sample and keyed to athlete/device/sensor/activity context. |
| **P-HRF-15** | Population literature supplies priors, not per-athlete truth. |
| **P-HRF-16** | Production authority changes are versioned, replayable and separately approved after shadow evidence. |

---

## Relationship to existing capabilities

### Garmin per-activity telemetry (`G`)

`garmin-activity-telemetry-ingestion.md` already provides:

- `CanonicalActivity` / `CanonicalActivityDetail`;
- per-activity persistence;
- `hrInZones`;
- lap summaries;
- additive optional parsing;
- failure isolation.

HRF extends that path rather than creating a parallel activity store.

### Physiological Identity Passport (`PI`)

PI answers whether an observation belongs to the authenticated athlete. HRF answers whether the HR measurement is technically trustworthy for a particular inference. These must remain separate.

### Scientific Validation (`SV`)

HRF owns domain-specific signal-quality contracts and shadow evidence. SV may consume those outputs for broader marginal-information and feedback-loop analysis.

### Health anomaly (`HA`)

HA must not treat low-confidence activity HR as strong physiological anomaly evidence. HRF supplies the authority boundary rather than duplicating sensor-quality heuristics inside HA.

---

## Decisions required

[ADR-0031](../adr/0031-activity-heart-rate-measurement-fidelity-and-evidence-authority.md) records the proposed decisions below and must be accepted before HRF1 production-facing schema work.

| ID | Proposed decision | Why it matters |
|---|---|---|
| **D-HRF-AUTHORITY** | HR fidelity gates evidence authority; low confidence is never negative readiness evidence | Core safety invariant |
| **D-HRF-PROVENANCE** | Sensor presence, source provenance and sensor technology are separate | Garmin source switching makes naive attribution wrong |
| **D-HRF-USECASE** | Authority is use-case-specific | A single global threshold is unsafe |
| **D-HRF-RAW** | Derive compact evidence transiently; do not persist raw FIT by default | Privacy/data-minimization boundary |
| **D-HRF-ACTIVATE** | Initial implementation is shadow-only | Prevents silent production changes |
| **D-HRF-DECODER** | Prefer Garmin official FIT Python SDK if practical; otherwise approve an alternative after the spike | Decoder correctness/maintenance/license matter |

---

## Task board

| Item | Title | Status | Blocked by | Decision impact |
|---|---|---|---|---|
| HRF0 | Real-account FIT provenance & decoder spike | `[ ]` | — | evidence only |
| HRF1 | Provider-neutral HR fidelity contracts | `[ ]` | HRF0, ADR-0031 | none |
| HRF2 | Garmin original-FIT acquisition + sensor inventory | `[ ]` | HRF0, HRF1 | none |
| HRF3 | Deterministic HR trace-quality diagnostics | `[ ]` | HRF1, HRF2 | shadow only |
| HRF4 | Canonical mapping + additive Firestore persistence | `[ ]` | HRF1–HRF3 | none |
| HRF5 | TypeScript parser + activity HR authority engine | `[ ]` | HRF4 | shadow only |
| HRF6 | HR-consumer audit + explicit authority adapters | `[ ]` | HRF5 | no production change |
| HRF7 | Shadow telemetry, replay journal and UI observability | `[ ]` | HRF5, HRF6 | evidence only |
| HRF8 | Historical replay + prospective paired-reference study | `[ ]` | HRF7 | ship/no-ship evidence |
| HRF9 | Conservative production gating | `[ ]` | HRF8 + activation decision | production |
| HRF10 | Personal device × activity reliability priors | `[ ]` usage-triggered | paired reference history | later candidate |
| HRF11 | Living architecture, runbook and regression matrix | `[ ]` | HRF9 or shadow-only closeout | docs/ops |

---

# HRF0 — Real-account FIT provenance & decoder spike

## Why first

The most important unknown is what this account's original Garmin activity files actually expose. Do not design a per-sample source model around documentation assumptions.

## Required probe matrix

Inspect at least one available activity for:

| Case | Required |
|---|---|
| Garmin watch, no external HR sensor | yes |
| Garmin watch + known Garmin HR chest strap | yes if history contains one |
| Third-party external HR | if available |
| Dynamic Source Switching-capable watch + strap | if applicable |
| steady cycling | yes |
| cycling intervals | yes |
| running | yes |
| strength | yes |
| airbike/high-arm-motion cardio | yes |
| soccer/field | if available |

Record unavailable cases as `not observed`; do not synthesize conclusions.

## Questions to answer

- What does the pinned `garminconnect` provide for original activity download?
- FIT directly or ZIP containing FIT?
- Which `device_info` records are present?
- Can external HR product/device type distinguish chest strap vs optical external HR?
- Is there explicit sample-level HR source?
- Can source switches be reconstructed?
- Are separate wrist/external HR streams present?
- Which HR/cadence/power/timestamp fields exist?
- How do developer fields and corrupt/truncated files behave?

## Decoder spike

Try the official Garmin FIT Python SDK first.

Accept it when it:

- works under the repository runtime/CI target;
- decodes representative real files;
- handles unknown fields safely;
- fails safely on CRC/truncation;
- has an acceptable licensing/redistribution story.

If not, evaluate a maintained alternative and document the choice before implementation.

## Output

Create a dated analysis:

```text
docs/analysis/YYYY-MM-DD-garmin-activity-hr-fit-provenance-spike.md
```

It must include observed message shapes, sanitized source/device evidence, decoder decision, source-switch findings and request/download behavior.

## Fixture/privacy rule

Never commit a real raw FIT file. Fixtures must be synthetic or aggressively reduced/fabricated using real key names only. Strip exact timestamps, GPS, owner IDs, serials, real HR and real activity IDs.

## Done when

- real-account probe report exists;
- known-strap and wrist-only files were compared where history permits;
- per-sample provenance is classified as possible, impossible or still unknown;
- decoder choice is explicit;
- no production schema/behavior changed.

---

# HRF1 — Provider-neutral HR fidelity contracts

Add provider-neutral contracts in `src/garmin_sync/canonical.py`.

Suggested conceptual shape:

```python
HrSensorTechnology = Literal[
    "ecg_chest_strap",
    "optical_armband",
    "wrist_ppg",
    "external_unknown",
    "unknown",
]

HrSourceForActivity = Literal[
    "external",
    "wrist",
    "mixed_possible",
    "unknown",
]

HrProvenanceConfidence = Literal[
    "confirmed",
    "inferred",
    "ambiguous",
    "unknown",
]

@dataclass(frozen=True)
class CanonicalHrSourceEvidence:
    external_hr_sensor_present: bool | None
    source_for_activity: HrSourceForActivity
    provenance_confidence: HrProvenanceConfidence
    sensor_technology: HrSensorTechnology

@dataclass(frozen=True)
class CanonicalHrMeasurementQuality:
    source: CanonicalHrSourceEvidence
    activity_motion_risk: Literal["low", "moderate", "high", "unknown"]
    coverage_pct: float | None
    longest_gap_seconds: float | None
    signal_quality: Literal["clean", "suspect", "poor", "unknown"]
    measurement_confidence: Literal["high", "moderate", "low", "unreliable"]
    artifact_flags: tuple[str, ...] = ()
    reasons: tuple[str, ...] = ()
    diagnostic_version: str = "1.0.0"
```

Initial reason/artifact vocabulary:

```text
ABRUPT_JUMP
ISOLATED_SPIKE
ABRUPT_DROP
DROPOUT
STALE_PLATEAU
CADENCE_LOCK_SUSPECTED
HARMONIC_LOCK_SUSPECTED
WORKLOAD_DISCORDANCE
TRANSITION_LAG_SUSPECTED
SOURCE_SWITCH_POSSIBLE
INSUFFICIENT_COVERAGE
SOURCE_UNKNOWN
PROVENANCE_AMBIGUOUS
```

Avoid a broad `PHYSIOLOGICAL_IMPLAUSIBILITY` catch-all in v1; it is too easy to label unusual real physiology as sensor error.

### Done when

- Garmin FIT key names do not leak into canonical types;
- source, technology, provenance and quality are separate;
- unknown/ambiguous is first-class;
- no downstream recommendation uses the new types yet.

---

# HRF2 — Garmin original-FIT acquisition + sensor inventory

## Client boundary

Extend `src/garmin_sync/garmin_client.py` with one explicit original-activity method on both protocol and wrapper, based on HRF0's verified API shape.

Conceptually:

```python
def download_activity_original(self, activity_id: str) -> bytes | None: ...
```

Requirements:

- existing authentication behavior;
- `None` for legitimate unavailable original;
- auth/rate-limit failures remain explicit;
- binary content never logged.

## Feature gate

Add an opt-in config such as:

```text
GARMIN_ACTIVITY_HR_FIDELITY_ENABLED=false
```

Initial default: off.

FIT fidelity fetching should be bounded to current/target activities and must not repeatedly redownload lookback activities on every daily sync.

Do **not** gate only on hard intensity: easy sessions matter for decoupling and validation.

## FIT decoder boundary

Add a Garmin-specific module, suggested:

```text
src/garmin_sync/fit_activity.py
```

Responsibilities:

- unwrap ZIP if necessary;
- decode FIT;
- extract sensor/device inventory;
- extract transient HR/cadence/power samples required for diagnostics;
- expose provider-neutral intermediate evidence;
- never write Firestore directly.

Unknown sensor products remain `external_unknown`; do not fuzzy-guess technologies.

If HRF0 cannot recover per-sample source, a switching-capable strap activity may be represented as `mixed_possible` / ambiguous rather than strap-only.

## Failure isolation

Download/decode failure logs a structured warning, leaves base activity sync intact and produces absent/unknown fidelity.

### Done when

- wrapper success/no-file/auth/rate-limit tests exist;
- synthetic FIT fixture decodes;
- external HR inventory is extracted;
- unknown technology remains unknown;
- no raw FIT bytes reach Firestore;
- target-date request budget is tested.

---

# HRF3 — Deterministic HR trace-quality diagnostics

Create:

```text
src/garmin_sync/hr_fidelity.py
```

V1 must be deterministic, versioned and explainable.

## HRF3.1 Coverage

Compute sample/window coverage, longest gap, gap count and sampling irregularity. Do not interpolate before fidelity assessment.

## HRF3.2 Abrupt jump/drop

Use local windows, local median, persistence and independent workload transition context. Avoid a brittle universal bpm-per-second threshold.

## HRF3.3 Isolated spikes

Detect very short peaks that can corrupt max HR and zone-5 exposure.

## HRF3.4 Dropout

Detect missing chunks, invalid/zero values where relevant and long gaps.

## HRF3.5 Stale plateau

Flag a long near-flat HR only when independent workload evidence changes enough to make tracking failure plausible. Stable Z2 HR alone is not an artifact.

## HRF3.6 Cadence/harmonic lock

When cadence exists, test sustained windows for relationships such as `HR ≈ cadence` and `HR ≈ 2 × cadence`. Require persistence/context and emit `*_SUSPECTED`, never confirmed artifact in v1.

## HRF3.7 Workload discordance

Use independent external load where available:

- cycling: power/cadence;
- running: pace/grade/workout step;
- strength: exercise structure rather than continuous HR.

Respect normal physiological HR lag.

## HRF3.8 Source-switch signature

Only implement if HRF0 shows useful evidence. A possible abrupt noise/level change may add `SOURCE_SWITCH_POSSIBLE`, but cannot prove switching.

## HRF3.9 Motion-risk prior

Map activities into a small provider-neutral risk vocabulary rather than a huge Garmin taxonomy.

Conservative examples:

```text
MODERATE: steady running, steady cycling
HIGH: airbike, rowing, resistance training, active-arm elliptical, field/contact sport
```

## HRF3.10 Confidence combiner

Use rules/caps, not pseudo-probabilities:

```text
severe coverage failure -> UNRELIABLE
severe artifact pattern -> cap at LOW
unknown provenance -> cannot become HIGH in v1
wrist + high-motion -> cannot become HIGH from clean trace alone
known ECG strap + clean trace + good coverage -> HIGH candidate
```

### Done when

- detector tests include realistic negative controls such as interval transitions;
- severe chest-strap dropout downgrades confidence;
- clean high-motion wrist trace remains conservatively capped;
- no readiness/recommendation field is emitted;
- thresholds are centrally versioned.

---

# HRF4 — Canonical mapping + additive Firestore persistence

Extend the existing activity write path in `src/garmin_sync/mapper.py`.

Suggested optional persisted shape:

```json
{
  "hrMeasurement": {
    "sourceForActivity": "wrist",
    "sensorTechnology": "wrist_ppg",
    "externalHrSensorPresent": false,
    "provenanceConfidence": "inferred",
    "activityMotionRisk": "high",
    "coveragePct": 98.7,
    "longestGapSeconds": 2.0,
    "signalQuality": "suspect",
    "measurementConfidence": "low",
    "artifactFlags": ["ISOLATED_SPIKE"],
    "diagnosticVersion": "1.0.0"
  }
}
```

Requirements:

- same activity upsert, no second detail-only write;
- no schema-version change that invalidates older TypeScript readers;
- malformed `hrMeasurement` must degrade to absent/unknown without invalidating the base activity;
- no raw samples, GPS, owner IDs or sensor serials persisted;
- old documents without the field mean `not assessed`, not low confidence.

### Done when

- enriched records pass the real TypeScript parser contract;
- malformed fidelity metadata does not collapse the activity window;
- one activity still produces one normal upsert;
- persisted output contains no raw/identifying sensor data.

---

# HRF5 — TypeScript parser + activity HR authority engine

Extend the existing normalized activity parser to accept optional `hrMeasurement`. Parser failure in that subtree must not invalidate the base activity.

Create:

```text
app/src/engine/activityHrFidelity.ts
```

Suggested contracts:

```ts
export type HrUseCase =
  | 'DISPLAY_AVERAGE'
  | 'DISPLAY_TRACE'
  | 'ZONE_DISTRIBUTION'
  | 'TRAINING_LOAD'
  | 'AEROBIC_DECOUPLING'
  | 'INTERVAL_RESPONSE'
  | 'MAX_HR_UPDATE'
  | 'THRESHOLD_HR_UPDATE'
  | 'WORKOUT_COMPLIANCE'
  | 'HEALTH_ANOMALY';

export type HrAuthorityStatus =
  | 'ALLOWED'
  | 'BOUNDED'
  | 'OBSERVATIONAL'
  | 'BLOCKED';
```

Initial **shadow** policy:

| Use case | High | Moderate | Low | Unreliable/unknown |
|---|---|---|---|---|
| Display average/trace | allowed | allowed | observational | observational |
| HR zones | allowed | bounded | blocked | blocked |
| HR-derived load | allowed | bounded | blocked | blocked |
| Aerobic decoupling | allowed if segment valid | blocked initially | blocked | blocked |
| Interval response | allowed | bounded | blocked | blocked |
| Max-HR update | allowed + peak/context checks | blocked | blocked | blocked |
| Threshold-HR update | allowed + protocol/context | blocked | blocked | blocked |
| Workout compliance | allowed | bounded | blocked | blocked |
| Health anomaly | only with HA corroboration | observational at most | blocked | blocked |

`dataConfidence.ts` may surface this in observability, but sensitive consumers must use the actual authority helper rather than relying on a dashboard badge.

### Done when

- authority is deterministic/versioned;
- every use case has tests;
- low confidence cannot lower readiness;
- unknown fails closed for high-risk inference but remains displayable;
- no production consumer is switched yet.

---

# HRF6 — HR-consumer audit + explicit authority adapters

Inventory every consumer of activity HR or HR-derived child data.

Search at least:

```text
averageHr
hrInZones
averageHrBpm
maxHr / max HR candidates
lactateThresholdHr
zone-derived credit
TRIMP/load
decoupling
interval HR response
activityTrainingLoad
```

For each consumer record:

```text
consumer
input field
HR-derived?
independent corroboration?
HrUseCase
current authority
future HRF behavior
```

If Garmin `activityTrainingLoad` materially embeds HR, record that lineage; do not treat it as independent merely because Garmin computed it upstream.

Use a centralized adapter pattern:

```ts
const authority = getHrUseAuthority(activity, 'AEROBIC_DECOUPLING');
if (authority.status === 'BLOCKED') {
  return unavailable('HR_MEASUREMENT_FIDELITY');
}
```

Avoid scattered direct confidence comparisons.

### Done when

- consumer inventory is complete;
- every sensitive consumer maps to one use case;
- no high-risk consumer can bypass authority in shadow simulation;
- production behavior is still unchanged.

---

# HRF7 — Shadow telemetry, replay journal and UI observability

For each enriched activity derive:

```text
measurement confidence
artifact flags
per-use authority
what current production used
what HRF would allow/block/bound
```

Measure at minimum:

- FIT-fidelity assessable coverage;
- wrist/external/mixed/unknown source distribution;
- confidence by activity class;
- artifact prevalence;
- HR-zone/load candidate blocks;
- max-HR candidate blocks;
- decoupling blocks;
- poor-trace cases despite strap presence;
- useful wrist traces preserved.

Activity detail may show a small read-only explanation, for example:

```text
HR measurement: Low confidence
Reason: wrist optical HR + high arm motion + isolated spikes
```

Do not expose pseudo-precise values such as `HR accuracy = 87%` unless later reference calibration supports that meaning.

### Done when

- shadow evidence is replayable;
- activity detail can explain quality when present;
- missing fidelity does not create alarming UI;
- recommendations are unchanged.

---

# HRF8 — Historical replay + prospective paired-reference study

This item produces the evidence required for production activation.

## Historical replay

Use historical activities whose original FIT remains available. Stratify by:

- source evidence;
- activity class;
- motion risk;
- intensity;
- recording device period where identifiable.

Report:

- assessable coverage;
- source distribution;
- artifact rates;
- authority changes;
- affected downstream features;
- manual review of suspicious/false-positive cases.

Self-consistency replay does not by itself validate measurement accuracy.

## Paired wrist vs chest-strap study

Collect repeated representative sessions where both can be compared. Prioritize:

1. steady cycling;
2. cycling intervals;
3. airbike;
4. steady running;
5. running intervals;
6. strength;
7. soccer/field if practical.

Treat an electrode chest strap as a strong practical reference, not perfect ground truth.

Evaluate:

- mean bias;
- MAE/RMSE;
- p95 absolute error;
- Lin concordance;
- Bland–Altman bias/limits;
- % within ±5/±10 bpm;
- dropout/gaps;
- lag;
- HR-zone disagreement;
- max-HR disagreement;
- downstream load/decision disagreement.

Do not approve on correlation or mean error alone.

## Activation report must answer

1. Does HRF block clear artifacts?
2. Does it preserve clean useful traces?
3. Does it reduce false max-HR/threshold/decoupling evidence?
4. Does it avoid flagging normal interval kinetics?
5. Does it change enough downstream behavior to justify complexity?
6. Is missing-FIT coverage acceptable?
7. Are confidence labels understandable/stable?

### Done when

- historical replay report exists;
- paired-reference report exists or explicitly documents insufficient evidence;
- false-positive examples are reviewed;
- activation recommendation is written;
- no production change occurs implicitly.

---

# HRF9 — Conservative production gating

**Blocked until HRF8 evidence + explicit activation decision.**

Activate first where artifact cost is highest:

1. max-HR updates/candidates;
2. threshold-HR updates/candidates;
3. aerobic decoupling;
4. activity-HR health anomaly evidence.

Insufficient authority should mean **unavailable/ignored evidence**, not zero and not a readiness penalty.

Later consider:

5. HR-zone distribution;
6. HR-derived training load;
7. interval response;
8. HR-based workout compliance.

For `BOUNDED`, define the exact per-feature behavior explicitly rather than using hidden continuous weights.

## Fallback hierarchy

### Cycling

Prefer reliable power for load/intensity inference when scientifically appropriate.

### Running

Use pace/grade/workout structure and RPE when HR is blocked.

### Strength

Use sets/reps/load/RPE/RIR rather than noisy wrist HR as the primary internal-load signal.

### Airbike without power

Use duration + planned/completed structure + RPE with wider uncertainty.

### Done when

- activation decision is linked;
- every changed consumer has before/after tests;
- fallback behavior is explicit;
- low HR confidence cannot independently lower readiness;
- activity completion remains recognized;
- evidence traces explain exclusions.

---

# HRF10 — Personal device × activity reliability priors

**Usage-triggered:** build only when enough paired wrist/reference sessions exist for a repeated activity class.

A future prior may represent:

```text
athlete × recording device × sensor technology/product × activity class
```

Suggested fields:

```ts
interface PersonalHrReliabilityPrior {
  athleteId: string;
  recordingDeviceKey: string | null;
  sensorTechnology: HrSensorTechnology;
  sensorProductKey: string | null;
  activityClass: string;
  sampleCount: number;
  validatedMinutes: number;
  maeBpm: number | null;
  p95AbsoluteErrorBpm: number | null;
  coveragePct: number | null;
  lagSeconds: number | null;
  zoneAgreementPct: number | null;
  reliability:
    | 'VALIDATED_HIGH'
    | 'VALIDATED_MODERATE'
    | 'VALIDATED_LOW'
    | 'INSUFFICIENT_DATA';
  modelVersion: string;
  trainedThrough: string;
}
```

Evaluation must be chronological/leave-one-session-out. A device change creates a new insufficient prior rather than inheriting validation blindly. Severe current-trace artifacts still override a strong personal prior.

---

# HRF11 — Living architecture, runbook and regression matrix

Create living docs only after production activation or an explicit shadow-only closeout, so they describe shipped behavior rather than aspiration.

Suggested:

```text
docs/architecture/activity-heart-rate-fidelity.md
docs/ops/activity-heart-rate-fidelity.md
```

Architecture should explain ingestion, source evidence, transient raw handling, confidence semantics, per-use authority, policy versions and personal calibration.

Runbook should cover FIT download/decoder failures, sudden rises in `UNKNOWN`, new sensor IDs, artifact-rate shifts, rollback and replay operations.

---

## Implementation map

| Concern | Current / proposed file |
|---|---|
| Garmin original download | `src/garmin_sync/garmin_client.py` |
| Feature config | `src/garmin_sync/config.py` |
| FIT decoder boundary | new `src/garmin_sync/fit_activity.py` |
| Provider-neutral Python contracts | `src/garmin_sync/canonical.py` |
| HR diagnostics | new `src/garmin_sync/hr_fidelity.py` |
| Garmin integration | `src/garmin_sync/garmin_provider.py` |
| Normalized activity mapping | `src/garmin_sync/mapper.py` |
| Sync/failure isolation | `src/garmin_sync/service.py` |
| CLI/replay tooling | `src/garmin_sync/cli.py` and/or `scripts/` following current conventions |
| Normalized TS activity parser | existing activity service/parser module |
| Per-use authority | new `app/src/engine/activityHrFidelity.ts` |
| Offline fidelity analytics | `app/src/engine/analytics/signalFidelityEvaluator.ts` where appropriate |
| Dashboard confidence | `app/src/engine/dataConfidence.ts` only as observability, not authority |
| Health anomaly integration | existing `healthAnomaly*` modules after HRF9 |

---

## Operational/request budget

Original FIT acquisition adds at least one external request per activity.

### Daily sync

- target/current activities only;
- do not refetch overlapping lookback activities every run;
- FIT failures cannot stop core sync;
- on rate limiting, fidelity enrichment may stop for the run while core persistence continues.

### Historical replay

- explicit operator command;
- bounded date range;
- structured request-budget logging;
- resumable/idempotent where practical;
- never an automatic full-history sweep inside scheduled daily sync.

### Raw-data handling

Default:

```text
download
→ decode in memory/bounded temp storage
→ derive compact evidence
→ discard raw bytes
```

Do not log or persist raw FIT, GPS, sensor serials or full HR arrays under this capability.

---

## Test strategy

### FIT/source tests

- wrist-only FIT;
- known ECG chest strap;
- unknown external HR sensor;
- multiple `device_info` records;
- missing `device_info`;
- malformed product fields;
- switching-capable ambiguous case;
- explicit sample source if HRF0 finds one;
- ZIP/FIT, corrupt/truncated file, no original.

### Trace tests

- clean steady trace;
- clean interval ramp;
- isolated spike;
- abrupt drop;
- long dropout;
- repeated short gaps;
- stable legitimate Z2 plateau;
- suspicious plateau while power changes;
- cadence lock;
- 2× cadence harmonic;
- physiological HR lag;
- source-switch-like discontinuity;
- chest-strap dropout.

### Confidence tests

```text
wrist + airbike + isolated spikes
→ LOW or worse
```

```text
wrist + steady run + clean trace
→ MODERATE candidate, not automatically HIGH without personal validation
```

```text
known ECG strap + good coverage + clean trace
→ HIGH candidate
```

```text
known ECG strap + severe dropout
→ downgraded
```

```text
unknown provenance + clean trace
→ confidence capped
```

### Hard authority regressions

```text
LOW confidence
MUST NOT reduce readiness
```

```text
LOW confidence
→ MAX_HR_UPDATE blocked
→ THRESHOLD_HR_UPDATE blocked
→ AEROBIC_DECOUPLING blocked
→ HEALTH_ANOMALY blocked as primary activity-HR evidence
```

```text
LOW confidence + reliable power
→ power evidence remains usable
```

```text
LOW confidence + completed activity
→ completion remains recognized
```

### Cross-language contract

Add a contract test that takes Python-normalized enriched activity JSON and runs it through the real TypeScript parser. This guards against a Python-side additive schema change invalidating the entire activity window.

---

## Observability

Use existing evidence/replay mechanisms rather than building a new analytics platform.

Minimum aggregates:

```text
hr_fidelity_coverage_pct
hr_source_wrist_pct
hr_source_external_pct
hr_source_mixed_possible_pct
hr_source_unknown_pct
hr_confidence_high_pct
hr_confidence_moderate_pct
hr_confidence_low_pct
hr_confidence_unreliable_pct
artifact_isolated_spike_count
artifact_dropout_count
artifact_cadence_lock_count
artifact_workload_discordance_count
zone_authority_blocked_count
load_authority_blocked_count
max_hr_authority_blocked_count
decoupling_authority_blocked_count
```

Avoid broad telemetry containing raw HR or sensor identifiers.

---

## Release gates

### Shadow release

Required:

- HRF0 complete;
- ADR-0031 accepted;
- HRF1–HRF7 tests green;
- fidelity failures cannot fail activity sync;
- no raw FIT persistence;
- no recommendation changes;
- UI language describes **measurement confidence**, not athlete physiology.

### Production Stage A

Required:

- HRF8 replay reviewed;
- paired reference evidence available for at least the high-risk modality being activated, or scope explicitly limited;
- false-positive review complete;
- separate activation decision accepted;
- fail-closed tests for high-risk consumers.

### Production Stage B

Required:

- Stage A operational evidence;
- demonstrated value for zones/load/compliance;
- fallback quality documented;
- no material increase in incorrect/unavailable training interpretation.

### Personal prior

Required:

- repeated paired sessions;
- out-of-sample evaluation;
- stability over time;
- device identity/version tracked sufficiently to avoid invalid inheritance.

---

## Rollback

### Ingestion/shadow rollback

Disable the HR fidelity feature flag. Core activity sync continues and existing `hrMeasurement` fields remain inert.

### Production authority rollback

Production policy must be versioned so authority can return to legacy behavior without deleting historical fidelity/replay evidence.

---

## Recommended PR decomposition

### HRF-A — evidence spike + ADR finalization

- HRF0 report;
- decoder decision;
- ADR acceptance update;
- no production behavior.

### HRF-B — FIT ingestion contracts

- canonical contracts;
- original FIT wrapper;
- decoder boundary;
- sensor inventory;
- synthetic fixtures;
- feature default-off.

### HRF-C — deterministic diagnostics

- trace diagnostics;
- motion-risk prior;
- confidence combiner;
- Python tests.

### HRF-D — persistence + parser + authority engine

- additive `hrMeasurement`;
- TypeScript parser contract;
- `activityHrFidelity.ts`;
- shadow policy only.

### HRF-E — consumer audit + shadow observability

- HR consumer inventory;
- shadow evidence;
- activity-detail explanation;
- replay tooling.

### HRF-F — evidence report

- historical replay;
- paired-reference study;
- ship/no-ship recommendation;
- no production change.

### HRF-G — production gating

Only after explicit activation approval.

### HRF-H — personal priors

Only after the usage/evidence trigger is satisfied.

---

## Definition of done

The capability is complete when:

- [ ] real FIT files were audited;
- [ ] source-switch semantics are represented safely;
- [ ] sensor/source evidence is preserved;
- [ ] raw HR trace quality is assessed deterministically;
- [ ] no raw FIT/trace is persisted in normal activity documents;
- [ ] normalized activity carries compact fidelity evidence;
- [ ] TypeScript parsing degrades gracefully;
- [ ] use-case-specific HR authority exists;
- [ ] all HR consumers are inventoried;
- [ ] measurement confidence cannot reduce readiness by itself;
- [ ] artifact-sensitive features fail closed after activation;
- [ ] power/RPE/structure fallbacks preserve usable activity evidence;
- [ ] historical replay is run;
- [ ] paired reference evidence is collected where practical;
- [ ] production activation is a separate reviewed decision;
- [ ] rollback is available;
- [ ] living architecture/runbook docs are updated after implementation.

---

## Recommended order

```text
HRF0  prove what Garmin actually exposes
  ↓
ADR-0031 acceptance
  ↓
HRF1  domain contracts
  ↓
HRF2  FIT acquisition + sensor inventory
  ↓
HRF3  deterministic signal diagnostics
  ↓
HRF4  compact persistence
  ↓
HRF5  use-case authority engine
  ↓
HRF6  audit every HR consumer
  ↓
HRF7  shadow/replay observability
  ↓
HRF8  real evidence
  ↓
      explicit activation decision
  ↓
HRF9  conservative production gating
  ↓
HRF10 personal calibration only when enough data exists
  ↓
HRF11 living docs / operations
```

The first product benefit is preventing **false evidence multiplication**:

```text
one corrupted HR trace
    ↓
average HR
HR zones
max HR
HR-derived load
decoupling
threshold candidate
health-response interpretation
```

These descendants should inherit the authority of the underlying measurement rather than appearing as independent facts.

> **Uncertain measurement means less evidence — not a worse athlete.**
