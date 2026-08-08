# Phase 2 — Plan intent is the planning authority

* **Status:** Ready — domain-model decisions D1/D2 taken 2026-08-08 (see below)
* **Depends on:** Phase 1 (do not migrate onto an unwired safety gate)
* **Unlocks:** Phases 3, 4, 5
* **Addresses:** F16, F17, F9
* **Rough effort:** 2 days for the ADR, 4–6 days for the `PlanDefinition` model
* **Primary artifact:** **ADR-0012**

---

## Task board

Status legend: `[ ]` not started · `[-]` in progress · `[x]` finished.
Update the marker on the work-item heading **and** this table in the same commit.

| Task | Status | Summary | Primary files |
|---|:--:|---|---|
| 2.1 | `[ ]` | Write and accept **ADR-0012**, recording D1 (canonical phase vocabulary), D2 (`intensityScale` consumer) and the lexicographic priority model | `docs/adr/0012-*.md` (new) |
| 2.2 | `[ ]` | `PlanDefinition` / `PlanBlock` / `PlanObjectiveDefinition`; coverage and dated block schedule combined by `buildPlanDefinition` | `app/src/workouts/event-plan.ts`, `app/src/engine/models.ts`, `microcycle.ts`, new plan-schedule module |
| 2.3 | `[ ]` | `EventTiming` with validated date ordering for unconfirmed events | `app/src/engine/models.ts`, `periodization.ts`, `persistence/parsers/*` |
| 2.4 | `[ ]` | Extract `evaluateReadinessAndSafetyEnvelope`; collapse Path A / Path B (F9) | `app/src/engine/rules.ts`, `planner.ts` |

**2.1 gates the rest.** Do not start 2.2 before the ADR is accepted — the domain objects
are the ADR's output, and building them first inverts the dependency this phase exists to
establish.

---

## Goal

Establish that an explicit training plan — not generic days-to-event arithmetic — is the
authority on what a given date should develop, and give that plan a representation the
engine actually reads.

## The problem in one paragraph

`app/src/workouts/event-plan.ts` encodes the real macrocycle: 17 coverage entries with
phases (`build | travel | peak | taper | race`), requirement tiers, workout IDs and
coaching notes. **Its only consumer is `app/scripts/validate-workouts.ts`** (F16). The
live planner instead reduces the plan to five generic rolling objectives and re-derives
phase from `daysToEvent`, producing a `PhaseWeights` whose `intensityScale` is read by
nobody and whose `volumeScale` feeds a single multiplier (F17). Two phase vocabularies
exist with no mapping between them.

---

## `[ ]` 2.1 — ADR-0012: Plan Intent and Sequence Planning are the training authorities

Write this first; it is the gate for everything after. It must define:

1. **Authoritative domain objects** — `PlanDefinition`, `PlanBlock`,
   `PlanObjectiveDefinition`, `SequencingRule`, `SessionRole`.
2. **Responsibility boundaries.** Explicitly, per layer:
   * *periodization* — fallback phase inference when no explicit plan exists
   * *plan intent* — what this date should develop, before readiness
   * *horizon planner* — sequence-level feasibility across the window
   * *readiness/safety* — how much of that intent is safe to execute today
   * *optimizer* — choice **among equivalent feasible implementations only**
3. **The priority model** — lexicographic, not multiplicative (see Phase 3):
   safety → must-have plan obligations → sequence/recovery constraints → objective
   coverage → fatigue cost → preference. State plainly that preference can never
   outrank a must-have obligation, and that the current 0.15× anti-stack multiplier
   overriding the 1.40× A-event boost is the concrete failure this rule exists to prevent.
4. **Objective credit semantics** — defers detail to Phase 4, but fixes the contract:
   credit is fractional, dose-sensitive, and carries confidence.
5. **Two planning modes** — generic (days-to-event) and explicit (`PlanDefinition` block
   calendar). Explicit wins where present; generic remains the fallback and the
   validation cross-check.
6. **V1 → V2 migration and compatibility** — including what gets retired.
7. **Simulation acceptance criteria** — a plan change is accepted when the Phase 0
   invariants hold and the semantic diff is explained.

### Decisions taken (2026-08-08) — record these in the ADR

**D1 — `EventPlanPhase` becomes the canonical phase vocabulary.**
`PhaseWeights.phaseName` (`Base|Build|Specificity|Peak/Taper|Post-Event Recovery`) becomes
a *derived label* produced by the generic fallback, mapped onto `EventPlanPhase`
(`build|travel|peak|taper|race`).

