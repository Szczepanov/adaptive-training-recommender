# ADR-0007: Adaptive Multi-Sport Engine Architecture & Utility Optimization Pipeline

* **Status:** Accepted
* **Date:** 2026-08-07
* **Deciders:** Core Engineering Team

---

## Context and Problem Statement

A recommendation engine based solely on daily readiness metrics functions as a "workout picker" rather than an adaptive training coach. It suffers from key architectural limitations:
1. **Lack of Weekly Objective Awareness**: Repeatedly selecting the locally "best" workout on consecutive green days without tracking microcycle progress.
2. **Coarse Fatigue Tracking**: A single global hard-session counter cannot distinguish lower-body DOMS from cardiovascular strain, preventing safe multi-sport training (e.g. upper-body strength after a heavy leg day).
3. **Crude Schedule Isolation**: Inheriting today's availability into tomorrow's plan preview produces inaccurate previews when tomorrow has an independent schedule window.
4. **Muddled Authority Boundaries**: Treating user modality dislikes as hard exclusions risks safety regressions if a user unchecks an avoided modality previously treated as an injury restriction.

---

## Decision Outcome

We introduced a 6-tier adaptive multi-sport engine architecture:

1. **Schedule-Aware Availability & Location Context ([`app/src/engine/schedule.ts`](../../app/src/engine/schedule.ts))**:
   * Evaluates day-of-week schedule windows, location profiles (`home`, `gym`, `travel`), and fixed activities.
   * Future fixed activities reserve capacity today without injecting pre-mature fatigue before completion.

2. **Structured Event Timeline & Demand Profiles ([`app/src/engine/periodization.ts`](../../app/src/engine/periodization.ts))**:
   * Decouples events from generic goals using `UserEvent` objects with `EventPriority` (`A`/`B`/`C`), `EventLifecycle` (`scheduled`, `completed`, `cancelled`, `DNS`, `DNF`), and `EventDemandProfile` vectors.
   * Computes continuous phase weights (`Base` $\rightarrow$ `Build` $\rightarrow$ `Specificity` $\rightarrow$ `Peak/Taper` $\rightarrow$ `Post-Event Recovery`) and ensures C-events train through without hijacking A-event tapers.

3. **Microcycle Weekly Training Objectives ([`app/src/engine/microcycle.ts`](../../app/src/engine/microcycle.ts))**:
   * Tracks unresolved weekly required exposures (Threshold, Surges, Zone 2, Strength) and credits completed sessions/fixed activities.

4. **Dual Profiles & 6D Multidimensional Fatigue ([`app/src/engine/fatigue.ts`](../../app/src/engine/fatigue.ts) & [`templates.ts`](../../app/src/engine/templates.ts))**:
   * Annotates templates with `WorkoutStimulusProfile` (what it develops) and `WorkoutCostProfile` (what it costs).
   * Tracks 6-dimensional `FatigueState` (Systemic, Cardiovascular, Lower-Body, Upper-Body, Impact/Tissue, Neuromuscular) with exponential decay half-lives ($\tau = 24\text{h}-48\text{h}$) combining external completed load with internal biometric response.

5. **Utility Optimization Engine ([`app/src/engine/optimizer.ts`](../../app/src/engine/optimizer.ts))**:
   * Evaluates candidate workouts using utility scoring:
     $$\text{Utility} = \frac{\text{Benefit (Alignment with Unresolved Weekly Objectives)}}{1 + \text{Fatigue Cost Penalty}} \times \text{Preference Multiplier}$$

6. **Safety Authority vs. Preference Authority**:
   * Physical pain/injury constraints (`UserConstraint`) are hard safety gates.
   * Modality dislikes (`UserPreferences.avoidedModalities`) apply soft ranking penalties (0.2x utility multiplier), ensuring users can adjust tastes without risking safety regressions.
   * `Extra Recovery Margin` tunes borderline decision boundaries without eliminating legitimate quality sessions during green readiness.

---

## Code References

* [`app/src/engine/models.ts`](../../app/src/engine/models.ts) — Event, schedule, microcycle, dual profiles, and fatigue schemas.
* [`app/src/engine/schedule.ts`](../../app/src/engine/schedule.ts) — Multi-layered schedule availability resolution.
* [`app/src/engine/periodization.ts`](../../app/src/engine/periodization.ts) — Continuous phase weighting and multi-event conflict resolution.
* [`app/src/engine/microcycle.ts`](../../app/src/engine/microcycle.ts) — Microcycle exposure progress tracking.
* [`app/src/engine/fatigue.ts`](../../app/src/engine/fatigue.ts) — 6D fatigue state and exponential decay calculation.
* [`app/src/engine/optimizer.ts`](../../app/src/engine/optimizer.ts) — Candidate workout utility optimization.
* [`app/src/engine/architecture.test.ts`](../../app/src/engine/architecture.test.ts) — Integration test suite.

---

## Consequences

### Positive
* Enables intelligent hybrid athlete recommendations (e.g. upper-body strength or mobility after leg-heavy work).
* Previews tomorrow's plan against tomorrow's actual schedule and location context.
* Dynamically adapts to completed workouts and fixed activities while upholding strict medical safety boundaries.

### Negative
* Requires maintaining cost and stimulus profile annotations across workout catalog templates.
