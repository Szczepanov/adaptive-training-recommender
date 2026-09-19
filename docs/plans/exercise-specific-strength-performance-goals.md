# Exercise-specific strength performance goals — implementation plan

**Capability prefix:** `SG`  
**Status:** `Draft`  
**Blocked by:** project-owner approval of this design; SG0 must record the persisted-target and planning-authority decisions in an ADR before recommendation-affecting work starts. Strength-specific prescription/progression policy must use reviewed Sports Knowledge Registry claims rather than uncited constants.  
**Unlocks:** athlete-owned goals such as “conventional deadlift 220 kg 1RM”; exact-exercise strength coverage; current-e1RM progress display; later protocol-locked strength outcome evaluation.  
**Source analysis:** [`2026-09-19-exercise-specific-strength-goal-gap.md`](../analysis/2026-09-19-exercise-specific-strength-goal-gap.md)

> **Core invariant:** the target weight expresses an outcome. It never becomes the denominator
> for today’s working load. Current measured/estimated capacity plus the existing RIR,
> eligibility, injury, fatigue and schedule gates remain prescription authority.

---

## Goal

Let an athlete express a measurable strength-performance outcome such as:

> **Conventional deadlift — 220 kg 1RM**

and have the product carry that intent through the full relevant loop:

```text
typed athlete goal
  -> exact exercise identity
  -> goal-derived strength planning demand
  -> exact-exercise session coverage
  -> current-capacity-based prescription
  -> logged execution
  -> e1RM self-calibration
  -> visible progress
  -> later protocol-locked outcome evidence
```

The first release should be deliberately narrow: **exercise-specific 1RM strength goals for canonical strength exercises**. Do not build a generic “any metric, any unit, any sport” framework before this real use case works end to end.

---

## Non-goals

This plan does not:

- turn the user-entered target weight into a working-weight prescription;
- implement an autonomous peaking program for powerlifting competition;
- add an unreviewed “add 2.5 kg every week” rule;
- infer required weekly kg gain from a target date;
- treat any strength workout as equivalent to direct practice of the target lift;
- replace the existing `TrainingIntentProfile` priorities;
- replace ADR-0021 strength logging/e1RM derivation;
- make outcome evidence automatically rewrite training without the existing confirmation/evidence gates;
- generalize to rep-max, velocity, jump, sprint or endurance targets in the first cut.

---

## Design principles

### P1 — Outcome, capacity, priority and dose are separate

Keep these four concepts explicit:

| Concept | Example | Existing / new authority |
|---|---|---|
| Performance outcome | Deadlift 220 kg 1RM | **New typed goal target** |
| Current capacity | Deadlift e1RM 165 kg | Existing `AthletePerformanceProfile` + strength logs |
| Background planning priority | Strength and muscle | Existing `TrainingIntentProfile.priorities` |
| Session dose | 3×3 at a current-capacity-derived load, RIR constrained | Existing prescription/safety machinery + reviewed strength programming |

A higher target does not make today’s load higher.

### P2 — Stable exercise ids, never title parsing

The goal binds to `EXERCISES_BY_ID`, e.g. `conventional_deadlift`.

Do not derive identity from:

- goal title;
- `targetMetric = "deadlift"`;
- workout display text;
- free-text strength-log movements.

The first release should reject an exercise-specific target when no stable catalog exercise id exists.

### P3 — Specificity is a coverage constraint, not a substitute for safety

A specific deadlift goal can make direct deadlift exposure important. It cannot bypass:

- unavailable barbell/equipment;
- injury restrictions;
- `avoid_heavy_spinal_loading`;
- recovery mode;
- session-time limits;
- weekly capacity;
- plan/event authority.

If no eligible exact-exercise exposure can be placed, emit an explicit goal shortfall. Do not silently award exact-goal credit to a different hinge exercise.

### P4 — Reuse the existing broad strength dose

Do not invent a second weekly-frequency table just for a 1RM target.

Use the existing evidence-backed/general-product strength allocation as the broad weekly dose. The specific goal specializes part of that allocation toward exact exercise coverage.

If an athlete has an active exercise-specific strength goal but has not separately selected `strength_muscle`, the accepted ADR must define whether that explicit goal is itself sufficient to activate the existing strength requirement. The recommended behavior is **yes**: an explicit active performance goal should not require the athlete to discover and duplicate the same intent in Preferences.

