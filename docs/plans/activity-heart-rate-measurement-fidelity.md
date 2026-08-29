# HRF — Activity Heart-Rate Measurement Fidelity & Decision Authority

* **Status:** `Approved`
* **Proposed:** 2026-08-29
* **Blocked by:** FIT SDK licensing decision before HRF2
* **Unlocks:** source-aware HR trust, artifact-resistant HR-zone/load interpretation, safe max-HR/threshold/decoupling gating, and athlete/device/activity-specific HR reliability calibration
* **Source analysis:** [`2026-08-29-activity-hr-measurement-confidence-analysis.md`](../analysis/2026-08-29-activity-hr-measurement-confidence-analysis.md)
* **HRF0 evidence:** [`2026-08-29-garmin-activity-hr-fit-provenance-spike.md`](../analysis/2026-08-29-garmin-activity-hr-fit-provenance-spike.md)
* **Decision record:** [ADR-0031](../adr/0031-activity-heart-rate-measurement-fidelity-and-evidence-authority.md)
* **Related plans:** [`garmin-activity-telemetry-ingestion.md`](./garmin-activity-telemetry-ingestion.md), [`physiological-identity-passport-and-measurement-trust.md`](./physiological-identity-passport-and-measurement-trust.md), [`scientific-validation-and-feedback-loop.md`](./scientific-validation-and-feedback-loop.md), [`health-anomaly-and-illness-risk-alerting.md`](./health-anomaly-and-illness-risk-alerting.md)

> **Not a top-level phase.** `HRF*` is a bounded measurement-fidelity capability, like `PI*`, `MS*`, `HA*`, `OV*`, and `SV*`.

> **Safety posture:** low HR measurement confidence removes or bounds HR-derived evidence. It must never independently lower readiness, increase physiological strain, create an illness/anomaly conclusion, or imply poor workout execution.

> **Unknown is not unreliable.** Missing original data, failed enrichment, or insufficient provenance means `UNKNOWN` / not assessed. `UNRELIABLE` is reserved for a trace that was actually assessed and failed quality/coverage checks.

> **Activation posture:** HRF0–HRF7 are additive/shadow work. No production recommendation behavior changes until HRF8 produces reviewed evidence and a separate activation decision is accepted.

---

## Goal

Introduce an explicit, replayable **activity heart-rate measurement fidelity layer** that answers:

> **How trustworthy is the HR evidence recorded for this activity, which stored HR-derived values actually descend from the assessed stream, and for which downstream use is that evidence trustworthy enough?**

The capability must preserve the distinction between:

1. sensor/device presence;
2. HR source provenance;
3. sensor technology;
4. activity/motion difficulty for that technology;
5. actual trace quality and coverage;
6. trace-to-summary lineage/compatibility;
7. fitness for a specific downstream use.

The Garmin implementation should use original FIT evidence where available, but contracts must remain provider-neutral.

---

## Non-goals

This plan does **not**:

- diagnose arrhythmias or cardiovascular disease;
- convert measurement confidence into readiness;
- claim wrist HR is universally bad;
- call a consumer electrical chest strap a clinical ECG system;
- claim electrode chest-strap HR is infallible ground truth;
- infer artifact solely because HR is high/unusual;
- persist raw FIT files or full high-frequency HR series into ordinary Firestore activity documents;
- make high-frequency HR part of the daily recommendation payload;
- activate HR-derived training-load changes merely because fidelity metadata exists;
- replace the physiological identity passport;
- build an opaque ML quality model in v1;
- treat missing FIT/source metadata as negative evidence;
- collapse `UNKNOWN` and `UNRELIABLE`;
- assume every Garmin summary is derived identically from the original FIT stream merely because the activity ID matches;
- use one scalar confidence threshold for every HR-derived feature;
- validate wrist PPG against a reference stream that may itself have been substituted through Garmin Dynamic Source Switching.

---

## Governing invariants

| ID | Invariant |
|---|---|
| **P-HRF-1** | Measurement fidelity is separate from physiological state. Low/unknown HR confidence removes/bounds evidence; it never lowers readiness by itself. |
| **P-HRF-2** | Device presence is not equivalent to sample provenance. |
| **P-HRF-3** | External HR sensor presence does not imply electrode chest strap unless product/technology evidence supports it. |
| **P-HRF-4** | Garmin source switching may produce legitimate mixed-source activities; `mixed_possible` is not synonymous with poor signal quality. |
| **P-HRF-5** | Trace quality can downgrade any hardware prior, including a chest strap. |
| **P-HRF-6** | A clean trace cannot automatically upgrade a difficult wrist/activity combination to `HIGH` without sufficient provenance or personal validation. |
| **P-HRF-7** | `UNKNOWN` means insufficient assessment evidence; `UNRELIABLE` means assessed-and-failed. Missing enrichment must never become a negative quality label by schema coercion. |
| **P-HRF-8** | Fitness for use is use-case-specific. A trace may be displayable while blocked for max-HR, threshold, decoupling or health inference. |
| **P-HRF-9** | Severe missingness/dropout is not repaired into high confidence by interpolation. |
| **P-HRF-10** | Artifact detection uses independent context when available and never treats another HR-derived child metric as independent corroboration. |
| **P-HRF-11** | HR-derived child features inherit the parent trace's authority only when their lineage to that trace is established. |
| **P-HRF-12** | FIT-trace quality cannot be blindly attached to a Garmin Connect summary that is discordant or has unknown derivation compatibility. |
| **P-HRF-13** | Provider-specific FIT field names stay at the Garmin boundary; engine contracts remain provider-neutral. |
| **P-HRF-14** | FIT/trace parsing failure must not fail the core activity sync. |
| **P-HRF-15** | No raw real-account FIT fixture is committed. |
| **P-HRF-16** | Personal calibration is evaluated out of sample and keyed to athlete/device/sensor/activity context. |
| **P-HRF-17** | Population literature supplies priors, not per-athlete truth. |
| **P-HRF-18** | Production authority changes are versioned, replayable and separately approved after shadow evidence. |
| **P-HRF-19** | Paired wrist/reference validation requires independent measurement channels; source-switched/reference-contaminated comparisons are rejected. |
| **P-HRF-20** | A feature-specific artifact can block a sensitive use (for example max-HR) without automatically invalidating every less-sensitive use of the activity. |

