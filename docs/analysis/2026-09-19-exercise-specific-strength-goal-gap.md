# Exercise-specific strength goal gap — deadlift 1RM target (2026-09-19)

**Date:** 2026-09-19  
**Status:** point-in-time analysis  
**Scope:** determine whether an athlete can currently express “maximize my conventional deadlift, with a target of X kg”, whether that intent reaches live planning, and which existing repository capabilities should be reused rather than duplicated.

---

## Executive verdict

The athlete is **not missing a hidden exercise-specific goal feature**. The repository has several adjacent capabilities, but they do not currently join into an exercise-specific performance goal.

Today there are two user-facing “goal” concepts:

1. **Preferences → Training Plan → priorities** can select `strength_muscle` (“Strength and muscle”). That is a broad weekly adaptation priority.
2. **Goals → Domain = Strength** can store a generic optional `targetMetric / targetValue / targetUnit` triple.

Neither one means “train the conventional deadlift toward a 220 kg 1RM”.

The generic target fields are particularly misleading because the UI makes them look actionable, but the live recommendation path does not consume their metric/value/unit. A non-event `UserGoal` remains an aspirational/display object: `mapContextFromGoalsAndTrainingSettings` reduces active goals to the highest-priority **title** in each time horizon, while `mapGoalsToUserEvents` only turns dated event goals into periodization inputs. The planner therefore cannot distinguish “deadlift 220 kg” from any other strength-title text.

The good news is that most of the required lower-level substrate already exists:

- canonical exercise identity: `conventional_deadlift`;
- load-capable exercise facets including `mass` and `percent_one_rm`;
- per-exercise `estimated1RmKg` storage and provenance;
- gauge-aware estimated-1RM derivation from logged strength sets;
- strength-session execution and overload history;
- `strength_development` as a typed objective;
- exact session/step binding in the H5 progression architecture;
- performance-outcome/evaluation infrastructure.

The missing feature is therefore primarily a **goal-expression + goal-to-planning bridge**, plus one important catalog gap: no current active strength workout actually contains `conventional_deadlift`.

The product should not solve this by feeding the aspirational target weight directly into session loading. A 220 kg target and a current 160 kg estimated 1RM are different concepts. **The target decides what the program is trying to improve; current capacity and normal safety/autoregulation decide what load is appropriate today.**

Execution work is proposed in [`docs/plans/exercise-specific-strength-performance-goals.md`](../plans/exercise-specific-strength-performance-goals.md).

---

## 1. What the athlete sees today

### 1.1 Training priorities are broad by design

`app/src/components/preferences/TrainingPlanSection.tsx` exposes these persisted `TrainingPriority` values:

- `health`
- `balanced_performance`
- `endurance`
- `strength_muscle`
- `speed_power`
- `sport_readiness`

The strength option is labelled **“Strength and muscle”**. There is no exercise, lift, performance metric or target-value field.

That priority is real planning input. `resolveEvidenceBackedStrategy` in `engine/evergreenStrategy.ts` maps `strength_muscle` to the existing broad `strength` adaptation requirement. This is useful for weekly allocation, but it is intentionally not a deadlift-specialization model.

### 1.2 The Goals screen looks more specific than it is

`app/src/components/Goals.tsx` supports:

- Domain = `strength`;
- a generic “Optional Target”:
  - free-text Metric;
  - numeric Value;
  - free-text Unit.

A user can therefore type something equivalent to:

- Metric: `deadlift`
- Value: `220`
- Unit: `kg`

That data is persisted, but the form does not offer:

- an exercise picker;
- a metric type such as 1RM;
- canonical exercise identity;
- current/baseline strength;
- measured versus estimated semantics;
- target-achievement evidence;
- goal-specific training behavior.

The goal card also renders only `Target: {value} {unit}` when a metric exists, so the metric name itself is not included in the visible target line.

---

## 2. Current data flow: where specificity disappears

The relevant live path is:

```text
Goals.tsx
  -> goalService
  -> validateGoal
  -> users/{userId}/goals/{goalId}
  -> DailyDecisionInput.activeGoals
  -> adapters.ts
       -> mapContextFromGoalsAndTrainingSettings(...)
       -> mapGoalsToUserEvents(...)
  -> recommendation / weekly planning
```

### 2.1 Persistence accepts a weakly typed triple

`UserGoal` in `engine/models.ts` has:

```ts
targetMetric?: string | null;
targetValue?: number | null;
targetUnit?: string | null;
```

The model comment gives examples such as `bench_press_weight`, but the fields are not a typed performance-target contract.

`validateGoal` in `engine/validationCore.ts` normalizes those fields and stores them. It does **not** enforce:

- all-or-none target-field presence;
- a recognized metric id;
- a recognized unit for that metric;
- a stable exercise id;
- strength-domain compatibility;
- a positive/sensible target range;
- measured-versus-estimated semantics.

Firestore rules for `users/{userId}/goals/{goalId}` currently enforce ownership and taper structure, not a structured performance target.

### 2.2 The live adapter discards metric/value/unit

`mapContextFromGoalsAndTrainingSettings` chooses the highest-priority goal title in each time horizon and returns only:

```ts
goals: {
  shortTerm: string;
  midTerm: string;
  longTerm: string;
}
```

It does not forward the goal domain, `targetMetric`, `targetValue`, `targetUnit`, or an exercise id.

`rules.ts` does not consume those goal-title strings for exercise-specific ranking either. Event goals take a separate typed path through `mapGoalsToUserEvents` and periodization; ordinary strength goals do not.

**Consequence:** changing “Deadlift 180 kg” to “Deadlift 250 kg” does not alter the live strength selection or dose.

---

## 3. The broad strength planner is working as designed

`TrainingPriority = strength_muscle` is mapped by `resolveEvidenceBackedStrategy` to the generic `strength` adaptation requirement.

The Evergreen packer’s baseline coverage contains a broad `primary_strength` role. It can ensure strength work occurs, but there is no dimension such as:

```text
required exercise = conventional_deadlift
metric = 1RM
target = 220 kg
```

The typed weekly/block objective vocabulary is similarly broad:

- `strength_maintenance`
- `strength_development`

`microcycle.ts` maps `strength_development` to a generic max-strength/hypertrophy stimulus. That is appropriate at the adaptation layer, but insufficient to represent **which lift** is the athlete-owned outcome.

This distinction should be preserved. “Strength development” is an adaptation; “220 kg conventional deadlift 1RM” is a performance outcome.

---

## 4. The canonical deadlift identity already exists

The exercise catalog already contains:

```text
id: conventional_deadlift
name: Conventional Deadlift
modality: strength
movementPatterns: hinge
equipment: barbell
allowed load kinds: mass, percent_one_rm, descriptive
```

This is exactly the identity a goal should bind to. A new feature should **not** store the string `"deadlift"` and later try to infer which lift the athlete meant.

The catalog also has other distinct hinge exercises:

- `romanian_deadlift`
- `single_leg_romanian_deadlift`
- `kettlebell_deadlift`

Those are not interchangeable identities for a conventional-deadlift performance target.

---

## 5. Important catalog gap: the planner cannot currently select a conventional-deadlift workout

Although `conventional_deadlift` exists in the exercise catalog, the active strength workout catalog reviewed here does not use it.

Current primary/lower-body strength definitions use `romanian_deadlift` as the hinge movement:

- `workouts/catalog/strength.ts`
- `workouts/catalog/strength-lower.ts`

Therefore, even after adding a typed “conventional deadlift 220 kg” goal, the automatic planner would still have no exact catalog workout to choose unless one is added or a goal-specific authored-session path is made planning-authoritative.

This matters because generic strength credit must not be mistaken for exercise-specific goal coverage. A Romanian deadlift session can support posterior-chain strength; it is not evidence that the program delivered direct conventional-deadlift practice.

---

## 6. Current-capacity infrastructure is stronger than the goal infrastructure

### 6.1 Per-exercise estimated 1RM already exists

`AthletePerformanceProfile` already stores:

```ts
estimated1RmKg?: Record<string, number>;
strength?: {
  estimated1RmKg?: Record<string, number>;
}
estimated1RmSources?: Record<string, {
  source: 'garmin' | 'manual' | 'coach' | 'derived';
  computedAt?: string;
}>;
```

The keys are exercise IDs. This is a good representation of **current capacity**, and it should stay separate from the aspirational goal.

### 6.2 Strength logs already self-calibrate e1RM

ADR-0021’s delivered strength logging path includes:

- raw per-set logs;
- gauge-aware Epley estimation;
- exclusion of inappropriate evidence such as power/technical sets or excessively high-rep sets;
- per-exercise write-back;
- source ownership so a derived value does not overwrite protected manual/coach values.

This means a deadlift-specific goal does **not** need a new PR-tracking database merely to know current estimated capacity.

### 6.3 The Preferences UI artificially hides that generality

`components/preferences/PerformanceSections.tsx` hardcodes e1RM inputs for only:

- `front_squat`
- `romanian_deadlift`
- `bench_press`

`conventional_deadlift` is absent even though the underlying storage and exercise catalog can represent it.

That is a discoverability/capability mismatch: the model is exercise-keyed; the UI is three-lift hardcoded.

---

## 7. Target weight and current capacity must remain different concepts

A strength target must not become the number used to calculate today’s working weight.

Example:

```text
current deadlift e1RM: 160 kg
goal:                  220 kg
today's prescription:  based on current 160 kg capacity + RIR/safety
NOT:                   based on percentages of 220 kg
```

Using the goal weight as the loading denominator would make the prescription more aggressive precisely when the goal is most ambitious.

The correct relationship is:

```text
performance target
    -> chooses / prioritizes the adaptation and exact exercise
current capacity
    -> calibrates today's load
session response + logged sets
    -> updates current capacity
repeated performance evidence
    -> shows progress toward the target
```

The existing e1RM ownership and prescription architecture already supports the middle of this loop.

---

## 8. H5 progression is adjacent, but not yet a load-progression engine

`engine/blockIntent.ts` already supports exact progression binding to:

- `objectiveId`
- optional `sessionId`
- optional `stepId`

