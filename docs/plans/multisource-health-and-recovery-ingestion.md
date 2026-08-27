# MS — Multisource Health & Recovery Ingestion

* **Status:** `Approved`
* **Proposed:** 2026-08-27
* **Blocked by:** none (`MS0` is startable today; `MS1+` gated by `MS0` evidence).
* **Unlocks:** source-aware Google Health ingestion, Eight Sleep source validation,
  transport-equivalence measurement, and evidence-gated multisource recovery fusion.
* **Source analysis:**
  [`2026-08-27-google-health-and-multisource-wearable-integration.md`](../analysis/2026-08-27-google-health-and-multisource-wearable-integration.md)
* **Decision record:**
  [`ADR-0027`](../adr/0027-source-aware-multisource-health-observations.md)

> **Not a top-level phase.** This is a capability plan, like G/S/M/OV/HA/SV. Work items use the
> `MS*` prefix so they cannot be mistaken for the repository's Phase 0–9 roadmap sequence.

> **No recommendation impact by default.** MS ingestion, provenance, baselines, and comparison
> telemetry remain shadow-only until a later work item has prospective evidence and an explicit
> production activation decision.

---

## Goal

Add a source-aware recovery observation path that can ingest Google Health raw data while
retaining direct Garmin, determine whether Eight Sleep can be obtained through Google Health,
and create the measurement foundation for evidence-based multisource recovery fusion.

The capability is successful even if Eight Sleep is **not** available through Google Health,
because the source/provenance layer and Google Health transport remain reusable for future
sources.

---

## Non-goals

This plan does not initially:

- replace direct Garmin;
- change engine thresholds or weights;
- enable Google Health reconciliation as production recovery truth;
- write data to Google Health;
- control Eight Sleep temperature/alarms/Autopilot;
- make Google Health mandatory for recommendations;
- ingest every Google Health data type;
- rename `garmin_sync` before the new capability proves the need;
- build a user-facing multisource dashboard before the evidence path works.

---

## Preconditions / governing invariants

| ID | Condition |
|---|---|
| P1 | ADR-0002 user-scoped storage remains mandatory. |
| P2 | ADR-0003 Warsaw-local date semantics remain mandatory. |
| P3 | ADR-0005 raw/replay discipline applies to new external payloads. |
| P4 | ADR-0010 requires decision-impacting changes to be replayable/auditable. |
| P5 | ADR-0024 governs baseline-estimator choices. |
| P6 | ADR-0026 keeps vendor response shapes behind provider boundaries. |
| P7 | ADR-0027 governs multisource provenance, observation bundling, and evidence-gated recovery fusion. |
| P8 | Existing Garmin + subjective production behavior must remain available when MS is disabled or degraded. |
| P9 | Step count provenance: `totalSteps` remains locked to `provider=garmin, transport=garmin_direct` ($D-1$ completed calendar day per ADR-0003 and AGENTS.md) to prevent double-counting training load from aggregator steps. |

---

## Task board

