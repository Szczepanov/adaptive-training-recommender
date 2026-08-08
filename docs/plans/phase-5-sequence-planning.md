# Phase 5 — Sequence planning, real inputs, and the feedback loop

* **Status:** Ready — approved as the destination; increments ordered below. Not the next thing to build.
* **Depends on:** Phases 0–4
* **Addresses:** the V2 Plan Intent cutover proper
* **Rough effort:** multi-week; ship as independent increments, not one landing

---

## Task board

Status legend: `[ ]` not started · `[-]` in progress · `[x]` finished.
Update the marker on the work-item heading **and** this table in the same commit.

Ordered by the increment sequence below, **not** by section number.

| Order | Task | Status | Summary | Primary files |
|:--:|---|:--:|---|---|
| 1 | 5.3 | `[x]` | Persist `FixedActivity` under a user-owned path with rules + emulator tests | `app/firestore.rules`, new `fixedActivityService.ts`, `app/src/engine/schedule.ts`, `planner.ts` |
| 2 | 5.4 | `[x]` | Per-region tissue state; may only tighten a Phase-1 injury constraint | `app/src/engine/models.ts`, `components/DailyCheckin.tsx`, `injuryPolicy.ts` |
| 3 | 5.5 | `[ ]` | Evidence hierarchy for completed training, carrying `stimulusConfidence` | `app/src/engine/completedTraining.ts` |
| 4 | 5.7 | `[ ]` | Taper as an explicit plan contract rather than an emergent side effect | `app/src/workouts/event-plan.ts`, `app/src/engine/periodization.ts` |
| 5 | 5.6 | `[ ]` | Multi-event: one taper authority, multiple demand contributors | `app/src/engine/periodization.ts` |
| 6 | 5.2 | `[ ]` | `PlanningCandidate` carries spacing/recovery metadata into the decision | `app/src/workouts/models.ts`, `app/src/engine/planner.ts` |
| 7 | 5.1 | `[ ]` | Bounded sequence search — **build and measure**, adoption conditional (D-BEAM) | `app/src/engine/planner.ts` |

**5.1 is an experiment, not a scheduled migration.** Marking it `[x]` requires a recorded
adoption decision with harness data — retaining the greedy loop is a valid completion.

---

## Goal

Replace greedy day-by-day projection with bounded sequence search over the planning
horizon, give the planner the real-world inputs it currently lacks (fixed activities,
local tissue state), and close the loop so completed training updates achieved stimulus
as well as incurred cost.

## Increment order (decided 2026-08-08)

Approved as the destination, but explicitly **not** as one landing. Ship in this order —
value-per-risk descending, with the deepest and least certain change last:

| # | Increment | Why here |
|---|---|---|
| 1 | **5.3 fixed activities** | Highest value per effort, zero dependency on the search work. A planner that doesn't know about Wednesday football is wrong every Wednesday. |
| 2 | **5.4 local tissue state** | Builds directly on Phase 1.1's `BodyRegion` model; independently useful the day it ships. |
| 3 | **5.5 evidence hierarchy** | Generalises Phase 1.2's coarse inference; needs `stimulusConfidence`, which Phase 1.2(c) already adds. |
| 4 | **5.7 taper as explicit contract** | Needs Phase 2's `PlanDefinition` and Phase 4.4's `PlannedDose.intensity`; small once both exist. |
| 5 | **5.6 multi-event** | Needs explicit objectives and session roles to express cleanly. |
| 6 | **5.2 planning candidate** | Prerequisite refactor for 5.1; do it immediately before, not months earlier. |
| 7 | **5.1 bounded sequence search** | The deep change, and the only one whose benefit is genuinely uncertain. Last, so everything it depends on is settled. |

**The one thing not pre-approved: adopting beam search.** Approving this plan approves
*building and measuring* 5.1, not shipping it regardless of outcome. Whether sequence
search beats the greedy loop is an empirical question, and the Phase 0 invariants plus the
golden week are how it gets answered. If it does not measurably improve them, the correct
outcome is to record that result and keep the greedy loop — that is a successful
increment, not a failed one. Increments 1–6 stand on their own either way.

