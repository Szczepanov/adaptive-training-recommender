# Strength, speed and power performance goals — implementation plan

**Capability prefix:** PG
**Status:** Draft — revised for cross-family scope
**Blocked by:** PG0 architecture decision before recommendation-affecting work; any new prescription defaults must use reviewed Sports Knowledge Registry claims rather than uncited constants.
**Unlocks:** athlete-owned measurable strength, speed and power goals; target-specific planning coverage; protocol-aware progress; later formal target evaluation.
**Source analysis:** ../analysis/2026-09-19-exercise-specific-strength-goal-gap.md

> **Core invariant:** the target is an outcome. It never becomes current capability, a working-load denominator, a sprint-volume prescription, or an automatic weekly progression rate. Existing safety, eligibility, readiness, tissue, schedule and higher-authority planning rules remain dose authority.

---

## Goal

Let an athlete express measurable performance outcomes such as:

- Conventional deadlift — 220 kg tested 1RM.
- Front squat — 160 kg tested 1RM.
- Standing 10 m sprint — 1.75 s.
- Flying 10 m sprint — 1.00 s.
- Countermovement jump — 50 cm.
- Cycling 5 s peak power — 1,200 W.

and carry that intent through the relevant loop:

~~~text
typed athlete goal
  -> registered metric
  -> canonical exercise or performance test
  -> family-specific planning projection
  -> relevant direct/supporting coverage
  -> current-capability/autoregulated prescription
  -> logged execution / comparable measurement
  -> visible progress
  -> protocol-aware target attainment
~~~

The architecture must support **any registered strength, speed or power performance target**, not just deadlift and not just 1RM. "Any" means any target whose metric, subject and planning semantics have been registered and reviewed; it does not mean arbitrary free-text metrics can gain recommendation authority.

The first implementation slice should deliberately prove the abstraction with at least one target from each family.

---

## Non-goals

This plan does not:

- make arbitrary targetMetric / targetValue / targetUnit strings recommendation-authoritative;
- infer a training prescription from the numerical gap to a target;
- divide target gap by days-to-target to create a required progression rate;
- use target 1RM as current 1RM;
- use target sprint time to force more sprint repetitions;
- use target peak power as a session wattage prescription;
- require a maximal outcome test every week merely to satisfy goal coverage;
- silently treat jump height as mechanical power in watts;
- silently merge results collected with materially different protocols;
- create one hardcoded code path per lift, sprint distance or device;
- bypass external-plan/event authority, injury policy, eligibility or readiness;
- redesign all endurance/event goals in the same change;
- ship autonomous peaking/programming logic without evidence and policy review.

---

## Design principles

### P1 — Outcome, current capability, planning demand and dose are separate

A performance goal says what result matters.

Current capability says what the athlete can presently demonstrate or is estimated to be capable of.

Planning demand says what broad adaptations and direct practice should be represented.

Dose says what is appropriate today.

Those concepts may interact, but none is a substitute for another.

### P2 — Metric plus subject defines target identity

A number such as 220, 1.75 or 1200 is meaningless without a metric and subject.

Examples:

~~~text
strength_1rm_kg + exercise:conventional_deadlift
sprint_elapsed_time_s + test:sprint_10m_standing
sprint_elapsed_time_s + test:sprint_flying_10m
peak_power_w + test:cycling_5s_peak_power
jump_height_cm + test:cmj_standard
~~~

Stable ids are persisted. Display labels are resolved from registries.

### P3 — The registry owns units, direction and allowed subject type

The user chooses a metric and target value; the product owns whether:

- higher or lower is better;
- the canonical unit is kg, seconds, W, W/kg, cm or another reviewed unit;
- the target binds to an exercise or test;
- the target range is structurally plausible;
- the metric is eligible for athlete-owned goals.

Do not persist a free-text typed unit in the new target.

### P4 — Outcome-test identity and training coverage are different

A standing 10 m target should drive acceleration-oriented practice, not weekly all-out testing.