---

## Terminology

### Electrode chest strap vs ECG

Use:

```text
electrode_chest_strap
```

for consumer chest-worn electrical HR sensors.

Reserve:

```text
ECG
```

for a true electrocardiographic criterion/reference system. A consumer electrode chest strap is a strong practical field reference, not clinical ECG ground truth.

### Unknown vs unreliable

```text
UNKNOWN
= not enough evidence to assess confidently

UNRELIABLE
= assessed and severe measurement-quality failure was observed
```

This distinction is load-bearing for safe downstream behavior.

---

## Relationship to existing capabilities

### Garmin per-activity telemetry (`G`)

`garmin-activity-telemetry-ingestion.md` already provides:

- `CanonicalActivity` / `CanonicalActivityDetail`;
- per-activity persistence;
- `averageHr`;
- `hrInZones`;
- lap summaries including `averageHrBpm`;
- additive optional parsing;
- failure isolation.

HRF extends that path rather than creating a parallel activity store.

The existing implementation also creates an important lineage question: `averageHr` comes from the activity-list payload while HR zones and lap summaries come from separate Garmin Connect endpoints. The proposed FIT diagnostics operate on the original activity file. HRF must reconcile those representations before assigning the FIT trace's authority to each summary.

### Physiological Identity Passport (`PI`)

PI answers whether an observation belongs to the authenticated athlete. HRF answers whether the HR measurement is technically trustworthy for a particular inference. These must remain separate.

### Scientific Validation (`SV`)

HRF owns domain-specific signal-quality contracts and shadow evidence. SV may consume those outputs for broader marginal-information and feedback-loop analysis.

### Health anomaly (`HA`)

HA must not treat low-confidence activity HR as strong physiological anomaly evidence. HRF supplies the authority boundary rather than duplicating sensor-quality heuristics inside HA.

---

## Repository facts verified during design review

The plan should not leave already-verified repository/dependency facts as open questions.

- `pyproject.toml` declares `garminconnect>=0.3.8,<0.4`.
- Upstream `python-garminconnect` in this dependency family exposes `download_activity(...)` and `ActivityDownloadFormat.ORIGINAL`; its original form returns raw bytes and is documented as typically a ZIP the caller extracts.
- `GarminDataClient` / `GarminClientWrapper` do **not** currently expose that original-download method.
- `CanonicalActivity.average_hr`, `CanonicalActivityDetail.hr_zones` and lap-average HR are already present.
- `normalize_activity(...)` persists those values into the existing per-activity Firestore record.
- Existing optional activity-detail parsing/failure isolation must remain intact.

HRF0 still verifies the exact installed/locked version and real-account response, because a dependency range and upstream source do not prove live endpoint behavior.

---

## Decisions required

[ADR-0031](../adr/0031-activity-heart-rate-measurement-fidelity-and-evidence-authority.md) records the proposed decisions below and must be accepted before HRF1 production-facing schema work.

| ID | Proposed decision | Why it matters |
|---|---|---|
| **D-HRF-AUTHORITY** | HR fidelity gates evidence authority; low/unknown confidence is never negative readiness evidence | Core safety invariant |
| **D-HRF-PROVENANCE** | Sensor presence, source provenance and sensor technology are separate | Garmin source switching makes naive attribution wrong |
| **D-HRF-TRACE** | Actual trace diagnostics remain visible to use-case policy | One global label is too blunt for peak-vs-average sensitivity |
| **D-HRF-LINEAGE** | Trace authority transfers to summaries only after compatibility/lineage is established | Multiple Garmin ingestion paths may process HR differently |
| **D-HRF-USECASE** | Authority is use-case-specific | A single global threshold is unsafe |
| **D-HRF-RAW** | Derive compact evidence transiently; do not persist raw FIT by default | Privacy/data-minimization boundary |
| **D-HRF-SHADOW** | Initial implementation is shadow-only | Prevents silent production changes |
| **D-HRF-REFERENCE** | Paired validation uses independent streams | Avoid circular validation from Dynamic Source Switching |
| **D-HRF-DECODER** | Prefer Garmin official FIT Python SDK if practical; otherwise approve an alternative after the spike | Decoder correctness/maintenance/license matter |

---

## Task board

| Item | Title | Status | Blocked by | Decision impact |
|---|---|---|---|---|
| HRF0 | Real-account FIT provenance, lineage & decoder spike | `[x]` | — | evidence only |
| HRF1 | Provider-neutral HR fidelity contracts | `[x]` | HRF0, ADR-0031 | none |
| HRF2 | Garmin original-FIT acquisition + sensor inventory | `[ ]` | HRF0, HRF1 | none |
| HRF3 | Deterministic HR trace-quality diagnostics | `[ ]` | HRF1, HRF2 | shadow only |
| HRF4 | Canonical mapping + additive Firestore persistence | `[ ]` | HRF1–HRF3 | none |
| HRF5 | TypeScript parser + activity HR authority engine | `[ ]` | HRF4 | shadow only |
| HRF6 | HR-consumer/lineage audit + explicit authority adapters | `[ ]` | HRF5 | no production change |
| HRF7 | Shadow telemetry, replay journal and UI observability | `[ ]` | HRF5, HRF6 | evidence only |
| HRF8 | Historical replay + independent prospective paired-reference study | `[ ]` | HRF7 | ship/no-ship evidence |
| HRF9 | Conservative production gating | `[ ]` | HRF8 + activation decision | production |
| HRF10 | Personal device × activity reliability priors | `[ ]` usage-triggered | independent paired reference history | later candidate |
| HRF11 | Living architecture, runbook and regression matrix | `[ ]` | HRF9 or shadow-only closeout | docs/ops |

