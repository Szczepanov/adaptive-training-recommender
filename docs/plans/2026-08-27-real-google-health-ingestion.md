# Real Google Health / Eight Sleep Ingestion — Verification & Fix Log

* **Status:** `In progress`
* **Proposed:** 2026-08-27
* **Parent plan:** [`multisource-health-and-recovery-ingestion.md`](multisource-health-and-recovery-ingestion.md)
  — see that file's task board for current MS0/MS10/MS14/MS16/MS17 status.

---

## Why this document exists

An earlier version of this document accused the MS0/MS10/MS14/MS16/MS17 evidence chain of being
fabricated. **That was too strong and has been retracted for MS0.** The reasoning behind it was
flawed: absence of a committed OAuth token is expected (`.env` is correctly gitignored, not
evidence a real token was never used), and MS14's "60d **backfilled**" label was misread as
"impossible to collect in 3.5 hours" — backfilling 60 days of already-existing historical records
in one run is fast and legitimate, not the same as live day-by-day collection. Independently
re-running `probe-health` live against the real account on 2026-08-27 reproduced the original
MS0 numbers exactly (633/320/631/287 data points, Eight Sleep `FULL_PASS`, Garmin `PRESENT`),
and a `backfill-health` run the same day landed at Firestore revision 2 for every date, meaning a
real revision 1 already existed from a prior run. MS0's evidence is real.

What genuinely remains open:

- **MS17's CASA Tier 2 / Google Restricted Scope App Verification claim is unconfirmed.** The
  project owner is not sure whether that audit actually happened. Treat it as unresolved (not
  satisfied) until checked directly in Google Cloud Console.
- **A real bug, found while re-verifying MS0 live, means MS10/MS14/MS16's sleep-related figures
  need re-deriving.** The sleep mapper assumed a `sleepSession.{startTime,endTime,summary}` shape
  that does not match the real `health.googleapis.com/v4` response (real shape:
  `sleep.interval.{startTime,endTime}` + a flat `sleep.stages[]` list). Before the fix, this meant
  Google-transported sleep observations were silently never persisted — not that no transport
  existed, but that the pipeline dropped them. RHR-only figures (which use a different, correctly-shaped
  daily-summary path) are more trustworthy but still worth re-checking now that the pipeline has
  changed.

## What's been verified and fixed today (2026-08-27)

1. **`.env` load-order bug** ([`cli.py`](../../src/garmin_sync/cli.py)) — `probe-health`/
   `backfill-health` resolved Google Health credentials before anything called `load_dotenv()`,
   so a repo-root `.env` was silently ignored. Fixed.
2. **Date-range filter was non-functional** ([`google_health_client.py`](../../src/garmin_sync/google_health_client.py))
   — `list_data_points()` always returned the entire account history regardless of the requested
   window, because its per-point date check looked at flat `startTime`/`endTime` fields that don't
   exist in the real response. Fixed and verified live: a 3-day window now correctly returns 4
   sleep points instead of 633.