A deadlift 1RM target can legitimately require conventional-deadlift practice.

A CMJ target can drive explosive lower-body work while formal CMJ testing remains periodic.

The metric/test registry and the planning-coverage mapping therefore remain separate authorities.

### P5 — Specificity never overrides hard constraints

A target can influence **what eligible work is preferred or reserved**.

It cannot make an unsafe workout eligible, override tissue restrictions, steal an externally authored occurrence, ignore equipment, or manufacture schedule capacity.

When direct coverage cannot be placed, the system reports an explicit shortfall.

### P6 — Progress requires comparable evidence

Strength can use existing per-exercise e1RM as a labelled progress proxy, but estimated and tested 1RM remain distinct evidence types.

Timed speed and power/jump results need protocol identity. Where measurement method can materially alter a value, the observation series must retain that context rather than pretending every value is interchangeable.

### P7 — Legacy free text stays non-authoritative

Existing targetMetric / targetValue / targetUnit goals continue to render.

They do not silently become typed performance targets. Any conversion is explicit and user-confirmed.

---

## Proposed target model

### PG0 decision candidate

Persist one generic target shape:

~~~ts
type PerformanceSubjectRef =
  | {
      kind: 'exercise';
      exerciseId: string;
    }
  | {
      kind: 'test';
      testId: string;
    };

type GoalPerformanceTarget = {
  kind: 'performance_metric';
  metricId: string;
  subjectRef: PerformanceSubjectRef;
  targetValue: number;
};

interface UserGoal {
  // existing fields
  performanceTarget?: GoalPerformanceTarget | null;

  // legacy compatibility only
  targetMetric?: string | null;
  targetValue?: number | null;
  targetUnit?: string | null;
}
~~~

Use existing targetDate for optional timing.

Do not store:

- current capability;
- current working load;
- target unit as user-entered text;
- higher/lower direction;
- copied exercise/test label;
- weekly progression increments;
- measurement-device assumptions.

Metric/test registries provide semantics.

### Metric definition

Extend the existing observation metric vocabulary, or introduce a shared metric module consumed by observations and goals, so there is only one canonical meaning for a metric id.

The target-eligible definition needs at least:

~~~ts
interface PerformanceMetricDefinition {
  id: string;
  family: 'strength' | 'speed' | 'power';
  unit: string;
  direction: 'higher_is_better' | 'lower_is_better';
  subjectKind: 'exercise' | 'test';
  targetEligible: boolean;
  targetRange?: {
    min: number;
    max: number;
  };
}
~~~

Suggested first registry entries:

| metric id | family | subject | unit | direction |
|---|---|---|---|---|
| strength_1rm_kg | strength | exercise | kg | higher |
| sprint_elapsed_time_s | speed | test | s | lower |
| peak_power_w | power | test | W | higher |
| jump_height_cm | power | test | cm | higher |

Jump height belongs to the power/explosive-performance family for product navigation, but its metric name remains jump height rather than pretending centimetres are watts.

### Test definition

Add a canonical test/protocol registry for test-bound metrics. The contract should carry only what is needed for stable identity and evidence comparison, for example:

~~~ts
interface PerformanceTestDefinition {
  id: string;
  version: number;
  family: 'speed' | 'power';
  displayName: string;
  allowedMetricIds: string[];
  comparisonDimensions: string[];
}
~~~

Candidate initial test ids:

- sprint_10m_standing;
- sprint_flying_10m;
- cycling_5s_peak_power;
- cmj_standard.

The final protocol fields belong in PG1 after reviewing the observation model; do not duplicate protocol structures already owned by the outcome stack.

### Goal domain

UserGoal.domain currently has no speed or power value. PG2 should add those values for truthful user-facing categorization:

~~~text
endurance
strength
speed
power
mobility
weight_loss
general_fitness
other
~~~

Domain is navigation/display taxonomy. Planning authority comes from the validated performance target and its registered mapping, not from the domain string alone.

---

# Work plan

## PG0 — architecture decision and acceptance boundary

