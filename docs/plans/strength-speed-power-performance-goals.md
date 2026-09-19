# Strength, speed and power performance goals — implementation plan

**Capability prefix:** PG
**Status:** In progress — Stage 1 core (PG0–PG4 plus the population-anchored PG4.5 first slice) Implemented; PG4.5.4 personal-longitudinal trajectory and PG5–PG9 remain Draft/not started.
**Blocked by:** PG5–PG9 require: reviewed Sports Knowledge Registry claims for any new prescription defaults, a `POLICY_VERSION` bump, `simulate:scenarios`/`simulate:diff` review, and their own item-level dependencies below. PG0's ADR is [ADR-0041](../adr/0041-strength-speed-power-performance-goals.md), accepted 2026-09-19.
**Unlocks:** athlete-owned measurable strength, speed and power goals; target-specific planning coverage; protocol-aware progress; later formal target evaluation.
**Source analysis:** ../analysis/2026-09-19-strength-speed-power-performance-goal-gap.md

**Stage 1 implementation note (2026-09-19):** PG2.2's semantic/domain validation of a typed
`performanceTarget` (registry membership, exercise/test resolution, domain-family
consistency) deliberately does **not** live inside `validateGoal`
(`app/src/engine/validationCore.ts`), even though that was PG2.2's original sketch.
`observations/architecture.test.ts`'s OV1.4 boundary forbids production selection/ranking
modules (`optimizer.ts` and friends) from transitively reaching `observations/*`, and
`validationCore.ts` is reachable from those modules through the `engine/validation.ts`
barrel. Semantic validation (`validatePerformanceTargetForDomain`, in
`engine/performanceTargetValidation.ts` since Stage 2/PG5.1 split it out of
`performanceTargetPolicy.ts` for the same OV1.4 reason) is instead enforced at `goalService.ts`'s
create/update **and read** boundaries, and by the Goals.tsx UI before submit.
`validateGoal` keeps a structural-only check (shape/kind/exact keys) and still fails a
goal closed for a malformed target; a well-formed-but-semantically-unresolvable target
passes `validateGoal` but is rejected by the service before either persistence or
read-side escape. This preserves ADR-0041's "present-but-invalid performanceTarget fails
closed" invariant end-to-end while keeping the observations evidence layer isolated from
recommendation-affecting code, per the existing OV1.4 architecture decision.

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
  -> feasibility advisory (plausibility + confidence + evidence)
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
sprint_elapsed_time_s + performance_test:sprint_10m_standing-r1
sprint_elapsed_time_s + performance_test:sprint_flying_10m-r1
cycling_5s_peak_power_w + performance_test:cycling_5s_peak_power-r1
jump_height_cm + performance_test:cmj_standard-r1
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

The existing metric/performance-testing catalogs and the planning-coverage mapping therefore remain separate authorities.

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

### P8 — Goal feasibility is advisory, evidence-backed and uncertainty-aware

A valid target is not automatically a realistic target.

The system should assess whether the requested outcome appears plausible by the selected target date under the athlete's current data and training capacity, but it must not silently reject, rewrite or intensify the goal.

Feasibility reports two separate concepts:

- **plausibility:** already_achieved / plausible / stretch / unlikely / insufficient_evidence;
- **confidence:** low / moderate / high, with explicit reasons.

Do not publish an exact success probability unless a future prediction model is prospectively calibrated. "Unlikely / high confidence" is more defensible than "2.8% chance" from an unvalidated formula.

The assessment is informational. It can suggest changing the target, target date, availability or baseline evidence, but it never becomes training-dose authority.

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
      kind: 'performance_test';
      performanceTestId: string;
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

The existing observation MetricDefinition remains authoritative for unit and direction.

### Typed-versus-legacy precedence

For strength/speed/power goals, `performanceTarget` is the only representation that may become target-authoritative.

Use one compatibility rule at every read/write boundary:

1. New or edited typed-target writes persist `performanceTarget` and explicitly clear/delete `targetMetric`, `targetValue` and `targetUnit` for that goal.
2. If a stored document contains a **valid** `performanceTarget` plus conflicting legacy fields, the typed target wins for display, progress, feasibility and any later planning projection; legacy fields are ignored.
3. If the `performanceTarget` field is present but malformed/unknown, fail closed as invalid typed goal data. Do **not** fall back to the legacy triple, because that would let stale/free-text data regain authority.
4. If `performanceTarget` is absent, legacy fields remain readable for backward-compatible UI only and create no typed performance demand until the athlete explicitly converts/saves a typed target.
5. Legacy behavior for goal families that have not migrated to `performanceTarget` is outside this capability and must not be broken accidentally.

The create/update service should centralize this normalization (including Firestore `deleteField()` on legacy keys when converting an existing goal) so components, adapters and evaluators do not invent their own precedence rules.

