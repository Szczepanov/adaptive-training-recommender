# Google Health and Multisource Wearable Integration Analysis (2026-08-27)

**Question asked.** Should the Adaptive Training Recommender use Google Health / Health Connect
as an aggregation route for Garmin and Eight Sleep, and if so, how should it fit the existing
provider, storage, baseline, and recommendation architecture?

**Repository baseline reviewed:** `main@ec9007fc59d28cf3414d264417cb6448d9ce8d66`.

**Key finding.** Google Health is worth integrating, but it should be treated as a
**read-only transport and aggregation surface**, not as the canonical owner of recovery truth.
The existing direct Garmin path should remain because it exposes deeper training and
provider-specific data. Eight Sleep should be consumed through Google Health only if the user's
real Google Health records prove that Eight Sleep-origin Pod measurements are actually exported
there. That export direction is not established by current first-party Eight Sleep wording.

---

## 1. Scope and evidence classes

This analysis deliberately separates three kinds of statements.

### 1.1 Repository-derived facts

These come from the reviewed repository state and are stable only for the commit identified
above.

### 1.2 External platform facts

These are current platform/API findings verified against vendor documentation on 2026-08-27.

### 1.3 Empirical unknowns

These cannot be settled from documentation alone. They require a real-account source-provenance
probe before implementation decisions depend on them.

The most important empirical unknown is:

> Does the user's Eight Sleep app write Pod-generated sleep/HRV/heart-rate/respiration records
> into Health Connect in a way that later surfaces through the Google Health API with Eight
> Sleep source provenance?

Current Eight Sleep documentation confirms Health Connect as an integration from which Eight
Sleep can receive data, but it does not establish that Pod measurements are exported in the
opposite direction.

---

## 2. Current repository state

### 2.1 There is already a provider-neutral seam

`src/garmin_sync/provider.py` explicitly describes a provider-neutral boundary and defines
`ProviderCapabilities`, `ProviderFetchResult`, activity result types, and `WearableProvider`.

That is a strong foundation, but the current protocol is still shaped around one class of
wearable: it structurally requires both:

```python
fetch_daily_metrics(...)
fetch_activities(...)
```

A mattress or recovery-only health source does not naturally satisfy the activity side.

**Implication:** do not force Google Health or Eight Sleep into the current protocol merely to
reuse an interface. The next abstraction should be capability/domain-oriented.

Candidate eventual protocols:

```python
class RecoveryObservationProvider(Protocol):
    def fetch_observations(self, start, end) -> ObservationBatch: ...

class ActivityProvider(Protocol):
    def fetch_activities(self, start_date, end_date, ...) -> ProviderActivitiesResult: ...

class PerformanceProvider(Protocol):
    def fetch_performance_targets(self) -> ProviderPerformanceTargetsResult: ...
```

The existing Garmin adapter can implement more than one capability.

### 2.2 Canonical metric names are provider-neutral, but cardinality is single-source

`src/garmin_sync/canonical.py` already uses provider-neutral names and explicit units.
`CanonicalDailyMetrics` includes:

- resting heart rate;
- overnight HRV;
- sleep score;
- sleep duration and stages;
- respiration;
- SpO2;
- skin-temperature deviation;
- Garmin-specific recovery/training enrichment.

That works when one daily record owns one value per metric.

It becomes problematic when two devices observe the same physiology:

```text
Garmin HRV       67 ms
Eight Sleep HRV  58 ms
```

Selecting one value before baseline computation destroys provenance. Averaging them creates a
new number that corresponds to neither device's measurement process.

**Implication:** multi-source support should add an observation layer below the current daily
snapshot rather than adding `garminHrv`, `eightSleepHrv`, and future provider fields directly to
the existing snapshot model.

### 2.3 Persisted source metadata is still Garmin-specific

`src/garmin_sync/models.py` currently models source metadata with Garmin-specific fields such as:

- `garminSyncedAt`;
- `garminconnectVersion`;
- `metricDates`.

`DailyRecoverySnapshot.raw` also stores one value per core recovery metric.

**Implication:** the existing snapshot can remain the production engine input during migration,
but it should stop being the lowest-level measurement store.

### 2.4 Baseline computation assumes one stream per metric

The backend computes rolling 7-day and 28-day history from the daily raw snapshot.
The TypeScript engine then uses baseline-relative strain: current-vs-baseline deltas normalized
by personal variability.

This is a good scientific shape, but it creates one hard rule for multi-device data:

> A device/source change must not silently continue the previous source's baseline.

