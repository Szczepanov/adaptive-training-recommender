# Activity Heart-Rate Measurement Confidence — Evidence Review and Architecture Proposal

**Date:** 2026-08-29
**Status:** Analysis / design proposal
**Repository:** `Szczepanov/adaptive-training-recommender`

---

## Executive conclusion

`adaptive-training-recommender` should add an explicit **activity HR measurement-fidelity layer**.

The important problem is not simply that wrist optical HR can be inaccurate. The current activity model can receive HR-derived values without representing:

- likely HR source;
- sensing technology;
- source certainty;
- activity/motion conditions;
- actual trace coverage and artifact evidence;
- whether a downstream summary is demonstrably derived from the assessed trace;
- whether the signal is trustworthy enough for a specific downstream inference.

Scientific validation consistently shows that wrist photoplethysmography (PPG) accuracy is **activity-, device- and movement-dependent**. It is generally strong at rest and can be useful during many steady activities, while motion, gripping, resistance work and active arm movement create harder measurement conditions. Recent validation work also shows that modern optical devices can perform very well across broad activity sets, which reinforces the need for device/activity-specific evidence rather than a blanket rejection of wrist HR.

Electrical/electrode chest straps are usually a stronger practical exercise reference than wrist PPG, but they are not clinical ECG and can still suffer contact, battery, displacement and dropout failures. In this document, **electrode chest strap** is therefore the preferred term; **ECG** is reserved for an electrocardiographic criterion/reference system.

Garmin FIT Activity files provide useful provenance through `device_info`, but this needs careful interpretation. Garmin also supports **Heart Rate Dynamic Source Switching** on compatible devices, where wrist HR and an external strap can both remain available and Garmin can dynamically select the source it considers more reliable. Therefore:

> **External HR sensor present is not equivalent to every HR sample definitely coming from that sensor.**

The central policy should be:

> **HR measurement confidence governs whether HR-derived evidence may influence an inference. Low measurement confidence removes or bounds evidence; it must not itself be interpreted as poor physiological readiness.**

Two additional safeguards are required:

1. **Unknown is not unreliable.** A missing/unassessable FIT file or insufficient provenance means the system does not know the measurement quality. `UNKNOWN` must remain distinct from an assessed trace that is demonstrably unreliable.
2. **Trace quality does not automatically transfer to every Garmin summary.** Before the assessed FIT trace controls `averageHr`, `hrInZones`, lap HR, peak-HR candidates or vendor-derived load, the implementation must establish that those values are derived from the same effective HR stream or otherwise preserve an explicit lineage/compatibility state.

A wrist-only airbike session with a long suspicious plateau and abrupt spikes should still count as completed exercise, but its HR should not automatically be authoritative for zones, max-HR updates, threshold inference, decoupling, HR-derived load or health/anomaly interpretation.

Initial implementation should be additive/shadow-only and validated by replay before changing production decisions.

---

## 1. Garmin provenance: what we can and cannot infer

### FIT `device_info` is useful source evidence

Garmin's FIT SDK documents `Device Info` messages in Activity files. They can describe the recording platform and hardware accessories/sensors associated with an activity, including manufacturer/product information and, where emitted, other device metadata.

That allows an activity sensor inventory such as:

```text
Activity
  ├── recording device: watch / Edge
  ├── external HR sensor: present / absent / unknown
  ├── power meter: present / absent
  ├── cadence sensor: present / absent
  └── other accessories
```

However, this proves **device participation/presence**, not necessarily exact per-sample HR provenance. FIT explicitly describes `Device Info` as metadata for the creator and hardware accessories/sensors that may have been used; it does not guarantee that an accessory supplied every value in a `record` stream.

### Dynamic Source Switching makes naive attribution unsafe

Garmin documents Heart Rate Dynamic Source Switching for compatible watches and HR sensors. The watch can keep wrist optical HR active while an external HR strap is connected and dynamically choose the source it considers more reliable. Garmin's current support documentation explicitly describes switching back and forth when strap signal quality changes.