---

# HRF0 — Real-account FIT provenance, lineage & decoder spike

## Why first

The most important unknown is what this account's original Garmin activity files actually expose and how those FIT values relate to the Garmin Connect summaries the repository already stores.

Do not design a per-sample source model around documentation assumptions. Do not attach FIT-derived fidelity to existing summary values until their lineage is checked.

## Required probe matrix

Inspect at least one available activity for:

| Case | Required |
|---|---|
| Garmin watch, no external HR sensor | yes |
| Garmin watch + known Garmin electrode chest strap | yes if history contains one |
| Third-party external HR | if available |
| Dynamic Source Switching-capable watch + strap | if applicable |
| steady cycling | yes |
| cycling intervals | yes |
| running | yes |
| strength | yes |
| airbike/high-arm-motion cardio | yes |
| soccer/field | if available |

Record unavailable cases as `not observed`; do not synthesize conclusions.

## Original-download questions

Known from dependency inspection:

- the declared `garminconnect>=0.3.8,<0.4` family exposes `download_activity(..., ORIGINAL)` upstream;
- the repository wrapper does not expose it yet;
- upstream describes original download as raw bytes, typically a ZIP containing the activity file.

HRF0 must still answer empirically:

- which exact `garminconnect` version is installed/locked in production/CI;
- whether `ORIGINAL` succeeds for representative real activities;
- whether response is ZIP, FIT, or another observed shape;
- what unavailable activity, auth, 429 and server failures look like;
- whether older activities remain downloadable;
- approximate request/rate-limit behavior.

## FIT provenance questions

Inspect:

- which `device_info` records are present;
- creator `device_index` and accessory device indexes where emitted;
- manufacturer/product/device type/source-type metadata where available;
- whether external HR product/device type can distinguish electrode chest strap vs optical external HR;
- whether explicit sample-level HR source exists;
- whether source switches can be reconstructed;
- whether separate wrist/external HR streams are present;
- which HR/cadence/power/timestamp fields exist;
- how developer fields and corrupt/truncated files behave;
- whether source-switch capability can be established safely from recording-device/product/firmware context.

### Source classification rule during the spike

```text
external sensor present
!= confirmed external HR source
```

If Dynamic Source Switching is possible and no sample/source proof exists, record `mixed_possible` / ambiguous rather than strap-only.

## Trace-to-summary reconciliation

For each representative activity, compare FIT-derived or FIT-reconstructable values with the repository's existing Garmin Connect values:

- activity-list `averageHr`;
- peak/max HR if available through an existing path or FIT;
- split/lap `averageHrBpm`;
- `hrInZones`, using the same configured zone boundaries where possible;
- timer duration/paused time relevant to the denominator.

Classify each summary relationship:

```text
VERIFIED_SAME_EFFECTIVE_TRACE
CONSISTENT_BUT_NOT_PROVEN
DISCORDANT
NOT_COMPARABLE
```

The report must identify which existing summaries can inherit assessed FIT authority and which require a separate lineage/compatibility field.

A matching activity ID alone is insufficient proof.

## Garmin vendor-derived load lineage

Verify/document current Garmin public semantics for `activityTrainingLoad` / Exercise Load.

Garmin currently describes Training Load as EPOC-based and its engine as analysing heartbeat data; therefore the default HRF classification is:

```text
activityTrainingLoad
= vendor-derived, materially HR-dependent evidence
```

unless a specific device/activity path proves a materially different independent derivation.

Do not use `activityTrainingLoad` as independent corroboration of a suspect parent HR trace.

## Decoder spike

Try the official Garmin FIT Python SDK first.

Accept it when it:

- works under the repository runtime/CI target;
- decodes representative real files;
- handles unknown/developer fields safely;
- fails safely on CRC/truncation;
- provides enough access to `device_info` and `record` fields for HRF;
- has an acceptable licensing/redistribution story.

If not, evaluate a maintained alternative and document the choice before implementation.

## Output

Create a dated analysis:

```text
docs/analysis/YYYY-MM-DD-garmin-activity-hr-fit-provenance-spike.md
```

It must include:

- exact installed dependency/version and original-download behavior;
- observed message shapes;
- sanitized source/device evidence;
- decoder decision;
- source-switch findings;
- trace-to-summary reconciliation results;
- vendor-load lineage note;
- request/download behavior.

## Fixture/privacy rule

Never commit a real raw FIT file. Fixtures must be synthetic or aggressively reduced/fabricated using real key names only. Strip exact timestamps, GPS, owner IDs, serials, real HR and real activity IDs.

## Done when

- real-account probe report exists;
- known-strap and wrist-only files were compared where history permits;
- per-sample provenance is classified as possible, impossible or still unknown;
- trace-to-summary relationships are explicitly classified;
- Garmin load lineage is documented;
- decoder choice is explicit;
- no production schema/behavior changed.

---

# HRF1 — Provider-neutral HR fidelity contracts

Add provider-neutral contracts in `src/garmin_sync/canonical.py`.

Suggested conceptual shape:

```python
HrSensorTechnology = Literal[
    "electrode_chest_strap",
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

HrMeasurementConfidence = Literal[
    "high",
    "moderate",
    "low",
    "unreliable",
    "unknown",
]

HrSummaryCompatibility = Literal[
    "verified_same_effective_trace",
    "consistent_unproven",
    "discordant",
    "not_comparable",
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
    measurement_confidence: HrMeasurementConfidence
    summary_compatibility: HrSummaryCompatibility = "unknown"
    artifact_flags: tuple[str, ...] = ()
    reasons: tuple[str, ...] = ()
    diagnostic_version: str = "1.0.0"
```