A Garmin HRV history and an Eight Sleep HRV history may have the same unit and both may use
RMSSD, but differences in sensor, sampling, artifact handling, sleep-window selection, and
vendor processing can shift absolute values.

### 2.5 The engine already has an evidence-first culture

Current plans/ADRs repeatedly use the pattern:

```text
ingest
→ observe
→ compare/replay
→ make a separate activation decision
```

This is exactly the right model for multisource recovery data.

---

## 3. Google Health API findings

### 3.1 Google Health API is current, server-accessible infrastructure

Google launched the Google Health API on 2026-03-24 as the next generation of the Fitbit Web
API. Current documentation supports both REST and gRPC and standard Google OAuth 2.0.

For this project, REST is the natural initial choice because the backend is already a Python
HTTP-oriented ingestion service and the expected volume is low.

Primary references:

- https://developers.google.com/health/get-started
- https://developers.google.com/health/release-notes
- https://developers.google.com/health/about

### 3.2 Raw data points preserve provenance

The Google Health API's `DataSource` model tracks origin information. Its `application` field
contains a mobile application identifier such as an Android package name, and the platform field
indicates how the data was uploaded.

This matters more than the aggregation itself.

It allows the application to model:

```text
provider = garmin
transport = google_health
```

separately from:

```text
provider = eight_sleep
transport = google_health
```

rather than treating both as `provider=google`.

Reference:

- https://developers.google.com/health/reference/rpc/google.devicesandservices.health.v4

### 3.3 Use raw list for recovery research, not reconcile by default

The raw list endpoint is:

```text
GET https://health.googleapis.com/v4/users/me/dataTypes/{dataType}/dataPoints
```

The reconcile endpoint is:

```text
GET https://health.googleapis.com/v4/users/me/dataTypes/{dataType}/dataPoints:reconcile
```

`reconcile` intentionally combines multiple sources into one stream.

That can be useful for display-oriented concepts such as generic steps, but it is the wrong
default for recovery physiology because cross-source agreement/disagreement is itself valuable
evidence.

For HRV, RHR, respiration, sleep timing, and sleep architecture, the project should initially
use raw/list data and preserve source metadata.

References:

- https://developers.google.com/health/reference/rest/v4/users.dataTypes.dataPoints/list
- https://developers.google.com/health/reference/rest/v4/users.dataTypes.dataPoints/reconcile

### 3.4 Read-only scopes are sufficient

Google Health scopes begin with:

```text
https://www.googleapis.com/auth/googlehealth
```

The relevant initial read-only categories are:

```text
googlehealth.sleep.readonly
googlehealth.health_metrics_and_measurements.readonly
```

`activity_and_fitness.readonly` should be requested only if a concrete MS work item needs it.
The project should not request write scopes for this capability.

Reference:

- https://developers.google.com/health/scopes

### 3.5 Webhooks are useful but must not be the sole recovery mechanism

Google Health supports webhook notifications for relevant data types including sleep, HRV,
daily HRV, heart rate, daily resting heart rate, respiratory data and several related health
signals.

Current webhook guidance includes:

- HTTPS endpoint;
- subscriber verification;
- signed notifications;
- idempotent handling;
- lightweight acknowledgement plus queued processing;
- retries for failed delivery for up to seven days.

That makes webhooks attractive for freshness, but the system must still have scheduled repair
sync because notifications older than the retention/retry window can be lost and permission
revocation/system-level deletion does not produce every possible notification needed for local
state repair.

Reference:

- https://developers.google.com/health/webhooks

---

## 4. Garmin findings

Garmin officially supports one-way Garmin Connect → Health Connect sharing.

Garmin currently documents the following outbound categories:

### Activity

- active/total calories;
- cycling cadence;
- distance;
- elevation;
- heart rate;
- speed;
- steps;
- swimming strokes.

### Wellness

- body fat;
- calories;
- floors;
- heart rate;
- sleep stages;
- steps/distance;
- weight.

Garmin explicitly states that Garmin Connect does not read data back from Health Connect.

Reference:

- https://support.garmin.com/lv-LV/?faq=JToBEy0jfe6pIygark2Ui5

### 4.1 Why this does not replace direct Garmin ingestion

The current repository extracts materially richer Garmin-specific information, including
training/recovery constructs and per-activity detail that Garmin does not list as part of its
Health Connect export.

Therefore the target should be:

```text
Garmin direct
    = specialist sports/training source

Garmin through Google Health
    = transport-equivalence validation + generic cross-source visibility
```

Do not delete the current Garmin adapter.

---

## 5. Eight Sleep findings and uncertainty

