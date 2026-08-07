# ADR-0003: Timezone Semantics & Previous-Day Step Window

* **Status:** Accepted
* **Date:** 2026-08-07
* **Deciders:** Core Engineering Team

---

## Context and Problem Statement

Garmin Connect API endpoints report user metrics tied to local wall-clock dates, sleep periods, and cumulative activity. When running ingestion on cloud servers (e.g. Google Cloud Run executing in UTC), standard UTC timestamp operations (`datetime.utcnow()`, `toISOString().split('T')[0]`) cause calendar date boundary drift around midnight.

Furthermore, step counts logged during the morning hours of day `D` represent incomplete partial days, whereas training recommendation models require an accurate evaluation of non-exercise activity thermogenesis (NEAT) from the full completed day.

---

## Decision Outcome

We established explicit timezone and step aggregation rules:

1. **Target Timezone Provider**: All local date calculations in Python MUST explicitly use `Europe/Warsaw` via `ZoneInfo("Europe/Warsaw")` (configured via `APP_TIMEZONE` env var in [`src/garmin_sync/dates.py`](../../src/garmin_sync/dates.py)).
2. **TypeScript Local Date Utility**: The frontend application MUST use `getLocalDateString()` rather than UTC `toISOString()`.
3. **D-1 Completed Day Step Window**: In `daily_recovery_snapshots/{YYYY-MM-DD}`, the `totalSteps` field represents the completed step total for the **previous calendar day (`D - 1`)**.
   * Example: A snapshot for `2026-08-07` captures the full step count from `2026-08-06`.
   * This guarantees that recommendation engine calculations run on morning `D` rely on a completed 24-hour non-exercise strain total rather than a truncated morning snapshot.
4. **Resync Lookback Window**: Daily sync jobs execute with `GARMIN_RESYNC_LOOKBACK_DAYS` (default 1) to automatically re-fetch and update the preceding day's snapshot in case Garmin server processing finalized late (e.g. evening workout synced late).

---

## Code References

* [`src/garmin_sync/dates.py`](../../src/garmin_sync/dates.py) — Timezone date helper functions (`local_today()`, `n_days_ago()`).
* [`src/garmin_sync/mapper.py`](../../src/garmin_sync/mapper.py) — Maps previous day (`D - 1`) step totals into daily snapshot payload.
* [`app/src/engine/models.ts`](../../app/src/engine/models.ts) — TypeScript date formatting and models.

---

## Consequences

### Positive
* Eliminates date boundary glitches where snapshots for `YYYY-MM-DD` get written to the wrong date when sync runs late at night or early morning.
* Ensures step load metrics evaluate full 24-hour cycles.

### Negative
* Developers must be careful never to call naive `date.today()` or UTC slice methods in date calculation routines.
