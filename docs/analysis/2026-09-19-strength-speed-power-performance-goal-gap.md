# Strength, speed and power performance-goal gap — typed measurable targets (2026-09-19)

**Date:** 2026-09-19
**Status:** point-in-time analysis
**Scope:** determine whether an athlete can express a measurable strength, speed or power outcome, whether that intent reaches live planning, and how to model the capability without creating deadlift-only, sprint-only or device-specific special cases.

---

## Executive verdict

The repository does not currently have an actionable measurable-performance-goal feature for strength, speed or power.

Today an athlete can select broad Training Plan priorities such as Strength and muscle or Speed and power, and the Goals screen can persist a free-text targetMetric / targetValue / targetUnit triple. Neither path carries a typed performance outcome into weekly allocation or session selection.

The original deadlift example exposed the gap, but the gap is wider. These are all the same product problem:

- Conventional deadlift — 220 kg tested 1RM.
- Front squat — 160 kg tested 1RM.
- Standing 10 m sprint — 1.75 s.
- Flying 10 m sprint — 1.00 s.
- Countermovement jump — 50 cm.
- Cycling 5 s peak power — 1,200 W.

The correct abstraction is a **typed performance target bound to a canonical subject or test**, not a deadlift-specific field and not an unrestricted "metric + value + unit" text box.

The repository already contains useful substrate:

- canonical strength and field exercise identities, including conventional_deadlift, sprint_falling_start_10m and sprint_fly_10m;
- broad TrainingPriority values strength_muscle and speed_power;
- per-exercise e1RM capacity and strength-set logging;
- strength/power objectives and existing power-oriented workout steps;
- the observation/outcome architecture, although its metric registry is currently cycling-first;
- deterministic weekly allocation, eligibility, injury and scheduling gates.

The missing bridge is therefore:

~~~text
typed performance outcome
  -> metric + canonical subject/test identity
  -> family-specific planning demand
  -> relevant direct/supporting training coverage
  -> current-capacity/autoregulated prescription
  -> comparable measurement evidence
  -> progress / target attainment
~~~

One invariant applies to every family: **the aspirational target chooses what the athlete wants to improve; it is not current capacity and must never be used as today's dose authority.**

Execution work is proposed in docs/plans/strength-speed-power-performance-goals.md.

---

## 1. What the athlete sees today

### 1.1 Training priorities are intentionally broad

TrainingPlanSection exposes:

- health;
- balanced_performance;
- endurance;
- strength_muscle;
- speed_power;
- sport_readiness.

These are adaptation priorities, not measurable outcomes.

In evergreenStrategy, strength_muscle can request the existing required strength dose. speed_power is grouped with endurance and sport_readiness as a generic performance priority and, when the evidence/readiness gate allows it, can add an optional high_intensity requirement. Neither priority identifies a lift, sprint distance/start protocol, jump test or power test.

That is correct for the priority layer, but insufficient for an athlete-owned result such as "10 m in 1.75 s".

### 1.2 The Goals screen looks more specific than it is

Goals.tsx supports a generic Optional Target containing:

- free-text Metric;
- numeric Value;
- free-text Unit.

A user can type deadlift / 220 / kg, 10m sprint / 1.75 / seconds, or peak power / 1200 / W. The system cannot prove what any of those strings mean.

UserGoal currently has no speed or power domain either. Its domain set is endurance, strength, mobility, weight_loss, general_fitness and other. That makes the generic target UI even more misleading for the requested capability.

A real performance-target feature needs typed family/metric semantics and canonical subject identity rather than title parsing.

---

## 2. Current data flow: where specificity disappears

The relevant non-event path is:

~~~text
Goals.tsx
  -> goalService
  -> validateGoal
  -> users/{userId}/goals/{goalId}
  -> DailyDecisionInput.activeGoals
  -> mapContextFromGoalsAndTrainingSettings
  -> UserContext goal-title strings
  -> recommendation / weekly planning
~~~

validateGoal currently normalizes and persists targetMetric, targetValue and targetUnit without proving a registered metric, canonical subject, unit, direction or protocol.