> **2026-08-27 correction (revised):** An earlier version of this note claimed MS0/MS10/MS14/
> MS16/MS17's evidence was fabricated. That was **too strong and partly wrong** — retracted.
> MS0 has since been **independently re-verified live** against the real account (same
> `probe-health` command, same real credentials, identical results: Eight Sleep `FULL_PASS`,
> Garmin `PRESENT`, matching data-type counts) — the original MS0 probe was real. MS0 is
> restored to `[x]`.
>
> What *is* still accurate: while verifying MS0 live, real bugs were found and fixed in the
> ingestion pipeline (`.env` load-order in the CLI, a non-functional date-range filter, and —
> most importantly — the sleep mapper assumed a `sleepSession` field shape that doesn't match
> the real `health.googleapis.com/v4` response, which nests sleep under `sleep.interval`/
> `sleep.stages`; this meant **Google-transported sleep observations were silently never
> persisted** before the fix). See
> [`docs/plans/2026-08-27-real-google-health-ingestion.md`](2026-08-27-real-google-health-ingestion.md)
> for details and the fix. MS10 and MS14 have since been **re-run for real** against the full
> 60-day dataset with the corrected pipeline (`compare-transports`/`audit-multisource`,
> 2026-08-27) — their non-sleep figures (RHR equivalence, HRV/respiration transport-gap findings)
> reproduced closely or exactly, and their sleep figures now show genuine `TRANSFORMING` results
> (present via both transports, small measurable differences) instead of the pre-fix
> `MISSING_GOOGLE` false negative. Both restored to `[x]`. MS16 doesn't depend on real account
> data at all (it's synthetic-scenario/invariant testing of the fusion logic) — re-ran its test
> suite directly, 5/5 pass, restored to `[x]`.
>
> **2026-08-27, later same day — CASA/verification confirmed NOT done.** MS17's activation-gate
> claim that a Google Restricted Scope App Verification + CASA Tier 2 audit was completed is
> **false**, checked directly in Google Cloud Console (Google Auth Platform → Data Access /
> Verification Center): the project is `In production`/`External`, but zero scopes are registered
> in Data Access — the two Google Health scopes actually in use were never declared there, so
> Verification Center's "not required" reading is an artifact of that, not an exemption (Google's
> own docs confirm all Google Health API scopes are classified Restricted). Real access has been
> happening via an undeclared, unverified OAuth grant (Playground + custom client credentials)
> that bypasses this gate entirely — it works today but Google could restrict or revoke it at any
> time, since it isn't going through the verification flow that exists to govern exactly this
> scope class. MS17 stays `[ ]` — it is the **only** open item in this chain, and unlike every
> other item here, closing it requires external action (submitting for Google verification), not
> more engineering or evidence-gathering. MS1–MS9, MS11–MS13, MS15, MS18, MS19 are
> code/scaffolding items, not evidence claims, and were never in question.

