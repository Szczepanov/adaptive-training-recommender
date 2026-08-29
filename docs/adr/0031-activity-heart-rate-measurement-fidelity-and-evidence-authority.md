# ADR-0031: Activity Heart-Rate Measurement Fidelity and Evidence Authority

* **Status:** Accepted
* **Date:** 2026-08-29
* **Deciders:** Core Engineering Team
* **Source analysis:** [`2026-08-29-activity-hr-measurement-confidence-analysis.md`](../analysis/2026-08-29-activity-hr-measurement-confidence-analysis.md)
* **Implementation plan:** [`activity-heart-rate-measurement-fidelity.md`](../plans/activity-heart-rate-measurement-fidelity.md)

## Context

The activity pipeline stores and consumes heart-rate-derived telemetry such as average HR, HR time in zones and lap HR. Future or existing consumers may also use HR for training-load estimation, interval response, aerobic decoupling, maximum-HR or threshold inference, and health/anomaly interpretation.

These values are not independent observations when they originate from the same underlying HR trace. If that trace is corrupted, one measurement failure can become several apparently independent downstream facts.

Exercise HR quality is also context dependent. Wrist photoplethysmography (PPG) can be accurate in many conditions, but validation literature shows device-, activity- and movement-dependent error, with harder conditions including gripping, resistance work and active arm motion. Electrode chest straps generally provide much stronger exercise agreement with ECG, but they can still suffer contact, battery and dropout failures. A consumer electrode chest strap is therefore a strong practical field reference, not synonymous with clinical ECG.

Garmin FIT Activity files can contain `device_info` records for recording devices and accessories. That is useful source evidence, but Garmin also supports Heart Rate Dynamic Source Switching on compatible devices. A strap being present in an activity therefore does not prove that every HR sample came from that strap; an activity may legitimately have ambiguous or mixed source provenance.

The repository currently stores Garmin Connect activity summaries and separately fetched HR-zone/lap summaries while the proposed fidelity analysis operates on the original FIT trace. Those representations are likely related but cannot be assumed to be byte-for-byte or transformation-identical. Authority from an assessed trace must not silently transfer to a summary whose lineage is unknown or demonstrably discordant.

The repository already separates source provenance, technical quality, identity attribution and downstream physiological interpretation in adjacent capabilities. Activity HR needs the same separation.

## Decision

### D-HRF-AUTHORITY — measurement fidelity gates evidence authority

HR measurement fidelity is an evidence-quality property, not an athlete-state property.

Low, unknown or unreliable HR measurement confidence MAY reduce, bound or block HR-derived evidence. It MUST NOT, by itself:

- lower readiness;
- increase physiological strain;
- create a fatigue or illness conclusion;
- imply poor workout execution;
- count as negative physiological evidence.

The safe interpretation of low confidence is: **the system has less trustworthy HR evidence**.

`UNKNOWN` and `UNRELIABLE` SHALL remain distinct:

- `UNKNOWN` means there is not enough evidence to assess the measurement reliably;
- `UNRELIABLE` means the measurement was assessed and severe quality/coverage problems were found.

Missing or failed fidelity enrichment MUST NOT be rewritten as `LOW` or `UNRELIABLE` merely to satisfy a schema.

### D-HRF-PROVENANCE — preserve device presence, source provenance and technology separately

The activity contract SHALL distinguish at least:

1. recording/sensor inventory evidence;
2. inferred or explicit HR source for the activity;
3. sensor technology, when known;
4. provenance confidence.

The presence of an external HR sensor SHALL NOT be treated as proof that all HR samples came from that sensor.

An external HR sensor SHALL NOT automatically be classified as an electrode chest strap. Unknown external devices remain `external_unknown` until product/device evidence supports a stronger classification.

When Garmin source switching is possible but sample-level provenance is not available, `mixed_possible` / ambiguous provenance is an acceptable explicit state. Possible source switching is not, by itself, evidence of poor signal quality.

External-sensor presence alone SHALL NOT be sufficient to produce a high-confidence external-source classification.

### D-HRF-CONTEXT — activity and sensor type provide priors, not final truth

Sensor technology and activity/motion context MAY establish a conservative prior reliability.

Examples include stronger priors for clean electrode chest-strap exercise data and weaker priors for wrist PPG during high-arm-motion, gripping or contact activities.

However:

- observed trace artifacts can downgrade any hardware prior;
- a chest strap is not automatically infallible;
- a clean-looking high-motion wrist trace is not automatically proven accurate;
- population validation informs priors but does not replace athlete/device/activity-specific evidence;
- strap presence with ambiguous source switching cannot be upgraded to a confirmed strap source merely because the trace looks clean.

### D-HRF-TRACE — evaluate the actual trace when available

Where raw or sufficiently high-resolution activity samples are available, the ingestion/preprocessing boundary SHOULD derive deterministic and explainable quality evidence before reducing the signal to downstream summaries.

Initial diagnostics MAY include:

- HR coverage and longest gaps;
- abrupt isolated spikes/drops;
- repeated dropouts;
- stale plateaus in the presence of changing workload;
- suspected cadence/harmonic lock;
- workload discordance using independent power/pace/workout structure;
- transition-lag suspicion;
- possible source-switch signatures.

Artifact reason codes MUST be expressed as suspicion/evidence, not as clinical or physiological diagnoses.

Interpolation MUST NOT convert materially incomplete source data into high-confidence evidence.

Artifact evidence SHALL remain available to downstream use-case authority rather than being hidden behind one scalar confidence label. A short isolated spike, for example, may invalidate a max-HR candidate without making the entire session average unusable.

### D-HRF-LINEAGE — derived HR metrics inherit authority only when lineage is established

Average HR, HR-zone time, HR-derived training load, decoupling, peak HR and similar child features SHALL NOT be treated as independent corroborating observations when derived from the same HR stream.

Downstream evidence aggregation MUST preserve that lineage so one noisy trace cannot multiply its influence.

Where an upstream vendor metric is materially HR-derived, it MUST NOT be assumed independent merely because the vendor computed it before ingestion. Garmin describes Training Load / Exercise Load as EPOC-based and its engine as analysing heartbeat data, so `activityTrainingLoad` is HR-lineage evidence by default unless a specific verified path establishes otherwise.

Conversely, the quality assessment of an original FIT trace SHALL NOT automatically be attached to a Garmin Connect summary merely because the activity ID matches. Before a summary inherits that authority, implementation must either:

- verify that it is derived from the same effective HR stream under an established reconciliation contract; or
- carry an explicit compatibility/lineage state and fail conservatively when discordant or unknown.

Trace-to-summary reconciliation SHOULD cover the existing `averageHr`, lap-average HR and HR-zone representations before production authority is changed.

### D-HRF-USECASE — authority is use-case-specific

The system SHALL NOT use one global HR confidence threshold for every downstream feature.

A signal can be adequate for display while insufficient for a more artifact-sensitive inference.

At minimum, policy SHALL distinguish authority for:

- average/trace display;
- HR-zone distribution;
- HR-derived training load;
- interval HR response;
- aerobic decoupling;
- maximum-HR updates;
- threshold-HR updates;
- workout compliance;
- health/anomaly interpretation.

High-risk physiological parameter updates such as maximum HR and threshold HR require stronger measurement authority than passive display.

Some features, such as aerobic decoupling, MAY fail closed rather than calculate a low-confidence number.

Per-use authority MAY inspect provenance, coverage, artifact flags and lineage in addition to the compact global measurement-confidence label.

### D-HRF-FALLBACK — preserve activity evidence when HR is unusable

Blocking HR-derived inference SHALL NOT erase the activity.

The engine SHOULD fall back to independent evidence appropriate to the modality, such as:

- power and duration for cycling;
- pace/grade and workout structure for running;
- sets/reps/load/RPE/RIR for strength;
- planned/completed structure, duration and RPE where objective load signals are unavailable.

Fallback estimates MUST carry their own method/provenance and uncertainty rather than silently masquerading as HR-derived precision.

### D-HRF-RAW — raw FIT/trace data is transient by default

Original Garmin FIT activity files and high-frequency HR traces contain sensitive health, device, timestamp and potentially location data.

The default HR-fidelity implementation SHALL:

1. download/read the original activity only when needed and explicitly enabled;
2. decode it in memory or bounded temporary storage;
3. derive compact, versioned fidelity evidence;
4. persist only the compact evidence required downstream;
5. discard the raw bytes/temporary file after processing.

Raw FIT files, GPS traces, sensor serial numbers and full HR sample arrays SHALL NOT be written to ordinary Firestore activity documents or committed as repository fixtures.

Any persistent raw-FIT archive requires a separate retention/privacy decision rather than being implied by this ADR.

### D-HRF-FAILSAFE — fidelity enrichment cannot break core ingestion

Failure to download, decode or assess an original activity SHALL NOT fail the core Garmin activity/recovery sync.

The activity remains available with HR fidelity absent/unknown.

Missing fidelity means **not assessed**, not low confidence and not unreliable.

### D-HRF-SHADOW — no production decision impact before replay evidence

The first implementation SHALL be additive/shadow only.

Production recommendation or physiological-parameter authority SHALL NOT change merely because source and quality metadata become available.

Before production activation, the capability must produce a reviewed historical replay and, where practical, paired reference evidence comparing wrist/activity combinations against an electrode chest-strap reference.

The activation review must evaluate downstream decision quality, not only signal correlation or average error.

### D-HRF-REFERENCE — paired validation requires independent measurement channels

A future wrist-vs-electrode-chest-strap validation SHALL prove that the compared streams are independent.

A Garmin activity stream that may have dynamically substituted the connected strap for wrist HR MUST NOT be used as the wrist index stream in a paired validation unless exported evidence proves independence.

