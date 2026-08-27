# ADR-0027: Source-Aware Multisource Health Observations

* **Status:** Accepted
* **Date:** 2026-08-27
* **Deciders:** Core Engineering Team

---

## Context and Problem Statement

ADR-0026 establishes the ownership and failure-isolation boundary for wearable telemetry and
requires provider-specific response shapes to stop at the provider boundary. The repository now
has a concrete reason to extend that architecture: the same physiological concept may be
observed concurrently by multiple devices and may arrive through more than one transport.

Examples include:

```text
Garmin HRV measured by a Garmin wearable, fetched directly from Garmin
Garmin-origin sleep forwarded through Health Connect / Google Health
Eight Sleep HRV measured by a mattress, potentially forwarded through Google Health
```

The existing daily canonical/snapshot model has one scalar per metric. It therefore cannot
represent simultaneous measurements without choosing a winner too early or mixing values that
come from different measurement processes.

The recommendation engine already uses longitudinal, athlete-specific baselines. A source
switch inside one baseline would make a device/algorithm discontinuity look like physiology.

This ADR defines the durable provenance and fusion invariants. It does not approve any specific
recovery metric for recommendation authority.

It complements:

- ADR-0002 — user-scoped Firestore isolation;
- ADR-0003 — timezone semantics;
- ADR-0005 — raw archive and deterministic rebuild;
- ADR-0006 — baseline-relative strain;
- ADR-0010 — decision provenance and replay;
- ADR-0024 — metric-specific biometric estimators;
- ADR-0025 — physiological anomaly evidence discipline;
- ADR-0026 — wearable telemetry enrichment boundaries and ownership.

Source analysis:
[`2026-08-27-google-health-and-multisource-wearable-integration.md`](../analysis/2026-08-27-google-health-and-multisource-wearable-integration.md)

---

## Decision Outcome

### D-MS-ORIGIN — Measurement provider and transport are separate provenance dimensions

Every normalized multisource observation must preserve:

- **provider/origin** — who/device family produced the physiological measurement;
- **transport** — how the application obtained it.

Examples:

```text
provider=garmin,      transport=garmin_direct
provider=garmin,      transport=google_health
provider=eight_sleep, transport=google_health
provider=eight_sleep, transport=eight_sleep_direct
```

Google Health is not automatically the measurement provider merely because it transported the
record.

Where available, the original application identifier and upstream record identity are retained
for audit/deduplication.

### D-MS-OBS — Multisource recovery enters through an observation layer

The application will introduce a source-aware observation representation below the existing
daily recovery snapshot.

The daily snapshot may remain the production engine-facing compatibility projection during
migration.

The observation layer must support more than one observation for the same physiological concept
and date.

To optimize read performance and minimize Firestore document reads during 28-day baseline queries,
observations are stored as day-source bundles (`users/{userId}/health_observation_days/{YYYY-MM-DD}_{provider}_{transport}`)
containing individual structured observations with complete origin metadata, rather than unbundled
scalar fields.

Late corrections from upstream providers update the day-source document with incremented `revision`
and `effectiveAt` timestamps, preserving immutable decision history references for ADR-0010 replay.

It must not be modeled by adding permanent vendor-named scalar fields such as
`garminHrv`/`eightSleepHrv` to `DailyRecoverySnapshot`.

### D-MS-SEM — Metric identity includes measurement semantics, not only units

Two values with the same physical unit are not automatically interchangeable.

Canonical identity must be sufficiently precise to distinguish materially different constructs.

Examples include:

```text
hrv_rmssd_ms
daily_resting_hr_bpm
sleeping_hr_bpm
sleep_duration_seconds
sleep_stage_rem_seconds
respiration_rate_brpm
```

If an upstream metric's algorithm/semantic meaning cannot be established, it remains
source-specific observation-only data until equivalence is demonstrated.

A proprietary readiness/sleep score is never assumed equivalent to another provider's score
merely because both use a 0–100 scale.

### D-MS-BASE — Longitudinal baselines are source-specific by default

