# ADR-0017: Training Intent Profile and First-Class Planning Modes

* **Status:** Proposed
* **Date:** 2026-08-10
* **Deciders:** Core Engineering Team / repository owner
* **Source analysis:** [2026-08-10 training-intent and periodization architecture analysis](../analysis/2026-08-10-training-intent-periodization-architecture.md) (verified against merged `main` at `34ddc30`)

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

### D-MODE — planning mode is distinct from event-plan capability

A new persisted `TrainingIntentProfile.planningMode` records the athlete's stated intent.
The engine resolves an **effective** mode per evaluation date:

* `event_directed` when the profile selects it **and** `evaluatePeriodizationPhase` returns
  an eligible non-null `focusEvent`, irrespective of the event category;
* `evergreen` otherwise — including an `event_directed` profile whose events have all
  passed or been cancelled.

`PlanningContext` also carries an explicit engine capability, separate from the athlete's
mode: `structured_plan` when `resolvePlanDefinitionForEvent` returns a plan (today, the
cycling event plan) and `demand_derived` for every other eligible event. Thus a runner,
triathlete, strength athlete, or general target remains event-directed on the existing
demand-derived path; adding a sport-specific coverage plan later is additive, not a mode
redefinition.

For a legacy athlete with no profile, resolve any eligible focus event as `event_directed`;
resolve no-focus-event cases as `evergreen`. An explicit evergreen profile remains
evergreen even when an event exists. This compatibility default preserves every existing
event-directed scenario while the profile-less eventless athlete receives the new
evergreen default.

