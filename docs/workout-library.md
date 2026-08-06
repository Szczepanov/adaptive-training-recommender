# Workout Library Architecture

The workout library separates reusable training knowledge from a dated recommendation.

## Layers

1. **Exercises** describe atomic movements and drills.
2. **Workout definitions** combine exercises into blocks and steps.
3. **Variants** describe full, reduced, and return-to-training adjustments without mutating the canonical workout.
4. **Adjustable parameters** expose safe ranges for duration, repetitions, sets, recovery, and RPE.
5. **Workout prescriptions** are dated, user-specific instances produced by the recommendation engine.

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

The canonical definition stays unchanged. A `WorkoutPrescription` stores resolved values for one user and date.

## September-event coverage contract

`event-plan.ts` declares every session family required or conditionally allowed during the build, travel, peak, taper, and race phases.

The validator fails when:

- a required coverage key is missing;
- a coverage item has no workout options;
- a mapped workout does not exist;
- a mapped workout is not active;
- any phase has no declared coverage.

This prevents a future catalogue edit from accidentally removing a session needed by the active event plan.

## File layout

```text
app/src/workouts/
  models.ts                Domain schema and adjustable parameters
  exercises.ts             Atomic exercise definitions
  catalog.ts               Catalogue assembly
  catalog/                 Modality and phase-specific workout modules
  event-plan.ts            September-event coverage contract
  validation.ts            Referential and range validation
  compatibility.ts         Adapter to the current SessionTemplate model
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

- unique workout, exercise, variant, parameter, and step identifiers;
- valid exercise references;
- valid progression and regression references;
- valid duration and intensity ranges;
- valid adjustable parameter ranges and step references;
- valid variant overrides;
- Garmin export compatibility;
- required full, reduced and return-to-training variants;
- complete September-event phase coverage.

## Current scope

This foundation intentionally does not yet:

- replace the existing recommendation-selection rules;
- resolve generic parameter ranges into a daily prescription;
- publish workouts to Garmin;
- store custom workouts in Firestore;
- provide a workout-library UI;
- personalize watts, heart-rate zones or strength loads.

Those should be added through separate pull requests after the catalogue contract is reviewed.