Rationale: `EventPlanPhase` is the vocabulary an athlete and a coach actually use, it is
already attached to real workout content in `event-plan.ts`, and it expresses `travel` —
a genuine planning state that the days-to-event model structurally cannot represent,
because travel has nothing to do with event proximity. The reverse mapping loses that.

`EventPlanPhase` gains a **`recovery`** member. An earlier draft mapped
`Post-Event Recovery → build (at reduced volume)`; that is lossy in exactly the layer being
made authoritative. `build` means *develop fitness* and would make build-phase objectives
and workout families eligible during a window the generic engine deliberately marks as
recovery. Reduced volume does not restore the missing semantics.

Mapping for the generic fallback:

| `PhaseWeights.phaseName` | `EventPlanPhase` |
|---|---|
| Base, Build | `build` |
| Specificity | `peak` |
| Peak/Taper | `taper` |
| Post-Event Recovery | **`recovery`** |

The ADR must declare which coverage families are legal in `recovery` (expected:
`easy_aerobic`, `recovery_or_rest`, and nothing that develops fitness).

`race` and `travel` are only ever set by an explicit `PlanDefinition` — the generic model
has no way to know about either, and inferring them would be a guess.

**D2 — `intensityScale` gets a consumer; it is not deleted.**
The deletion argument is that nothing reads it. The counter-argument wins: taper is
*defined* by volume and intensity moving in opposite directions — volume down, intensity
preserved. `plannedDose` currently collapses both into one scalar derived from
`volumeScale` alone, which is precisely why taper behaviour has to be reconstructed
elsewhere from template `phaseEligibility` and ranking weights (F17, and the emergent-taper
problem in Phase 5.7). Deleting `intensityScale` would make a correct taper harder to
express, not simpler.

The consumer, specified here and implemented as **Phase 4 work item 4.5** (which exists
for this purpose — 4.4 covers dose-sensitive *cost*, a different thing):

```ts
// replaces the single `plannedDose` scalar
interface PlannedDose {
  volume: number;     // from PlanBlock.volumeScale   — duration target
  intensity: number;  // from PlanBlock.intensityScale — admissible intensity band
}
```

`volume` continues to drive duration selection as `plannedDose` does today. `intensity`
gates which intensity-class candidates are admissible, so a taper can hold intensity while
cutting volume — one block declaration instead of an emergent interaction between four
subsystems.

Until Phase 4.4 lands, `intensityScale` stays written-and-unread. That is acceptable
*because it is now a scheduled commitment with a named consumer*, which is the state F17
objects to it lacking.

## `[ ]` 2.2 — `PlanDefinition`: make the event plan executable

Generalise `event-plan.ts` from a September-specific coverage list into a plan the engine
consumes. **Do not make the domain September-specific.**

```ts
export interface PlanDefinition {
  id: string;
  eventId: string;
  blocks: PlanBlock[];
  objectives: PlanObjectiveDefinition[];
  sequencingRules: SequencingRule[];
}

export interface PlanBlock {
  phase: EventPlanPhase;
  startDate: string;
  endDate: string;
  volumeScale: number;
  intensityScale: number;
}

export interface PlanBlock {
  id: string;                          // objectives reference this, not the phase
  phase: EventPlanPhase;
  /* ...dates and scales as above... */
}

export interface PlanObjectiveDefinition {
  key: ObjectiveKey;
  coverageKey: EventPlanCoverageKey;   // ties back to event-plan.ts
  blockIds: string[];                  // NOT `phases` — see below
  requiredCredit: number;
  priority: ObjectivePriority;         // already declared in models.ts, unused
  minGapHoursFrom?: ObjectiveKey[];
}
```

**Objectives reference blocks, not phases.** A phase can occur more than once in a
macrocycle (two build blocks either side of a travel week is the normal case), so
`phases: EventPlanPhase[]` cannot tell `generateWeeklyObjectives` which dated window an
objective belongs to — it would have to guess, which is the inference this phase exists to
remove. `blockIds` makes `windowStart`/`windowEnd` derivable deterministically.

```ts
```

`WeeklyObjective` already declares `requiredCredit`, `priority`, `windowStart` and
`windowEnd` and uses none of them (F17). This is where they get used — objective windows
become real dated ranges derived from `PlanBlock`, replacing the generic rolling 7-day
counter (`MicrocycleState.weekStartDate`, whose name already misdescribes it: rename to
`windowStartDate`).

### Coverage and schedule are two different inputs