### P5 — e1RM is a progress proxy, not automatically proof of a tested 1RM

ADR-0021’s derived e1RM is current-capacity calibration. It may move down as well as up and is intentionally not a lifetime-PR store.

The UI may show it as:

> Current estimated 1RM: 178 kg (derived from logged training)

but a semantic goal of “220 kg 1RM” should not auto-complete solely because a derived estimate crosses 220 kg unless a later decision explicitly accepts that evidence basis.

---

## Proposed persisted target

### SG0 decision candidate

Add a discriminated target to `UserGoal`:

```ts
type GoalPerformanceTarget =
  | {
      kind: 'strength_1rm';
      exerciseId: string;
      targetKg: number;
    };

interface UserGoal {
  // existing fields...
  performanceTarget?: GoalPerformanceTarget | null;

  // legacy compatibility only
  targetMetric?: string | null;
  targetValue?: number | null;
  targetUnit?: string | null;
}
```

Use existing `targetDate` for optional timing.

**Do not store:**

- current e1RM in the goal;
- current working load;
- progression increments;
- copied exercise name;
- a second target unit.

Persist kg canonically. Render kg/lb according to user display preferences.

### Why a discriminated union instead of expanding the three legacy fields?

The engine must be able to prove:

- the metric means 1RM;
- the subject is exactly one exercise;
- the unit is valid;
- target value is numeric and positive;
- future target types cannot accidentally be interpreted as strength 1RM.

The legacy `targetMetric / targetValue / targetUnit` triple cannot provide those guarantees.

### Legacy behavior

Existing goals must continue to read and render.

Do not automatically infer planning authority from legacy strings. In particular:

```text
targetMetric = "deadlift"
```

must not silently become `exerciseId = conventional_deadlift`.

A later explicit migration UI may offer “Convert this target” when an unambiguous mapping is available, but conversion must be user-confirmed.

---

# Work plan

## SG0 — architecture decision and acceptance boundary

**Status:** `[ ]`  
**Blocked by:** plan approval  
**Recommendation-affecting:** no code yet

Write and accept an ADR covering:

1. `performanceTarget` is the canonical typed athlete outcome.
2. Current capacity remains in `AthletePerformanceProfile` / observations, not copied into the goal.
3. Active typed performance goals may create planning demand.
4. Exact-exercise goal coverage uses canonical exercise ids.
5. Target weight cannot be used as current load capacity.
6. Legacy target strings remain non-authoritative.
7. e1RM is a progress/calibration proxy; tested target achievement has distinct evidence semantics.
8. Goal-derived planning authority still loses to safety, active external-plan authority, and other higher-order hard constraints.
9. Multiple simultaneous specific-strength goals need deterministic priority/conflict semantics before more than one is allowed to influence weekly selection.

**Done when:** the ADR is accepted and names the initial target kind, persistence contract, authority order and compatibility rule.

---

## SG1 — typed goal model, validation and persistence

**Status:** `[ ]`  
**Blocked by:** SG0  
**Recommendation-affecting:** no; persistence only

### SG1.1 Model

**Files:**

- `app/src/engine/models.ts` or a small goal-domain model imported by it;
- avoid introducing a workouts → engine import cycle.

Add `GoalPerformanceTarget` and `UserGoal.performanceTarget`.

Keep the first target-kind set to one literal: `strength_1rm`.

### SG1.2 Structural validation

**Files:**

- `app/src/engine/validationCore.ts`
- new pure helper if semantic catalog validation would create an undesirable dependency

Validate:

- known `kind`;
- non-empty `exerciseId`;
- finite positive `targetKg`;
- target allowed only on `domain === 'strength'`;
- bounded strings/numbers.

### SG1.3 Catalog-semantic validation

Structural validation cannot prove an exercise exists without coupling the lowest-level model validator to the workout catalog.

Add one explicit semantic boundary, e.g. `goals/validatePerformanceTarget.ts`, that resolves `EXERCISES_BY_ID` and requires:

- exercise exists;
- exercise modality/family is strength;
- repetition measurement is supported;
- load kinds include `mass` or `percent_one_rm`.

This is also where `conventional_deadlift` becomes valid without hardcoding its name.