If HRF0 proves that one stable compatibility contract covers all v1 persisted summaries, `summary_compatibility` MAY remain an internal assessment rather than persisted per activity. The implementation must still document and test that contract.

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
SUMMARY_TRACE_DISCORDANCE
ASSESSMENT_UNAVAILABLE
```

Avoid a broad `PHYSIOLOGICAL_IMPLAUSIBILITY` catch-all in v1; it is too easy to label unusual real physiology as sensor error.

### Hard semantic rule

```text
measurement_confidence = "unknown"
```

is valid and required when assessment cannot establish quality.

Do not coerce it to `low`/`unreliable` for convenience.

### Done when

- Garmin FIT key names do not leak into canonical types;
- source, technology, provenance, quality and lineage are separate;
- unknown/ambiguous is first-class;
- consumer electrode straps are not named `ecg_chest_strap`;
- no downstream recommendation uses the new types yet.

---

# HRF2 — Garmin original-FIT acquisition + sensor inventory

## Client boundary

Extend `src/garmin_sync/garmin_client.py` on both `GarminDataClient` and `GarminClientWrapper`.

The implementation should wrap the already-verified upstream primitive rather than invent a new HTTP path:

```python
def download_activity_original(self, activity_id: str) -> bytes | None: ...
```

Conceptually the wrapper should call upstream:

```python
api.download_activity(
    activity_id,
    dl_fmt=Garmin.ActivityDownloadFormat.ORIGINAL,
)
```

using the exact enum/import form verified in HRF0 for the installed dependency.

Requirements:

- existing authentication behavior;
- `None` only for a specifically classified legitimate-unavailable original;
- auth/rate-limit/transport failures remain explicit;
- binary content never logged;
- caller must not assume bytes are bare FIT; HRF0 establishes ZIP/FIT handling.

## Feature gate

Add an opt-in config such as:

```text
GARMIN_ACTIVITY_HR_FIDELITY_ENABLED=false
```

Initial default: off.

FIT fidelity fetching should be bounded to current/target activities and must not repeatedly redownload lookback activities on every daily sync.

Do **not** gate only on hard intensity: easy sessions matter for decoupling, zone fidelity and validation.

## FIT decoder boundary

Add a Garmin-specific module, suggested:

```text
src/garmin_sync/fit_activity.py
```

Responsibilities:

- unwrap ZIP if necessary;
- decode FIT;
- extract sensor/device inventory;
- extract transient HR/cadence/power/timer samples required for diagnostics;
- expose provider-neutral intermediate evidence;
- optionally derive/reconstruct values needed for summary reconciliation;
- never write Firestore directly.

Unknown sensor products remain `external_unknown`; do not fuzzy-guess technologies.

If HRF0 cannot recover per-sample source, a switching-capable strap activity may be represented as `mixed_possible` / ambiguous rather than strap-only.

## Failure isolation

Download/decode failure logs a structured warning, leaves base activity sync intact and produces absent/`unknown` fidelity.

Do not emit `unreliable` merely because decode failed.

### Done when

- wrapper success/no-file/auth/rate-limit tests exist;
- synthetic FIT fixture decodes;
- external HR inventory is extracted;
- unknown technology remains unknown;
- switching-capable ambiguous source does not become confirmed external;
- no raw FIT bytes reach Firestore;
- target-date request budget is tested.

---

# HRF3 — Deterministic HR trace-quality diagnostics

Create:

```text
src/garmin_sync/hr_fidelity.py
```

V1 must be deterministic, versioned and explainable.

## HRF3.1 Assessment state

Before scoring quality, distinguish:

```text
ASSESSABLE
PARTIALLY_ASSESSABLE
UNASSESSABLE
```

An unassessable trace yields measurement confidence `unknown`, not `unreliable`.

## HRF3.2 Coverage

Compute sample/window coverage, longest gap, gap count and sampling irregularity.

Use the actual active/timer analysis window when available; pauses must not automatically look like sensor dropout.

Do not interpolate before fidelity assessment.

## HRF3.3 Abrupt jump/drop

Use local windows, local median, persistence and independent workload transition context. Avoid a brittle universal bpm-per-second threshold.

## HRF3.4 Isolated spikes

Detect very short peaks that can corrupt max HR and zone-5 exposure.

Keep this flag available to use-case authority. A short isolated spike may block `MAX_HR_UPDATE` while leaving a robust session average usable.

## HRF3.5 Dropout

Detect missing chunks, invalid/zero values where relevant and long gaps.

Differentiate true recording gaps from stopped/paused timer windows where possible.

## HRF3.6 Stale plateau

Flag a long near-flat HR only when independent workload evidence changes enough to make tracking failure plausible. Stable Z2 HR alone is not an artifact.

## HRF3.7 Cadence/harmonic lock

Cadence-lock logic must be modality-aware.

Examples:

- running: sustained `HR ≈ cadence` can be a candidate;
- cycling: a harmonic such as `HR ≈ 2 × cadence` can be plausible.

Do not apply every ratio to every sport. Require persistence, tolerance bands, enough cadence coverage and contextual inconsistency. Emit `*_SUSPECTED`, never confirmed artifact in v1.

## HRF3.8 Workload discordance

Use independent external load where available:

- cycling: power/cadence;
- running: pace/grade/workout step;
- strength: exercise structure rather than continuous HR.

Respect normal physiological HR lag.

## HRF3.9 Source-switch signature

Only implement if HRF0 shows useful evidence. A possible abrupt noise/level change may add `SOURCE_SWITCH_POSSIBLE`, but cannot prove switching.

## HRF3.10 Motion-risk prior

Map activities into a small provider-neutral risk vocabulary rather than a huge Garmin taxonomy.

Conservative examples for **wrist-motion artifact risk**:

```text
MODERATE: steady running, steady cycling
HIGH: airbike, rowing, resistance training, active-arm elliptical, field/contact sport
```

This is a prior used jointly with sensor technology, not a declaration that all HR sensors are equally challenged by the activity.

## HRF3.11 Confidence combiner

Use rules/caps, not pseudo-probabilities:

```text
assessment unavailable / insufficient evidence
-> UNKNOWN

