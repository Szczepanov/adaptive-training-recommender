# ADR-0017: Training Intent Profile and First-Class Planning Modes

* **Status:** Proposed
* **Date:** 2026-08-10
* **Deciders:** Core Engineering Team / repository owner
* **Source analysis:** `training_intent_periodization_architecture_analysis.md` (2026-08-10, checked against PR #17 head `21a22a1`)

## Context

Every planning input the engine currently treats as authoritative is derived from a
**dated, categorised event**. `periodization.ts` `evaluatePeriodizationPhase` takes
`(events, date)`; `planSchedule.ts` `resolvePlanDefinitionForEvent` returns `null` for
anything that is not `category === 'cycling_event'`; `coverage.ts` builds its requirement
ledger from a `PlanDefinition`, which only an event can produce.

An athlete with no event is not modelled as a different kind of athlete. They fall through
to `basePhase` plus `DEFAULT_BASE_DEMAND`, a fixed seven-axis demand vector. That vector is
then fed to `objectivesFromDemand` exactly as if it belonged to a real race, producing
three objectives (`zone2_aerobic` ×2, `threshold_quality` ×1, `strength_maintenance` ×1) —
**four required weekly exposures for every eventless athlete**, whether they train twice a
week or six times. `DEFAULT_BASE_DEMAND` is a fabricated event in all but name, which is
precisely what the source analysis rules out.

Separately, nothing in the persisted model records how much an athlete can actually train.
`TrainingSettings.defaults.weekdayMaxMinutes` / `weekendMaxMinutes` and
`UserPreferences.defaultWeekdayTimeMin` / `defaultWeekendTimeMin` bound a **single
session's** duration. There is no minimum / typical / maximum weekly session count
anywhere in the schema, so no derived target can be sized to the person.

Finally, a `UserGoal` without `targetDate` **and** `eventCategory` is inert:
`goalToUserEvent` returns `null` for it, so `domain: 'strength'` or `'general_fitness'`
changes no decision the engine makes. Goals of that shape are collected in the UI and
contribute display text only.

The evidence position taken by the source analysis is that this is not a labelling problem
to solve by asking users for session counts per energy system. WHO guidance (150–300 min
moderate aerobic or equivalent, plus muscle-strengthening on 2+ days/week) and the ACSM
2026 resistance-training position stand both describe **capacity and coverage**, not a
periodization model the athlete should select. Comparative LP / DUP / block evidence is
mixed; readiness-guided prescription has supportive but small trials and is best treated as
an execution layer.

## Decision

### D-MODE — `evergreen` and `event_directed` are first-class planning modes

A new persisted `TrainingIntentProfile.planningMode` records the athlete's stated intent.
The engine resolves an **effective** mode per evaluation date:

* `event_directed` only when the profile selects it **and**
  `evaluatePeriodizationPhase` returns a non-null `focusEvent` for that date;
* `evergreen` otherwise — including an `event_directed` profile whose events have all
  passed or been cancelled.

No fake event is constructed in `evergreen` mode. `DEFAULT_BASE_DEMAND` stops being the
eventless strategy input and is retained only as the Base-phase demand blend for a real
event more than 84 days out (`evaluatePeriodizationPhase`'s existing `blendDemand` call).

### D-CAP — weekly capacity is the sizing authority for derived targets

`TrainingIntentProfile.weeklyCommitment` (`minSessions`, `targetSessions`, `maxSessions`,
`defaultWeekdayMinutes`, `defaultWeekendMinutes`) is persisted human input. Derived
objective counts and coverage minimums are a **pure function** of capacity plus stated
priorities under a versioned policy table — never persisted, recomputed on every read, in
the same way `deriveGoalCategory` already treats goal horizon.

The starting allocation table (2 → two multi-component sessions; 3 → 2+1 by goal; 4 → 2+2;
5 → 2+3 or 3+2; 6 → 3 strength + 3 endurance; 7+ → advanced) is recorded as **product
policy, not scientific law**. It is a defensible default consistent with WHO/ACSM
population guidance, and it is expected to be recalibrated. Volume-equated 2-vs-3 weekly
resistance-training frequency evidence is the specific reason a third strength day is
treated as a distribution decision rather than a requirement.

### D-COVSET — the coverage catalog is a registry, not a module constant

`coverage.ts` currently imports `SEPTEMBER_CYCLING_EVENT_SESSION_COVERAGE` at module scope
and builds `COVERAGE_BY_KEY` from it. That makes one athlete's September road race the
only coverage vocabulary the engine can express. Coverage becomes a **named set** resolved
from the active planning context, with the September set retained unchanged as the
event-directed cycling set and a new evergreen set added alongside it.

`validateEventPlanCoverage`'s required-key and per-phase expectations move onto the set
descriptor, because an evergreen set structurally has no `race` or `taper` phase and today's
validator would reject it.

### D-ORG — Auto/Adaptive Hybrid is the only shipped organisation, named explicitly

`organizationPreference` is persisted with `'auto'` as the default and `'linear'`,
`'undulating'`, `'block'` accepted but **not yet consumed by the engine**, which must fail
loudly (a typed exhaustive switch) rather than silently ignore a stored value. The
comparative evidence does not support forcing a novice to choose a model, and it does not
support us shipping three untested organisations to look complete.

### D-TAPERSCOPE — taper requires a real event, and priority alone is not one

`resolveEventTaper` currently falls back to a legacy default of 14 days for any `A` event
and 5 days for any `B`. `deriveEventPriority` maps any 5-star goal to `A`. A dated
`general_target` goal rated 5 stars therefore receives a 14-day volume taper it never
asked for. The legacy default becomes category-aware: `general_target` gets no default
taper, only an explicitly authored `EventTaperSpec`. Deload/unload and day-to-day recovery
remain separate mechanisms and are explicitly out of scope here (the 2024 randomised
deload evidence does not support mandatory scheduled cessation for everyone).

### D-INTENTNAME — the persisted profile is `TrainingIntentProfile`; the engine's `TrainingIntent` keeps its name

`engine/trainingIntent.ts` already exports a `TrainingIntent` interface: the **resolved
per-day** planning state (periodization, objectives, dose, fatigue, microcycle). The new
persisted athlete input is a different thing with a confusingly similar name. Both keep a
doc comment naming the other. No rename, because `TrainingIntent` is referenced across
`rules.ts`, `planner.ts`, `sequenceSearch.ts` and their tests.

## Consequences

### Positive

* An eventless athlete is planned for on their own terms: stated priorities and real
  weekly capacity, instead of a fixed demand vector that belongs to nobody.
* The coverage ledger — currently inert for every athlete who is not preparing a cycling
  event — becomes reachable for the majority case.
* Weekly session capacity enters the model once, at the point where every derived target
  can consume it, rather than being approximated per-surface.
* Taper stops being reachable through a star rating.

### Negative

* `POLICY_VERSION` must bump; every persisted `RecommendationAudit` written before the
  bump becomes non-replayable by the current build (the existing, deliberate contract in
  `policy.ts` `HISTORICAL_POLICY_VERSIONS`).
* Evergreen decisions become sensitive to a new input the athlete may not have supplied.
  The profile therefore needs a documented, conservative default, and the engine must
  behave sanely with no profile at all — this is the principal migration risk.
* Two coverage sets means two calibration surfaces. The September set's semantics are
  frozen by ADR-0016 and the [macrocycle v5 contract](../macrocycle-v5.md); the evergreen
  set starts uncalibrated and must not be presented as evidence-derived.

## References

* Implementation plan: [`docs/plans/phase-7-training-intent-and-planning-modes.md`](../plans/phase-7-training-intent-and-planning-modes.md)
* [ADR-0016](./0016-adaptation-credit-and-weekly-coverage.md) — the credit/coverage split this builds on
* [ADR-0012](./0012-plan-intent-authority.md) — authored plan intent owns dose
* [ADR-0007](./0007-adaptive-multisport-engine-architecture.md) — engine layering
* `app/src/engine/periodization.ts`, `planSchedule.ts`, `coverage.ts`, `trainingIntent.ts`
* `app/src/workouts/event-plan.ts`
