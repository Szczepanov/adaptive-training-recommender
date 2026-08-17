# Garmin per-activity telemetry: zones, NP, and lap summaries

* **Status:** `Implemented`
* **Approved:** 2026-08-17
* **Implemented:** 2026-08-17
* **Blocked by:** nothing. Production activation of zone-derived credit was rejected by G2.4's current evidence.
* **Outcome:** additive activity telemetry and the read-only detail view shipped; a default-off zone-credit candidate was measured and retained off.
* **Source analysis:** [`2026-08-17-garmin-high-resolution-telemetry.md`](../analysis/2026-08-17-garmin-high-resolution-telemetry.md) — §5 findings are referenced below as `A5.1`–`A5.8`.

> **Not a top-level phase.** This is a bounded ingestion capability, not a roadmap phase in the
> `Phase 0`–`9` sequence. Work items are numbered `G*` so they cannot be confused with phase
> numbering. If the deferred raw-series/dashboard work is later revived at scale, promote *that*
> to a real `phase-10-*` plan rather than renumbering these items.

> **Historical implementation record.** Every task below is complete. Descriptions and
> acceptance checks record what was delivered; they are not an open work list. The
> measured ship decision is in
> [`2026-08-17-garmin-zone-credit-measurement.md`](../analysis/2026-08-17-garmin-zone-credit-measurement.md).

---

## Goal

Garmin's per-activity power/HR time-in-zone distributions, normalized power, and lap
averages are ingested into the existing per-activity Firestore record. The engine can
measure a separate zone-derived credit candidate, but production continues to use TE.

Stage 1 remained pure ingestion with **no decision impact**. Stage 2 delivered a
default-off comparison path under ADR-0022 and did not change live recommendations.
Stage 3 delivered the read-only UI independently.

---

## Preconditions

| # | Condition | State today |
|---|---|---|
| P1 | `users/{userId}/activities/{activityId}` exists and is server-written | ✅ `upsert_activity`, rules are `allow write: if false` |
| P2 | The pinned `garminconnect` exposes per-activity endpoints | ✅ verified: `get_activity_power_in_timezones`, `get_activity_hr_in_timezones`, `get_activity_splits` |
| P3 | A provider-neutral canonical layer exists to extend | ✅ `canonical.py`; the Garmin adapter now advertises `ProviderCapabilities.activity_details` |
| P4 | The read-side parser tolerates additive fields | ✅ `parseNormalizedGarminActivity` surfaces valid optional telemetry and drops malformed optional telemetry without invalidating the base record |
| P5 | An agreed rate-limit budget | ✅ G1.0 measured the live shapes: NP/IF/average power are in the list payload; detail costs exactly three calls per qualifying activity |
| P6 | An accepted decision on whether zones may change credit | ✅ **D-ZONECRED — ADR-0022**; measurement approved, production activation rejected by current evidence |

---

## Decisions this plan needs

Per `docs/plans/README.md`, decisions belong in ADRs; the plan references them.

| ID | Proposal | Why it cannot be left to the implementer |
|---|---|---|
| **D-DETAIL-GATE** | **Accepted in ADR-0005.** The extra per-activity fetch is default-off and requires all three: a power-bearing modality, `intensity_tag != 'easy'`, and an activity ID. It runs only for the target-date pass of `sync_daily`, never lookback resync, `backfill`, or `rebuild` | This bounds the incremental budget to `3 × N` requests per run and avoids refetching overlapping activities in the daily lookback windows (A5.2) |
| **D-ZONECRED** | **Accepted in ADR-0022.** A complete cycling 7-zone distribution may produce the named direct-share candidate within `measuredEffort`; the selector defaults to TE and production activation requires a later decision | Preserves the D-FUSE/D-SUBJCAL measurement discipline without inventing a stronger evidence tier or silently changing live credit |

G2.4 measured the accepted candidate and concluded **do not enable it**.

---

## Task board