severe coverage failure after successful assessment
-> UNRELIABLE

severe artifact pattern
-> cap at LOW or UNRELIABLE according to versioned severity rule

unknown provenance
-> cannot become HIGH in v1

wrist + high-motion
-> cannot become HIGH from clean trace alone

external strap present + mixed_possible / ambiguous
-> cannot become HIGH from presence alone

confirmed electrode-chest-strap source + clean trace + good coverage
-> HIGH candidate
```

The combiner's global label is for compact observability. It does not replace per-use artifact/lineage policy.

### Done when

- detector tests include realistic negative controls such as interval transitions and pauses;
- severe chest-strap dropout downgrades confidence;
- unassessable data yields `UNKNOWN` rather than `UNRELIABLE`;
- clean high-motion wrist trace remains conservatively capped;
- external strap presence with ambiguous source does not become `HIGH`;
- isolated spike can invalidate peak authority without necessarily invalidating session-average authority;
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
    "summaryCompatibility": "verified_same_effective_trace",
    "artifactFlags": ["ISOLATED_SPIKE"],
    "diagnosticVersion": "1.0.0"
  }
}
```

If HRF0 establishes that summary compatibility cannot be represented honestly as one activity-wide value, persist a small per-summary compatibility object instead of lying with one scalar, for example:

```json
{
  "summaryCompatibility": {
    "averageHr": "verified_same_effective_trace",
    "hrInZones": "consistent_unproven",
    "lapHr": "verified_same_effective_trace"
  }
}
```

Do not add this complexity unless the spike shows it is needed.

Requirements:

- same activity upsert, no second detail-only write;
- no schema-version change that invalidates older TypeScript readers;
- malformed `hrMeasurement` must degrade to absent/unknown without invalidating the base activity;
- no raw samples, GPS, owner IDs or sensor serials persisted;
- old documents without the field mean `not assessed`, not low confidence;
- a partially populated object may explicitly carry `measurementConfidence: "unknown"`;
- `unreliable` is never used as a fallback for failed enrichment;
- summary compatibility must fail conservatively when discordant.

### Done when

- enriched records pass the real TypeScript parser contract;
- malformed fidelity metadata does not collapse the activity window;
- one activity still produces one normal upsert;
- persisted output contains no raw/identifying sensor data;
- old/no-fidelity records remain semantically `not assessed`;
- discordant summary lineage cannot inherit a high trace authority.

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

The helper receives the full compact HRF evidence needed by the use case, not only a confidence enum.

Conceptually:

```ts
const authority = getHrUseAuthority(activity, 'MAX_HR_UPDATE');
```

may inspect:

- measurement confidence;
- source/provenance;
- coverage;
- artifact flags relevant to peaks;
- summary compatibility/lineage;
- policy version.

Initial **shadow** policy:

| Use case | High | Moderate | Low | Unreliable / unknown |
|---|---|---|---|---|
| Display average/trace | allowed | allowed | observational | observational |
| HR zones | allowed if lineage valid | bounded | blocked by default | blocked |
| HR-derived load | allowed if lineage valid | bounded | blocked | blocked |
| Aerobic decoupling | allowed if segment/lineage valid | blocked initially | blocked | blocked |
| Interval response | allowed if segment/lineage valid | bounded | blocked | blocked |
| Max-HR update | allowed + peak/context/lineage checks | blocked | blocked | blocked |
| Threshold-HR update | allowed + protocol/context/lineage | blocked | blocked | blocked |
| Workout compliance | allowed | bounded | blocked | blocked |
| Health anomaly | only with HA corroboration | observational at most | blocked | blocked |

### Feature-specific overrides

Examples:

```text
ISOLATED_SPIKE
-> MAX_HR_UPDATE BLOCKED
```

without automatically requiring:

```text
DISPLAY_AVERAGE BLOCKED
```

and:

```text
SUMMARY_TRACE_DISCORDANCE for hrInZones
-> ZONE_DISTRIBUTION BLOCKED
```

while independently verified average HR can remain observational/allowed according to its own authority.

`dataConfidence.ts` may surface this in observability, but sensitive consumers must use the actual authority helper rather than relying on a dashboard badge.

### Done when

- authority is deterministic/versioned;
- every use case has tests;
- `UNKNOWN` is represented distinctly;
- low/unknown confidence cannot lower readiness;
- unknown fails closed for high-risk inference but remains displayable as observational context;
- per-use artifact flags can be stricter than global confidence;
- summary-lineage mismatch blocks the affected consumer;
- no production consumer is switched yet.

---

