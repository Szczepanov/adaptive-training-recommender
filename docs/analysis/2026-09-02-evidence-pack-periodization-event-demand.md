# Evidence Pack 6 — Periodization Objectives & Sport/Event Demand (SKR3 W1)

**Date:** 2026-09-02
**Status:** Implemented
**Plan:** [`2026-09-02-skr3-completion-plan.md`](../plans/2026-09-02-skr3-completion-plan.md) — workstream W1
**Policy version impact:** none — behavior-preserving; no guarded decision file changed executably

## 1. Scope

Five families from the SKR3 completion plan's W1:

| Family | Before | After |
|---|---|---|
| `periodization.phase_boundaries_scales` | uncovered / P1 | partial / P1 |
| `periodization.objective_thresholds` | uncovered / P1 | partial / P1 |
| `periodization.multi_event_contribution` | uncovered / P2 | partial / P2 |
| `event.demand_presets` | uncovered / P1 (`scientific_claim`) | partial / P1 (`product_heuristic`) |
| `spacing.pre_event_restrictions` | partial / P1 (product claim only, from W0) | partial / P1 (+ scientific boundary) |

Per the SKR3 method, each atomic claim was drafted from the exact current product rule **before**
evidence was searched.

## 2. Scope correction found during implementation

The completion plan put all five families in the "needs external evidence review" bucket. Reading
the code closely showed that is wrong for two of them:

- **`periodization.objective_thresholds`** gates weekly objectives on the app's *own* normalized
  0–1 demand scale (`periodization.ts:objectivesFromDemand`). No external study can validate a cut
  point on a scale the product invented. There is nothing meaningful to search for until the
  threshold is calibrated against product/athlete outcomes.
- **`periodization.multi_event_contribution`** is deterministic conflict-resolution scheduling
  (`periodization.ts:resolveMultiEventObjectives`): a 35-day contribution window, delegation of
  each contributor's taper to `taperPolicy.ts:resolveEventTaper`, drop-if-inadmissible during the
  governing event's taper, and merge-by-max with modality-qualifier union. That is software design
  for reconciling concurrent goals, not physiology.

Both therefore received **product-policy claims only, with no scientific claim attached** — the
W2 treatment, applied inside this pack because the families sit in the same domain and the same
coverage rows were already being edited. Forcing a literature search on them would have produced
either nothing or a padded adjacent citation.

## 3. Evidence reviewed

### 3.1 Periodization organization

The first draft over-weighted the positive block-periodization literature. A deeper review found
that the correct scientific boundary is **mixed evidence / no established universal winner**, not
"block periodization is superior."

- **Mølmen KS, Øfsteng SJ, Rønnestad BR.** *Block periodization of endurance training – a
  systematic review and meta-analysis.* Open Access J Sports Med. 2019;10:145-160.
  doi:10.2147/OAJSM.S180408. PMID:31802956. The pooled analysis favored block periodization for
  VO2max (SMD 0.40) and maximal aerobic power (SMD 0.28) and some threshold/workload outcomes, but
  the authors explicitly describe the evidence base as small and generally low methodological
  quality.
- **Galán-Rioja MÁ, Gonzalez-Ravé JM, González-Mohíno F, Seiler S.** *Training Periodization,
  Intensity Distribution, and Volume in Trained Cyclists: A Systematic Review.* Int J Sports
  Physiol Perform. 2023;18(2):112-122. doi:10.1123/ijspp.2022-0302. PMID:36640771. Seven
  periodization studies met inclusion criteria. Both block and traditional approaches improved
  performance-related outcomes; the review concludes there is currently **no evidence favoring a
  specific periodization model over 8–12 weeks in trained road cyclists**. Seasonal comparative
  evidence remains sparse.
- **Almquist NW et al.** *No Differences Between 12 Weeks of Block- vs.
  Traditional-Periodized Training in Performance Adaptations in Trained Cyclists.* Front Physiol.
  2022;13:837634. doi:10.3389/fphys.2022.837634. PMID:35299664. PMCID:PMC8921659. Participants were
  pair-matched by 40-min time-trial power and sex, then randomly assigned to load-matched block or
  best-practice traditional periodization. Both groups improved 5- and 40-min TT power and related
  performance measures, with no between-group performance advantage after 12 weeks; some
  hematological/capillary adaptations differed.
- **Issurin VB.** *New Horizons for the Methodology and Physiology of Training Periodization.*
  Sports Med. 2010;40(3):189-206. doi:10.2165/11319770-000000000-00000. PMID:20199119. The
  conceptual framework for concentrated, sequential block development. Registered as
  `expert_practice`, not `systematic_review` — it is a theoretical/narrative review, not an
  effect-size synthesis.

