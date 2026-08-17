# Garmin per-activity telemetry: zones, NP, and lap summaries

* **Status:** `Draft`
* **Blocked by:** nothing for Stage 1 (G1.0 is a spike, not a dependency). Stage 2 is blocked by G1 landing **and** by an accepted ADR for **D-ZONECRED**.
* **Unlocks:** zone-accurate completed-training credit; interval-fade detection; the activity-detail view.
* **Source analysis:** [`2026-08-17-garmin-high-resolution-telemetry.md`](../analysis/2026-08-17-garmin-high-resolution-telemetry.md) — §5 findings are referenced below as `A5.1`–`A5.8`.

> **Not a top-level phase.** This is a bounded ingestion capability, not a roadmap phase in the
> `Phase 0`–`9` sequence. Work items are numbered `G*` so they cannot be confused with phase
> numbering. If the deferred raw-series/dashboard work is later revived at scale, promote *that*
> to a real `phase-10-*` plan rather than renumbering these items.

---

## Goal

Ingest Garmin's per-activity power/HR time-in-zone distributions, normalized power, and
lap averages into the existing per-activity Firestore record, then — separately and only
after measurement — let the engine use them for completed-training credit.

Stage 1 is pure ingestion with **no decision impact**. Stage 2 changes recommendations and
is governed accordingly (see D-ZONECRED). Stage 3 is read-only UI. The three ship
independently.

---

## Preconditions

| # | Condition | State today |
|---|---|---|
| P1 | `users/{userId}/activities/{activityId}` exists and is server-written | ✅ `upsert_activity`, rules are `allow write: if false` |
| P2 | The pinned `garminconnect` exposes per-activity endpoints | ✅ verified: `get_activity_power_in_timezones`, `get_activity_hr_in_timezones`, `get_activity_splits`, `get_activity` |
| P3 | A provider-neutral canonical layer exists to extend | ✅ `canonical.py`, and `ProviderCapabilities.activity_details` already exists as an unused flag |
| P4 | The read-side parser tolerates unknown fields | ✅ `parseNormalizedGarminActivity` ignores unrecognised keys — **but see G1.5 for the `schemaVersion` trap (A5.7)** |
| P5 | An agreed rate-limit budget | ❌ **G1.0 must produce this before G1.2 is written** (A5.2) |
| P6 | An accepted decision on whether zones may change credit | ❌ **D-ZONECRED — blocks Stage 2 only** (A5.8) |

---

## Decisions this plan needs

Per `docs/plans/README.md`, decisions belong in ADRs; the plan references them. Two are
proposed here and are **not** yet in the accepted register.

| ID | Proposal | Why it cannot be left to the implementer |
|---|---|---|
| **D-DETAIL-GATE** | The extra per-activity fetch is **opt-in per activity**, gated on a predicate (power-bearing modality, or `intensity_tag != 'easy'`), and runs in `sync_daily` only — never in `backfill` | The alternative silently multiplies Garmin call volume by activities/day across an unbounded historical range; a 429 mid-backfill leaves partial state (A5.2) |
| **D-ZONECRED** | Zone-derived stimulus is **built default-off and measured** against the current TE-based path before any ship decision; coefficients come from evidence, not from this document | Exactly the D-FUSE (ADR-0014) and D-SUBJCAL (ADR-0020) precedent. Prescribing a zone→stimulus coefficient here would repeat the uncited-constant practice F11 criticised (A5.8) |

D-ZONECRED needs an accepted ADR before Stage 2 work items may start. D-DETAIL-GATE can be
recorded as an amendment note on ADR-0005 alongside the archive-keying clarification.

---

## Task board

