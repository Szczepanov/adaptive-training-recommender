# ADR-0026: Wearable Telemetry Enrichment Boundaries and Ownership

* **Status:** Accepted
* **Date:** 2026-08-23
* **Deciders:** Core Engineering Team

---

## Context

Garmin ingestion has expanded well beyond the original recovery snapshot. The repository now has
four materially different kinds of wearable-derived data:

1. **date-bound recovery observations**, such as sleep, RHR, HRV, respiration, stress,
   Body Battery, Training Readiness, Training Status, recovery time, sleep-stage durations,
   SpO2/skin-temperature deviation, completed steps, and same/recent-day training summaries;
2. **current athlete profile values**, such as weight/body-fat, cycling FTP, running threshold
   pace/LTHR, and Garmin race predictions;
3. **per-activity telemetry**, such as Training Effect, EPOC, recovery time, cycling
   power/HR-zone detail, laps, running-dynamics summary fields, and strength exercise sets; and
4. **current gear inventory**, such as registered shoes/bikes and their accumulated mileage.

These data products differ in provenance, replay semantics, API cost, failure tolerance, and
ownership. Treating all Garmin fields as one "telemetry blob" would make historical rebuilds
incorrect, allow current profile configuration to leak into past dates, or make optional
endpoint failures break the core daily recovery path.

A repository audit for this ADR also found a second risk: Garmin exposes additional data in
some clients/devices, but the application does not implement every possible signal, and past
documentation had a track record of describing capability as if it were already-shipped
behavior. Architecture documentation must distinguish implemented behavior from desired future
scope, and this ADR records that distinction as it stands today: SpO2/Pulse Ox,
skin-temperature deviation, running-dynamics summary fields, and gear mileage are **implemented**
(§1–§3), each isolated behind this ADR's ownership and failure-isolation boundary. What remains
genuinely deferred is narrower — see §7.

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

* `CanonicalDailyMetrics` and `CanonicalSpo2`;
* `CanonicalStress` / `CanonicalBodyBattery` / `CanonicalTrainingReadiness` /
  `CanonicalTrainingStatus` / `CanonicalHeartRateZones`;
* `CanonicalActivity`, `CanonicalActivityDetail`, and `CanonicalRunningDynamics`;
* `CanonicalExerciseSet`, `CanonicalZoneBucket`, and `CanonicalLapSummary`;
* `CanonicalGearItem`; and
* `CanonicalRacePredictions` and `CanonicalPerformanceTargets`.

Sleep-stage durations are fields on `CanonicalDailyMetrics`; there is no separate
`CanonicalSleepStages` type.

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
* SpO2 (`spo2.avgPct`/`minPct`/`sleepAvgPct`) and skin-temperature deviation
  (`skinTempDeviationCelsius`) when available, each independently flagged by
  `dataQuality.spo2Available` / `dataQuality.skinTempAvailable`;
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

#### Current gear inventory

`users/{userId}/gear/{gearPk}` owns one document per Garmin-registered gear item (shoes, bikes),
imported from `Garmin.get_gear()`/`get_gear_stats()`. `preferences/profile.gearTracker` carries a
compact list for the preferences UI, with a `syncedAt` timestamp. Like the performance profile,
this is current-state, not a historical observation: it is refreshed after a successful live
daily sync and is not replayed during backfill/rebuild. `FirestoreRecoveryRepository`
treats an empty canonical gear result as a no-op so a transient Garmin failure cannot erase a
previously synchronized snapshot. Client Firestore rules permit only the owning user to read
`users/{userId}/gear/*` and deny client writes. See
[`docs/garmin-gear-tracking.md`](../garmin-gear-tracking.md) for the full contract.

#### Standalone activities

`users/{userId}/activities/{activityId}` owns session-specific telemetry independently of a
single recovery snapshot. Base activity records may contain aerobic/anaerobic Training Effect,
average HR, Garmin activity training load, primary benefit/training-effect descriptors, EPOC,
recovery time, and the application's intensity tag.

Additive detail may contain:

* strength `exerciseSets`;
* running-dynamics summary fields (`runningDynamics`) on eligible running activities; or
* for eligible power-bearing cycling activity detail: power zones, HR zones, lap summaries,
  normalized power, intensity factor, and derived variability index.

Stable activity IDs make overlapping sync windows idempotent instead of creating duplicate
activity documents.

#### Raw archive

