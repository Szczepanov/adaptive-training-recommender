import type { ExerciseDefinition, IntensityTarget, WorkoutDefinition } from './models.ts';

export interface WorkoutLibraryValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

const expectedVariantIds = new Set(['full', 'reduced', 'return_to_training']);

function validateTarget(target: IntensityTarget, path: string, errors: string[]): void {
  if (target.type === 'rpe' && (target.min < 1 || target.max > 10 || target.min > target.max)) errors.push(`${path}: invalid RPE range ${target.min}-${target.max}`);
  if (target.type === 'heart_rate_zone' && (target.zone < 1 || target.zone > 7)) errors.push(`${path}: heart-rate zone must be between 1 and 7`);
  if (target.type === 'power_zone' && (target.zone < 1 || target.zone > 7)) errors.push(`${path}: power zone must be between 1 and 7`);
  if (target.type === 'ftp_percent' && (target.min <= 0 || target.max > 200 || target.min > target.max)) errors.push(`${path}: invalid FTP percentage range ${target.min}-${target.max}`);
  if (target.type === 'cadence' && (target.minRpm <= 0 || target.maxRpm > 250 || target.minRpm > target.maxRpm)) errors.push(`${path}: invalid cadence range ${target.minRpm}-${target.maxRpm}`);
  if (target.type === 'reps_in_reserve' && (target.min < 0 || target.max > 10 || target.min > target.max)) errors.push(`${path}: invalid repetitions-in-reserve range ${target.min}-${target.max}`);
}