| Item | Title | Status | Blocked by |
|---|---|---|---|
| G1.0 | Payload spike: what is already in the activities list? | `[ ]` | — |
| G1.1 | Client methods for the three per-activity endpoints | `[ ]` | — |
| G1.2 | Fetch gate and rate-limit budget | `[ ]` | G1.0 |
| G1.3 | Canonical dataclasses for zones and laps | `[ ]` | G1.0 |
| G1.4 | Provider canonicalisation | `[ ]` | G1.1, G1.3 |
| G1.5 | Persist via `normalize_activity` — no `schemaVersion` bump | `[ ]` | G1.3 |
| G1.6 | Service wiring and failure isolation | `[ ]` | G1.2, G1.4, G1.5 |
| G1.7 | Rebuild-path behaviour | `[ ]` | G1.6 |
| G2.1 | Read-side parse of the new fields | `[ ]` | G1.5, ADR for D-ZONECRED |
| G2.2 | Default-off zone-derived stimulus candidate | `[ ]` | G2.1 |
| G2.3 | Interval fade from lap summaries | `[ ]` | G2.1 |
| G2.4 | Measurement report and ship decision | `[ ]` | G2.2, G2.3 |
| G3.1 | Activity detail view | `[ ]` | G1.5 |

---

## Stage 1 — Ingestion (no decision impact)

### G1.0 `[ ]` Payload spike: what is already in the activities list?

**Why first.** `get_activities` may already return `normPower` / `intensityFactor` /
`avgPower` for power-bearing activities. If it does, NP/IF/VI cost **zero** extra API calls
and only zones and laps need per-activity requests — which roughly halves the rate-limit
exposure and changes what G1.2 has to gate. The repo's `tests/fixtures/activities.json` is
a hand-written minimal stub and cannot answer this.

**Do:** against one real cycling activity and one real run, record which of
`normPower`, `intensityFactor`, `avgPower`, `maxPower` appear in the existing
`get_activities_window` payload; and capture one sanitised sample response from each of
`get_activity_power_in_timezones`, `get_activity_hr_in_timezones`, `get_activity_splits`.
Commit them as fixtures.

**Done when:** `tests/fixtures/` contains `activity_power_zones.json`,
`activity_hr_zones.json`, `activity_splits.json` and an enriched `activities.json`, each
with real key names and no personal identifiers; and this plan's G1.2/G1.3 notes are
updated to say whether NP comes free with the list payload.

> Sanitise before committing: strip `startTimeGMT` precision, location, device serial, and
> `ownerId`. Per `CLAUDE.md` no raw health JSON is committed — these fixtures must be
> reduced to the shape under test, matching the existing minimal-fixture style.

### G1.1 `[ ]` Client methods for the three per-activity endpoints

**Current:** `garmin_client.py`'s `GarminDataClient` Protocol and `GarminClientWrapper`
expose no per-activity methods at all (A5.1).

**Change:** add to **both** the Protocol and the wrapper, following the established
`if not self.api: raise RuntimeError("Garmin client is not authenticated. Call login first.")`
then `... or {}` pattern used by every existing method:

| New wrapper method | Wraps |
|---|---|
| `get_activity_power_zones(activity_id)` | `api.get_activity_power_in_timezones` |
| `get_activity_hr_zones(activity_id)` | `api.get_activity_hr_in_timezones` |
| `get_activity_splits(activity_id)` | `api.get_activity_splits` |

Do **not** add `download_activity` or `get_activity_details` — deferred (see Out of scope).

**Done when:** all three exist on the Protocol and the wrapper, each returns `{}` on a
falsy upstream response, and each raises the standard unauthenticated `RuntimeError`;
`uv run mypy src/garmin_sync` passes.

### G1.2 `[ ]` Fetch gate and rate-limit budget — **implements D-DETAIL-GATE**

**Change:** a single predicate in `garmin_provider.py`, e.g.
`_qualifies_for_detail_fetch(activity: CanonicalActivity) -> bool`, plus a
`GARMIN_ACTIVITY_DETAIL_ENABLED` flag in `config.py` (mirroring `GARMIN_ARCHIVE_ENABLED`'s
opt-in style from ADR-0005), default **off**.

Gate on: a power-bearing modality, **and** `intensity_tag != 'easy'`, **and** a non-null
`activity_id`. Detail fetch runs in `sync_daily` only. `backfill` must not call it —
assert this in tests, do not merely document it.

