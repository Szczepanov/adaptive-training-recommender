# HRF4 persistence review — 2026-08-29

## Scope

Independent review of PR #288 (`feat(hrf): persist compact activity fidelity evidence`) against the accepted HRF invariants and the existing activity persistence/read contracts.

The review focused on:

- preserving `UNKNOWN` vs `UNRELIABLE` semantics;
- keeping FIT/sample data transient;
- target-date request scoping and failure isolation;
- source/provenance claims derived from FIT `device_info`;
- additive Firestore persistence and repeated-sync behavior;
- TypeScript read compatibility;
- keeping HRF shadow-only with no recommendation/readiness authority change.

## Result

HRF4 remains additive and shadow-only. Compact `hrMeasurement` evidence is written through the existing `users/{userId}/activities/{activityId}` merge-upsert, while missing/failed FIT enrichment leaves the base activity available and does not manufacture an `unreliable` assessment.

One source-normalization gap was found and corrected during review: FIT `device_info.device_type` can reach the decoder as a raw source-scoped ANT+ enum rather than a decoded string. For ANT+ device information, raw device type `120` denotes heart rate. The runtime FIT boundary now normalizes that value to the generic `heart_rate` inventory label only when `source_type` proves ANT+ (`1` or `antplus`). The same numeric value is deliberately left uninterpreted without that source discriminator.

This normalization is intentionally **presence evidence only**. It does not prove which HR source supplied individual samples and it does not identify the sensor technology. Downstream source evidence therefore remains conservative:

```text
externalHrSensorPresent = true
sourceForActivity = mixed_possible
provenanceConfidence = ambiguous
sensorTechnology = external_unknown
```

That preserves P-HRF-2 through P-HRF-4: accessory presence is not sample provenance, and an external HR accessory is not automatically an electrode chest strap.

## FIT evidence basis

Garmin's Activity FIT documentation describes `device_info` as information about the creator and hardware/accessories that may have been used during the activity; it is inventory evidence, not proof of sample-level HR source:

- https://developer.garmin.com/fit/file-types/activity/

Garmin's FIT decoding material exposes source-specific device-type accessors (for example ANT+ device type), reinforcing that the field must be interpreted together with its source discriminator:

- https://developer.garmin.com/fit/cookbook/decoding-activity-files/

The FIT profile semantics identify ANT+ device type `120` as `heart_rate` and source type `1` as ANT+; the runtime implementation deliberately normalizes only that source-scoped combination rather than assigning meaning to an unqualified numeric value.

## Persistence invariants verified

### One activity, one normal upsert

The HRF payload is supplied to `normalize_activity(...)` before the existing activity batch write. HRF does not create a second detail/fidelity document or a second per-activity write path.

### Merge semantics preserve prior evidence

`FirestoreRecoveryRepository.upsert_activity(...)` and `upsert_activities(...)` use Firestore `set(..., merge=True)`. A later sync that cannot re-assess FIT evidence and therefore omits `hrMeasurement` does not erase a previously persisted assessment.

### Failed enrichment remains unassessed

Original-FIT absence, rate limiting, decoding failure, or other enrichment failure does not emit a fallback `hrMeasurement`. It therefore cannot be coerced to `low` or `unreliable` by the persistence layer.

An actually decoded but insufficient trace may explicitly persist `measurementConfidence: "unknown"` with `ASSESSMENT_UNAVAILABLE`, preserving the distinction between successful-but-unassessable evidence and transport/enrichment absence.

### Data minimization

Persisted `hrMeasurement` contains compact source/quality/lineage metadata only. Raw FIT bytes, per-sample HR/cadence/power, GPS, device serials, owner identifiers, and raw health payloads remain outside the activity document.

### Reader compatibility

`hrMeasurement` is optional in the normalized TypeScript activity contract. The parser validates the subtree independently; malformed metadata is dropped while the base activity remains `AVAILABLE`. Older documents with no field therefore retain their prior meaning and are treated as not assessed.

## Deliberately not activated by HRF4

This review does not promote HR fidelity to production decision authority. In particular, it does not:

- change readiness or recommendation policy;
- allow HR quality to lower readiness by itself;
- attach FIT trace authority blindly to Garmin summaries with unknown/discordant lineage;
- implement the HRF5 per-use authority engine;
- enable max-HR, threshold-HR, decoupling, zone, training-load, compliance, or health-anomaly decisions from this metadata.

Those remain gated by the subsequent HRF tasks and, for production authority, the HRF8 evidence requirement plus a separate activation decision.

## Regression coverage added during review

The added FIT-source tests verify that:

1. raw ANT+ `(source_type=1, device_type=120)` becomes generic `heart_rate` inventory evidence;
2. a named `ANTPLUS` source is handled equivalently;
3. numeric `120` without ANT+ context is not interpreted;
4. recognized external-HR inventory evidence still maps only to `mixed_possible` / `ambiguous` / `external_unknown`, never to confirmed sample provenance or an assumed chest-strap technology.
