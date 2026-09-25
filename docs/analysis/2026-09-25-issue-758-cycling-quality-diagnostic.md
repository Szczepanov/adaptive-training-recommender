# Issue #758: cycling quality baseline diagnostic

**Date:** 2026-09-25
**Cases:** `persona_cycling_hybrid_baseline` and `persona_cycling_hybrid_low_time` from `app/scripts/ai-judge/personaSuite.mjs`
**Method:** `app/src/engine/issue758CyclingQualityDiagnostic.test.mjs` reconstructs the original synthetic 680-minute history by restoring all eight cycling exposures to 60 minutes, and uses the original two-identity evergreen quality descriptor for candidate analysis. It then runs the current planner in the real two-week persona simulation. At each weekly planning date it reads the reconstructed history, strategy, and the actual six-day packing horizon (`options.days = 6`). The simulation separately records seven daily selections per week, including Sunday, which is outside that week's packing horizon. No live data or API is used. The historical inputs and pre-ranking gate evidence remain reproducible; planner and template behavior reflect the current build.

## Observed gates

| Case and week start | 28-day exposures | Inferred state | `high_intensity` strategy requirement | `hardSessionCap` | Packed `sustained_quality` | Cycling quality selected in 14 days |
|---|---:|---|---|---:|---:|---:|
| Baseline, Aug 31 | 12 sessions, 680 min | high-quality evidence; **developing** | absent; `conditional_prior_withheld` | absent | 0 | 0 |
| Baseline, Sep 7 | 16 sessions, 700 min | high-quality evidence; **developing** | absent; `conditional_prior_withheld` | absent | 0 | 0 |
| 35-min cap, Aug 31 | 12 sessions, 680 min | high-quality evidence; **developing** | absent; `conditional_prior_withheld` | absent | 0 | 0 |
| 35-min cap, Sep 7 | 16 sessions, 670 min | high-quality evidence; **developing** | absent; `conditional_prior_withheld` | absent | 0 | 0 |

`inferAthleteTrainingState` requires at least 12 sessions **and 720 minutes** in the observed 28 days for the `established` proxy. The persona has eight 60-minute rides and four 50-minute strength sessions, so it misses that duration condition by 40 minutes. Its two historical tempo rides are labeled `Cycling tempo endurance`; this classifier does not count them as `highIntensitySessions`, but that count is not the direct strategy gate. `resolveEvidenceBackedStrategy` consequently withholds its conditional optional quality requirement and the accompanying two-session hard cap. The packer receives no quality requirement and creates no quality occurrence in either week. Both simulation allocation reports have zero quality outcomes.

The reconstructed pre-change evergreen `sustained_quality` descriptor contains `cycling_controlled_threshold_4x8_01` (catalog minimum 45 min) and `running_tempo_01` (30 min). Its descriptor duration is 30 min because it uses the minimum across both sports. The existing `cycling_tempo_surges_01` has a 30-minute catalog minimum but was outside this descriptor. The persona prefers cycling and deprioritizes running.

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

The first blocker applies even in the 90–120-minute frozen case. Adding a 30-minute cycling workout to the descriptor alone would have left this 680-minute persona without the optional quality role. The current synthetic persona instead supplies 720 observed minutes while production qualification remains unchanged. The existing safety, spacing, and rolling-load gates still govern any role that is generated.

**Focused command:** `cd app && npx vitest run src/engine/issue758CyclingQualityDiagnostic.test.mjs --reporter=verbose` — 2 tests passed. The test prints the machine-readable per-day observations used for this table.

## Implemented safe scope

The evergreen optional `sustained_quality` set now includes the existing
`cycling_tempo_surges_01` identity. Its 30-minute authored easier dose may enter a
35-minute window, while `end_mod_02` keeps its 40-minute default for ordinary
recommendations and training-history accounting. The low-time persona now selects a
cap-fitting cycling quality session. The normal-recovery established-history case
still selects no quality because every observed feasible date in its active quality
block is occupied by a fulfilled required-role reservation; its allocation report
records `capacity_exhausted_by_required_roles`. Required aerobic/strength reservations
and all recovery, tissue, spacing, and rolling-load gates remain authoritative.

This implements the conservative GPT-6-Sol recommendation but leaves the issue's
baseline criterion of at least one quality session unresolved. Achieving that requires
a separate product choice to add session capacity or let an optional quality role
displace/report a required occurrence; this change makes neither choice.