A baseline window must not silently alternate between different providers/transports.

For a metric used longitudinally:

```text
baseline identity =
    user
  + physiological metric semantics
  + measurement provider
  + material algorithm/source version when needed
```

Baselines follow explicit maturity states (`INSUFFICIENT_HISTORY` [<14d], `PROVISIONAL` [14–27d],
`MATURE` [≥28d], `STALE` [>3d silence]) so that a newly connected secondary sensor cannot distort
engine strain or anomaly detection before its own baseline matures.

Transport may be collapsed only after transport-equivalence evidence shows that the same
provider measurement arrives unchanged through both routes.

Provider identity is not collapsed merely because values are correlated.

### D-MS-NOAVG — Raw cross-device physiological values are not averaged

The production system must not compute a value such as:

```text
(garmin_hrv + eight_sleep_hrv) / 2
```

and treat it as an athlete measurement unless a future evidence-backed ADR specifically defines
and validates such an estimator.

Cross-device values are first normalized relative to their own longitudinal baselines.

### D-MS-DIM — Multiple sensors must not double-count one physiological dimension

A second sensor observing HRV may increase confidence in the HRV evidence, but it must not
automatically add a second independent HRV strain term.

The recovery policy continues to reason in physiological dimensions, not sensor count.

Conceptually:

```text
device observations
    ↓
source-normalized HRV evidence
    ↓
one HRV evidence dimension
    ↓
one HRV policy contribution
```

The exact confidence/fusion estimator remains measurement-gated and is not chosen by this ADR.

### D-MS-RAW — Recovery-critical Google Health ingestion uses provenance-preserving raw data

For HRV, RHR, respiration, sleep timing, and sleep architecture, Google Health's raw/list
records are the initial ingestion authority.

Third-party reconciliation output is not the production authority for these recovery signals
until separately evaluated.

Reconciled data may be used for display-oriented or low-risk aggregates where source collapse is
desirable and scientifically immaterial.

### D-MS-GARMIN — Direct Garmin remains a specialist source

Google Health does not replace direct Garmin ingestion.

Direct Garmin remains eligible to own:

- Garmin-specific training/recovery constructs;
- performance/profile values;
- detailed activities;
- activity telemetry;
- any current behavior not exposed equivalently through Google Health.

Google Health may carry Garmin-origin observations in parallel for transport-equivalence
validation and generic health integration.

### D-MS-STEPS — Step count provenance remains locked to direct Garmin

`totalSteps` represents the completed previous calendar day ($D-1$) per ADR-0003 and `AGENTS.md`
and is used in fatigue modeling to deduct ambient steps from structured activity load.

Because Google Health and Health Connect aggregate step counts from multiple devices (phones, watches,
third-party pedometers), ingesting aggregator steps into the recovery pipeline creates duplicate
load accounting and violates the $D-1$ evaluation window.

`totalSteps` remains strictly locked to `provider=garmin, transport=garmin_direct`. Aggregator step
counts from Google Health are excluded from recovery and fatigue calculations. Furthermore, if completed
$D-1$ steps are unavailable from Garmin direct, `totalSteps` is recorded as `None` / omitted rather than
falling back to incomplete partial steps from today ($D$), preventing uncompleted-window bias in ambient
fatigue normalization.

### D-MS-GH — Google Health is an optional read-only transport

The initial capability uses read-only Google Health scopes.

The recommender does not need to write user health data to Google Health.

Google Health availability is not a hard dependency for a morning recommendation.

### D-MS-8S — Eight Sleep through Google Health is capability-probed, not assumed

Current documentation does not establish that Pod-generated Eight Sleep recovery records are
exported into Health Connect/Google Health.

The system must not make the Google route the Eight Sleep architecture until a real-account
provenance probe observes Eight Sleep-origin records for the required metrics.

If that probe fails, an optional read-only direct Eight Sleep acquisition path may be evaluated
without changing this ADR's provider/transport model.

### D-MS-FAIL — Secondary-source failure degrades safely

