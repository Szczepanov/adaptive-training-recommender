# Workout Library Architecture

The workout library separates reusable training knowledge from a dated recommendation.

## Layers

1. **Exercises** describe atomic movements and drills.
2. **Workout definitions** combine exercises into blocks and steps.
3. **Variants** describe full, reduced, and return-to-training adjustments without mutating the canonical workout.
4. **Adjustable parameters** expose safe ranges for duration, repetitions, sets, recovery, and RPE.
5. **Parameter bindings** explicitly describe how each adjustable value changes step fields or invokes a named resolver strategy.
6. **Workout prescriptions** are dated, user-specific instances produced by the recommendation engine and rendered on the dashboard as an executable plan.

## Daily prescription flow

The readiness engine selects a high-level session template. `prescription.ts` first looks for an active, non-manual workout whose `engineTemplateIds` includes that template, then uses the legacy mapping only where no catalogue candidate has been declared. It chooses the appropriate variant, applies step overrides, and produces a serializable `WorkoutPrescription` snapshot.

This makes the detailed catalogue the preferred source of routing truth. A regression test resolves every selectable engine template so an engine-template edit cannot silently fall back to an unrelated workout family.

The snapshot contains presentation-ready blocks and steps for Today’s Plan:

- warm-up, activation, main, accessory, and cool-down blocks;
- sets, repetitions, durations, and between-set recovery;
- RPE or repetitions-in-reserve targets;
- four-part strength tempo, for example `31X1` (lower / pause / lift / pause; `X` means accelerate under control);
- exercise instructions and step-specific cues;
- technical success criteria, common faults, and stop conditions when a step uses a `technical_quality` target.

The snapshot is written with the daily recommendation at `users/{userId}/daily_recommendations/{date}`. It is not rebuilt from a later catalogue version when historical recommendations are read.

## Athlete-specific targets

Definitions remain generic. Optional `UserPreferences.performanceProfile` values allow the resolver to show safe absolute targets when the athlete has supplied a current reference:

- FTP or critical power for watts on FTP-percentage cycling steps;
- threshold pace for a running pace reference in min/km;
- LTHR for a heart-rate guardrail;
- exercise-specific estimated 1RM values for a starting lifting-load range.

When a reference is absent, the displayed plan stays relative: RPE/RIR takes precedence and no watt, pace, heart-rate, or weight value is invented. The Preferences screen provides fields for FTP/critical power, threshold pace, LTHR, and common lifting e1RMs. Profile updates record `measuredAt` so a future freshness policy can warn about stale measurements.

## Source of the catalogue

The catalogue is grounded in the active Sustained Multidirectional Field Macrocycle v5.0 and covers the complete path to the September cycling event:

- cycling Zone 2 and recovery riding;
- controlled threshold and over-under work;
- short accelerations and longer gap-closing efforts;
- outdoor event-specific endurance and peak race simulation;
- primary full-body and lower-body strength sessions plus compact, reactive-power, upper-body, and cable alternatives;
- controlled field exposure and optional walk-run;
- travel aerobic and hotel-gym maintenance sessions;
- taper sharpening, pre-race openers and race-week strength primer;
- complete rest and race day.
- sprint-mechanics foundation plus acceleration-and-braking progression;
- cycling pedalling-economy practice and a manual-only traffic-free braking/cornering session;
- matching tempo, VO2, hill-repeat, variable-intensity, and short-interval prescriptions for the engine's running and cycling quality templates;
- breathwork-led recovery plus eccentric hamstring and calf-capacity accessories.

The catalogue does not encode fixed personal watts. Power targets remain relative, device-specific, or RPE-led because different bikes and power systems may not agree.

## Technical skill sessions and safety

`technical_skill` is a distinct workout category. It models a coordination-focused session rather than treating low-RPE skills as generic recovery or treating sprint drills as endurance intervals. Technical workouts declare a technical objective, an environment, the required level of supervision, and stop conditions.

Technical steps can include a `technical_quality` target with a coaching cue plus optional success criteria, common faults, and step-level stop conditions. The prescription renderer surfaces those details as cues, so the athlete has an explicit quality standard rather than only a duration or RPE target.

The current technical progressions are deliberately conservative:

- **Sprint mechanics foundation**: wall drives, A-march, and submaximal falling starts with full recovery.
- **Acceleration and braking skill**: a later progression with greater mechanical and eccentric cost, gated by readiness, soreness, lower-body spacing, and symptom flags.
- **Cycling pedalling economy**: cadence ladders, controlled spin-ups, and seated-to-standing transitions at easy aerobic cost; it is available through the `Cycling` technical template and requires an indoor bike in the engine.
- **Cycling cornering and braking skill**: a traffic-free-area practice session marked `manualOnly`. It is intentionally excluded from automatic recommendations until the planner captures rider skill, surface, traffic-free area, and supervision context.