ADR-0005's `RawArchiveStore` remains the source-level replay store for date-keyed snapshot
payloads. Daily and current-profile endpoint payloads are archived when fetched, including the
optional `spo2` endpoint key; skin-temperature deviation is read from the already-archived
`sleep` payload rather than a separate archive key.

Per-activity detail payloads — including strength sets, cycling power/HR/lap detail, and
running-dynamics fields — are **not** currently added to that archive because the archive is
keyed by logical date while those payloads need activity-ID identity. Consequently, offline
`rebuild` reconstructs recovery snapshots but does not reconstruct standalone activity-detail
history. Changing that requires an archive-key/storage decision, not an undocumented extension
of ADR-0005. Gear inventory is likewise not archived, consistent with its current-state (not
date-bound) ownership.

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
training targets. Gear mileage and retirement distance are provider-reported context read from
the athlete's own Garmin configuration, not a manually editable active training target either.

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
* SpO2/Pulse Ox;
* skin-temperature deviation;
* body composition / weigh-ins;
* cycling FTP;
* running lactate threshold;
* race predictions; and
* gear inventory.

Current-profile import itself is best-effort and occurs after snapshot persistence. A failed
profile or gear endpoint cannot turn a successfully persisted daily recovery snapshot into a
failed one. The SpO2 endpoint is a partial exception within this best-effort group: Garmin
API/data failures are ordinary missing health data, but a missing `get_spo2_data` method on the
installed `garminconnect` package is treated as a dependency-contract/programming error and is
allowed to fail the sync rather than being silently swallowed.

Activity-detail enrichment (including running dynamics) is also best-effort. A detail failure
does not prevent the base activity from being stored. An exhausted Garmin 429 abandons remaining
activity-detail work for that run so enrichment does not amplify rate-limit pressure.

Refreshed Garmin authentication tokens are persisted after authenticated API work, including
profile and gear enrichment.

### 5. Activity-detail request cost is explicitly gated

Strength exercise sets and cycling power detail are different products and must not be coupled
into one expensive request bundle.

* Eligible strength/fitness-equipment activities use the exercise-sets endpoint without first
  calling cycling power-detail endpoints.
* Target-date live sync attempts strength-set enrichment and running-dynamics extraction as part
  of normal activity handling for eligible activities.
* Cycling power/HR-zone/split detail is enabled only by
  `GARMIN_ACTIVITY_DETAIL_ENABLED=true` for the normal live sync path.
* Historical `backfill` includes activity detail only when explicitly requested with
  `--include-details`.
* `rebuild` does not fetch Garmin and does not synthesize activity detail from absent archive
  data.
* A gear refresh costs one inventory call plus up to one stats call per gear item whose
  inventory object lacks `totalDistance`; the stats call is skipped when mileage is already
  present.

This preserves API budget and keeps optional telemetry from becoming an accidental hard
dependency.

### 6. Derived telemetry is labeled as derived, not provider truth

The provider adapter may derive values only when the derivation is deterministic and its input
semantics are known. Examples in the current implementation include:

* variability index = normalized power / average power only when average power is positive;
* sleep-window respiration average computed from valid interval readings only when minimum
  sample/coverage requirements are met, otherwise falling back to Garmin's sleep summary;
* exercise-set rest duration folded from Garmin's interleaved REST row into the preceding work
  set;
* running-dynamics unit conversions (vertical oscillation mm→cm, stride length cm→m) applied
  only within plausible physiological ranges (ground-contact balance 35–65%, vertical ratio
  1–25%); values outside those ranges are omitted, not clamped or invented; and
* gear mileage/maximum distance converted from Garmin meters to kilometers.

Missing provider data remains missing. The mapper must not invent plausible-looking defaults
that erase provenance or data-quality uncertainty.

### 7. What remains explicitly deferred

This ADR does **not** approve undocumented implementation claims for every signal Garmin may
expose. SpO2, skin-temperature deviation, running-dynamics summary fields, and gear mileage are
implemented (§1–§3) — an earlier draft of this ADR described them as unsupported, which was
already stale by the time it was written. As of this decision, the following remain
unimplemented:

* a gait-asymmetry alert or threshold derived from ground-contact balance — the raw
  `groundContactBalanceLeftPct` value is ingested and rendered, but no alerting/threshold logic
  is built on top of it;
* an interactive sleep-stage chart — stage durations are rendered as text values in
  `DataView.tsx`, not as a chart component; and
