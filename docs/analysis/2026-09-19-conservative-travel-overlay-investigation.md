# 2026-09-19 Conservative and Travel Overlay Investigation

Investigation for [issue #677](https://github.com/Szczepanov/adaptive-training-recommender/issues/677),
which reported two external-judge findings on `planning_modes_overlays` /
`preferences_capacity`: a travel overlay that removed almost all aerobic stimulus, and a
conservative preference that appeared to increase hard-session count and cumulative
systemic cost. The issue explicitly asked to distinguish real defects from noise or
intentional product-policy choices, not to assume either.

## Q3 first: can travel mode preserve useful aerobic maintenance? — CONFIRMED defect, fixed

Root cause: a candidate-catalog gap, not a scoring bug. Every `Easy`/`Moderate`/`Hard
Endurance` candidate in `app/src/engine/templates.ts` required `indoor_bike`,
`outdoor_bike`, or `swim_access` equipment, or (Running/Walking) was hard-tagged
`environment: 'outdoor'`. A travel day (no bike/treadmill, `trainingSettings.defaults.
environment = 'indoor'`) fails every one of those on the hard eligibility gate in
`eligibility.ts` `evaluateTemplateEligibility` — not on dose scaling, which only ever
*reduces* an already-viable candidate pool (`applyPlanningOverlays`, `scheduleOverlay
Presets.ts`). The athlete was left with only `Rest`/`Mobility/Recovery`, exactly matching
the judge's "removed almost all aerobic or event-specific stimulus" finding. A separately
authored `travel_aerobic_maintenance_01` workout already existed in `app/src/workouts/
catalog/travel.ts` for this exact scenario, but that catalog belongs to the structured
session-authoring subsystem (ADR-0023) and is never read by the optimizer's
`rankCandidates`/`eligibleTemplates` path — it was effectively dead for this purpose.

**Fix:** added `end_easy_05` ("Equipment-Free Aerobic Circuit") to `templates.ts` --
`Easy Endurance` / `Cross Training` modality, `requiredEquipment: []`, `environment:
'either'`, 20-30 min. Genuinely zero-equipment bodyweight cardio (step-ups, high knees,
mountain climbers, shadow boxing); it does not fabricate access to a bike, weights, or a
hotel gym the athlete doesn't have. Reproduced end-to-end via `npm run simulate:plan-judge`:
`judge_mode_travel_overlay`'s 14-day plan now selects `end_easy_05` on 9 of 14 days (the
rest split between `str_full_02` bodyweight strength, `rest_01`, and `mob_01`), instead of
collapsing to Rest/Mobility only. `POLICY_VERSION` bumped
(`2026-09-travel-equipment-free-aerobic-fallback-v1`) since this changes recommendation
outcomes for real athletes with an active travel-like environment/equipment overlay.

Q2 (equipment-free aerobic substitutes) and Q3 are both answered by this fix. Q4
(overlay semantics documentation) is addressed by the new subsection in
`docs/architecture/recommendation-engine.md` ("Authored travel overlays").

## Q1: is conservative bias monotonic in hard-session count / systemic cost? — CONFIRMED violated, NOT fixed in this change

Every direct `conservativeBias` read (`rules.ts` strain offset, `planner.ts`
`projectedFatigueThresholds`, `optimizer.ts` `rankCandidates` cost-penalty/preference-
multiplier) correctly biases toward *less* load in isolation -- confirmed by the new
`travelConservativeOverlayBoundary.test.ts` monotonicity tests at the per-candidate
scoring level. Static reading of the weekly-objective/coverage machinery
(`coverage.ts`, `weeklyAllocation.ts`, `microcycle.ts`) found no reference to
`conservativeBias` at all, which initially looked like the judge finding might be
noise or a rolling-window artifact.

Running the real corpus (`npm run simulate:plan-judge` before the invariant-script
change below) disproved that: comparing `judge_pref_neutral` and `judge_pref_conservative`
(identical athlete state, only `conservativeBias` toggled) over the same 14-day window:

| Metric | Neutral | Conservative |
|---|---|---|
| Hard sessions (systemicCost ≥ 0.6) | 1 | 2 |
| Cumulative systemic cost | 4.49 | 4.95 |

Day-by-day, both runs are identical through 2026-08-19 except for two days where
conservative correctly does *less* (2026-08-11: `mob_01`→`rest_01`; 2026-08-18:
`end_easy_04`→`rest_01`). The divergence is 2026-08-20: neutral schedules
`str_upper_01` (Upper-body Strength, cost 0.3); conservative schedules a second
`end_hard_02` (Hard Endurance / VO2, cost 1.0) -- the exact "second VO2 session" the
issue's judge run reported. The `judge_mode_conservative_preference` /
`judge_mode_event_directed` pair (planning-mode family) reproduces the same 1→2,
4.49→4.95 pattern for the identical reason.

**Root-cause hypothesis (not yet verified deeply enough to fix safely):**
`app/src/engine/weeklyAllocation.ts` `resolveWeeklyRoleReservations` re-solves required
weekly role placement once per forecast day (`planner.ts` `evaluateForecastDate`), using
its own forward fatigue-projection (`allocationEvaluator` → `projectedEvaluation`) to
decide which dates can host a required Hard-Endurance/VO2 occurrence. That projection
*does* consume `conservativeBias` indirectly (it calls the same `fatigueTierFor`/
`projectedFatigueThresholds` path). The suspected mechanism: on 2026-08-17 both runs
organically pick `end_race_sim_01` (cost 0.568) via ordinary discretionary ranking, which
is close enough to the *neutral* `modifyMaxSystemicCost` ceiling (0.5, +0.3 margin
headroom) to also implicitly satisfy the week's second required VO2-family occurrence.
Under `conservativeBias`'s tightened ceiling (`0.5 * 0.85 = 0.425`), the reservation
search's own projection rejects 2026-08-17 as a valid *reservation* date for that
occurrence (even though the real forward-simulated day still organically selects
`end_race_sim_01` there for both runs) and keeps searching forward until it force-places
the full occurrence on 2026-08-20 -- a forced reservation that overrides what discretionary
ranking would otherwise have picked (the cheaper Strength session), producing a real,
extra hard session not present in the neutral run.

This has **not** been fixed in this PR. `weeklyAllocation.ts`/`resolveWeeklyRoleReservations`
is a safety-critical, heavily-tested path (ADR-0018; `weeklyAllocation.test.ts`,
`weeklyAllocationPlanner.test.ts`, `weeklyAllocationLedgerCapacity.test.ts`,
`coverage.test.ts`, `coverageOccurrence.test.ts`, `coverageAnchorAuthority.test.ts`) and
the mechanism above is a hypothesis from reading the code and one reproduction, not a
verified root cause. Shipping an unverified change to the forced-reservation search
alongside the unrelated travel-catalog fix would risk a real regression in exchange for an
unconfirmed fix. A deliberately-failing monotonicity assertion was **not** added to
`check-plan-judge-invariants.mjs` for this reason -- see that file's `judge_mode_
conservative_preference` comment. Follow-up: a dedicated session should verify the
hypothesis above against `weeklyAllocation.ts`'s actual reservation/settlement flow
(`evaluateForecastDate`, `settledOutcomes`, `displacementReasons` in `planner.ts`) and,
once confirmed, decide the fix (e.g. the reservation search's projection should use the
same ceiling relaxation semantics as ordinary discretionary ranking, or `conservativeBias`
should feed into occurrence *eligibility* rather than only into the reservation search's
rejection of candidate dates) and add the deterministic invariant assertion alongside it.

## Non-goals honored

No modality substitution was added to satisfy a judge score against product policy: the
new `end_easy_05` candidate is a genuine, previously-authored-in-spirit (mirroring
`travel_aerobic_maintenance_01`) zero-equipment aerobic option, not a fabricated one. No
change makes conservative preference a blanket rest-only plan -- the confirmed hard-session
issue is documented for a dedicated fix rather than patched by further suppressing
conservative-mode candidates, which would risk the opposite defect (silently blocking a
legitimately required session).
