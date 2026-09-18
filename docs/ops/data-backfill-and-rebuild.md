# Data Backfill, Audit & Offline Rebuild Guide

This guide covers operational commands for historical data ingestion, data completeness auditing, and offline rebuilding of Firestore snapshots from raw payload archives.

---

## 🔄 1. Historical Data Backfill

To backfill historical Garmin health, sleep, HRV, and activity metrics for a newly onboarded user or missing date range:

```bash
# Perform a 56-day historical backfill
uv run python -m garmin_sync backfill --days 56
```

The backfill command:
1. Iterates chronologically through the date range.
2. Queries Garmin APIs for sleep, HRV balance, body battery, resting heart rate, and activity history.
3. Computes rolling 7-day and 28-day baseline metrics.
4. Writes Schema v3 user-scoped snapshots (`users/{userId}/daily_recovery_snapshots/{YYYY-MM-DD}`).

### Automatic and request-backed backfills

There are two automatic recovery-history safeguards, but they have different observability contracts:

- **Account linking** queues a 56-day `initial_backfill` request at
  `users/{userId}/garmin_sync_requests/latest`. The `garmin-manual-sync-poll`
  worker claims that request and runs the historical backfill asynchronously.
- **Scheduled daily sync cold-start recovery** checks the trailing 56-day history.
  When fewer than 14 historical snapshots exist, `sync_daily(...,
  auto_backfill_cold_start=True)` executes the bounded backfill directly inside
  that daily-sync run. It does **not** create or update the shared sync-request
  document.

The connected-account settings UI therefore reports **request-backed** historical
loads: the initial account-link request and any later manual retry. It shows progress
while such a request is pending/processing and offers **Retry loading history** after
a recorded failure or stale claim. The scheduled cold-start safeguard remains a
separate self-healing path and is not represented by that UI status.

The shared request document is a coordination slot, not a durable backfill audit log.
A later manual sync can replace a terminal request, so operational history should come
from normal logs/audits rather than from `garmin_sync_requests/latest`.

Staleness policy is shared across the browser and account-link backend:

- pending requests and ordinary claimed syncs: **20 minutes**, covering the
  15-minute poll cadence plus execution margin;
- claimed `initial_backfill` / `backfill` requests: **30 minutes from
  `claimedAt`**, aligned with the backend per-user execution lease.

This parity matters because account linking and the browser both write the same fixed
request document; one path must not supersede work that the other still considers live.

---

## 🔍 2. Ingestion Audit

To report data completeness, snapshot coverage, and raw payload archive health over a target window:

```bash
# Run a 90-day completeness audit
uv run python -m garmin_sync audit --days 90
```

### Audit Output Metrics
* Snapshot Coverage % (expected days vs present Firestore snapshots).
* Sleep & HRV Completeness %.
* Activity record counts.
* Raw archive payload counts (when `GARMIN_ARCHIVE_ENABLED=true`).

---

## 🛠️ 3. Offline Snapshot Rebuild

When baseline calculation formulas or Firestore document schemas are updated, use the offline rebuild command to recompute Firestore documents without making network requests to Garmin Connect APIs:

```bash
# Rebuild Firestore snapshots from raw archives over a date range
uv run python -m garmin_sync rebuild --start-date 2026-06-01 --end-date 2026-08-06
```

> [!IMPORTANT]
> The `rebuild` command requires prior history saved in the raw archive store (`GARMIN_ARCHIVE_ENABLED=true`). If payloads are missing from the raw archive for a given date, the rebuild command will report skipped dates.
