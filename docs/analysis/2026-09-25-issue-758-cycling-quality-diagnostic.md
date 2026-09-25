# Issue #758: cycling quality baseline diagnostic

**Date:** 2026-09-25
**Cases:** `persona_cycling_hybrid_baseline` and `persona_cycling_hybrid_low_time` from `app/scripts/ai-judge/personaSuite.mjs`
**Method:** `app/src/engine/issue758CyclingQualityDiagnostic.test.mjs` runs the real two-week persona simulation. At each weekly planning date it reads the same synthetic history, strategy, exact evergreen packing descriptor, and the actual six-day packing horizon (`options.days = 6`). The simulation separately records seven daily selections per week, including Sunday, which is outside that week's packing horizon. No live data or API is used. This records behavior before issue #758's proposed policy/catalog change.

## Observed gates

| Case and week start | 28-day exposures | Inferred state | `high_intensity` strategy requirement | `hardSessionCap` | Packed `sustained_quality` | Cycling quality selected in 14 days |
|---|---:|---|---|---:|---:|---:|
| Baseline, Aug 31 | 12 sessions, 680 min | high-quality evidence; **developing** | absent; `conditional_prior_withheld` | absent | 0 | 0 |
| Baseline, Sep 7 | 16 sessions, 700 min | high-quality evidence; **developing** | absent; `conditional_prior_withheld` | absent | 0 | 0 |
| 35-min cap, Aug 31 | 12 sessions, 680 min | high-quality evidence; **developing** | absent; `conditional_prior_withheld` | absent | 0 | 0 |
| 35-min cap, Sep 7 | 16 sessions, 670 min | high-quality evidence; **developing** | absent; `conditional_prior_withheld` | absent | 0 | 0 |

`inferAthleteTrainingState` requires at least 12 sessions **and 720 minutes** in the observed 28 days for the `established` proxy. The persona has eight 60-minute rides and four 50-minute strength sessions, so it misses that duration condition by 40 minutes. Its two historical tempo rides are labeled `Cycling tempo endurance`; this classifier does not count them as `highIntensitySessions`, but that count is not the direct strategy gate. `resolveEvidenceBackedStrategy` consequently withholds its conditional optional quality requirement and the accompanying two-session hard cap. The packer receives no quality requirement and creates no quality occurrence in either week. Both simulation allocation reports have zero quality outcomes.

The evergreen `sustained_quality` descriptor currently contains `cycling_controlled_threshold_4x8_01` (catalog minimum 45 min) and `running_tempo_01` (30 min). Its descriptor duration is 30 min because it uses the minimum across both sports. The existing `cycling_tempo_surges_01` has a 30-minute catalog minimum but is outside this descriptor. The persona prefers cycling and deprioritizes running.

## Daily candidate matrix

The rows cover the **12 actual packed windows** (Monday through Saturday of each simulation week). The letters describe *pre-ranking* reasons obtained from strategy, exact role membership, packing, and the catalog minimum against the resolved daily window. `P` = conditional quality prior withheld; `N` = no `sustained_quality` occurrence packed for that date; `T` = workout minimum exceeds that day's window; `D` = workout is outside the evergreen quality descriptor. They do not assert that a fitting workout was rejected by a later optimizer gate; the current forecast does not expose candidate-specific rejection reasons for all future days.

| Date | Baseline window | Baseline threshold 45 / running tempo 30 / cycling tempo 30 | Capped window | Capped threshold 45 / running tempo 30 / cycling tempo 30 |
|---|---:|---|---:|---|
| 2026-08-31 | 90 | PN / PN / DPN | 35 | PNT / PN / DPN |
| 2026-09-01 | 90 | PN / PN / DPN | 35 | PNT / PN / DPN |
| 2026-09-02 | 90 | PN / PN / DPN | 35 | PNT / PN / DPN |
| 2026-09-03 | 90 | PN / PN / DPN | 35 | PNT / PN / DPN |
| 2026-09-04 | 90 | PN / PN / DPN | 35 | PNT / PN / DPN |
| 2026-09-05 | 120 | PN / PN / DPN | 35 | PNT / PN / DPN |
| 2026-09-07 | 90 | PN / PN / DPN | 35 | PNT / PN / DPN |
| 2026-09-08 | 90 | PN / PN / DPN | 35 | PNT / PN / DPN |
| 2026-09-09 | 90 | PN / PN / DPN | 35 | PNT / PN / DPN |
| 2026-09-10 | 90 | PN / PN / DPN | 35 | PNT / PN / DPN |
| 2026-09-11 | 90 | PN / PN / DPN | 35 | PNT / PN / DPN |
| 2026-09-12 | 120 | PN / PN / DPN | 35 | PNT / PN / DPN |

The simulation's separate daily trace also contains Sunday selections. Those dates were **not** passed to the week's packer, so no `N` reason or packing window is inferred for them:

| Date | Baseline actual selection | 35-min actual selection |
|---|---|---|
| 2026-09-06 | `str_upper_01` | `str_full_02` |
| 2026-09-13 | `end_easy_01` | `end_easy_01` |

The first blocker applies even in the 90–120-minute case. Adding a 30-minute cycling workout to the descriptor alone would leave this persona without the optional quality role. A policy/fixture decision is therefore needed alongside the catalog change. The existing safety, spacing, and rolling-load gates still need verification once a role is actually generated.

**Focused command:** `cd app && npx vitest run src/engine/issue758CyclingQualityDiagnostic.test.mjs --reporter=verbose` — 2 tests passed. The test prints the machine-readable per-day observations used for this table.