**Revised claim:** `performance.periodization.block_structured_progression` — intervention,
`emerging`, certainty **low**, conditional. Concentrated block organization is a viable tool and
has favorable evidence in some studies, but cyclist-specific 8–12-week evidence does not establish
consistent superiority over progressively loaded traditional organization. The registry therefore
records optionality, not a uniquely optimal sequence.

This also matches the athlete-authored macrocycle/mesocycle design principle: cycling research does
not establish one universally superior periodization model, so short testable blocks with explicit
exit gates are preferable to treating one structure as doctrine.

### 3.2 Event-demand characterization

- **Joyner MJ, Coyle EF.** *Endurance exercise performance: the physiology of champions.*
  J Physiol. 2008;586(Pt 1):35-44. doi:10.1113/jphysiol.2007.143834. PMID:17901124.
  PMCID:PMC2375555. VO2max, fractional/sustainable intensity and economy interact to determine
  endurance performance, with substrate availability and fatigue becoming progressively more
  important as duration increases.
- **Sanders D, van Erp T.** *The Physical Demands and Power Profile of Professional Men's Cycling
  Races: An Updated Review.* Int J Sports Physiol Perform. 2021;16(1):3-12.
  doi:10.1123/IJSPP.2020-0508. PMID:33271501. Stage/race morphology materially changes intensity,
  load and power-duration profile: more elevation is associated with more longer-duration power,
  while flat and semimountainous stages show higher maximal mean power over shorter durations; a
  single-day race also tends to carry higher daily intensity/load than a stage in a multiday race.
- **Ebert TR, Martin DT, Stephens B, Withers RT.** *Power output during a professional men's
  road-cycling tour.* Int J Sports Physiol Perform. 2006;1(4):324-335.
  doi:10.1123/ijspp.1.4.324. PMID:19124890. Direct SRM field data from 207 races over six
  competition years in 31 national-level male road cyclists. Criteriums had the highest mean
  power, variability and percentage of race time above 7.5 W/kg, with about 70 sprints above
  maximal aerobic power versus about 40 in hilly and 20 in flat races; most lasted 6–10 s.
- **Sharma AP, Périard JD.** *Physiological Requirements of the Different Distances of Triathlon.*
  In: Migliorini S, ed. Triathlon Medicine. Springer; 2020:5-17. doi:10.1007/978-3-030-22357-1_2.
  Distance-dependent demand shift across sprint→Ironman.

**Important source correction:** Sanders & van Erp was initially summarized as directly supporting
"time trial versus criterium" demand. Its published abstract supports differences by stage type,
elevation and single-day versus multiday racing, not that specific TT/criterium contrast. The
registry now uses the source only for what it actually reports and adds Ebert et al. as direct
criterium/flat/hilly field evidence. The product's TT preset remains product-authored calibration.

**Claim:** `performance.event_demand.duration_intensity_limiter_shift` — descriptive, maturity
`established`, certainty **moderate**, conditional.

### 3.3 What the evidence does *not* support

Recorded as claim limitations, not omitted:

- no source validates the 35/84-day phase boundaries, the 0.6/0.3 demand-blend weights, or the
  1.1/0.9, 1.0/0.8, 1.0/1.1 volume/intensity scalars;
- comparative periodization evidence does not establish one universally superior organization;
- no source validates any individual axis value of any authored event preset;
- broad race-morphology evidence does not derive the exact time-trial/criterium vectors used by the
  product;
- the `strength_meet` and `general_target` presets have **no** cited endurance-event-demand
  literature behind them;
- cycling race-morphology evidence is mainly observational field data/review synthesis, appropriate
  for characterization but not a randomized causal estimate;
- no literature was identified establishing the app's exact per-session-type pre-competition
  blocking windows, so `spacing.pre_event_restrictions` links the existing pre-event taper
  boundary only as general support for reducing load before competition — it validates none of the
  1-3/1-2/3-7-day counts.

## 4. Product-policy claims registered

Four, all `claimType: 'heuristic'`, `evidenceCertainty: 'not_applicable'`, sourced to
`PRODUCT-PERIODIZATION-EVENT-DEMAND-POLICY-V1`:

- `policy.periodization.phase_boundaries_scales_v1`
- `policy.periodization.objective_thresholds_v1`
- `policy.periodization.multi_event_contribution_v1`
- `policy.event_demand.presets_v1`

The event-demand product-policy source records **19 authored preset vectors**. Those vectors are
product calibration; menu aliases may resolve multiple user-facing values to the same authored
vector and do not create additional scientific observations.

## 5. Coverage-state reasoning