### SG1.4 Firestore rules

**File:** `app/firestore.rules`

Extend goal validation with shallow, bounded validation for `performanceTarget`:

- exact keys;
- `kind == 'strength_1rm'`;
- `exerciseId` bounded string;
- `targetKg` positive bounded number.

Firestore rules cannot validate membership in the application exercise catalog; semantic catalog validation remains an application/parser concern.

### SG1.5 Parser/service compatibility

**File:** `app/src/services/goalService.ts` and any goal parser/validation boundary.

Ensure:

- old documents without `performanceTarget` remain valid;
- unknown/malformed typed targets fail closed as invalid target data, not silently as an authoritative goal;
- create/update never trusts a client-written copied exercise label.

### Tests

Add/update:

- `validationCore` goal tests;
- goal service tests;
- Firestore emulator rule tests;
- legacy goal regression fixtures;
- unknown exercise / wrong-domain semantic-validation tests.

**Done when:** a typed `strength_1rm / conventional_deadlift / 220 kg` target round-trips; malformed targets cannot become planning-authoritative; legacy goals still work.

---

## SG2 — athlete-facing goal UX

**Status:** `[ ]`  
**Blocked by:** SG1  
**Recommendation-affecting:** no

**Primary file:** `app/src/components/Goals.tsx`

For `Domain = Strength`, replace the misleading generic target workflow with a structured surface:

1. **Performance target type:** “One-rep max”
2. **Exercise:** searchable/selectable canonical strength exercise
3. **Target:** numeric kg/lb display
4. optional existing `targetDate`
5. clear explanatory text:
   - “This is your outcome target.”
   - “Training loads are based on current capacity and session guidance, not this target number.”

### Exercise picker

Build from canonical exercise data rather than a hardcoded lift list.

Initial eligibility should follow SG1 semantic validation. Show user-friendly names, persist only `exerciseId`.

### Goal-card rendering

Render a complete target, e.g.:

> Conventional Deadlift — 220 kg 1RM

not merely:

> Target: 220 kg

When current e1RM is available, a later SG3 read can add:

> Current estimated 1RM: 176 kg

### Legacy target fields

For existing legacy goals, continue rendering their old target. Do not show a typed exercise picker as though the data had been converted.

For new strength goals, stop encouraging arbitrary metric/unit strings.

### Tests

Component tests must cover:

- switching domain to strength;
- choosing conventional deadlift;
- kg/lb display conversion with canonical kg persistence;
- edit round-trip;
- legacy goal rendering;
- accessibility labels / keyboard selection;
- explicit outcome-vs-training-load explanatory copy.

**Done when:** an athlete can express the friend’s use case without typing a magic metric string.

---

## SG3 — make current strength capacity discoverable for any eligible lift

**Status:** `[ ]`  
**Blocked by:** SG1  
**Recommendation-affecting:** no

The model already supports arbitrary exercise-keyed e1RM. Remove the UI-only three-lift limitation.

### SG3.1 Replace the hardcoded list

**File:** `app/src/components/preferences/PerformanceSections.tsx`

Current hardcoded rows:

- front squat;
- Romanian deadlift;
- bench press.

Replace with an “Add / edit estimated 1RM” exercise picker backed by the same canonical eligible-lift resolver used by SG1/SG2.

At minimum, `conventional_deadlift` must be selectable.

### SG3.2 Preserve source semantics

Reuse `updateEstimated1Rm` and existing source ownership.

A manually entered value remains `manual`; logged-set derivation must not overwrite it under ADR-0021.

### SG3.3 Goal-context convenience

On a typed strength-goal card/modal, read the matching current e1RM when available. If absent, show a non-blocking path such as:

> No current estimate yet — set one in Performance or log a qualifying strength set.

Do not require a baseline to create the goal. Missing capacity should cause relative/autoregulated prescription behavior, not target deletion.

### Tests

- conventional deadlift manual e1RM persistence;
- derived/manual provenance display;
- no hardcoded three-exercise assumption;
- goal reads the matching exercise only.

**Done when:** the athlete can distinguish “I currently estimate 175 kg” from “I want 220 kg”.

---

## SG4 — exact-exercise coverage model

**Status:** `[ ]`  
**Blocked by:** SG0, SG1  
**Recommendation-affecting:** yes — requires `POLICY_VERSION` update and policy-drift verification