### Reuse existing metric/protocol/test authorities

Do **not** add a second PerformanceMetricDefinition or PerformanceTestDefinition type.

The repository already has:

- MetricDefinition and the metric registry in app/src/observations;
- MeasurementProtocol with immutable revisions and comparison dimensions;
- PerformanceTestDefinition in app/src/observations/performanceTestingCatalog.ts;
- protocolRef + comparisonSeriesKey on metric observations;
- buildComparisonSeries / areComparisonSeriesComparable.

Add target metrics to the existing metric registry and test-bound targets to the existing performance-testing catalog.

The goal layer only needs a thin policy describing target eligibility/family/subject shape:

~~~ts
interface PerformanceTargetPolicy {
  metricId: string;
  family: 'strength' | 'speed' | 'power';
  subjectKind: 'exercise' | 'performance_test';
  targetRange?: {
    min: number;
    max: number;
  };
}
~~~

This family is goal/product taxonomy; it does not replace MetricDefinition.domain.

Suggested first targets, with exact ids finalized in PG0/PG1 to match repository naming conventions:

| target | subject authority | direction authority |
|---|---|---|
| strength 1RM | canonical exercise id | MetricDefinition |
| standing 10 m time | PerformanceTestDefinition | MetricDefinition |
| cycling 5 s peak power | PerformanceTestDefinition | MetricDefinition |
| CMJ height later | PerformanceTestDefinition | MetricDefinition |

For a performance_test subject, semantic validation must resolve `getPerformanceTestDefinition(performanceTestId)` and verify that `test.protocol.metricIds` contains `metricId`. The current catalog getter throws on an unknown id, so the semantic-validation boundary must catch lookup failures and return the normal invalid-data result; an unknown persisted id must never escape as an unhandled exception. Apply the same fail-closed translation to other registry getters that throw for unknown ids.

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

Domain is navigation/display taxonomy. Planning authority comes from the validated performance target and its reviewed target-to-planning mapping, not from the domain string alone.

### Derived goal-feasibility contract

Goal feasibility is **derived state**, not part of the athlete-authored UserGoal source of truth. It changes as baseline evidence, schedule capacity, training history and the target horizon change.

A computation/output contract should resemble:

~~~ts
type GoalPlausibility =
  | 'already_achieved'
  | 'plausible'
  | 'stretch'
  | 'unlikely'
  | 'insufficient_evidence';

type FeasibilityConfidence = 'low' | 'moderate' | 'high';

interface GoalFeasibilityAssessment {
  goalId: string;
  assessedAt: string;
  assessmentVersion: string;

  plausibility: GoalPlausibility;
  confidence: {
    level: FeasibilityConfidence;
    reasons: string[];
  };

  horizon: {
    targetDate: string | null;
    daysRemaining: number | null;
    weeksRemaining: number | null;
  };

  requiredChange: {
    currentValue: number | null;
    targetValue: number;
    absolute: number | null;
    relativePct: number | null;
    /**
     * Explanation only. Never interpreted as a prescribed weekly progression.
     */
    linearizedEquivalentPerWeek: number | null;
  };

  capacity: {
    weeklyMinSessions: number | null;
    weeklyTargetSessions: number | null;
    weeklyMaxSessions: number | null;
    estimatedWeeklyMinutes: number | null;
    projectedSpecificExposuresPerWeek: number | null;
  };

  factors: Array<{
    code: string;
    effect: 'supports' | 'limits' | 'uncertain';
    summary: string;
    source: 'athlete_data' | 'schedule' | 'training_history' | 'population_evidence';
  }>;

  evidenceRefs: string[];
}
~~~

A persisted audit snapshot may be useful later for explaining what the app told the athlete at a particular time, but the live assessment must be recomputed from current authoritative inputs rather than copied into UserGoal.

### Feasibility evidence hierarchy

Use, in order:

1. comparable personal longitudinal outcome history, when sufficient;
2. target-specific performed-training history and adherence;
3. applicable family/test population evidence matched to training status, dose and horizon;
4. broader evidence with an explicit confidence downgrade;
5. otherwise, insufficient_evidence.

Do not reuse one global adaptation-rate constant across strength, speed and power.

### Capacity and frequency semantics

Reuse the existing owners:

- TrainingIntentProfile.weeklyCommitment;
- ResolvedTrainingCapacity;
- schedule windows;
- fixed/external activities;
- target-specific coverage once PG5-PG7 exist.

If weeklyCommitment.maxSessions is 1, at most one target-specific planned exposure can fit per week. That is a useful hard upper bound.

If maxSessions is 5, do **not** infer five target-specific exposures. Until the planner or performed-training history identifies direct coverage, projectedSpecificExposuresPerWeek remains unknown.

