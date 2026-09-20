# 2026-09-20 Whole-Horizon Fatigue-Tier Rebound

Investigation for [issue #676](https://github.com/Szczepanov/adaptive-training-recommender/issues/676)
(hard-load density and race-week sequencing, PR #690), following up on the former monotonicity hypothesis in
`app/src/engine/recentLoadHorizonDensity.test.ts`: the original test assumed that a more recent
prior hard exposure would produce no more total hard sessions or cumulative systemic cost over a
14-day forecast than a less recent (or absent) one. Issue #692 evaluates whether that assumption
belongs in the product contract. The shared mechanism is tracked as a cross-cutting architectural
finding in
[issue #692](https://github.com/Szczepanov/adaptive-training-recommender/issues/692),
since the identical root cause independently surfaced in
[issue #677](https://github.com/Szczepanov/adaptive-training-recommender/issues/677)'s
`conservativeBias` investigation
(`docs/analysis/2026-09-19-conservative-travel-overlay-investigation.md`, "Mechanism B").

## Finding: CONFIRMED violated, not a local #676 defect

Comparing the "hard 3 days ago" seeded-history variant against "no recent hard load" over
an identical 14-day window (`cycling_criterium_A`, both correctly resolve
`strength_maintenance` twice across the horizon):

| | no recent hard load | hard 3 days ago |
|---|---|---|
| Hard sessions (systemicCost >= 0.5) | 3 | 4 |
| 2026-08-11 pick | `mob_01` (Mobility/Recovery, `modify` tier) | `rest_01` (Rest, `recover` tier) |
| 2026-08-12 pick | `end_hard_02` (required role, `train` tier) | `str_full_01` (discretionary, `train` tier, cost 0.8) |
| Strength days elsewhere | `str_full_03` (cost 0.45) x2, both `modify` tier | `str_full_03` (cost 0.45) once, `modify` tier |

First, the multiplier suppression added by #676 itself
(`optimizer.ts` `hardInRollingWindowCount >= 2` benefit reduction) was ruled out as the
mechanism: at 2026-08-12 the seeded exposure (2026-08-04) has already aged out of the
6-day rolling window (`diff = 8`), so `hardInRollingWindowCount` there is only 1 (from the
2026-08-10 `end_crit_surges_01` pick), never reaching the `>= 2` trigger. Tightening the
suppression multiplier from 0.40 to 0.15 and re-running confirmed this empirically -- the
result was unchanged (still 4 vs 3).

Tracing `decisionTraces[].mode` day-by-day found the real mechanism: on 2026-08-11, the
"hard 3 days ago" run correctly rests more than the baseline (`rest_01`/`recover` tier vs
`mob_01`/`modify` tier) -- an individually correct response to the seeded exposure. But
resting more there clears projected fatigue faster, so 2026-08-12 reaches `train` tier
instead of `modify` tier. `planner.ts`'s fatigue-tier gate only applies the
`systemicCost <= modifyMaxSystemicCost` ceiling in `modify` tier; in `train` tier the
ceiling is absent entirely. Both runs need a second `strength_maintenance` session
somewhere in the horizon; in the baseline run that need lands on a `modify`-tier day
(2026-08-15) and gets capped to `str_full_03` (cost 0.45, purpose-built to fit "inside the
modify systemic-cost ceiling" per its own description); in the "hard 3 days ago" run it
lands on the now-uncapped `train`-tier 2026-08-12 and gets the full-dose `str_full_01`
(cost 0.8) instead.

This is the identical root cause already documented for #677's `conservativeBias`
Mechanism B: **nothing in the current architecture tracks a genuine whole-horizon load
budget.** Each forecast day's `train`/`modify`/`recover` classification is a purely local
function of that day's own projected peak fatigue. A sequence that dips into `recover`
tier earlier necessarily clears fatigue faster and reaches `train` tier sooner than a
sequence that stayed in a lighter, non-recovering `modify` tier throughout -- and whatever
discretionary work happens to fall on that now-uncapped day gets the fuller dose. Every
individual gate (the recovery response on 2026-08-11, the tier ceiling on 2026-08-12, the
`strength_maintenance` scheduling) is behaving exactly as designed; the emergent,
whole-horizon consequence is what the test's monotonicity assumption doesn't hold.

## Disposition: Formal Resolution (Issue #692)

This PR resolves [issue #692](https://github.com/Szczepanov/adaptive-training-recommender/issues/692)
by treating cross-counterfactual whole-horizon monotonicity as a **planner non-invariant**, not a
required product invariant.

### Rationale

1. **Local state is the executable contract.** Each forecast date's fatigue tier
   (`train` / `modify` / `recover`) is evaluated against the model-projected fatigue state as-of
   that date. Hard safety, feasibility, injury, daily-ledger, and required-role constraints remain
   binding regardless of this decision.
2. **Recovery-aware autoregulation can legitimately change later capacity, but this is not a
   physiology proof.** Training practice and autoregulation literature support adjusting workload
   to readiness/recovery over time. They do **not** validate this engine's internal fatigue score,
   `systemicCost` cut-points, or a universal rule that a more recent historical load must produce a
   lower 14-day cumulative plan. The architecture explicitly records the current fatigue fusion as
   uncalibrated; wording such as "actual physiological state" or "fully recovered" is therefore too
   strong.
3. **The counterfactual does not exist at runtime.** Production evaluates one athlete timeline.
   Enforcing a paired-run total-load ordering would require a separate explicit horizon budget or
   other product policy, not a comparison the live engine can observe.
4. **Preference semantics remain bounded.** `conservativeBias` is surfaced as **Extra Recovery
   Margin**: when readiness signals are borderline or ambiguous, choose lower-risk/lower-dose
   options. Per-candidate conservative ranking remains hard-tested. This decision does not redefine
   the preference as a global 14-day load cap.

Accordingly, `app/src/engine/recentLoadHorizonDensity.test.ts` now asserts the near-term response
to a recent hard exposure and reports the longer-horizon ordering only as characterization
telemetry. `app/scripts/check-plan-judge-invariants.mjs` likewise reports the matched
neutral/conservative totals as telemetry rather than a warning/failure.

### Evidence boundary

- Halson S. *Monitoring training load to understand fatigue in athletes.* Sports Med. 2014.
  PMID 25200666 — emphasizes individualized, multi-marker interpretation and notes that no single
  definitive fatigue marker has strong enough evidence to stand alone.
- Ibrahim AH, Beaumont CT, Strohacker K. *Implementing Meta-Session Autoregulation Strategies for
  Exercise — A Scoping Review.* Int J Exerc Sci. 2024. PMID 38665139 — describes adjustment of
  training to day-to-day fitness/fatigue/readiness, while highlighting heterogeneous implementation.
- Rebelo A, Bishop C, Thorpe RT, Turner AN, Gabbett TJ. *Monitoring Training Effects in Athletes:
  A Multidimensional Framework for Decision-Making.* Sports Med. 2026. PMID 41824225 — positions
  readiness as an operational proxy that can support day-to-day decisions when interpreted
  longitudinally and in context, rather than as a stand-alone determinant of performance outcomes.

These sources support cautious, contextual autoregulation as a concept; they do not validate this
engine's specific thresholds or make the accepted non-invariant a scientific requirement.