No fake event is constructed in `evergreen` mode. `DEFAULT_BASE_DEMAND` stops being the
eventless strategy input and is retained only as the Base-phase demand blend for a real
event more than 84 days out (`evaluatePeriodizationPhase`'s existing `blendDemand` call).

### D-DOSE — evidence-derived adaptation dose precedes session packing

For Evergreen, policy resolution is ordered as **goal/event context + inferred
`AthleteTrainingState` + evidence policy → adaptation-dose requirements → real
capacity/availability feasibility → preference-compatible implementation → weekly role
packing → day-to-day readiness/history adaptation**. A session is a container for dose, not
the source of a physiological requirement.

`resolveEvidenceBackedStrategy` is pure and returns independently-derived minimum, target,
and optional `AdaptationDoseRequirement`s. A requirement states its adaptation, dose unit
(for example aerobic minutes, resistance exposure/volume proxy, or high-intensity
exposure), dose envelope, priority, applicability, and substitution policy. Its provenance
is executable policy metadata: citation/source id, population, outcome, evidence strength,
applicability conditions, authority class (`guideline_floor`,
`outcome_supported_default`, `conditional_prior`, or `product_heuristic`), policy version,
and review date. The metadata is carried per requirement; an Evergreen coverage set is not
globally labelled “evidence-backed”.

`AthleteTrainingState` is inferred from bounded completed/history data where available:
recent weekly frequency and duration, recent strength/aerobic/quality exposure,
consistency/training-age proxy, tolerated load and progression trend, and relevant
sport-specific history. Its conservative `unknown` state is an explicit policy input, not
an assertion that every athlete has the same training background. Readiness remains an
execution modifier after this policy resolution; it is not substituted for training status.

Safety, injury, hard medical restrictions, and feasibility cannot be overridden.
Goal/event specificity selects the required adaptation; evidence defines its dose envelope;
real capacity determines feasibility; preferences choose only among implementations allowed
by the requirement's substitution policy; readiness/history can modify the selected day;
product-ranking heuristics decide last. A general-health athlete may substitute an
equivalent disliked modality. A marathon athlete who makes running unavailable does not get
cycling credited as marathon-specific preparation: retain transferable work, emit a typed
`goal_constraint_conflict`/specificity shortfall, and state the trade-off. Preference may
choose a feasible lower-efficacy implementation only where that policy explicitly permits
it; it never manufactures coverage or overrides safety.

### D-CAP — real capacity constrains dose packing; it does not define dose

`TrainingIntentProfile.weeklyCommitment` (`minSessions`, `targetSessions`, `maxSessions`)
is persisted human input. `UserPreferences` remains the duration owner (D-OWNERSHIP), and
the resolver combines both authorities plus availability windows into
`ResolvedTrainingCapacity`: session cardinality, weekday/weekend minutes, usable date
windows, and estimated target-weekly minutes. This allows the documented minute-based
evidence floor to be assessed without duplicating duration in the profile.

The physiological minimum is derived by D-DOSE independently of declared capacity.
`minSessions` is the athlete's guaranteed **packing** capacity, not the definition of a
scientific minimum; `targetSessions` is the preferred packing capacity; `maxSessions` is
available only to optional/stretch work. If minimum dose cannot fit safely inside real
minutes/windows and `minSessions`, return a typed `minimum_dose_shortfall` and the safest,
highest-value feasible subset. Never silently lower the dose requirement, invent a combined
session, or manufacture cross-role credit.

Zero or missing weekday/weekend duration is never a usable duration for a required session.
New `UserPreferences` writes require finite positive minutes. At read time a known,
versioned pre-Phase-7 default may be materialised only when its provenance is explicit;
otherwise that day type is `time_capacity_unavailable`, excluded from packing, and included
in the shortfall explanation. The planner never persists or schedules a zero-minute
session.

The 2→6-session allocation table is retained solely as a low-confidence **packing
fallback/tie-breaker** after D-DOSE, real capacity, and exact eligible implementations are
known. It is product policy, not scientific law. Volume-equated 2-vs-3 weekly
resistance-training frequency evidence is why a third strength day is a distribution choice,
not an outcome requirement.

Packing generates required, target, and optional role occurrences from the corresponding
dose requirements. A physical session may bundle multiple programming roles only when one
exact authored `PlanSessionCoverage` mapping grants all of those keys for the same template
or workout identity; otherwise distinct strength/endurance requirements remain distinct
occurrences. Adaptation credit may fan out more broadly, but cannot create programming-role
coverage. The canonical occurrence identity is coverage-set id, plan-window bounds, phase,
coverage key, authored session identity, and zero-based occurrence ordinal in that stable
order; the authored session identity is the stable `PlanSessionCoverage` record id, not a
chosen candidate. It is independent of candidate filtering or projected coverage.
ADR-0018 consumes this exact mapping.

### D-COVSET — coverage is a generic plan registry, not an event-shaped module constant

`coverage.ts` currently imports `SEPTEMBER_CYCLING_EVENT_SESSION_COVERAGE` at module scope
and builds `COVERAGE_BY_KEY` from it. That makes one athlete's September road race the
only coverage vocabulary the engine can express. Coverage becomes a **named set** resolved
from the active planning context, with the September set retained unchanged as the
event-directed cycling set and a new evergreen set added alongside it.

Replace the event-named vocabulary with `PlanCoverageKey`, `PlanSessionCoverage`, and
`PlanPhase`, retaining temporary deprecated aliases only where needed for a safe migration.
`validatePlanCoverage` takes a descriptor-specific phase/key contract, because an
evergreen set structurally has no `race` or `taper` phase and today's validator would
reject it. The September cycling set becomes one descriptor; evergreen is another peer,
not an event-shaped exception.

This is a terminology migration, not a change to the accepted phase semantics in D-PHASE:
event-plan `PlanPhase` values retain the current `EventPlanPhase` meaning, and
`PhaseWeights.phaseName` remains a derived display label.

### D-OWNERSHIP — one persisted authority owns each preference field

`TrainingIntentProfile` owns durable planning intent only: `planningMode`, ordered
priorities, weekly `minSessions`/`targetSessions`/`maxSessions`, and the resolved
organisation policy. `UserPreferences` remains the sole authority for session-duration
defaults, time of day, modality preference/exclusion, recovery style, conservative bias,
recovery margin, verbosity, and units.

Phase 7 does not duplicate or merge those fields. If it needs an explicit hard
`unavailable` modality, it evolves `UserPreferences` and maps that field into the existing
hard restriction path; it does not add a competing modality model to the profile.

The write boundary is an allowlist: `TrainingIntentProfile` rejects execution-preference
fields, while `UserPreferences` is the only write source for them. At mixed-version reads,
the valid `UserPreferences` value always wins; any duplicate execution field found in a
profile is ignored, produces a `legacy_profile_preference_ignored` diagnostic, and is never
copied back or merged. No automatic backfill can safely infer the intent of a conflicting
duplicate. A subsequent owner-authorised profile write sanitises the profile to its
allowlisted shape; missing `UserPreferences` uses its existing versioned default/fallback,
not a profile duplicate. This preserves the target ownership rule without a destructive
silent migration.

### D-ORG — persist only the organisation the engine can execute

`organizationPreference` is persisted as the only valid value, `'auto'`. The schema is
widened only in the increment that implements another organisation. The engine must never
accept persisted data that intentionally makes normal recommendation generation fail.
If product research needs to collect a future preference first, it uses a separate,
non-operative `requestedOrganization` field rather than changing the resolved policy.

Both client validation and `hasValidTrainingIntentProfile` reject every other value at the
write boundary; Firestore rules additionally allow only the profile's declared field set.
At the read boundary, a record that is otherwise valid except for a legacy unsupported
organisation resolves `organizationPreference` to `'auto'` and emits
`organization_preference_recovered` with the rejected value. A record with any other
invalid profile field is quarantined as `DataState.INVALID`, emits
`training_intent_profile_invalid`, and follows the no-profile compatibility path rather
than crashing recommendation generation. Neither recovery path writes back automatically;
an owner action can inspect and replace the invalid record.

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
  The profile therefore needs a documented, conservative default, while the no-profile
  compatibility rule must preserve every active event-directed behaviour — this is the
  principal migration risk.
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
