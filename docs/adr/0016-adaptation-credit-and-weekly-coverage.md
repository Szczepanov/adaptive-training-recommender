# ADR-0016: Adaptation Credit and Weekly Coverage Are Orthogonal Planning Ledgers

* **Status:** Accepted
* **Date:** 2026-08-09
* **Deciders:** Core Engineering Team / repository owner

## Context

The recommendation engine's `WeeklyObjective` ledger correctly allows one workout to earn
physiological credit on several stimulus axes. That is useful for adaptation accounting,
but it became an accidental weekly-programming substitution policy: a hard race-specific
cycling session can carry enough aerobic/threshold stimulus to discharge `zone2_aerobic`
and `threshold_quality`, after which low-cost technical/recovery sessions can dominate the
rest of the week.

The workout catalog already declares a different concept in `workouts/event-plan.ts`:
explicit programming roles such as `aerobic_volume`, `sustained_quality`,
`outdoor_event_specific`, and `primary_strength`. Those roles are not equivalent to
stimulus axes.

The escaped case that forced the decision was an A-priority cycling athlete in Specificity:
a hard race-specific ride on day -1 was followed by a rolling week dominated by one more
race-specific session plus Pedalling Economy and Yoga/Mobility. Immediate recovery after
the hard ride was defensible; the whole-week collapse was not.

The active [macrocycle v5 source](../macrocycle-v5.md) supplies the coaching contract for
the true Zone-2 floor, race-week taper branches, and authored travel prescription that
this decision must preserve.

## Decision

### D6-F — dual ledgers

Keep the existing fractional stimulus/adaptation ledger unchanged and add a separate,
count-based weekly coverage ledger. Adaptation answers *what physiological stimulus was
accumulated*; coverage answers *which explicitly required programming roles were actually
performed or projected*.

A session may earn credit in both ledgers. Neither ledger implicitly substitutes for the
other.

### D6-G — role fulfilment is explicit

Coverage is resolved only from exact authored identity:

1. exact workout id -> declared event-plan coverage keys;
2. exact engine template id -> deterministic catalog workout -> declared coverage keys;
3. otherwise no coverage role is inferred.

Stimulus magnitude, title keywords, modality, and broad category may still contribute to
adaptation but never invent coverage. One exposure may fulfil multiple coverage roles only
when the event-plan mapping explicitly lists the same workout under those roles.

### D6-H — rolling, block-clipped window

Weekly coverage uses a rolling seven-calendar-day window clipped to the active authored
plan block. Coverage has a minimum contract floor and a softer target amount. An exposure
can therefore satisfy a role today and cease to satisfy it when it ages out of the rolling
window.

### D6-I — safety outranks coverage

Coverage participates only after existing safety/readiness/time/equipment/environment/
spacing/hard-load gates. Missing coverage never makes an inadmissible candidate eligible.
When coverage is infeasible the engine should expose the miss/defer reason rather than
force an unsafe session.

### D6-J — event-relative cycling plan; travel is an overlay

The default cycling `PlanDefinition` is generated from
`event.timing?.planningDate ?? event.date` using the same Build/Specificity/taper
boundaries as generic periodization. Travel is not automatically fabricated from race
date; it remains an explicit authored block or a day-level availability/fixed-activity
overlay.

### D6-K — sequence search is re-evaluated after semantics

ADR-0015 remains in force: greedy planning stays production while the weekly contract is
corrected. Greedy vs beam may be reconsidered only after the comparison scores explicit
coverage fulfilment as well as safety, objective resolution, recovery share and latency.

## Ranking consequence

Coverage is an ordinal Level-4 signal, not another multiplier:

```text
0  fulfils the currently nominated required anchor role
1  advances an unmet required minimum
2  advances an unmet optional/target amount
3  advances no active explicit coverage
```

After hard-gate rejection the ranking order is:

1. lower coverage tier;
2. existing objective-benefit tier;
3. existing fatigue/preference/variety utility;
4. existing near-equivalent variety tie-break.

This preserves the Phase-3 lexicographic philosophy and keeps the new coaching policy
reviewable.

## Consequences

### Positive

- A hard race-specific session can retain legitimate aerobic/threshold adaptation without
  becoming a Zone-2 or controlled-threshold session after the fact.
- `coverageKey` becomes decision-bearing rather than documentation-only metadata.
- The same role contract can be tested on greedy and beam planners.
- Event-specific plans work for arbitrary cycling target dates rather than one literal
  September fixture.

### Negative / costs

- Recommendation semantics change and therefore require a new `POLICY_VERSION` and a
  reviewed semantic baseline.
- Exact coverage fails closed when historical/fixed work lacks catalog identity; exposure
  identity plumbing must therefore continue as a follow-up rather than being replaced by
  keyword inference.
- A richer weekly contract can expose previously hidden coverage misses that the current
  stimulus ledger calls "resolved".

## Amendments

### 2026-08-24 — compact criterium surge session added to `short_surges` and `outdoor_event_specific`

`cycling_criterium_surges_01` (engine template `end_crit_surges_01`, 35-45 minutes) was
added to the workout catalog as a time-efficient, surge-focused alternative to the
existing `outdoor_event_specific` options, both of which require 50+ minutes. It was never
added to `SEPTEMBER_CYCLING_EVENT_SESSION_COVERAGE`'s `workoutIds`, so under D6-G (role
fulfilment is explicit — exact catalog identity, never inferred from stimulus/category) it
could not fulfil the `short_surges` or `outdoor_event_specific` required roles: a
criterium athlete capped at 45 minutes on weekdays had no catalog identity able to
discharge either role at all that week, regardless of demand profile.

`workoutIds` for both keys now include `cycling_criterium_surges_01`. No coverage key,
phase list, or requirement level changed — this is a membership addition to two existing
roles, consistent with `outdoor_event_specific` and `short_surges` already sharing
`cycling_event_specific_endurance_01`. `FROZEN_SHA256` in
`app/src/workouts/frozenEventCoverage.test.ts` was updated in the same commit;
`FROZEN_KEY_COUNT` (18) is unchanged.

## Related

- `docs/plans/phase-6-2c-recommendation-quality-and-weekly-coverage.md`
- ADR-0015 (sequence search adoption deferred)
- ADR-0012 (authored plan authority)
- `workouts/event-plan.ts` (coverage mapping)
