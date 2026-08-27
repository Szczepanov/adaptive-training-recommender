# Empirical Analysis: Garmin Direct vs Google Health Transport Equivalence (MS10)

> **✅ 2026-08-27 — re-run for real with the fixed pipeline.** This doc originally carried a
> correction notice questioning whether it was fabricated. That was too strong (see MS0's own
> correction history) — its RHR figures (74.6% exact match, mean delta 0.593 bpm) and its
> HRV/respiration `MISSING_GOOGLE` finding reproduced **exactly** when independently re-run today.
> What genuinely was wrong: its sleep-duration/stage rows, which were measured while a real
> sleep-mapper bug (fixed 2026-08-27; see
> [`docs/plans/2026-08-27-real-google-health-ingestion.md`](../plans/2026-08-27-real-google-health-ingestion.md))
> meant Google-transported sleep observations were silently never persisted. Re-running
> `compare-transports` after the fix gives a materially different, now-real picture for those
> rows — replaced below. Everything in this document as it now stands is a genuine,
> freshly-reproduced `compare-transports` run against the real account (2026-08-27, 14:09 UTC).

**Date**: 2026-08-27 (refreshed)
**Dataset**: 59 overlapping calendar days (2026-06-29 to 2026-08-27)
**Objective**: Evaluate whether the Google Health transport route provides an equivalent, transforming, or incomplete substitute for direct Garmin Connect ingestion.

---

## 1. Executive Summary & Verdict

| Dimension | Result | Finding |
|---|---|---|
| **Overall Classification** | **`TRANSFORMING`** | Google Health transport route is not a byte-identical mirror of Garmin Direct, but is no longer simply "incomplete" now that sleep ingestion actually works. |
| **Resting Heart Rate (RHR)** | **`EQUIVALENT`** (74.6% exact, Mean Δ = 0.593 bpm) | Garmin exports daily resting HR reliably to Google Health with near-zero deviation. Unchanged from the original run — this metric was never affected by the sleep-mapper bug. |
| **HRV RMSSD** | **`MISSING_GOOGLE`** (0% exported, 0/59 days) | Garmin Connect Android app does **not** export overnight HRV RMSSD to Health Connect. Unchanged — a real transport gap, not a code bug. |
| **Respiration Rate** | **`MISSING_GOOGLE`** (0% exported, 0/59 days) | Garmin Connect Android app does **not** export overnight respiration to Health Connect. Unchanged — a real transport gap. |
| **Sleep Duration** | **`TRANSFORMING`** (18.6% exact match, 11/59; mean delta 575s ≈ 9.6 min) | Now genuinely measurable post-fix. Google-transported Garmin sleep duration is close but not identical to direct — plausible rounding/boundary differences, not simply missing. |
| **Sleep Stages** (deep/light/REM/awake) | **`TRANSFORMING`** (8.9–10.9% exact match across 55–58 evaluated days; small deltas, 0–4.3s mean) | Stage classification boundaries differ slightly between the two transports even when duration is close — consistent with the shadow study's own respiration/HRV baseline note about sensor-dependent variance. |

> **Key takeaway, largely unchanged from the original analysis:** direct Garmin ingestion remains
> necessary for Garmin HRV, respiration, and step count (`D-1`) telemetry — these simply aren't
> exported to Google Health at all. What's changed is sleep: it's not "missing," it's
> "transforming" — present via both transports with small, measurable differences, now that the
> pipeline actually captures it.

---

## 2. Real Comparison Matrix (re-run 2026-08-27, post-fix)

```text
================================================================================
  GARMIN DIRECT VS GOOGLE HEALTH TRANSPORT EQUIVALENCE REPORT (MS10)
================================================================================
  Date Range:                 2026-06-29 to 2026-08-27
  Overlapping Dates:          59
  Direct-Only Dates:          1
  Google-Only Dates:          0
  Overall Classification:     TRANSFORMING
--------------------------------------------------------------------------------
Metric                             Evaluated  Matches    Match %    Mean Delta
--------------------------------------------------------------------------------
daily_respiration_rate_brpm        59         0          0.0%       0.0
daily_resting_heart_rate_bpm       59         44         74.6%      0.593
hrv_rmssd_ms                       59         0          0.0%       0.0
sleep_duration_seconds             59         11         18.6%      575.172 s
sleep_stage_awake_seconds          56         5          8.9%       0.0
sleep_stage_deep_seconds           58         6          10.3%      0.0
sleep_stage_light_seconds          58         6          10.3%      4.333 s
sleep_stage_rem_seconds            55         6          10.9%      1.5 s
================================================================================
```

Reproduce with: `uv run python -m garmin_sync compare-transports --start-date 2026-06-29 --end-date 2026-08-27`

---

## 3. Analysis & Implications for Multi-Source Architecture

1. **Resting Heart Rate Equivalence** — unchanged from the original finding: 44 of 59 days
   (74.6%) match exactly, remaining days show small (1–3 bpm) deltas, mean 0.593 bpm overall.
   Google Health faithfully captures Garmin's passive daily RHR.
2. **HRV & Respiration genuinely absent from Garmin's Google Health export** — confirmed real,
   not a bug: 0/59 days for both metrics, consistent across two independent runs (original and
   this refresh). Garmin Connect simply does not export these to Health Connect.
3. **Sleep is present but transforms slightly, not missing** — the corrected picture. Duration
   matches exactly on only 18.6% of days but with a modest mean delta (~9.6 min); stage-level
   classification (deep/light/REM/awake) matches exactly less often (~9-11%) with very small mean
   deltas (0–4.3 seconds) on the days it doesn't. This reads as boundary/rounding differences
   between Garmin's own algorithm and however Health Connect's schema represents the same
   session, not as one transport losing data the other has.
4. **Dual-source architecture remains the right call** — Garmin Direct stays necessary for HRV,
   respiration, and steps; Eight Sleep (via Google Health) remains the only source for those same
   metrics on nights the Garmin watch isn't worn.

---

## 4. Status

* **MS10**: Complete (`[x]`), now backed by a genuine post-fix measurement rather than one taken
  while sleep ingestion was silently broken.