mapContextFromGoalsAndTrainingSettings then reduces active goals to the highest-priority **title** in each time horizon. The metric, value and unit are not carried into the selection boundary. Event goals have a separate typed periodization path, but ordinary strength/speed/power goals do not.

Consequently, changing "10 m sprint 1.80 s" to "10 m sprint 1.70 s", or "deadlift 180 kg" to "deadlift 220 kg", does not create a different typed planning requirement. The current free-text target is display data, not recommendation authority.

---

## 3. Strength, speed and power have different subjects but the same missing contract

### 3.1 Strength

The exercise catalog already gives stable identities such as conventional_deadlift, front_squat, bench_press and romanian_deadlift. AthletePerformanceProfile already stores exercise-keyed estimated1RmKg values and provenance.

That makes an exercise reference a natural subject for a strength 1RM target.

The deadlift-specific catalog gap discovered in the original audit is still real: the active strength workouts inspected use Romanian deadlift rather than conventional deadlift, so a conventional-deadlift target currently has no exact catalog session. That is one **coverage gap**, not the architecture.

### 3.2 Speed

The exercise catalog already contains sprint_falling_start_10m and sprint_fly_10m, representing acceleration and max-velocity training primitives.

A speed outcome, however, cannot safely be identified only by the training exercise. "10 m sprint time" depends on test distance, start convention and timing method. A standing-start 10 m and a flying 10 m are not the same series simply because both are sprinting.

Speed therefore needs a canonical **test/protocol subject**, while workouts can map to the test's relevant adaptation/coverage semantics.

### 3.3 Power

The repository already contains power-oriented work such as hang power clean activation and broad speed_power planning priority. Cycling also has natural power outcomes.

But "power" is not one interchangeable number. Peak watts, mean watts, W/kg and jump height have different units and meanings. Countermovement-jump height is a useful explosive-performance outcome but is not itself mechanical power in watts; the product should label the measured metric honestly.

Power targets therefore also need registered metric and test identity, with protocol/device comparability recorded where relevant.

---

## 4. Recommended persisted target: metric + existing subject authority + value

Use one extensible typed contract:

~~~ts
type PerformanceSubjectRef =
  | { kind: 'exercise'; exerciseId: string }
  | { kind: 'performance_test'; performanceTestId: string };

type GoalPerformanceTarget = {
  kind: 'performance_metric';
  metricId: string;
  subjectRef: PerformanceSubjectRef;
  targetValue: number;
};

interface UserGoal {
  performanceTarget?: GoalPerformanceTarget | null;

  // legacy compatibility only
  targetMetric?: string | null;
  targetValue?: number | null;
  targetUnit?: string | null;
}
~~~

Do not persist a user-entered unit or direction inside the typed target. Those already belong to the observation MetricDefinition. Do not copy exercise/test display names into the target. Use stable ids.

For test-bound goals, **reuse the existing PerformanceTestDefinition catalog in app/src/observations/performanceTestingCatalog.ts**. Each definition already owns a versioned MeasurementProtocol, TestingSessionDefinition, default comparison context and expected source. A second "performance test registry" would duplicate an authority the repository already has.

Examples:

| Athlete intent | metricId candidate | subjectRef | canonical target |
|---|---|---|---:|
| Conventional deadlift 1RM | strength_1rm_kg | exercise: conventional_deadlift | 220 |
| Standing 10 m sprint | sprint_elapsed_time_s | performance_test: sprint_10m_standing-r1 | 1.75 |
| Flying 10 m sprint | sprint_elapsed_time_s | performance_test: sprint_flying_10m-r1 | 1.00 |
| Countermovement jump | jump_height_cm | performance_test: cmj_standard-r1 | 50 |
| Cycling 5 s peak power | cycling_5s_peak_power_w | performance_test: cycling_5s_peak_power-r1 | 1200 |

The exact new metric/test ids are ADR decisions and should follow existing registry naming conventions. The shape is the important decision.

---

## 5. Reuse the observation metric and performance-testing infrastructure

The repository already has more of the required outcome architecture than the original draft credited:

- MetricDefinition already owns id, displayName, domain, unit, direction, valueKind and description.
- MeasurementProtocol already owns protocol id/revision, compatible metricIds, instructions, comparison dimensions, familiarization, burden and invalidation rules.
- PerformanceTestDefinition already composes MeasurementProtocol with a TestingSessionDefinition, default comparison context and expected source.
- MetricObservationRevision already stores protocolRef and comparisonSeriesKey.
- buildComparisonSeries already includes metric id, protocol id/revision, canonicalization version and series-defining dimensions in comparability identity.

Therefore:

1. Extend app/src/observations/registry.ts with reviewed target metrics; do not invent a second metric-definition type.
2. Extend app/src/observations/performanceTestingCatalog.ts for new test-bound speed/power goals.
3. Extend ComparisonDimension only when a real new protocol requires another series-defining dimension.
4. Add only a thin **goal-target policy** that says which registered metrics are target-eligible, which product family they belong to, and what subject kind they accept.

Conceptually:

~~~ts
interface PerformanceTargetPolicy {
  metricId: string;
  family: 'strength' | 'speed' | 'power';
  subjectKind: 'exercise' | 'performance_test';
  targetRange?: { min: number; max: number };
}
~~~

For performance_test subjects, semantic validation resolves getPerformanceTestDefinition(performanceTestId) and requires that its MeasurementProtocol declares the target metric.

For exercise subjects, semantic validation resolves the canonical exercise and checks the target policy's exercise eligibility.

This preserves one measurement vocabulary and one protocol/comparability authority.

## 6. Outcome identity and training coverage are deliberately different

## 6. Outcome identity and training coverage are deliberately different

A goal test is not automatically a workout prescription.

Examples:

- A conventional-deadlift 1RM target can require meaningful conventional-deadlift practice inside strength allocation.
- A standing 10 m sprint target can require acceleration exposure; it should not require a maximal timed 10 m test every week.
- A flying 10 m target maps primarily to max-velocity exposure.
- A CMJ target maps to explosive/jump-power development while formal CMJ testing remains periodic.
- A cycling 5 s peak-power target can map to short maximal cycling sprint exposure with adequate recovery.

The implementation therefore needs a separate target-to-planning rule, conceptually:

~~~ts
interface PerformanceTargetPlanningRule {
  metricId: string;
  broadAdaptation: 'strength' | 'high_intensity' | 'power' | string;
  coverage: {
    kind: 'exact_exercise' | 'movement_or_session_role' | 'test_specific_practice';
    subjectIds: string[];
  };
}
~~~

The exact type should fit existing weekly-dose/coverage architecture. The important invariant is that the measurement registry does not become a pile of hidden training prescriptions.

Broad TrainingPriority and a typed target must also not double-count the same adaptation floor.

---

## 7. Target, current capability and today's dose are three different numbers

For strength:

~~~text
goal:                  220 kg tested 1RM
current capacity:      180 kg estimated 1RM
today's working load:  resolved from current capacity + RIR/safety
~~~

For speed:

~~~text
goal:                  1.75 s standing 10 m
current observation:   1.88 s under comparable protocol
today's sprint dose:   resolved from phase, readiness, tissue/safety and session design
~~~

For power:

~~~text
goal:                  1,200 W cycling 5 s peak
current observation:   1,080 W under comparable protocol/device
today's sprint load:   resolved by the training session, not by a 120 W "gap"
~~~

The system must never infer "required weekly progression" by dividing target gap by days-to-target. A larger aspiration is not permission for a larger daily dose.

The existing exercise-keyed e1RM path is a useful strength capacity proxy. Speed and power should use comparable observations/protocols rather than inventing equivalent hidden state.

---

## 8. Measurement comparability is product semantics, not polish

The research reinforces the architecture:

- Direct 1RM testing is generally highly reliable when procedures are standardized, but an estimated 1RM remains a different evidence type from a tested single.
- Short sprint timing can be reliable, but split/distance, start and timing setup define the result; a number without protocol identity is not safely comparable.
- Sprint-speed measurement reviews show method choice matters, with timing gates/radar/laser behaving differently from weaker methods in some settings.
- Countermovement-jump height can differ materially depending on calculation method even for the same jump, so "50 cm" needs a protocol/measurement identity.
- Force-plate and wearable systems can show systematic differences despite good within-device reliability.

