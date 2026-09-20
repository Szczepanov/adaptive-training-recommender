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

The equal-capacity/equal-horizon `cycling_gran_fondo_A` and `cycling_criterium_A` scenarios
both simulate 28 days with the same context constraints. The resulting event-specific
sequences are materially different:

| Case | Race-specific template evidence | Maximum selected duration | Objective evidence |
|---|---|---:|---|
| Gran fondo | `end_race_specific_01`; no `end_crit_surges_01` | 60 min in the capped scenario | durability objective generated 4 times; delivered stimulus remains below the 0.6 qualification floor under the 60-minute cap |
| Criterium | `end_crit_surges_01` selected for surge-specific work | 45 min | surge objective generated/resolved across the horizon |

The plan-judge corpus was regenerated and its deterministic invariants passed for 95 cases
across 18 families. Event-demand sequence distance was 0.286 for both A- and B-priority
comparisons; the compact criterium template count was 2 for criterium A and 0 for gran-fondo
A. The gran-fondo remediation suite covers phase eligibility, long-horizon ranking,
anchor-adjacent systemic suppression, scheduled race-day ledger admission, and the equal-
capacity/equal-horizon comparison.

## Safety and feasibility review

The implementation retains the existing hard eligibility path and does not bypass equipment,
environment, time, fatigue, injury, recovery-hour, taper, fixed-activity or daily-ledger
checks. The added anchor-adjacency modifier is a soft ranking/coverage preference; it cannot
override hard gates or exact required-role reservations. No Firestore, date, step, or credential
handling paths were changed.

## Verification record

- `npm run test -- --run src/engine/granFondoDurabilityRemediation.test.ts`: 6 passed.
- Focused engine/knowledge/policy suites: 296 passed; the full frontend gate passed 5,972 tests
  with 285 skipped.
- `npm run simulate:scenarios`: 39 scenarios generated successfully.
- `npm run simulate:plan-judge`: 95 cases / 18 families; invariants passed.
- `npm run simulate:diff`: the reviewed baseline was refreshed after rebasing onto current
  `origin/main`; it now reports no semantic differences.
- External manual LLM judging was not re-run locally; the deterministic corpus/invariant run
  is the reproducible gate used for this change.
