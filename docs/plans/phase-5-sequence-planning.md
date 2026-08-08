# Phase 5 — Sequence planning, real inputs, and the feedback loop

* **Status:** Draft — the destination, not the next thing to build
* **Depends on:** Phases 0–4
* **Addresses:** the V2 Plan Intent cutover proper
* **Rough effort:** multi-week; ship as independent increments, not one landing

---

## Goal

Replace greedy day-by-day projection with bounded sequence search over the planning
horizon, give the planner the real-world inputs it currently lacks (fixed activities,
local tissue state), and close the loop so completed training updates achieved stimulus
as well as incurred cost.

---

## 5.1 — Bounded sequence search

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

## 5.2 — Move the planner/workout-library boundary

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

## 5.3 — Persist fixed activities

`FixedActivity` exists in the domain and `WeekAheadOptions.fixedActivities` accepts it,
but there is no Firestore-backed source (ADR-0008 §5 admits this). For a multi-sport
planner it is a first-order gap: Wednesday football *is* training; travel changes
equipment and availability; a booked session should shape the days on either side of it.

Persist per activity: date, duration, expected stimulus, expected cost, fixed vs movable,
environment/location, available equipment, and availability override. This is high
practical value for modest effort and does not depend on the search work — **it can land
before 5.1.**

## 5.4 — Local tissue state

One scalar soreness value cannot distinguish knee from Achilles from calf from adductor
from general DOMS. Extend the check-in to per-region response (morning state, pain during
training, after-training state, next-morning reaction), and let observed tissue response
override wearable-derived readiness where relevant.

**Sequencing note:** this builds directly on Phase 1.1's `BodyRegion` /
`InjuryConstraint` model. Doing it before Phase 1 would add a tissue layer on top of a
disconnected injury gate — richer input feeding a channel that is not consulted. Phase 1
first, always.

Fatigue estimates remain guidance; observed local response gets higher authority.

## 5.5 — Evidence hierarchy for completed training

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

## 5.6 — Multi-event: separate taper authority from demand contribution

`evaluatePeriodizationPhase` picks one governing event by priority then proximity. A more
realistic model is **one taper authority, multiple demand contributors**: an A-event 70
days out and a B-event 12 days out should let the B-event replace one quality session and
supply race-specific exposure without capturing the macrocycle.

Explicit objectives and session roles express this far more naturally than one blended
demand vector, which is why it sits after Phase 2.

## 5.7 — Taper as an explicit contract

Taper behaviour currently emerges from interactions between `volumeScale`, objective
generation, template `phaseEligibility` and utility ranking. `event-plan.ts` already names
the real roles — taper sharpening, pre-race openers, race-week strength, race day. Use
them, so taper directly expresses *reduce volume, preserve useful intensity and
event-specific freshness* rather than arriving as an emergent side effect.

---

## Acceptance criteria

- [ ] beam search replaces the greedy projected loop; hard constraints reject before scoring
- [ ] a full week is scored as a sequence, and the chosen week is explainable
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

* **ADR-0012** (new) — sequence planning and the session-role model
* **ADR-0008** — superseded in part: the greedy projected loop is replaced
* `docs/architecture/recommendation-engine.md` — the planner section