* an automatic, generic shoe/bike retirement rule — only the athlete's own Garmin-configured
  `maximumMeters` threshold is surfaced as a usage percentage; there is no universal
  mileage-based retirement default.

These are not written to recovery snapshots, activities, preferences, or persisted anywhere, and
the UI must not be documented as exposing them.

A future addition — for this list or any other unimplemented wearable signal — must first
establish, at minimum:

1. observed/provider endpoint shape and device/account availability;
2. canonical field names and units;
3. temporal/storage ownership;
4. missingness and failure semantics;
5. raw-archive/replay treatment where relevant;
6. tests for malformed/partial provider payloads; and
7. whether the field is observation-only, user-facing context, or decision-relevant.

Decision relevance remains separately evidence-gated by the applicable ADR. In particular,
ingesting a biometric (including the SpO2, skin-temperature, and running-dynamics signals
ingested under this ADR) does not automatically authorize it to affect training or
health-anomaly policy.

Generic equipment-lifespan ranges are not an acceptable basis for an automatic shoe-retirement
rule. The current gear feature respects this: it distinguishes provider-reported distance from
the athlete's own Garmin-configured replacement guidance rather than encoding a universal
mileage threshold as fact.

### 8. UI exposure follows the persisted contract; it does not define it

Current UI surfaces are downstream consumers of the contracts above:

* `DataView.tsx` renders recovery metrics, sleep-stage durations/restlessness, recovery time,
  and SpO2/skin-temperature values as text;
* `ActivityTelemetry.tsx` renders Training Effect/EPOC/recovery descriptors plus available
  power/HR zones, laps, strength sets, and running-dynamics fields; and
* `PerformanceSections.tsx` renders body composition, W/kg context, Garmin-imported targets,
  race predictions, and gear-item mileage/usage.

UI presence does not promote an optional field into a required ingestion dependency, nor does a
future UI idea imply that its underlying provider data already exists.

---

## Consequences

### Positive

* The architecture now matches the repository's actual canonical models and Firestore paths,
  including the SpO2, running-dynamics, and gear inventory work merged since this ADR was first
  drafted.
* Historical observations, current profile/gear configuration, and per-session telemetry have
  clear ownership and replay semantics.
* Optional Garmin endpoints can enrich the product without making the recovery pipeline
  brittle.
* Manual/coach target ownership remains protected during automated profile refresh.
* Signals that are still genuinely unimplemented (gait-asymmetry alerting, an interactive
  sleep-stage chart, automatic generic retirement rules) cannot silently enter architecture
  documentation as if already shipped.

### Trade-offs

* Some useful Garmin signals remain unavailable until endpoint evidence, canonicalization,
  persistence, tests, and UX semantics are implemented (§7).
* Activity-detail raw payloads, including running dynamics, are not currently replayable from
  ADR-0005's date-keyed archive; neither is gear inventory.
* Browser and backend snapshot-completeness predicates are not identical; architecture must
  document them separately until a deliberate harmonization decision is made.
* Rich activity detail and gear refreshes increase Garmin request volume and therefore remain
  gated/best-effort.
* Newly-ingested biometrics (SpO2, skin-temperature, running dynamics) are not yet evidence-gated
  into recommendation or health-anomaly policy; that remains separate, future work under
  ADR-0022/ADR-0024/ADR-0025.

---

## Rejected alternatives

### Treat every Garmin capability as already part of the architecture

Rejected. Library/device capability is not repository implementation. An earlier documentation
draft did this and produced false claims — both by describing unbuilt capability as shipped, and
later by describing SpO2/running-dynamics/gear as unbuilt after they had, in fact, shipped.
Architecture documentation must be re-verified against the current default branch, not just
against the PR's own base commit.

### Store all wearable data in the daily recovery snapshot

Rejected. Current profile values, current gear inventory, and standalone activity detail have
different temporal and replay semantics. Collapsing them into one date document would make
historical interpretation ambiguous.

### Let Garmin overwrite all performance-profile fields

Rejected. Provider convenience does not outrank explicit athlete/coach ownership.

### Make all enrichments hard dependencies of daily sync

Rejected. Optional endpoint availability and Garmin rate limits are too variable to make
recovery ingestion depend on every enrichment succeeding.

### Encode a universal gear-retirement mileage threshold

Rejected. Equipment lifespan varies by product, terrain, and athlete; only the athlete's own
Garmin-configured `maximumMeters` is surfaced, with no invented default.