**Budget:** state the worst case explicitly in the module docstring — *N* qualifying
activities/day × *k* endpoints (k=3, or k=2 if G1.0 shows NP ships with the list). Confirm
`GarminClientWrapper`'s existing `retry_attempts` / `retry_min_wait` / `retry_max_wait`
cover that volume; if not, raise the backoff here rather than in a follow-up.

**Done when:** the predicate is unit-tested on both branches; a test asserts `backfill`
issues **zero** detail calls over a multi-day range; the flag defaults off and the whole
feature is inert when unset.

### G1.3 `[ ]` Canonical dataclasses for zones and laps

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

### G1.4 `[ ]` Provider canonicalisation

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

### G1.5 `[ ]` Persist via `normalize_activity` — **no `schemaVersion` bump** (A5.7)

**Change:** extend `mapper.py`'s `normalize_activity` to accept an optional
`CanonicalActivityDetail` and emit camelCase keys consistent with the existing record:
`powerInZones`, `hrInZones`, `normalizedPower`, `intensityFactor`, `variabilityIndex`,
`laps`. Omit each key entirely when absent — do not write `null`.

**Two hard constraints, both load-bearing:**

1. **Do not add a `schemaVersion` field to this document.**
   `parseNormalizedGarminActivity` rejects any `schemaVersion` present and `!== 1`, and
   `ActivityService.getActivitiesInRange` collapses the **entire** window to `INVALID` if a
   single document fails to parse. Bumping the version would silently zero out the engine's
   whole completed-training history rather than degrading gracefully. The record writes no
   `schemaVersion` today; keep it that way unless the parser is widened in the same commit.
2. **Write detail in the same `upsert_activity` call as the base record**, not a second
   merge. `syncedAt` doubles as the read-side `revision`; a second write churns it and
   invalidates snapshot revision strings for no reason.

**Done when:** a test asserts the enriched payload contains no `schemaVersion` key; a test
feeds the enriched payload through the **real** `parseNormalizedGarminActivity` (not a
stub) and asserts `AVAILABLE`; and a test asserts exactly one `upsert_activity` call per
activity per sync.

> That cross-language test is the point of this item. A Python-side test alone cannot catch
> the failure this constraint exists to prevent.

### G1.6 `[ ]` Service wiring and failure isolation

**Change:** in `service.py`'s `sync_daily`, after `_archive_activities`, fetch detail for
qualifying activities and merge it into the same per-activity write.

**Failure isolation:** a detail fetch that fails must **never** fail the sync, exactly as
`_fetch_and_store_performance_targets` already tolerates its own failure after core data is
safely persisted. Log at `warning` and continue. A 429 specifically should abandon the
remaining detail fetches for that run rather than retrying into a harder rate limit.

Archive raw detail payloads only if it can be done without abusing the date-keyed store —
otherwise skip archiving entirely for now and record why (A5.3; the archive cannot key by
activity ID today, and that is a deferred concern, not a Stage 1 blocker).

**Done when:** an injected failure on each of the three endpoints leaves the base activity
record and the daily snapshot intact and the sync exit code unchanged; a simulated 429
stops further detail fetches within the run.

### G1.7 `[ ]` Rebuild-path behaviour

`rebuild` reads exclusively from the archive and calls no Garmin APIs (ADR-0005). Since
G1.6 does not archive detail payloads, **rebuild must leave existing detail fields
untouched rather than erasing them.** Confirm the merge semantics do this; if a rebuild
would strip previously-written detail, fix it here.

**Done when:** a test rebuilds a date whose activity already carries detail fields and
asserts they survive unchanged.

---

## Stage 2 — Engine integration (**blocked on D-ZONECRED**)

> Do not start these until an ADR for D-ZONECRED is accepted. Stage 2 alters real
> recommendations: it forces a `POLICY_VERSION` bump in `policy.ts` (CI-guarded by
> `check-policy-drift.mjs`), moves the committed scenario baseline compared by
> `simulate:diff`, and must keep ADR-0010 replay of pre-change decisions reproducible.

### G2.1 `[ ]` Read-side parse of the new fields

