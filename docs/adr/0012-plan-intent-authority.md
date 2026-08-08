# ADR-0012: Plan Intent and Sequence Planning are the Training Authorities

* **Status:** Accepted
* **Date:** 2026-08-08
* **Deciders:** Core Engineering Team
* **Addresses:** F16, F17, F9

---

## Context and Problem Statement

`app/src/workouts/event-plan.ts` encodes the real athlete macrocycle: 17 coverage entries with phases (`build | travel | peak | taper | race`), requirement tiers, workout IDs, and coaching notes. However, prior to Phase 2, its only consumer was `app/scripts/validate-workouts.ts` (F16).

The live planner instead reduced the athlete's training plan to five generic rolling objectives and re-derived phase strictly from `daysToEvent` arithmetic, producing a `PhaseWeights` whose `intensityScale` was read by nobody and whose `volumeScale` fed a single scalar multiplier (F17). Furthermore, two separate phase-name vocabularies existed without an explicit canonical mapping between them.

An explicit training plan — not generic days-to-event arithmetic — must be the authority on what a given date should develop, and that plan must be represented by domain objects that the adaptive engine directly consumes.

---

## Decision Outcome

### 1. Authoritative Domain Objects

The system introduces a formal plan representation:

* **`PlanDefinition`**: Top-level container representing an explicit macrocycle plan (`id`, `eventId`, `blocks`, `objectives`, `sequencingRules`).
* **`PlanBlock`**: A dated calendar window (`id`, `phase`, `startDate`, `endDate`, `volumeScale`, `intensityScale`).
* **`PlanObjectiveDefinition`**: Objective specification tied to a specific block (`key`, `coverageKey`, `blockId`, `requiredCredit`, `priority`, `minGapHoursFrom`).
* **`SequencingRule`**: Macrocycle/microcycle sequencing constraints across session types and rest intervals.
* **`SessionRole`**: Functional designation of a session within the plan context (`primary_developmental`, `secondary_support`, `taper_sharpening`, `recovery_active`).

### 2. Layer Responsibility Boundaries

The training engine strictly demarcates responsibilities across five distinct layers:

1. **`periodization`**: Fallback phase inference strictly when no explicit `PlanDefinition` exists for the event/window.
2. **`plan intent`**: Authority on what target date should develop (volume/intensity scales, objective targets, required coverage), evaluated *before* readiness/safety constraints.
3. **`horizon planner`**: Multi-day sequence-level feasibility, week-ahead session distribution, and rest-day spacing across the window.
4. **`readiness / safety`**: Single hard gate (`evaluateReadinessAndSafetyEnvelope`) determining how much of the plan intent is safe to execute today (mode, envelopes, max execution dose, restricted modalities).
5. **`optimizer`**: Utility selection **among equivalent feasible implementations only**, subject to the safety envelopes and plan intent.

### 3. Lexicographic Priority Model

Objective selection and constraint evaluation follow a strict lexicographic hierarchy (hard priority ordering, not multiplicative scaling):

$$ \text{Safety} \succ \text{Must-Have Plan Obligations} \succ \text{Sequence / Recovery Constraints} \succ \text{Objective Coverage} \succ \text{Fatigue Cost} \succ \text{Preference} $$

1. **Safety**: Hard clinical/biomechanical envelope limits, systemic load ceilings, active injury restrictions.
2. **Must-Have Plan Obligations**: Required coverage sessions for the active `PlanBlock` (e.g. required threshold or event-specific sessions).
3. **Sequence & Recovery Constraints**: Minimum inter-session gaps, max consecutive intense days, soft tissue recovery windows.
4. **Objective Coverage**: Progress toward active microcycle/block credit requirements.
5. **Fatigue Cost**: Exponential decay internal load impact and acute-to-chronic workload accumulation.
6. **Preference**: Athlete modality choices, equipment preferences, and minor ranking modifiers.

*Principle:* Athlete preference or anti-stack modifiers can **never** override a higher-ranking priority (e.g. a 0.15× anti-stack multiplier overriding a 1.40× A-event boost is explicitly prohibited).

### 4. Objective Credit Semantics

Objective credit tracking adheres to three principles (detailed mechanics in Phase 4):
* **Fractional**: Partial credit is granted proportionally based on completed session duration and intensity relative to prescribed targets.
* **Dose-sensitive**: Credit accumulated depends directly on actual executed dose ($S_{\text{executed}} / S_{\text{prescribed}}$).
* **Carries confidence**: Credit assignments carry provenance and confidence tags based on data source quality (Garmin recorded vs manual log).

### 5. Two Planning Modes & Fallback Semantics

