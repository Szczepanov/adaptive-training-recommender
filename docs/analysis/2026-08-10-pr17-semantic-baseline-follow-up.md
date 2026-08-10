# PR #17 semantic-baseline follow-up — 2026-08-10

## Scope and decision

This record assesses the remaining semantic-baseline decision for PR #17 at commit `f67ecce` (`Add recovery-clear simulation coverage`). It records the evidence gathered after Phase 7 work was moved to a separate PR.

**Decision:** do not accept or update PR #17's reviewed simulation baseline yet. Do not undo W1–W3. Genuine recover-tier states can choose complete Rest, persistently stressed athletes remain conservative, and the acute-stress-to-healthy recovery-clear regression returns to train-tier days. The remaining issue is a scheduling/coverage failure concentrated in healthy and fresh cycling event preparation, not a system-wide recovery-inflation bug.

No experimental policy change described below was committed. The branch remains at `f67ecce` after this investigation.

## Verified current state

PR #17's CI run `31364014280` passed Python, frontend/rules, Docker, and CodeRabbit checks. Local verification also passed the targeted optimizer, planner, scenario, and fatigue-clearing suites (125 tests) and generated all 13 deterministic simulation scenarios. The normal simulation command left the committed baseline unchanged, as required by the baseline-ownership contract.

| Scenario | Committed R/R | Current R/R | Key finding |
| --- | ---: | ---: | --- |
| Gran fondo, normal | 14.3% | 32.1% | `threshold_quality` resolves in 3 of 4 weeks. |
| Criterium, normal | 14.3% | 35.7% | `race_specific_endurance` resolves in 3 of 4 weeks. |
| Criterium, fresh | 17.9% | 32.1% | Event-specific coverage still resolves in 3 of 4 weeks despite excellent readiness. |
| Criterium, persistently stressed | 28.6% | 46.4% | Conservatively higher recovery; threshold and strength resolve in all 4 weeks. |
| Build-week fixture | 42.9% | 28.6% | Improved. |
| No-event baseline | 39.3% | 35.7% | Lower, not inflated. |

Recovery percentage is a diagnostic, not the acceptance criterion. The stronger evidence is that healthy cycling simulations can lose a required authored role while capacity remains. The current distributions also have little modify time: gran fondo `8 train / 4 modify / 8 recover`, normal criterium `8 / 2 / 10`, and fresh criterium `10 / 1 / 9`. Rest is predominantly complete `Rest`, not a balanced mix of Rest and Mobility/Recovery.

## Policy that remains correct

* `optimizer.ts` `rankCandidates` keeps complete Rest ahead of Mobility/Recovery for a passive or mixed athlete in the actual recover tier. This prevents active recovery's non-zero cost from sustaining fatigue above the recovery ceiling.
* `fatigue.ts` and `fatigueClearing.test.ts` retain the 48-hour lower-body and impact-tissue clearance contract.
* The `cycling_criterium_recovery_clear_A` scenario added by `f67ecce` proves that a high-fatigue week followed by a healthy check-in returns to train-tier days.
* The persistently stressed trajectory may have substantially more recovery. Reducing it merely to improve an aggregate percentage would reverse the intended safety direction.

## Experiments performed and rejected

### Healthy borderline-recover transition

The first candidate let a current train-tier athlete, whose *projected* fatigue had only just crossed the recover threshold, select existing modify-cost candidates instead of being hard-limited to Rest/Mobility. It used one existing modify-band width above the recover boundary and did not lower the global threshold. The broad variant reduced normal cycling rest/recovery to roughly 25%.

It was rejected because it reduced event-specific anchor fulfilment in normal criterium, made triathlon reach zero rest/recovery days, and allowed the stressed trajectory to gain more race-specific credit than the stressed-safety regression permits. A cycling-only, non-anchor, non-adjacent variant preserved the existing tests but did not repair healthy/fresh role resolution. Both variants were discarded.

### Reduced full-body maintenance before an anchor

The second candidate examined `str_full_03`, the reduced full-body maintenance template. Its declared systemic and lower-body costs are within the modify ceiling, yet `evaluateRecoveryConstraints` treats Full-body Strength category entries as heavy for next-day cycling anchors. A fresh-criterium trace showed the Sunday event-specific candidate rejected with `QUALITY_SPACING_VIOLATION` and `ANCHOR_PROTECTION_VIOLATION` after Friday/Saturday recommendations were seeded.

Reclassifying that template changed which four-week race-specific roles resolved without satisfying the complete coverage contract. It was rejected. The direct optimizer probe also established that an isolated race-specific test needs the same focus-event/phase inputs as the planner; otherwise that template is phase-ineligible. The experiment and its test were removed.

## Root cause indicated by the traces

`planner.ts` `generateWeekAheadPlan` is a greedy loop. It receives today's and tomorrow's recommendations as selected seeds, then ranks one later date at a time. `resolveWeeklyAnchors` nominates quality and event-specific dates, but those anchors are modifiers rather than reservations. `evaluateRecoveryConstraints` can exclude a required anchor candidate based on seeded or projected history. When that happens, the loop takes Rest and only later attempts to repair the role.

This is why a local fatigue threshold is insufficient:

1. Allowing low-load work late in the recover band can consume the freshness needed by an upcoming anchor.
2. Keeping a strict recover ceiling protects safety, but leaves the greedy loop unable to reserve a later feasible date for a missing hard role.
3. Reclassifying one strength template changes an individual exclusion but cannot guarantee the week's event-specific work, sustained quality, aerobic volume, strength, and recovery ordering.

`sequenceSearch.ts` remains a documented deferred prototype. This finding does not approve its adoption automatically; it identifies the unresolved problem as sequence-level allocation rather than a safe one-constant fatigue calibration.

## Required follow-up outside PR #17 baseline acceptance

The separate scheduling/Phase 7 work should define and test an explicit weekly allocation rule before tuning a fatigue threshold:

1. Reserve feasible must-have cycling roles before allocating supporting strength or discretionary work.
2. Let readiness and hard recovery constraints move or remove an unsafe role, but record the miss explicitly instead of silently replacing it with unrelated work.
3. Permit reduced-dose support only when it cannot consume a reserved quality or event-specific opportunity.
4. Preserve `>=48 h` cycling-quality spacing, injury/feasibility gates, and true recover-tier Rest-first behaviour.
5. Compare candidates in the existing simulator; do not make Rest percentage an objective or hard cap.

Before `simulate:update-baseline -- --reviewed`, require all of the following:

* Normal and fresh cycling build windows fulfil every eligible authored required role: sustained quality, event-specific cycling, true aerobic volume, and primary strength.
* A fresh athlete does not miss a required weekly role solely because of discretionary Rest.
* The persistently stressed athlete remains free to recover more than healthy trajectories.
* The acute-stress-to-healthy recovery-clear scenario continues to regain train-tier days.
* The modify tier remains materially represented where it is safe and productive.
* Existing safety, spacing, emulator-rule, and policy-version checks remain green.

Until that sequence-level contract passes, PR #17 remains merge-clean from a CI perspective but its semantic baseline should stay unreviewed and unchanged.