Therefore this is unsafe:

```text
external HR strap appears in FIT
=> all HR values came from chest strap
```

A safer representation is:

```text
external HR sensor present
+ switching-capable recording context
+ no explicit per-sample source evidence
=> mixed source is possible
```

The repository should explicitly represent `mixed_possible` / ambiguous provenance rather than silently claiming strap-only HR.

A sensor inventory may strengthen a prior, but **presence alone must never satisfy the evidence needed to label the activity HR source as confirmed external**.

### The repository already has a usable original-download primitive upstream

The project currently declares:

```text
garminconnect>=0.3.8,<0.4
```

The current locked CI environment resolves **`garminconnect==0.3.11`**. The upstream `python-garminconnect` API exposes `download_activity(...)` and `ActivityDownloadFormat.ORIGINAL`; its documented implementation returns the raw original download bytes and notes that the `ORIGINAL` form is typically a ZIP that the caller must extract.

The repository wrapper does not expose that method today. HRF0 therefore does **not** need to discover whether the dependency family has an original-download API from scratch. It still must verify real-account response shape, unavailable/error behavior and whether the returned archive contains the FIT evidence required by the design.

### Required empirical check before implementation

The first implementation task should inspect real original `.FIT` activities from this account across:

- wrist-only activity;
- known Garmin electrode chest strap;
- another external HR sensor if available;
- cycling;
- running;
- strength;
- airbike/high-arm-motion cardio;
- soccer/field activity where available.

Inspect:

- `device_info` records, including `device_index` role where present;
- manufacturer/product/device type and any available source-type metadata;
- `record` messages and available HR/cadence/power fields;
- developer fields;
- event messages;
- whether separate HR streams exist;
- whether sample-level source exists;
- whether source switching can be reconstructed;
- whether source-switch capability can be established from the recording device/firmware context without guessing.

Do not design around an assumed per-sample source field until our own files prove it exists and is stable.

### Verify trace-to-summary lineage before attaching authority

The existing application stores Garmin Connect activity summaries (`averageHr`) and separately fetched HR-zone/lap summaries. HRF proposes assessing the original FIT trace. Those paths are likely related, but **likely is not a sufficient lineage contract**.

HRF0/HRF8 should reconstruct what can safely be reconstructed from the FIT stream and compare it with the existing Garmin values:

- average HR;
- peak HR where available;
- lap-average HR;
- HR-zone totals, allowing for Garmin's configured zone boundaries and rounding;
- activity duration / timer boundaries used by each calculation.

Outcomes should be classified explicitly, for example:

```text
VERIFIED_SAME_EFFECTIVE_TRACE
CONSISTENT_BUT_NOT_PROVEN
DISCORDANT
NOT_COMPARABLE
```

If a Garmin summary is discordant or cannot be tied to the assessed stream, the system must not silently inherit the FIT trace's quality/authority for that summary. This matters especially for max-HR updates, zones, lap response and vendor-derived metrics.

---

## 2. Scientific evidence

### Wrist PPG is activity-dependent

Wrist HR watches estimate pulse using photoplethysmography. Motion can alter sensor-to-skin contact, skin deformation, optical coupling, local blood flow and the relationship between the periodic motion signal and the actual cardiovascular pulse.

Bent et al. described **signal crossover**, where rhythmic motion can be mistaken for pulse. This is directly relevant to cadence-like locking and sudden exercise-HR artifacts.

The INTERLIVE expert statement also emphasizes that wearable-HR validity cannot be reduced to one device-wide number: population, criterion, testing condition, processing and device behavior all matter.

### Active arm movement is particularly relevant to airbike

Gillinov et al. compared several optical wearables plus a Polar H7 electrode chest strap with ECG during treadmill, stationary cycling and elliptical exercise. The chest strap showed extremely high concordance with ECG (`rc = 0.996`). Optical devices varied by modality.

Most relevant here: when elliptical arm levers were used, **none of the tested optical devices met the study's accuracy criterion**.