Valid study setups include, for example:

- wrist-only recording with external-HR/source switching disabled while the strap is captured independently;
- a separate recorder/application for the electrode strap while the watch records wrist-only PPG;
- another documented arrangement that proves the two streams cannot substitute for one another.

Clock synchronization/alignment and resampling rules SHALL be defined before error metrics are computed. Reference-contaminated samples are excluded rather than treated as successful agreement.

### D-HRF-PERSONAL — personal reliability may supersede generic priors only after out-of-sample validation

A later athlete/device/activity reliability prior MAY refine generic population priors when enough paired reference data exists.

It SHALL be keyed by relevant device/sensor/activity context and evaluated out of sample. A device change or insufficient history falls back to generic priors. A personal prior cannot override severe trace artifacts.

Personal priors SHALL be trained/evaluated only on paired data that satisfies D-HRF-REFERENCE.

## Consequences

### Positive

- HR-derived decisions gain explicit provenance and technical quality semantics.
- `UNKNOWN` measurement quality is represented honestly instead of being conflated with a failed measurement.
- Wrist PPG remains usable where evidence supports it rather than being categorically rejected.
- Electrode chest-strap data receives an appropriately strong prior without being blindly trusted or mislabeled as clinical ECG.
- Garmin source-switch ambiguity is represented truthfully.
- Trace diagnostics cannot silently authorize a different Garmin summary without a lineage/reconciliation check.
- One corrupted HR trace cannot multiply into several independent-looking physiological signals.
- High-risk features such as max-HR, threshold and decoupling can fail closed while activity completion and non-HR evidence remain intact.
- Paired validation cannot accidentally validate wrist PPG against a strap-contaminated Garmin stream.
- The design aligns with ADR-0010 replay/provenance principles, ADR-0026 wearable telemetry boundaries, ADR-0027 source-aware observations and ADR-0028's separation of identity from technical measurement quality.

### Negative / cost

- Original activity/FIT acquisition adds request, parsing and operational complexity.
- Trace-to-summary reconciliation adds implementation and test work before existing Garmin summary fields can inherit FIT authority.
- Source classification requires maintaining a small device/product knowledge boundary.
- Some historical activities will remain `unknown` because original files or provenance are unavailable.
- Use-case-specific authority is more complex than a single confidence score.
- Independent paired validation is operationally harder than simply pairing a strap to the same watch.
- Conservative gating can temporarily reduce the number of HR-derived metrics available until enough validation evidence accumulates.

## Rejected alternatives

### Treat all Garmin HR as equally trustworthy

Rejected because sensor technology, activity movement and trace quality materially change measurement error, and HR-derived child metrics would amplify a single corrupted source.

### Treat external-sensor presence as proof of chest-strap HR

Rejected because an external HR sensor may be optical/unknown and Garmin Dynamic Source Switching can make activity-level provenance ambiguous.

### Call every electrical chest strap `ECG`

Rejected because consumer electrode chest straps are not interchangeable with a clinical electrocardiographic reference system. The architecture uses `electrode_chest_strap`; `ECG` is reserved for a true ECG criterion/reference.

### Treat missing assessment as `UNRELIABLE`

Rejected because absence of evidence and evidence of failure are different states. Missing/failed enrichment remains `UNKNOWN`/not assessed.

### Apply FIT-trace confidence directly to every Garmin activity summary

Rejected because the repository obtains summaries through multiple Garmin Connect paths. Authority transfers only after reconciliation/lineage is established.

### Treat wrist HR as untrusted by default everywhere

Rejected because wrist PPG can be adequate in lower-motion conditions and modern/device-specific or personal evidence may demonstrate useful reliability.

### Treat a chest strap as ground truth

Rejected because electrode straps can still have contact, dropout and battery artifacts. They are a strong practical reference, not infallible truth.

### Validate wrist and strap using a Dynamic-Source-Switched activity stream

Rejected because the compared streams may not be independent; strap substitution can create circular validation and artificially improve apparent agreement.

### Convert fidelity into a readiness penalty

Rejected because that confuses measurement uncertainty with physiological state and would make poor sensors directly worsen the athlete's recommendation.

### Persist raw FIT/high-frequency traces in normal activity documents

Rejected because it creates unnecessary privacy, storage and schema burden. Compact derived fidelity evidence is sufficient for normal downstream decision authority.

### Build an ML quality classifier first

Rejected for v1. Deterministic, versioned and explainable diagnostics are easier to test, replay and audit; a learned model is only justified later if labeled data demonstrates unresolved value.

## Follow-up

Implementation and validation are tracked by the `HRF*` task family in [`docs/plans/activity-heart-rate-measurement-fidelity.md`](../plans/activity-heart-rate-measurement-fidelity.md).

The first required work item is a real-account FIT provenance/reconciliation spike. Architecture and runbook documentation are intentionally deferred until implementation so living docs describe shipped behavior rather than this proposed design.
