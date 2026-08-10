# Phase 2 — Plan intent is the planning authority

* **Status:** Implemented (ADR-0012, `PlanDefinition`, `EventTiming`, and envelope extraction were implemented and verified 2026-08-08; production wiring and date-window scoping landed in review the same day — see ADR-0012 §7)
* **Blocked by:** nothing outstanding
* **Unlocks:** Phases 3, 4, 5
* **Addresses:** F16, F17, F9
* **Rough effort:** 2 days for the ADR, 4–6 days for the `PlanDefinition` model
* **Primary artifact:** **ADR-0012**

> **Historical implementation record.** All work items and acceptance criteria below
> were verified as delivered on 2026-08-09. They are retained for rationale and are
> not instructions for new work.

---

## Task board

Status legend: `[ ]` not started · `[-]` in progress · `[x]` finished.
Update the marker on the work-item heading **and** this table in the same commit.

| Task | Status | Summary | Primary files |
|---|:--:|---|---|
| 2.1 | `[x]` | Write and accept **ADR-0012**, recording D1 (canonical phase vocabulary), D2 (`intensityScale` consumer) and the lexicographic priority model | `docs/adr/0012-*.md` (new) |
| 2.2 | `[x]` | `PlanDefinition` / `PlanBlock` / `PlanObjectiveDefinition`; coverage and dated block schedule combined by `buildPlanDefinition` | `app/src/workouts/event-plan.ts`, `app/src/engine/models.ts`, `microcycle.ts`, new plan-schedule module |
| 2.3 | `[x]` | `EventTiming` with validated date ordering for unconfirmed events | `app/src/engine/models.ts`, `periodization.ts`, `persistence/parsers/*` |
| 2.4 | `[x]` | Extract `evaluateReadinessAndSafetyEnvelope`; collapse Path A / Path B (F9) | `app/src/engine/rules.ts`, `planner.ts` |

Historically, 2.1 gated the other tasks: ADR-0012 was accepted before the domain objects
were implemented.

---

## Completed outcome

An explicit training plan is the authority for its active date window and is read by the
production engine; generic days-to-event arithmetic remains a fallback where no authored
plan applies.

## Pre-implementation state (historical — resolved by 2.1/2.2)

`app/src/workouts/event-plan.ts` encoded the real macrocycle: 17 coverage entries with
phases (`build | travel | peak | taper | race`), requirement tiers, workout IDs and
coaching notes. **Its only consumer was `app/scripts/validate-workouts.ts`** (F16). The
live planner instead reduced the plan to five generic rolling objectives and re-derived
phase from `daysToEvent`, producing a `PhaseWeights` whose `intensityScale` was read by
nobody and whose `volumeScale` fed a single multiplier (F17). Two phase vocabularies
existed with no mapping between them.

## Acceptance criteria

- [x] ADR-0012 accepted, recording D1 (canonical phase vocabulary) and D2 (`intensityScale` consumer)
- [x] `PlanDefinition` exists; `generateWeeklyObjectives` consumes it when present
- [x] `event-plan.ts` has at least one *production* engine-path consumer — `resolveTrainingIntent` resolves a `PlanDefinition` via `resolvePlanDefinitionForEvent` (narrow single-event match, see ADR-0012 §7) and threads it into `buildMicrocycleState`, not just the two new unit tests calling `generateWeeklyObjectives` directly
- [x] `intensityScale` has a named, scheduled consumer (`PlannedDose.intensity`, Phase 4.4)
- [x] `MicrocycleState.weekStartDate` renamed to `windowStartDate`
- [x] one readiness/safety envelope function; no discarded template selection
- [x] Phase 0 invariants still pass; semantic diff explained in the PR authorities
- [x] `EventTiming` has a real write/read path — `UserGoal.timing` validated by `validateGoal`, persisted/cleared by `goalService.ts`, carried onto `UserEvent.timing` by `goalToUserEvent` — not just validated in isolation by `validateEventTiming`'s own unit tests
- [x] plan-derived objectives are scoped to the `PlanBlock` active on the current date, not every block in the whole macrocycle at once

---

## `[x]` 2.1 — ADR-0012: Plan Intent and Sequence Planning are the training authorities

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