That study does not directly validate a modern Garmin watch on an airbike, but the mechanical conditions are highly relevant:

- repeated push/pull arm motion;
- sustained gripping;
- forearm contraction;
- changing wrist position/contact pressure;
- vibration;
- simultaneous leg work.

These are conditions that can degrade wrist PPG.

### Cycling/resistance show larger errors than rest/treadmill on average

A systematic review/meta-analysis of wrist-worn PPG found smaller average differences during sleep/rest/treadmill work, with larger mean differences during cycling and resistance exercise. Mean error is not the whole problem: a trace can have acceptable session-average error while containing short errors of tens of beats per minute.

Those transient failures matter disproportionately to this application because they can contaminate:

- max HR;
- time in zones;
- interval response;
- threshold inference;
- aerobic decoupling;
- HR-derived load.

Boudreaux et al. likewise found device-, modality- and intensity-dependent validity during graded cycling and resistance exercise.

### Modern optical HR can also be very good

A 2024 validation study following contemporary validation recommendations compared several optical devices, including a Garmin Venu 2S, against medical-grade ECG across laboratory and free-living activities. Across devices/activities, reported mean absolute percentage error was low and overall agreement was high.

That finding is important for architecture: population literature supports **priors and uncertainty**, not a rule that wrist HR is inherently low quality. Actual trace behavior, activity context and personal/device-specific validation can preserve useful wrist data.

### Validation should be activity-specific

The INTERLIVE expert recommendations emphasize validation by device, criterion, population, testing condition and processing method. The corresponding architecture principle here is:

> **Do not attach one permanent accuracy label to an HR device. Assess whether the signal is fit for the specific activity and intended inference.**

### Electrode chest straps are better exercise references, not infallible truth

Electrode chest straps are a strong practical reference but still can fail through:

- dry/poor electrode contact;
- strap displacement;
- battery issues;
- ANT+/BLE dropout;
- electrical noise;
- data gaps;
- source switching in the recording device.

A recent systematic review of chest-worn sensors similarly reports strong validity for commonly studied chest straps while retaining limitations from placement, motion, sweating and the skin-electrode interface.

Therefore sensor provenance and actual trace quality both matter.

### Garmin training load is HR-lineage data unless proven otherwise for a specific path

Garmin describes Training Load / Exercise Load as EPOC-based and states that its on-device engine predicts EPOC by analysing heartbeat data (with cycling documentation also referring to power on compatible Edge contexts). That means `activityTrainingLoad` must not be treated as independent corroboration of a suspect HR trace by default.

For this repository, the conservative lineage rule is:

```text
Garmin activityTrainingLoad
=> vendor-derived, materially HR-dependent unless a verified device/activity path establishes otherwise
```

The value can remain useful, but HRF must not count both the raw HR-derived evidence and Garmin load as independent votes.

---

## 3. Architectural consequence: measurement confidence is not readiness

These are different variables:

```text
Observed HR = 110 bpm
Measurement confidence = LOW
```

This does **not** imply:

```text
Physiological state = poor
Readiness = lower
```

It means:

```text
Do not strongly infer physiology from this HR measurement.
```

Likewise:

```text
Measurement confidence = UNKNOWN
```

means:

```text
The system lacks enough evidence to assess the measurement.
```

It must not be silently collapsed into `UNRELIABLE`. `UNRELIABLE` should mean the system actually assessed the signal and found severe quality/coverage problems.

This distinction is consistent with the repository's broader separation of observation, provenance, identity, fidelity and decision authority.

Poor measurement should remove evidence, not make the athlete physiologically worse.

---

## 4. Current repository gap

Repository inspection confirms the existing architecture described by this PR:

- `CanonicalActivity` carries `average_hr` but no HR-source/quality contract;
- `CanonicalActivityDetail` carries `hr_zones` and lap-average HR but no measurement lineage;
- `normalize_activity(...)` persists `averageHr`, optional `hrInZones` and lap `averageHrBpm` into the same per-activity record;
- the Garmin client wrapper exposes activity HR zones, power zones and splits, but does not expose upstream `download_activity(..., ORIGINAL)`;
- current activity telemetry intentionally degrades malformed optional detail without invalidating the base activity.

