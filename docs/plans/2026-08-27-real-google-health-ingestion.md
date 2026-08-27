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

- **MS17's CASA Tier 2 / Google Restricted Scope App Verification claim is confirmed false**
  (checked directly in Google Cloud Console, 2026-08-27 — see the dedicated section below). Not
  merely unconfirmed as this document originally said — definitively not done, not started.
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

- §3 Health Connect phone-side check — done: both Garmin and Eight Sleep are connected with all
  categories toggled on. Corroborates (doesn't independently prove) the export direction already
  established by the live API data.

Still open:

- Respiration's real field shape — unconfirmed live; no recent Eight Sleep respiration records
  appeared in the windows queried.
- MS17's CASA Tier 2 / Restricted Scope App Verification status — confirmed NOT done (see the
  dedicated section below).

**Phase 1 is now substantively complete** — see the probe-results doc's §11 exit-criteria checklist.

## Phase 2/3 status — further ahead than expected (2026-08-27)

The original plan assumed Phase 3 (re-deriving MS14/MS16/MS17 for real) would need several
calendar weeks of accumulation before it could start. That assumption turned out to be wrong:
the real 60-day backfill already restored in Phase 2 (2026-06-29 → 2026-08-27) **is** genuine
prospective-equivalent evidence — it's real device data from real calendar days, now correctly
mapped. There was no need to wait.

Re-ran the real evidence tools directly against it today:

- `compare-transports --start-date 2026-06-29 --end-date 2026-08-27` (MS10) — reproduced the
  original RHR finding exactly (74.6% match, 0.593 bpm mean delta) and the HRV/respiration
  transport-gap finding exactly (0% — Garmin genuinely doesn't export these to Health Connect).
  Sleep, previously unmeasurable, now shows a real `TRANSFORMING` result (18.6% exact
  duration match, ~9.6 min mean delta; 9–11% exact stage match, sub-5s mean deltas). Full
  writeup: [`docs/analysis/2026-08-27-garmin-transport-equivalence-analysis.md`](../analysis/2026-08-27-garmin-transport-equivalence-analysis.md)
  (rewritten with the fresh run).
- `audit-multisource --start-date 2026-06-29 --end-date 2026-08-27` (MS14) — reproduced the
  original 42/18/0/0 night coverage split exactly and the HRV/respiration rolling-baseline
  statistics closely (small differences plausible from revision churn after the mapper fix, not
  evidence either run was fake). New: a cross-source sleep-duration correlation of 0.613 —
  moderate, not high, which is genuine new information the original doc never had (sleep was
  unmeasurable before the fix). Full writeup:
  [`docs/analysis/2026-08-27-multisource-shadow-study.md`](../analysis/2026-08-27-multisource-shadow-study.md)
  (rewritten with the fresh run).
- `npx vitest run src/engine/simulation/multisourceComparison.test.ts` (MS16) — this doesn't
  depend on real account data at all (synthetic-scenario/invariant testing of the fusion logic),
  so it was never actually blocked by the mapper bug. 5/5 tests pass, matching the doc's claims.
  Full writeup: [`docs/analysis/2026-08-27-multisource-simulation-comparison.md`](../analysis/2026-08-27-multisource-simulation-comparison.md)
  (banner updated, content unchanged since it checked out).

**MS17 is now the only open item in the entire MS0–MS19 chain**, and it's open for exactly one
reason: the CASA Tier 2 / Restricted Scope App Verification status is genuinely unconfirmed by
the project owner. Even with every other gate now backed by real evidence, that one gate has to
be answered before any real production-activation decision — and separately, `MULTISOURCE_FUSION_POLICY`
should stay `'off'` regardless while this remains a manual-reauth (not durable/automated) setup,
per the scope deliberately chosen at the start of this work.

**One real, still-open finding worth tracking going forward:** Eight Sleep data currently stops
at 2026-08-17 — a ~10-day gap as of this writeup. Worth periodically re-checking
(`audit-multisource`) whether that's resolved (pod back in use) or persists, independent of
anything else in this plan.

## MS17's CASA/verification status: confirmed NOT done (2026-08-27)

Checked directly in Google Cloud Console via the project owner (Google Auth Platform → Data
Access and Verification Center tabs, screenshots reviewed 2026-08-27):

- Publishing status: `In production`, User type: `External`.
- **Data Access shows zero registered scopes** — the two Google Health scopes actually used all
  session (`googlehealth.sleep.readonly`, `googlehealth.health_metrics_and_measurements.readonly`)
  were never declared in this OAuth client's configuration.
- Verification Center: "Data access status: Verification is not required since your app is not
  requesting any sensitive or restricted scopes" — this reading is an artifact of nothing being
  declared, **not** a real exemption. Google's own docs confirm all Google Health API scopes are
  classified `Restricted`, which requires a CASA Tier 2 privacy/security review for production
  use.

**Conclusion:** the real access this whole plan has been built on all session has been happening
through an OAuth grant (Playground + custom client credentials) that requests Restricted scopes
directly, bypassing Console's declared-scope/verification gate entirely. It has worked, but it
is not verified, and Google could restrict or revoke it at any time without notice — this is
exactly the scenario the Restricted-scope verification program exists to gate. This does not
retroactively invalidate anything measured this session (the data is still real), but it does
mean:

- MS17 cannot be closed by more engineering or evidence — it needs the project owner to decide
  whether to formally declare these scopes and pursue Google verification (a real, external,
  likely-paid, multi-week process), or to keep operating informally with this risk accepted.
- No `gcloud` CLI surface exists to check this going forward (verified 2026-08-27 — the old
  `gcloud alpha iap oauth-brands` commands were for a different, now-deprecated purpose,
  unrelated to OAuth consent screen publishing/verification status). Checking requires the
  Console UI (Google Auth Platform → Data Access / Verification Center) each time.

## Verification

- `uv run pytest` (85 passed), `uv run ruff check .` clean, `uv run mypy` clean on touched files,
  `cd app && npx tsc --noEmit` clean, `multisourceFusion.test.ts` (7/7).
- Live: `probe-health` reproduces original MS0 figures exactly; a 3-day `list_data_points` window
  returns 4 (not 633) sleep points; `backfill-health --days 7` completed and saved 48 observations
  across 7 dates at Firestore revision 2.
- `MULTISOURCE_FUSION_POLICY` stays `'off'` throughout; `evaluateMultisourceFusion` remains
  uncalled from the production recommendation path.
