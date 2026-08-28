# ES — Direct Eight Sleep Recovery Ingestion

* **Status:** `In progress (default-off)`
* **Date:** 2026-08-28
* **Blocked by:** ES9's tooling is implemented, its daily backfill is scheduled, and a full
  year of real data has been backfilled and compared (314 real paired nights vs Garmin
  Direct — see [`docs/analysis/2026-08-28-garmin-eight-sleep-cross-device-agreement.md`](../analysis/2026-08-28-garmin-eight-sleep-cross-device-agreement.md)).
  ES10 needs continued accumulation plus a separate, deliberate activation review — this
  first read is evidence, not a promotion decision.
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
| ES9 | Shadow direct-vs-Google comparison | implemented and run for real — persistence path (`backfill-eight-sleep-direct`, daily-scheduled) and comparator (`compare-eight-sleep-transports`, reusing MS10's generalized `TransportEquivalenceAnalyzer`) landed; full year backfilled (365 days, 314 real paired nights), see [`docs/analysis/2026-08-28-garmin-eight-sleep-cross-device-agreement.md`](../analysis/2026-08-28-garmin-eight-sleep-cross-device-agreement.md) for the Garmin-vs-Eight-Sleep-Direct cross-device evidence (MS14 generalized) this produced |
| ES10 | Baseline/fusion activation decision | blocked by continued ES9 accumulation and a separate activation review — see the analysis doc above for the current evidence read |

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

`backfill-eight-sleep-direct` runs once daily via a Cloud Scheduler job
(`eight-sleep-direct-sync-daily`, `0 8 * * *` Europe/Warsaw) once `EIGHT_SLEEP_EMAIL`,
`EIGHT_SLEEP_PASSWORD`, `EIGHT_SLEEP_CLIENT_ID`, `EIGHT_SLEEP_CLIENT_SECRET`, and
`APP_USER_ID` are all set as repo secrets — deliberately a fixed daily tick, not a polling
window like the Garmin Jobs, since there's no cheap freshness pre-check here and every tick
is a real Eight Sleep API call. Each tick uses a bounded 7-day trailing window sized for
daily incremental runs, not the historical-backfill default. This still only ever writes to
the shadow `health_observation_days` collection; `EIGHT_SLEEP_DIRECT_ENABLED` stays
production-inert. `compare-eight-sleep-transports` is not scheduled — it's a cheap,
idempotent report over whatever has already accumulated, run on demand. See
[`docs/ops/cloud-run-deployment.md`](../ops/cloud-run-deployment.md) for the one-time larger
backfill and comparison commands, or run either locally via
`uv run python -m garmin_sync backfill-eight-sleep-direct`.

Promotion requires stable real-account auth/schema, source-specific baseline maturity, better reliability than Google Health, replay/prospective evidence and a separate activation review. Rollback is simply `EIGHT_SLEEP_DIRECT_ENABLED=false`; Garmin/recommendation behavior is unchanged.

The mapper was later extended (ES-EXT/ES-EXT-2/ES-EXT-3 batches, `NORMALIZER_VERSION` now
`4`) to capture snoring, sleep latency, sleep debt, social jetlag, circadian consistency
baselines, chronotype, and night tags — real fields the private API returns that the
original mapper never extracted. Two extraction bugs (WASO fields were fractions not
seconds; `social_jetlag_seconds` was silently dropping negative values) were found and
fixed against real probed data before trusting the result. See
[`docs/analysis/2026-08-28-eight-sleep-extended-metrics-analysis.md`](../analysis/2026-08-28-eight-sleep-extended-metrics-analysis.md)
for the full year of corrected findings and the keep/drop verdict: snoring and sleep
latency are genuine Garmin-incomparable signal worth keeping; chronotype (zero variance)
and tags (redundant Garmin workout data mirrored back) currently pull no weight; duration/
timing agreement remains the documented weak spot and D-8S-NO-AUTHORITY still stands.