* **Explicit Mode (`PlanDefinition` block calendar)**: When a `PlanDefinition` exists for the active event, block calendar dates determine phase, volume/intensity scales, and objective windows deterministically. Explicit mode wins where present.
* **Generic Mode (`days-to-event` fallback)**: When no explicit plan exists, generic `daysToEvent` periodization phase weights provide baseline target derivation and validation cross-checks.

### 6. Decisions Taken (2026-08-08)

#### Decision D1 — `EventPlanPhase` is the Canonical Phase Vocabulary

`EventPlanPhase` (`'build' | 'travel' | 'peak' | 'taper' | 'race' | 'recovery'`) is established as the canonical phase vocabulary across the entire repository.

`PhaseWeights.phaseName` (`Base | Build | Specificity | Peak/Taper | Post-Event Recovery`) becomes a *derived display label* produced by the generic fallback mapper:

| `PhaseWeights.phaseName` | `EventPlanPhase` |
|---|---|
| Base, Build | `build` |
| Specificity | `peak` |
| Peak/Taper | `taper` |
| Post-Event Recovery | **`recovery`** |

*Rules:*
* A new `'recovery'` phase member is added to `EventPlanPhase`.
* The legal coverage families in `'recovery'` are strictly restricted to `easy_aerobic` and `recovery_or_rest`. Fitness-developing families (`sustained_quality`, `short_surges`, `gap_closing`, `outdoor_event_specific`, `primary_strength`) are illegal during `recovery`.
* `'race'` and `'travel'` phases are set **only** by an explicit `PlanDefinition` block schedule; generic `daysToEvent` arithmetic never infers them.

#### Decision D2 — `intensityScale` Consumer

`intensityScale` is retained (taper is defined by volume reducing while intensity is preserved).

*Consumer:* Implemented by **Phase 4 work item 4.5**:
```ts
interface PlannedDose {
  volume: number;    // duration target from PlanBlock.volumeScale
  intensity: number; // admissible intensity band from PlanBlock.intensityScale
}
```
`trainingIntent.ts` `resolvePlannedDose` now carries `intensityScale` into candidate
eligibility, while `dose.ts` applies its safety ceiling to volume only.

### 7. Production Wiring Scope (added in PR review)

Landing the domain objects (`PlanDefinition`, `EventTiming`) without a real path from
persisted data to the engine would leave `event-plan.ts` without an actual engine-path
consumer -- the exact problem (F16) this ADR exists to close. This PR therefore wires
both all the way through, with an explicitly narrow scope for the plan side:

* **`EventTiming` is fully generic.** `UserGoal.timing` is validated on write by
  `validateGoal` (`validation.ts`), persisted/cleared by `goalService.ts` the same way
  as `eventCategory`/`eventPreset`/`eventLifecycle`, and carried unchanged onto
  `UserEvent.timing` by `goalToUserEvent` (`periodization.ts`) -- the only real
  production constructor of `UserEvent`. `evaluatePeriodizationPhase` already anchored
  on `event.timing?.planningDate`; that now has real data to read for *any* event a user
  enters, not just a fixture. There is still no UI for entering/confirming a date range
  (`Goals.tsx` collects a single `targetDate`) -- that is separate, future work.
* **`PlanDefinition` is intentionally narrow, not generic.** There is no per-event
  plan-authoring mechanism or persistence layer yet -- `buildSeptemberCyclingEventPlan`'s
  block calendar and `requiredCredit` numbers are hand-authored for one specific event.
  `resolvePlanDefinitionForEvent` (`planSchedule.ts`) matches only that event
  (`category === 'cycling_event' && date === '2026-09-20'`) and is wired into
  `resolveTrainingIntent` (`trainingIntent.ts`); every other event continues through the
  generic `daysToEvent` fallback. Authoring a `PlanDefinition` for an arbitrary
  user-created event is future work, tracked separately from this ADR's acceptance
  criteria.
* **Plan-derived objectives are date-scoped.** `generateWeeklyObjectives`'s plan branch
  originally returned every objective from every block in the plan regardless of the
  current date. It now takes an `asOfDate` and returns only the objectives belonging to
  the block active on that date -- without this, an athlete in the build block would see
  peak- and taper-block objectives (e.g. a race-specific-endurance session two months
  out) as already unresolved from day one.

---

## Migration and Acceptance Criteria

1. **Phase 0 Invariants**: All Phase 0 developer baseline tests and multi-week engine simulations must continue to pass without regression.
2. **Catalog Integrity**: `validateEventPlanCoverage` verifies 100% active workout mapping across all `EventPlanPhase` members (including `recovery`).
3. **No Unintended Behavior Changes**: Generic (planless) athletes retain identical periodization fallback behaviors.