Eight Sleep's current privacy wording lists Apple Health and Google Health Connect among
third-party integrations and states that Eight Sleep may receive information from those
outside sources.

References:

- https://vercel.eightsleep.com/legal/privacy
- https://www.eightsleep.com/legal/consumer-health-data-privacy-policy/

This establishes **integration**, but not enough to establish that the Eight Sleep app exports
Pod-generated metrics into Health Connect.

That distinction is critical.

### 5.1 What must be verified empirically

The source-provenance probe must answer, for the real account/device:

| Metric | Eight Sleep-origin record visible? | Source application retained? | Freshness acceptable? |
|---|---:|---:|---:|
| sleep session | ? | ? | ? |
| sleep stages | ? | ? | ? |
| HRV | ? | ? | ? |
| heart rate / resting HR | ? | ? | ? |
| respiration | ? | ? | ? |
| temperature-derived metric | ? | ? | ? |

If Eight Sleep does not appear, Google Health is still useful for future providers and Garmin
cross-checks, but it does not eliminate the need for a separate Eight Sleep acquisition path.

---

## 6. Options considered

### Option A — Keep only direct Garmin + direct Eight Sleep

**Pros**
- maximum provider detail;
- simplest source semantics.

**Cons**
- unofficial/unsupported Eight Sleep API dependency;
- one custom authentication/client lifecycle per provider;
- no generic route for future Health Connect sources.

**Verdict:** valid fallback, not preferred default.

### Option B — Replace Garmin with Google Health

**Pros**
- one standardized transport;
- easier OAuth story.

**Cons**
- loses Garmin-only training/recovery detail;
- may lose semantics needed for existing recommendation behavior;
- unnecessary regression risk.

**Verdict:** reject.

### Option C — Use Google Health reconciled stream as canonical recovery truth

**Pros**
- lowest implementation complexity downstream.

**Cons**
- obscures device disagreement;
- can destroy source-specific baseline continuity;
- makes Google's reconciliation policy part of recommendation science without local evidence.

**Verdict:** reject for recovery physiology.

### Option D — Google Health as transport + direct specialist providers

```text
Garmin direct --------------------------┐
                                       │
Health Connect → Google Health raw -----┼→ source observations
                                       │
Optional Eight Sleep direct ------------┘
```

**Pros**
- preserves provider specialization;
- keeps source provenance;
- supports future providers;
- allows Google Health to replace unsupported Eight Sleep access if the real source path works;
- supports transport-equivalence testing.

**Cons**
- requires explicit deduplication/provenance model;
- temporarily creates more than one route for Garmin data.

**Verdict:** recommended.

---

## 7. Durable architecture recommendation

The durable unit should be a **physiological observation with origin and transport**, not a
vendor-shaped daily blob.

Conceptually:

```python
CanonicalObservation(
    metric="hrv_rmssd_ms",
    value=61.2,
    provider="eight_sleep",
    transport="google_health",
    origin_application="...",
    observed_start=...,
    observed_end=...,
    logical_date="2026-08-27",
    semantic_version="...",
)
```

For Garmin direct:

```python
CanonicalObservation(
    metric="hrv_rmssd_ms",
    value=68.0,
    provider="garmin",
    transport="garmin_direct",
    ...
)
```

### 7.1 Provider and transport are different dimensions

This distinction must survive normalization.

Examples:

```text
Garmin / garmin_direct
Garmin / google_health
Eight Sleep / google_health
Eight Sleep / eight_sleep_direct
```

Transport identity is needed for equivalence testing and debugging. Provider identity is needed
for baselines and interpretation.

### 7.2 Baselines are source-specific

Never build one historical HRV baseline by switching between whichever device happened to have
data on a given night.

Instead:

```text
garmin.hrv → Garmin baseline
eight_sleep.hrv → Eight Sleep baseline
```

Only after normalization into source-relative evidence may streams be compared/fused.

### 7.3 Fuse evidence, not raw values

Wrong:

```text
combined_hrv = (garmin_hrv + eight_sleep_hrv) / 2
```

Better:

```text
Garmin HRV deviation       = -1.2 source-specific z/MAD units
Eight Sleep HRV deviation  = -1.4 source-specific z/MAD units
agreement                  = strong adverse agreement
```

The biological concept still receives one HRV contribution in the engine. A second sensor can
raise confidence; it must not double HRV's total policy weight.

### 7.4 Missing secondary data is degradation, not failure

Required behavior:

```text
Google Health unavailable
→ log provider/transport degradation
→ continue Garmin direct + subjective inputs
→ recommendation still succeeds
```

Likewise for Eight Sleep.

---

## 8. Storage recommendation