Extend `parseNormalizedGarminActivity` and `NormalizedGarminActivity` to surface the new
fields as optional. Preserve the existing contract exactly: unknown keys ignored, a
malformed *optional* telemetry field must **not** invalidate the document — it should
degrade to absent, because one `INVALID` document still kills the whole window.

**Done when:** a document with corrupt `powerInZones` still parses `AVAILABLE` with the
field absent, and the existing activity-parser tests are unchanged and green.

### G2.2 `[ ]` Default-off zone-derived stimulus candidate

Implement zone-derived stimulus as a **selectable candidate** behind a default-off
selector, alongside the current TE-based path — the shape ADR-0020 used for subjective
drift, not an in-place replacement.

`classifyGarminTier` in `completedTraining.ts` currently returns `measuredEffort` when TE
and training load are both present; that is already the top measured tier. Whether zone
data justifies a **new** rung above it, or should only refine `estimatedStimulus` *within*
`measuredEffort`, is a D-ZONECRED question — the ADR decides, not the implementer. Adding a
rung changes the `EvidenceTier` union and `stimulusConfidenceForTier`, so it is not a local
edit.

**Must degrade** to the current TE path when no power data exists — a run, a walk, a ride
with no power meter — rather than propagating nulls into cost/stimulus (A5.6).

**Done when:** with the selector off, `simulate:diff` shows **zero** change against the
committed baseline; with it on, the diff is produced and attached to G2.4.

### G2.3 `[ ]` Interval fade from lap summaries

Compare per-lap average power across a matched interval set (Lap 3 vs Lap 1 of a `3x15`)
using `laps` only — no raw series needed.

Any lap-to-date attribution must use the existing Warsaw-local conversion in `dates.py` /
`localDate.ts`, never a UTC `toISOString().split('T')[0]`, for sessions crossing midnight
(A5.6, and the `CLAUDE.md` timezone rule).

**Done when:** a fade case and a negative-split case are both asserted, plus a
crossing-midnight attribution test.

### G2.4 `[ ]` Measurement report and ship decision

Produce the D-ZONECRED evidence: zone-derived vs TE-derived credit over the athlete's real
recorded history, the `simulate:diff` output from G2.2, and the disagreement cases.

**Recording "no material improvement" satisfies this item** — the same standard D-BEAM set,
where a negative result is a valid and useful outcome. Shipping is not the success
condition; a defensible decision is.

---

## Stage 3 — Activity detail view (independent of Stage 2)

### G3.1 `[ ]` Activity detail view

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
| `test_garmin_client.py::test_activity_detail_methods_tolerate_empty_response` | Falsy upstream response → `{}`, not `None` |
| `test_garmin_provider.py::test_canonicalize_zones_from_fixture` | Real fixture → correct `CanonicalZoneBucket` list |
| `test_garmin_provider.py::test_canonicalize_detail_degrades_on_malformed_payload` | Missing/`None`/wrong-typed fields → `None` fields, no raise |
| `test_garmin_provider.py::test_variability_index_omitted_when_average_power_zero` | No divide-by-zero, no sentinel written |
| `test_garmin_provider.py::test_detail_gate_skips_easy_and_non_power_activities` | D-DETAIL-GATE predicate, both branches |
| `test_sync_service.py::test_backfill_issues_no_detail_calls` | Backfill exclusion is enforced, not just documented |
| `test_sync_service.py::test_detail_failure_does_not_fail_sync` | Base record + snapshot intact, exit code unchanged |
| `test_sync_service.py::test_rate_limit_stops_further_detail_fetches` | A 429 abandons remaining detail work in the run |
| `test_sync_service.py::test_single_upsert_per_activity` | `syncedAt`/revision is not churned by a second write |
| `test_mapper.py::test_normalize_activity_writes_no_schema_version` | The A5.7 trap cannot regress |
| `test_rebuild_and_audit.py::test_rebuild_preserves_existing_detail_fields` | Rebuild does not erase un-archived detail |
| `trainingHistory.test.ts` — enriched-payload case | The **real** parser accepts the Python-written enriched document as `AVAILABLE` |
| `trainingHistory.test.ts` — corrupt-telemetry case | Corrupt optional telemetry degrades to absent, document stays `AVAILABLE` |

