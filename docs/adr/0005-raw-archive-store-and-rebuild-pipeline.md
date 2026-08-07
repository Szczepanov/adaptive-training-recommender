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
2. **Stateless Rebuild Command**:
   * Executing `python -m garmin_sync rebuild --start-date YYYY-MM-DD --end-date YYYY-MM-DD` reads payloads exclusively from the local/GCS archive.
   * Calculates metrics, baselines, and writes updated Schema v3 Firestore snapshots **without calling Garmin APIs**.
3. **Audit Utility**:
   * Executing `python -m garmin_sync audit --days 90` checks archive completeness and reports coverage percentages across sleep, HRV, activities, and daily snapshots.

---

## Code References

* [`src/garmin_sync/service.py`](../../src/garmin_sync/service.py) — Daily sync, backfill, and offline rebuild orchestration.
* [`src/garmin_sync/cli.py`](../../src/garmin_sync/cli.py) — Command-line interface definitions for `sync`, `backfill`, `audit`, and `rebuild`.
* [`README.md`](../../README.md#technical-features) — Raw archive store feature documentation.

---

## Consequences

### Positive
* Allows instant offline re-processing of historical Firestore snapshots when metric calculation algorithms change.
* Provides complete data lineage and audit capability.
* Zero dependence on Garmin API uptime during rebuilds.

### Negative
* Requires additional GCS bucket storage when enabled in production.