Useful research anchors reviewed for this design:

1. Grgic J et al. Test-retest reliability of the one-repetition maximum strength assessment. Sports Med Open. 2020. https://pubmed.ncbi.nlm.nih.gov/32681399/
2. Reliability of 20 m sprint split times using infrared timing gates. 2025. https://pubmed.ncbi.nlm.nih.gov/40218589/
3. Methods to assess maximal sprinting speed: systematic review. 2024. https://pubmed.ncbi.nlm.nih.gov/38252665/
4. Countermovement-jump height calculation methods: systematic review. 2024. https://pubmed.ncbi.nlm.nih.gov/39425876/
5. Validity/reliability of load-velocity relationships for maximal-strength prediction: systematic review. 2022. https://pubmed.ncbi.nlm.nih.gov/36301878/

These sources do not dictate the training policy. They support the narrower architecture rule that target/evidence identity must include the metric and the protocol needed to interpret it.

---

## 9. Legacy targets must stay non-authoritative

Existing goals with arbitrary targetMetric / targetValue / targetUnit must continue to read and render.

Do not infer:

~~~text
metric = deadlift
~~~

as conventional_deadlift, or:

~~~text
metric = 10m
~~~

as sprint_10m_standing.

A later conversion flow may offer a user-confirmed mapping when the destination is unambiguous. Silent migration would create recommendation authority from previously decorative free text.

---

## 10. Findings summary

| ID | Finding | Consequence |
|---|---|---|
| PG-F1 | Training priorities are broad adaptation inputs | They cannot represent a measurable performance outcome |
| PG-F2 | UserGoal keeps a weak free-text target triple | Metric, subject, unit and protocol are ambiguous |
| PG-F3 | UserGoal has no speed or power domain | Current goal taxonomy cannot honestly represent those goals |
| PG-F4 | The active-goal adapter forwards goal titles, not typed targets | Measurable targets do not reach selection |
| PG-F5 | strength_muscle can create broad strength demand | Reuse it; do not invent a second broad strength floor |
| PG-F6 | speed_power currently only contributes generic performance/high-intensity demand | A sprint/power target needs a more specific bridge |
| PG-F7 | Strength has canonical exercise identity and e1RM substrate | Reuse exercise ids and existing capacity ownership |
| PG-F8 | Canonical sprint training primitives already exist | They are useful coverage candidates but not sufficient test identity |
| PG-F9 | Power-oriented workout content exists | Power target metrics still need truthful metric/test semantics |
| PG-F10 | The observation metric and performance-testing catalogs are cycling-first but already versioned/comparability-aware | Extend them rather than creating duplicate metric/test registries |
| PG-F11 | Direct test identity and weekly training coverage are different concepts | Do not force maximal testing as weekly goal coverage |
| PG-F12 | Target value is an outcome, never current capacity or dose | Safety/readiness/autoregulation remain prescription authority |
| PG-F13 | The prior docs-only CI failure was trailing whitespace in the two original Markdown files | The revised files are normalized before push |

---

## 11. Architectural conclusion

The deadlift example should remain an acceptance case, not the architecture.

The scalable capability is:

~~~text
ATHLETE OUTCOME
registered metric + canonical exercise/test + target value
        |
        v
PLANNING PROJECTION
family + priority + typed coverage semantics
        |
        v
SESSION SELECTION
relevant direct/supporting work, after hard constraints
        |
        v
PRESCRIPTION
current capability + existing safety/autoregulation
        |
        v
EXECUTION / OBSERVATION
protocol-aware measurement evidence
        |
        v
PROGRESS
direction-aware distance to target / formal attainment
~~~

A first vertical slice should prove that the contract works for at least one strength target, one speed target and one power target. Once that succeeds, adding another registered lift, sprint test or power test is a registry/coverage extension rather than a new goal subsystem.