That is useful future infrastructure for a specific lift.

However, the only registered `ProgressionVariable` is currently:

```text
duration_min
```

with unit `minutes`.

It would be incorrect to reuse duration progression for a max-strength goal, and it would be premature to add `load_kg` merely because the UI now has a target number. A strength load progression has different semantics, safety constraints, evidence needs and replay behavior.

The first useful deadlift-goal release does not need to block on H5 load progression: a goal-specific workout can still use current-capacity-based relative loading and RIR, while the existing e1RM write-back makes the absolute load self-calibrating. Explicit confirmed load progression can be a later, separately governed capability.

---

## 9. Outcome evidence is also adjacent, but cycling-first today

The Performance Outcome Validation stack is designed for exactly the general loop this feature eventually needs:

```text
goal -> training -> standardized observation -> progress interpretation
```

But the current metric registry is cycling-first. `observations/registry.ts` contains cycling TT and submaximal metrics; there is no strength 1RM metric.

The generic observation model already allows `domain: 'strength'` and arbitrary observation context, so it can be extended. Two details still need an explicit design:

1. **exercise identity must be part of comparison identity**, otherwise bench, squat and deadlift observations sharing a single `strength_1rm_kg` metric are ambiguous;
2. `OutcomeMetricBinding` currently binds a `metricId`, not a metric + exercise subject.

A scalable shape is therefore a generic strength metric plus an exercise subject/reference, rather than creating a new registry metric id for every exercise.

Until that is implemented, the existing per-exercise e1RM can be shown as a clearly labelled **progress proxy**, not treated as protocol-locked proof that an actual 1RM target was achieved.

---

## 10. Product semantics recommended from this analysis

### 10.1 Initial supported target

Keep the first release deliberately narrow:

```ts
type StrengthOneRmGoalTarget = {
  kind: 'strength_1rm';
  exerciseId: string;      // canonical EXERCISES id
  targetKg: number;        // canonical storage unit
};
```

Use the existing `targetDate` for optional timing. Do not put a baseline/current value inside the goal.

Future target kinds can be added as discriminated-union variants after real use exists.

### 10.2 What creating the goal should mean

An active typed strength-1RM goal should:

1. make the exact exercise visible in the goal UI;
2. show current e1RM/provenance when available;
3. create a typed goal-derived strength planning requirement;
4. require exact-exercise coverage in at least part of the strength allocation;
5. select only workouts/sessions that genuinely contain that exercise for exact-goal credit;
6. continue to obey equipment, injury, fatigue, schedule and daily safety gates;
7. use current capacity, not target weight, to resolve working loads;
8. show an explicit shortfall when no safe/eligible exact-exercise session can be placed.

It should **not**:

- parse free-text titles to guess exercise identity;
- treat RDL as completed conventional-deadlift exposure;
- increase load because the user typed a bigger goal number;
- infer a linear “kg per week required” progression from the target date;
- mark the goal achieved solely because a noisy derived e1RM crossed the target unless that evidence semantics is explicitly accepted.

---

## 11. Findings summary

| ID | Finding | Consequence |
|---|---|---|
| SG-F1 | Preferences has only broad `strength_muscle` planning priority | No exercise-specific planning intent |
| SG-F2 | Goals has a free-text metric/value/unit target | Looks more actionable than it is |
| SG-F3 | `validateGoal` does not give the target typed semantics | Invalid/ambiguous combinations can persist |
| SG-F4 | Active-goal adapter forwards only time-horizon title strings | Target metric/value never reaches selection |
| SG-F5 | `conventional_deadlift` already has a stable canonical exercise id | Reuse it; do not invent a second identity |
| SG-F6 | No active catalog workout contains `conventional_deadlift` | Planner has no exact deadlift session to select |
| SG-F7 | e1RM storage is already exercise-keyed | Current-capacity model is reusable |
| SG-F8 | Preferences e1RM UI is hardcoded to three exercises | Conventional deadlift cannot be manually calibrated there |
| SG-F9 | Strength set logs already derive/update e1RM safely | Do not build a duplicate PR/capacity store |
| SG-F10 | H5 can bind a progression to a step but only progresses duration | Do not misuse it for load |
| SG-F11 | Outcome infrastructure is generic enough to extend but registry/bindings are cycling-first | Strength target evidence needs an exercise-bound metric design |
| SG-F12 | Target weight is an outcome, not a prescription denominator | Current capacity + RIR/safety remains dose authority |

---

## 12. Architectural conclusion

The missing feature is not “add a deadlift textbox”. It is the missing typed bridge between four existing layers:

```text
ATHLETE OUTCOME
“220 kg conventional deadlift 1RM”
        |
        v
PLANNING DEMAND
strength development + exact exercise coverage
        |
        v
SESSION PRESCRIPTION
current e1RM / %1RM / RIR + safety gates
        |
        v
EXECUTION + EVIDENCE
logged sets -> updated e1RM -> progress / formal outcome evidence
```

The repository is unusually close to supporting this correctly because exercise identity, execution, e1RM derivation and longitudinal outcome architecture already exist. The work should connect those systems rather than create a fourth goal model or a deadlift-only special case.