| Item | Title | Status | Blocked by |
|---|---|---|---|
| G1.0 | Payload spike: what is already in the activities list? | `[x]` | — |
| G1.1 | Client methods for the three per-activity endpoints | `[x]` | — |
| G1.2 | Fetch gate and rate-limit budget | `[x]` | G1.0 |
| G1.3 | Canonical dataclasses for zones and laps | `[x]` | G1.0 |
| G1.4 | Provider canonicalisation | `[x]` | G1.1, G1.3 |
| G1.5 | Persist and parse additive fields — no `schemaVersion` bump | `[x]` | G1.3 |
| G1.6 | Service wiring and failure isolation | `[x]` | G1.2, G1.4, G1.5 |
| G1.7 | Rebuild-path behaviour | `[x]` | G1.6 |
| G2.1 | Decision-side feature extraction and evidence trace | `[x]` | G1.5, ADR-0022 |
| G2.2 | Default-off zone-derived stimulus candidate | `[x]` | G2.1 |
| G2.3 | Interval fade from lap summaries | `[x]` | G2.1 |
| G2.4 | Measurement report and ship decision | `[x]` | G2.2, G2.3 |
| G3.1 | Activity detail view | `[x]` | G1.5 |

---

## Stage 1 — Ingestion (no decision impact)

### G1.0 `[x]` Payload spike: what is already in the activities list?

**Why first.** `get_activities` may already return `normPower` / `intensityFactor` /
`avgPower` for power-bearing activities. If it does, NP/IF/VI cost **zero** extra API calls
and only zones and laps need per-activity requests — which roughly halves the rate-limit
exposure and changes what G1.2 has to gate. The repo's `tests/fixtures/activities.json` is
a hand-written minimal stub and cannot answer this.

**Outcome (2026-08-17):** against one real cycling activity and one real run, the list
payload carried `normPower`, `avgPower`, and `maxPower` for both; the cycling activity
also carried `intensityFactor`. The observed detail shapes were arrays for power/HR zones
and a mapping containing `lapDTOs` for splits. The committed fixtures preserve those key
names with synthetic values and no identifiers or raw health payload.

The spike recorded which of `normPower`, `intensityFactor`, `avgPower`, and `maxPower`
appear in the existing `get_activities_window` payload. Reduced observed-shape samples
from `get_activity_power_in_timezones`, `get_activity_hr_in_timezones`, and
`get_activity_splits` were committed as fixtures with synthetic values.

**Done when:** `tests/fixtures/` contains `activity_power_zones.json`,
`activity_hr_zones.json`, `activity_splits.json` and an enriched `activities.json`, each
with real key names and no personal identifiers; and this plan's G1.2/G1.3 notes are
updated to say whether NP comes free with the list payload.

> Sanitise before committing: strip `startTimeGMT` precision, location, device serial, and
> `ownerId`. Per `AGENTS.md` no raw health JSON is committed — these fixtures must be
> reduced to the shape under test, matching the existing minimal-fixture style.

### G1.1 `[x]` Client methods for the three per-activity endpoints

**Current:** `garmin_client.py`'s `GarminDataClient` Protocol and `GarminClientWrapper`
expose no per-activity methods at all (A5.1).

**Change:** add to **both** the Protocol and the wrapper, following the established
`if not self.api: raise RuntimeError("Garmin client is not authenticated. Call login first.")`
then the endpoint-appropriate empty fallback:

| New wrapper method | Wraps | Empty response |
|---|---|---|
| `get_activity_power_zones(activity_id)` | `api.get_activity_power_in_timezones` | `[]` |
| `get_activity_hr_zones(activity_id)` | `api.get_activity_hr_in_timezones` | `[]` |
| `get_activity_splits(activity_id)` | `api.get_activity_splits` | `{}` |

Do **not** add `download_activity` or `get_activity_details` — deferred (see Out of scope).

**Done when:** all three exist on the Protocol and the wrapper, each returns its typed
empty collection on a falsy upstream response, and each raises the standard unauthenticated `RuntimeError`;
`uv run mypy src/garmin_sync` passes.

### G1.2 `[x]` Fetch gate and rate-limit budget — **implements D-DETAIL-GATE**

**Change:** a single predicate in `garmin_provider.py`, e.g.
`_qualifies_for_detail_fetch(activity: CanonicalActivity) -> bool`, plus a
`GARMIN_ACTIVITY_DETAIL_ENABLED` flag in `config.py` (mirroring `GARMIN_ARCHIVE_ENABLED`'s
opt-in style from ADR-0005), default **off**.