The generic evergreen trainingAgeProxy may contribute context, but it is not enough to classify target-specific training experience. A person with many cycling sessions is not automatically an established bench presser.

---

# Work plan

## PG0 — architecture decision and acceptance boundary

**Status:** [x] Implemented — [ADR-0041](../adr/0041-strength-speed-power-performance-goals.md), accepted 2026-09-19.
**Blocked by:** plan approval
**Recommendation-affecting:** no code yet

Write and accept an ADR covering:

1. performanceTarget is the canonical typed measurable outcome for new strength/speed/power goals.
2. Metric semantics come from one registry shared with or aligned to observations.
3. Exercise subjects use canonical exercise ids; test-bound subjects use existing PerformanceTestDefinition ids.
4. Current capability/evidence is not copied into the goal.
5. Target value cannot become prescription intensity or automatic progression.
6. Goal-test identity and workout coverage are distinct contracts.
7. Active typed goals may create planning demand only through reviewed target-to-planning mappings.
8. Legacy free-text targets remain non-authoritative.
9. Safety, external-plan/event authority and hard eligibility outrank target coverage.
10. Multiple active performance targets use deterministic priority/capacity conflict semantics.
11. Estimated/proxy evidence and formal tested evidence remain distinguishable.
12. Protocol comparability is required before observations are treated as one progress series.
13. Goal feasibility is derived advisory state, not athlete-authored UserGoal truth and not prescription authority.
14. Plausibility and confidence are separate outputs with explicit factor/evidence provenance.
15. Production feasibility bands/thresholds are versioned evidence policy; exact outcome probabilities are forbidden until prospectively calibrated.
16. Total weekly commitment/schedule provides a capacity bound, while target-specific frequency comes from direct planned/performed coverage rather than assumption.

**Done when:** the ADR names the persisted contract, registry authorities, initial target families, authority order, compatibility rule, feasibility/confidence semantics and first vertical-slice metrics.

---

## PG1 — extend canonical metric and performance-testing catalogs

**Status:** [x] Implemented — `strength_1rm_kg`, `sprint_elapsed_time_s`, `cycling_5s_peak_power_w` in `app/src/observations/registry.ts`; `sprint_10m_standing-r1` and `cycling_5s_peak_power-r1` in `app/src/observations/performanceTestingCatalog.ts`; target-eligibility policy in `app/src/engine/performanceTargetPolicy.ts` (pure, no observations/workouts imports) and semantic validators in `app/src/engine/performanceTargetValidation.ts` (split out in Stage 2/PG5.1 for the OV1.4 boundary).
**Blocked by:** PG0
**Recommendation-affecting:** no

### PG1.1 Extend the existing metric registry

**Files:**

- app/src/observations/models.ts only when the shared contract truly needs an extension;
- app/src/observations/registry.ts;
- registry tests.

Add reviewed metrics for the first supported strength, speed and power outcomes.

MetricDefinition already owns unit and direction. Do not duplicate those fields in a goal-only registry.

Keep exact metric ids consistent with current naming conventions. The ADR should decide whether a reusable metric such as sprint_elapsed_time_s or a protocol-specific id is preferable; either choice must still use the existing registry.

### PG1.2 Extend the existing performance-testing catalog

**Files:**

- app/src/observations/performanceTestingCatalog.ts;
- app/src/observations/protocols.ts only when a new protocol genuinely requires another ComparisonDimension;
- testing/comparability tests.

Add PerformanceTestDefinition entries for first-slice test-bound targets such as standing 10 m and cycling 5 s peak power.

Each entry already composes:

- a versioned MeasurementProtocol;
- metricIds;
- protocol instructions/invalidation;
- comparison-context requirements;
- TestingSessionDefinition;
- default context;
- expected source.

Do not create a second test registry.

For a future CMJ definition, encode the measurement/calculation method in protocol/comparison semantics strongly enough that incompatible jump-height methods do not enter the same comparison series.

### PG1.3 Add thin target-eligibility policy

Create the smallest goal-specific policy layer necessary to map registered metrics to:

- family: strength / speed / power;
- allowed subject kind: exercise / performance_test;
- bounded target range if useful for structural validation;
- optional exercise eligibility predicate/reference.

It must not own unit, direction, protocol instructions or comparison-series logic.

### PG1.4 Semantic validators

Provide pure helpers that can answer:

- is this registered metric target-eligible?
- does the target subject kind match policy?
- does the canonical exercise exist and meet eligibility?
- can the referenced PerformanceTestDefinition be resolved?
- is the target metric declared by that test's MeasurementProtocol?
- is the target value finite and within a bounded structural range?
- what family, unit and direction apply?

Do not import recommendation policy into these helpers.