This is the key bridge from a stored target to actual programming.

### SG4.1 Typed goal planning context

Do not keep overloading `UserContext.goals.shortTerm/midTerm/longTerm` strings.

Introduce a typed planning projection, for example:

```ts
interface StrengthPerformanceGoalDemand {
  goalId: string;
  exerciseId: string;
  metric: 'one_rep_max';
  targetKg: number;       // explanatory/progress context, NOT dose
  priority: number;
  targetDate: string | null;
}
```

Assemble it from active validated goals at the same composition boundary that currently supplies `activeGoals`.

The engine should never reparse Firestore strings during ranking.

### SG4.2 Goal activates existing strength adaptation demand

Recommended policy:

- an active typed strength-performance goal is sufficient to request the existing `strength` adaptation requirement;
- if `strength_muscle` is also selected, do not double the weekly requirement;
- reuse the existing strength requirement/frequency policy;
- the specific goal constrains **which strength coverage satisfies part of that requirement**, not how many new sessions appear.

Record this authority rule in SG0 before implementation.

### SG4.3 Exact-exercise coverage descriptor

Add a dynamic exact-exercise coverage requirement alongside broad `primary_strength`.

Derive eligible workout ids by inspecting required/main catalog steps for exact `exerciseId`.

A workout receives exact goal coverage only when it contains the target exercise as a meaningful required strength step. Optional accessory presence should not automatically satisfy the goal.

Do not award exact `conventional_deadlift` goal credit for:

- `romanian_deadlift`;
- `kettlebell_deadlift`;
- free-text “deadlift”;
- an optional step that was omitted from the resolved variant.

### SG4.4 Shortfall semantics

Extend weekly planning diagnostics with an exercise-specific reason, e.g.:

- no workout containing exact exercise exists;
- required equipment unavailable;
- safety/guardrail excludes every exact session;
- weekly capacity cannot fit the required exact exposure;
- a higher-authority event/external plan occupies the available capacity.

Never hide the failure behind generic `strength` credit.

### Tests

At minimum:

1. active deadlift goal + strength priority does not double broad strength dose;
2. active deadlift goal alone activates broad strength demand per SG0;
3. exact deadlift session satisfies exact coverage;
4. RDL-only session does not;
5. target weight 180 vs 250 kg produces the same coverage identity;
6. equipment/injury exclusion yields a shortfall rather than unsafe selection;
7. legacy free-text goal creates no exact-exercise demand.

**Done when:** the weekly planner can state “this week contains direct work for your conventional-deadlift goal” based on exact structured identity, not text similarity.

---

## SG5 — add a conventional-deadlift development session to the active catalog

**Status:** `[ ]`  
**Blocked by:** SG4 design; reviewed strength-programming knowledge/claims for the actual dose  
**Recommendation-affecting:** yes

The exercise exists, but the active strength workouts reviewed in the source analysis contain Romanian deadlift rather than conventional deadlift.

Add an active catalog workout suitable for exact deadlift coverage, likely in a dedicated strength-performance catalog file rather than mutating the cycling-support session into something it was not designed to be.

### Requirements

The session must:

- include `conventional_deadlift` as a required main step;
- remain a normal canonical `WorkoutDefinition`;
- expose exact exercise identity through the step;
- use current-capacity-compatible load semantics (`percent_one_rm`, RIR or other reviewed prescription), never target-goal kg;
- have normal full/reduced/return-to-training variants if supported by evidence/design;
- declare equipment and safety requirements;
- integrate with existing workload/stimulus/cost and authored-session gating;
- preserve lower-back/spinal-load restrictions;
- define substitutions as training alternatives **without claiming exact goal coverage** when the target lift is not performed.

### Evidence boundary

Do not choose sets, repetitions, %1RM, frequency or progression increments because they “look like a powerlifting program”.

Any new generalizable programming default belongs in the Sports Knowledge Registry or in an explicit product-policy claim with limitations and freshness metadata, following the repository’s current evidence-governance rules.

### Tests

- catalog validation;
- prescription resolution with known e1RM;
- relative/autoregulated behavior when e1RM is absent;
- goal target does not alter resolved working load;
- safety tags/equipment;
- exact coverage;
- variant omission semantics.

