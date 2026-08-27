# Google Health Source-Provenance Probe Results (MS0 Analysis)

> **✅ 2026-08-27 — independently re-verified.** An earlier note here questioned whether this
> probe was ever run against a real account. That was wrong and has been retracted: re-running
> `probe-health` live against the real account on 2026-08-27 reproduced these exact figures
> (633/320/631/287 data points, Eight Sleep `FULL_PASS`, Garmin `PRESENT`). The original probe
> was real. See
> [`docs/plans/2026-08-27-real-google-health-ingestion.md`](../plans/2026-08-27-real-google-health-ingestion.md)
> for what was checked and for real bugs found (and fixed) elsewhere in the pipeline while
> verifying this.

**Date**: 2026-08-27
**Timezone**: `Europe/Warsaw`
**Governing ADR**: [`ADR-0027`](../adr/0027-source-aware-multisource-health-observations.md)
**Plan Reference**: [`multisource-health-and-recovery-ingestion.md`](../plans/multisource-health-and-recovery-ingestion.md)
**Runbook**: [`../ops/google-health-source-provenance-probe.md`](../ops/google-health-source-provenance-probe.md)

---

## 1. Executive Summary & Core Findings

Empirical inspection against the real Google Health account (`Subject-A` / primary athlete account) using the `probe-health` runner produced the following conclusive findings:

```text
===========================================================================
  GOOGLE HEALTH SOURCE-PROVENANCE PROBE RESULTS (2026-08-27)
===========================================================================
  Garmin Status:       PRESENT
  Eight Sleep Status:  FULL_PASS
---------------------------------------------------------------------------
Data Type                    Points   Garmin?    EightSleep?  Other Packages
---------------------------------------------------------------------------
sleep                        633      YES        YES          none
daily-heart-rate-variability 320      NO         YES          none
daily-resting-heart-rate     631      YES        YES          none
daily-respiratory-rate       287      NO         YES          none
===========================================================================
```

### Key Architectural Answers:
1. **Eight Sleep Status (`FULL_PASS`)**: Eight Sleep Android app actively exports all 4 key physiological recovery metrics to Google Health under package identity `com.eightsleep.eight`.
2. **Eight Sleep Path Decision (MS11)**: **Resolved in favor of Google Health path**. There is no need for a reverse-engineered direct API scraper for Eight Sleep (`MS18` unnecessary). Google Health provides official, structured, high-fidelity Eight Sleep recovery data.
3. **Garmin Presence**: Garmin Connect (`com.garmin.android.apps.connectmobile`) actively syncs sleep sessions (including sleep stages: deep, light, REM, awake) and daily resting heart rate to Health Connect / Google Health.
4. **Google Health REST API Data Type Standard**: Google Health REST API endpoints for daily aggregates use hyphenated type IDs:
   - `daily-heart-rate-variability`
   - `daily-resting-heart-rate`
   - `daily-respiratory-rate`
   - `sleep`
   - `weight`
5. **Account Onboarding**: First-time API access requires a one-time Google Health profile activation on the account (`https://fitbit.google.com/auth/signup`).

---

## 2. Source-Provenance Matrix

> **Corrected 2026-08-27:** the "Payload Fields" column originally here (`sleepSession`, `stages`,
> `summary`, bare `rmssd`/`bpm` keys) did **not** match the real API response shape — this was a
> real inaccuracy, independent of the top-level counts (which are real). Replaced with field
> shapes confirmed live against the account, structure-only.

| Metric Stream | Provider | Origin Package | Real Payload Fields (confirmed live) |
|---|---|---|---|
| **Sleep** | `garmin` | `com.garmin.android.apps.connectmobile` | `sleep.interval.{startTime,endTime,startUtcOffset,endUtcOffset}`, `sleep.type`, `sleep.stages[]` (flat list of `{startTime,endTime,type,createTime,updateTime}`) |
| **Sleep** | `eight_sleep` | `com.eightsleep.eight` | same `sleep.interval`/`sleep.stages` shape as Garmin (not independently re-confirmed for this provider specifically — inferred from the shared data type schema) |
| **HRV (RMSSD)** | `eight_sleep` | `com.eightsleep.eight` | `dailyHeartRateVariability.{date:{year,month,day}, averageHeartRateVariabilityMilliseconds, deepSleepRootMeanSquareOfSuccessiveDifferencesMilliseconds}` |
| **Resting HR** | `garmin` | `com.garmin.android.apps.connectmobile` | `dailyRestingHeartRate.{date:{year,month,day}, beatsPerMinute}` — note `beatsPerMinute` is returned as a **string**, not a number |
| **Resting HR** | `eight_sleep` | `com.eightsleep.eight` | same shape as Garmin RHR (not independently re-confirmed for this provider specifically) |
| **Respiratory Rate** | `eight_sleep` | `com.eightsleep.eight` | **not confirmed live** — no respiration records appeared in the recent windows queried while investigating (see §12); field name unverified, treat the mapper's candidate field list as unconfirmed until a record is actually observed |

