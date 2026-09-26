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

The first issue #758 change added the existing `cycling_tempo_surges_01` identity to the
optional `sustained_quality` set, giving the 35-minute persona a real cycling quality
candidate. The remaining baseline failure was capacity: the full easy-aerobic requirement
could consume the forecast dates before optional quality reached daily selection.

PR #835 resolves that capacity conflict without weakening the evidence contract:

- `resolveEvidenceBackedStrategy` keeps the WHO-backed aerobic requirement at its full
  150-minute minimum. Quality is never pre-credited into strategy provenance.
- `packWeeklyDose` may provisionally substitute up to one aerobic-volume reservation while
  it attempts to place an eligible high-intensity occurrence. The credited minute value
  follows that aerobic role's current packed dose, including the athlete-relative floor from
  #757, but is bounded so at least one full aerobic occurrence remains. This is an explicit
  product heuristic with ADR-0033 lineage, not a physiological equivalence claim.
- The substitution becomes effective only when quality is actually packed. If quality
  cannot be packed, the packer reruns against the full aerobic requirement; warning logic
  uses the same single reservation credit and cannot subtract it twice.
- The normal-recovery cycling-primary baseline now has capacity for cycling quality over
  the 14-day acceptance window. The 35-minute case retains its authored cap-fitting
  cycling tempo dose. Adverse-recovery and local-tissue-conflict cases remain quality-free.
- Freeing that capacity exposed that the local-tissue-conflict case had been quality-free
  only because no slot was left, not because a gate withheld quality. The generic
  conditional quality prior is now also withheld explicitly while the planning-day
  check-in reports current pain/injury, illness or red-flag symptoms
  (`hasCurrentClinicalSymptoms`), so symptom suppression no longer depends on packing
  arithmetic.
- Event-model `Base`/`Build` labels are deliberately **not** treated as mesocycle
  `develop`/`maintain` authority. ADR-0037 owns objective-level block intent, and the
  event-proximity phase can span training blocks with different purposes. The generic
  quality prior is only additionally suppressed for explicit `Post-Event Recovery`.

This keeps issue #758 narrow: it creates a safe capacity substitution for an already
eligible exact quality role rather than inventing a second mesocycle-intent authority.