---

## `[ ]` 5.1 — Bounded sequence search

`generateWeekAheadPlan` walks one day at a time, greedily. To compensate, the optimizer
accumulated six named policies (anti-stacking, post-objective strength suppression,
intensity stacking, event modality, aerobic filler, anchor boosts, anchor adjacency,
variety tie-break). Each is individually defensible; together they encode sequence
planning as interactions between weights, which is why "why is this the best week?" has
no answerable form today.

A 7-day horizon does not justify heavy machinery. **Beam search is sufficient:**

```text
beam width:        10-20
horizon:           7 days
candidates/day:    small constrained set of session roles
reject:            hard spacing/recovery violations, before scoring
score:             the whole partial sequence, not the marginal day
```

The planner can then prefer

```text
Tue threshold / Thu easy aerobic / Sat race-specific
```

over

```text
Tue threshold / Wed threshold / Thu rest / Fri race-specific
```

even when Wednesday's threshold looked better in isolation — which is the class of
judgement the current architecture structurally cannot make.

Prerequisite: Phase 3's lexicographic layer. Search needs hard constraints separated from
sort keys; it cannot operate on a single blended multiplier.

## `[ ]` 5.2 — Move the planner/workout-library boundary

Detailed `WorkoutDefinition`s already carry recovery hours, mechanical and eccentric load,
coordination demand, technical environment, contraindications, and minimum spacing after
hard lower-body work. The planner selects a coarse `SessionTemplate` first, so this
metadata arrives *after* the decision it should inform.

Introduce a derived planning candidate — enough semantics to sequence a week, without
dragging every workout step into the planner:

```ts
interface PlanningCandidate {
  workoutId: string;
  sessionRole: SessionRole;
  modality: Modality;
  durationRange: { min: number; default: number; max: number };
  stimulus: WorkoutStimulusProfile;
  cost: WorkoutCostProfile;
  recoveryHours: number;
  minimumDaysAfterHardLowerBody?: number;
  equipment: Equipment[];
  environment: TrainingEnvironment[];
  contraindications: string[];
}
```

Prescription generation stays downstream and unchanged.

## `[x]` 5.3 — Persist fixed activities

`FixedActivity` exists in the domain and `WeekAheadOptions.fixedActivities` accepts it,
but there is no Firestore-backed source (ADR-0008 §5 admits this). For a multi-sport
planner it is a first-order gap: Wednesday football *is* training; travel changes
equipment and availability; a booked session should shape the days on either side of it.

Persist per activity: date, duration, expected stimulus, expected cost, fixed vs movable,
environment/location, available equipment, and availability override.

**Storage contract — user-owned, like every other athlete record (ADR-0002).** Path
`users/{userId}/fixed_activities/{activityId}`, with a `userId` field matching the path
segment. Extend `app/firestore.rules` following the existing `goals` pattern: read/create
for the owner, update preserving ownership and `createdAt`. Add emulator tests for owner
read/write allowed, unauthenticated denied, and cross-user denied — the same three cases
the recommendation rules already cover. This is high practical value for modest effort and
does not depend on the search work — **it can land before 5.1.**

**Validate every field, not just the two easy ones.** Ownership rules stop another
athlete writing this document; they do nothing about the *owner's own client* writing a
malformed one, and every field below feeds the planner. An unbounded `expectedCost`
dimension is a denial-of-service on the athlete's own schedule — one activity that
saturates the fatigue model empties the week. Validate the whole shape at the rule
boundary:

| Field | Type | Constraint |
|---|---|---|
| `userId` | string | `== userId` path segment |
| `date` | string | matches `^[0-9]{4}-[0-9]{2}-[0-9]{2}$` (Warsaw-local, ADR-0003) |
| `durationMin` | number | integer, `> 0` and `<= 1440` |
| `title` | string | `size() <= 200` |
| `fixed` | bool | required — movable vs immovable is load-bearing for the search |
| `expectedStimulus` | map | keys ⊆ the canonical axis set; each value a number in `[0, 1]`; `size() <= 8` |
| `expectedCost` | map | keys ⊆ the six cost dimensions; each value a number in `[0, 1]`; `size() <= 6` |
| `environment` | string | member of the `TrainingEnvironment` union |
| `equipment` | list | `size() <= 20`; every item a string of `size() <= 50` |
| `availabilityOverride` | map (optional) | numeric minutes in `[0, 1440]` |

Firestore rules cannot iterate a list to type-check its items, so bound `equipment` by
size and length and enforce item types in the client validator and in
`validation.ts` on read — say so explicitly rather than leaving a reader to assume the
rule covers it. Enum membership is checked against a literal list in the rules file; when
a union gains a member, both change together.

Emulator cases beyond the three ownership ones: out-of-range `durationMin`, an
`expectedCost` value above 1, an unknown `environment`, an oversized `equipment` list,
and a malformed `date`. Each must be **denied** — these are the cases a buggy or
tampered client actually produces.

## `[x]` 5.4 — Local tissue state

One scalar soreness value cannot distinguish knee from Achilles from calf from adductor
from general DOMS. Extend the check-in to per-region response (morning state, pain during
training, after-training state, next-morning reaction), and let observed tissue response
override wearable-derived readiness where relevant.

**Sequencing note:** this builds directly on Phase 1.1's `BodyRegion` /
`InjuryConstraint` model. Doing it before Phase 1 would add a tissue layer on top of a
disconnected injury gate — richer input feeding a channel that is not consulted. Phase 1
first, always.

**Precedence against Phase 1 injury constraints — state it, do not leave it to reading.**
Tissue feedback may only *preserve or tighten* an active `InjuryConstraint`; it can never
weaken or clear an `exclude` or `limit`. A green knee reading does not unlock running
while an `exclude` knee constraint is active — only editing the constraint does that.
Ordering: `InjuryConstraint` (hard) → observed tissue response (may tighten) →
wearable-derived readiness (may tighten). Test all three pairwise conflicts.

Fatigue estimates remain guidance; observed local response outranks *wearable* readiness,
not the injury gate.

## `[ ]` 5.5 — Evidence hierarchy for completed training

Phase 1.2 ships a coarse modality×intensity stimulus inference. This generalises it:

```text
exact prescribed-workout match
        ↓
completed structured workout details
        ↓
power / HR / cadence / interval structure
        ↓
Garmin aerobic + anaerobic Training Effect
        ↓
duration + intensity
        ↓
athlete classification
        ↓
generic modality fallback
```

Every inferred profile carries confidence — the `stimulusConfidence` field added in Phase
1.2(c) is the hook. The model does not need to be physiologically precise; it needs to be
materially better than treating meaningful unplanned training as adaptation-neutral.

The asymmetry this closes: today the system sees **cost** from an unplanned hard group
ride but not **benefit**, so it can prescribe work that was effectively already done.

## `[ ]` 5.6 — Multi-event: separate taper authority from demand contribution

`evaluatePeriodizationPhase` picks one governing event by priority then proximity. A more
realistic model is **one taper authority, multiple demand contributors**: an A-event 70
days out and a B-event 12 days out should let the B-event replace one quality session and
supply race-specific exposure without capturing the macrocycle.

Explicit objectives and session roles express this far more naturally than one blended
demand vector, which is why it sits after Phase 2.

**Both halves need a total order, or this is less deterministic than what it replaces.**
Today's single-governing-event rule is at least decidable. "One authority, multiple
contributors" is not, until three things are stated — and an undecided tie here means two
runs of the planner taper to different dates.

