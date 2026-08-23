# ADR-0026: Wearable Telemetry Enrichment Boundaries and Ownership

* **Status:** Accepted
* **Date:** 2026-08-23
* **Deciders:** Core Engineering Team

---

## Context

Garmin ingestion has expanded beyond the original recovery snapshot. The repository now has
three materially different kinds of wearable-derived data:

1. **date-bound recovery observations**, such as sleep, RHR, HRV, respiration, stress,
   Body Battery, Training Readiness, Training Status, recovery time, sleep-stage durations,
   completed steps, and same/recent-day training summaries;
2. **current athlete profile values**, such as weight/body-fat, cycling FTP, running threshold
   pace/LTHR, and Garmin race predictions; and
3. **per-activity telemetry**, such as Training Effect, EPOC, recovery time, cycling
   power/HR-zone detail, laps, and strength exercise sets.

These data products differ in provenance, replay semantics, API cost, failure tolerance, and
ownership. Treating all Garmin fields as one "telemetry blob" would make historical rebuilds
incorrect, allow current profile configuration to leak into past dates, or make optional
endpoint failures break the core daily recovery path.

A repository audit for this ADR also found a second risk: Garmin exposes additional data in
some clients/devices, but the application does not currently implement every possible signal.
Architecture documentation must distinguish implemented behavior from desired future scope.
In particular, the current codebase has no canonical/persistence path for SpO2, skin
temperature, running dynamics, or Garmin gear mileage.

This ADR records the ownership and failure-isolation boundary that exists now and sets the bar
for future wearable extensions. It complements:

* ADR-0002 — user-scoped Firestore isolation;
* ADR-0003 — timezone and `D-1` completed-step semantics;
* ADR-0005 — immutable date-keyed raw archive and offline rebuild;
* ADR-0010 — replay/provenance requirements;
* ADR-0022 — evidence-gated activity-zone credit;
* ADR-0024 — metric-specific biometric baseline estimator policy; and
* ADR-0025 — physiological-anomaly capability and evidence discipline.

---

## Decision

### 1. Garmin-specific response shapes stop at the provider boundary

The application keeps Garmin endpoint and response-shape knowledge inside
`garmin_client.py` and `garmin_provider.py`.

`GarminClientWrapper` wraps `garminconnect.Garmin`. `GarminProviderAdapter` converts provider
payloads into the provider-neutral models defined in `canonical.py`. Downstream service,
mapper, and repository layers operate on those canonical models rather than parsing Garmin
JSON directly.

Current canonical types relevant to this boundary include:

* `CanonicalDailyMetrics`;
* `CanonicalStress` / `CanonicalBodyBattery` / `CanonicalTrainingReadiness` /
  `CanonicalTrainingStatus` / `CanonicalHeartRateZones`;
* `CanonicalActivity` and `CanonicalActivityDetail`;
* `CanonicalExerciseSet`, `CanonicalZoneBucket`, and `CanonicalLapSummary`; and
* `CanonicalRacePredictions` and `CanonicalPerformanceTargets`.

Sleep-stage durations are fields on `CanonicalDailyMetrics`; there is no separate
`CanonicalSleepStages` type. The current codebase likewise has no `CanonicalSpo2` or
`CanonicalGearItem`.

A future provider may satisfy the `WearableProvider` boundary without exposing Garmin-specific
payload shapes to the rest of the application. Provider capabilities are explicit and optional
capabilities must degrade safely.

### 2. Storage ownership follows temporal semantics

#### Daily recovery snapshot

`users/{userId}/daily_recovery_snapshots/{YYYY-MM-DD}` owns observations attributable to a
specific local date and the derived baselines/provenance built from them.

Current date-bound fields include the core recovery metrics plus:

* sleep-stage scalar durations (`deepSleepSec`, `remSleepSec`, `lightSleepSec`,
  `awakeSleepSec`) and `restlessMomentsCount`;
* stress, Body Battery detail, Training Readiness, Training Status, configured HR-zone summary,
  and recovery time when available;
* weight/body-fat observations for that date when a valid weigh-in exists; and
* same-day / previous-day training summaries derived from the activity window.