The two `trainingHistory.test.ts` cases are the ones that matter most: they are the only
tests that cross the Python→Firestore→TypeScript boundary where A5.7's failure lives.

---

## Acceptance criteria

**Stage 1**
- [ ] `uv run pytest`, `uv run ruff check .`, `uv run mypy src/garmin_sync` all pass.
- [ ] `cd app && npm run check` passes.
- [ ] With `GARMIN_ACTIVITY_DETAIL_ENABLED` unset, `sync_daily` issues **zero** extra Garmin calls and writes a byte-identical activity record to today's.
- [ ] With it set, a qualifying activity gains the new fields and a non-qualifying one does not.
- [ ] `backfill` issues zero detail calls regardless of the flag.
- [ ] No Garmin key name appears outside `garmin_provider.py`.
- [ ] The activity document still carries no `schemaVersion`.
- [ ] A detail-endpoint failure leaves sync exit code and snapshot unchanged.

**Stage 2** *(additionally)*
- [ ] An accepted ADR records D-ZONECRED.
- [ ] Selector off → `simulate:diff` is empty against the committed baseline.
- [ ] `POLICY_VERSION` bumped and the prior version added to `HISTORICAL_POLICY_VERSIONS`; `check-policy-drift.mjs` passes.
- [ ] A pre-change audited decision still replays via `npm run replay:recommendation`.
- [ ] G2.4's report exists and states a decision — including "not shipping" as a valid one.

**Stage 3**
- [ ] The view renders for full / partial / absent telemetry.

---

## Risks & rollback

| Risk | Mitigation | Rollback |
|---|---|---|
| Rate limiting from the extra per-activity calls | D-DETAIL-GATE narrows to qualifying activities in `sync_daily` only; G1.0 may cut a third of the calls if NP ships with the list | Unset `GARMIN_ACTIVITY_DETAIL_ENABLED`; ingestion returns to today's behaviour with no schema change to undo |
| **A `schemaVersion` bump silently zeroes the engine's training history** | G1.5's constraint plus a dedicated regression test; the cross-language parser test is the real guard | Fields are additive — remove the writer and stale fields are simply ignored on read |
| A detail fetch failure breaks daily sync | G1.6 failure isolation, mirroring the performance-targets precedent | Flag off |
| Stage 2 quietly changes recommendations | Default-off selector, `simulate:diff` gate, D-ZONECRED ADR, `POLICY_VERSION` discipline | Flip the selector off; policy version and baseline are unchanged while off |
| Fixtures leak personal health data | G1.0 sanitisation; `CLAUDE.md` forbids committing raw health JSON | — |

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
* **GCS archiving of per-activity payloads.** Blocked by the archive's date-only keying
  (A5.3); needs an ADR-0005 amendment. Not required by any item here.
* **Backfilling telemetry over historical activities.** Explicitly excluded by
  D-DETAIL-GATE. Reconsider only with a measured budget.
* **W′ / anaerobic work capacity** (analysis §2). Needs a model and a calibration decision
  well beyond ingestion.

---

## Docs to update

| Doc | Change | When |
|---|---|---|
| ADR-0005 | Amendment note: the archive stays date-keyed; per-activity payloads are **not** archived, and the "(or activity ID)" phrasing is aspirational (A5.3) | With G1.6 |
| New ADR | **D-ZONECRED** — measured-before-shipped, per D-FUSE/D-SUBJCAL precedent | Before Stage 2 |
| `docs/plans/README.md` | Add this plan to the plans table and D-DETAIL-GATE / D-ZONECRED to the decision register (proposed section until accepted) | With G1.1 |
| `docs/architecture/ingestion-pipeline.md` | Document the per-activity detail path and its gate | With G1.6 |
| `docs/architecture/recommendation-engine.md` | Only if D-ZONECRED ships | With G2.4 |
| `README.md` | `GARMIN_ACTIVITY_DETAIL_ENABLED` in the configuration section | With G1.2 |
