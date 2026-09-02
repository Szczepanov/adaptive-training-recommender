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
  point on a scale the product invented. There is nothing to search for.
- **`periodization.multi_event_contribution`** is deterministic conflict-resolution scheduling
  (`periodization.ts:resolveMultiEventObjectives`): a 35-day contribution window, 14/5-day
  contributor taper windows, drop-if-inadmissible-during-authority-taper, and merge-by-max with
  modality-qualifier union. That is software design for reconciling concurrent goals, not
  physiology.

Both therefore received **product-policy claims only, with no scientific claim attached** — the
W2 treatment, applied inside this pack because the families sit in the same domain and the same
coverage rows were already being edited. Forcing a literature search on them would have produced
either nothing or a padded citation.

## 3. Evidence reviewed

### 3.1 Phase-structured progression

- **Mølmen KS, Øfsteng SJ, Rønnestad BR.** *Block periodization of endurance training – a
  systematic review and meta-analysis.* Open Access J Sports Med. 2019;10:145-160.
  doi:10.2147/OAJSM.S180408. PMID:31802956. Meta-analysis of 20 studies; small-to-moderate
  favorable effects for block vs traditional periodization on VO2max (SMD 0.40) and maximal
  aerobic power (SMD 0.28), moderate-to-large on some threshold/workload outcomes. The authors
  explicitly caution the pool is small and of generally low methodological quality.
- **Issurin VB.** *New Horizons for the Methodology and Physiology of Training Periodization.*
  Sports Med. 2010;40(3):189-206. doi:10.2165/11319770-000000000-00000. PMID:20199119. The
  conceptual framework for concentrated, sequential block development. Registered as
  `expert_practice`, not `systematic_review` — it is a theoretical/narrative review, not an
  effect-size synthesis, and the source note says so.

**Claim:** `performance.periodization.block_structured_progression` — intervention, maturity
`emerging`, certainty **low**, conditional. The low certainty is taken directly from the
meta-analysis authors' own caveat, not softened.

### 3.2 Event-demand characterization

- **Joyner MJ, Coyle EF.** *Endurance exercise performance: the physiology of champions.*
  J Physiol. 2008;586(Pt 1):35-44. doi:10.1113/jphysiol.2007.143834. PMID:17901124.
  PMCID:PMC2375555. VO2max, lactate threshold and economy as determinants, with relative
  importance shifting by event duration.
- **Sanders D, van Erp T.** *The Physical Demands and Power Profile of Professional Men's Cycling
  Races: An Updated Review.* Int J Sports Physiol Perform. 2021;16(1):3-12.
  doi:10.1123/IJSPP.2020-0508. PMID:33271501. Format matters independent of duration — sustained
  near-threshold time-trial effort versus variable, repeated supra-threshold mass-start/criterium
  racing.
- **Sharma AP, Périard JD.** *Physiological Requirements of the Different Distances of Triathlon.*
  In: Migliorini S, ed. Triathlon Medicine. Springer; 2020:5-17. doi:10.1007/978-3-030-22357-1_2.
  Distance-dependent limiter shift across sprint→Ironman.

**Claim:** `performance.event_demand.duration_intensity_limiter_shift` — descriptive, maturity
`established`, certainty **moderate**, conditional.

### 3.3 What the evidence does *not* support

Recorded as claim limitations, not omitted:

- no source validates the 35/84-day phase boundaries, the 0.6/0.3 demand-blend weights, or the
  1.1/0.9, 1.0/0.8, 1.0/1.1 volume/intensity scalars;
- no source validates any individual axis value of any authored event preset;
- the `strength_meet` and `general_target` presets have **no** cited literature behind them at all;
- the cycling and triathlon sources are narrative reviews of field/observational data, not
  controlled comparisons;
- no literature was found establishing per-session-type pre-competition blocking windows, so
  `spacing.pre_event_restrictions` links the existing pre-event taper boundary only as general
  support for reducing load before competition — it validates none of the 1-3/1-2/3-7-day counts.

## 4. Product-policy claims registered

Four, all `claimType: 'heuristic'`, `evidenceCertainty: 'not_applicable'`, sourced to
`PRODUCT-PERIODIZATION-EVENT-DEMAND-POLICY-V1`:

- `policy.periodization.phase_boundaries_scales_v1`
- `policy.periodization.objective_thresholds_v1`
- `policy.periodization.multi_event_contribution_v1`
- `policy.event_demand.presets_v1`

## 5. Coverage-state reasoning

Every family lands `partial`, none `covered`, applying the completion plan's §5 rule: `covered`
requires a scientific boundary **and** a product-policy claim **and** an alignment test. Here the
scientific boundaries are real but generic, while every scalar the engine actually uses remains
uncalibrated — so the research priority is retained in all five rows.

## 6. Alignment tests

`periodizationEventDemandKnowledge.test.ts` pins claim text against live constants:

- preset count in the claim ↔ `eventPresets.ts:EVENT_PRESETS` actual count;
- the time-trial and criterium example values quoted in the claim ↔ their authored vectors;
- the phase boundary/scale values quoted in the claim ↔ `periodization.ts:evaluatePeriodizationPhase`
  output at 30/60/120 days out.

**This caught a real authoring error immediately:** the preset claim was first written as "22
authored event presets"; the actual table holds 19 (cycling 5, running 5, triathlon 6,
strength_meet 2, general_target 1). The claim was corrected to 19 before commit. That is the whole
point of the alignment-test step, and it is worth noting that the error would have been invisible
to review by reading the claim alone.

### 6.1 A second drift, caught by rebasing rather than by a test

While this pack was being written, the W0 branch gained a behavior fix
(`fix(periodization): use canonical taper for contributors`) that removed the hardcoded 14/5-day
contributor taper windows from `periodization.ts:resolveMultiEventObjectives`, delegating instead
to `taperPolicy.ts:resolveEventTaper` so athlete-authored taper start dates and cycling-A
race-week alignment also apply to contributors.

The first draft of `policy.periodization.multi_event_contribution_v1` was written against the
pre-fix code and asserted those 14/5-day windows. Two things were stale and both were corrected
here:

- the claim statement, now describing delegation to the canonical taper authority;
- the coverage row's own `currentRule`, which still described the removed windows — the behavior
  fix understandably did not reach into the knowledge inventory.

The pack test now asserts the claim mentions the canonical delegation and does **not** contain a
`\b14 days` / `\b5 days` window, so a future re-introduction of a duplicated window table in the
claim fails CI. The engine-side behavior itself is covered by `periodizationTaperAlignment.test.ts`
from the W0 branch; this pack does not duplicate it.

The lesson worth carrying into W2/W3: a coverage row's `currentRule` is a factual assertion about
live code and can go stale from an unrelated engine fix. Alignment tests protect claim *scalars*;
nothing yet protects `currentRule` prose. That gap is real and is noted for the SKR3 backlog.

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