These values remain historical observations. They must not be silently replaced by the
athlete's current profile configuration during a rebuild.

#### Current performance profile

`users/{userId}/preferences/profile.performanceProfile` owns current, configuration-like
athlete values imported from Garmin:

* cycling FTP;
* running threshold pace and running LTHR;
* current weight and body-fat percentage;
* measurement timestamps where supplied; and
* 5K, 10K, half-marathon, and marathon race predictions.

This import runs after a successful live daily sync. Backfill/rebuild never project today's
profile values into historical snapshots.

#### Standalone activities

`users/{userId}/activities/{activityId}` owns session-specific telemetry independently of a
single recovery snapshot. Base activity records may contain aerobic/anaerobic Training Effect,
average HR, Garmin activity training load, primary benefit/training-effect descriptors, EPOC,
recovery time, and the application's intensity tag.

Additive detail may contain:

* strength `exerciseSets`; or
* for eligible power-bearing cycling activity detail: power zones, HR zones, lap summaries,
  normalized power, intensity factor, and derived variability index.

Stable activity IDs make overlapping sync windows idempotent instead of creating duplicate
activity documents.

#### Raw archive

ADR-0005's `RawArchiveStore` remains the source-level replay store for date-keyed snapshot
payloads. Daily and current-profile endpoint payloads are archived when fetched.

Per-activity detail payloads are **not** currently added to that archive because the archive is
keyed by logical date while those payloads need activity-ID identity. Consequently, offline
`rebuild` reconstructs recovery snapshots but does not reconstruct standalone activity-detail
history. Changing that requires an archive-key/storage decision, not an undocumented extension
of ADR-0005.

### 3. Current-profile imports use field-level ownership

Garmin must not overwrite a coach- or athlete-authored target merely because a provider value
exists.

`performanceProfile.targetSources` is the ownership guard:

* `manual` and `coach` values are never overwritten by automated Garmin import;
* `garmin`-owned fields may be refreshed by later Garmin imports;
* an absent active field may be populated by Garmin; and
* a legacy active value with no source is conservatively marked `manual` rather than silently
  adopted by Garmin.

Measurement timestamps such as `weightMeasuredAt` and `ftpMeasuredAt` are persisted when the
provider supplies them. Race predictions are provider context, not manually editable active
training targets.

### 4. Optional enrichment is failure-isolated; the core contract is not

The ingestion path distinguishes required/core fetches from enrichment.

Core stats/sleep/HRV and activity-window failures may fail the relevant sync operation. The
following daily/profile enrichments are fetched best-effort and log a warning rather than
invalidating an already viable core recovery sync:

* stress;
* detailed respiration;
* Body Battery detail;
* Training Readiness;
* Training Status;
* HR-zone profile;
* body composition / weigh-ins;
* cycling FTP;
* running lactate threshold; and
* race predictions.

Current-profile import itself is best-effort and occurs after snapshot persistence. A failed
profile endpoint cannot turn a successfully persisted daily recovery snapshot into a failed
one.

Activity-detail enrichment is also best-effort. A detail failure does not prevent the base
activity from being stored. An exhausted Garmin 429 abandons remaining activity-detail work for
that run so enrichment does not amplify rate-limit pressure.

Refreshed Garmin authentication tokens are persisted after authenticated API work, including
profile enrichment.

### 5. Activity-detail request cost is explicitly gated

Strength exercise sets and cycling power detail are different products and must not be coupled
into one expensive request bundle.

* Eligible strength/fitness-equipment activities use the exercise-sets endpoint without first
  calling cycling power-detail endpoints.
* Target-date live sync attempts strength-set enrichment as part of normal activity handling.
* Cycling power/HR-zone/split detail is enabled only by
  `GARMIN_ACTIVITY_DETAIL_ENABLED=true` for the normal live sync path.
* Historical `backfill` includes activity detail only when explicitly requested with
  `--include-details`.
* `rebuild` does not fetch Garmin and does not synthesize activity detail from absent archive
  data.

This preserves API budget and keeps optional telemetry from becoming an accidental hard
dependency.

