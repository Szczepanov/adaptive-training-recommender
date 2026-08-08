# ADR-0004: Decoupled Workout Library & Prescriptions

* **Status:** Accepted
* **Date:** 2026-08-07
* **Deciders:** Core Engineering Team

---

## Context and Problem Statement

The recommendation engine historically produced simple session template names (e.g. "Zone 2 Aerobic", "Threshold Intervals"). However, actual structured training requires detailed session descriptions (blocks, intervals, warm-up, cool-down, RPE targets, equipment, variants for reduced energy, and return-to-training adjustments).

Hardcoding personal targets (e.g., fixed power watts or specific pace numbers) directly into workout definitions limits reusability and creates broken contracts across different bikes, sensors, or fitness levels.

---

## Decision Outcome

We implemented a **multi-layered workout library architecture** in `app/src/workouts/` that decouples reusable training knowledge from dated daily prescriptions:

1. **Layer Hierarchy**:
   * **Exercises**: Atomic movement definitions with required equipment and muscle targets.
   * **Workout Definitions**: Canonical descriptions combining exercises into structured blocks and steps.
   * **Variants**: Explicit full, reduced, and return-to-training adjustments without mutating the canonical workout.
   * **Adjustable Parameters**: Declarative dimension definitions (e.g. interval duration, set count, RPE floor) with strict ranges.
   * **Parameter Bindings**: Explicit maps defining how parameters alter step attributes or invoke execution resolvers.
   * **Workout Prescriptions**: Dated, user-specific instances generated for a specific recovery snapshot.

2. **Duration Ordering Semantics**:
   Enforced strict ordering across variants:
   $$\text{return\_to\_training} \le \text{reduced} \le \text{full}$$

3. **September Event Plan Coverage Contract**:
   A declarative phase coverage contract (`event-plan.ts`) guarantees that every required workout family for build, peak, taper, and race phases exists and is active, validated via automated scripts (`npm run validate:workouts`).
   * **Amendment ([ADR-0012](./0012-plan-intent-authority.md)):** `event-plan.ts` session coverage is combined with dated block schedules (`PlanBlock`) into executable `PlanDefinition` objects consumed directly by the recommendation engine, making the event plan a live planning input rather than solely a pre-flight coverage contract.

4. **Resolved Daily Snapshot and Candidate Routing**:
   `prescription.ts` first resolves an active non-manual catalogue candidate through `WorkoutDefinition.engineTemplateIds`, then retains the legacy mapping as a compatibility fallback. When several active workouts implement one template, `engineTemplatePriority` supplies the deterministic tiebreaker; catalogue assembly order has no routing meaning. It applies the selected full/reduced/return-to-training variant and creates a serializable `WorkoutPrescription`. The snapshot is persisted alongside the daily recommendation (schema version 2) and rendered as ordered warm-up, main, and cool-down instructions with dose, rest, targets, tempo, and cues. Tests require every selectable engine template to resolve to a detailed prescription.

5. **Safe Target Personalization**:
   Personal performance measurements live in the user’s preferences profile, not the generic workout definition. FTP/critical power, threshold pace, LTHR, and exercise e1RM values are optional. Their absence leaves the prescription RPE/RIR-led; the resolver does not infer absolute watts, pace, HR, or lifting load from recovery data.

6. **Technical Skill Safety Contract**:
   `technical_skill` sessions must provide technical objectives, environment/supervision metadata, and explicit stop conditions. Technical targets may include success criteria and common faults in addition to the coaching cue. High-context outdoor handling work is marked `manualOnly` until the planner can establish a suitable area, athlete competence, and supervision.

---

## Code References

* [`docs/workout-library.md`](../workout-library.md) — Architectural overview of the workout library design.
* [`app/src/workouts/models.ts`](../../app/src/workouts/models.ts) — Domain schema for definitions, parameters, bindings, and prescriptions.
* [`app/src/workouts/event-plan.ts`](../../app/src/workouts/event-plan.ts) — September cycle phase coverage rules.
* [`app/scripts/validate-workouts.ts`](../../app/scripts/validate-workouts.ts) — Automated catalog validation runner.

---

## Consequences

### Positive
* Workout definitions remain canonical and generic, allowing dynamic scaling per athlete.
* Prevents progression errors through strict automated validation during pre-flight checks (`npm run check`).
* Daily recommendations become auditable executable plans rather than transient summary text.
* Missing performance measurements degrade safely to relative intensity guidance.

### Negative
* Higher structural complexity than static text templates.
* Engine templates must resolve to a non-manual detailed workout; regression tests enforce this contract.
* A new alternate implementation for an existing template must declare an intentional `engineTemplatePriority` when it should not replace the canonical default.
* Outdoor technical skill cannot be auto-prescribed merely because its cardiovascular cost is low; it needs safety context.