Do not immediately replace `daily_recovery_snapshots`.

Introduce an additive lower-level source observation store first.

Candidate Firestore shape:

```text
users/{userId}/
  health_observations/
    {observationId}
```

with fields such as:

```text
metric
value
unit
provider
transport
originApplication
sourceRecordId
observedStart
observedEnd
logicalDate
ingestedAt
sourcePayloadHash
schemaVersion
```

For volume-heavy sample streams, prefer raw archive / aggregate storage rather than one
Firestore document per high-frequency heart-rate sample.

The exact physical model should be finalized in ADR-0027 and MS1/MS2 after the Phase-0 payload
probe confirms real Google Health shapes and cardinalities.

---

## 9. Relationship to existing ADRs

A new ADR is justified because current ADR-0026 solves a different problem.

ADR-0026 establishes:

- provider-specific parsing stops at the provider boundary;
- date-bound recovery observations are different from current profile and activity data;
- optional wearable enrichment is failure-isolated;
- future providers may satisfy provider-neutral boundaries.

It does **not** decide:

- how to represent the same metric from multiple simultaneous providers;
- whether baselines may cross provider boundaries;
- whether transport and provider are separate;
- how to prevent physiological double counting;
- whether a reconciler owned by a third party may become training-policy authority.

Those are new architectural decisions and should be captured in ADR-0027 rather than silently
amending accepted ADR-0026.

---

## 10. Recommended execution order

```text
MS0 source-provenance probe
        ↓
ADR-0027 acceptance/revision
        ↓
source observation model
        ↓
Google OAuth + raw list client
        ↓
raw archive / idempotent persistence
        ↓
Garmin transport-equivalence validation
        ↓
Eight Sleep source decision
        ↓
source-specific baseline shadow computation
        ↓
35–45 night prospective overlap
        ↓
replay/simulation comparison
        ↓
separate metric-by-metric activation decision
```

The 35–45-night overlap is not a magic physiological threshold. It is an engineering/evidence
window chosen because the existing recommender already relies on 28-day baselines and needs
enough additional nights to evaluate completeness, disagreement, latency, and baseline
stability after warm-up.

---

## 11. Explicit non-goals

Initial work should not:

- change recommendation thresholds;
- replace Garmin direct ingestion;
- enable Google's reconciled recovery stream as production truth;
- write any data back to Google Health;
- change Eight Sleep temperature/alarm/Autopilot settings;
- make Health Connect or Google Health mandatory for recommendation generation;
- average device-level HRV/RHR/respiration values;
- infer that Eight Sleep export works before source provenance is observed;
- rename `src/garmin_sync/` as a prerequisite.

A package/module rename can happen later if the implementation genuinely becomes multi-provider;
it is not required to establish the data model correctly.

---

## 12. Evidence required after the probe

Publish a new dated analysis document containing only sanitized evidence:

```text
docs/analysis/YYYY-MM-DD-google-health-source-provenance-probe-results.md
```

Minimum report:

- Google Health data types actually returned;
- source application identifiers observed;
- Garmin direct vs Google Health/Garmin value equivalence;
- Eight Sleep source presence/absence;
- timestamp/date-boundary behavior in Europe/Warsaw;
- duplicate behavior;
- observed latency;
- missing-data cases;
- any semantic mismatch.

That result, not marketing documentation, should determine whether Eight Sleep can use the
Google path.

---

## 13. Primary external references

Google:

- https://developers.google.com/health/get-started
- https://developers.google.com/health/release-notes
- https://developers.google.com/health/scopes
- https://developers.google.com/health/reference/rest/v4/users.dataTypes.dataPoints/list
- https://developers.google.com/health/reference/rest/v4/users.dataTypes.dataPoints/reconcile
- https://developers.google.com/health/reference/rpc/google.devicesandservices.health.v4
- https://developers.google.com/health/webhooks
- https://developers.google.com/health/app-verification

Garmin:

- https://support.garmin.com/lv-LV/?faq=JToBEy0jfe6pIygark2Ui5

Eight Sleep:

- https://vercel.eightsleep.com/legal/privacy
- https://www.eightsleep.com/legal/consumer-health-data-privacy-policy/

---

## 14. Conclusion

Proceed with a Google Health integration, but define the capability as **multisource recovery
ingestion**, not “Google Health becomes the wearable backend.”

The recommended invariant is:

> Preserve source identity until after source-specific normalization; fuse physiological
> evidence only after provenance, semantics, baseline continuity, and data quality are known.

That gives the project a path to Eight Sleep and future providers without sacrificing the
Garmin-specific training intelligence that already exists.
