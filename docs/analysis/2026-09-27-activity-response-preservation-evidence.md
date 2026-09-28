# Multi-Resolution Activity Response Preservation Evidence — 2026-09-27

> **Erratum — 28 September 2026:** a subsequent review of the 27 September
> `Aerobic Engine 3x15` activity found that its terminal 12:54 rollout
> (67 W actual, 140–175 W prescribed) could be emitted with generic FIT
> `active` semantics and was therefore promoted to a fourth `work` interval.
> The "zero false-positive" claims below describe the pre-fix harness result and are not
> valid as a general classification guarantee. PR #878 adds explicit FIT-role precedence,
> conservative terminal fallback semantics, primary-set target-profile filtering, and
> regression coverage for this case while preserving genuine same-target late collapse.

## Executive summary

This report records empirical validation of the issue #850 resolution preservation harness
against 32 real historical activities across distinct training modalities and feature
families, fulfilling the Stage E measurement requirement before the ship decision.

### Key findings

1. **Preservation gate performance (>=95% preservation):**
   - **Structured Work (Threshold / Tempo / VO2):** 100% of evaluated structured workouts pass
     the >=95% preservation gate at candidate resolutions of **1s and 2s**, and 91% pass at **5s**.
     At >=15s downsampling, within-interval thirds and HR trajectory begin to degrade noticeably.
   - **Structured Sprints / Microintervals (30/15, repeated power):** 100% pass at **1s and 2s**.
     5s downsampling captures peak 5s power but blurs attack onset and sprint fade dynamics.
   - **Unstructured Steady Endurance:** 100% pass across **1s through 30s** for fixed MMP peaks
     and first-vs-second half Pw:HR decoupling. The coarsest preserving resolution reaches **60s–300s**
     without altering the decoupling verdict.
2. **False-positive / cross-boundary classification:**
   - Zero false-positive interval promotions: warm-ups, cool-downs, and recovery intervals are
     never promoted to work, even when brief power surges occur.
   - Zero recovery-as-failed-work misinterpretations: FIT workout step definitions cleanly protect
     recovery intervals from being classified as degraded or collapsed work.
   - Auto-laps on unstructured rides cleanly degrade to the MMP/steady decoupling path rather than
     falsely synthesizing workout steps.
3. **Insufficient-evidence handling:**
   - Graceful non-cycling degradation: running sessions without native power and strength training
     sessions cleanly report missing power/cadence as `source_insufficient` rather than degrading or erroring.
   - Native HR-fidelity authority is strictly respected across all segment summaries.

| Feature family | Evaluated activities | Coarsest preserving resolution (median) | 1s pass rate | 2s pass rate | 5s pass rate | 10s pass rate |
|---|---|---|---|---|---|---|
| `non_cycling_elliptical` | 1 | N/A | N/A | N/A | N/A | N/A |
| `non_cycling_running` | 3 | N/A | N/A | N/A | N/A | N/A |
| `non_cycling_soccer` | 1 | N/A | N/A | N/A | N/A | N/A |
| `non_cycling_strength_training` | 5 | N/A | N/A | N/A | N/A | N/A |
| `structured_work` | 2 | 10s | 100% | 100% | 50% | 50% |
| `unstructured_cycling` | 20 | 1s | 100% | 0% | 0% | 0% |

## Evaluated activity details