Gate on: a power-bearing modality, **and** `intensity_tag != 'easy'`, **and** a non-null
`activity_id`. Detail fetch runs only in the target-date pass of `sync_daily`. Lookback
resync, `backfill`, and `rebuild` must not call it — assert this in tests, do not merely
document it.

**Budget:** G1.0 showed NP/IF/average power ship with the list, but zones and laps still
require three endpoints. The exact incremental budget is therefore `3 × N` calls for *N*
qualifying activities in the target window, once per `sync_daily` run. The wrapper's
existing three-attempt exponential backoff applies; the first exhausted 429 abandons the
remaining detail work.

**Done when:** the predicate is unit-tested on both branches; a test asserts `backfill`
issues **zero** detail calls over a multi-day range; the flag defaults off and the whole
feature is inert when unset.

### G1.3 `[x]` Canonical dataclasses for zones and laps

**Current:** `CanonicalActivity` carries only `activity_id`, `date`, `type`,
`duration_min`, `duration_seconds`, the two training effects, `average_hr`,
`training_load`, `intensity_tag` (A5.4).

**Change:** in `canonical.py`, add provider-neutral dataclasses with explicit units,
matching how `CanonicalHeartRateZones` / `CanonicalTrainingStatus` were introduced:

```python
@dataclass
class CanonicalZoneBucket:
    zone_number: int
    seconds_in_zone: float
    low_boundary: float | None = None   # watts for power, bpm for HR

@dataclass
class CanonicalLapSummary:
    lap_index: int                       # 1-based, as presented to the athlete
    duration_seconds: float
    average_power_watts: float | None = None
    average_hr_bpm: float | None = None

@dataclass
class CanonicalActivityDetail:
    activity_id: str
    power_zones: list[CanonicalZoneBucket] | None = None
    hr_zones: list[CanonicalZoneBucket] | None = None
    normalized_power_watts: float | None = None
    intensity_factor: float | None = None
    variability_index: float | None = None
    laps: list[CanonicalLapSummary] | None = None
```

Keep it a **separate** dataclass rather than widening `CanonicalActivity`: detail is
optional, separately fetched, and separately failable, and `_build_training_summary`
iterates `CanonicalActivity` on a hot path that must not start carrying `None`-heavy
telemetry it never reads.

`variability_index` is derived (`NP / average_power`), not fetched — compute it only when
both inputs are present and average power is non-zero; never store a sentinel.

**Done when:** the dataclasses exist with no Garmin key names anywhere in `canonical.py`,
and `mypy` passes.

### G1.4 `[x]` Provider canonicalisation

**Change:** in `garmin_provider.py` add `canonicalize_activity_detail(...)`, public for the
same reason `canonicalize_activities` is — so a rebuild path can reuse it without a live
fetch. Extract defensively at every level (the `_canonicalize_training_status`
degrade-to-`None`-fields precedent): a missing zone array, a lap with no power, or a
string where a number was expected must produce `None` fields, never a `KeyError` or a
crash.

Add `fetch_activity_detail(activity_id)` to `GarminProviderAdapter` returning a new
`ProviderActivityDetailResult(canonical, raw_payloads)` in `provider.py`, alongside the
existing result dataclasses, and flip `ProviderCapabilities.activity_details` to `True` on
the Garmin adapter — the field already exists and is currently dead.

**Done when:** malformed-payload tests pass for each of the three endpoints; no Garmin key
name (`secsInZone`, `zoneLowBoundary`, `lapDTOs`, `normPower`) appears outside
`garmin_provider.py`.

### G1.5 `[x]` Persist and parse additive fields — **no `schemaVersion` bump** (A5.7)

**Change:** extend `mapper.py`'s `normalize_activity` to accept an optional
`CanonicalActivityDetail` and emit camelCase keys consistent with the existing record:
`powerInZones`, `hrInZones`, `normalizedPower`, `intensityFactor`, `variabilityIndex`,
`laps`. Omit each key entirely when absent — do not write `null`.