Lookup helpers such as `getMetricDefinition()` and `getPerformanceTestDefinition()` currently throw for unknown ids. The semantic validator owns that exception boundary: catch those lookup errors and translate them into typed validation failures with stable reason codes. Programming errors unrelated to an unknown/invalid persisted identifier should not be swallowed generically.

### Tests

Cover:

- valid strength exercise target;
- valid speed performance-test target;
- valid power performance-test target;
- wrong subject kind;
- unknown exercise/test;
- test whose protocol does not declare the metric;
- unknown metric;
- invalid target range;
- direction/unit lookup from the existing metric registry;
- comparison-series behavior for new protocols.

**Done when:** code can prove what a target means using existing metric/protocol/test authorities without title parsing, user-entered units or duplicate registries.

---

## PG2 — typed goal model, domain, validation and persistence

**Status:** [x] Implemented — `UserGoal.performanceTarget`, `speed`/`power` domains in `app/src/engine/models.ts`; structural validation in `app/src/engine/validationCore.ts`; semantic/domain validation in `app/src/engine/performanceTargetValidation.ts`'s `validatePerformanceTargetForDomain`, enforced at `app/src/services/goalService.ts`'s read/write boundary (see this plan's Stage 1 implementation note above for why); `firestore.rules` structural check added.
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

All readers use the precedence rule above: valid typed target > ignored legacy conflict; present-but-invalid typed target > invalid result with no fallback; legacy-only document > backward-compatible display with zero typed recommendation authority. All typed-target writes clear legacy target fields rather than leaving two competing values in Firestore.

### Tests

Add/update:

- validationCore goal tests;
- goal service/parser tests;
- Firestore emulator tests;
- old-goal fixtures;
- new speed/power domain tests;
- unknown metric/subject tests, including unknown `performanceTestId` returning validation data rather than throwing;
- conflicting typed + legacy representations where the valid typed target wins;
- malformed typed + apparently valid legacy representation still fails closed with no fallback;
- typed-target create/update clears legacy target fields.

**Done when:** each initial family round-trips as typed data and no malformed target can gain planning authority.

---

## PG3 — athlete-facing target UX

**Status:** [x] Implemented — structured family/metric/subject/value flow in `app/src/components/Goals.tsx`'s `GoalModal`/`PerformanceTargetFields`; legacy free-text target still renders unchanged when no typed target is set.
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

- family-, metric-, and subject-dependent controls;
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

**Status:** [x] Implemented — `app/src/engine/goalProgress.ts` (pure evaluator) resolves current e1RM (strength) or latest comparable observation (speed/power) and a direction-aware gap via `app/src/engine/goalMetricMath.ts`; `metricObservationService.listCurrentRevisionsForMetric` now supplies current revision data to `Goals.tsx` so speed/power progress works in the actual UI rather than only in evaluator tests. `PerformanceSections.tsx`'s e1RM picker is data-driven from the target-eligibility policy rather than a hardcoded three-lift list.
**Blocked by:** PG1, PG3
**Recommendation-affecting:** no

Progress is family-specific evidence projected through one UI contract.

### PG4.1 Strength capacity

Reuse AthletePerformanceProfile estimated1RmKg and provenance.

Replace the current three-lift-only Preferences UI with a canonical eligible-exercise picker so any registered strength-1RM goal can show/set current e1RM.

Preserve source ownership: derived logging must not overwrite protected manual/coach values under ADR-0021.

Label e1RM as estimated, not tested 1RM.

### PG4.2 Speed and power observations

Resolve the latest **comparable** observation for the target metric + PerformanceTestDefinition subject using the existing comparisonSeriesKey/protocolRef machinery.

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

## PG4.5 — goal feasibility and realism advisory

**Status:** [x] Implemented for the strength family first slice — `app/src/engine/goalFeasibility.ts`'s `assessGoalFeasibility`, backed by a registered Sports Knowledge Registry claim (`goalFeasibility.strength.requiredChangeBands` in `app/src/knowledge/goalFeasibilityKnowledge.ts`). Policy v2 calibrates the plausible ceiling to 1.3%/week (about 7.8% over six weeks, near the upper end of the cited trained-men benchmark) and retains 2.0%/week as an explicitly low-certainty stretch heuristic. `Goals.tsx` passes `TrainingIntentProfile.weeklyCommitment` as a total-capacity upper bound and shows horizon, required change, capacity, target-specific-frequency uncertainty and baseline provenance behind the confidence label. Speed and power deliberately return `insufficient_evidence` rather than reusing the strength band. Personal-longitudinal-trajectory evidence (PG4.5.4) is **not yet implemented**.
**Blocked by:** PG1, PG2, PG4; PG5-PG7 improve target-specific frequency precision but are not required for an initial advisory
**Recommendation-affecting:** no — advisory only

A measurable goal should not be presented as equally realistic merely because its structure is valid.

Build a deterministic, versioned feasibility assessor that answers:

1. What is the current comparable baseline?
2. How large is the requested absolute/relative change?
3. How much time remains?
4. What total training capacity is available?
5. How much target-specific exposure is actually observed or projected?
6. What does the athlete's own valid longitudinal history show?
7. What applicable evidence envelope exists for this metric/family/population?
8. How confident are we in the assessment inputs and evidence applicability?

### PG4.5.1 Plausibility output

Use:

- already_achieved;
- plausible;
- stretch;
- unlikely;
- insufficient_evidence.

The output must be direction-aware through MetricDefinition.

Do not use "impossible" for physiological adaptation merely because a target is extreme. Reserve deterministic hard errors for structural facts such as an invalid/past date or missing required target data. Product copy for an extreme valid goal should be: "Current evidence suggests this goal is unlikely by the selected date."

### PG4.5.2 Confidence output

Confidence reflects **quality of the assessment**, not optimism about the goal.

High-confidence contributors can include:

- recent valid/comparable tested baseline;
- adequate personal target-specific history;
- known schedule/weekly commitment;
- known planned target-specific coverage;
- strong evidence match to exercise/test, training status, duration and dose.

Confidence reducers include:

- stale/manual baseline;
- estimated rather than tested outcome where the distinction matters;
- missing comparable observations;
- sparse target-specific history;
- unknown target-specific exposure;
- evidence from a materially different population/protocol/duration.

Return both a level and reason codes suitable for an expandable "Why this confidence?" UI.

### PG4.5.3 Required-change calculations

Make the sign convention explicit and derive it from `MetricDefinition.direction`, never from metric labels.

For target-eligible metrics:

~~~ts
const improvementSign =
  metric.direction === 'higher_is_better' ? 1 :
  metric.direction === 'lower_is_better' ? -1 :
  null; // context_only is not target-eligible

absolute = improvementSign * (targetValue - currentValue);
// positive: improvement still required
// zero: exactly at target
// negative: current result is already beyond the target

relativePct =
  currentValue === 0
    ? null
    : (absolute / Math.abs(currentValue)) * 100;

linearizedEquivalentPerWeek =
  weeksRemaining != null && weeksRemaining > 0
    ? absolute / weeksRemaining
    : null;
~~~

Thus a 1.86 s -> 1.75 s sprint target produces `absolute = +0.11 s`, while a 100 kg -> 120 kg strength target produces `absolute = +20 kg`. A result already beyond the target yields a non-positive required-change value and is eligible for `already_achieved` classification. When the current value is zero, relative percentage is undefined rather than fabricated.

Also calculate days/weeks remaining independently from the metric direction.

The weekly equivalent is **descriptive only** and should be labelled as such in code and UI. It must never be imported by prescription/progression logic.

### PG4.5.4 Personal history before population priors

When enough comparable data exist, use the athlete's own target-specific trajectory as the highest-applicability evidence.

Do not estimate bench-press experience from total session count alone. Reuse canonical performed-training occurrences/direct exercise coverage and comparable metric observations.

Only fall back to population evidence when personal data are insufficient, and expose that downgrade in confidence.

### PG4.5.5 Evidence-backed family policies

Any band or threshold that separates plausible/stretch/unlikely must be reviewed/versioned evidence, not a magic percentage in UI code.

Strength, speed and power need separate policies.

For the strength first slice, research anchors include:

- ACSM 2026 overview/position stand: strength was enhanced by heavier loading, 2-3 sets and at least 2 sessions/week (PMID 41843416);
- Pelland et al. 2026 dose-response meta-regression: strength gains increased with weekly set volume and with training frequency, both with diminishing returns; this supports treating frequency/volume as graded evidence rather than a deterministic cutoff (PMID 41343037);
- Grgic et al. 2018 frequency meta-analysis: higher frequency associated with greater strength gains overall, but not when volume was equated (PMID 29470825);
- Androulakis-Korakakis et al. minimum-dose review in trained men: low-dose training can still improve 1RM, pooled bench gain 8.25 kg across included studies (PMID 31797219);
- Coratella et al. trained men: six weeks of bench-press training produced approximately 4.7-7.7% increases in 1RM/body-mass ratio across training groups (PMID 27801598);
- Grgic et al. 1RM reliability review: median CV 4.2%, useful for separating large target gaps from ordinary measurement noise (PMID 32681399).

These are **benchmarks and evidence inputs**, not a universal expected-gain formula.

The current versioned first-slice strength heuristic therefore uses <=1.3% required
relative change per week as `plausible` at an adequate 2+/week **capacity ceiling** and
<=2.0%/week as `stretch`; the latter deliberately extends beyond the six-week trained-men
benchmark and is low-certainty. Lower total weekly capacity tightens these ceilings.
Because total capacity is not target-specific frequency, plausible/stretch assessments
remain confidence-limited until direct planned/performed coverage exists. An `unlikely`
assessment that already holds under the optimistic capacity upper bound may retain high
confidence because fewer actual target-specific exposures cannot make that target more
plausible.

### PG4.5.6 Example — 100 kg bench to 200 kg in six weeks

Given:

~~~text
current valid bench 1RM:       100 kg
target:                        200 kg
time remaining:                42 days / 6 weeks
maximum relevant frequency:    1 session/week
~~~

derive:

~~~text
absolute required change:      +100 kg
relative required change:      +100%
linearized weekly equivalent:  +16.7 kg/week (explanation only)
maximum relevant exposures
under total-capacity bound:     6
~~~

Expected UX with a recent reliable baseline and known schedule:

~~~text
Goal feasibility: Unlikely
Confidence: High

Why:
- +100% improvement required in 6 weeks
- total schedule capacity allows at most 6 relevant exposures before the target date
- actual target-specific frequency is not yet known; that uncertainty cannot make this already-unlikely case more plausible
- current strength evidence favors more frequent exposure for maximizing strength
- requested change is far outside applicable short-term published benchmarks
- baseline measurement uncertainty is small relative to the requested change

Options:
- keep this ambitious goal
- extend the target date
- change the target value
- review training availability
~~~

The athlete remains free to keep the goal.

If the same "100 kg" were a stale self-estimate and training history were missing, the result should degrade to lower confidence and recommend a valid baseline assessment.

### PG4.5.7 Tests

Cover:

- already-achieved higher-is-better target;
- already-achieved lower-is-better target;
- higher-is-better and lower-is-better required-change formulas use the same positive-improvement convention;
- zero current baseline -> relativePct is null, not infinity/NaN;
- no target date -> insufficient horizon evidence, no fabricated rate;
- no comparable baseline -> insufficient_evidence;
- recent tested 100 kg bench -> 200 kg in 6 weeks + max one session/week -> unlikely/high confidence under the reviewed first-slice policy;
- same target with stale/manual baseline -> unlikely or insufficient with lower confidence;
- maxSessions=5 does not become five bench sessions/week;
- personal comparable trajectory outranks generic population prior when sufficiently supported;
- evidenceRef/provenance appears in output;
- changing target date recomputes feasibility without mutating the goal;
- feasibility output has no import path into prescription/load/progression code.

**Done when:** the athlete can see whether a target looks plausible under current evidence and capacity, how confident the app is, and exactly which data/evidence produced that judgment.

---

## PG5 — goal-to-planning projection and coverage semantics

**Status:** [~] PG5.1 Implemented (typed projection only, no planning authority); PG5.2, PG5.3 and PG5.4's live wiring not started.
**Blocked by:** PG0, PG2
**Recommendation-affecting:** yes — requires POLICY_VERSION update and policy-drift verification. PG5.1 alone already tripped the drift gate (it touches `engine/adapters.ts`) even though it changes zero actual behavior; see its implementation note below.

This is the bridge from stored outcome to programming.

### PG5.1 Typed planning projection

**Status:** [x] Implemented — `app/src/engine/performanceGoalDemand.ts`'s `PerformanceGoalDemand`, `goalToPerformanceGoalDemand`, `mapGoalsToPerformanceGoalDemands`; wired into `UserContext.performanceGoalDemands` via `app/src/engine/adapters.ts`'s `mapContextFromGoalsAndTrainingSettings`.

Implementation notes (2026-09-19, Stage 2 PR):

- **No consumer yet.** The projection is populated in `UserContext` but nothing reads it. `app/src/engine/performanceGoalDemand.architecture.test.ts` now scans every production module under `app/src` recursively and allows the field token only at its contract declaration (`models.ts`) and composition writer (`adapters.ts`). A new helper cannot therefore consume `performanceGoalDemands` while the current top-level planner files remain clean; the guard must be deliberately relaxed when PG7 actually wires it in.
- **OV1.4 boundary fix.** `engine/adapters.ts` is reachable from every production selection/ranking module via `engine/eligibility.ts` (verified by import-graph BFS). `engine/performanceTargetPolicy.ts` used to mix pure policy/type data with semantic validators that import the observations registries. Splitting the validators out into `app/src/engine/performanceTargetValidation.ts` (Stage 1's `validatePerformanceTarget`/`validatePerformanceTargetForDomain`) was necessary so `performanceGoalDemand.ts` could resolve a target's family via the now-pure `performanceTargetPolicy.ts` without pulling `observations/*` into the selection-module reachability set. `observations/architecture.test.ts`'s existing OV1.4 test would have caught the alternative.
- **No title-fallback identity.** Unlike the existing `goalToUserEvent` precedent (`goal.id ?? goal.title`), `goalToPerformanceGoalDemand` returns `null` for a goal with no `id` rather than falling back to `goal.title` — PG7's plan text requires deterministic "ascending stable goalId lexical order" tie-breaking, which a title (not unique, not stable) would silently violate. Production data (sourced via `goalService.ts`) always has a real Firestore document id; only a hand-built fixture without one is affected.
- **Deterministic projection order is already part of PG5.** `comparePerformanceGoalDemands` implements the shared PG5/PG7 total order required later in this plan: higher `UserGoal.priority`, then earlier non-null `targetDate`, then dated before open-ended, then ascending stable `goalId`. `mapGoalsToPerformanceGoalDemands` always sorts with that exported comparator, so Firestore/query/array iteration order can never become accidental authority. PG7 must reuse this comparator after stronger authorities are applied rather than reimplementing it.
- **`priority` is not an allocation tier.** `PerformanceGoalDemand.priority` participates in the deterministic projection order above, but that ordering alone grants no selection/allocation authority in PG5.1. PG7 still applies safety, external-plan/event, capacity and broad-adaptation authorities before performance targets compete.
- **POLICY_VERSION bumped** to `2026-09-performance-goal-demand-projection-v1` because `adapters.ts` is on `check-policy-drift.mjs`'s `decisionAffectingFiles` list, regardless of the fact that this change is behaviorally inert. `simulate:diff` showed no change, but that alone is a weak signal since the committed simulation fixtures contain no goal with a typed `performanceTarget` — the real proof of inertness is the structural architecture test above plus `adapters.test.ts`'s byte-identical-`UserContext`-except-one-field test.

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

1. strength target projects exact exercise identity — **done**, `performanceGoalDemand.test.ts`;
2. standing 10 m and flying 10 m remain distinct subjects — **done** for `subjectRef` inequality in general (the catalog only has one speed test today, so the test uses two synthetic `performanceTestId`s rather than a real flying-10m test);
3. target value changes do not change coverage identity — **done**, `performanceGoalDemand.test.ts`;
4. broad priority + typed target does not double dose — **not done**: PG5.2/PG5.3 (the dose/coverage refinement this test would exercise) are not implemented, so there is nothing yet that could double-count;
5. hard exclusions produce shortfall, not unsafe selection — **not done**: no shortfall-producing code exists yet (PG5.4 is a type-only forward declaration; PG7 owns the actual allocation path this would exercise);
6. legacy goal creates no typed demand — **done**, `performanceGoalDemand.test.ts`;
7. multiple active targets project in deterministic priority/date/id order independent of caller/Firestore array order — **done**, `performanceGoalDemand.test.ts`.

**Done when:** the weekly planner understands what kind of specific practice matters without
using the target number as training dose. **Not met by PG5.1 alone** — the planner receives
a populated but entirely unused projection; see PG5.1's implementation note above and
`performanceGoalDemand.architecture.test.ts`, which enforces that nothing reads it yet. This
criterion is met only once PG5.2/PG5.3 (and, for allocation to actually change, PG7) land.

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

Use one total order for demands that remain tied after stronger authorities have been applied:

1. higher `UserGoal.priority` first (the existing contract is 1-5, with 5 highest);
2. if priority ties, earlier non-null `targetDate` first;
3. dated targets sort before open-ended/null-date targets at the same priority;
4. if still tied, ascending stable `goalId` lexical order.

PG0 should ratify this tie policy. PG5's projection, PG7 allocation/reservation, explainability and all deterministic tests must use the same comparator rather than reimplementing it ad hoc. Target magnitude, document creation order, Firestore query order and array iteration order are never tie-break authority.

If two targets compete for one safe slot, the winner follows that order and every losing target gets an explicit capacity/conflict shortfall; equal-priority input must therefore replay identically.

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
sprint_elapsed_time_s + performance_test:sprint_10m_standing-r1
cycling_5s_peak_power_w + performance_test:cycling_5s_peak_power-r1
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
| Performance-test identity | reuse app/src/observations/performanceTestingCatalog.ts and MeasurementProtocol in app/src/observations/models.ts |
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

## A. Strength target

An athlete can create:

~~~text
Conventional Deadlift
1RM
220 kg
~~~

The stored target contains metricId strength_1rm_kg plus exerciseId conventional_deadlift. Current e1RM, if present, is displayed separately.

An RDL-only workout does not receive conventional-deadlift-specific coverage credit.

## B. Speed target

An athlete can create:

~~~text
Standing 10 m sprint
1.75 s
~~~

The target is bound to PerformanceTestDefinition sprint_10m_standing-r1. A flying-10 target has a different PerformanceTestDefinition id even if both use sprint_elapsed_time_s.

Acceleration work may satisfy training coverage without pretending it is a formal timed outcome observation.

## C. Power target

An athlete can create:

~~~text
Cycling 5 s peak power
1,200 W
~~~

The metric direction is higher-is-better and the unit comes from the registry.

Changing the target to 1,300 W does not turn 1,300 W into today's workout prescription.

A later CMJ-height target is represented as jump_height_cm, not falsely as watts.

## D. Target and current capability are independent

Changing a target value does not mutate:

- manual/coach e1RM;
- latest sprint observation;
- latest power observation;
- resolved session working load;
- readiness/tissue state.

## E. Protocol identity prevents false progress

A standing-start 10 m result does not automatically compare with a flying 10 m result.

A power result from a different duration/protocol does not silently satisfy a 5 s target.

If evidence is not comparable, progress shows "no comparable result" rather than a misleading delta.

## F. Safety wins

With an applicable spinal-load, knee, Achilles or other restriction, target-specific work is withheld when excluded.

The weekly plan reports a target-coverage shortfall.

## G. Goal coverage is not test spam

A sprint goal can be covered by relevant training exposure without scheduling a maximal timed sprint test each week.

Formal outcome testing uses its own cadence/protocol.

## H. Legacy goals gain no accidental authority

An old goal containing:

~~~text
targetMetric = deadlift
targetValue = 220
targetUnit = kg
~~~

still renders but creates no typed deadlift demand until explicitly converted.

## I. Multiple targets are deterministic

When two or more targets compete for limited capacity, priority/tie rules produce the same allocation for identical input and report every unmet target.

## J. Higher/lower direction is registry-driven

Strength/power targets show higher values as improvement.

Sprint elapsed time shows lower values as improvement.

No UI component hardcodes direction based on label text.

## K. Unrealistic horizon is surfaced with confidence and evidence

A recent, valid 100 kg bench-press 1RM plus a 200 kg target six weeks away and at most one relevant session/week produces an advisory equivalent to:

~~~text
Goal feasibility: Unlikely
Confidence: High
Required change: +100 kg / +100%
Time remaining: 6 weeks
Capacity: at most 6 relevant exposures
~~~

The explanation names the baseline source/date, schedule/frequency facts, target-specific history used, and evidence references.

Changing the baseline to stale/uncertain data lowers confidence instead of pretending the same certainty.

The user may keep the goal. The feasibility assessor does not increase training load or bypass safety.

---

# Verification gates

For PG1–PG4.5:

- TypeScript typecheck;
- lint;
- unit/component tests;
- Firestore emulator tests for rule changes;
- goal parser compatibility tests;
- metric registry + performance-testing catalog validation;
- accessibility coverage for new controls;
- feasibility classification/confidence/provenance tests;
- evidence-policy versioning tests;
- structural test proving feasibility cannot import into prescription/progression authority.

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

Ship PG1–PG4.5:

- structured target;
- one vocabulary across strength/speed/power;
- current evidence where available;
- advisory plausibility + confidence with transparent factors/evidence;
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
2. Speed: sprint_elapsed_time_s + performance_test:sprint_10m_standing-r1.
3. Power: cycling_5s_peak_power_w + performance_test:cycling_5s_peak_power-r1.

The slice should include:

- extensions to the existing metric and performance-testing catalogs;
- typed persistence;
- target UX;
- current/progress projection where evidence exists;
- feasibility advisory with confidence/evidence provenance;
- family-specific planning projection;
- at least one legitimate coverage path per target;
- target-specific explanation and shortfall;
- formal safety precedence.

CMJ/jump-height can be the next registered power-family metric and is a good regression test for the architecture because it proves the model can support a non-watt explosive-performance outcome without lying about units.

---

# Final design test

At the end of PG7, all four statements must be true:

1. When an athlete says "my goal is a 220 kg conventional deadlift", the system recognizes the exact lift, deliberately prefers safe direct work for it when constraints allow, and uses current capacity rather than 220 kg to determine training load.
2. When an athlete says "my goal is a 1.75 s standing 10 m", the system recognizes the exact sprint test, drives acceleration-relevant training coverage, keeps timed testing distinct from weekly training, and interprets lower time as improvement.
3. When an athlete says "my goal is 1,200 W for 5 s on the bike", the system recognizes the exact power metric/test, drives relevant sprint-power coverage, uses protocol-aware observations for progress, and never turns 1,200 W into an arbitrary daily prescription.
4. When an athlete with a recent valid 100 kg bench 1RM asks for 200 kg in six weeks while capacity permits at most one relevant exposure per week, the system warns that the target is unlikely, reports confidence and the data/evidence behind that confidence, preserves the athlete's ability to keep the goal, and never converts the warning into unsafe dose escalation.

If adding another registered strength, speed or power target after that requires a new goal subsystem instead of a registry/coverage extension, the abstraction is still too narrow.