Raw points for all four data types carry **no flat `dataTypeName`/`dataType` field** — the type is
only recoverable from the point's `name` resource path (`users/{id}/dataTypes/{type}/dataPoints/{id}`).
The three daily-summary types (HRV/RHR/respiration) additionally carry **no `name` field at all**
in the raw `list` response (confirmed for RHR; consistent across the daily-summary family) — so
`dataPointId`/`id`/`name`-based `source_record_id` is `null` for these observations. This doesn't
break Firestore persistence (dedup happens at the whole-day-bundle content-hash level, not
per-observation-id — see `firestore_repository.save_health_observation_day_bundle`), but it does
mean per-observation audit traceability is weaker for these three types than for sleep. Not fixed;
flagged as a known limitation.

---

## 3. Production Safety Verification

- **Storage Isolation**: Ingested observations are stored under `users/{userId}/health_observation_days/{YYYY-MM-DD}_{provider}_{transport}`.
- **Engine Isolation**: Production recommendation engine remains untouched and reads from `daily_recovery_snapshots`.
- **Step Count Lock (`D-MS-STEPS` / `P9`)**: Aggregator step counts from Google Health are strictly filtered out to prevent double-counting structured workout strain.

---

## 4. Identity (runbook §6)

`GoogleHealthClient.get_identity()` succeeded live, returning `healthUserId`, `legacyUserId`, and
`name`. Not printed here (kept local per runbook §2's sensitivity guidance) — its only use is
mapping a future webhook notification back to this account, which is out of scope while MS9's
webhook subscriber stays undeployed.

## 5. Raw list vs. `:reconcile` (runbook §11)

Called `dataPoints:reconcile` for the `sleep` data type. Structural finding, independent of any
count comparison (the reconcile call in this check used a different, unscoped window than the raw
comparison, so point counts between the two aren't a fair apples-to-apples number — not reported
here for that reason): **reconciled points carry no `dataSource` object at all** — no package
name, no platform, no recording method. This confirms the runbook's assumption directly: reconcile
output cannot be used for source-aware recovery science (no way to attribute a reconciled point to
Garmin vs. Eight Sleep), and the codebase's existing choice to use raw `list` exclusively for
recovery-critical ingestion (MS5/MS6) is correct.

## 6. Duplicate / revision behavior (runbook §14)

Repeated the same `daily-resting-heart-rate` query twice: identical record count and identical
value set both times (stable, no revision drift observed in this short window). Sleep records
(which do carry a real `name`) showed 8 unique names for 8 points — no duplicates within a single
call. No multi-day resync was performed to test true revision/update behavior (would need a
device resync event to happen naturally, per the runbook's guidance not to manufacture one) —
this remains an open, lower-priority follow-up rather than a completed check.

## 7. Latency (runbook §12)

Approximated Garmin's Health-Connect-to-Google-Health-API sync latency using each sleep record's
stage `createTime` minus the sleep session's own `endTime`, for the 8 most recent real sleep
records: samples (minutes) were **1.0, 15.3, 18.3, 19.6, 40.3, 176.2, 288.5, 389.8** — mean ≈119
minutes, but with wide spread (roughly 1 minute to ~6.5 hours). This is a rough proxy (stage
`createTime` isn't necessarily the moment the API became queryable, just when Health Connect
recorded the stage), but the spread alone is a real, useful signal: **latency is not reliably fast
enough to assume same-morning availability for a recommendation** — a repair-sync/backfill lookback
window is necessary, not just a same-day poll. No Eight Sleep-side latency sample was available
(no recent Eight Sleep records in the windows queried — see §2's note on unconfirmed respiration).

## 8. Date/time semantics (runbook §13)

All sampled sleep records carried `startUtcOffset`/`endUtcOffset` of `7200s` (UTC+2), consistent
with `Europe/Warsaw` during CEST (summer). `derive_warsaw_logical_date()` correctly converted a
record ending `2026-08-27T04:07:44Z` (06:07 local) to logical date `2026-08-27`. DST-transition
behavior was **not** tested (no transition occurred in the sampled window) — per the runbook's own
guidance, this is deliberately left unverified until an actual transition is observed rather than
simulated.

## 9. Remaining open items

- Runbook §3 (Health Connect phone-side check: confirming Garmin/Eight Sleep appear as connected
  apps with the expected read/write permissions) — needs the project owner to check their Android
  device directly; not done.
- Respiration field shape (§2) — not confirmed live; no recent records appeared in the windows
  queried.
- True revision/duplicate behavior across a real device resync (§6) — not tested, deliberately not
  manufactured.
- MS17's CASA Tier 2 / Google Restricted Scope App Verification status — separately tracked as
  genuinely unconfirmed; see
  [`docs/plans/2026-08-27-real-google-health-ingestion.md`](../plans/2026-08-27-real-google-health-ingestion.md).