Also extend `NormalizedGarminActivity` and `parseNormalizedGarminActivity` here, not in
Stage 2. Parsing is required for the Stage 3 read-only UI and has no decision impact.
Malformed optional telemetry degrades to absent while the base activity stays `AVAILABLE`.

**Two hard constraints, both load-bearing:**

1. **Do not add a `schemaVersion` field to this document.**
   `parseNormalizedGarminActivity` rejects any `schemaVersion` present and `!== 1`, and
   `ActivityService.getActivitiesInRange` collapses the **entire** window to `INVALID` if a
   single document fails to parse. Bumping the version would silently zero out the engine's
   whole completed-training history rather than degrading gracefully. The record writes no
   `schemaVersion` today; keep it that way unless the parser is widened in the same commit.
2. **Write detail in the same `upsert_activity` call as each processed base record**, not
   a second detail-only merge. `syncedAt` doubles as the read-side `revision`; a second
   write in the same date pass would churn it for no reason. Existing overlapping
   lookback-window upserts are outside this feature and remain unchanged.

**Done when:** a test asserts the enriched payload contains no `schemaVersion` key; a test
feeds the enriched payload through the **real** `parseNormalizedGarminActivity` (not a
stub) and asserts `AVAILABLE`; and a test asserts enrichment does not add a second
`upsert_activity` call.

> That cross-language test is the point of this item. A Python-side test alone cannot catch
> the failure this constraint exists to prevent.

### G1.6 `[x]` Service wiring and failure isolation

**Change:** in `service.py`'s target-date `sync_daily` pass, after the activity-list fetch
and raw date archive but before `_archive_activities`, fetch detail for qualifying
activities and include it in the same per-activity write.

**Failure isolation:** a detail fetch that fails must **never** fail the sync, exactly as
`_sync_current_performance_targets` already tolerates its own failure after core data is
safely persisted. Log at `warning` and continue. A 429 specifically should abandon the
remaining detail fetches for that run rather than retrying into a harder rate limit.

**Do not archive raw detail payloads.** Settled by the 2026-08-17 amendment to
[ADR-0005](../adr/0005-raw-archive-store-and-rebuild-pipeline.md): the archive is date-keyed
only, and two payloads written under the same `(endpoint, logical_date)` within one sync run
resolve to the same object path, so the second silently overwrites the first. Stage 1 writes
structured summary fields to Firestore and touches no archive path. Reviving per-activity
archiving requires its own ADR.

**Done when:** an injected provider-detail failure leaves the base activity record and the
daily snapshot intact and the sync exit code unchanged; a simulated 429 stops further
detail fetches within the run. Endpoint wrapper/auth behavior is covered separately in
`test_garmin_client.py`.

### G1.7 `[x]` Rebuild-path behaviour

`rebuild` reads exclusively from the archive and calls no Garmin APIs (ADR-0005). It also
does not rewrite standalone activity documents at all, so existing detail fields remain
untouched by construction.

**Done when:** a test asserts rebuild performs zero `upsert_activity` calls.

---

## Stage 2 — Engine measurement integration (completed; production remains TE)

> ADR-0022 accepted the measurement architecture but not production activation. The
> candidate has no ambient switch and no production caller, so `POLICY_VERSION` correctly
> remained unchanged. Activation would require the bump and audit work described there.

### G2.1 `[x]` Decision-side feature extraction and evidence trace

`garminTelemetryEvidence.ts` derives explicit zone/lap features from parsed optional
telemetry. Full, partial, duplicate/malformed, zero-total, and absent coverage have typed
fallbacks; comparison rows omit activity identifiers and dates.

Full, partial, and absent telemetry are unit-tested, and the named candidate policy plus
zone seconds/shares and duration coverage reproduce G2.4.

### G2.2 `[x]` Default-off zone-derived stimulus candidate

The `power_zones_direct_share_v1` selector is an explicit optional engine argument whose
default is `training_effect`. No environment, Firestore, UI, or production composition
path enables it.

ADR-0022 resolved the evidence-tier question: the candidate refines
`estimatedStimulus` within `measuredEffort`; no rung or confidence weight was added.
Missing/partial power data and non-cycling activities degrade exactly to the TE path.

