# ADR-0041: Typed Strength, Speed and Power Performance Goals (Stage 1)

* **Status:** Accepted
* **Date:** 2026-09-19
* **Deciders:** Repository owner
* **Source analysis:** [2026-09-19 strength/speed/power performance-goal gap analysis](../analysis/2026-09-19-strength-speed-power-performance-goal-gap.md), [strength, speed and power performance-goals plan](../plans/strength-speed-power-performance-goals.md)

## Context

An athlete can today select broad `TrainingPlanSection` priorities (`strength_muscle`,
`speed_power`) and can type a free-text `targetMetric` / `targetValue` / `targetUnit`
triple on `UserGoal`. Neither path lets the system prove what the athlete actually wants:
"deadlift 220 kg" and "10 m sprint 1.75 s" are indistinguishable strings from "vibes 7
out of 10". `mapContextFromGoalsAndTrainingSettings` only ever forwards goal **titles** to
planning, so changing a target's numeric value changes nothing the engine can act on.

The repository already owns the substrate a typed contract needs: canonical exercise
identities (`conventional_deadlift`, `front_squat`, `bench_press`, `sprint_falling_start_10m`,
`sprint_fly_10m`, ...), per-exercise e1RM capacity (`AthletePerformanceProfile.estimated1RmKg`),
and a versioned, comparability-aware observation/measurement-protocol system
(`app/src/observations/`) that is currently cycling-first but not cycling-only by design.

## Decision

1. **`performanceTarget` is the canonical typed measurable outcome** for new strength,
   speed and power goals:

   ```ts
   type PerformanceSubjectRef =
     | { kind: 'exercise'; exerciseId: string }
     | { kind: 'performance_test'; performanceTestId: string };

   type GoalPerformanceTarget = {
     kind: 'performance_metric';
     metricId: string;
     subjectRef: PerformanceSubjectRef;
     targetValue: number;
   };
   ```

   It is persisted as `UserGoal.performanceTarget`. Legacy `targetMetric` / `targetValue`
   / `targetUnit` remain readable but are never authoritative once a valid
   `performanceTarget` exists.

2. **Metric semantics live in the existing observations registry**
   (`app/src/observations/registry.ts`), not in a second goal-only metric type.
   `MetricDefinition.unit` and `.direction` are the only source of unit/direction truth;
   the goal layer never persists a user-entered unit or a higher/lower-is-better flag.

3. **Subject identity reuses existing authorities.** An `exercise` subject resolves
   against the canonical exercise catalog (`app/src/workouts/exercises.ts`); a
   `performance_test` subject resolves against the existing
   `PerformanceTestDefinition` catalog (`app/src/observations/performanceTestingCatalog.ts`).
   No second performance-test registry is created.

4. **Current capability/evidence is never copied into the goal.** `performanceTarget`
   stores only the aspirational `targetValue`. Current e1RM, latest comparable
   observation, and today's working load are read separately at display/feasibility
   time and are never written back onto the goal document.

5. **Target value cannot become prescription intensity or automatic progression.**
   Nothing introduced by this ADR divides a target gap by days-remaining to produce a
   dose, and nothing here is wired into `optimizer.ts`, `weeklyDosePacking.ts` or
   `prescription.ts`. That wiring is explicitly deferred (see Stage 2, below).

6. **Goal-test identity and workout coverage are distinct contracts.** A metric +
   subject answers "what does this number mean?"; it does not by itself answer "which
   workouts count as training toward it?" That mapping (plan PG5/PG6) is deliberately
   out of scope for this ADR.

7. **Active typed goals create no planning demand yet.** Stage 1 (this ADR) ships no
   change to `evergreenStrategy.ts`, `optimizer.ts`, weekly allocation, or
   `POLICY_VERSION`. A typed target is tracked and displayed but is not yet
   recommendation-authoritative. Stage 2 (plan PG5-PG7) requires its own policy
   verification, `POLICY_VERSION` bump, and simulation review before that changes.

8. **Legacy free-text targets remain non-authoritative.** No migration infers
   `targetMetric: 'deadlift'` as `conventional_deadlift`. Conversion, if ever added, is
   explicit and user-confirmed.

9. **Typed-versus-legacy precedence is one rule, enforced at the goal
   validation plus service read/write boundary** (`validateGoal` in
   `app/src/engine/validationCore.ts`, `goalService.ts`). `validateGoal` owns
   structural shape only; `goalService` owns registry/domain semantics on both writes
   and reads so a semantically invalid persisted target cannot reach UI/planning code:
   - a valid `performanceTarget` wins for display, progress and feasibility; conflicting
     legacy fields are ignored and cleared on write;
   - a malformed/unknown `performanceTarget` (unregistered metric, unresolvable subject,
     non-finite value) fails closed as invalid goal data — it never silently falls back
     to the legacy triple;
   - a document with no `performanceTarget` keeps legacy fields as backward-compatible
     display data only.