# HRF6 — HR-consumer/lineage audit + explicit authority adapters

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
trainingEffect / EPOC-derived vendor fields where relevant
```

For each consumer record:

```text
consumer
input field
HR-derived?
source/derivation known?
parent HR stream/lineage
independent corroboration?
HrUseCase
current authority
future HRF behavior
fallback
```

### Garmin `activityTrainingLoad`

Garmin currently documents Training Load / Exercise Load as EPOC-based and its engine as analysing heartbeat data. Treat `activityTrainingLoad` as HR-lineage evidence by default, not independent corroboration, unless the audit documents a specific independent derivation for the device/activity path.

### Existing summaries

For `averageHr`, `hrInZones` and lap HR, record the HRF0 reconciliation result. A consumer must not inherit FIT authority from an unknown/discordant summary relationship.

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
- vendor-derived HR lineage is documented rather than counted independently;
- existing Garmin summary compatibility is documented;
- no high-risk consumer can bypass authority in shadow simulation;
- production behavior is still unchanged.

---

# HRF7 — Shadow telemetry, replay journal and UI observability

For each enriched activity derive:

```text
assessment state
measurement confidence
source/provenance
summary compatibility
artifact flags
per-use authority
what current production used
what HRF would allow/block/bound
```

Measure at minimum:

- FIT-fidelity assessable coverage;
- assessment-unknown rate and reasons;
- wrist/external/mixed/unknown source distribution;
- confidence by activity class;
- artifact prevalence;
- summary-reconciliation/discordance rate;
- HR-zone/load candidate blocks;
- max-HR candidate blocks;
- decoupling blocks;
- poor-trace cases despite strap presence;
- useful wrist traces preserved;
- cases where one use is blocked while a less-sensitive HR use remains allowed/observational.

Activity detail may show a small read-only explanation, for example:

```text
HR measurement: Low confidence
Reason: wrist optical HR + high arm motion + isolated spikes
```

or:

```text
HR measurement: Not assessed
Reason: original activity data unavailable
```

Do not display `Unreliable` for a missing assessment.

Do not expose pseudo-precise values such as `HR accuracy = 87%` unless later reference calibration supports that meaning.

### Done when

- shadow evidence is replayable;
- activity detail can explain quality when present;
- missing fidelity does not create alarming UI;
- summary-lineage mismatch is observable;
- recommendations are unchanged.

---

# HRF8 — Historical replay + independent prospective paired-reference study

This item produces the evidence required for production activation.

## Historical replay

Use historical activities whose original FIT remains available. Stratify by:

- source evidence;
- activity class;
- motion risk;
- intensity;
- recording device period where identifiable;
- summary compatibility.

Report:

- assessable coverage;
- unknown-assessment coverage/reasons;
- source distribution;
- artifact rates;
- summary-reconciliation rates;
- authority changes;
- affected downstream features;
- feature-specific blocks vs whole-activity blocks;
- manual review of suspicious/false-positive cases.

Self-consistency replay does not by itself validate measurement accuracy.

## Prospective wrist vs electrode-chest-strap study

Collect repeated representative sessions. Prioritize:

1. steady cycling;
2. cycling intervals;
3. airbike;
4. steady running;
5. running intervals;
6. strength;
7. soccer/field if practical.

Treat an electrode chest strap as a strong practical reference, not perfect/clinical ECG ground truth.

### Independence is mandatory

Garmin Dynamic Source Switching creates a circular-validation hazard: if a paired strap can substitute into the watch's stored HR stream, comparing that stored stream with the strap can produce artificially good agreement.

Every paired session must document how stream independence is guaranteed, e.g.:

- external HR/source switching disabled for the wrist-recording device while the strap is captured independently;
- strap recorded to a separate independent device/application while the watch records wrist-only PPG;
- another setup with exported evidence proving the two streams do not substitute for one another.

Reject a paired sample if independence cannot be demonstrated.

### Alignment protocol

Predefine:

- clock synchronization method;
- common analysis window;
- handling of pauses;
- source sample rate;
- resampling/interpolation method used **only for comparison**, after raw-quality assessment;
- maximum allowable alignment uncertainty.

Do not tune alignment independently per result to improve agreement.

### Metrics

Evaluate:

- mean bias;
- MAE/RMSE;
- p95 absolute error;
- Lin concordance;
- Bland–Altman bias/limits;
- % within ±5/±10 bpm;
- dropout/gaps;
- lag/cross-correlation;
- HR-zone disagreement;
- max-HR disagreement;
- downstream load/decision disagreement.

Do not approve on correlation or mean error alone.

## Activation report must answer

1. Does HRF block clear artifacts?
2. Does it preserve clean useful wrist traces?
3. Does it distinguish `UNKNOWN` from assessed failure correctly?
4. Does it reduce false max-HR/threshold/decoupling evidence?
5. Does it avoid flagging normal interval kinetics and pauses?
6. Does feature-specific policy avoid over-blocking whole activities?
7. Does trace-to-summary reconciliation prevent authority misapplication?
8. Does it change enough downstream behavior to justify complexity?
9. Is missing-FIT coverage acceptable?
10. Are confidence labels understandable/stable?
11. Were paired reference streams independently recorded?

### Done when

- historical replay report exists;
- paired-reference report exists or explicitly documents insufficient evidence;
- paired-data independence is documented per included session;
- false-positive examples are reviewed;
- summary-lineage discordances are explained or gated;
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

`UNKNOWN` and `UNRELIABLE` can both fail closed for a high-risk use while retaining different telemetry/reason semantics.

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

### Vendor load

Garmin `activityTrainingLoad` / EPOC-derived load is not an independent fallback when its parent HR authority is insufficient unless the audited device/activity derivation proves independence.

### Done when

- activation decision is linked;
- every changed consumer has before/after tests;
- fallback behavior is explicit;
- low/unknown HR confidence cannot independently lower readiness;
- activity completion remains recognized;
- evidence traces explain exclusions;
- summary-lineage and vendor-derived lineage gates are enforced.

---

# HRF10 — Personal device × activity reliability priors

**Usage-triggered:** build only when enough **independent** paired wrist/reference sessions exist for a repeated activity class.

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

Reference-contaminated sessions that violate D-HRF-REFERENCE do not count toward `sampleCount` or `validatedMinutes`.

---

# HRF11 — Living architecture, runbook and regression matrix

Create living docs only after production activation or an explicit shadow-only closeout, so they describe shipped behavior rather than aspiration.

Suggested:

```text
docs/architecture/activity-heart-rate-fidelity.md
docs/ops/activity-heart-rate-fidelity.md
```

Architecture should explain:

- ingestion and original-download path;
- source evidence and Dynamic Source Switching semantics;
- transient raw handling;
- assessment-state semantics (`UNKNOWN` vs `UNRELIABLE`);
- trace-to-summary lineage;
- confidence semantics;
- per-use authority and artifact-specific overrides;
- policy versions;
- personal calibration/reference-independence requirements.

Runbook should cover:

- FIT download/decoder failures;
- sudden rises in `UNKNOWN`;
- new sensor IDs/products;
- source-switch capability changes;
- artifact-rate shifts;
- summary-reconciliation regressions;
- rollback and replay operations.

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

Before implementation, HRF0 should replace any remaining conceptual path with the exact repository module once the current TypeScript activity parser/consumer audit is recorded in the spike.

---

## Operational/request budget

Original FIT acquisition adds at least one external request per enriched activity.

### Daily sync

- target/current activities only;
- do not refetch overlapping lookback activities every run;
- FIT failures cannot stop core sync;
- on rate limiting, fidelity enrichment may stop for the run while core persistence continues;
- no automatic repeated download solely because the previous assessment was `UNKNOWN` unless retry policy says the cause is retriable.

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
-> decode in memory/bounded temp storage
-> derive compact evidence
-> discard raw bytes
```