Failure or absence of Google Health, Health Connect-derived records, or Eight Sleep must not
invalidate an otherwise viable Garmin + subjective recommendation.

Expected behavior:

```text
secondary source unavailable
→ record availability/degradation telemetry
→ omit its evidence
→ continue existing recommendation path
```

No neutral/fabricated values are substituted for missing measurements.

### D-MS-EVID — Observation authority precedes recommendation authority

Adding a new source does not give that source recommendation authority.

Promotion sequence:

```text
ingest
→ archive/persist
→ verify semantics/provenance
→ establish source-specific baseline
→ prospective shadow observation
→ replay/simulation
→ explicit activation decision
```

A metric can remain permanently observation-only if it does not add reliable decision value.

---

## Consequences

### Positive

- Preserves scientific interpretability across heterogeneous sensors.
- Prevents device-switch discontinuities from contaminating baselines.
- Allows Google Health, Health Connect, direct Garmin, and direct Eight Sleep to coexist.
- Makes transport-equivalence testable instead of assumed.
- Prevents the same physiological signal from receiving more policy weight merely because more
  sensors measure it.
- Supports future sources such as other wearables without adding vendor fields to the daily
  snapshot.
- Retains graceful degradation and current Garmin behavior during migration.
- Fits existing replay/evidence governance.

### Negative

- Requires an additional observation/persistence layer.
- Requires source-aware baseline storage and more complex deduplication.
- Temporarily duplicates some Garmin-origin data through direct and Google transports.
- Creates more explicit schema/version/provenance metadata.
- Cross-source fusion becomes a measured feature instead of a trivial arithmetic operation.
- Google Health OAuth and restricted-scope verification add operational/compliance overhead.

---

## Rejected Alternatives

### Replace Garmin direct with Google Health

Rejected because documented Health Connect export is a subset of the data currently available
through the direct Garmin integration.

### Use Google's reconciled stream as canonical recovery truth

Rejected because it collapses source disagreement before the recommender can evaluate it and
would implicitly delegate part of the project's recovery science to a third-party reconciliation
policy.

### Select one global “preferred device” for all recovery metrics

Rejected because the best source may differ by metric, source availability may change, and
global source replacement would still require baseline resets.

### Average measurements across devices

Rejected because equal units do not establish equal measurement processes and arithmetic
averaging can fabricate a signal with no validated physiological interpretation.

### Give every sensor an independent engine weight

Rejected because sensor count is not physiological dimensionality.

---

## Implementation Notes

The canonical implementation plan is:

[`../plans/multisource-health-and-recovery-ingestion.md`](../plans/multisource-health-and-recovery-ingestion.md)

This ADR intentionally does not fix:

- the final Firestore observation collection shape;
- the exact fusion estimator;
- the exact source-confidence formula;
- an Eight Sleep direct API;
- production metric activation.

Those choices require MS probe/shadow evidence.

---

## References

Repository:

- ADR-0005 — raw archive/rebuild
- ADR-0006 — baseline-relative strain
- ADR-0010 — decision provenance/replay
- ADR-0024 — biometric estimator policy
- ADR-0026 — wearable telemetry ownership
- `src/garmin_sync/provider.py`
- `src/garmin_sync/canonical.py`
- `src/garmin_sync/models.py`
- `src/garmin_sync/service.py`
- `app/src/engine/models.ts`
- `app/src/engine/rules.ts`

External:

- https://developers.google.com/health/get-started
- https://developers.google.com/health/reference/rest/v4/users.dataTypes.dataPoints/list
- https://developers.google.com/health/reference/rest/v4/users.dataTypes.dataPoints/reconcile
- https://developers.google.com/health/reference/rpc/google.devicesandservices.health.v4
- https://developers.google.com/health/scopes
- https://developers.google.com/health/webhooks
- https://support.garmin.com/lv-LV/?faq=JToBEy0jfe6pIygark2Ui5
- https://vercel.eightsleep.com/legal/privacy