Selector-off equality is asserted at the event boundary, and `simulate:diff` reports no
semantic differences. The enabled real-history credit diff is recorded in G2.4's report.

### G2.3 `[x]` Interval fade from lap summaries

`deriveMatchedIntervalFade` compares first/last average power only across caller-supplied
matched lap indexes; it never guesses interval membership from auto-laps. Attribution
retains the normalized Warsaw-local activity start date, including a session whose
matched laps cross midnight.

A 3x15 fade, negative split, and crossing-midnight attribution are asserted.

### G2.4 `[x]` Measurement report and ship decision

The [measurement report](../analysis/2026-08-17-garmin-zone-credit-measurement.md) records
the bounded real-history comparison, selector-off semantic diff, and replay result.

**Decision: do not ship the candidate.** All 8 eligible activities disagreed with TE and
the candidate reduced quality credit materially, but the sample has no outcome labels or
auditable authored-interval matches showing those reductions are more accurate.

---

## Stage 3 — Activity detail view (independent of Stage 2)

### G3.1 `[x]` Activity detail view

Render power/HR zone bars and a lap-split table from the Stage 1 fields. Every field is
optional — the view must render correctly for an activity with no telemetry at all (a run,
or any pre-G1 historical activity), which will be the majority of the back catalogue.

**Done when:** the view renders for an activity with full telemetry, with partial telemetry
(HR zones but no power), and with none; `npm run visual:refresh` captures all three.

---

## Tests to add

| Test | Asserts |
|---|---|
| `test_garmin_client.py::test_activity_detail_methods_require_login` | Each new method raises the standard unauthenticated `RuntimeError` |
| `test_garmin_client.py::test_activity_detail_methods_tolerate_empty_response` | Falsy upstream response → endpoint-appropriate `[]`/`{}`, not `None` |
| `test_garmin_provider.py::test_canonicalize_activity_detail_from_reduced_contract_fixtures` | Reduced observed-shape fixture → correct `CanonicalZoneBucket` list |
| `test_garmin_provider.py::test_canonicalize_activity_detail_degrades_on_malformed_payload` | Missing/`None`/wrong-typed fields → `None` fields, no raise |
| `test_garmin_provider.py::test_variability_index_omitted_when_average_power_zero` | No divide-by-zero, no sentinel written |
| `test_garmin_provider.py::test_detail_gate_skips_easy_and_non_power_activities` | D-DETAIL-GATE predicate, both branches |
| `test_sync_service.py::test_backfill_issues_no_detail_calls` | Backfill exclusion is enforced, not just documented |
| `test_sync_service.py::test_detail_failure_does_not_fail_sync_or_drop_base_activity` | Base record + snapshot intact, exit code unchanged |
| `test_sync_service.py::test_rate_limit_stops_further_detail_fetches` | A 429 abandons remaining detail work in the run |
| `test_sync_service.py::test_activity_detail_flag_controls_fetch_and_uses_single_enriched_upsert` | `syncedAt`/revision is not churned by a second detail write |
| `test_mapper.py::test_normalize_activity_adds_detail_without_schema_version_or_null_fields` | The A5.7 trap cannot regress |
| `test_rebuild_and_audit.py::test_rebuild_reproduces_snapshot_from_archive_without_garmin_calls` | Rebuild performs no activity writes, so unarchived detail is untouched |
| `trainingHistory.test.ts` — enriched-payload case | The **real** parser accepts the Python-written enriched document as `AVAILABLE` |
| `trainingHistory.test.ts` — corrupt-telemetry case | Corrupt optional telemetry degrades to absent, document stays `AVAILABLE` |

The two `trainingHistory.test.ts` cases are the ones that matter most: they are the only
tests that cross the Python→Firestore→TypeScript boundary where A5.7's failure lives.

---

## Acceptance criteria

**Stage 1**
- [x] `uv run pytest`, `uv run ruff check .`, `uv run mypy src/garmin_sync` all pass.
- [x] `cd app && npm run check` passes.
- [x] With `GARMIN_ACTIVITY_DETAIL_ENABLED` unset, `sync_daily` issues **zero** extra Garmin calls and writes the existing base activity shape.
- [x] With it set, a qualifying activity gains the new fields and non-qualifying activities fail the gate.
- [x] `backfill` issues zero detail calls regardless of the flag.
- [x] No Garmin response key name appears in provider-neutral source modules.
- [x] The activity document still carries no `schemaVersion`.
- [x] A detail-endpoint failure leaves sync success and snapshot persistence unchanged.

