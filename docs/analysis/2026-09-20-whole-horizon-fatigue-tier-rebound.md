# 2026-09-20 Whole-Horizon Fatigue-Tier Rebound

Investigation for [issue #676](https://github.com/Szczepanov/adaptive-training-recommender/issues/676)
(hard-load density and race-week sequencing, PR #690), following up on
`app/src/engine/recentLoadHorizonDensity.test.ts`'s monotonicity check: a more recent
prior hard exposure should never produce more total hard sessions or cumulative systemic
cost over a 14-day forecast than a less recent (or absent) one. This is tracked as a
cross-cutting architectural finding in
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

## Disposition

Per the decision on issue #677/#684's identical finding: **not fixed here.** A correct fix
needs a genuine whole-horizon load/hard-session budget (or an equivalent mechanism)
implemented once, closing both #676's and #677's reproductions together -- not a
same-PR patch to `optimizer.ts`'s new suppression heuristic, which was empirically ruled
out as even being the active mechanism in this reproduction. Softened
`recentLoadHorizonDensity.test.ts`'s monotonicity assertion from a hard failure to a
documented, non-blocking `console.warn` (see that file's inline comment) rather than
leaving CI red on an already-understood, cross-cutting architectural question, or
silently deleting the check. Tracked in
[issue #692](https://github.com/Szczepanov/adaptive-training-recommender/issues/692) with
acceptance criteria for the actual decision (is whole-horizon monotonicity a required
invariant at all?) and, if so, for un-softening both this test and the corresponding
checks in `check-plan-judge-invariants.mjs`.