An earlier draft proposed `planDefinitionFromCoverage(coverage, event)`. **That function
cannot exist.** Coverage knows phases, requirement tiers and workout IDs; it does not know
`PlanBlock.startDate`/`endDate`, `volumeScale`, `intensityScale`, or when travel is. A
`UserEvent` supplies only the event date — it cannot tell you travel is Aug 19–22. Deriving
blocks from coverage + event would push exactly the hidden inference back into the layer
built to remove it.

So the model has two inputs:

| Input | Contains | Reusable? |
|---|---|---|
| **Coverage** (`event-plan.ts`) | phase → workout-family knowledge, requirement tiers | Yes — reusable across athletes and events |
| **Block schedule** (new) | dated `PlanBlock`s: build/travel/peak/taper/race/recovery, with scales | No — specific to one athlete's macrocycle |

`buildPlanDefinition(coverage, blockSchedule, event)` combines them. The block schedule is
new authored input — it is the thing that makes the plan explicit, and there is nowhere
else for it to come from.

### Migration path

1. Keep `SEPTEMBER_CYCLING_EVENT_SESSION_COVERAGE` as coverage data; author a dated block
   schedule for the September event; combine via `buildPlanDefinition`.
2. `generateWeeklyObjectives` gains an optional `planDefinition` parameter. When present,
   objectives come from the plan; when absent, current behaviour is unchanged. This keeps
   the eventless/generic athlete working throughout.
3. `validateEventPlanCoverage` keeps running — the catalog-completeness check is still
   worth having; it is just no longer the file's *only* purpose.

## `[ ]` 2.3 — Race-date uncertainty

Real events are not always one known date. Add:

```ts
export interface EventTiming {
  earliestDate: string;
  latestDate: string;
  planningDate: string;     // = earliestDate until confirmed
  confirmedDate?: string;
}
```

Taper logic anchors on `planningDate`, so an unconfirmed event gets a safe (early) taper
anchor rather than requiring a fabricated exact date. Surface the uncertainty in the UI
rather than hiding it.

**Validate the ordering — an unvalidated `EventTiming` is a taper bug.** Reject
`earliestDate > planningDate`, `planningDate > latestDate`, or a `confirmedDate` outside
`[earliestDate, latestDate]`. Without these, taper can anchor before the event is even
possible, or after it has happened. Validate at the parse boundary (`DataState.INVALID`,
consistent with ADR-0010) rather than defensively inside the planner.

## `[ ]` 2.4 — Collapse Path A / Path B (F9)

`evaluateTrainingWithIntent` currently calls `evaluateTraining` (`evaluateTrainingWithIntent`'s call to `evaluateTraining`) to obtain
`mode` and `envelopes`, then discards its template pick and re-selects. Extract the part
that is actually wanted:

```ts
export function evaluateReadinessAndSafetyEnvelope(
  readiness: DailyReadiness, context: UserContext, date: string,
  previousMode?: 'train' | 'modify' | 'recover',
): { mode; envelopes; telemetry; maxExecutionDose; restrictedModalities };
```

Then one downstream selection path consumes it. `evaluateTraining` remains only if an ADR
justifies it as a deliberate readiness-only fallback; otherwise it goes.

This removes a whole category of the divergence in F4 — two paths cannot disagree if
there is one path.

---

## Acceptance criteria

- [ ] ADR-0012 accepted, recording D1 (canonical phase vocabulary) and D2 (`intensityScale` consumer)
- [ ] `PlanDefinition` exists; `generateWeeklyObjectives` consumes it when present
- [ ] `event-plan.ts` has at least one engine-path consumer
- [ ] `intensityScale` has a named, scheduled consumer (`PlannedDose.intensity`, Phase 4.4)
- [ ] `MicrocycleState.weekStartDate` renamed to `windowStartDate`
- [ ] one readiness/safety envelope function; no discarded template selection
- [ ] Phase 0 invariants still pass; semantic diff explained in the PR

## Risks & rollback

* **Scope.** This is the largest phase by design surface. Land the ADR first and
  independently — it has value even if `PlanDefinition` slips.
* **Generic athletes must not regress.** Every `planDefinition`-aware code path needs an
  explicit no-plan branch with test coverage. The eventless user is the default case.
* **2.4 touches the hottest file in the repo.** Land it as its own commit, after 2.2.

## Out of scope

Sequence search (Phase 5). Objective credit mechanics (Phase 4). This phase establishes
*what the plan wants*; it does not change *how the week is searched*.

## Docs to update

* **ADR-0012** (new, the main artifact)
* **ADR-0007** — amend: periodization is the fallback, not the authority
* **ADR-0004** — amend §3: `event-plan.ts` is a planning input, not only a coverage contract
* `docs/architecture/recommendation-engine.md` — rewrite against the new layering