Technical templates are not placed in the default green-day hard-session pool. They are selected when the athlete explicitly requests the matching modality, preventing a coordination session from being substituted randomly for a primary endurance or strength objective.

Field Maintenance is available through the intent-aware optimizer but is deliberately not in the readiness-only green-day pool. Its catalogue spacing rule (two days after hard lower-body work) cannot be represented by that path's template filter, so this avoids suggesting high-impact field work without its required spacing check.

## Generic session families

Workout names describe reusable families rather than one immutable prescription. The `parameters` field defines dimensions the recommendation engine or coach may resolve for a specific day.

```ts
parameters: [
  {
    id: 'interval_duration',
    label: 'Interval duration',
    unit: 'minutes',
    defaultValue: 8,
    minimum: 4,
    maximum: 12,
    step: 1,
    appliesToStepIds: ['threshold_repeats'],
    description: 'Increase duration before aggressively increasing intensity.'
  }
]
```

`parameter-bindings.ts` makes the execution semantics explicit:

```ts
stepField(
  'interval_duration',
  ['threshold_repeats'],
  'duration.seconds',
  { transform: 'minutes_to_seconds' }
)
```

Simple parameters bind to typed fields such as sets, time, repetitions, recovery, RPE, or repetitions in reserve. Composite behavior uses named resolver strategies, for example embedded race surges or walk-run distribution. The current resolver snapshots the selected canonical variant and its overrides; parameter bindings remain the contract for future athlete- or coach-selected parameter values.

The canonical definition stays unchanged. A `WorkoutPrescription` stores resolved values for one user and date.

## Duration semantics

`WorkoutDefinition.duration` describes the supported range for the canonical **full** workout. The full variant must remain inside that range and normally matches `defaultMin`.

Reduced and return-to-training variants may intentionally fall below `minimumMin`; their role is to preserve the session purpose while lowering dose. Validation enforces this ordering:

```text
return_to_training <= reduced <= full
```

Complete rest is the only workout allowed to use zero-minute durations.

## September-event coverage contract

`event-plan.ts` declares every session family required or conditionally allowed during the build, travel, peak, taper, and race phases.

The validator fails when:

- a required coverage key is missing;
- a coverage item has no workout options;
- a mapped workout does not exist or is inactive;
- a phase has no required coverage;
- travel, taper, or race-only families leak into an inappropriate phase;
- field maintenance is scheduled in taper or race phases.

This prevents a future catalogue edit from accidentally removing or misplacing a session needed by the active event plan.

## File layout

```text
app/src/workouts/
  models.ts                Domain schema and duration semantics
  exercises.ts             Atomic exercise definitions
  catalog.ts               Catalogue assembly
  catalog/                 Modality and phase-specific workout modules
    field-technique.ts     Sprint mechanics and acceleration/braking progressions
    cycling-technique.ts   Pedalling economy and manual-only handling practice
    quality-support.ts     Detailed tempo, VO2, and hill prescriptions
    strength-lower.ts      Dedicated lower-body strength and tissue-capacity prescription
  parameter-bindings.ts    Explicit parameter execution contract
  event-plan.ts            September-event coverage contract
  validation.ts            Referential, semantic, and range validation
  prescription.ts          Template-to-workout resolution and presentation snapshot creation
  index.ts                 Public exports
app/scripts/
  validate-workouts.ts
```

## Validation

Run:

```bash
cd app
npm run validate:workouts
```

Validation checks include:

- unique workout, exercise, variant, parameter, binding, and step identifiers;
- valid exercise references and compatible exercise/workout modalities;
- workout equipment coverage for every exercise;
- valid progression and regression references plus progression-cycle detection;
- canonical full-workout duration rules and variant ordering;
- valid adjustable parameter ranges, reachable increments, step references, units, transforms, and zero behavior;
- complete explicit binding coverage for every adjustable parameter;
- valid substitution sources, targets, and reasons;
- valid variant overrides and Garmin export compatibility;
- technical-workout safety metadata, technical objectives, and technical-quality targets;
- manual-only workout safety metadata;
- required full, reduced and return-to-training variants;
- complete September-event phase coverage and phase restrictions.

## Current scope

This implementation does not publish workouts to Garmin, store custom workouts, or provide a standalone workout-library UI. Outdoor group-riding skills remain manual-only until environmental access, rider skill, and supervision can be captured by the planner. Composite parameter execution, richer running pace targets, and a measurement-freshness policy are the next extensions.
