# ADR-0005: Raw Ingestion Archive & Offline Rebuild Pipeline

* **Status:** Accepted
* **Date:** 2026-08-07
* **Deciders:** Core Engineering Team

---

## Context and Problem Statement

Garmin Connect API endpoints rate-limit aggressive requests and do not provide infinite historical endpoint recalculations. If baseline formulas or Firestore document schemas are updated, re-querying Garmin Connect APIs for months of historical health payloads risks rate limiting, authentication blockages, or endpoint schema drift.

---

## Decision Outcome

We built an opt-in **immutable raw payload archive & offline rebuild engine**:

1. **Immutable Raw Payload Archiving (`GARMIN_ARCHIVE_ENABLED`)**:
   * Every raw JSON response fetched from Garmin Connect (user summary, sleep data, HRV data, body battery, activities) is compressed with gzip and saved to an immutable raw storage backend (`GCS` or local disk).
   * Keying strategy: `raw/garmin/{endpoint}/{date_iso}.json.gz` (or activity ID).

> **Amendment (2026-08-17) — the archive is date-keyed only; "(or activity ID)" was never implemented.**
>
> The keying line above is inaccurate in three respects. It is corrected here rather than edited, per ADR-0001's immutability rule.
>
> **1. The real object layout is date-sharded, and the leaf is a directory.** `archive.py` `_object_dir` produces `{prefix}/{endpoint}/{year}/{month}/{logical_date}`, and each archived payload is written *inside* that directory as `{sync_run_id}.json.gz` with a sibling `{sync_run_id}.meta.json`. The documented `raw/garmin/{endpoint}/{date_iso}.json.gz` omits both the `{year}/{month}` shard and the per-sync-run leaf.
>
> **2. Activity-ID keying does not exist and is actively rejected.** `archive.py` `_validate_logical_date` requires a `^\d{4}-\d{2}-\d{2}$` string that parses as a real calendar date, and raises otherwise. No caller has ever passed an activity ID. The parenthetical was aspirational when written and no code has since implemented it.
>
> **3. Per-activity archiving is not merely unimplemented — the naive form is lossy.** Because the object path within a run is `{sync_run_id}.json.gz`, two payloads archived under the same `(endpoint, logical_date)` *within one sync run* resolve to the same path and the second silently overwrites the first. The content-addressed dedup check short-circuits only when the payload hash already matches; differing payloads collide rather than coexist. Archiving N activities for one date under a shared endpoint name would therefore retain only the last.
>
> **Decision: the archive remains date-keyed.** Per-activity raw payloads (high-frequency series, `.fit` files) are **not** archived, and the [Garmin telemetry plan](../plans/garmin-activity-telemetry-ingestion.md) is scoped accordingly — its Stage 1 writes structured summary fields to Firestore only and touches no archive path.
>
> **If per-activity archiving is ever revived**, it requires an explicit decision recorded in a new ADR, not a silent reuse of `_archive_raw`. Any such design must resolve the collision in (3) — by carrying a per-activity object name, widening the store's identifier contract beyond a calendar date, or both — and must state what `rebuild` and `audit` do with the resulting objects, since both currently enumerate strictly by logical date (`list_archived_dates`).
>
> Nothing in this amendment changes the accepted decision: an opt-in, immutable, date-keyed raw archive with an offline rebuild path. It records that one parenthetical never described the system.
2. **Stateless Rebuild Command**:
   * Executing `python -m garmin_sync rebuild --start-date YYYY-MM-DD --end-date YYYY-MM-DD` reads payloads exclusively from the local/GCS archive.
   * Calculates metrics, baselines, and writes updated Schema v3 Firestore snapshots **without calling Garmin APIs**.
3. **Audit Utility**:
   * Executing `python -m garmin_sync audit --days 90` checks archive completeness and reports coverage percentages across sleep, HRV, activities, and daily snapshots.

### 2026-08-17 amendment: bounded per-activity detail ingestion

Per-activity power/HR zone payloads and lap summaries require activity-ID keying, which
the implemented date-keyed archive does not provide. They are therefore not raw-archived;
offline rebuild continues to rebuild snapshots only and never rewrites standalone activity
documents.

**D-DETAIL-GATE:** the additional detail fetch is default-off
(`GARMIN_ACTIVITY_DETAIL_ENABLED=false`) and requires a non-easy, power-bearing activity
with an ID. It runs only during the target-date pass of `sync_daily`; lookback resync,
`backfill`, and `rebuild` issue zero detail calls. The live endpoint budget is exactly
three calls per qualifying activity (power zones, HR zones, splits), and an exhausted 429
abandons the remaining detail work without failing core ingestion.

---

## Code References

* [`src/garmin_sync/service.py`](../../src/garmin_sync/service.py) — Daily sync, backfill, and offline rebuild orchestration.
* [`src/garmin_sync/cli.py`](../../src/garmin_sync/cli.py) — Command-line interface definitions for `sync`, `backfill`, `audit`, and `rebuild`.
* [`README.md`](../../README.md#technical-features) — Raw archive store feature documentation.
* *(added 2026-08-17 with the amendment above)* [`src/garmin_sync/archive.py`](../../src/garmin_sync/archive.py) — the store itself: `RawArchiveStore` protocol, `LocalRawArchiveStore`, object layout (`_object_dir`), identifier validation (`_validate_logical_date`), and content-addressed dedup (`_payload_sha256`). This is where the keying strategy actually lives and was absent from the original list.

---

## Consequences

### Positive
* Allows instant offline re-processing of historical Firestore snapshots when metric calculation algorithms change.
* Provides complete data lineage and audit capability.
* Zero dependence on Garmin API uptime during rebuilds.

### Negative
* Requires additional GCS bucket storage when enabled in production.
