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

## Q1: is conservative bias monotonic in hard-session count / systemic cost? — CONFIRMED violated; PARTIALLY fixed (reservation search), remainder is an open product question

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

**Update 2026-09-20 — two distinct mechanisms found, one fixed, one still open as a
product question.**

**Mechanism A (fixed, commit `fix(engine): enforce overlay fallback and conservative
monotonicity`).** The original hypothesis above was correct: `weeklyAllocation.ts`'s
`resolveWeeklyRoleReservations`, driven by `planner.ts`'s `allocationEvaluator`, used the
*athlete's own* (conservative-tightened) fatigue thresholds to decide which dates could
host a required weekly-role occurrence, rejecting 2026-08-17 as a reservation date under
`conservativeBias` even though the real forward-simulated day still organically selected
`end_race_sim_01` there, and force-placing the occurrence on 2026-08-20 instead. The fix
gives `projectedDateOutcomeFrom` an explicit `reservationFatigueThresholds` override and
has `allocationEvaluator` always probe reservation feasibility with **baseline
(non-conservative) thresholds**, while the real forecast day the athlete actually sees
still applies conservative thresholds and ranking. Verified by re-running
`npm run simulate:plan-judge` and diffing `allocationReports`: reservation placement is now
byte-identical between `judge_pref_neutral` and `judge_pref_conservative`.

**Mechanism B (accepted under #692 as a planner non-invariant, not a defect).** Fixing
Mechanism A did not make the `check-plan-judge-invariants.mjs` monotonicity assertions
pass. Diffing the two cases' per-day `activeObjectives`/`projectedFatigue`/`mode` fields
(not just the plan summary) localizes the remaining divergence to 2026-08-20 -- an ordinary
discretionary day with no required-role reservation in *either* run:

| | neutral | conservative |
|---|---|---|
| Selected | `str_upper_01` (Upper-body Strength, cost 0.30) | `end_hard_02` (Hard Endurance/VO2, cost 1.00) |
| `mode`/fatigue tier | `modify` | `train` |
| Peak combined systemic fatigue | 0.4875 | 0.4151 |
| `PROJECTED_FATIGUE_GATE` rejections | 15 | 0 |

Conservative correctly did *less* work on 2026-08-11 (`rest_01` vs neutral's `mob_01`) and
2026-08-18 (`rest_01` vs neutral's `end_easy_04`, cost 0.18) -- both individually consistent
with the preference. Those lower-load days leave the conservative run with a lower
*model-projected* fatigue value by 2026-08-20 (0.415 vs 0.488), which is enough to cross the
`modify`/`train` tier boundary: neutral stays gated to `systemicCost <=
modifyMaxSystemicCost` candidates (excluding `end_hard_02`, hence 15
`PROJECTED_FATIGUE_GATE` rejections), while conservative is ungated (0 rejections), and the
optimizer's own ranking then legitimately prefers the higher-benefit `end_hard_02` once
nothing excludes it.

Every individual gate is consistent with the current planner rules, but the numeric fatigue
projection must not be over-interpreted. The architecture already records that its external /
internal fatigue fusion is **not calibrated as a direct physiological measurement**. The result
therefore supports a narrower engineering statement: lower prior modeled load can move a later
date across a local tier boundary. It does not prove that the athlete is objectively or fully
recovered, and the literature does not establish this product score or its thresholds as a
physiological ground truth.

A runtime fix also cannot literally compare "what the neutral run would have done": production
executes one athlete timeline and one preference state. A stricter whole-horizon guarantee would
need an explicit product policy such as a rolling hard-session/load budget. That may be useful in
future, but it is a separate calibration decision and should not be smuggled in as a consequence
of the current readiness model.

**Formal Resolution (Issue #692):** this PR resolves the issue by accepting
cross-counterfactual whole-horizon monotonicity as a **planner non-invariant**. This is compatible
with the current user-facing **Extra Recovery Margin** contract, which says that borderline or
ambiguous readiness decisions should prefer lower-risk/lower-dose options; it does not promise
that every synthetic 14-day conservative counterfactual has lower cumulative load. The hard
per-candidate conservative ranking checks remain in `travelConservativeOverlayBoundary.test.ts`.
The plan-judge comparison remains characterization telemetry, not a defect gate.

**Evidence boundary.** Recovery and readiness are appropriate inputs to day-to-day training
decisions, but athlete-monitoring literature emphasizes contextual interpretation and the lack of
a single definitive fatigue marker. Halson (2014; PMID 25200666) and Ibrahim et al. (2024;
PMID 38665139) support that caution. Rebelo et al. (2026; PMID 41824225) further frames readiness
as a contextual, longitudinal decision-support proxy rather than a stand-alone determinant.
None of these sources validates this engine's internal `systemicCost` bands, fatigue fusion, or
a specific whole-horizon monotonicity rule.

## Non-goals honored

No modality substitution was added to satisfy a judge score against product policy: the
new `end_easy_05` candidate is a genuine, previously-authored-in-spirit (mirroring
`travel_aerobic_maintenance_01`) zero-equipment aerobic option, not a fabricated one. No
change makes conservative preference a blanket rest-only plan -- the confirmed hard-session
issue is documented for a dedicated fix rather than patched by further suppressing
conservative-mode candidates, which would risk the opposite defect (silently blocking a
legitimately required session).