Every family lands `partial`, none `covered`, applying the completion plan's §5 rule: `covered`
requires adequate lineage for the exact epistemic status of the live rule. Here the scientific
boundaries are real but generic, while every scalar the engine actually uses remains uncalibrated —
so the research priority is retained in all five rows.

For `periodization.phase_boundaries_scales`, the scientific contribution is intentionally narrow:
periodized/block organization is a defensible option, but the evidence does **not** justify the
35/84-day boundaries or imply that the app's Base→Build→Specificity sequence is uniquely optimal.

## 6. Alignment tests

`periodizationEventDemandKnowledge.test.ts` pins claim/source prose against both evidence identity
and live constants:

- both the favorable 2019 block meta-analysis and the cyclist-specific 2023 review / 2022
  randomized trial must remain linked, preventing a future one-sided "superiority" rewrite;
- Sanders' source note is guarded as stage-type evidence and Ebert's direct race dataset is pinned
  by PMID/DOI and its 207-race scope;
- preset count in the claim **and product-policy source prose** ↔ `eventPresets.ts:EVENT_PRESETS`
  actual count;
- the time-trial and criterium example values quoted in the product-policy claim ↔ their authored
  vectors;
- the phase boundary/scale values quoted in the claim ↔ `periodization.ts:evaluatePeriodizationPhase`
  output at 30/60/120 days out.

**The count alignment caught a real authoring error:** the preset claim was first written as "22
authored event presets"; the actual table holds 19 (cycling 5, running 5, triathlon 6,
strength_meet 2, general_target 1). The claim itself was corrected before the original commit, but
review found the stale **22** still present in the module header, product-policy source note and
coverage rationale. This revision fixes all of them and adds a source-prose assertion so CI now
protects the full registered artifact, not only the claim statement.

### 6.1 Canonical contributor-taper drift

While this pack was being written, the W0 branch gained a behavior fix
(`fix(periodization): use canonical taper for contributors`) that removed the duplicated hardcoded
contributor taper-window table from `periodization.ts:resolveMultiEventObjectives`, delegating
instead to `taperPolicy.ts:resolveEventTaper` so athlete-authored taper start dates and cycling-A
race-week alignment also apply to contributors.

The first draft of `policy.periodization.multi_event_contribution_v1` was written against the
pre-fix code and asserted duplicated 14/5-day contributor windows. Two things were stale and both
were corrected:

- the claim statement, now describing delegation to the canonical taper authority;
- the coverage row's own `currentRule`, which still described the removed local windows.

The pack test asserts the claim mentions the canonical delegation and its real resolution order.
The engine-side behavior itself is covered by `periodizationTaperAlignment.test.ts` from W0; this
pack does not duplicate it.

The lesson worth carrying into W2/W3: a coverage row's `currentRule` is a factual assertion about
live code and can go stale from an unrelated engine fix. Alignment tests protect selected claim
scalars; coverage prose still needs deliberate review whenever decision authority moves.

## 7. Inventory effect

| Metric | After W0 | After W1 |
|---|---|---|
| Families | 54 | 54 |
| covered / partial / uncovered / n-a | 18 / 10 / 20 / 6 | 18 / 14 / 16 / 6 |
| P0 / P1 / P2 / P3 | 7 / 13 / 8 / 2 | 7 / 13 / 8 / 2 (unchanged) |
| High-impact uncovered | 7 | **4** |
| High-safety uncovered | 0 | 0 |

The research backlog is deliberately unchanged: four families moved from "no provenance at all" to
"provenance recorded, calibration still owed". That is the honest description of what this pack
did.

## 8. Verification

- `npm run check` — typecheck, lint, full vitest suite, knowledge/coverage/workout validation.
- `node scripts/check-policy-drift.mjs origin/main` — no decision-affecting engine file modified.
- `POLICY_VERSION` unchanged.

## 9. Review additions (2026-09-02)

The post-implementation review made three evidence-quality fixes without changing recommendation
behavior:

1. **balanced periodization inference** — added Galán-Rioja 2023 and Almquist 2022 so the registry
   does not turn an older positive meta-analysis into a universal superiority claim;
2. **correct cycling source directness** — removed the unsupported TT/criterium attribution from
   Sanders 2021 and added Ebert 2006 for direct criterium/flat/hilly field-power evidence;
3. **completed 19-row drift protection** — corrected every stale `22` reference in the evidence
   artifact and added regression coverage for the product-policy source prose.

These changes strengthen evidence lineage while preserving the pack's original epistemic boundary:
scientific literature informs broad organization/demand concepts; the engine's exact numerical
periodization and preset values remain explicit product calibration.