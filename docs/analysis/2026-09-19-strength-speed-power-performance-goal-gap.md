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

A production performance-target feature requires typed family/metric semantics and canonical subject identity rather than title parsing.

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
3. Extend ComparisonDimension only when a new protocol genuinely requires another series-defining dimension.
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

## 9. Goal feasibility is a separate advisory product capability

A typed target answers **what** the athlete wants to achieve. It does not answer whether that outcome is realistic by the selected date under the athlete's current training capacity.

That gap matters. A system that accepts:

~~~text
bench press current 1RM: 100 kg
target: 200 kg
target date: 6 weeks away
available/relevant training frequency: 1 session/week
~~~

without any warning is technically storing the goal correctly but is not giving the athlete useful decision support.

The product should therefore add a **goal-feasibility assessment** that is:

- advisory, not a hard blocker;
- family-specific;
- evidence- and data-quality-aware;
- explicit about uncertainty;
- reproducible/versioned;
- independent from prescription authority.

The athlete may keep an aggressive goal after seeing the warning. The system must not silently rewrite the target, target date or training dose.

### 9.1 Plausibility and confidence are different outputs

Do not collapse "how realistic is this?" and "how sure are we?" into one score.

Recommended plausibility vocabulary:

~~~text
already_achieved
plausible
stretch
unlikely
insufficient_evidence
~~~

Recommended confidence vocabulary:

~~~text
low
moderate
high
~~~

Examples:

- **Unlikely / high confidence** — recent protocol-valid 1RM, stable target-specific history, known schedule, and the required change is far outside applicable evidence/personal history.
- **Unlikely / low confidence** — the target looks extreme, but the only baseline is an old manual estimate and training history is sparse.
- **Insufficient evidence** — no comparable baseline, no usable target date, or no applicable family-specific evidence.

Do not report an exact probability such as "3.7% chance" unless a future model is prospectively calibrated against representative outcomes. An enum/band plus transparent factors is more honest than pseudo-precision.

### 9.2 Feasibility needs more than current value and target value

At minimum the assessment should use, where available:

1. **Comparable current baseline**
   - measured/tested versus estimated;
   - observation date/recency;
   - protocol/comparison-series identity;
   - validity/reliability metadata.
2. **Goal horizon**
   - targetDate;
   - days/weeks remaining.
3. **Required change**
   - absolute change;
   - relative percentage change;
   - a clearly labelled **linearized equivalent per week** for explanation only.
4. **Training capacity**
   - TrainingIntentProfile.weeklyCommitment;
   - ResolvedTrainingCapacity usable windows/minutes;
   - fixed/external commitments that consume capacity.
5. **Target-specific exposure**
   - recent direct exercise/test-relevant training frequency;
   - projected target-specific coverage once PG5-PG7 are available;
   - adherence to similar planned work.
6. **Target-specific training history**
   - recent comparable strength/sprint/power observations;
   - direct subject exposure history;
   - personal rate of change when enough valid observations exist.
7. **Population evidence applicability**
   - training status/experience relevant to the target;
   - protocol/exercise/test match;
   - intervention duration and dose match;
   - limitations of the evidence population.

The existing generic trainingAgeProxy is useful context but is **not sufficient by itself** to label someone a trained bench presser, sprinter or cyclist. It is inferred from recent total exposure, not target-specific history. Feasibility should prefer canonical performed-training facts and comparable outcome history for the specific target.

### 9.3 Use current scheduling ownership rather than inventing another frequency field

The repository already owns total training capacity through:

- TrainingIntentProfile.weeklyCommitment min/target/max sessions;
- ResolvedTrainingCapacity;
- schedule windows;
- fixed/external activities.

If maxSessions is 1, then the system has a defensible upper bound of at most one planned target-specific exposure per week.

If maxSessions is 5, the system must **not** assume five bench/sprint/power exposures. Target-specific frequency remains unknown until direct coverage is projected or observed.

A future explicit per-goal frequency preference may be useful, but this plan should not add one merely to make feasibility math convenient.

### 9.4 Evidence hierarchy for plausibility

Use the strongest applicable evidence first:

1. the athlete's own comparable longitudinal response, if enough data exist;
2. family-/test-specific population evidence matched to training status and dose;
3. broader population evidence with explicit applicability downgrade;
4. otherwise, insufficient_evidence.

No universal "% improvement per week" constant should be shared across strength, speed and power.

Any evidence-backed bands or thresholds used by production must live in the Sports Knowledge Registry or another reviewed/versioned evidence policy surface, with population, metric, duration and dose limitations attached.

### 9.5 Bench-press example

For a recent, valid 100 kg bench-press 1RM with a 200 kg target 42 days away and at most one relevant exposure per week:

~~~text
required absolute change:       +100 kg
required relative change:       +100%
time remaining:                 6 weeks
linearized equivalent change:   +16.7 kg/week   (descriptive only)
maximum planned exposures:      6
~~~

This should not be interpreted as "add 16.7 kg every week." It is a compact description of how large the outcome gap is relative to the horizon.

The literature is enough to flag this example strongly without claiming physiological impossibility:

- the 2026 ACSM position stand synthesized 137 systematic reviews and reports that voluntary strength is enhanced by heavier loading, 2-3 sets and at least 2 sessions/week;
- a 2026 dose-response meta-regression found strength gains increased with weekly set volume and with training frequency, both with diminishing returns; this supports graded evidence about training opportunity rather than a deterministic frequency cutoff;
- a frequency meta-analysis found higher frequency associated with larger strength effects overall, while the difference disappeared in volume-equated subgroups, so frequency is informative but must not be treated as the only causal variable;
- a systematic review of minimum effective dose in resistance-trained men found that low-dose training can still improve 1RM and reported a pooled bench-press increase of 8.25 kg across included low-dose studies; this is a benchmark, not a six-week prediction;
- a six-week study in resistance-trained men reported bench-press 1RM/body-mass increases of roughly 4.7-7.7% across training groups;
- a systematic review of 1RM test-retest reliability reported a median coefficient of variation of 4.2%, so a +100% target gap is far larger than ordinary measurement noise.

Useful research anchors:

1. Currier BS et al. ACSM Position Stand: Resistance Training Prescription for Muscle Function, Hypertrophy, and Physical Performance in Healthy Adults. 2026. https://pubmed.ncbi.nlm.nih.gov/41843416/
2. Pelland JC et al. The Resistance Training Dose Response: Meta-Regressions Exploring the Effects of Weekly Volume and Frequency on Muscle Hypertrophy and Strength Gains. 2026. https://pubmed.ncbi.nlm.nih.gov/41343037/
3. Grgic J et al. Effect of Resistance Training Frequency on Gains in Muscular Strength: a systematic review and meta-analysis. 2018. https://pubmed.ncbi.nlm.nih.gov/29470825/
4. Androulakis-Korakakis P et al. Minimum Effective Training Dose Required to Increase 1RM Strength in Resistance-Trained Men. 2020. https://pubmed.ncbi.nlm.nih.gov/31797219/
5. Coratella G et al. Eccentric resistance training increases and retains maximal strength, muscle endurance, and hypertrophy in trained men. 2016. https://pubmed.ncbi.nlm.nih.gov/27801598/
6. Grgic J et al. Test-retest reliability of the one-repetition maximum strength assessment. 2020. https://pubmed.ncbi.nlm.nih.gov/32681399/

For that specific example, with a recent tested baseline and known one-session/week capacity, the product should be capable of showing:

~~~text
Goal feasibility: Unlikely
Confidence: High

Why:
- +100 kg / +100% required in 6 weeks
- at most 6 relevant planned exposures before the target date
- current evidence favors more frequent strength exposure for maximizing strength
- required change is far outside the athlete's observed history and applicable published benchmarks

This is advisory. You can keep the goal, change the date, change the target, or review training availability.
~~~

If the 100 kg baseline were a stale self-estimate with no recent training history, the same target might still be labelled unlikely but with **low confidence**, and the first recommended action would be to establish a valid baseline rather than pretending the estimate is precise.

### 9.6 Family-specific models, not one universal formula

Strength feasibility may use 1RM/e1RM evidence, exercise-specific history and relevant weekly exposure.

Speed feasibility must use the exact registered test/protocol, because a 0.10 s improvement at 10 m has a different interpretation from a 0.10 s improvement over another distance/start convention.

Power feasibility must use the exact metric/protocol and device-comparison semantics already owned by the observations system.

The common framework owns the assessment shape and confidence logic. Each metric family owns the evidence model used to produce a plausibility band.

### 9.7 Feasibility must not become hidden prescription authority

A warning that a goal is unlikely does not authorize:

- extra heavy sessions;
- unsafe weekly frequency;
- accelerated load jumps;
- removal of recovery work;
- overriding schedule/injury/readiness constraints.

Feasibility may suggest **options** ("extend target date", "review target value", "review available training frequency", "collect a better baseline"), but the normal planner remains the only owner of training dose.

---

## 10. Legacy targets must stay non-authoritative

Existing goals with arbitrary targetMetric / targetValue / targetUnit must continue to read and render.

Do not infer:

~~~text
metric = deadlift
~~~

as conventional_deadlift, or:

~~~text
metric = 10m
~~~

as PerformanceTestDefinition sprint_10m_standing-r1.

A later conversion flow may offer a user-confirmed mapping when the destination is unambiguous. Silent migration would create recommendation authority from previously decorative free text.

---

## 11. Findings summary

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
| PG-F14 | A typed target can still be wildly unrealistic for its horizon/capacity | Add advisory goal-feasibility assessment before treating date/value as a useful planning objective |
| PG-F15 | Plausibility and certainty are different concepts | Report plausibility band and confidence separately, with the inputs/evidence behind both |
| PG-F16 | Existing weekly commitment/schedule models total capacity, not guaranteed target-specific frequency | Use capacity as an upper bound and direct/planned coverage for target-specific exposure |
| PG-F17 | Generic trainingAgeProxy is not target-specific | Prefer exercise/test-specific performed-training and comparable outcome history for evidence applicability |

---

## 12. Architectural conclusion

The deadlift example should remain an acceptance case, not the architecture.

The scalable capability is:

~~~text
ATHLETE OUTCOME
registered metric + canonical exercise/test + target value
        |
        v
FEASIBILITY ADVISORY
current baseline + horizon + capacity + target-specific history + evidence
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