There is therefore no first-class contract for:

- HR source;
- sensor technology;
- provenance certainty;
- coverage;
- artifact evidence;
- measurement confidence;
- summary-to-trace lineage;
- fitness for use.

That means a downstream consumer can receive an HR-derived value without knowing whether it came from:

- clean electrode chest-strap data;
- wrist PPG in steady cycling;
- wrist PPG during airbike/strength;
- mixed/ambiguous source;
- a trace with isolated spikes/dropouts;
- a vendor summary whose relationship to the assessed FIT stream is not verified.

The existing decision to avoid using a single activity average HR as workout-structure evidence is directionally correct. HR fidelity generalizes that evidence discipline.

---

## 5. Proposed model

Do not collapse everything into one `hrConfidence` number.

Separate:

1. source evidence;
2. sensor technology;
3. provenance confidence;
4. activity/motion prior;
5. observed trace quality;
6. coverage;
7. trace-to-summary lineage/compatibility;
8. use-case authority.

Suggested conceptual types:

```ts
type HrSensorTechnology =
  | 'electrode_chest_strap'
  | 'optical_armband'
  | 'wrist_ppg'
  | 'external_unknown'
  | 'unknown';

type HrProvenanceConfidence =
  | 'confirmed'
  | 'inferred'
  | 'ambiguous'
  | 'unknown';

type HrMeasurementConfidence =
  | 'high'
  | 'moderate'
  | 'low'
  | 'unreliable'
  | 'unknown';

type HrSummaryCompatibility =
  | 'verified_same_effective_trace'
  | 'consistent_unproven'
  | 'discordant'
  | 'not_comparable'
  | 'unknown';

interface HrSourceEvidence {
  externalHrSensorPresent: boolean | null;
  sensorTechnology: HrSensorTechnology;
  sourceForActivity: 'external' | 'wrist' | 'mixed_possible' | 'unknown';
  provenanceConfidence: HrProvenanceConfidence;
}

interface HrMeasurementQuality {
  source: HrSourceEvidence;
  activityMotionRisk: 'low' | 'moderate' | 'high' | 'unknown';
  signalQuality: 'clean' | 'suspect' | 'poor' | 'unknown';
  coveragePct: number | null;
  longestGapSeconds: number | null;
  artifactFlags: readonly HrArtifactFlag[];
  confidence: HrMeasurementConfidence;
  summaryCompatibility: HrSummaryCompatibility;
  diagnosticVersion: string;
  reasons: readonly string[];
}
```

`summaryCompatibility` can be omitted from persisted v1 if HRF0 proves a stable equivalence contract and the implementation documents exactly which fields inherit it. It is nevertheless a required design question; trace authority must not be attached to a different processed signal by assumption.

Candidate artifact/reason flags:

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

Use `suspected`, not `confirmed`, when the evidence cannot distinguish sensor artifact from unusual real physiology with certainty.

---

## 6. Sensor/activity priors

These are engineering priors, not universal constants and not guarantees.

| Activity context | Electrode chest strap | Optical arm | Wrist PPG |
|---|---:|---:|---:|
| Rest / seated | High | High | High |
| Walking | High | High | Moderate–High |
| Steady running | High | High | Moderate–High |
| Steady cycling | High | High | Moderate–High |
| Cycling intervals | High | Moderate–High | Moderate |
| Strength | High | Moderate | Low–Moderate |
| Rowing | High | Moderate | Low–Moderate |
| Airbike with active arms | High | Moderate | **Low–Moderate** |
| Active-arm elliptical | High | Moderate | **Low–Moderate** |
| Soccer/field/contact | High | Moderate | Low–Moderate |

Rules:

- a poor trace overrides a good hardware prior;
- a clean trace may improve confidence within limits;
- wrist + high-motion activity should not become `HIGH` merely because no obvious artifact was detected;
- **strap presence alone cannot produce a `HIGH` source prior when Dynamic Source Switching or source ambiguity remains possible**;
- personal paired validation may later refine the generic prior.

The table should be treated as a conservative engineering starting point to be calibrated by HRF8, not a scientific ranking with fixed numerical probabilities.

---

## 7. Trace-level quality analysis

If raw samples are available, quality should be assessed before reducing them to averages/zones/max/load.

### Coverage

Measure valid coverage, gaps and sampling irregularity. Do not allow interpolation to conceal severe missingness.

Coverage should be based on the actual timer/analysis window rather than blindly dividing sample count by wall-clock activity duration.

### Abrupt jumps/drops

Use local windows, persistence and workload transition context rather than a brittle universal bpm-per-second rule.

For example:

```text
stable workload:
112 -> 111 -> 113 -> 158 -> 112
```

is much more suspicious than a progressive HR rise after a real interval begins.

### Isolated spikes

Short peaks are particularly dangerous for max-HR and zone-5 inference. An isolated maximum should never update physiology without strong measurement authority.

An isolated spike does **not** necessarily invalidate the entire activity for average HR or zone distribution if the affected duration is tiny and the rest of the trace is strong. Artifact flags must therefore remain available to the per-use authority engine instead of being hidden behind one global confidence label.

### Stale plateaus

Detect long nearly identical HR only when independent workload evidence changes meaningfully. A stable HR during stable Z2 is normal.

### Cadence/harmonic lock

When cadence exists, test sustained windows for cadence relationships only when they are physiologically and modality plausible. For example, running commonly creates a direct cadence/HR lock candidate; cycling may make a harmonic relationship such as `HR ≈ 2 × cadence` plausible.

Do not apply a modality-blind ratio test. Require persistence and contextual inconsistency before flagging `CADENCE_LOCK_SUSPECTED` or `HARMONIC_LOCK_SUSPECTED`.

### Workload discordance

Use independent load where available:

- cycling: power/cadence;
- running: pace/grade/workout step;
- strength: exercise structure/load rather than continuous HR.

Normal cardiovascular lag must not be misclassified as sensor lag.

### Source-switch signature

If Garmin source switching is possible but explicit source samples are unavailable, abrupt changes in level/noise may support `SOURCE_SWITCH_POSSIBLE`, but should not prove that a switch occurred.

---

## 8. Confidence combination

Use rule-based caps rather than a pseudo-probability.

Required behavior:

```text
assessment unavailable / insufficient evidence
=> UNKNOWN

severe coverage failure after assessment
=> UNRELIABLE

severe artifact pattern
=> cap at LOW (or UNRELIABLE when sufficiently severe)

unknown provenance
=> cannot become HIGH in v1

wrist PPG + high-motion activity + clean-looking trace
=> no higher than MODERATE without personal validation

external strap merely present + source switching possible
=> cannot become HIGH from presence alone

confirmed electrode-chest-strap source + clean trace + high coverage
=> HIGH candidate
```

`mixed_possible` means provenance ambiguity; it does not automatically mean poor signal quality.

The global measurement-confidence label is a compact summary for observability. **Final use-case authority must also inspect relevant artifact flags, coverage, provenance and lineage.** This prevents one short spike from unnecessarily blocking session-average uses while still blocking max-HR inference.

---

## 9. Use-case-specific authority

One confidence value should not authorize every downstream feature.

```ts
type HrUseCase =
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

type HrAuthorityStatus =
  | 'ALLOWED'
  | 'BOUNDED'
  | 'OBSERVATIONAL'
  | 'BLOCKED';
```

Suggested initial shadow policy:

| Use | High | Moderate | Low | Unreliable / unknown |
|---|---|---|---|---|
| display average/trace | allowed | allowed | observational | observational |
| zone distribution | allowed | bounded | blocked by default | blocked |
| HR-derived load | allowed | bounded | blocked | blocked |
| aerobic decoupling | allowed if segment valid | blocked initially | blocked | blocked |
| interval response | allowed | bounded | blocked | blocked |
| max-HR update | allowed only with peak/context checks | blocked | blocked | blocked |
| threshold update | allowed only with protocol/context checks | blocked | blocked | blocked |
| workout compliance | allowed | bounded | blocked | blocked |
| health anomaly | only with separate HA corroboration | observational at most | blocked | blocked |

Use-case logic should be allowed to be stricter than the table. Examples:

- `ISOLATED_SPIKE` should block a peak/max-HR update even when overall coverage and average-HR quality are otherwise good;
- `SUMMARY_TRACE_DISCORDANCE` should block authority transfer to that summary until reconciled;
- a tiny isolated artifact need not necessarily block average HR if a verified same-trace calculation excluding the artifact remains stable.

Some features are safer to mark unavailable than to calculate a low-confidence number.

---

## 10. Fallback behavior

Low-confidence or unknown HR should not erase the activity.

Keep:

- completion;
- duration;
- distance if reliable;
- planned structure;
- power if reliable;
- RPE/subjective response;
- non-HR sensors.

Prefer independent evidence where appropriate:

```text
cycling: reliable power + duration + structure > low-confidence HR
running: pace/grade + duration + structure + RPE
strength: sets/reps/load + RPE/RIR
airbike without power: duration + planned intervals + RPE, with wider uncertainty
```

Training-load estimates should eventually carry their own method/provenance rather than silently treating a noisy HR estimate as precise load.

Garmin's own EPOC-based activity load can remain observable, but if the parent HR authority is inadequate it should not be used as independent evidence merely because the derivation happened on the wearable.

---

## 11. Airbike example

Observed:

- light airbike;
- no strap;
- wrist HR;
- most readings near ~110 bpm;
- occasional abrupt jumps;
- active arm push/pull and gripping.

Prior:

```text
sensor: wrist PPG
activity: airbike
motion risk: high
prior confidence: LOW–MODERATE
```

If the trace confirms a long suspicious plateau plus isolated jumps without a corresponding workload change:

```text
signal quality: suspect/poor
confidence: LOW
```

Still count the session and duration, but do not use it for precise zones, peak HR, threshold change, decoupling or HR-derived load.

A future comparable clean electrode-chest-strap session is both better training telemetry and useful personal validation evidence.

---

## 12. Personal validation

Population studies should provide priors; the app can eventually learn athlete/device/activity reliability.

A paired protocol should compare wrist PPG and an electrode chest-strap reference across representative modalities, especially:

- steady cycling;
- cycling intervals;
- airbike;
- running;
- running intervals;
- strength;
- field sport where practical.

### The two streams must be independent

This is a critical protocol requirement for Garmin devices with Dynamic Source Switching.

Do **not** validate wrist PPG against a Garmin activity stream that may itself have selected, substituted or blended in the connected strap signal. That creates circular/reference contamination and can make agreement look artificially good.

A valid paired protocol must establish independent channels, for example by:

- recording wrist PPG on a device/profile where external HR input/source switching is disabled while the electrode strap is logged independently;
- using a separate independent recorder/app for the electrode strap while the watch records wrist-only PPG;
- or otherwise proving from the exported data that the two compared streams are independent.

Synchronize clocks and define the alignment/resampling method before calculating error metrics.

Evaluate:

- bias;
- MAE/RMSE;
- p95 absolute error;
- Lin concordance;
- Bland–Altman bias/limits of agreement;
- % within ±5 and ±10 bpm;
- dropout/gaps;
- lag/cross-correlation;
- zone disagreement;
- max-HR disagreement;
- downstream load/decision disagreement.

Do not approve based only on correlation or average error. Both can hide transient failures.

An electrode chest strap is a strong practical field reference, not clinical ground truth. If a clinical-grade ECG criterion is ever used for a dedicated validation experiment, label it separately rather than calling the consumer chest strap `ECG`.