### 6. Derived telemetry is labeled as derived, not provider truth

The provider adapter may derive values only when the derivation is deterministic and its input
semantics are known. Examples in the current implementation include:

* variability index = normalized power / average power only when average power is positive;
* sleep-window respiration average computed from valid interval readings only when minimum
  sample/coverage requirements are met, otherwise falling back to Garmin's sleep summary; and
* exercise-set rest duration folded from Garmin's interleaved REST row into the preceding work
  set.

Missing provider data remains missing. The mapper must not invent plausible-looking defaults
that erase provenance or data-quality uncertainty.

### 7. Unsupported wearable signals stay explicitly deferred

This ADR does **not** approve undocumented implementation claims for every signal Garmin may
expose. As of this decision, the repository has no implemented ingestion/canonical/storage path
for:

* SpO2 / Pulse Ox;
* skin-temperature deviation;
* running-dynamics fields such as ground-contact balance, vertical oscillation/ratio, stride
  length, or running power; or
* Garmin gear/shoe/bike mileage and retirement thresholds.

These are not written to recovery snapshots, activities, preferences, or a `gear` collection,
and the UI must not be documented as exposing them.

A future addition must first establish, at minimum:

1. observed/provider endpoint shape and device/account availability;
2. canonical field names and units;
3. temporal/storage ownership;
4. missingness and failure semantics;
5. raw-archive/replay treatment where relevant;
6. tests for malformed/partial provider payloads; and
7. whether the field is observation-only, user-facing context, or decision-relevant.

Decision relevance remains separately evidence-gated by the applicable ADR. In particular,
adding a biometric to ingestion does not automatically authorize it to affect training or
health-anomaly policy.

Generic equipment-lifespan ranges are not an acceptable basis for an automatic shoe-retirement
rule. Any future gear feature must distinguish provider-reported distance from manufacturer or
user-specific replacement guidance rather than encode a universal mileage threshold as fact.

### 8. UI exposure follows the persisted contract; it does not define it

Current UI surfaces are downstream consumers of the contracts above:

* `DataView.tsx` renders recovery metrics, sleep-stage durations/restlessness, and recovery
  time;
* `ActivityTelemetry.tsx` renders Training Effect/EPOC/recovery descriptors plus available
  power/HR zones, laps, and strength sets; and
* `PerformanceSections.tsx` renders body composition, W/kg context, Garmin-imported targets,
  and race predictions.

UI presence does not promote an optional field into a required ingestion dependency, nor does a
future UI idea imply that its underlying provider data already exists.

---

## Consequences

### Positive

* The architecture now matches the repository's actual canonical models and Firestore paths.
* Historical observations, current profile configuration, and per-session telemetry have clear
  ownership and replay semantics.
* Optional Garmin endpoints can enrich the product without making the recovery pipeline
  brittle.
* Manual/coach target ownership remains protected during automated profile refresh.
* Unsupported signals cannot silently enter architecture documentation as if already shipped.

### Trade-offs

* Some useful Garmin signals remain unavailable until endpoint evidence, canonicalization,
  persistence, tests, and UX semantics are implemented.
* Activity-detail raw payloads are not currently replayable from ADR-0005's date-keyed archive.
* Browser and backend snapshot-completeness predicates are not identical; architecture must
  document them separately until a deliberate harmonization decision is made.
* Rich activity detail increases Garmin request volume and therefore remains gated/best-effort.

---

## Rejected alternatives

### Treat every Garmin capability as already part of the architecture

Rejected. Library/device capability is not repository implementation. Doing this produced
false claims about SpO2, skin temperature, running dynamics, and gear storage.

### Store all wearable data in the daily recovery snapshot

Rejected. Current profile values and standalone activity detail have different temporal and
replay semantics. Collapsing them into one date document would make historical interpretation
ambiguous.

### Let Garmin overwrite all performance-profile fields

Rejected. Provider convenience does not outrank explicit athlete/coach ownership.

### Make all enrichments hard dependencies of daily sync

Rejected. Optional endpoint availability and Garmin rate limits are too variable to make
recovery ingestion depend on every enrichment succeeding.