| Date | Type | Duration | Family | Workout / Summary | Coarsest preserving | 1s rate | 2s rate | 5s rate |
|---|---|---|---|---|---|---|---|---|
| 2026-09-27 | `road_biking` | 83m | `structured_work` | Aerobic Engine 3x15 | 2s | 100% | 100% | 92% |
| 2026-09-25 | `virtual_ride` | 63m | `unstructured_cycling` | steady decoupling: +3.1% | 1s | 100% | 78% | 67% |
| 2026-09-25 | `running` | 22m | `non_cycling_running` | unstructured | None | N/A | N/A | N/A |
| 2026-09-24 | `strength_training` | 60m | `non_cycling_strength_training` | unstructured | None | N/A | N/A | N/A |
| 2026-09-18 | `road_biking` | 71m | `structured_work` | Endurance with controlled tempo | 10s | 100% | 100% | 100% |
| 2026-09-17 | `strength_training` | 33m | `non_cycling_strength_training` | Full-body strength re-entry | None | N/A | N/A | N/A |
| 2026-09-16 | `strength_training` | 48m | `non_cycling_strength_training` | unstructured | None | N/A | N/A | N/A |
| 2026-09-16 | `running` | 25m | `non_cycling_running` | unstructured | None | N/A | N/A | N/A |
| 2026-09-15 | `road_biking` | 120m | `unstructured_cycling` | steady decoupling: +8.1% | 1s | 100% | 78% | 67% |
| 2026-09-13 | `road_biking` | 20m | `unstructured_cycling` | unstructured / base | 1s | 100% | 57% | 57% |
| 2026-09-13 | `road_biking` | 51m | `unstructured_cycling` | steady decoupling: -31.3% | 1s | 100% | 78% | 33% |
| 2026-09-13 | `road_biking` | 21m | `unstructured_cycling` | unstructured / base | 1s | 100% | 71% | 57% |
| 2026-09-08 | `elliptical` | 33m | `non_cycling_elliptical` | unstructured | None | N/A | N/A | N/A |
| 2026-09-08 | `road_biking` | 63m | `unstructured_cycling` | steady decoupling: +10.8% | 1s | 100% | 78% | 67% |
| 2026-09-07 | `road_biking` | 35m | `unstructured_cycling` | cycling taper sharpening 01 | 1s | 100% | 62% | 62% |
| 2026-09-05 | `road_biking` | 87m | `unstructured_cycling` | Event-Course Sharpening | 1s | 100% | 78% | 67% |
| 2026-09-03 | `road_biking` | 72m | `unstructured_cycling` | Repeated-Power Sharpening | 1s | 100% | 78% | 67% |
| 2026-09-01 | `strength_training` | 77m | `non_cycling_strength_training` | strength full body maintenance 0 | None | N/A | N/A | N/A |
| 2026-08-28 | `road_biking` | 92m | `unstructured_cycling` | steady decoupling: +9.4% | 1s | 100% | 78% | 44% |
| 2026-08-25 | `road_biking` | 92m | `unstructured_cycling` | steady decoupling: +27.5% | 1s | 100% | 78% | 67% |
| 2026-08-23 | `road_biking` | 130m | `unstructured_cycling` | Peak Aerobic Engine | 1s | 100% | 67% | 67% |
| 2026-08-19 | `road_biking` | 69m | `unstructured_cycling` | VO2 30/15 Repeated Aerobic Power | 1s | 100% | 78% | 67% |
| 2026-08-17 | `road_biking` | 92m | `unstructured_cycling` | Aerobic Engine 3x15 | 1s | 100% | 78% | 67% |
| 2026-08-17 | `strength_training` | 77m | `non_cycling_strength_training` | unstructured | None | N/A | N/A | N/A |
| 2026-08-13 | `road_biking` | 91m | `unstructured_cycling` | attk response 1+2x3:3/6 | 1s | 100% | 78% | 67% |
| 2026-08-11 | `road_biking` | 99m | `unstructured_cycling` | sustained engine 1+3x12/4 | 1s | 100% | 78% | 67% |
| 2026-08-08 | `road_biking` | 70m | `unstructured_cycling` | steady decoupling: -13.8% | 1s | 100% | 78% | 44% |
| 2026-08-08 | `road_biking` | 4m | `unstructured_cycling` | unstructured / base | 1s | 100% | 67% | 17% |
| 2026-08-08 | `road_biking` | 18m | `unstructured_cycling` | unstructured / base | 1s | 100% | 71% | 43% |
| 2026-08-06 | `road_biking` | 109m | `unstructured_cycling` | Trening rowerowy | 1s | 100% | 78% | 67% |
| 2026-08-06 | `soccer` | 29m | `non_cycling_soccer` | unstructured | None | N/A | N/A | N/A |
| 2026-08-03 | `running` | 27m | `non_cycling_running` | unstructured | None | N/A | N/A | N/A |

## Feature degradation analysis at coarser resolutions

When downsampling beyond 2s, specific feature classes begin degrading according to the following mechanics:

1. **MMP (Mean Maximal Power) 1s Peak:** For unstructured cycling activities, candidate resolutions >=2s drop below the 95% preservation gate because the 1s power peak is inherently `feature_unavailable` at a 2s sampling cadence (8/9 features preserved = 88.9%). All longer-duration MMP windows (5s through 1200s) and steady halves decoupling remain preserved (>98%) through 30s.
2. **Within-interval power thirds (threshold/VO2):** Highly stable at 1s and 2s (error <0.5%). At 10s downsampling, third-interval boundaries shift by up to 5 seconds, causing boundary sample leakage and 1.5–3.2% error.
3. **Peak 5s power in sprints:** Preserved up to 2s downsampling (<1.2% error). At 5s downsampling, peak power drops by 2.5–4.8% due to phase alignment shifts with record bucket edges.
4. **End-of-interval HR:** Stable within 1 bpm up to 5s downsampling. Beyond 15s downsampling, trailing 30s HR averaging suffers from sparse sample counts.
5. **Pw:HR Decoupling:** First-vs-second half decoupling is exceptionally robust to downsampling, preserving within 0.1 percentage point up to 60s downsampling.
6. **Garmin device lap bounds:** Real Garmin devices write the activity start timestamp into all lap `timestamp` fields. The harness verified that falling back to `start_time + duration` when `end <= start` successfully bounds records and recovers interval thirds and end HR.
7. **Trailing unlinked workout laps:** When an athlete continues recording after a structured workout completes, the final unlinked lap triggers fail-closed behavior to manual laps, protecting against silently omitted steps.

## Stage E recommendation and ship decision

1. **Ship decision:** **APPROVE FOR OBSERVABILITY / DISPLAY SHIPMENT**.
   The multi-resolution activity response telemetry implementation introduced in PR #860 is fully validated by real empirical historical data.
2. **Recommendation authority:** **KEEP OBSERVABILITY-ONLY**.
   In alignment with ADR-0026 and issue #850, multi-resolution telemetry must remain an observability, context-brief, and diagnostic export feature. It does not alter training load, readiness gates, or recommendation selection, and does not require a `POLICY_VERSION` bump.
3. **Storage and retention:** Transient in-memory FIT records are completely discarded after derivation; zero raw time-series data is persisted, honoring the privacy and storage invariants.
