# Workout Library Architecture

The workout library separates reusable training knowledge from a dated recommendation.

## Layers

1. **Exercises** describe atomic movements and drills.
2. **Workout definitions** combine exercises into blocks and steps.
3. **Variants** describe full, reduced, and return-to-training adjustments without mutating the canonical workout.
4. **Workout prescriptions** are dated, user-specific instances produced by the recommendation engine.

## Source of the initial catalogue

The first catalogue is grounded in the active Sustained Multidirectional Field Macrocycle v5.0. It prioritizes:

- cycling Zone 2, threshold, over-under, short-surge and race-simulation work;
- one primary full-body strength session and one compact maintenance session;
- controlled field exposure every 7–10 days;
- low-fatigue mobility and lower-leg tissue capacity;
- device-specific cycling intensity, repeatability, and avoidance of accidental maximal testing.

The catalogue does not encode fixed personal watts. Power targets remain relative or RPE-based because outdoor Assioma power and indoor-bike power are separate systems.

## File layout

```text
app/src/workouts/
  models.ts          Domain schema
  exercises.ts       Atomic exercise definitions
  catalog.ts         Canonical workout definitions
  validation.ts      Referential and range validation
  compatibility.ts   Adapter to the current SessionTemplate model
  index.ts           Public exports
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

- unique workout, exercise, variant and step identifiers;
- valid exercise references;
- valid progression and regression references;
- valid duration and intensity ranges;
- valid variant overrides;
- Garmin export compatibility;
- required full, reduced and return-to-training variants.

## Current scope

This foundation intentionally does not yet:

- replace the existing recommendation-selection rules;
- publish workouts to Garmin;
- store custom workouts in Firestore;
- provide a workout-library UI;
- personalize watts, heart-rate zones or strength loads.

Those should be added through separate pull requests after the catalogue contract is reviewed.