Do not log or persist raw FIT, GPS, sensor serials or full HR arrays under this capability.

If a temporary file is required by the selected SDK, use a bounded private temp location and ensure cleanup on success and exception paths.

---

## Test strategy

### FIT/source tests

- wrist-only FIT;
- known electrode chest strap;
- unknown external HR sensor;
- multiple `device_info` records;
- creator/accessory `device_index` handling;
- missing `device_info`;
- malformed product fields;
- switching-capable ambiguous case;
- explicit sample source if HRF0 finds one;
- ZIP/FIT, corrupt/truncated file, no original;
- upstream original-download unavailable vs auth/429/transport failure.

### Source semantics tests

```text
external strap present + source switching possible + no source proof
-> sourceForActivity != confirmed external
-> provenance ambiguous/mixed_possible
-> cannot become HIGH from presence alone
```

```text
unknown external product
-> external_unknown
-> never fuzzy-converted to electrode_chest_strap
```

### Assessment-state tests

```text
original unavailable / decoder failure / insufficient evidence
-> measurementConfidence UNKNOWN
-> not UNRELIABLE
```

```text
successfully assessed severe dropout
-> UNRELIABLE candidate
```

### Trace tests

- clean steady trace;
- clean interval ramp;
- pause/stopped-timer window;
- isolated spike;
- abrupt drop;
- long dropout;
- repeated short gaps;
- stable legitimate Z2 plateau;
- suspicious plateau while power changes;
- running cadence lock;
- cycling cadence harmonic;
- ratio that would be a false positive in the wrong modality;
- physiological HR lag;
- source-switch-like discontinuity;
- chest-strap dropout.

### Confidence tests

```text
wrist + airbike + isolated spikes
-> LOW or worse
```

```text
wrist + steady run + clean trace
-> MODERATE candidate, not automatically HIGH without personal validation
```

```text
confirmed electrode chest-strap source + good coverage + clean trace
-> HIGH candidate
```

```text
electrode chest strap merely present + mixed_possible
-> not HIGH from presence alone
```

```text
confirmed electrode chest strap + severe dropout
-> downgraded
```

```text
unknown provenance + clean trace
-> confidence capped
```

### Trace-to-summary lineage tests

```text
FIT-derived average reconciles with Garmin average within documented tolerance
-> eligible for verified/consistent lineage according to policy
```

```text
FIT-derived HR zones materially disagree with stored Garmin hrInZones
-> SUMMARY_TRACE_DISCORDANCE
-> ZONE_DISTRIBUTION cannot inherit trace HIGH authority
```

```text
lap HR not comparable because timer/window semantics differ
-> NOT_COMPARABLE/UNKNOWN
-> no silent authority inheritance
```

### Feature-specific authority tests

```text
HIGH overall confidence + ISOLATED_SPIKE
-> MAX_HR_UPDATE BLOCKED
-> DISPLAY_AVERAGE may remain ALLOWED/OBSERVATIONAL if its own lineage/quality checks pass
```

```text
LOW confidence
-> MAX_HR_UPDATE blocked
-> THRESHOLD_HR_UPDATE blocked
-> AEROBIC_DECOUPLING blocked
-> HEALTH_ANOMALY blocked as primary activity-HR evidence
```

```text
UNKNOWN confidence
-> same fail-closed high-risk authority
-> distinct reason/telemetry from UNRELIABLE
```

```text
LOW/UNKNOWN confidence + reliable power
-> power evidence remains usable
```

```text
LOW/UNKNOWN confidence + completed activity
-> completion remains recognized
```

### Vendor-lineage tests

```text
activityTrainingLoad + suspect parent HR
-> not counted as independent corroboration
```

### Paired-reference protocol tests/validation checks

```text
watch activity may contain Dynamic Source Switching from reference strap
-> paired sample rejected unless independence is proven
```

Check alignment metadata and common analysis-window rules are present before accepting a paired record into HRF8/HRF10 evidence.

### Cross-language contract

Add a contract test that takes Python-normalized enriched activity JSON and runs it through the real TypeScript parser. This guards against a Python-side additive schema change invalidating the entire activity window.

Include:

- full valid `hrMeasurement`;
- explicit `measurementConfidence: "unknown"`;
- malformed optional subtree;
- absent subtree;
- unknown future optional artifact flag if parser policy is forward-compatible.

---

## Observability

Use existing evidence/replay mechanisms rather than building a new analytics platform.

Minimum aggregates:

```text
hr_fidelity_assessable_pct
hr_fidelity_unknown_pct
hr_source_wrist_pct
hr_source_external_pct
hr_source_mixed_possible_pct
hr_source_unknown_pct
hr_confidence_high_pct
hr_confidence_moderate_pct
hr_confidence_low_pct
hr_confidence_unreliable_pct
hr_confidence_unknown_pct
hr_summary_verified_pct
hr_summary_discordant_count
artifact_isolated_spike_count
artifact_dropout_count
artifact_cadence_lock_count
artifact_workload_discordance_count
zone_authority_blocked_count
load_authority_blocked_count
max_hr_authority_blocked_count
decoupling_authority_blocked_count
feature_specific_block_without_whole_trace_block_count
```

Avoid broad telemetry containing raw HR or sensor identifiers.