Any personal reliability prior must be evaluated out of sample and keyed to the relevant recording device/sensor/activity class.

---

## 13. Repository integration

### Ingestion/preprocessing

Provider-specific FIT parsing belongs upstream, e.g. in a new Python module around the Garmin adapter. It should extract sensor inventory and derive compact signal-quality evidence.

Raw high-frequency traces should not be loaded into the daily recommendation engine.

The repository's locked `garminconnect==0.3.11` dependency already has the upstream original-download primitive; the implementation should expose it through `GarminDataClient` / `GarminClientWrapper` rather than bypassing that boundary.

### Canonical activity persistence

Add optional compact measurement evidence to the existing per-activity document. Old documents without the field mean `not assessed`, not low confidence.

If assessment starts but cannot obtain enough evidence, retain an explicit `unknown` state rather than writing `unreliable`.

Do not persist sensor serials, GPS or full raw HR series.

### TypeScript engine

Create a deterministic `app/src/engine/activityHrFidelity.ts` that maps measurement evidence to use-case authority.

`dataConfidence.ts` may display observability, but it must not be the only authority gate; sensitive consumers need to consult HR authority directly.

The authority helper must be able to inspect reason/artifact flags and summary lineage, not only a single `measurementConfidence` enum.

### Audit every HR consumer

Inventory all uses of:

- `averageHr`;
- `hrInZones`;
- lap HR;
- max HR;
- threshold HR;
- HR-derived training load;
- `activityTrainingLoad` / EPOC-based vendor load;
- decoupling;
- interval response;
- health/anomaly interpretation.

Critically, Garmin/vendor metrics that are themselves HR-derived must not be treated as independent corroboration of their parent HR trace.

---

## 14. Validation and rollout

1. **Real FIT provenance spike** — prove what the account actually exposes and verify live original-download behavior on locked `garminconnect==0.3.11`.
2. **Trace-to-summary reconciliation spike** — determine which existing Garmin summaries can safely inherit FIT-trace authority.
3. **Add source/quality contracts** — include explicit `unknown`; no decision impact.
4. **Deterministic diagnostics** — coverage, spikes, dropout, plateau, cadence lock, workload discordance.
5. **Compact persistence and parser** — additive/optional.
6. **Use-case authority engine** — shadow only; inspect artifact/lineage evidence, not only global confidence.
7. **Historical replay** — measure what would be blocked/bounded and identify false positives.
8. **Prospective independent paired-reference study** — especially high-motion activities; prevent Dynamic Source Switching contamination.
9. **Conservative production activation** — start with high-risk consumers such as max-HR, threshold, decoupling and health-anomaly authority.
10. **Later personal priors** — only after sufficient independent paired data.

Activation should measure downstream decision quality, not merely signal correlation.

---

## 15. Safety/test invariants

At minimum test:

```text
UNKNOWN HR confidence
MUST NOT be rewritten as UNRELIABLE merely because assessment evidence is missing
```

```text
LOW HR confidence
MUST NOT lower readiness by itself
```

```text
LOW HR confidence
=> max-HR update blocked
=> threshold update blocked
=> decoupling blocked
=> activity-HR health anomaly blocked as primary evidence
```

```text
external strap present + source switching possible + no sample/source proof
=> source is not confirmed external
=> presence alone cannot yield HIGH confidence
```

```text
isolated spike + otherwise strong trace
=> MAX_HR_UPDATE blocked
=> average/zone use evaluated independently rather than automatically multiplying the same block
```

```text
FIT trace quality HIGH + Garmin summary discordant with FIT-derived equivalent
=> summary does not inherit HIGH authority
```

```text
LOW/UNKNOWN HR confidence + reliable power
=> power-based interpretation remains usable
```

```text
LOW/UNKNOWN HR confidence + completed activity
=> activity completion remains recognized
```

```text
paired validation stream may contain Dynamic Source Switching / strap substitution
=> validation sample rejected unless independence is proven
```

