# ES — Direct Eight Sleep Recovery Ingestion

* **Status:** `In progress (default-off)`
* **Date:** 2026-08-28
* **Blocked by:** ES9's tooling is implemented; it now needs a real accumulation window
  (repeated `backfill-eight-sleep-direct` runs overlapping Google Health's existing Eight
  Sleep data). ES10 needs that plus prospective evidence and a separate activation review.
* **Decision authority:** none.
* **Governing ADRs:** ADR-0027 and proposed ADR-0030.

## Goal
Replace unreliable Google Health transport for Eight Sleep with a repository-owned read-only connector emitting existing `CanonicalHealthObservation`s.

| Item | Work | State |
|---|---|---|
| ES0 | Remove archived `pyeight` dependency | implemented in PR #275 |
| ES1 | Explicit secret/config contract, default off | implemented |
| ES2 | Minimal auth/user/trends client | implemented |
| ES3 | Source-aware mapper | implemented |
| ES4 | `RecoveryObservationProvider` adapter | implemented |
| ES5 | Fail-closed transport/schema semantics | implemented |
| ES6 | Sanitized local probe | implemented |
| ES7 | Unit tests | implemented |
| ES8 | Provision secrets + run real-account probe | implemented — real-account probe ran 2026-08-28, authenticated and returned 9 real observations (`hrv_rmssd_ms`, `sleep_stage_*`, `sleeping_heart_rate_bpm`, etc.) across a 3-day window |
| ES9 | Shadow direct-vs-Google comparison | implemented — persistence path (`backfill-eight-sleep-direct`) and comparator (`compare-eight-sleep-transports`, reusing MS10's generalized `TransportEquivalenceAnalyzer`) landed; real accumulation window not yet run |
| ES10 | Baseline/fusion activation decision | blocked by ES9's accumulated evidence |

Runtime config: `EIGHT_SLEEP_DIRECT_ENABLED=false`, `EIGHT_SLEEP_EMAIL`, `EIGHT_SLEEP_PASSWORD`, `EIGHT_SLEEP_CLIENT_ID`, `EIGHT_SLEEP_CLIENT_SECRET`, optional `EIGHT_SLEEP_USER_ID`, timezone/retry/timeout overrides. Do not commit values.

Probe: `EIGHT_SLEEP_DIRECT_ENABLED=true python -m garmin_sync.eight_sleep_probe --date YYYY-MM-DD`.

### ES9 — shadow direct-vs-Google comparison (implemented, evidence pending)

Direct Eight Sleep observations previously had no persistence path — the ES6 probe only
printed a sanitized summary to stdout. Two new commands close that gap:

- `backfill-eight-sleep-direct [--days N] [--start-date] [--end-date]` — registers
  `EightSleepDirectProvider` with `HealthObservationService` and persists observations to
  `health_observation_days/{date}_eight_sleep_eight_sleep_direct`, the same idempotent
  day-source-bundle path `backfill-health` already uses for the Google Health side.
- `compare-eight-sleep-transports [--days N] [--start-date] [--end-date]` — diffs
  `eight_sleep_direct` bundles against `eight_sleep`/`google_health` bundles for overlapping
  dates, reusing `equivalence.py`'s `TransportEquivalenceAnalyzer` (now generalized via an
  `expected_provider` constructor param instead of MS10's original hardcoded `"garmin"`
  filter) and `bundle_to_canonical_observations`.

Both commands are read-only with respect to production behavior — they only ever write to
the shadow `health_observation_days` collection, never `daily_recovery_snapshots`, and
`EIGHT_SLEEP_DIRECT_ENABLED` stays `false` by default.

Neither command is on any Cloud Scheduler job. To build a real comparison window: run
`backfill-eight-sleep-direct` repeatedly (a few times over a week or two is enough for a
first read), then `compare-eight-sleep-transports` over the same range. See
[`docs/ops/cloud-run-deployment.md`](../ops/cloud-run-deployment.md) for how to invoke this
manually against the deployed Cloud Run Job once `EIGHT_SLEEP_*` secrets are wired through
CI, or run locally via `uv run python -m garmin_sync backfill-eight-sleep-direct`.

Promotion requires stable real-account auth/schema, source-specific baseline maturity, better reliability than Google Health, replay/prospective evidence and a separate activation review. Rollback is simply `EIGHT_SLEEP_DIRECT_ENABLED=false`; Garmin/recommendation behavior is unchanged.
