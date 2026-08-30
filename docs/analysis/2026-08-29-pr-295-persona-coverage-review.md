# PR #295 — persona coverage expansion review

**Date:** 2026-08-29
**Scope:** evergreen AI-judge persona coverage expansion

## Implemented coverage

This pass expands the persona suite from **3 families / 9 cases** to **5 families / 15 cases** while keeping the existing three-perturbation family pattern.

### `persona_balanced_performance`

Directly exercises the `balanced_performance` priority through the real evergreen planner instead of assuming the existing `health` persona is an equivalent proxy.

Perturbations:

- normal recovery;
- adverse recovery;
- a same-day Strength preference.

The judge contract is intentionally weekly rather than day-specific: both aerobic and strength requirements should remain represented, while a same-day preference is only a soft ranking signal and must not erase the other adaptation.

### `persona_stacked_constraints`

Exercises independent hard-gating mechanisms together:

- Running is a restricted modality;
- `avoid_heavy_lower_body` is active;
- free weights, cable machine, treadmill, indoor bike, and pull-up bar are unavailable;
- the durable priority remains `health`.

Perturbations:

- normal recovery;
- adverse recovery;
- only 30 minutes available today.

Fixture-integrity assertions keep the restriction, guardrail, and equipment absence active in every perturbation. The execution regression additionally requires `runScenario()` to report zero hard-constraint violations for every persona case.

## Follow-up: both deferred findings implemented, plus one new finding they surfaced

Both findings below were implemented in a follow-up pass. Kept for the record of what
each was grounded in.

### 1. Walking-only coverage — implemented

Resolved by adding `'Walking'` to `SessionTemplate['modality']`, `'walking'` to
`WorkoutModality`, and a first-class purposeful-walk workout/template pair
(`walking_brisk_continuous_01` / `end_walk_01`) at the same 30-minute continuous-aerobic
floor as Running/Cycling, wired into `EVERGREEN_SESSION_COVERAGE`'s `aerobic_volume` entry
alongside them. Every exhaustive `Record<SessionTemplate['modality'], ...>` /
`Record<WorkoutModality, ...>` map in the codebase needed a `Walking`/`walking` entry too
(TypeScript's exhaustiveness checking caught all of them at compile time --
`completedTraining.ts`'s cost/stimulus-by-modality tables, `validation.ts`'s
exercise-modality compatibility map, plus a few non-exhaustive allow-lists that would
otherwise have silently rejected or ignored Walking:
`validationCore.ts`'s `unavailableModalities` validator, `rules.ts`'s dose-adjustment
candidate search, `sessionChoiceEligibility.ts`'s workout-to-template modality bridge, and
`evergreenStrategy.ts`'s aerobic/strength keyword classifiers used for training-history
inference). `persona_walking_preferred` (Running-restricted, no-bike, Walking+Strength
preferred) verifies it end-to-end and scored 9/9/8.5 in the first reviewed run.

### 2. Established-history candidate — implemented, and the gap was real in production too