export function validateWorkoutLibrary(exercises: ExerciseDefinition[], workouts: WorkoutDefinition[]): WorkoutLibraryValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const exerciseIds = new Set<string>();
  const workoutIds = new Set<string>();

  for (const exercise of exercises) {
    if (exerciseIds.has(exercise.id)) errors.push(`Duplicate exercise id: ${exercise.id}`);
    exerciseIds.add(exercise.id);
    if (!exercise.name.trim()) errors.push(`${exercise.id}: exercise name is required`);
    if (!exercise.instruction.trim()) errors.push(`${exercise.id}: exercise instruction is required`);
  }

  for (const workout of workouts) {
    if (workoutIds.has(workout.id)) errors.push(`Duplicate workout id: ${workout.id}`);
    workoutIds.add(workout.id);
  }

  for (const workout of workouts) {
    const prefix = workout.id;
    const isCompleteRest = workout.id === 'rest_complete_01';
    if (workout.version < 1) errors.push(`${prefix}: version must be positive`);
    if (workout.duration.minimumMin < 0 || workout.duration.defaultMin < 0 || workout.duration.maximumMin < 0) errors.push(`${prefix}: duration values cannot be negative`);
    if (workout.duration.minimumMin > workout.duration.defaultMin || workout.duration.defaultMin > workout.duration.maximumMin) errors.push(`${prefix}: duration must satisfy minimum <= default <= maximum`);
    if (!isCompleteRest && workout.duration.minimumMin === 0) errors.push(`${prefix}: only complete rest may have a zero-minute minimum duration`);
    if (workout.loadProfile.recoveryHours < 0) errors.push(`${prefix}: recoveryHours cannot be negative`);
    if (workout.blocks.length === 0) errors.push(`${prefix}: at least one workout block is required`);
    if (workout.objectives.length === 0) errors.push(`${prefix}: at least one objective is required`);
    if (workout.sourceNotes.length === 0) warnings.push(`${prefix}: add sourceNotes for coaching provenance`);

    const variantIds = new Set(workout.variants.map((variant) => variant.id));
    for (const expectedId of expectedVariantIds) {
      if (!variantIds.has(expectedId as 'full' | 'reduced' | 'return_to_training')) errors.push(`${prefix}: missing ${expectedId} variant`);
    }
    if (variantIds.size !== workout.variants.length) errors.push(`${prefix}: duplicate variant id`);

    const stepIds = new Set<string>();
    for (const block of workout.blocks) {
      if (block.steps.length === 0) errors.push(`${prefix}/${block.id}: block must contain at least one step`);
      for (const step of block.steps) {
        const stepPath = `${prefix}/${block.id}/${step.id}`;
        if (stepIds.has(step.id)) errors.push(`${prefix}: duplicate step id ${step.id}`);
        stepIds.add(step.id);
        if (!exerciseIds.has(step.exerciseId)) errors.push(`${stepPath}: unknown exercise ${step.exerciseId}`);
        if (step.sets !== undefined && step.sets < 1) errors.push(`${stepPath}: sets must be positive`);
        if (step.restAfterSec !== undefined && step.restAfterSec < 0) errors.push(`${stepPath}: restAfterSec cannot be negative`);
        if (step.duration.type === 'time' && step.duration.seconds <= 0) errors.push(`${stepPath}: time duration must be positive`);
        if (step.duration.type === 'distance' && step.duration.meters <= 0) errors.push(`${stepPath}: distance must be positive`);
        if (step.duration.type === 'repetitions' && step.duration.repetitions <= 0) errors.push(`${stepPath}: repetitions must be positive`);
        if (step.target) validateTarget(step.target, stepPath, errors);
      }
    }

    for (const variant of workout.variants) {
      if (variant.targetDurationMin < 0 || (!isCompleteRest && variant.targetDurationMin === 0)) errors.push(`${prefix}/${variant.id}: targetDurationMin must be positive unless this is complete rest`);
      if (variant.loadMultiplier <= 0 || variant.loadMultiplier > 1.2) errors.push(`${prefix}/${variant.id}: loadMultiplier must be greater than 0 and no more than 1.2`);
      for (const override of variant.stepOverrides) {
        if (!stepIds.has(override.stepId)) errors.push(`${prefix}/${variant.id}: override references unknown step ${override.stepId}`);
        if (override.sets !== undefined && override.sets < 1) errors.push(`${prefix}/${variant.id}/${override.stepId}: sets must be positive`);
        if (override.durationSeconds !== undefined && override.durationSeconds <= 0) errors.push(`${prefix}/${variant.id}/${override.stepId}: durationSeconds must be positive`);
        if (override.target) validateTarget(override.target, `${prefix}/${variant.id}/${override.stepId}`, errors);
      }
    }

    const parameterIds = new Set<string>();
    for (const parameter of workout.parameters ?? []) {
      const parameterPath = `${prefix}/parameter/${parameter.id}`;
      if (parameterIds.has(parameter.id)) errors.push(`${prefix}: duplicate parameter id ${parameter.id}`);
      parameterIds.add(parameter.id);
      if (!parameter.label.trim()) errors.push(`${parameterPath}: label is required`);
      if (!parameter.description.trim()) errors.push(`${parameterPath}: description is required`);
      if (parameter.minimum > parameter.defaultValue || parameter.defaultValue > parameter.maximum) errors.push(`${parameterPath}: range must satisfy minimum <= defaultValue <= maximum`);
      if (parameter.step <= 0) errors.push(`${parameterPath}: step must be positive`);
      if (parameter.appliesToStepIds.length === 0) errors.push(`${parameterPath}: at least one step reference is required`);
      for (const stepId of parameter.appliesToStepIds) if (!stepIds.has(stepId)) errors.push(`${parameterPath}: unknown step ${stepId}`);
      if (parameter.unit === 'rpe' && (parameter.minimum < 1 || parameter.maximum > 10)) errors.push(`${parameterPath}: RPE parameter must remain between 1 and 10`);
    }

    for (const relatedId of [...workout.regressions, ...workout.progressions]) {
      if (!workoutIds.has(relatedId)) errors.push(`${prefix}: related workout ${relatedId} does not exist`);
      if (relatedId === workout.id) errors.push(`${prefix}: workout cannot reference itself as progression or regression`);
    }

    for (const substitution of workout.substitutions) {
      if (!exerciseIds.has(substitution.exerciseId)) errors.push(`${prefix}: substitution source ${substitution.exerciseId} does not exist`);
      if (!exerciseIds.has(substitution.substituteExerciseId)) errors.push(`${prefix}: substitution target ${substitution.substituteExerciseId} does not exist`);
    }

    if (workout.garmin.exportable && workout.modality !== 'cycling' && workout.modality !== 'running') errors.push(`${prefix}: only cycling and running workouts may be Garmin-exportable`);
    if (workout.garmin.exportable && workout.garmin.supportedSport !== workout.modality) errors.push(`${prefix}: Garmin supportedSport must match workout modality`);
  }

  return { valid: errors.length === 0, errors, warnings };
}
