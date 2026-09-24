# Issue #746 forecast-credit parity spike

Date: 2026-09-24. Synthetic AI Plan Judge corpus: 96 cases, 18 families,
1,344 decisions. This is a point-in-time comparison of the WP1+WP2 branch with
forecast completed-credit aging disabled and enabled; all other branch code is
the same. The comparison uses `runForecastDailyParity.mjs` and the generated
judge corpus, not athlete data.

## Decision

Use the daily path's seven-day completed-training window for each forecast date:
`[forecastDate − 7 days, today)`. The active `PlanBlock` selects the objective
definition, but its `windowStart`/`windowEnd` do not clip completed history in
`buildMicrocycleState`. Forecast aging follows that existing daily behavior.
Projected picks remain separate `projectedCredit`, and aging may only lower
historical `completedCredit`. Prior projected stimuli are replayed after aging:
when a pick was previously capped by completed credit that later expires, its
earned stimulus must be restored rather than leaving the capped ledger value.
This accepts the plan's recommended WP3 route.

## Diagnostic and interpretation

`runForecastDailyParityScenario` replays each case day by day with
performed = recommended. It also replays with the weekly forecast's prior picks
as performed history, which isolates credit-window agreement from different
workout selections. Forecast traces for projected days are recorded after that
day's pick; the diagnostic subtracts the current pick's `objectiveCredits` when
comparing against the daily pre-pick state. Both replays use the same history
snapshot contract as `runScenario`.

| Weekly-forecast subset (1,218 dates) | Aging disabled | Aging enabled |
|---|---:|---:|
| Available-credit states matching daily replay on forecast history | 680 | 1,169 |
| Exact template picks matching rolling-daily replay | 305 | 300 |

The objective-state parity gain is the relevant WP3 signal. A first attempt
that retained only the old, capped `projectedCredit` reached 707 matches;
review caught that undercrediting defect, and replaying projected stimuli
raised parity to 1,169. Exact pick parity
is low under both policies because weekly forecasts reserve roles and nominate
anchors while rolling-daily execution re-plans from actual prior picks. It falls
by five dates here, so the spike does **not** claim broad pick parity. This is an
observational diagnostic, not a counterfactual quality score.

The `judge_mode_travel_overlay` Week 2 forecast changes from six consecutive
`end_easy_05` sessions followed by mobility (seven consecutive counting Day 7)
to three `end_easy_05`, `str_full_02`, Rest, `str_full_02`, Rest. The maximum
same-template streak is four across the full 14 days. On the second travel
week, prior-week completed `strength_maintenance` credit expires as the rolling
window moves; the newly open objective can then make bodyweight strength useful
without giving it an ungated `primary_strength` identity.

The aging step changes selected templates on 37 dates in 14 of 96 cases. Hard or
race-specific sessions are 263 → 261; Rest/Mobility days are 377 → 372. Some
event-proximity and gran-fondo quality dates move as newly open objectives
change the projected sequence and fatigue. For example, in
`judge_demand_gran_A/B`, a later full-body strength placement moves the final
VO2 pick to an easy ride. The judge invariant and scenario gates, rather than
raw pick parity, check that these shifts stay inside safety and load bounds.

The corpus's `objectiveResolution` is the end-of-week count of objectives whose
compatibility exposures reach target. With aging disabled, Week-1 completed
training can count again in Week 2 even after it leaves the rolling window.
The count changes from 717 to 711 with aging enabled; six cases have a lower
tally. The two policies use different accounting semantics, so that six-count
change alone does not establish lost training stimulus. A future harness
revision should report per-date rolling resolution and distinct in-week
stimulus separately.

The diagnostic's `agedCompletedCredit` field is a counterfactual for the
current forecast's historical portion only. It does not re-rank that forecast;
the before/after corpus comparison above is the causal selection measurement.

One remaining diagnostic limitation is objective introduction at a mid-forecast
block transition: `reconcileObjectivesForDate` backfills a genuinely new
objective from prior projected exposures but does not seed it from historical
completed exposures. The aging policy intentionally never raises existing
completed credit. Cross-block objective birth therefore needs a separate
contract decision and parity test; this spike does not treat it as solved.
