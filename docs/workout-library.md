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

The readiness engine still selects a high-level session template. `prescription.ts` maps that template to a workout family, chooses the appropriate variant, applies step overrides, and produces a serializable `WorkoutPrescription` snapshot.

The snapshot contains presentation-ready blocks and steps for Today’s Plan:

- warm-up, activation, main, accessory, and cool-down blocks;
- sets, repetitions, durations, and between-set recovery;
- RPE or repetitions-in-reserve targets;
- four-part strength tempo, for example `31X1` (lower / pause / lift / pause; `X` means accelerate under control);
- exercise instructions and step-specific cues.

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
- one primary full-body strength session plus compact and upper-body alternatives;
- controlled field exposure and optional walk-run;
- travel aerobic and hotel-gym maintenance sessions;
- taper sharpening, pre-race openers and race-week strength primer;
- complete rest and race day.

The catalogue does not encode fixed personal watts. Power targets remain relative, device-specific, or RPE-led because different bikes and power systems may not agree.

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
- required full, reduced and return-to-training variants;
- complete September-event phase coverage and phase restrictions.

## Current scope

This implementation does not replace the existing recommendation-selection rules, publish workouts to Garmin, store custom workouts, or provide a standalone workout-library UI. Composite parameter execution, richer running pace targets, and a measurement-freshness policy are the next extensions.