**Done when:** the planner has at least one legitimate, safe, exact-session candidate for a conventional-deadlift goal.

---

## SG6 — selection/ranking integration

**Status:** `[ ]`  
**Blocked by:** SG4, SG5  
**Recommendation-affecting:** yes

Wire exact-exercise goal coverage into the same weekly allocation/selection authority that currently honors broad coverage roles.

### Ordering constraints

1. hard safety/eligibility;
2. active external-plan/event authority where applicable;
3. weekly capacity/time/equipment constraints;
4. required broad adaptation dose;
5. exact exercise-specific goal coverage;
6. normal utility/tie-break logic.

The specific goal must not bypass stronger constraints.

### Multiple goals

The initial implementation should either:

- support one active strength-1RM target with explicit validation, **or**
- define deterministic multi-goal allocation before enabling multiple planning-authoritative targets.

Do not let array iteration order decide which lift receives the only available strength slot.

Use existing `UserGoal.priority` only after SG0 defines how equal priorities and incompatible capacity are resolved.

### Explainability

Recommendation/provenance should expose the goal reason:

> Selected because it provides direct conventional-deadlift coverage for active 1RM goal.

It should also be able to say:

> Direct deadlift work withheld today because heavy spinal loading is restricted.

### Verification

- unit tests around the new goal-demand resolver;
- weekly dose-packing tests;
- planner/rules integration tests;
- deterministic multi-goal/conflict tests if enabled;
- `check-policy-drift`;
- `simulate:diff`;
- targeted plan-judge/persona scenario for a strength-focused athlete.

**Done when:** exact goal specificity affects selection, but target kg does not affect unsafe dose escalation.

---

## SG7 — progress surface using existing e1RM

**Status:** `[ ]`  
**Blocked by:** SG2, SG3  
**Recommendation-affecting:** no

Before building formal strength outcome testing, provide useful progress from the capacity data already being collected.

For a goal:

> Conventional deadlift — 220 kg 1RM

show, when available:

- current estimated 1RM;
- source (`manual`, `coach`, `derived`);
- computed/measured timestamp when available;
- target;
- absolute and percentage gap;
- a label that the current value is **estimated** when it is e1RM.

Example:

```text
Goal: 220 kg 1RM
Current estimated 1RM: 182.5 kg
Progress proxy: 82.9% of target
Updated from logged training: 2026-09-18
```

Do not display “83% complete” as certainty that the athlete is 83% through a biological adaptation process. Prefer “current estimate / target” or “gap to target”.

### Historical trend

Reuse strength-session/e1RM history where safely reconstructable. If the profile only stores the latest e1RM, do not invent a time series by reading current state repeatedly; either derive from immutable session logs or add an explicit observation history later in SG8.

**Done when:** the athlete can see whether capacity is moving toward the goal without confusing e1RM with a confirmed one-rep max.

---

## SG8 — formal strength outcome evidence

**Status:** `[ ]`  
**Blocked by:** real usage of SG1–SG7; OV architecture review for exercise-bound metrics  
**Recommendation-affecting:** no — evidence/reporting first

This extends, not replaces, the Performance Outcome Validation plan.

### SG8.1 Metric

Add a strength outcome metric such as:

```text
strength_1rm_kg
```

Do **not** create one metric id per exercise.

### SG8.2 Exercise subject / series identity

Extend the observation/evaluation contract so a metric binding can name the subject exercise, for example:

```ts
subjectRef: {
  kind: 'exercise';
  exerciseId: 'conventional_deadlift';
}
```

Add `exercise_id` as a required/series-defining comparison dimension for strength 1RM observations.

This prevents a bench observation from joining a deadlift series just because both use `strength_1rm_kg`.

### SG8.3 Tested vs estimated evidence

Keep at least two concepts distinct:

- **tested/measured 1RM** — formal goal outcome;
- **estimated 1RM** — lower-burden current-capacity/progress proxy.

If a standardized rep-max/e1RM checkpoint is later supported, give it its own protocol/metric semantics rather than silently calling it an actual 1RM.

### SG8.4 Goal evaluation

A typed goal may generate or reference an `OutcomeEvaluationSpec` whose primary binding is the exact exercise 1RM.

Formal target attainment can then say:

- achieved;
- not yet achieved;
- insufficient comparable evidence;
- invalid/questionable attempt.