## `[x]` 2.2 — `PlanDefinition`: make the event plan executable

`event-plan.ts` was generalised from a September-specific coverage list into a plan the
engine consumes. **The domain was kept event-agnostic, not September-specific.**

```ts
export interface PlanDefinition {
  id: string;
  eventId: string;
  blocks: PlanBlock[];
  objectives: PlanObjectiveDefinition[];
  sequencingRules: SequencingRule[];
}

export interface PlanBlock {
  id: string;                          // objectives reference this, not the phase
  phase: EventPlanPhase;
  startDate: string;                   // YYYY-MM-DD, Warsaw-local, inclusive
  endDate: string;                     // YYYY-MM-DD, Warsaw-local, inclusive
  volumeScale: number;
  intensityScale: number;
}

export interface PlanObjectiveDefinition {
  key: ObjectiveKey;
  coverageKey: EventPlanCoverageKey;   // ties back to event-plan.ts
  blockId: string;                     // exactly one — NOT `phases`, and not a list
  requiredCredit: number;
  priority: ObjectivePriority;         // already declared in models.ts, unused
  minGapHoursFrom?: ObjectiveKey[];
}
```

**Objectives reference blocks, not phases.** A phase can occur more than once in a
macrocycle (two build blocks either side of a travel week is the normal case), so
`phases: EventPlanPhase[]` cannot tell `generateWeeklyObjectives` which dated window an
objective belongs to — it would have to guess, which is the inference this phase exists to
remove. `blockId` makes `windowStart`/`windowEnd` derivable deterministically:
`windowStart = block.startDate`, `windowEnd = block.endDate`.

**One block per objective, not a list.** An earlier draft had `blockIds: string[]`, which
leaves two questions unanswered and therefore answered differently by each implementer:
an empty list has no window at all, and two non-contiguous blocks give either one window
spanning the gap or two disjoint windows — with no rule for how `requiredCredit` divides
between them. Neither has a defensible default. An objective that genuinely spans two
build blocks either side of a travel week is **two objectives**, each with its own
`requiredCredit`, which is also the honest model: credit earned before a travel week does
not carry across it.

Validate at plan-build time, not at use time: `buildPlanDefinition` rejects the whole
`PlanDefinition` (`DataState.INVALID`, per ADR-0010) if any `blockId` does not resolve to
a declared block, if block IDs are not unique, or if two blocks overlap in date range.
A dangling `blockId` must never produce an objective with an undefined window — that is
the silently-never-resolving objective this phase exists to eliminate.

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

## `[x]` 2.3 — Race-date uncertainty

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

**Ordering alone is not enough: confirmation must move the anchor.** Every constraint
above is satisfied by `{ earliestDate: '2026-09-05', latestDate: '2026-09-20',
planningDate: '2026-09-05', confirmedDate: '2026-09-19' }` — a confirmed event that
tapers to a date two weeks before it happens. Because `planningDate` starts at
`earliestDate` and the confirmation flow writes `confirmedDate`, this is not a corner
case; it is what happens if the confirmation handler forgets one field.

So add the invariant: **`confirmedDate` present ⇒ `planningDate === confirmedDate`.**
Once the date is known there is no legitimate reason to plan to a different one, and
making it a validation error means a half-finished confirmation fails loudly at the parse
boundary instead of producing a silently mistimed taper. The confirmation flow sets both
fields in one write. Test the exact case above.

## `[x]` 2.4 — Collapse Path A / Path B (F9)

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

- [x] ADR-0012 accepted, recording D1 (canonical phase vocabulary) and D2 (`intensityScale` consumer)
- [x] `PlanDefinition` exists; `generateWeeklyObjectives` consumes it when present
- [x] `event-plan.ts` has at least one *production* engine-path consumer (see the identical note in the acceptance criteria above)
- [x] `intensityScale` has a named, scheduled consumer (`PlannedDose.intensity`, Phase 4.4)
- [x] `MicrocycleState.weekStartDate` renamed to `windowStartDate`
- [x] one readiness/safety envelope function; no discarded template selection
- [x] Phase 0 invariants still pass; semantic diff explained in the PR
- [x] `EventTiming` has a real write/read path, not just isolated validation (see above)
- [x] plan-derived objectives are date-window scoped (see above)

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