Monitor `UNKNOWN` separately from `UNRELIABLE`: a spike in unknown may indicate endpoint/decoder coverage failure, while a spike in unreliable may indicate measurement/device behavior.

---

## Release gates

### Shadow release

Required:

- HRF0 complete;
- ADR-0031 accepted;
- HRF1–HRF7 tests green;
- fidelity failures cannot fail activity sync;
- missing assessment maps to `UNKNOWN`, not `UNRELIABLE`;
- no raw FIT persistence;
- trace-to-summary compatibility is established/gated;
- no recommendation changes;
- UI language describes **measurement confidence**, not athlete physiology.

### Production Stage A

Required:

- HRF8 replay reviewed;
- paired reference evidence available for at least the high-risk modality being activated, or scope explicitly limited;
- paired-stream independence proven;
- false-positive review complete;
- summary-lineage discordance handled;
- separate activation decision accepted;
- fail-closed tests for high-risk consumers.

### Production Stage B

Required:

- Stage A operational evidence;
- demonstrated value for zones/load/compliance;
- fallback quality documented;
- no material increase in incorrect/unavailable training interpretation;
- feature-specific rules shown to avoid unnecessary whole-activity blocking.

### Personal prior

Required:

- repeated independent paired sessions;
- out-of-sample evaluation;
- stability over time;
- device identity/version tracked sufficiently to avoid invalid inheritance.

---

## Rollback

### Ingestion/shadow rollback

Disable the HR fidelity feature flag. Core activity sync continues and existing `hrMeasurement` fields remain inert.

### Production authority rollback

Production policy must be versioned so authority can return to legacy behavior without deleting historical fidelity/replay evidence.

Rollback must not rewrite historical `UNKNOWN` as `UNRELIABLE` or erase lineage/reconciliation evidence.

---

## Recommended PR decomposition

### HRF-A — evidence spike + ADR finalization

- HRF0 report;
- installed original-download verification;
- trace-to-summary reconciliation;
- decoder decision;
- vendor-load lineage note;
- ADR acceptance update;
- no production behavior.

### HRF-B — FIT ingestion contracts

- canonical contracts including `UNKNOWN`;
- original FIT wrapper;
- decoder boundary;
- sensor inventory;
- synthetic fixtures;
- feature default-off.

### HRF-C — deterministic diagnostics

- assessment-state handling;
- trace diagnostics;
- modality-aware motion/cadence prior;
- confidence combiner;
- Python tests.

### HRF-D — persistence + parser + authority engine

- additive `hrMeasurement`;
- summary compatibility as required by HRF0;
- TypeScript parser contract;
- `activityHrFidelity.ts`;
- feature-specific shadow policy only.

### HRF-E — consumer/lineage audit + shadow observability

- HR consumer inventory;
- Garmin vendor-load lineage;
- shadow evidence;
- activity-detail explanation;
- replay tooling.

### HRF-F — evidence report

- historical replay;
- independent paired-reference study;
- false-positive/over-blocking review;
- ship/no-ship recommendation;
- no production change.

### HRF-G — production gating

Only after explicit activation approval.

### HRF-H — personal priors

Only after the usage/evidence trigger is satisfied with independent paired data.

---

## Definition of done

The capability is complete when:

- [ ] real FIT files were audited;
- [ ] exact original-download behavior of the installed dependency was verified;
- [ ] source-switch semantics are represented safely;
- [ ] sensor/source evidence is preserved;
- [ ] `UNKNOWN` is distinct from assessed `UNRELIABLE`;
- [ ] raw HR trace quality is assessed deterministically;
- [ ] artifact-specific evidence remains available to per-use authority;
- [ ] no raw FIT/trace is persisted in normal activity documents;
- [ ] existing Garmin HR summaries are reconciled or explicitly lineage-gated;
- [ ] normalized activity carries compact fidelity evidence;
- [ ] TypeScript parsing degrades gracefully;
- [ ] use-case-specific HR authority exists;
- [ ] feature-specific artifact policy avoids unnecessary whole-activity rejection;
- [ ] all HR consumers are inventoried;
- [ ] Garmin/vendor HR-derived metrics are not treated as independent corroboration;
- [ ] measurement confidence cannot reduce readiness by itself;
- [ ] artifact-sensitive features fail closed after activation;
- [ ] power/RPE/structure fallbacks preserve usable activity evidence;
- [ ] historical replay is run;
- [ ] prospective paired reference streams are demonstrably independent;
- [ ] paired reference evidence is collected where practical;
- [ ] production activation is a separate reviewed decision;
- [ ] rollback is available;
- [ ] living architecture/runbook docs are updated after implementation.

---

## Recommended order

```text
HRF0  prove Garmin FIT provenance + summary lineage + decoder/original-download behavior
  ↓
ADR-0031 acceptance
  ↓
HRF1  domain contracts incl. UNKNOWN semantics
  ↓
HRF2  FIT acquisition + sensor inventory
  ↓
HRF3  deterministic signal diagnostics
  ↓
HRF4  compact persistence + lineage metadata as needed
  ↓
HRF5  use-case authority engine with artifact-specific overrides
  ↓
HRF6  audit every HR consumer/vendor lineage
  ↓
HRF7  shadow/replay observability
  ↓
HRF8  real replay + independent paired evidence
  ↓
      explicit activation decision
  ↓
HRF9  conservative production gating
  ↓
HRF10 personal calibration only when enough independent data exists
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

The second is preventing **false authority transfer**:

```text
assessed FIT trace
    ↓
DO NOT assume every Garmin Connect summary has identical lineage
    ↓
reconcile / classify compatibility
    ↓
only then inherit authority
```

And the validation rule is equally important:

```text
wrist stream + reference strap
    ↓
prove streams are independent
    ↓
only then calculate agreement
```

These descendants and comparisons should preserve the authority and lineage of the underlying measurement rather than appearing as independent facts.

> **Uncertain measurement means less evidence — not a worse athlete.**