**Stage 2** *(additionally)*
- [x] ADR-0022 records D-ZONECRED.
- [x] Selector off → `simulate:diff` is empty against the reviewed committed baseline.
- [x] `POLICY_VERSION` remains unchanged because no production path can select the candidate; ADR-0022 requires the bump only if activation later ships.
- [x] A synthetic pre-change audited decision replays via `npm run replay:recommendation`.
- [x] G2.4's report records the evidence-backed **do not ship** decision.

**Stage 3**
- [x] The view renders for full / partial / absent telemetry; all three desktop/mobile visual captures pass.

---

## Risks & rollback

| Risk | Mitigation | Rollback |
|---|---|---|
| Rate limiting from the extra per-activity calls | D-DETAIL-GATE narrows to qualifying activities in the target-date `sync_daily` pass; the budget is three endpoint operations per qualifying activity, subject to configured retries | Unset `GARMIN_ACTIVITY_DETAIL_ENABLED`; ingestion returns to today's behaviour with no schema change to undo |
| **A `schemaVersion` bump silently zeroes the engine's training history** | G1.5's constraint plus a dedicated regression test; the cross-language parser test is the real guard | Fields are additive; disabling the writer leaves old detail read-only, and the engine continues to ignore it |
| A detail fetch failure breaks daily sync | G1.6 failure isolation, mirroring the performance-targets precedent | Flag off |
| Stage 2 quietly changes recommendations | Default-off selector, `simulate:diff` gate, D-ZONECRED ADR, `POLICY_VERSION` discipline | Flip the selector off; policy version and baseline are unchanged while off |
| Fixtures leak personal health data | G1.0 records observed key shapes with synthetic values; `AGENTS.md` forbids committing raw health JSON | — |

The whole of Stage 1 is behind one default-off flag and writes only additive fields, so
rollback is "unset the flag". That is the reason for the flag; it is not decoration.

---

## Out of scope

Deliberately excluded — each is a valid finding in the source analysis, not an oversight:

* **Pedaling dynamics / L-R asymmetry** (analysis §1.2 "Cycling Dynamics"). Most
  API-shape-fragile part of the proposal and the least-proven value. Revisit only after
  Stage 1 data shows whether real drift exists.
* **`activityDetailMetrics` high-frequency series** (§1.3) and **binary FIT export** (§1.4).
  Interval fade is computable from lap summaries alone (G2.3), so the 1,875-sample-per-
  activity storage cost buys nothing yet.
* **GCS archiving of per-activity payloads.** Excluded by the accepted ADR-0005 amendment:
  the current archive is date-keyed, while these payloads require activity-ID keying.
* **Backfilling telemetry over historical activities.** Explicitly excluded by
  D-DETAIL-GATE. Reconsider only with a measured budget.
* **W′ / anaerobic work capacity** (analysis §2). Needs a model and a calibration decision
  well beyond ingestion.

---

## Docs to update

| Doc | Change | When |
|---|---|---|
| ADR-0005 | ✅ **Done 2026-08-17.** Amendment records that the archive stays date-keyed, `"(or activity ID)"` was never implemented, the documented key omits the `{year}/{month}` shard, and same-run collisions make naive per-activity archiving lossy (A5.3). `archive.py` also added to Code References | — |
| ADR-0022 | **D-ZONECRED** — measured-before-shipped, per D-FUSE/D-SUBJCAL precedent | Done before Stage 2 |
| `docs/plans/README.md` | Record accepted D-DETAIL-GATE and D-ZONECRED | Done |
| `docs/architecture/ingestion-pipeline.md` | Document the per-activity detail path and its gate | Done with G1.6 |
| `docs/architecture/recommendation-engine.md` | Only if D-ZONECRED ships | Not required — G2.4 kept the candidate off |
| `README.md` | `GARMIN_ACTIVITY_DETAIL_ENABLED` in the configuration section | Done with G1.2 |