**Status:** [ ]
**Blocked by:** plan approval
**Recommendation-affecting:** no code yet

Write and accept an ADR covering:

1. performanceTarget is the canonical typed measurable outcome for new strength/speed/power goals.
2. Metric semantics come from one registry shared with or aligned to observations.
3. Exercise subjects use canonical exercise ids; test subjects use canonical test ids.
4. Current capability/evidence is not copied into the goal.
5. Target value cannot become prescription intensity or automatic progression.
6. Goal-test identity and workout coverage are distinct contracts.
7. Active typed goals may create planning demand only through reviewed target-to-planning mappings.
8. Legacy free-text targets remain non-authoritative.
9. Safety, external-plan/event authority and hard eligibility outrank target coverage.
10. Multiple active performance targets use deterministic priority/capacity conflict semantics.
11. Estimated/proxy evidence and formal tested evidence remain distinguishable.
12. Protocol comparability is required before observations are treated as one progress series.

**Done when:** the ADR names the persisted contract, registry authorities, initial target families, authority order, compatibility rule and first vertical-slice metrics.

---

## PG1 — canonical metric and performance-test registries

**Status:** [ ]
**Blocked by:** PG0
**Recommendation-affecting:** no

### PG1.1 Reuse one metric vocabulary

**Likely files:**

- app/src/observations/models.ts
- app/src/observations/registry.ts
- a small performance-target registry module only if target eligibility/planning concerns do not belong in observations

Add target-eligible metric definitions for the first supported strength, speed and power outcomes.

Do not create parallel ids that mean the same measurement in goals and observations.

### PG1.2 Canonical performance tests

Add a small test registry for test-bound targets.

Each test definition must have:

- stable id and version;
- family;
- human display name;
- compatible metric ids;
- enough protocol/comparison identity to prevent accidental series mixing;
- no hidden training prescription.

Strength 1RM remains exercise-bound in the target; the eventual formal tested-1RM observation can still carry a testing protocol.

### PG1.3 Semantic validators

Provide pure helpers that can answer:

- is this metric target-eligible?
- is this subject kind valid for the metric?
- does the exercise/test id exist?
- is this target value finite and within bounded structural range?
- what family, unit and direction apply?

Do not import recommendation policy into these helpers.

### Tests

Cover:

- valid strength exercise target;
- valid speed test target;
- valid power test target;
- wrong subject kind;
- unknown exercise/test;
- unknown metric;
- invalid target range;
- direction/unit lookup.

**Done when:** code can prove what a target means without title parsing or user-entered units.

---

## PG2 — typed goal model, domain, validation and persistence

**Status:** [ ]
**Blocked by:** PG1
**Recommendation-affecting:** no; persistence only

### PG2.1 UserGoal model

**Files:**

- app/src/engine/models.ts or a goal-domain model imported by it;
- avoid a workouts -> engine import cycle.

Add GoalPerformanceTarget and performanceTarget.

Extend GoalDomain with speed and power.

### PG2.2 Validation

**Files:**

- app/src/engine/validationCore.ts
- semantic performance-target validator from PG1

Structural validation checks:

- kind is performance_metric;
- metricId is bounded/non-empty;
- exactly one valid subjectRef variant;
- targetValue is finite;
- no unexpected keys.

Semantic validation checks registry membership and metric/subject compatibility.

Domain consistency should be explicit. Recommended rule: typed target family must match domain for strength/speed/power goals.

### PG2.3 Firestore rules

**File:** app/firestore.rules

Rules can validate bounded structure and exact keys for performanceTarget. They cannot prove membership in the application registries.

Permit old documents without performanceTarget.

Update domain validation for speed and power.

### PG2.4 Service/parser compatibility

**Files:**

- app/src/services/goalService.ts
- any shared read/parse boundary

Unknown or malformed typed targets fail closed as non-authoritative invalid goal data. Do not silently fall back to legacy strings.

### Tests

Add/update:

- validationCore goal tests;
- goal service/parser tests;
- Firestore emulator tests;
- old-goal fixtures;
- new speed/power domain tests;
- unknown metric/subject tests.

**Done when:** each initial family round-trips as typed data and no malformed target can gain planning authority.

---

## PG3 — athlete-facing target UX

**Status:** [ ]
**Blocked by:** PG1, PG2
**Recommendation-affecting:** no

**Primary file:** app/src/components/Goals.tsx

Replace the misleading free-text Optional Target workflow for new measurable performance goals with a structured flow:

1. Domain/family: Strength, Speed or Power.
2. Performance metric.
3. Exercise or performance test, filtered by metric.
4. Target value.
5. Unit shown read-only from the registry.
6. Optional existing target date.
7. short explanatory copy: target is an outcome; training dose uses current capability/readiness/safety.

Examples rendered:

~~~text
Conventional Deadlift — 220 kg 1RM
Standing 10 m — 1.75 s
Cycling 5 s Peak Power — 1,200 W
~~~

### Legacy behavior

Existing free-text targets continue to render as legacy data. Editing them must not pretend they have already been converted.

An explicit "Convert to structured target" affordance can be added later if the mapping destination is user-confirmed.

### Accessibility and tests

Cover:

- family/metric/subject dependent controls;
- keyboard and screen-reader labels;
- higher/lower-is-better metric rendering;
- unit display;
- kg/lb presentation conversion where existing unit preference supports it while canonical storage remains metric-defined;
- edit round-trip;
- legacy rendering;
- speed and power domains.

**Done when:** the athlete can create a meaningful target without knowing internal ids or typing a magic unit string.

---

## PG4 — current measurement and progress projection

**Status:** [ ]
**Blocked by:** PG1, PG3
**Recommendation-affecting:** no

Progress is family-specific evidence projected through one UI contract.

### PG4.1 Strength capacity

Reuse AthletePerformanceProfile estimated1RmKg and provenance.

Replace the current three-lift-only Preferences UI with a canonical eligible-exercise picker so any registered strength-1RM goal can show/set current e1RM.

Preserve source ownership: derived logging must not overwrite protected manual/coach values under ADR-0021.

Label e1RM as estimated, not tested 1RM.

### PG4.2 Speed and power observations

Resolve the latest **comparable** observation for the target metric + test subject.

Do not invent a speed/power equivalent of estimated1RmKg merely to make the UI symmetrical.

If no baseline exists, show a non-blocking state and a path to perform/log the registered test when supported.

### PG4.3 Direction-aware progress

For higher-is-better metrics, show current value, target and gap.

For lower-is-better metrics, calculate the gap with the correct sign and copy.

Avoid "82% complete" language that implies linear biological progress. Prefer:

~~~text
Current comparable result: 1.86 s
Target: 1.75 s
Gap: 0.11 s
~~~

### Tests

Cover:

- strength e1RM source labels;
- no hardcoded three-lift limitation;
- sprint lower-is-better gap;
- power higher-is-better gap;
- absent baseline;
- incomparable protocol not selected as current;
- target value changes without rewriting current capability.

**Done when:** each target family can show honest current evidence without conflating it with the goal.

---

## PG5 — goal-to-planning projection and coverage semantics

**Status:** [ ]
**Blocked by:** PG0, PG2
**Recommendation-affecting:** yes — requires POLICY_VERSION update and policy-drift verification

This is the bridge from stored outcome to programming.

### PG5.1 Typed planning projection

Do not overload UserContext goal-title strings.

Build a validated projection such as:

~~~ts
interface PerformanceGoalDemand {
  goalId: string;
  metricId: string;
  subjectRef: PerformanceSubjectRef;
  family: 'strength' | 'speed' | 'power';
  targetValue: number; // explanation/progress only, never dose
  priority: number;
  targetDate: string | null;
}
~~~

The engine receives this from the composition boundary. It does not reparse Firestore strings.

### PG5.2 Planning-rule registry

Define a separate reviewed mapping from a target to relevant planning semantics.

