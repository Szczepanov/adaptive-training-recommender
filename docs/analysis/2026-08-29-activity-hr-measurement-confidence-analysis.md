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
- whether the signal is trustworthy enough for a specific downstream inference.

Scientific validation consistently shows that wrist photoplethysmography (PPG) accuracy is **activity- and movement-dependent**. It is generally stronger at rest and during some steady exercise than during resistance work, gripping, cyclic arm motion and other high-motion conditions. Electrode chest straps usually perform substantially better during exercise, but still can suffer contact, battery and dropout failures.

Garmin FIT Activity files provide useful provenance through `device_info`, but this needs careful interpretation. Garmin also supports **Heart Rate Dynamic Source Switching** on compatible devices, where wrist HR and an external strap can both be available and Garmin can select the source dynamically. Therefore:

> **External HR sensor present is not equivalent to every HR sample definitely coming from that sensor.**

The central policy should be:

> **HR measurement confidence governs whether HR-derived evidence may influence an inference. Low measurement confidence removes or bounds evidence; it must not itself be interpreted as poor physiological readiness.**

A wrist-only airbike session with a long suspicious plateau and abrupt spikes should still count as completed exercise, but its HR should not automatically be authoritative for zones, max-HR updates, threshold inference, decoupling, HR-derived load or health/anomaly interpretation.

Initial implementation should be additive/shadow-only and validated by replay before changing production decisions.

---

## 1. Garmin provenance: what we can and cannot infer

### FIT `device_info` is useful source evidence

Garmin's FIT SDK documents `Device Info` messages in Activity files. They can describe the recording platform and hardware accessories/sensors associated with an activity, including manufacturer/product information and device type.

That allows an activity sensor inventory such as:

```text
Activity
  ├── recording device: watch / Edge
  ├── external HR sensor: present / absent / unknown
  ├── power meter: present / absent
  ├── cadence sensor: present / absent
  └── other accessories
```

However, this proves **device participation/presence**, not necessarily exact per-sample HR provenance.

### Dynamic Source Switching makes naive attribution unsafe

Garmin documents Heart Rate Dynamic Source Switching for compatible watches and HR sensors. The watch can keep wrist optical HR active while an external HR strap is connected and dynamically choose the source it considers more reliable.

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

### Required empirical check before implementation

The first implementation task should inspect real original `.FIT` activities from this account across:

- wrist-only activity;
- known Garmin chest strap;
- another external HR sensor if available;
- cycling;
- running;
- strength;
- airbike/high-arm-motion cardio;
- soccer/field activity where available.

Inspect:

- `device_info` records;
- manufacturer/product/device type;
- `record` messages and available HR/cadence/power fields;
- developer fields;
- event messages;
- whether separate HR streams exist;
- whether sample-level source exists;
- whether source switching can be reconstructed.

Do not design around an assumed per-sample source field until our own files prove it exists and is stable.

---

## 2. Scientific evidence

### Wrist PPG is activity-dependent

Wrist HR watches estimate pulse using photoplethysmography. Motion can alter sensor-to-skin contact, skin deformation, optical coupling, local blood flow and the relationship between the periodic motion signal and the actual cardiovascular pulse.

Bent et al. described **signal crossover**, where rhythmic motion can be mistaken for pulse. This is directly relevant to cadence-like locking and sudden exercise-HR artifacts.

### Active arm movement is particularly relevant to airbike

Gillinov et al. compared several optical wearables plus a Polar H7 chest strap with ECG during treadmill, stationary cycling and elliptical exercise. The chest strap showed extremely high concordance with ECG (`rc = 0.996`). Optical devices varied by modality.

Most relevant here: when elliptical arm levers were used, **none of the tested optical devices met the study's accuracy criterion**.

That study does not directly validate a modern Garmin watch on an airbike, but the mechanical conditions are highly relevant:

- repeated push/pull arm motion;
- sustained gripping;
- forearm contraction;
- changing wrist position/contact pressure;
- vibration;
- simultaneous leg work.

These are exactly the conditions that can degrade wrist PPG.

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

### Validation should be activity-specific

The INTERLIVE expert recommendations emphasize validation by device, criterion, population, testing condition and processing method. The corresponding architecture principle here is:

> **Do not attach one permanent accuracy label to an HR device. Assess whether the signal is fit for the specific activity and intended inference.**

### Chest straps are better exercise references, not infallible truth

Electrode chest straps are a strong practical reference but still can fail through:

- dry/poor electrode contact;
- strap displacement;
- battery issues;
- ANT+/BLE dropout;
- electrical noise;
- data gaps;
- source switching.

Therefore sensor provenance and actual trace quality both matter.

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

This distinction is consistent with the repository's broader separation of observation, provenance, identity, fidelity and decision authority.

Poor measurement should remove evidence, not make the athlete physiologically worse.

---

## 4. Current repository gap

The current Garmin activity path already carries HR-related telemetry such as average HR, HR zones and lap HR, but there is no first-class contract for:

- HR source;
- sensor technology;
- provenance certainty;
- coverage;
- artifact evidence;
- measurement confidence;
- fitness for use.

That means a downstream consumer can receive an HR-derived value without knowing whether it came from:

- clean ECG chest-strap data;
- wrist PPG in steady cycling;
- wrist PPG during airbike/strength;
- mixed/ambiguous source;
- a trace with isolated spikes/dropouts.

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
7. use-case authority.

Suggested conceptual types:

```ts
type HrSensorTechnology =
  | 'ecg_chest_strap'
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
  | 'unreliable';

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
  diagnosticVersion: string;
  reasons: readonly string[];
}
```

Candidate artifact flags:

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
PROVENANCE_AMBIGUOUS
```

Use `suspected`, not `confirmed`, when the evidence cannot distinguish sensor artifact from unusual real physiology with certainty.

---

## 6. Sensor/activity priors

These are engineering priors, not universal constants.

| Activity context | ECG chest strap | Optical arm | Wrist PPG |
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
- personal paired validation may later refine the generic prior.

---

## 7. Trace-level quality analysis

If raw samples are available, quality should be assessed before reducing them to averages/zones/max/load.

### Coverage

Measure valid coverage, gaps and sampling irregularity. Do not allow interpolation to conceal severe missingness.

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

### Stale plateaus

Detect long nearly identical HR only when independent workload evidence changes meaningfully. A stable HR during stable Z2 is normal.

### Cadence/harmonic lock

When cadence exists, test sustained windows for relationships such as:

```text
HR ≈ cadence
HR ≈ 2 × cadence
```

Require persistence and contextual inconsistency before flagging `CADENCE_LOCK_SUSPECTED`.

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
severe coverage failure
=> UNRELIABLE

severe artifact pattern
=> cap at LOW

unknown provenance
=> cannot become HIGH in v1

wrist PPG + high-motion activity + clean-looking trace
=> no higher than MODERATE without personal validation

known ECG strap + clean trace + high coverage
=> HIGH candidate
```

`mixed_possible` means provenance ambiguity; it does not automatically mean poor signal quality.

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

| Use | High | Moderate | Low/unreliable |
|---|---|---|---|
| display average/trace | allowed | allowed | observational |
| zone distribution | allowed | bounded | blocked |
| HR-derived load | allowed | bounded | blocked |
| aerobic decoupling | allowed if segment valid | blocked initially | blocked |
| interval response | allowed | bounded | blocked |
| max-HR update | allowed only with peak/context checks | blocked | blocked |
| threshold update | allowed only with protocol/context checks | blocked | blocked |
| workout compliance | allowed | bounded | blocked |
| health anomaly | only with separate HA corroboration | observational at most | blocked |

Some features are safer to mark unavailable than to calculate a low-confidence number.

---

## 10. Fallback behavior

Low-confidence HR should not erase the activity.

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

A future comparable clean chest-strap session is both better training telemetry and useful personal validation evidence.

---

## 12. Personal validation

Population studies should provide priors; the app can eventually learn athlete/device/activity reliability.

A paired protocol should compare wrist and electrode chest-strap data across representative modalities, especially:

- steady cycling;
- cycling intervals;
- airbike;
- running;
- running intervals;
- strength;
- field sport where practical.

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

Any personal reliability prior must be evaluated out of sample and keyed to the relevant recording device/sensor/activity class.

---

## 13. Repository integration

### Ingestion/preprocessing

Provider-specific FIT parsing belongs upstream, e.g. in a new Python module around the Garmin adapter. It should extract sensor inventory and derive compact signal-quality evidence.

Raw high-frequency traces should not be loaded into the daily recommendation engine.

### Canonical activity persistence

Add optional compact measurement evidence to the existing per-activity document. Old documents without the field mean `not assessed`, not low confidence.

Do not persist sensor serials, GPS or full raw HR series.