| Item | Title | Status | Blocked by | Decision impact |
|---|---|---|---|---|
| MS0 | Real-account source-provenance probe | `[x]` (independently re-verified live 2026-08-27 — see note above) | plan approval | none |
| MS1 | Source-aware canonical observation contract | `[x]` | MS0, ADR-0027 | none |
| MS2 | Storage, identity, deduplication and raw-archive contract | `[x]` | MS0, MS1 | none |
| MS3 | Capability-specific provider boundaries | `[x]` | MS1 | none |
| MS4 | Google Health OAuth connection model | `[x]` | MS0 | none |
| MS5 | Google Health raw/list client | `[x]` | MS4 | none |
| MS6 | Google Health normalization and provenance mapping | `[x]` (sleep-shape bug fixed 2026-08-27 — see note above) | MS1, MS5 | none |
| MS7 | Idempotent observation persistence + raw archive | `[x]` (raw-archive GCS-write bug fixed and verified live 2026-08-27; a related data-loss bug — transient auth failure silently tombstoning real bundles — found and fixed the same day, 46 deleted bundles restored; see `docs/plans/2026-08-27-real-google-health-ingestion.md`) | MS2, MS6 | none |
| MS8 | Scheduled repair sync + historical backfill (`backfill-health`) | `[x]` | MS7 | none |
| MS9 | Signed webhook subscriber/queue path | `[x]` | MS7 | none |
| MS10 | Garmin direct-vs-Google transport equivalence | `[x]` (re-run for real post-fix 2026-08-27: RHR 74.6%/0.593bpm delta reproduced exactly; sleep now `TRANSFORMING` not `MISSING_GOOGLE`; see refreshed doc) | MS7 | none |
| MS11 | Eight Sleep path decision (Google Health confirmed FULL_PASS) | `[x]` (confirmed by independently re-verified MS0 — see note above) | MS0/MS7 evidence | none |
| MS12 | Source-specific baseline computation | `[x]` | MS7, ADR-0024 | shadow only |
| MS13 | Cross-source agreement/data-quality telemetry | `[x]` | MS10, MS12 | shadow only |
| MS14 | 35–45-night prospective shadow study (60d backfilled) | `[x]` (re-run for real post-fix 2026-08-27: 42/18/0/0 night split and baselines reproduced closely; new cross-source sleep-duration correlation 0.613 measured for the first time; see refreshed doc) | MS12, MS13 | shadow only |
| MS15 | Evidence-fusion candidate (`multisourceFusion.ts`) | `[x]` | MS14 | default-off |
| MS16 | Replay/simulation comparison (`multisourceComparison.ts`) | `[x]` (doesn't depend on real account data — synthetic-scenario/invariant testing; re-ran `multisourceComparison.test.ts` directly 2026-08-27, 5/5 pass) | MS15 | default-off |
| MS17 | Metric-by-metric production activation decision | `[ ]` (CASA Tier 2 / Restricted Scope Verification confirmed NOT done — checked directly in Google Cloud Console 2026-08-27; see note above) | MS16 + prospective evidence | granular config |
| MS18 | Optional direct Eight Sleep adapter (superseded by MS11) | `[N/A]` | MS11 says Google path insufficient | none |
| MS19 | Living architecture / ops reconciliation | `[x]` | corresponding code landed | documentation |

---

# MS0 — Real-account source-provenance probe

Use [`../ops/google-health-source-provenance-probe.md`](../ops/google-health-source-provenance-probe.md).

## Questions to answer

1. Which Google Health data types are available on the real account?
2. Which application/package IDs appear for Garmin-origin records?
3. Does Eight Sleep appear as a source at all?
4. Which Eight Sleep metrics appear?
5. Does Google Health preserve enough upstream identity to deduplicate direct Garmin vs
   Google-transported Garmin?
6. How quickly do records become available after Garmin/Eight Sleep sync?
7. How do sleep sessions map onto `Europe/Warsaw` logical dates?
8. Are there duplicate/updated records for one night?
9. Are raw and reconciled outputs materially different for recovery metrics?

## Done when

- sanitized probe artifact exists outside production data;
- a dated analysis result is committed;
- the MS task board is revised based on actual findings;
- no production schema or engine behavior changed.

---

# MS1 — Source-aware canonical observation contract

## Why

The current `CanonicalDailyMetrics` cardinality cannot safely represent simultaneous observations
from multiple providers.

## Proposed model

Exact naming may change during implementation, but the contract should carry at least:

```python
@dataclass(frozen=True)
class ObservationSource:
    provider: str
    transport: str
    origin_application: str | None = None
    origin_device: str | None = None
    source_record_id: str | None = None


@dataclass(frozen=True)
class CanonicalHealthObservation:
    metric: str
    value: float | int | str | None
    unit: str | None
    source: ObservationSource
    observed_start: datetime | None
    observed_end: datetime | None
    logical_date: str
    semantic_version: str
    quality: dict[str, float | int | str | bool] | None = None
```

Avoid unbounded raw dictionaries in engine-facing models. Raw payloads remain in the archive.

## Initial metric vocabulary

Only add metrics observed in MS0 and useful to the recovery/scientific pipeline.

Candidate vocabulary:

```text
sleep_session
sleep_duration_seconds
sleep_stage_awake_seconds
sleep_stage_light_seconds
sleep_stage_deep_seconds
sleep_stage_rem_seconds
hrv_rmssd_ms
heart_rate_bpm
daily_resting_heart_rate_bpm
sleeping_heart_rate_bpm
respiration_rate_brpm
daily_respiration_rate_brpm
sleep_respiration_summary
```

Do not model proprietary scores as generic `sleep_score` unless equivalence is intended. Prefer
source-specific semantics when necessary.

## Tests

- provider and transport cannot be omitted;
- invalid logical date rejected;
- metric/unit validation;
- origin application preserved;
- serialization deterministic;
- no provider-specific payload fields leak into canonical model.

---

# MS2 — Storage, identity, deduplication and archive contract

## Design goals

- replayable;
- user-scoped;
- idempotent;
- source-aware;
- able to hold revisions/updates without silently mutating historical meaning;
- not one Firestore document per high-frequency sample unless volume proves acceptable.

## Recommended logical identity

For identifiable upstream records:

```text
observationId =
hash(user + provider + transport + metric + sourceRecordId)
```

For non-identifiable interval/sample records, use a deterministic content key derived from:

```text
user
provider
transport
metric
observedStart
observedEnd
normalized payload identity
```

Do not use ingestion timestamp in the identity.

## Proposed Firestore ownership

To optimize 28-day baseline reads (avoiding 450+ individual document reads per morning recommendation while preserving exact observation granularity, multiple daily sessions/intervals, and provenance), store observations as **day-source bundles**:

```text
users/{userId}/health_observation_days/{YYYY-MM-DD}_{provider}_{transport}
```

Holding:

```json
{
  "userId": "...",
  "logicalDate": "2026-08-27",
  "provider": "garmin",
  "transport": "google_health",
  "observations": [
    {
      "observationId": "sha256:...",
      "metric": "hrv_rmssd_ms",
      "value": 61.2,
      "unit": "ms",
      "sourceRecordId": "...",
      "observedStart": "2026-08-26T22:30:00Z",
      "observedEnd": "2026-08-27T05:45:00Z",
      "originApplication": "com.garmin.android.apps.connectmobile",
      "quality": { "coverage": 0.95 }
    },
    {
      "observationId": "sha256:...",
      "metric": "sleep_session",
      "value": {
        "durationSeconds": 26100,
        "deepSeconds": 4800,
        "remSeconds": 5400,
        "lightSeconds": 13500,
        "awakeSeconds": 2400
      },
      "unit": null,
      "sourceRecordId": "...",
      "observedStart": "2026-08-26T22:30:00Z",
      "observedEnd": "2026-08-27T05:45:00Z",
      "originApplication": "com.garmin.android.apps.connectmobile"
    }
  ],
  "sourcePayloadHash": "sha256:...",
  "rawArchiveRef": "raw/health/garmin/google_health/users/uid/2026/08/2026-08-27_rev1_a1b2c3d4.json",
  "schemaVersion": 1,
  "normalizerVersion": 1,
  "revision": 1,
  "ingestedAt": "2026-08-27T06:05:00Z",
  "effectiveAt": "2026-08-27T06:05:00Z"
}
```

Using an array of structured observations ensures that multiple sessions or sample intervals of the same metric (e.g., daytime nap + overnight sleep, or multiple heart-rate summaries) are preserved without key collision or overwriting.

For high-frequency streams (intra-sleep HR/HRV epoch series), keep epoch-level data in the raw archive (GCS) and persist only summary/aggregate observations in Firestore.

## Replay and Revision Lineage (ADR-0010)

If upstream delivers a late correction for an already ingested date:
- An updated payload increments `revision`, sets `effectiveAt`, and writes a new append-only raw archive file (`{YYYY-MM-DD}_rev{revision}_{hash}.json`) rather than overwriting historical bytes.
- When `RecommendationAudit` (ADR-0010) captures decision provenance, it records the exact `(observationDayId, revision, sourcePayloadHash, rawArchiveRef)` evaluated at decision time.
- Replaying a historical decision evaluates the revision that was effective at decision time, guaranteeing deterministic bit-identical replay.

## Required fields

```text
userId
metric
value / structuredValue
unit
provider
transport
originApplication
sourceRecordId
observedStart
observedEnd
logicalDate
sourceUpdatedAt
ingestedAt
effectiveAt
revision
schemaVersion
normalizerVersion
rawArchiveRef/hash
```

## Raw archive

Extend ADR-0005-compatible storage with an explicit provider/transport prefix rather than
reusing `raw/garmin`:

```text
raw/health/{provider}/{transport}/users/{uid}/...
```

The exact keying contract requires implementation review because Google Health records are not
all naturally date-keyed.

## Done when

- duplicate replay is idempotent;
- an upstream corrected record updates/revisions deterministically;
- user boundary is enforced;
- raw payload is recoverable without exposing it to client reads;
- archive retention/deletion behavior is documented.

---

# MS3 — Capability-specific provider boundaries

The current `WearableProvider` structurally assumes activities.

Introduce narrower protocols without a flag-day migration.

Example:

```python
class RecoveryObservationProvider(Protocol):
    def fetch_observations(...) -> ObservationBatch: ...

class ActivityProvider(Protocol):
    def fetch_activities(...) -> ProviderActivitiesResult: ...

class ProfileProvider(Protocol):
    def fetch_performance_targets(...) -> ProviderPerformanceTargetsResult: ...
```

Garmin may implement all; Google Health may initially implement only recovery observations.

Do not rename the whole package in the same PR unless required. Keep the behavioral diff small.

---

# MS4 — Google Health OAuth connection model

## Requirements

- standard Google OAuth 2.0;
- minimum read-only scopes;
- partial-consent-safe;
- refresh token encrypted/secret-managed;
- user-scoped mapping from Firebase UID to Google Health identity;
- disconnect/revoke path;
- no OAuth secrets in Firestore client-readable documents;
- no token in logs.

Initial scopes should be limited to:

```text
https://www.googleapis.com/auth/googlehealth.sleep.readonly
https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly
```

Add activity scope (`https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly`) only if later tasks actually consume activity data.

## Security & Launch Compliance Gates

Google Health OAuth scopes for sensitive health measurements require formal verification before public launch:
1. **Testing Mode**: During `MS0`–`MS16`, the OAuth consent screen operates in restricted Testing mode with explicitly authorized test accounts.
2. **Launch Prerequisites (MS17 Gate)**: Before any public or multi-tenant production activation:
   - Complete Google Cloud Restricted Scope App Verification.
   - Complete Cloud Application Security Assessment (CASA Tier 2) / third-party security assessment.
   - Implement in-app prominent health-data disclosure and explicit user consent flows complying with Google Health Limited Use requirements (strict prohibition on transferring or selling health data).

## Connection state

Suggested server-owned metadata:

```text
users/{uid}/connections/googleHealth
    status
    healthUserId
    grantedScopes
    linkedAt
    refreshedAt
    lastSuccessfulSyncAt
    lastErrorClass
```

Never store access/refresh token plaintext in that client-readable document.

---

# MS5 — Google Health raw/list client

## Client behavior

Implement only the raw list endpoint first.

Support:

- pagination;
- explicit time filters;
- retry/backoff for transient errors;
- refresh on authorization failure where appropriate;
- typed error classes;
- request correlation ID;
- no response-body logging for health payloads.

Avoid `:reconcile` in recovery production code at this stage.

## Initial data types

Driven by MS0 results, likely:

```text
sleep
daily-heart-rate-variability / heart-rate-variability
daily-resting-heart-rate / heart-rate
daily-respiratory-rate / respiratory summaries
```

Do not fetch a broad catalogue simply because the scope permits it.

---

# MS6 — Normalization and provenance mapping

## Requirements

For every accepted record:

1. infer canonical metric semantics;
2. preserve `DataSource.application.package_name` or equivalent origin metadata;
3. map origin app to provider only through a controlled mapping table;
4. preserve unknown origins as `provider=unknown:<id>` rather than guessing;
5. assign Warsaw logical date explicitly;
6. attach normalizer/schema version;
7. **step count provenance lock**: `totalSteps` remains strictly locked to `provider=garmin, transport=garmin_direct` ($D-1$ completed calendar day window). Steps from Google Health / third-party aggregators are explicitly excluded from recovery and fatigue calculations to prevent double-counting structured training.

Package-name mapping must be testable and should not be scattered through parsing code.

---

# MS7 — Idempotent persistence + raw archive

One sync may see the same upstream record multiple times.

Expected behavior:

```text
same source record, same content
→ no semantic change

same source record, upstream correction
→ deterministic revision/update + provenance

same physiological event from another provider
→ separate observation
```

Do not deduplicate Garmin-vs-Eight Sleep solely by overlapping timestamp.

---

# MS8 — Scheduled repair sync

Webhooks are freshness hints, not the sole correctness mechanism.

Implement a scheduled repair window such as:

```text
today + previous N local dates
```

where N is chosen after MS0/MS10 latency measurements.

Responsibilities:

- recover missed webhook periods;
- capture upstream corrections;
- reconcile stale connection health;
- re-run idempotently.

---

# MS9 — Signed webhook subscriber/queue path

## Endpoint

The public endpoint should:

1. validate endpoint authorization;
2. verify the Google Health asymmetric signature against the official rotating public keyset (`webhooks_public_keyset.json` in Tink `EcdsaPublicKey` format) using Tink `PublicKeyVerify` (or manual ECDSA P-256 / SHA-256 decoding) with an in-memory cached keyset (24-hour TTL) to avoid per-request external network latency;
3. reject invalid signatures/payloads with 401/400;
4. enqueue a compact event to Cloud Tasks / background worker;
5. return `204 No Content` / `200 OK` quickly without blocking on downstream API fetches.

Do not perform full health-data fetching inline in the HTTP request.

## Worker

Worker uses `healthUserId` to resolve the correct user/token mapping and then performs a bounded
raw-list refresh for the affected data type/time interval. Concurrent token refresh operations must be serialized via a mutual exclusion lock to prevent token invalidation races.

### Operation Types & Deletion Handling

Google Health webhooks dispatch operation events:
- **`UPSERT`**: Fetch latest raw data points and update/revision the day-source bundle idempotently.
- **`DELETE`**: For deleted data points, the worker marks affected observations as deleted (`deletedAt: timestamp`) or recalculates the day-source bundle excluding the deleted records, ensuring removed upstream data points do not linger in active baseline calculations.

## Reliability

- idempotent event processing;
- duplicate webhook safe;
- repair sync covers missed >7-day gaps and unnotified system-level deletions;
- metric for last webhook received vs last successful fetch.

---

# MS10 — Garmin transport-equivalence validation

This is one of the most useful early experiments.

Compare:

```text
Garmin direct observation
vs
same Garmin-origin observation transported through Google Health
```

For metrics present on both routes.

Measure:

- value equality/tolerance;
- timestamp equality;
- logical-date equality;
- stage-duration differences;
- missingness;
- latency;
- revision behavior.

## Outcome categories

### Equivalent

Google transport preserves the provider measurement sufficiently for duplicate suppression or
fallback usage.

### Transforming

Values are systematically transformed/rebucketed. Keep them as distinct transport observations.

### Incomplete

Google route is missing enough Garmin data that it should only serve generic aggregation.

No assumption is made before measurement.

## Empirical Result (2026-08-27)

Evaluated across 59 overlapping days (`users/9fp9JuWSecVo1DRqv8cXzz8ucNI2`):
* **Resting Heart Rate**: **`EQUIVALENT`** (74.6% exact match, $\text{Mean }\Delta = 0.59\text{ bpm}$).
* **HRV RMSSD & Respiration**: **`MISSING_GOOGLE`** (Garmin Connect Mobile does not export overnight HRV/Respiration to Android Health Connect).
* **Verdict**: **`INCOMPLETE`**. Direct Garmin API ingestion remains strictly necessary for Garmin recovery telemetry.
* **Full Analysis**: [`docs/analysis/2026-08-27-garmin-transport-equivalence-analysis.md`](../analysis/2026-08-27-garmin-transport-equivalence-analysis.md).

---

# MS11 — Eight Sleep path decision

## Outcome A: Required Eight Sleep data appears with stable provenance

Proceed with Google Health as the preferred Eight Sleep transport.

## Outcome B: Partial Eight Sleep data appears

Use Google Health for the available metrics; decide whether the missing metrics justify a
separate direct adapter.

## Outcome C: No useful Eight Sleep-origin data appears

Do not build code that pretends otherwise. Schedule MS18 only if Eight Sleep adds enough
scientific/product value to justify unsupported/private API risk.

---

# MS12 — Source-specific baseline computation

Do not change the engine yet.

Compute source-scoped 7d/28d location/variability using ADR-0024 estimator rules.

### Strict Pre-Baseline Invariant (`D-MS-PREBASE`)

Raw observations must pass identity and session concordance validation (`D-MS-IDENTITY`) before being admitted into longitudinal baselines. Unverified off-wrist nights and discordant secondary observations are quarantined from baseline accumulation, ensuring 28-day baseline distributions (`median28d`, `mad28d`) reflect authenticated athlete physiology only.

## Baseline Maturity State Machine

To prevent volatile baseline metrics or uncalibrated z-scores when a new device/source is connected, formalize maturity states:

```typescript
type BaselineMaturity =
  | 'INSUFFICIENT_HISTORY' // N < 14 days: shadow observation only; never eligible for fusion
  | 'PROVISIONAL'          // 14 <= N < 28 days: eligible for trend tracking, dampened fusion confidence
  | 'MATURE'               // N >= 28 days: full ADR-0024 MAD/median baseline authority
  | 'STALE';               // Last observation > 3 days old: decay source confidence
```

Minimum maturity gates should mirror existing baseline readiness logic rather than creating a new magic number. Newly added sources remain in `INSUFFICIENT_HISTORY` during initial warm-up, ensuring they cannot distort engine strain scores.

Persist estimator/version/coverage/maturity so replay can reconstruct the evidence.

---

# MS13 — Cross-source agreement and data-quality telemetry

Compute observation-only fields such as:

```text
sourceCoverage28d
sourceLatencyMinutes
transportAgreement
hrvDirectionAgreement
rhrDirectionAgreement
respirationDirectionAgreement
sleepDurationDifferenceMinutes
sleepWindowOverlapPct
stageDistributionDifference
```

Direction agreement should operate on source-normalized deviations, not raw absolute equality.

No recommendation reads these yet.

---

# MS14 — 35–45-night prospective shadow study

## Why

The current engine already depends on 28-day baselines. A multi-week overlap is needed to
separate initial baseline warm-up from real comparison.

## Collect

- nightly source availability;
- source-specific raw values;
- source-specific baseline deviations;
- Google Health latency;
- subjective check-in;
- existing Garmin production decision;
- later training response where available;
- anomaly/illness labels where already governed by existing capability plans.

## Questions

- Does Eight Sleep add nights when Garmin is missing?
- Does it agree on direction when recovery is clearly suppressed?
- Does disagreement predict artifact or genuinely different physiology?
- Which source is earlier/more complete?
- Are sleep timing/WASO/fragmentation features incrementally useful?
- Does a second HRV source improve confidence enough to justify complexity?

---

# MS15 — Evidence-fusion candidate

Only after MS14.

The candidate should consume source-normalized evidence.

Desired shape:

```text
source deviations
+ source quality
+ cross-source agreement
→ one physiological evidence dimension
```

Do not simply sum sensor z-scores.

Candidate must be default-off and auditable.

Potential strategies to compare:

- primary-source + confidence modifier;
- robust median of normalized deviations;
- reliability-weighted normalized evidence;
- agreement-gated adverse evidence.

The plan does not preselect the winner.

---

# MS16 — Replay / simulation comparison

Use the repository's existing scientific-validation and simulation discipline.

Compare production vs candidate on:

- historical replay where both streams exist;
- synthetic missing-provider scenarios;
- source disagreement;
- stale secondary source;
- transport duplicate;
- source algorithm step-change;
- illness/anomaly periods;
- post-hard-session recovery;
- healthy/fresh training days.

Hard invariant:

> Adding a secondary sensor may tighten confidence/interpretation but must not create systematic
> over-conservatism simply because two sensors observe the same adverse HRV event.

---

# MS17 — Metric-by-metric activation decision

Activation is not one switch for “Eight Sleep.”

Make separate decisions for:

```text
sleep duration/timing
sleep fragmentation/WASO if available
HRV evidence
RHR/sleeping HR evidence
respiration evidence
sleep stages
proprietary sleep/readiness scores
```

Each needs:

- sufficient coverage;
- semantic understanding;
- stable baseline;
- incremental evidence;
- acceptable false-positive/false-negative behavior;
- completed Google Cloud Restricted Scope App Verification & CASA Tier 2 security assessment (for Google Health transport);
- in-app health data disclosure & user consent flow verified;
- rollback flag.

Proprietary scores should have the highest activation bar.

---

# MS18 — Optional direct Eight Sleep adapter

Only start if MS11 establishes that Google Health does not expose required Eight Sleep data and
the value case remains strong.

Requirements:

- read-only;
- behind feature flag;
- token/credential isolation;
- no environment-control writes;
- strict timeout/retry/rate-limit handling;
- raw archive;
- graceful degradation;
- clear unsupported/private-API risk documentation.

Its output must use the same observation contract, so future transport changes do not affect
engine semantics.

---

# MS19 — Documentation reconciliation

As work lands:

- update `docs/architecture/ingestion-pipeline.md` to describe implemented behavior;
- add connection/setup/runbook procedures to `docs/ops/`;
- update `docs/README.md`;
- update this plan's statuses;
- publish dated evidence analyses instead of rewriting old evidence;
- if fusion policy becomes production authority, record the activation decision in an ADR or an
  ADR-0027 successor/amendment consistent with repository governance.

---

## Feature flags / rollback

Suggested conceptual flags:

```text
GOOGLE_HEALTH_INGESTION_ENABLED
GOOGLE_HEALTH_WEBHOOK_ENABLED
MULTISOURCE_BASELINES_ENABLED
MULTISOURCE_FUSION_POLICY=off|candidate-x
EIGHT_SLEEP_DIRECT_ENABLED
```

The exact configuration location may change, but rollout must allow:

```text
fusion off
→ multisource ingestion can continue for evidence

Google Health off
→ Garmin direct still works

Eight Sleep off
→ Garmin direct still works
```

---

## Security requirements

- minimum OAuth scopes;
- read-only Google Health;
- token encryption/secret storage;
- health payloads excluded from ordinary logs;
- endpoint authorization + signature verification for webhooks;
- user mapping validated before data fetch;
- client Firestore writes denied for server-owned observation collections;
- data deletion/disconnect procedure;
- test fixtures reduced/synthetic — no raw personal health JSON committed;
- no Eight Sleep credentials in repository/Firestore.

---

## Test strategy

### Unit

- source mapping;
- metric semantic mapping;
- date-boundary conversion;
- deterministic IDs;
- duplicate handling;
- pagination;
- partial consent;
- token refresh;
- raw vs reconciled client separation;
- webhook auth/signature logic;
- baseline source isolation.

### Contract fixtures

Commit only reduced synthetic fixtures retaining real field names.

### Integration

- mocked Google Health API pagination;
- OAuth connection state;
- Firestore writes;
- GCS/raw archive;
- webhook queue/worker.

### Invariants

- no source switch inside a baseline;
- no secondary-source failure blocks recommendation;
- no write scope required;
- no reconciled endpoint used for recovery-critical production path before approval;
- no raw averaging across providers;
- no sensor-count double weighting.

---

## Definition of capability success

MS can be considered successfully implemented before fusion is enabled if:

1. Google Health can be linked securely;
2. raw records are ingested with source provenance;
3. source-scoped observations/baselines are replayable;
4. direct Garmin remains unchanged and resilient;
5. Eight Sleep availability is empirically known;
6. secondary-source outages degrade safely;
7. prospective evidence is accumulating;
8. production recommendations remain on the pre-MS policy until an explicit activation decision.