Do not make this outcome evidence automatically rewrite recommendation policy. Existing OV authority boundaries remain intact.

**Done when:** “220 kg conventional deadlift” can be assessed with exercise-specific, auditable evidence rather than a generic number.

---

## SG9 — explicit load progression, only if later needed

**Status:** `[ ]` future capability  
**Blocked by:** SG4–SG8 usage evidence; new ADR/knowledge decision  
**Recommendation-affecting:** yes

H5 currently supports exact `objectiveId/sessionId/stepId` binding but only `duration_min` progression.

Do **not** extend it to load in the first release unless the existing current-e1RM + RIR prescription proves insufficient.

If later justified, design a strength-specific progression variable such as a relative step load rather than blindly adding `kg`:

- exact step binding;
- current-capacity reference;
- permitted range;
- increment/decrement;
- RIR/technical stop conditions;
- adverse response handling;
- stale-source revision protection;
- athlete confirmation through the existing singleton progression-claim mechanism;
- full replay/provenance.

A confirmed load progression must still be bounded by current capacity and safety. The target outcome remains descriptive context, not the increment source.

---

# Proposed implementation sequence

| Order | Item | Product value | Policy risk |
|---:|---|---|---|
| 1 | SG0 ADR | Removes semantic ambiguity | none |
| 2 | SG1 typed persistence | Canonical goal data | none |
| 3 | SG2 goal UX | Friend can express the real goal | none |
| 4 | SG3 arbitrary-lift e1RM UX | Current capacity is usable | none |
| 5 | SG7 progress proxy | Immediate feedback from existing data | none |
| 6 | SG4 exact coverage model | Goal can influence planning | **policy change** |
| 7 | SG5 deadlift workout | Gives planner an exact candidate | **prescription change** |
| 8 | SG6 live selection | End-to-end useful recommender behavior | **policy change** |
| 9 | SG8 formal outcome evidence | Honest target evaluation | evidence-only initially |
| 10 | SG9 load progression | Optional advanced progression | **high policy risk** |

SG2/SG3/SG7 can provide substantial user value before SG4–SG6 receive recommendation authority.

---

# File-level change map

Likely files, subject to implementation-time verification:

| Area | Files |
|---|---|
| Goal model | `app/src/engine/models.ts`, new goal-target helper module |
| Goal validation | `app/src/engine/validationCore.ts`, semantic target validator |
| Goal persistence | `app/src/services/goalService.ts` |
| Goal UI | `app/src/components/Goals.tsx`, CSS/tests |
| Firestore | `app/firestore.rules`, emulator tests |
| Current e1RM UI | `app/src/components/preferences/PerformanceSections.tsx`, `usePreferences.ts` tests as needed |
| Exercise identity | reuse `app/src/workouts/exercises.ts`, `exercise-catalog-extensions.ts` |
| Goal planning projection | `app/src/engine/adapters.ts` or a new typed goal-demand assembler |
| Broad strategy | `app/src/engine/evergreenStrategy.ts` |
| Dose packing / coverage | `app/src/engine/weeklyDosePacking.ts`, relevant coverage descriptors |
| Strength workout | new/updated file under `app/src/workouts/catalog/`, `catalog.ts` |
| Prescription | reuse `app/src/workouts/prescription.ts`; change only if required |
| Recommendation provenance | planner/rules/provenance path that owns selected-role explanations |
| Outcome metric | `app/src/observations/registry.ts`, `models.ts` |
| Evaluation subject binding | `app/src/outcomes/evaluationSpec.ts` and validators |
| Knowledge | `app/src/knowledge/sportsKnowledge.ts` if new programming defaults are introduced |
| Plan/persona validation | weekly planner tests, simulation fixtures, plan-judge/persona cases |

---

# Acceptance scenarios

The implementation is not complete until these behavior-level cases pass.

### A. Express the goal

Given an athlete creates a strength goal, they can select:

- Conventional Deadlift
- 1RM
- 220 kg
- optional date

and the stored object contains `exerciseId: conventional_deadlift`, not a guessed string.

### B. Goal and capacity are independent

Given:

- target = 220 kg;
- current e1RM = 170 kg;

the UI shows both separately.

Changing target from 220 to 250 kg does not change today’s current-capacity-derived working load.