10. **Safety, external-plan/event authority and hard eligibility outrank target
    coverage** whenever coverage wiring lands in Stage 2. This ADR does not change that
    authority order; it only names it as a constraint on Stage 2 design.

11. **Estimated and tested/measured evidence remain distinguishable.** e1RM stays
    labelled as an estimate; a `MetricObservationRevision` carries its own `validity`
    and protocol reference. This ADR does not merge those evidence types.

12. **Protocol comparability is required before two observations are treated as one
    progress series**, reusing `comparisonSeriesKey` / `protocolRef` /
    `buildComparisonSeries` / `areComparisonSeriesComparable`. A standing-10 m result
    never joins a flying-10 m series merely because both use `sprint_elapsed_time_s`.

13. **Goal feasibility is derived advisory state, not athlete-authored `UserGoal` truth
    and not prescription authority.** It is computed on read from current baseline,
    horizon, capacity and evidence; it is never copied into the goal document as
    recommendation input.

14. **Plausibility and confidence are separate outputs**, each with explicit
    machine-readable factor/evidence provenance (`GoalFeasibilityAssessment.factors`,
    `.evidenceRefs`). Plausibility uses
    `already_achieved | plausible | stretch | unlikely | insufficient_evidence`;
    confidence uses `low | moderate | high`.

15. **Production feasibility bands/thresholds are versioned evidence policy**, registered
    in the Sports Knowledge Registry (ADR-0033) rather than inlined as magic numbers in
    UI or engine code. Exact outcome probabilities (e.g. "3.7% chance") are forbidden
    until a future model is prospectively calibrated.

16. **Total weekly commitment/schedule capacity is an upper bound, not an assumed
    target-specific frequency.** Feasibility may say "at most N relevant exposures fit
    this schedule"; it must not assume N exposures were or will be specific to this
    target absent direct coverage evidence, which does not exist before Stage 2 lands.
    Stage 1 surfaces `TrainingIntentProfile.weeklyCommitment` as that upper bound and
    explicitly exposes target-specific frequency as unknown. That uncertainty reduces
    confidence when it could change a plausible/stretch classification; if a target is
    already unlikely under the optimistic upper-bound frequency, fewer actual exposures
    cannot make it more plausible and do not reduce confidence in that conclusion.

## First vertical slice (Stage 1 scope)

To prove the abstraction generalizes rather than being deadlift-specific, this ADR's
implementation covers one target per family:

- **Strength:** `strength_1rm_kg` + `exercise: conventional_deadlift`.
- **Speed:** `sprint_elapsed_time_s` + `performance_test: sprint_10m_standing-r1`.
- **Power:** `cycling_5s_peak_power_w` + `performance_test: cycling_5s_peak_power-r1`.

Delivered in Stage 1: `app/src/observations/registry.ts` and
`performanceTestingCatalog.ts` extensions, `app/src/engine/performanceTargetPolicy.ts`
(target-eligibility policy + semantic validators), typed `UserGoal.performanceTarget`
persistence and validation, `speed`/`power` `GoalDomain` values, fail-closed semantic
validation on both goal-service reads and writes, athlete-facing target UX in
`Goals.tsx`, honest current-evidence/progress projection
(`app/src/engine/goalProgress.ts`) with current speed/power observation revisions loaded
through `metricObservationService`, and an advisory feasibility assessor
(`app/src/engine/goalFeasibility.ts`) that consumes the existing weekly-commitment
capacity bound. The strength bands are a versioned, low-certainty Sports Knowledge
Registry heuristic; v2 uses <=1.3%/week as plausible and <=2.0%/week as stretch at the
2+/week reference-capacity ceiling, while speed/power remain
`insufficient_evidence` for rate-of-change plausibility.

## Consequences

**Positive:** athletes can express a real measurable target without the system lying
about what it understood; the architecture generalizes to any registered
metric/exercise/test combination without a new goal subsystem per lift or test.

**Negative / deferred:** Stage 1 ships no recommendation-authority change. An athlete who
sets a typed target will not yet see the weekly plan specialize for it — the UI must say
so explicitly. That gap closes only when Stage 2 (plan PG5-PG7) is separately designed,
policy-reviewed, `POLICY_VERSION`-bumped and simulation-verified.

## Stage 2 (explicitly not decided here)

Whether/how a typed target contributes to weekly allocation, ranking and coverage
(plan PG5-PG7), and whether/how formal outcome evaluation (PG8) or progression automation
(PG9) is built, remain open and require their own ADR amendments or follow-on ADRs plus
policy verification. Nothing in this ADR should be read as pre-authorizing that work.