Examples of intended meaning:

| Target | Broad demand reuse | Direct/specific coverage |
|---|---|---|
| conventional deadlift 1RM | existing strength requirement | meaningful conventional-deadlift main work |
| standing 10 m time | existing performance/intensity architecture where appropriate | acceleration sprint exposure |
| flying 10 m time | existing performance/intensity architecture where appropriate | max-velocity exposure |
| cycling 5 s peak power | existing cycling/performance architecture | short high-quality cycling sprint exposure |
| CMJ height | reviewed strength/power architecture | explosive jump/power exposure |

Do not invent a new broad adaptation string merely to make this table compile. Reuse current dose vocabulary where physiologically correct; any missing dose/objective requires its own evidence-backed decision.

### PG5.3 No double counting

If an athlete already selected strength_muscle or speed_power, a typed target should refine the matching dose/coverage rather than silently add a second duplicate floor.

If a typed goal is allowed to activate a broad requirement by itself, PG0 must state that rule explicitly.

### PG5.4 Shortfalls

Add typed diagnostic reasons for unmet performance-goal coverage, including:

- no eligible coverage candidate;
- required equipment unavailable;
- injury/tissue restriction;
- readiness/spacing restriction;
- schedule capacity;
- higher-authority external/event occurrence;
- deterministic conflict with a higher-priority target.

Do not hide a specific miss behind generic strength/high-intensity credit.

### Tests

At minimum:

1. strength target projects exact exercise identity;
2. standing 10 m and flying 10 m remain distinct subjects;
3. target value changes do not change coverage identity;
4. broad priority + typed target does not double dose;
5. hard exclusions produce shortfall, not unsafe selection;
6. legacy goal creates no typed demand.

**Done when:** the weekly planner understands what kind of specific practice matters without using the target number as training dose.

---

## PG6 — audit and fill catalog coverage gaps

**Status:** [ ]
**Blocked by:** PG5 design; reviewed knowledge for any new session prescription
**Recommendation-affecting:** yes

Do not assume every new target needs a new workout. First audit the active catalog against each planning rule.

Known findings:

- conventional_deadlift exists as a canonical exercise but the inspected active strength workouts use Romanian deadlift, so the initial deadlift example needs a legitimate direct-coverage candidate;
- sprint_falling_start_10m and sprint_fly_10m already exist as canonical field primitives and may be reusable inside existing/new field sessions;
- power-oriented content such as hang power clean already exists;
- cycling power targets should reuse existing sprint-capable cycling content where it genuinely matches before adding another near-duplicate session.

### New-session requirements

Where a real gap exists:

- use canonical WorkoutDefinition / SessionDefinition contracts;
- expose the exact exercise/movement identity required for coverage;
- keep target outcome value out of session-load calculation;
- use reviewed RIR, relative-load, sprint-rest and volume claims;
- declare equipment and contraindications;
- preserve reduced/return variants when supported;
- distinguish substitutions that preserve broad adaptation from those that preserve **specific goal coverage**.

### Evidence boundary

No new sets/reps/%1RM/sprint-rest/contact-volume default should be invented in this plan.

Generalizable training defaults belong in the Sports Knowledge Registry or an explicit policy claim with evidence, limitations and freshness metadata.

### Tests

- workout catalog validation;
- target-specific coverage classifier;
- variant omission semantics;
- equipment/safety;
- known-capacity and missing-capacity prescription behavior;
- target value does not alter resolved load;
- no false specific credit from merely related exercises.

**Done when:** each first-slice target has at least one legitimate eligible coverage path or an explicit product shortfall.

---

## PG7 — weekly allocation, ranking and explainability

**Status:** [ ]
**Blocked by:** PG5, PG6
**Recommendation-affecting:** yes

Wire performance-target coverage into the existing weekly allocation/selection authority rather than building a second planner.

### Authority order

Preserve:

1. hard safety and eligibility;
2. active external-plan/event authority where applicable;
3. capacity/time/equipment constraints;
4. evidence-backed broad adaptation requirements;
5. required performance-target coverage;
6. normal support/utility/tie-break logic.

The exact placement in existing role-reservation machinery must be verified against ADR-0018 rather than implemented as a new greedy pass.

### Multiple targets

Support multiple active targets only with deterministic capacity semantics.

Use UserGoal.priority after PG0 defines ties. If two targets compete for one safe slot, the same input must always yield the same chosen coverage and an explicit shortfall for the other.

Array/document iteration order is never authority.

### Explainability

Examples:

~~~text
Selected because it provides direct conventional-deadlift practice for your active 1RM goal.

Selected because it provides acceleration exposure for your standing 10 m target.

Max-velocity work withheld because Achilles/tissue restrictions exclude eligible sprint sessions.
~~~

### Verification

- goal-demand resolver tests;
- weekly packing/reservation tests;
- deterministic multi-target tests;
- recommendation provenance tests;
- policy-drift guard;
- simulate:diff;
- relevant plan-judge/persona scenarios.

**Done when:** target specificity can alter eligible selection while all stronger authorities remain intact.

---

## PG8 — formal outcome evidence and target evaluation

**Status:** [ ] future evidence phase
**Blocked by:** real usage of PG1–PG7; outcome architecture review
**Recommendation-affecting:** no — reporting/evidence first

Extend the existing observation/outcome system rather than building a goal-only results database.

### PG8.1 Metric/subject identity

An observation/evaluation binding must identify both the registered metric and subject.

Examples:

~~~text
strength_1rm_kg + exercise:conventional_deadlift
sprint_elapsed_time_s + test:sprint_10m_standing@v1
peak_power_w + test:cycling_5s_peak_power@v1
~~~

A bench result cannot join a deadlift series. A flying-10 result cannot satisfy a standing-10 goal. A 10 s peak-power result cannot silently satisfy a 5 s test.

### PG8.2 Evidence type

Keep distinctions explicit:

- tested/measured 1RM versus estimated 1RM;
- formal timed sprint versus training-rep estimate;
- force/power meter result versus jump-height proxy;
- valid versus questionable/invalid attempt.

### PG8.3 Protocol and measurement context

Use the observation model's protocol/context dimensions to preserve meaningful comparability.

Do not overfit the schema to one device vendor. Store the semantics needed to decide comparability.

### PG8.4 Evaluation

A typed goal can generate/reference an OutcomeEvaluationSpec whose target uses:

- metric;
- subject;
- target value;
- direction from registry;
- comparable evidence rules.

Result states should include at least:

- achieved;
- not yet achieved;
- insufficient comparable evidence;
- invalid/questionable evidence.

Outcome evaluation must not automatically rewrite recommendation policy.

**Done when:** target achievement is auditable and cannot be produced by a semantically different measurement series.

---

## PG9 — explicit progression automation only if later justified

**Status:** [ ] future capability
**Blocked by:** PG5–PG8 usage evidence; separate ADR/knowledge decision
**Recommendation-affecting:** yes

H5 progression currently has exact objective/session/step binding but its registered progression variable is duration_min.

Do not generalize that mechanism to kg, seconds or watts merely because performance targets now contain numbers.

If real use later shows a missing progression capability, design it around the **training variable being progressed**, not the outcome target:

- exact step/session binding;
- current-capability reference where relevant;
- permitted range;
- increment/decrement semantics;
- technical/RIR/quality stop conditions;
- adverse-response handling;
- stale-revision protection;
- athlete confirmation where the existing claim transaction requires it;
- replay/provenance.

A 1.75 s sprint target does not mean "subtract 0.01 s from training every week"; a 220 kg deadlift target does not mean "add 2.5 kg every week".

---

# Proposed implementation sequence

