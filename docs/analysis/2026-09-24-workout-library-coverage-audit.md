# Workout library coverage audit — 2026-09-24
**Status:** implemented findings in this branch
**Scope:** active canonical workout catalog, typed performance-goal coverage, current 2026–2027 cycling-primary training demands, evidence boundary, and automatic-selection architecture.
## Executive finding
The workout library is not materially short of generic workout *types*. It already has broad coverage across cycling, running, strength, field/technical work, swimming, recovery, travel and race/taper support.
The meaningful gap is **specific executable coverage**: whether every reviewed planning demand has at least one canonical workout containing the exact movement/stimulus identity the planner is allowed to credit.
The first typed strength/speed/power goal slice exposed two real gaps:
| Performance target | Direct coverage rule | Before this change | Action |
|---|---|---|---|
| Conventional deadlift 1RM | exact `conventional_deadlift` exercise | no active workout | add direct-practice workout |
| Standing 10 m sprint | `sprint_falling_start_10m` | already covered by field technique | no duplicate workout |
| Cycling 5 s peak power | `bike_sprint_power` | canonical exercise existed but unused | add maximal short-sprint workout |
This change therefore adds **two**, not dozens, of new workouts.
## Audit method
The audit followed the repository's existing authority chain rather than comparing the catalog to an arbitrary list of popular workouts:
1. inspect ADR-0004 and `docs/workout-library.md` to identify the canonical Exercise → WorkoutDefinition → Variant → Prescription architecture;
2. inspect every catalog module and engine template family to understand current modality/stimulus coverage;
3. inspect `performanceTargetPolicy.ts` and `performanceGoalPlanningRules.ts` to identify exact first-slice direct-coverage identities;
4. verify the exact canonical exercise ids against the exercise registry;
5. check variants, equipment, contraindications, recovery metadata and selection semantics;
6. cross-check current macrocycle demands so a phase-specific requirement is not missed merely because it lacks a typed performance goal;
7. review external evidence for the two new prescription families;
8. keep scientific direction and exact product calibration separate in the Sports Knowledge Registry.
## Existing coverage
### Cycling
The catalog already covers:
- recovery and easy/Z2 riding;
- outdoor/long aerobic endurance;
- tempo and controlled threshold;
- over-under work;
- long VO₂ intervals;
- variable-intensity VO₂;
- short-work/short-rest VO₂ (30/15 family);
- submaximal short surges/gap closing;
- event-specific endurance and race simulation;
- criterium-style surge work;
- taper sharpening and pre-race openers;
- cadence/pedalling economy plus handling/braking/cornering technique.
The current macrocycle's major families—long aerobic work, controlled tempo/subthreshold, 3–5 minute VO₂, variable long VO₂ and 30/15-type work—therefore already have canonical representatives.
The missing cycling family was **fresh maximal short sprint power**. `bike_sprint_power` already described the correct 5–15 second maximal movement, but no active `WorkoutDefinition` used it. Existing `bike_short_surge` is intentionally submaximal and should not be relabelled merely to make coverage appear complete.
### Strength / power
The catalog already contains:
- full-body barbell maintenance;
- lower-body force/power;
- upper-body/trunk and cable variants;
- compact power work;
- reactive jump/plyometric work;
- bodyweight and low-load options;
- travel strength;
- race-week primer;
- squat, RDL, bench, pull-up, Olympic-lift derivative and tissue-capacity work.
The missing first-slice strength family was not "hinge strength" in general. It was **exact conventional-deadlift practice**. The goal architecture correctly refuses to count an RDL as conventional-deadlift-specific coverage.
### Running / field / swimming / recovery
Running already has easy/re-entry, tempo, VO₂, hills, long run, race-pace and taper work.
Field work already has sprint mechanics plus acceleration/braking practice, which is sufficient for the currently registered standing-10 m performance goal. Reactive strength and field work also cover the current macrocycle's low-volume landing/pogo/acceleration/deceleration needs.
Swimming has technique, easy aerobic and sustained interval sessions. It is intentionally shallower than cycling because no current typed swim-performance demand or event-specific allocation contract requires a larger catalog.
Recovery/travel includes mobility, easy/re-entry options, equipment-free aerobic/strength work and complete rest.
## Why the two additions are separate workouts
### Conventional Deadlift Strength Practice
A specific 1RM goal needs exact-lift exposure, but the aspirational target cannot become today's load prescription.
The new workout therefore:
- uses `conventional_deadlift` in the canonical step identity;
- uses RIR/current capability rather than target 1RM as dose authority;
- keeps volume deliberately low-grind;
- cites the existing strength warm-up knowledge claims;
- includes acute hamstring/low-back exclusions;
- allows RDL only as a broad hinge-strength substitution and explicitly states that the substitution loses exact goal coverage;
- removes loaded deadlift entirely in the return-to-training variant.
### Short Maximal Cycling Sprint Power
A 5-second peak-power goal needs short maximal sprint exposure. Submaximal surge tolerance is a related but different stimulus.
The new workout therefore:
- uses `bike_sprint_power`, not `bike_short_surge`;
- requires a bike plus safe riding area;
- uses a progressive warm-up and controlled openers;
- uses short maximal efforts with long recovery to prioritize quality rather than conditioning fatigue;
- treats sprint quality and safety as stop conditions;
- never prescribes the athlete's aspirational target wattage;
- removes maximal sprint work entirely in the return-to-training variant.
## Evidence boundary
Two distinct questions must not be conflated:
1. **Is this training direction defensible?**
2. **Is this exact set/rep/rest prescription scientifically proven to be optimal?**
For resistance training, Currier et al. (2023) found that resistance training improved strength across prescriptions and that higher-load prescriptions tended to maximize strength gains on average. That supports meaningful loaded practice for a strength target, but not a universal deadlift-specific 3×3 prescription.
For short sprint training, systematic reviews support short sprint interval work for anaerobic-performance development, and cycling trials demonstrate that short all-out efforts separated by minutes of recovery can improve peak-power-related outcomes. Protocols are heterogeneous and no single 5×8 s / 240 s scheme is established as universally optimal.
Accordingly, the registry now contains:
- scientific claims for the broad direction;
- separate product-policy claims for the exact conservative catalog defaults.
This prevents exact product scalars from being laundered into scientific certainty.
## Architecture boundary: catalog coverage is not allocation authority
The two new workouts intentionally declare **no `engineTemplateIds`**.
That matters because PG6 should close content gaps without silently changing ordinary automatic recommendations. PG7 still needs to decide how performance-goal coverage competes with broad adaptation requirements, event/external authority and limited weekly capacity.
The direct-coverage classifier operates on canonical workout definitions. A selected variant can still omit the direct step. Therefore:
- canonical workout match = **candidate** direct coverage;
- resolved variant containing the exact step = potential **delivered** direct coverage;
- a return-to-training variant that omits the step must produce no direct-coverage credit.
Tests pin this invariant for both new workouts.
## Deliberate non-additions
### No duplicate standing-10 m workout
The current planning rule maps the standing-10 m test to `sprint_falling_start_10m`, already used in active field-technique workouts. Adding another session would increase catalog size without increasing capability.
### No flying-10/max-velocity performance-goal workout yet
The exercise catalog contains max-velocity primitives, but a flying-10 performance test/target is not yet registered in the first slice. Add the test/metric/planning semantics first, then audit coverage. Do not pre-author recommendation authority through unused catalog content.
### No generic "sweet spot" duplicate
The current catalog already spans tempo, controlled threshold and adjustable sustained work. A marketing label is not a missing planning capability unless it corresponds to a distinct reviewed adaptation/coverage contract.
### No ski workout
The January ski branch is a substantial external lower-body load, not a cycling workout that should be manufactured to satisfy the catalog. It belongs in external activity/load handling.
## Result
After this change, every currently registered first-slice performance target has at least one legitimate active direct-coverage workout:
- conventional deadlift → `strength_conventional_deadlift_practice_01`;
- standing 10 m → existing field acceleration/sprint-mechanics workouts;
- cycling 5 s peak power → `cycling_sprint_power_5s_01`.
The next architectural task is PG7 allocation/shortfall authority, not further indiscriminate catalog expansion.