Also test wrist-only, known electrode chest strap, unknown external HR, mixed-source possibility, clean interval transitions, isolated spikes, dropouts, stale plateaus and modality-aware cadence/harmonic-lock candidates.

---

## 16. Final recommendation

The application should stop asking only:

> **Does this activity have HR?**

and instead ask:

> **What produced this HR, how certain are we about that provenance, how well did the signal behave in this activity, which stored summaries actually descend from that assessed stream, and is the resulting evidence trustworthy enough for this exact inference?**

The long-term model should be:

> **generic scientific prior + real trace diagnostics + verified lineage + athlete/device/activity calibration + use-case-specific authority.**

That is safer and more scientifically defensible than either trusting all Garmin HR equally or rejecting all wrist HR categorically.

---

## References

1. Garmin FIT SDK — Activity File Types. `Device Info` messages and activity sensor/device metadata.
   https://developer.garmin.com/fit/file-types/activity/

2. Garmin FIT SDK — Decoding Activity Files Cookbook.
   https://developer.garmin.com/fit/cookbook/decoding-activity-files/

3. Garmin Support — Heart Rate Dynamic Source Switching.
   https://support.garmin.com/en-AU/?faq=Nf8r6ApX4d9lX0G0flEsVA

4. `python-garminconnect` upstream — `download_activity` / `ActivityDownloadFormat.ORIGINAL`. The project's locked CI environment resolves `garminconnect==0.3.11`; HRF0 must still verify live response behavior.
   https://github.com/cyberjunky/python-garminconnect/blob/master/garminconnect/__init__.py

5. Garmin Technology — **Training Load**. Garmin describes Training Load as EPOC-based and its engine as predicting EPOC from heartbeat data (with compatible cycling contexts also using power).
   https://www.garmin.com/en-US/garmin-technology/running-science/physiological-measurements/training-load/

6. Gillinov S, Etiwy M, Wang R, et al. **Variable Accuracy of Wearable Heart Rate Monitors during Aerobic Exercise.** *Med Sci Sports Exerc.* 2017;49(8):1697-1703. DOI: 10.1249/MSS.0000000000001284.
   https://pubmed.ncbi.nlm.nih.gov/28709155/

7. Bent B, Goldstein BA, Kibbe WA, Dunn JP. **Investigating sources of inaccuracy in wearable optical heart rate sensors.** *npj Digital Medicine.* 2020;3:18. DOI: 10.1038/s41746-020-0226-6.
   https://pubmed.ncbi.nlm.nih.gov/32047863/

8. Boudreaux BD, Hebert EP, Hollander DB, et al. **Validity of Wearable Activity Monitors during Cycling and Resistance Exercise.** *Med Sci Sports Exerc.* 2018;50(3):624-633. DOI: 10.1249/MSS.0000000000001471.
   https://pubmed.ncbi.nlm.nih.gov/29189666/

9. Zhang Y, Weaver RG, Armstrong B, Burkart S, Zhang S, Beets MW. **Validity of Wrist-Worn photoplethysmography devices to measure heart rate: A systematic review and meta-analysis.** *J Sports Sci.* 2020.
   https://pubmed.ncbi.nlm.nih.gov/32552580/

10. Mühlen JM, Stang J, Skovgaard EL, et al. **Recommendations for determining the validity of consumer wearable heart rate devices: expert statement and checklist of the INTERLIVE Network.** *Br J Sports Med.* 2021;55(14):767-779. DOI: 10.1136/bjsports-2020-103148.
    https://pubmed.ncbi.nlm.nih.gov/33397674/

11. **Validity of Four Consumer-Grade Optical Heart Rate Sensors for Assessing Volume and Intensity Distribution of Physical Activity.** *Scand J Med Sci Sports.* 2024. DOI: 10.1111/sms.14756.
    https://pubmed.ncbi.nlm.nih.gov/39508366/

12. **A Systematic Review of Chest-Worn Sensors in Cardiac Assessment: Technologies, Advantages, and Limitations.** 2025.
    https://pubmed.ncbi.nlm.nih.gov/41094872/