*Taper authority.* Sort candidate events by, in order: (1) priority — `A` before `B`
before `C`; (2) proximity — fewer days to `planningDate` first; (3) `planningDate`
ascending; (4) event `id` lexicographically. The last is not a real criterion, it is a
determinism backstop, and it should be commented as such. Take the first. Two A-events on
the same day is a planning error, not something to blend — surface it, do not average it.
Only the taper authority sets `volumeScale`/`intensityScale`; contributors never do.

*Demand aggregation.* A contributor supplies race-specific **objectives**, not a blended
demand vector — that is the point of doing this after Phase 2. Union the objectives of all
events within their contribution windows, keyed by `ObjectiveKey`. Where two events
contribute the same key, take `max(requiredCredit)`; do not sum, or two similar B-events
would demand double the work of one. An objective from the taper authority outranks a
contributor's objective of the same key on any other field.

*Conflicts.* If a contributor's objective is inadmissible under the taper authority's
current block — a `threshold_quality` requirement landing inside race week — the taper
authority wins and the contributor objective is **dropped with a recorded reason** in the
audit, not silently reweighted. An athlete who can see "your B-event's threshold session
was dropped because it fell in A-event race week" can act on it; a quietly reweighted plan
teaches them nothing.

Tests before 5.6 is executable: priority tie broken by proximity; proximity tie broken by
date then id; two contributors sharing an objective key resolving to `max`, not sum; a
contributor objective inside race week dropped with its reason present in the audit.

## `[ ]` 5.7 — Taper as an explicit contract

Taper behaviour currently emerges from interactions between `volumeScale`, objective
generation, template `phaseEligibility` and utility ranking. `event-plan.ts` already names
the real roles — taper sharpening, pre-race openers, race-week strength, race day. Use
them, so taper directly expresses *reduce volume, preserve useful intensity and
event-specific freshness* rather than arriving as an emergent side effect.

---

## Acceptance criteria

- [ ] a sequence-search prototype exists and is benchmarked against greedy on the Phase-0
      invariants and semantic harness
- [ ] an explicit adoption decision is recorded in an ADR, with the comparison data —
      **either** (a) beam search is promoted, hard constraints reject before scoring, and a
      full week is scored as a sequence and is explainable; **or** (b) greedy is retained
      and the negative result is recorded. Both satisfy this criterion.
- [ ] `PlanningCandidate` carries spacing/recovery metadata into the decision
- [ ] fixed activities persist and affect availability and adjacent days
- [ ] per-region tissue state constrains mechanical work independently of wearable readiness
- [ ] inferred stimulus carries confidence and uses the strongest available evidence
- [ ] taper roles come from the plan, not from weight interactions
- [ ] Phase 0 invariants hold throughout; each increment's semantic diff explained

## Risks & rollback

* **Biggest risk is doing it all at once.** 5.3 and 5.4 are independently valuable and
  should land first. 5.1 is the deep change and should be last.
* **Search may not beat greedy.** This is an empirical question, not a settled one. The
  Phase 0 invariants and golden week are how it gets answered — if beam search does not
  measurably improve them, that is a real result and the greedy loop stays.
* **Beam search cost.** 7 days × small candidate set × beam 10–20 is trivial, but the
  week-ahead strip recomputes on every dashboard load (ADR-0008 §3). Measure before
  shipping; memoise the pre-pass if needed.

## Explicitly not in this plan

* **No LLM in session selection.** The problem is insufficiently explicit planning
  semantics, not insufficient text reasoning.
* **No ML-tuned optimizer coefficients.** That optimises the current architecture instead
  of fixing it.
* **No further `Patch 7/8/9` multipliers** unless as a temporary safety fix with a removal
  date.
* **No full TSS/CTL/ATL system.** Load estimation needs work, but the planning abstraction
  is the bottleneck.
* **No large workout-catalogue or event-preset expansion.** The catalogue is already
  richer than the planner can exploit (F16); more content does not solve sequencing.

## Docs to update

* **ADR-0015** (new) — sequence planning and the session-role model
* **ADR-0008** — superseded in part: the greedy projected loop is replaced
* `docs/architecture/recommendation-engine.md` — the planner section