The harness fix alone (`getSnapshot()` on `runScenario()`'s synthetic provider) would have
been enough to unblock the persona, but tracing *why* the production planner also could
not reach this branch found it was genuinely unreachable outside the harness too:
`resolveTrainingIntent()` only ever requested a 7-day operational history window, while
`inferAthleteTrainingState()` needs >=28 observed days to ever classify an athlete as
`established` -- no real user, regardless of actual training consistency, could reach
`dataQuality: 'high'` before this fix. Resolved with a separate 28-day athlete-state
evidence window (`trainingIntent.ts`'s `ATHLETE_STATE_HISTORY_WINDOW_DAYS`,
`trainingHistorySnapshot.ts`'s `athleteStateEvidence`) that is fetched alongside, and never
replayed into, the existing 7-day operational history fatigue/microcycle/objective
bookkeeping already depends on. `persona_established_history` seeds exactly the boundary
(12 sessions / 28 days) and was verified directly against the resolved strategy, not just
via judge score: `dataQuality: 'high'`, `trainingAgeProxy: 'established'`,
`hardSessionCap: 2`, and the `high_intensity` requirement present. Scored 9/9/9 in the
first reviewed run.

### 3. New finding surfaced by these two fixes together: a no-equipment athlete has zero reachable `primary_strength` candidate

`persona_stacked_constraints` (zero training equipment, Running restricted, `health`
priority) predates this pass, but its score only exposed this clearly once Walking gave it
a real aerobic candidate: the generated 14-day plan is now 13 days of the identical Brisk
Continuous Walk session and zero Strength, despite `Strength` being this persona's *first*
preference and `health` priority requiring it (Finding 8, PR #292). The judge flagged this
consistently across all 3 perturbations (`goal_event_fit` median 6/10, `underreaction`),
and it is correct to: `EVERGREEN_GENERAL_COVERAGE_SET`'s `primary_strength` role
(`app/src/workouts/event-plan.ts`) has exactly one workoutId,
`strength_full_body_maintenance_01`, whose legacy template (`str_full_01`) requires
`free_weights` -- there has never been a bodyweight-only path into the *required* strength
role. (`compact_strength` is the only other strength-adjacent role and it is `optional`,
so it cannot backfill a required shortfall either way.) This is the same class of gap
Finding 1 above was before it was fixed: real, not a fixture problem, and not something
this pass introduced -- just newly visible now that the aerobic half of the same persona
is finally working. A follow-up should author a genuine bodyweight-capable strength
template/workout (the existing newer-catalog strength workouts already list `'bodyweight'`
in their descriptive `equipment` array via per-exercise substitutions, e.g. `push_up` for
`bench_press` in `support-strength.ts`, but the legacy `SessionTemplate.requiredEquipment`
gate that actually decides eligibility does not expose that granularity) and decide whether
it becomes the `primary_strength` role's floor for a no-equipment athlete or a parallel
required role of its own.

## Finding 4: zero-equipment `primary_strength` gap -- implemented

Resolved per the handover comment's plan. Authored a genuine zero-equipment workout,
`strength_bodyweight_full_body_01` (bound via `engineTemplateIds: ['str_full_02']`),
covering a controlled bodyweight squat, push-up progression, glute bridge, unloaded hip
hinge, self-resisted prone row (true unloaded pulling has no honest zero-equipment
substitute, so this is documented as a limitation rather than fabricated equipment), and
trunk work -- dosed like resistance training (2-4 reps in reserve) rather than a
conditioning circuit. Four new bodyweight-only exercises were authored
(`bodyweight_squat`, `bodyweight_hip_hinge`, `prone_scapular_row`, plus reusing the
already-existing `glute_bridge`) with facet overrides so the exhaustive
strength/field/running/recovery facet-coverage test stays satisfied.

`str_full_02`'s own metadata was corrected: it previously required no equipment while
describing table/bands, and carried `avoid_high_impact`/`avoid_heavy_lower_body` safety
tags that excluded it under exactly the guardrail a genuinely bodyweight-only session
should survive. Both tags are now removed, and the description/dose labels were rewritten
to match the real movements instead of "circuit rounds" framing. `systemicCost` was left
at its original 0.55 -- an experiment lowering it (to reflect the lighter true stimulus)
destabilized unrelated utility-ranking tie-breaks in two other legacy scenarios (a travel
overlay plan and a fixed-activity fatigue projection), so the safer fix was metadata-only;
the scalar remains a coarser heuristic than the underlying `costProfile`/`stimulusProfile`,
consistent with how `str_full_01` is already treated by the shared "Full-body Strength"
enrichment branch.

`workoutForTemplate('str_full_02')` previously fell back to `travel_strength_maintenance_01`
(a hotel-gym workout) via a stale entry in `FALLBACK_TEMPLATE_TO_WORKOUT` -- removed, since
the new workout's `engineTemplateIds` match now resolves correctly and takes priority
automatically. `strength_bodyweight_full_body_01` was added as a second workoutId for the
evergreen `primary_strength` role (`EVERGREEN_SESSION_COVERAGE`) -- the required-role floor
for a no-equipment athlete -- and, separately, for the frozen September event-set's
`compact_strength` role (ADR-0016 amendment, 2026-08-30): fixing the fallback bug meant
`str_full_02` stopped accidentally satisfying that role via the wrong workout identity, so
a genuine membership addition was needed to avoid losing travel-phase strength coverage
that had (by accident) worked before. The September set's `primary_strength` role (loaded
strength only) was deliberately left untouched.

Three existing tests encoded assumptions that this fix legitimately falsified and were
updated rather than the underlying behavior being reverted: a Tier-2 dose-adjustment test
assumed `str_full_02` was always harder than a 0.45-cost hypothetical (now targets
`str_full_01` specifically, since the bodyweight identity is a real, distinct intensity);
an adversarial-guardrail test asserted the entire `Full-body Strength` category was excluded
under `avoid_heavy_lower_body` (now excludes `Lower-body Strength` plus loaded full-body
work by id, since the bodyweight identity is correctly exempt); and an intensity-stacking
test picked "the first Full-body Strength candidate" (now targets `str_full_01` by id, since
the category now spans two materially different intensities). A fourth test (a travel-block
multi-day forecast) had its assertion widened from "shows a Full-body Strength day" to "shows
real strength maintenance, not hard/maximal work" (Full-body Strength or Upper-body Strength),
since `primary_strength` is not an active requirement during the travel phase and which
optional/conditional strength role the planner picks there can legitimately shift once
`compact_strength` credit resolves through the correct workout identity.

`POLICY_VERSION` bumped to `2026-08-evergreen-bodyweight-strength-v1`.

### Side effect on `persona_walking_preferred` (reviewed, accepted -- not a regression in the target persona)

The reviewed `persona:local:stability` run scored `persona_walking_preferred` lower than the
prior committed baseline (mean overall 7.83 vs 9.0; sensitivity 7.5 vs 9.2), with the judge
noting the `low_time` case "fails to prioritize walking as the primary aerobic modality,
treating it as optional filler instead." This was traced with a deterministic
before/after diff (`--build-only` corpus rebuild, git-stashed engine changes vs current) of
the exact same three cases, not accepted from the judge score alone.

The `baseline` and `adverse_recovery` cases are byte-identical in Walking/Strength/Rest
session *counts* before and after (only day placement differs). The `low_time` case (a
global 30-minute/day cap) is the one that actually shifted: 8 Walking / 3 Strength / 3 Rest
days before, versus 5 Walking / 4 Strength / 5 Rest days after, across the same 14-day
window. This persona already has `free_weights` available, so `str_full_02` was never the
*only* low-time-compatible strength candidate here -- `str_full_03` (20-30 min) already
satisfied `primary_strength` under the 30-minute cap before this change. Adding
`str_full_02` (15-25 min) as a second equally time-compatible identity gave the packing
algorithm more strength-candidate weight in a week where time is scarce for every day, not
just today; once both weekly roles (`aerobic_volume`, `primary_strength`) are satisfied with
fewer total sessions, more of the remaining days rest instead of Walking filling the gap.

This is a real, understood behavior shift in a persona this fix was never targeting (unlike
`persona_stacked_constraints`, which has no equipment at all and is the one this fix exists
for). It trades some of `persona_walking_preferred`'s previous walking-heavy pattern for a
more balanced aerobic/strength split with more rest -- arguably closer to this persona's own
`judgeExpectations` ("Strength should remain represented alongside walking"), even though
the judge's calibration (tuned against the old walking-heavy pattern) read the new balance as
under-prioritizing walking. No hard-constraint violation was introduced (the deterministic
zero-violations regression assertion still passes for every case), and Walking is never
eliminated from the week in any case. Reverting the `str_full_02` fix to preserve this
persona's previous walking-to-strength ratio would reintroduce the exact zero-equipment gap
this pass exists to close, so this was accepted rather than reverted. A follow-up could
retune the low-time weekly-role packing weights between Walking and compact strength
candidates specifically, but that is a broader ranking change than this fix's scope.

## Review findings not implemented in this pass (historical -- both since resolved above)

### 1. Walking-only coverage is an architectural decision, not just a missing fixture

`resolveEvidenceBackedStrategy()` permits `Walking` as an aerobic substitution modality, but `SessionTemplate['modality']` currently has no `Walking` member and the workout/session catalog therefore cannot select a Walking template directly. The existing health persona can express Walking as a preference, but the planner cannot fulfill that preference as a first-class modality.

Adding a Walking-only persona before deciding the product model would mostly encode a known impossible request. A follow-up should choose explicitly between:

1. adding first-class Walking session/workout support and aerobic coverage credit; or
2. documenting/mapping walking to an existing modality such as Cross Training with an explicit semantic contract.

The first option is clearer if walking is intended to satisfy health aerobic-volume requirements directly.

### 2. Established-history candidate cannot currently prove the intended branch through `runScenario()`

The established-athlete branch requires `inferAthleteTrainingState()` to see at least 28 observed days plus >=12 sessions / >=720 minutes. `resolveEvergreenPlan()` takes the observed window from `historySnapshot?.windowDays`.

The simulation harness in `runScenario()` currently supplies a synthetic `TrainingHistoryProvider` with `reconstruct()` only, so `prepareTrainingHistorySnapshot()` returns `null`. Evergreen strategy therefore receives an observed window of `0`, regardless of how many `initialHistory` rows are seeded, and cannot reach `dataQuality: 'high'` / `trainingAgeProxy: 'established'` through this harness.

A follow-up should make the simulation provider expose a deterministic `getSnapshot()` (or otherwise pass an explicit observed-window contract) before adding the established-history judge family. The fixture should then prove the optional `high_intensity` requirement and `hardSessionCap: 2` end-to-end rather than merely checking `inferAthleteTrainingState()` in isolation.

## Regression coverage added

`personaScenarios.test.mjs` now verifies (updated for the 7-family/21-case suite):

- the expected seven family IDs and 21-case cross-section;
- `balanced_performance` is present explicitly on every case in its family;
- stacked injury/equipment constraints cannot disappear between perturbations;
- Running stays restricted and Walking stays preferred in every walking-persona perturbation;
- the established-history persona seeds exactly 12 sessions of 60 minutes each;
- all 21 cases execute through the real multi-week planner;
- every simulated case reports zero hard-constraint violations.

`update-persona-judge-baseline.mjs` is updated to reject reviewed artifacts unless they contain exactly seven families and 21 cases.

Engine-level regressions were also added: `coverage.test.ts` asserts `end_walk_01` resolves
`aerobic_volume` at the same 30-minute floor as Running/Cycling; `evergreenPlanner.test.ts`
asserts a concrete week-ahead plan for a Running-restricted, no-bike, Walking+Strength
persona contains `end_walk_01` and never a Running session;
`evergreenEstablishedHistory.test.ts` (added alongside the production fix) asserts the
7-day/28-day window split end-to-end through `resolveTrainingIntent`.

## Validation notes

The persona fixture module itself was syntax-checked independently and `assertPersonaFixtureIntegrity(buildPersonaFamilies())` returns `{ familyCount: 7, caseCount: 21 }`.

Both `npm run check` (typecheck, lint, full Vitest suite, workout catalog validation),
`npm run test:rules` (Firestore emulator), and a full local-LLM-backed
`persona:local:stability` run were executed and reviewed before promoting the baseline --
see the Follow-up section above for the persona scores from that run and the one new
finding (#3) it surfaced. This change does **not** fabricate or promote a baseline without
a reviewed judge run.