### TypeScript engine

Create a deterministic `app/src/engine/activityHrFidelity.ts` that maps measurement evidence to use-case authority.

`dataConfidence.ts` may display observability, but it must not be the only authority gate; sensitive consumers need to consult HR authority directly.

### Audit every HR consumer

Inventory all uses of:

- `averageHr`;
- `hrInZones`;
- lap HR;
- max HR;
- threshold HR;
- HR-derived training load;
- decoupling;
- interval response;
- health/anomaly interpretation.

Critically, Garmin/vendor metrics that are themselves HR-derived must not be treated as independent corroboration of their parent HR trace.

---

## 14. Validation and rollout

1. **Real FIT provenance spike** — prove what the account actually exposes.
2. **Add source/quality contracts** — no decision impact.
3. **Deterministic diagnostics** — coverage, spikes, dropout, plateau, cadence lock, workload discordance.
4. **Compact persistence and parser** — additive/optional.
5. **Use-case authority engine** — shadow only.
6. **Historical replay** — measure what would be blocked/bounded.
7. **Prospective paired reference study** — especially high-motion activities.
8. **Conservative production activation** — start with high-risk consumers such as max-HR, threshold, decoupling and health-anomaly authority.
9. **Later personal priors** — only after sufficient paired data.

Activation should measure downstream decision quality, not merely signal correlation.

---

## 15. Safety/test invariants

At minimum test:

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
LOW HR confidence + reliable power
=> power-based interpretation remains usable
```

```text
LOW HR confidence + completed activity
=> activity completion remains recognized
```

Also test wrist-only, known chest strap, unknown external HR, mixed-source possibility, clean interval transitions, isolated spikes, dropouts, stale plateaus and cadence/harmonic-lock candidates.

---

## 16. Final recommendation

The application should stop asking only:

> **Does this activity have HR?**

and instead ask:

> **What produced this HR, how certain are we about that provenance, how well did the signal behave in this activity, and is it trustworthy enough for this exact inference?**

The long-term model should be:

> **generic scientific prior + real trace diagnostics + athlete/device/activity calibration + use-case-specific authority.**

That is safer and more scientifically defensible than either trusting all Garmin HR equally or rejecting all wrist HR categorically.

---

## References

1. Garmin FIT SDK — Activity File Types. `Device Info` messages and activity sensor/device metadata.  
   https://developer.garmin.com/fit/file-types/activity/

2. Garmin FIT SDK — Decoding Activity Files Cookbook.  
   https://developer.garmin.com/fit/cookbook/decoding-activity-files/

3. Garmin Support — Heart Rate Dynamic Source Switching.  
   https://support.garmin.com/en-AU/?faq=Nf8r6ApX4d9lX0G0flEsVA

4. Gillinov S, Etiwy M, Wang R, et al. **Variable Accuracy of Wearable Heart Rate Monitors during Aerobic Exercise.** *Med Sci Sports Exerc.* 2017;49(8):1697-1703. DOI: 10.1249/MSS.0000000000001284.  
   https://pubmed.ncbi.nlm.nih.gov/28709155/

5. Bent B, Goldstein BA, Kibbe WA, Dunn JP. **Investigating sources of inaccuracy in wearable optical heart rate sensors.** *npj Digital Medicine.* 2020;3:18. DOI: 10.1038/s41746-020-0226-6.  
   https://www.nature.com/articles/s41746-020-0226-6

6. Boudreaux BD, Hebert EP, Hollander DB, et al. **Validity of Wearable Activity Monitors during Cycling and Resistance Exercise.** *Med Sci Sports Exerc.* 2018;50(3):624-633. DOI: 10.1249/MSS.0000000000001471.  
   https://pubmed.ncbi.nlm.nih.gov/29189666/

7. Zhang Y, Weaver RG, Armstrong B, Burkart S, Zhang S, Beets MW. **Validity of Wrist-Worn photoplethysmography devices to measure heart rate: A systematic review and meta-analysis.** *J Sports Sci.* 2020.  
   https://pubmed.ncbi.nlm.nih.gov/32552580/

8. Mühlen JM, Stang J, Skovgaard EL, et al. **Recommendations for determining the validity of consumer wearable heart rate devices: expert statement and checklist of the INTERLIVE Network.** *Br J Sports Med.* 2021;55(14):767-779. DOI: 10.1136/bjsports-2020-103148.  
   https://pubmed.ncbi.nlm.nih.gov/33397674/