### C. Direct exercise coverage

With an active conventional-deadlift goal, available barbell, and no relevant restriction, a weekly strength allocation can select a workout containing the exact `conventional_deadlift` step.

An RDL-only workout does not satisfy exact-goal coverage.

### D. Safety wins

With `avoid_heavy_spinal_loading` or another applicable exclusion, no conventional-deadlift workout is selected even when it is the athlete’s highest-priority goal.

The plan reports the goal-coverage shortfall.

### E. Missing e1RM degrades safely

An athlete may create the goal with no baseline estimate.

The planner may still use a safe relative/RIR prescription or explain missing calibration. It never uses 220 kg as assumed current capacity.

### F. Logged sets update capacity

A qualifying logged conventional-deadlift set updates the existing derived e1RM path when ownership permits, and the goal progress display reads the new value.

### G. Manual capacity remains protected

If the athlete/coach supplied a protected deadlift e1RM, a derived estimate does not overwrite it, preserving ADR-0021.

### H. Legacy goals do not gain accidental authority

An old goal with:

```text
targetMetric = deadlift
targetValue = 220
targetUnit = kg
```

continues to render but does not create exact deadlift planning demand until explicitly converted.

### I. Multiple goal conflict is deterministic

If multiple planning-authoritative specific lift goals are allowed, the same input always yields the same allocation and explicit shortfall/priority result. Collection iteration order is never authority.

---

# Verification gates

For SG1–SG3/SG7 documentation/UI/persistence work:

- TypeScript typecheck;
- lint;
- unit/component tests;
- Firestore emulator tests for changed rules;
- catalog semantic-validation tests.

For SG4–SG6 recommendation-affecting work:

- all of the above;
- `npm run check`;
- policy-drift guard;
- `simulate:diff`;
- relevant plan-judge/persona suites;
- deterministic replay/provenance tests;
- explicit `POLICY_VERSION` bump with rationale;
- no baseline update until diffs are reviewed.

For SG8:

- OV metric/protocol/evaluation tests;
- comparable-series tests proving exercise identity cannot cross-contaminate;
- evidence/reporting only, no selection import.

---

# Rollout recommendation

Use a staged release rather than shipping persistence and authority together.

### Stage 1 — honest goal capture

Ship SG1–SG3 and SG7:

- typed deadlift goal;
- current e1RM;
- progress display;
- no claim yet that the planner specializes for the lift.

The UI should explicitly say when the goal is tracked but not yet influencing automatic programming if SG4–SG6 are not active.

### Stage 2 — measured planning authority

After SG0 and policy verification, activate SG4–SG6 behind the repository’s normal policy-version/replay discipline.

Collect:

- rate of exact-goal coverage;
- shortfall reasons;
- safety exclusions;
- athlete adherence;
- whether exact sessions are being replaced/edited;
- strength-session response;
- e1RM trend.

### Stage 3 — formal outcome loop

Add SG8 only when athletes are actually using specific lift goals long enough to justify standardized outcome assessment.

### Stage 4 — progression automation only if needed

Consider SG9 after real use shows that current-capacity self-calibration plus autoregulated prescriptions cannot adequately express progression.

---

# Recommended first vertical slice

The smallest slice that solves the friend’s concrete problem without pretending more exists than is true is:

1. typed `strength_1rm` target;
2. canonical exercise picker including `conventional_deadlift`;
3. target weight;
4. current conventional-deadlift e1RM input/readout;
5. progress proxy;
6. a clear label that automatic programming is still broad-strength until SG4–SG6 land.

The first **fully functional recommender** slice then adds:

7. exact exercise coverage;
8. a reviewed conventional-deadlift workout;
9. live selection/provenance.

This sequence makes the UI truthful at every intermediate state.

---

# Final design test

At the end of SG6, the following statement must be true:

> When an athlete says “my goal is a 220 kg conventional deadlift”, the system stores that as a typed performance outcome, recognizes the exact lift, deliberately schedules safe direct work for that lift when constraints allow, uses the athlete’s **current** strength to determine training load, learns current capacity from logged training, explains when the goal cannot be covered, and never treats the aspirational 220 kg itself as proof of present capacity.

If any implementation only adds a textbox, only adds a deadlift workout, or only adds a new progression variable, it has not closed the actual gap.
