# Gran-fondo durability stimulus investigation — Issue #675

Date: 2026-09-20

## Finding

The original concern was valid for the event-demand path. Criterium and gran-fondo cases
shared the same cycling capacity and 28-day horizon, but the gran-fondo path did not have a
distinct sustained-durability objective or a hard enough separation from the compact surge
template. The remediation is a production decision, not only a judge-fixture change.

## Product decision

Demand-derived cycling planning now treats a raw profile with aerobicEndurance >= 0.8,
fatigueResistance >= 0.8 and repeatedSurges < 0.6 as a durability event. It requests one
`obj_cycling_gran_fondo_durability` objective with target stimulus
`aerobicEndurance: 0.9`, `fatigueResistance: 0.85`, `thresholdPower: 0.6`; only a Cycling
`Race-Specific Endurance` template with at least 0.6 aerobicEndurance and 0.6 fatigueResistance
qualifies. The compact criterium surge template is phase-eligible only when the governing
event's repeatedSurges demand is at least 0.6. Long-horizon race-specific benefit is preserved
for this high-durability profile, while general duration, readiness, injury, recovery, taper,
daily-ledger and weekly-anchor gates remain in force.

This does not maximize duration for every gran-fondo athlete. The existing availability and
dose gates continue to choose the feasible prescription; the change makes sustained duration
and fatigue resistance an explicit objective when capacity and event demand support it.

## Deterministic evidence

The legacy `cycling_gran_fondo_A` and `cycling_criterium_A` scenarios remain useful
60-minute-cap controls: they prove template/objective separation under identical constraints,
but they are **not** treated as evidence that a higher-capacity athlete receives enough
durability volume. Their event-specific paths remain intentionally different
(`end_race_specific_01` for gran fondo, `end_crit_surges_01` for criterium).

Issue #675's capacity-sensitive acceptance evidence now lives in the plan-judge
`event_demand` family. All four criterium/gran-fondo A/B cases explicitly set:

- check-in availability: 120 minutes;
- weekday profile cap: 90 minutes;
- weekend profile cap: 120 minutes.

The deterministic invariant gate fails if those capacities regress, if either gran-fondo case
never selects race-specific work longer than 60 minutes, or if its maximum race-specific
duration does not exceed the matched criterium case. It also retains the sequence-separation
and compact-criterium-template checks. This closes the original evidence gap where a
60-minute check-in silently overrode the nominal 90-120-minute capacity.

The remediation suite additionally covers the exact cycling/low-surge durability predicate,
effective-dose benefit scoring under time caps, phase eligibility, long-horizon ranking,
anchor-adjacent heavy-strength suppression, scheduled race-day ledger admission, and the
legacy equal-cap/horizon control.

## Safety and feasibility review

The implementation retains the existing hard eligibility path and does not bypass equipment,
environment, time, fatigue, injury, recovery-hour, taper, fixed-activity or daily-ledger
checks. The added anchor-adjacency modifier is a soft ranking/coverage preference; it cannot
override hard gates or exact required-role reservations. No Firestore, date, step, or credential
handling paths were changed.

## Verification record

The PR CI is the reproducible authority for this change. In particular, the
`Engine Simulations & AI Gates` job runs the scenario corpus, deterministic plan-judge
corpus/invariants and simulation semantic diff; the frontend gate runs the expanded
`granFondoDurabilityRemediation.test.ts` suite together with the full unit-test corpus.
The event-demand invariant output reports both sequence distance and matched
race-specific maximum durations, making the 90/120-minute acceptance condition auditable.

External manual LLM judging is not required as a merge gate for this remediation; the
deterministic corpus/invariant checks are the reproducible regression contract. A future
external judge run can still be used as outcome-calibration evidence rather than as the
sole proof of correctness.