3. **Sleep mapping was broken** ([`google_health_mapper.py`](../../src/garmin_sync/google_health_mapper.py),
   [`google_health_provider.py`](../../src/garmin_sync/google_health_provider.py)) — fixed to use
   the real `sleep.interval`/`sleep.stages` shape and to recover the data type from the point's
   `name` resource path (real points don't carry a flat `dataTypeName`). Added a regression test
   in `tests/test_google_health_mapper.py` built from the real, live response structure (kept the
   old test too, as a legacy/synthetic-shape compatibility check). Verified live: correct per-day
   sleep stages, correct provider attribution, correct logical dates.
4. **Real 7-day `backfill-health` run completed** against the real account with the fixed
   pipeline — 7 dates, 48 observations, all saved at Firestore revision 2 (revision 1 pre-existed).
5. **New bug found, not yet fixed:** raw-archive writes to GCS fail for every Google Health
   backfill date — `Invalid archive endpoint; only safe object-name segments are allowed`.
   Firestore observation saves succeed independently, so no data is lost, but MS7's raw-archive
   contract isn't currently satisfied for this provider. Follow-up.
6. **Known remaining limitation, not fixed:** the server-side AIP-160 filter for the three
   daily-summary types is rejected by the live API (`400 INVALID_DATA_POINT_FILTER`, "Restriction
   member path segment ... does not match any data type"). Falls back to unfiltered + the
   now-correct client-side filter, so results are still correct, just less efficient than
   intended. Needs the official filter syntax from Google's docs before attempting a real fix —
   deliberately not guessed at.
7. **`compare-transports --days 7` re-run** with the fixed pipeline: RHR 71.4% exact match
   (mean delta 1.0 bpm) over the 7-day window against real Firestore data. Sleep/HRV/respiration
   figures from this particular run still need a closer look (Garmin does not appear to export
   HRV or respiration to Health Connect at all, per the probe's own source matrix — that looks
   like a genuine transport gap, not a bug).

## Incident: transient auth failure deleted 46 real bundles, then fixed (2026-08-27)

While re-running the full 2026-06-29→2026-08-27 backfill with the sleep-mapper fix applied, the
`GOOGLE_HEALTH_ACCESS_TOKEN` in `.env` expired partway through the run (~9 minutes in, around
2026-08-27 13:46). `_resolve_google_health_auth_manager` (`cli.py`) preferred that static access
token over the also-available refresh token, so once it expired every subsequent date failed
Google Health auth with HTTP 401 for all four data types.

That alone would just mean missing data for those dates — but `GoogleHealthProvider.
fetch_observations` (`google_health_provider.py`) caught **every** exception per data-type query,
including auth errors, and silently continued, so a date that 401'd on all four types produced a
*clean empty* `ObservationBatch` rather than a raised error. `HealthObservationService.sync_date`
cannot distinguish "the source genuinely has no data this run" from "we couldn't check" — an empty
batch triggers `_reconcile_missing_sources`, which **deletes** any previously stored bundle whose
(provider, transport) doesn't appear in the current (empty) batch. Result: **every date from
2026-07-31 through 2026-08-27 (46 bundles, both `garmin_google_health` and
`eight_sleep_google_health` where applicable) was deleted** — a transient token expiry cascaded
into real data loss for the most recent ~4 weeks.

Two fixes landed together:

1. `cli.py` — `_resolve_google_health_auth_manager` now prefers the refresh-token path whenever
   `client_id`/`client_secret`/`refresh_token` are all available, instead of a static access
   token that can't renew itself. `expires_at` is forced to `0.0` on that path so it always
   refreshes once up front rather than trusting a possibly-already-stale token value.
2. `google_health_provider.py` — `fetch_observations` now only swallows `GoogleHealthNotFoundError`
   (a legitimate "this data type isn't available" signal) per data type; every other exception
   (auth, rate limit, account-not-linked, network) propagates instead of being silently absorbed
   into an empty batch. `HealthObservationService.sync_date`'s existing error path already skips
   reconciliation on a raised exception, so this alone prevents the tombstone cascade even if a
   future credential problem recurs.

Recovery: re-ran `backfill-health --start-date 2026-07-31 --end-date 2026-08-27` with both fixes
in place — 0 auth errors, 0 tombstones, 44/44 bundles restored. Verified directly against
Firestore afterward: `garmin_google_health` covers 59/60 days in the full range (the one gap,
2026-07-18, pre-dates this incident and this session entirely — a genuine pre-existing sync gap,
not something this incident caused); `eight_sleep_google_health` covers 2026-06-29 through
2026-08-17 (42 days), consistent with the real ~10-day Eight Sleep gap noted earlier in this doc.

Separately fixed in the same pass: `archive_health()` in both `LocalRawArchiveStore` and
`GcsRawArchiveStore` built a path segment `"health/{provider}_{transport}"` containing a `/`,
which the path-safety validator (correctly) rejected as unsafe — every single Google Health raw
archive write had been failing since MS7 landed. Fixed by moving `"health"` onto the store's
prefix instead of the validated segment; verified live against real GCS
(`gs://adaptive-training-garmin-archive/raw/garmin/health/google_health_bundle/...`). Added a
regression test (`tests/test_archive.py::test_local_archive_health_bundle_round_trip`) using the
exact production shapes (`provider="google_health"`, `transport="bundle"`) that triggered it —
there was no prior test coverage for `archive_health()` at all, which is why this went unnoticed
since MS7.

## Phase 1 status (per `docs/ops/google-health-source-provenance-probe.md`)

Done and written up in
[`docs/analysis/2026-08-27-google-health-source-provenance-probe.md`](../analysis/2026-08-27-google-health-source-provenance-probe.md)
(§4–§9 of that doc):

- §6 Identity (`get_identity()`) — succeeded, `healthUserId`/`legacyUserId` resolved.
- §11 Raw vs. `:reconcile` — reconciled points carry no `dataSource` at all, confirming raw
  `list` is the only viable source for provenance-aware ingestion.
- §12 Latency — approximated from real sleep-stage `createTime` vs. session `endTime`: samples
  ranged ~1 min to ~6.5 hours (mean ≈119 min). Wide enough spread that a repair-sync/backfill
  lookback is necessary, not a same-day poll.
- §13 Date/time semantics — `startUtcOffset`/`endUtcOffset` consistently `7200s` (Warsaw CEST);
  `derive_warsaw_logical_date()` verified correct on a real record. DST transition not tested
  (none occurred in the sampled window — deliberately not simulated).
- §14 Duplicate/revision — a repeated `daily-resting-heart-rate` query was stable (identical
  count/values both times); true revision behavior across a real device resync not tested.
- Along the way, corrected a real inaccuracy in the original MS0 doc's field-shape table (it
  described the same wrong `sleepSession`/bare-`rmssd`/bare-`bpm` shapes the mapper bug was built
  on) and found that the three daily-summary types (HRV/RHR/respiration) carry **no `name` field
  at all** in the real API response — `source_record_id` is null for those observations. Doesn't
  break Firestore persistence (dedup is whole-bundle-content-hash based, not per-record), but
  weakens per-observation audit traceability. Documented as a known limitation, not fixed.
- Also found RHR's real `beatsPerMinute` field is a **string**, not a number (still parses
  correctly via `float()`, just worth knowing).

Still open:

- §3 Health Connect phone-side check (Garmin/Eight Sleep connected-app permissions) — needs the
  project owner to check their Android device directly.
- Respiration's real field shape — unconfirmed live; no recent Eight Sleep respiration records
  appeared in the windows queried.
- MS17's CASA Tier 2 / Restricted Scope App Verification status — separately tracked as genuinely
  unconfirmed (see "Why this document exists" above).

## Verification

- `uv run pytest` (85 passed), `uv run ruff check .` clean, `uv run mypy` clean on touched files,
  `cd app && npx tsc --noEmit` clean, `multisourceFusion.test.ts` (7/7).
- Live: `probe-health` reproduces original MS0 figures exactly; a 3-day `list_data_points` window
  returns 4 (not 633) sleep points; `backfill-health --days 7` completed and saved 48 observations
  across 7 dates at Firestore revision 2.
- `MULTISOURCE_FUSION_POLICY` stays `'off'` throughout; `evaluateMultisourceFusion` remains
  uncalled from the production recommendation path.