| Order | Item | Product value | Policy risk |
|---:|---|---|---|
| 1 | PG0 ADR | removes semantic ambiguity | none |
| 2 | PG1 metric/test registries | shared typed vocabulary | none |
| 3 | PG2 typed persistence + speed/power domains | canonical goal data | none |
| 4 | PG3 goal UX | athlete can express real targets | none |
| 5 | PG4 current evidence/progress | honest feedback | none |
| 6 | PG5 planning projection | target can influence planning | policy change |
| 7 | PG6 coverage audit/gaps | real candidate sessions | policy/content change |
| 8 | PG7 allocation/ranking | end-to-end recommender behavior | policy change |
| 9 | PG8 formal evaluation | auditable achievement | evidence only first |
| 10 | PG9 progression automation | only if needed | high; future |

The first release can ship PG1–PG4 without claiming programming specialization. Recommendation authority begins only with PG5–PG7 and the required policy-version/simulation review.

---

# File-level change map

Likely files, subject to implementation-time verification:

| Area | Files |
|---|---|
| Goal model/domain | app/src/engine/models.ts, goal-domain helper |
| Goal validation | app/src/engine/validationCore.ts, semantic target validator |
| Goal persistence | app/src/services/goalService.ts |
| Goal UI | app/src/components/Goals.tsx, CSS/tests |
| Firestore | app/firestore.rules, emulator tests |
| Metric vocabulary | app/src/observations/registry.ts, app/src/observations/models.ts |
| Test identity | new small performance-test registry or existing protocol registry if suitable |
| Exercise identity | reuse app/src/workouts/exercises.ts and extensions |
| Strength current capacity | app/src/components/preferences/PerformanceSections.tsx, existing e1RM helpers |
| Goal planning projection | app/src/engine/adapters.ts or dedicated assembler |
| Broad strategy | app/src/engine/evergreenStrategy.ts |
| Weekly allocation/coverage | app/src/engine/weeklyDosePacking.ts and existing role reservation path |
| Workout coverage | app/src/workouts/catalog/*, catalog validators |
| Prescription | reuse app/src/workouts/prescription.ts unless a real gap is found |
| Outcome evaluation | app/src/outcomes/* and observation comparison identity |
| Knowledge | app/src/knowledge/sportsKnowledge.ts for new generalizable programming claims |
| Simulation | weekly planner tests, scenario fixtures, plan-judge/persona cases |

Reference symbols, not line numbers, during implementation.

---

# Acceptance scenarios

### A. Strength target

An athlete can create:

~~~text
Conventional Deadlift
1RM
220 kg
~~~

The stored target contains metricId strength_1rm_kg plus exerciseId conventional_deadlift. Current e1RM, if present, is displayed separately.

An RDL-only workout does not receive conventional-deadlift-specific coverage credit.

### B. Speed target

An athlete can create:

~~~text
Standing 10 m sprint
1.75 s
~~~

The target is bound to sprint_10m_standing. A flying-10 target has a different test id even if both use sprint_elapsed_time_s.

Acceleration work may satisfy training coverage without pretending it is a formal timed outcome observation.

### C. Power target

An athlete can create:

~~~text
Cycling 5 s peak power
1,200 W
~~~

The metric direction is higher-is-better and the unit comes from the registry.

Changing the target to 1,300 W does not turn 1,300 W into today's workout prescription.

A later CMJ-height target is represented as jump_height_cm, not falsely as watts.

### D. Target and current capability are independent

Changing a target value does not mutate:

- manual/coach e1RM;
- latest sprint observation;
- latest power observation;
- resolved session working load;
- readiness/tissue state.

### E. Protocol identity prevents false progress

A standing-start 10 m result does not automatically compare with a flying 10 m result.

A power result from a different duration/protocol does not silently satisfy a 5 s target.

If evidence is not comparable, progress shows "no comparable result" rather than a misleading delta.

### F. Safety wins

With an applicable spinal-load, knee, Achilles or other restriction, target-specific work is withheld when excluded.

The weekly plan reports a target-coverage shortfall.

### G. Goal coverage is not test spam

A sprint goal can be covered by relevant training exposure without scheduling a maximal timed sprint test each week.

Formal outcome testing uses its own cadence/protocol.

### H. Legacy goals gain no accidental authority

An old goal containing:

~~~text
targetMetric = deadlift
targetValue = 220
targetUnit = kg
~~~

still renders but creates no typed deadlift demand until explicitly converted.

### I. Multiple targets are deterministic

When two or more targets compete for limited capacity, priority/tie rules produce the same allocation for identical input and report every unmet target.

### J. Higher/lower direction is registry-driven

Strength/power targets show higher values as improvement.

Sprint elapsed time shows lower values as improvement.

No UI component hardcodes direction based on label text.

---

# Verification gates

For PG1–PG4:

- TypeScript typecheck;
- lint;
- unit/component tests;
- Firestore emulator tests for rule changes;
- goal parser compatibility tests;
- metric/test registry validation;
- accessibility coverage for new controls.

For PG5–PG7 recommendation-affecting work:

- all of the above;
- npm run check;
- explicit POLICY_VERSION bump with rationale;
- policy-drift guard;
- simulate:scenarios and reviewed baseline impact;
- simulate:diff;
- relevant plan-judge/persona corpus;
- deterministic replay/provenance tests;
- no baseline update until behavioral diffs are reviewed.

For PG8:

- observation/evaluation tests;
- protocol-comparability tests;
- subject-series contamination tests;
- direction-aware target evaluation;
- no selection import until a separate authority decision exists.

For this documentation PR:

- repository pre-commit hygiene;
- no trailing whitespace;
- docs-only CI expected; code/test suites may be skipped by change detection.

---

# Rollout recommendation

## Stage 1 — typed capture and honest progress

Ship PG1–PG4:

- structured target;
- one vocabulary across strength/speed/power;
- current evidence where available;
- no claim yet that automatic programming specializes for the target.

The UI must say when a target is tracked but not yet planning-authoritative.

## Stage 2 — measured planning authority

After PG0 and policy verification, ship PG5–PG7.

Collect:

- direct/specific coverage rate;
- shortfall reasons;
- safety exclusions;
- substitutions/edits;
- adherence;
- target-relevant response;
- comparable outcome trend.

## Stage 3 — formal outcome loop

Add PG8 when real users have enough target history to justify protocol-locked assessment.

## Stage 4 — progression automation only if needed

Consider PG9 only if current-capability/autoregulated session logic plus normal periodization cannot express required training progression.

---

# Recommended first vertical slice

The smallest slice that proves this is **not a deadlift-only feature** should contain one representative target from each requested family:

1. Strength: strength_1rm_kg + conventional_deadlift.
2. Speed: sprint_elapsed_time_s + sprint_10m_standing.
3. Power: peak_power_w + cycling_5s_peak_power.

The slice should include:

- shared metric/test registry;
- typed persistence;
- target UX;
- current/progress projection where evidence exists;
- family-specific planning projection;
- at least one legitimate coverage path per target;
- target-specific explanation and shortfall;
- formal safety precedence.

CMJ/jump-height can be the next registered power-family metric and is a good regression test for the architecture because it proves the model can support a non-watt explosive-performance outcome without lying about units.

---

# Final design test

At the end of PG7, all three statements must be true:

> When an athlete says "my goal is a 220 kg conventional deadlift", the system recognizes the exact lift, deliberately prefers safe direct work for it when constraints allow, and uses current capacity rather than 220 kg to determine training load.

> When an athlete says "my goal is a 1.75 s standing 10 m", the system recognizes the exact sprint test, drives acceleration-relevant training coverage, keeps timed testing distinct from weekly training, and interprets lower time as improvement.

> When an athlete says "my goal is 1,200 W for 5 s on the bike", the system recognizes the exact power metric/test, drives relevant sprint-power coverage, uses protocol-aware observations for progress, and never turns 1,200 W into an arbitrary daily prescription.

If adding another registered strength, speed or power target after that requires a new goal subsystem instead of a registry/coverage extension, the abstraction is still too narrow.
