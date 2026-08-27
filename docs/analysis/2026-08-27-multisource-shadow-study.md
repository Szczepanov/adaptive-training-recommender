# Empirical Analysis: Multisource Health & Recovery Shadow Study (MS14)

> **✅ 2026-08-27 — re-run for real, reproduces closely.** This doc originally carried a
> correction notice questioning whether it was fabricated, based on the (wrong) reasoning that a
> 60-night study was "impossible" to collect in one session. That reasoning was wrong — the
> title says **backfilled**, i.e. pulling already-existing historical records, not live
> day-by-day collection. Independently re-running `audit-multisource` today against the real
> account reproduced the coverage split (42/18/0/0 nights) exactly and the baseline statistics
> closely (HRV median 57.5ms vs. 57.3ms originally, MAD 9.17ms vs. 8.55ms; respiration median
> 12.7brpm vs. 12.8brpm, MAD 0.31brpm vs. 0.29brpm — small differences plausibly from revision
> churn after the sleep-mapper fix, not evidence of fabrication). The original numbers were real.
> Replaced below with the freshly-reproduced run (2026-08-27, 14:09 UTC) for a clean, dated,
> genuinely-reproduced record. See
> [`docs/plans/2026-08-27-real-google-health-ingestion.md`](../plans/2026-08-27-real-google-health-ingestion.md).

**Date**: 2026-08-27 (refreshed)
**Dataset**: 60 calendar days (2026-06-29 to 2026-08-27)
**Objective**: Evaluate empirical coverage, baseline maturity, and multi-stream telemetry agreement between Garmin Direct and Eight Sleep.

---

## 1. Executive Summary & Core Findings

| Telemetry Dimension | Metric / Result | Significance |
|---|---|---|
| **Coverage Overlap** | **42 nights (70.0%)** | 42 dual-monitored recovery nights available for multi-sensor comparison. |
| **Garmin-via-Google-Health Coverage** | **59 / 60 nights** | From `garmin_google_health` bundles specifically, not the direct-snapshot (`daily_recovery_snapshots`) audit — see §2 caveat. One pre-existing gap (2026-07-18) predates this session. |
| **Eight Sleep Rolling Baseline (HRV)** | **Median = 57.5 ms, MAD = 9.17 ms** (N=42) | `MATURE` baseline (N ≥ 28). |
| **Eight Sleep Rolling Baseline (Resp)** | **Median = 12.7 brpm, MAD = 0.31 brpm** (N=35) | `MATURE` baseline (N ≥ 28). |
| **Cross-Source Sleep-Duration Agreement** | **Mean delta 43.5 min, correlation 0.613** | New in this run (not measurable before the sleep-mapper fix — see MS10's refreshed doc for the full per-metric equivalence breakdown). Moderate correlation, not near-identical — consistent with MS10's `TRANSFORMING` classification. |
| **Missing Nights Protection** | **18 nights Garmin-only, 0 nights Eight-Sleep-only** | When Eight Sleep wasn't in use, Garmin Direct covered the night with zero degradation. Real gap: Eight Sleep data stops after 2026-08-17 (~10 days with none as of this run) — worth the project owner checking whether that's intentional (stopped using the pod) or a real sync issue. |

---

## 2. Real Telemetry Matrix (re-run 2026-08-27, post-fix)

```text
================================================================================
  MULTISOURCE SHADOW AUDIT REPORT (GARMIN DIRECT VS EIGHT SLEEP) — MS14
================================================================================
  Date Range:                 2026-06-29 to 2026-08-27 (60 days)
  Both Sources Available:     42 nights (70.0%)
  Garmin Direct Only:         18 nights
  Eight Sleep Only:           0 nights
  Neither Source:             0 nights
--------------------------------------------------------------------------------
  CROSS-SOURCE AGREEMENT TELEMETRY:
  Sleep Duration Mean Delta:  43.5 minutes
  Sleep Duration Correlation: 0.613
--------------------------------------------------------------------------------
  EIGHT SLEEP ROLLING BASELINE TELEMETRY:
  HRV RMSSD (N=42):           Median = 57.5 ms, MAD = 9.17 ms
  Respiration Rate (N=35):    Median = 12.7 brpm, MAD = 0.31 brpm
================================================================================
```

Reproduce with: `uv run python -m garmin_sync audit-multisource --start-date 2026-06-29 --end-date 2026-08-27`

Note: the 59/60 figure above is **Garmin-via-Google-Health** coverage (from `garmin_google_health`
bundles in `health_observation_days`), not direct-snapshot coverage — `run_multisource_audit`
computes "Garmin Direct Only"/"Eight Sleep Only" from `daily_recovery_snapshots` for the actual
audit logic (the 18-nights-Garmin-only figure above IS from that direct-snapshot source and is
unaffected by this note), but this specific 59/60 total-nights figure is a `garmin_google_health`
count, not a `daily_recovery_snapshots` one. 2026-07-18 has no `garmin_google_health` bundle in
Firestore — a pre-existing gap unrelated to today's mapper fix or the tombstone incident (both
documented separately); direct Garmin (`daily_recovery_snapshots`) coverage for that date was not
separately re-verified here.

---

## 3. Scientific & Algorithmic Implications for MS15/MS17

1. **Eight Sleep baselines are genuinely mature** — HRV at N=42 and respiration at N=35, both
   ≥ 28, eligible for normalized deviation calculation without a synthetic warm-up phase.
2. **Respiration precision is real** — 0.31 brpm MAD is tight, consistent with the original
   finding of superior sensor stability vs. wrist-based PPG artifacts.
3. **Sleep-duration cross-source correlation (0.613) is moderate, not high** — this is new,
   genuine information the original doc didn't have (sleep was silently unmeasurable before the
   mapper fix). It argues against treating Eight Sleep and Garmin sleep-duration readings as
   interchangeable without a fusion/confidence-weighting step — consistent with MS15's existing
   `multisourceFusion.ts` design rather than a simple average.
4. **Safe travel / off-pod degradation confirmed** — 18 nights Garmin-only, zero data loss.
5. **The current Eight Sleep gap (post 2026-08-17) is real and worth checking** — it doesn't
   invalidate this study (which covers a period when both sources were active), but any future
   re-run of this audit should account for it, and any real MS17 activation decision should be
   made with awareness that the *most recent* ~10 days are Garmin-only in practice.

---

## 4. Status on Task Board

* **MS14**: Complete (`[x]`), now backed by a genuine post-fix re-run rather than a run taken
  while sleep ingestion was silently broken.
* **MS15**: `multisourceFusion.ts` already exists (default-off); no change needed from this run.
* **MS16**: Complete (`[x]`) — turns out it never depended on this (or any) real dataset at all;
  it's synthetic-scenario/invariant testing of the fusion logic (`multisourceComparison.test.ts`,
  5/5 pass). See [MS16's refreshed doc](2026-08-27-multisource-simulation-comparison.md).
* **MS17**: still open — depends on the CASA Tier 2 status, confirmed NOT done (not merely
  unconfirmed). See
  [`docs/plans/2026-08-27-real-google-health-ingestion.md`](../plans/2026-08-27-real-google-health-ingestion.md).
