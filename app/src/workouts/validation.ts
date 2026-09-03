import type {
  Equipment,
  ExerciseDefinition,
  ExerciseFacets,
  IntensityTarget,
  WorkoutDefinition,
  WorkoutModality,
  WorkoutParameter,
  WorkoutParameterBindingSet,
  WorkoutParameterSetBinding,
  WorkoutParameterStepField,
  WorkoutParameterUnit
} from './models.ts';
import { getActiveKnowledgeClaim } from '../knowledge/sportsKnowledgeRegistry.ts';

export interface WorkoutLibraryValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

const expectedVariantIds = new Set(['full', 'reduced', 'return_to_training']);

const compatibleExerciseModalities: Record<WorkoutModality, WorkoutModality[]> = {
  cycling: ['cycling'],
  running: ['running'],
  swimming: ['swimming'],
  walking: ['walking'],
  strength: ['strength'],
  field: ['field'],
  mobility: ['mobility', 'strength'],
  recovery: ['recovery', 'mobility', 'strength', 'cycling'],
  cross_training: ['cross_training']
};

const hotelGymEquipment = new Set<Equipment>(['dumbbells', 'bench', 'treadmill', 'bodyweight']);
const exerciseFamilies = new Set<ExerciseFacets['family']>(['cycling', 'running', 'strength', 'field_drill', 'mobility', 'recovery']);
const exerciseDoseKinds = new Set<ExerciseFacets['allowedDoseKinds'][number]>(['repetition', 'duration', 'distance', 'checkoff']);
const exerciseLoadKinds = new Set<ExerciseFacets['allowedLoadKinds'][number]>(['bodyweight', 'mass', 'band', 'percent_max', 'percent_one_rm', 'descriptive', 'unloaded']);
const exerciseLaterality = new Set<ExerciseFacets['allowedLaterality'][number]>(['bilateral', 'per_side', 'alternating']);
const measurementProfiles = new Set<ExerciseFacets['measurementProfile']>(['repetitions', 'duration', 'distance', 'timed_sprint', 'checkoff']);
const fieldDomains = new Set<NonNullable<ExerciseFacets['fieldDomains']>[number]>(['acceleration', 'max_velocity', 'braking', 'change_of_direction', 'elastic']);

function hasOnlyUniqueKnown<T>(values: readonly T[], known: ReadonlySet<T>): boolean {
  return values.length > 0 && new Set(values).size === values.length && values.every(value => known.has(value));
}

function validateExerciseFacets(exercise: ExerciseDefinition, path: string, errors: string[]): void {
  const facets = exercise.facets;
  if (!facets) return;
  if (!exerciseFamilies.has(facets.family)) errors.push(`${path}: unknown exercise family ${facets.family}`);
  if (!hasOnlyUniqueKnown(facets.allowedDoseKinds, exerciseDoseKinds)) errors.push(`${path}: allowedDoseKinds must be a non-empty unique known vocabulary`);
  if (!hasOnlyUniqueKnown(facets.allowedLoadKinds, exerciseLoadKinds)) errors.push(`${path}: allowedLoadKinds must be a non-empty unique known vocabulary`);
  if (!hasOnlyUniqueKnown(facets.allowedLaterality, exerciseLaterality)) errors.push(`${path}: allowedLaterality must be a non-empty unique known vocabulary`);
  if (!measurementProfiles.has(facets.measurementProfile)) errors.push(`${path}: unknown measurementProfile ${facets.measurementProfile}`);
  if (facets.measurementProfile === 'timed_sprint' && !facets.allowedDoseKinds.includes('distance')) errors.push(`${path}: timed_sprint requires distance dose support`);
  if (facets.fieldDomains && (!hasOnlyUniqueKnown(facets.fieldDomains, fieldDomains) || facets.family !== 'field_drill')) errors.push(`${path}: fieldDomains are unique field_drill-only facets`);
  if (facets.family === 'field_drill' && exercise.modality !== 'field') errors.push(`${path}: field_drill family requires field modality`);
  if (facets.family !== 'field_drill' && facets.fieldDomains?.length) errors.push(`${path}: non-field family cannot declare fieldDomains`);
}

function validateTarget(target: IntensityTarget, path: string, errors: string[]): void {
  if (target.type === 'rpe' && (target.min < 1 || target.max > 10 || target.min > target.max)) errors.push(`${path}: invalid RPE range ${target.min}-${target.max}`);
  if (target.type === 'heart_rate_zone' && (target.zone < 1 || target.zone > 7)) errors.push(`${path}: heart-rate zone must be between 1 and 7`);
  if (target.type === 'power_zone' && (target.zone < 1 || target.zone > 7)) errors.push(`${path}: power zone must be between 1 and 7`);
  if (target.type === 'ftp_percent' && (target.min <= 0 || target.max > 200 || target.min > target.max)) errors.push(`${path}: invalid FTP percentage range ${target.min}-${target.max}`);
  if (target.type === 'cadence' && (target.minRpm <= 0 || target.maxRpm > 250 || target.minRpm > target.maxRpm)) errors.push(`${path}: invalid cadence range ${target.minRpm}-${target.maxRpm}`);
  if (target.type === 'reps_in_reserve' && (target.min < 0 || target.max > 10 || target.min > target.max)) errors.push(`${path}: invalid repetitions-in-reserve range ${target.min}-${target.max}`);
  if (target.type === 'technical_quality' && !target.cue.trim()) errors.push(`${path}: technical-quality cue is required`);
}

function isReachable(value: number, minimum: number, step: number): boolean {
  const increments = (value - minimum) / step;
  return Math.abs(increments - Math.round(increments)) < 1e-8;
}

function equipmentIsAvailable(required: Equipment, available: Set<Equipment>): boolean {
  if (required === 'bodyweight') return true;
  if (available.has(required)) return true;
  return available.has('hotel_gym') && hotelGymEquipment.has(required);
}

function expectedUnits(field: WorkoutParameterStepField): WorkoutParameterUnit[] {
  switch (field) {
    case 'sets': return ['sets', 'repetitions'];
    case 'duration.seconds':
    case 'restAfterSec': return ['seconds', 'minutes'];
    case 'duration.repetitions': return ['repetitions'];
    case 'target.rpe': return ['rpe'];
    case 'target.reps_in_reserve': return ['repetitions', 'reps_in_reserve'];
  }
}

function validateBindingUnit(
  parameter: WorkoutParameter,
  binding: WorkoutParameterSetBinding,
  path: string,
  errors: string[]
): void {
  if (binding.kind === 'resolver') {
    if (binding.resolver === 'walk_run_distribution' && parameter.unit !== 'minutes') errors.push(`${path}: walk-run resolver requires minute parameters`);
    if ((binding.resolver === 'embedded_short_surges' || binding.resolver === 'embedded_gap_closing_efforts') && !['sets', 'repetitions'].includes(parameter.unit)) errors.push(`${path}: embedded effort resolver requires a count parameter`);
    if (binding.resolver === 'over_under_internal_pattern' && parameter.unit !== 'seconds') errors.push(`${path}: over-under internal pattern requires seconds`);
    return;
  }

  if (!expectedUnits(binding.field).includes(parameter.unit)) errors.push(`${path}: unit ${parameter.unit} is incompatible with ${binding.field}`);

  const timeField = binding.field === 'duration.seconds' || binding.field === 'restAfterSec';
  if (parameter.unit === 'minutes' && timeField && binding.transform !== 'minutes_to_seconds') errors.push(`${path}: minute parameters require minutes_to_seconds`);
  if (parameter.unit !== 'minutes' && binding.transform === 'minutes_to_seconds') errors.push(`${path}: minutes_to_seconds requires a minute parameter`);

  if (parameter.minimum === 0 && ['sets', 'duration.seconds', 'duration.repetitions'].includes(binding.field) && binding.zeroBehavior === undefined) errors.push(`${path}: a zero minimum requires explicit zeroBehavior`);

  if (binding.field === 'target.rpe' || binding.field === 'target.reps_in_reserve') {
    if (!binding.range) errors.push(`${path}: target range binding is required`);
    if (binding.range) {
      const lower = parameter.minimum + binding.range.minOffset;
      const upper = parameter.maximum + binding.range.maxOffset;
      const validLower = binding.field === 'target.rpe' ? 1 : 0;
      if (lower < validLower || upper > 10 || binding.range.minOffset > binding.range.maxOffset) errors.push(`${path}: resolved target range can leave valid bounds`);
    }
  } else if (binding.range) {
    errors.push(`${path}: range offsets are only valid for target bindings`);
  }
}

function validateParameterBindings(
  workouts: WorkoutDefinition[],
  bindingSets: WorkoutParameterBindingSet[],
  errors: string[]
): void {
  const workoutById = new Map(workouts.map((workout) => [workout.id, workout]));
  const bindingSetByWorkout = new Map<string, WorkoutParameterBindingSet>();

  for (const bindingSet of bindingSets) {
    if (bindingSetByWorkout.has(bindingSet.workoutId)) errors.push(`Duplicate parameter binding set: ${bindingSet.workoutId}`);
    bindingSetByWorkout.set(bindingSet.workoutId, bindingSet);
    if (!workoutById.has(bindingSet.workoutId)) errors.push(`Parameter bindings reference unknown workout ${bindingSet.workoutId}`);
  }

  for (const workout of workouts) {
    const parameters = workout.parameters ?? [];
    const bindingSet = bindingSetByWorkout.get(workout.id);
    if (parameters.length === 0) {
      if (bindingSet && bindingSet.bindings.length > 0) errors.push(`${workout.id}: bindings exist but the workout has no parameters`);
      continue;
    }
    if (!bindingSet) {
      errors.push(`${workout.id}: adjustable workout is missing an explicit parameter binding set`);
      continue;
    }

    const parameterById = new Map(parameters.map((parameter) => [parameter.id, parameter]));
    const boundStepsByParameter = new Map<string, Set<string>>();

    for (const binding of bindingSet.bindings) {
      const parameter = parameterById.get(binding.parameterId);
      const path = `${workout.id}/binding/${binding.parameterId}`;
      if (!parameter) {
        errors.push(`${path}: unknown parameter`);
        continue;
      }
      if (binding.stepIds.length === 0) errors.push(`${path}: at least one step is required`);
      const seen = boundStepsByParameter.get(binding.parameterId) ?? new Set<string>();
      for (const stepId of binding.stepIds) {
        if (seen.has(stepId)) errors.push(`${path}: step ${stepId} is bound more than once`);
        seen.add(stepId);
      }
      boundStepsByParameter.set(binding.parameterId, seen);
      validateBindingUnit(parameter, binding, path, errors);
    }

    for (const parameter of parameters) {
      const declaredSteps = new Set(parameter.appliesToStepIds);
      const boundSteps = boundStepsByParameter.get(parameter.id) ?? new Set<string>();
      for (const stepId of declaredSteps) if (!boundSteps.has(stepId)) errors.push(`${workout.id}/${parameter.id}: step ${stepId} has no explicit binding`);
      for (const stepId of boundSteps) if (!declaredSteps.has(stepId)) errors.push(`${workout.id}/${parameter.id}: binding includes undeclared step ${stepId}`);
    }
  }
}

function validateProgressionGraph(workouts: WorkoutDefinition[], errors: string[]): void {
  const graph = new Map(workouts.map((workout) => [workout.id, workout.progressions]));
  const visiting = new Set<string>();
  const visited = new Set<string>();

  function visit(workoutId: string, path: string[]): void {
    if (visiting.has(workoutId)) {
      const cycleStart = path.indexOf(workoutId);
      errors.push(`Progression cycle: ${[...path.slice(cycleStart), workoutId].join(' -> ')}`);
      return;
    }
    if (visited.has(workoutId)) return;
    visiting.add(workoutId);
    for (const next of graph.get(workoutId) ?? []) visit(next, [...path, workoutId]);
    visiting.delete(workoutId);
    visited.add(workoutId);
  }

  for (const workout of workouts) visit(workout.id, []);
}

export function validateWorkoutLibrary(
  exercises: ExerciseDefinition[],
  workouts: WorkoutDefinition[],
  parameterBindings: WorkoutParameterBindingSet[] = []
): WorkoutLibraryValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const exerciseIds = new Set<string>();
  const exerciseById = new Map<string, ExerciseDefinition>();
  const workoutIds = new Set<string>();

  for (const exercise of exercises) {
    if (exerciseIds.has(exercise.id)) errors.push(`Duplicate exercise id: ${exercise.id}`);
    exerciseIds.add(exercise.id);
    exerciseById.set(exercise.id, exercise);
    validateExerciseFacets(exercise, `exercise ${exercise.id}`, errors);
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
    const availableEquipment = new Set(workout.equipment);
    const usedExerciseIds = new Set<string>();

    if (workout.version < 1) errors.push(`${prefix}: version must be positive`);
    if (workout.duration.minimumMin < 0 || workout.duration.defaultMin < 0 || workout.duration.maximumMin < 0) errors.push(`${prefix}: duration values cannot be negative`);
    if (workout.duration.minimumMin > workout.duration.defaultMin || workout.duration.defaultMin > workout.duration.maximumMin) errors.push(`${prefix}: duration must satisfy minimum <= default <= maximum`);
    if (!isCompleteRest && workout.duration.minimumMin === 0) errors.push(`${prefix}: only complete rest may have a zero-minute minimum duration`);
    if (!Number.isFinite(workout.loadProfile.recoveryHours)) errors.push(`${prefix}: recoveryHours must be finite`);
    if (Number.isFinite(workout.loadProfile.recoveryHours) && workout.loadProfile.recoveryHours < 0) errors.push(`${prefix}: recoveryHours cannot be negative`);
    if (Number.isFinite(workout.loadProfile.recoveryHours) && workout.loadProfile.recoveryHours > 168) errors.push(`${prefix}: recoveryHours cannot exceed 168 hours (7 days)`);
    if (workout.eligibility.minimumDaysAfterHardLowerBody !== undefined) {
      if (!Number.isInteger(workout.eligibility.minimumDaysAfterHardLowerBody) || workout.eligibility.minimumDaysAfterHardLowerBody < 1 || workout.eligibility.minimumDaysAfterHardLowerBody > 7) {
        errors.push(`${prefix}: minimumDaysAfterHardLowerBody must be an integer between 1 and 7`);
      }
    }
    if (workout.blocks.length === 0) errors.push(`${prefix}: at least one workout block is required`);
    if (workout.objectives.length === 0) errors.push(`${prefix}: at least one objective is required`);
    if (workout.sourceNotes.length === 0) warnings.push(`${prefix}: add sourceNotes for coaching provenance`);
    if (workout.category === 'technical_skill') {
      if (!workout.technicalRequirements) {
        errors.push(`${prefix}: technical workouts require technicalRequirements`);
      } else {
        if (workout.technicalRequirements.environment.length === 0) errors.push(`${prefix}: technical workout requires at least one environment`);
        if (workout.technicalRequirements.stopConditions.length === 0) errors.push(`${prefix}: technical workout requires stop conditions`);
      }
      if (workout.objectives.every((objective) => !objective.includes('mechanics') && !objective.startsWith('cycling_'))) {
        errors.push(`${prefix}: technical workout requires a technical objective`);
      }
    }
    if (workout.manualOnly && !workout.technicalRequirements) errors.push(`${prefix}: manual-only workout requires technical safety metadata`);

    const variantIds = new Set(workout.variants.map((variant) => variant.id));
    for (const expectedId of expectedVariantIds) if (!variantIds.has(expectedId as 'full' | 'reduced' | 'return_to_training')) errors.push(`${prefix}: missing ${expectedId} variant`);
    if (variantIds.size !== workout.variants.length) errors.push(`${prefix}: duplicate variant id`);

    const fullVariant = workout.variants.find((variant) => variant.id === 'full');
    const reducedVariant = workout.variants.find((variant) => variant.id === 'reduced');
    const returnVariant = workout.variants.find((variant) => variant.id === 'return_to_training');
    if (workout.status === 'active' && !fullVariant) errors.push(`${prefix}: active workout requires a full variant`);
    if (fullVariant) {
      if (fullVariant.targetDurationMin < workout.duration.minimumMin || fullVariant.targetDurationMin > workout.duration.maximumMin) errors.push(`${prefix}/full: target duration must remain inside the canonical full-workout range`);
      if (fullVariant.targetDurationMin !== workout.duration.defaultMin) warnings.push(`${prefix}/full: target duration differs from canonical defaultMin`);
      if (fullVariant.stepOverrides.length > 0) warnings.push(`${prefix}/full: canonical full variant normally should not need overrides`);
    }
    if (fullVariant && reducedVariant && reducedVariant.targetDurationMin > fullVariant.targetDurationMin) errors.push(`${prefix}: reduced duration cannot exceed full duration`);
    if (reducedVariant && returnVariant && returnVariant.targetDurationMin > reducedVariant.targetDurationMin) errors.push(`${prefix}: return-to-training duration cannot exceed reduced duration`);

    const stepIds = new Set<string>();
    let hasTechnicalTarget = false;
    if (workout.status === 'active' && workout.modality === 'strength' && !workout.manualOnly) {
      const firstBlock = workout.blocks[0];
      if (!firstBlock || firstBlock.role !== 'warmup' || firstBlock.steps.length === 0) {
        errors.push(`${prefix}: active catalog strength workout must begin with a non-empty warmup block`);
      }
      if (!workout.warmupKnowledgeClaimIds?.length) {
        errors.push(`${prefix}: active catalog strength workout must cite warmupKnowledgeClaimIds`);
      } else {
        for (const claimId of workout.warmupKnowledgeClaimIds) {
          try { getActiveKnowledgeClaim(claimId); }
          catch (error) { errors.push(`${prefix}: warmup knowledge claim ${claimId} is not active (${error instanceof Error ? error.message : String(error)})`); }
        }
      }
    }
    for (const block of workout.blocks) {
      if (block.steps.length === 0) errors.push(`${prefix}/${block.id}: block must contain at least one step`);
      for (const step of block.steps) {
        const stepPath = `${prefix}/${block.id}/${step.id}`;
        if (stepIds.has(step.id)) errors.push(`${prefix}: duplicate step id ${step.id}`);
        stepIds.add(step.id);
        usedExerciseIds.add(step.exerciseId);
        const exercise = exerciseById.get(step.exerciseId);
        if (!exercise) {
          errors.push(`${stepPath}: unknown exercise ${step.exerciseId}`);
        } else {
          if (!compatibleExerciseModalities[workout.modality].includes(exercise.modality)) errors.push(`${stepPath}: exercise modality ${exercise.modality} is incompatible with workout modality ${workout.modality}`);
          for (const required of exercise.equipment) if (!equipmentIsAvailable(required, availableEquipment)) errors.push(`${stepPath}: workout equipment does not provide ${required}`);
        }
        if (step.sets !== undefined && step.sets < 1) errors.push(`${stepPath}: sets must be positive`);
        if (step.restAfterSec !== undefined && step.restAfterSec < 0) errors.push(`${stepPath}: restAfterSec cannot be negative`);
        if (step.duration.type === 'time' && step.duration.seconds <= 0) errors.push(`${stepPath}: time duration must be positive`);
        if (step.duration.type === 'distance' && step.duration.meters <= 0) errors.push(`${stepPath}: distance must be positive`);
        if (step.duration.type === 'repetitions' && step.duration.repetitions <= 0) errors.push(`${stepPath}: repetitions must be positive`);
        if (step.load?.kind === 'descriptive' && !step.load.display.trim()) errors.push(`${stepPath}: descriptive load display is required`);
        if ((step.load?.kind === 'percent_one_rm' || step.load?.kind === 'percent_max')
          && (!Number.isFinite(step.load.percent) || step.load.percent <= 0 || step.load.percent > 100)) {
          errors.push(`${stepPath}: percentage load must be finite and between 0 and 100`);
        }
        if (step.target) {
          validateTarget(step.target, stepPath, errors);
          if (step.target.type === 'technical_quality') hasTechnicalTarget = true;
        }
      }
    }
    if (workout.category === 'technical_skill' && !hasTechnicalTarget) errors.push(`${prefix}: technical workout requires a technical-quality target`);

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
      if (parameter.step > 0 && !isReachable(parameter.defaultValue, parameter.minimum, parameter.step)) errors.push(`${parameterPath}: defaultValue is not reachable from minimum by whole steps`);
      if (parameter.step > 0 && !isReachable(parameter.maximum, parameter.minimum, parameter.step)) errors.push(`${parameterPath}: maximum is not reachable from minimum by whole steps`);
      if (parameter.appliesToStepIds.length === 0) errors.push(`${parameterPath}: at least one step reference is required`);
      if (new Set(parameter.appliesToStepIds).size !== parameter.appliesToStepIds.length) errors.push(`${parameterPath}: duplicate step reference`);
      for (const stepId of parameter.appliesToStepIds) if (!stepIds.has(stepId)) errors.push(`${parameterPath}: unknown step ${stepId}`);
      if (parameter.unit === 'rpe' && (parameter.minimum < 1 || parameter.maximum > 10)) errors.push(`${parameterPath}: RPE parameter must remain between 1 and 10`);

      if (!parameter.bindings || parameter.bindings.length === 0) {
        errors.push(`${parameterPath}: explicit parameter bindings array is required`);
      } else {
        const boundStepIds = new Set<string>();
        for (const binding of parameter.bindings) {
          if (!stepIds.has(binding.stepId)) errors.push(`${parameterPath}: binding references unknown step ${binding.stepId}`);
          if (!parameter.appliesToStepIds.includes(binding.stepId)) errors.push(`${parameterPath}: binding step ${binding.stepId} not in appliesToStepIds`);
          boundStepIds.add(binding.stepId);

          if (binding.property === 'sets' && !['sets', 'repetitions'].includes(parameter.unit)) {
            errors.push(`${parameterPath}: unit ${parameter.unit} is incompatible with property ${binding.property}`);
          }
          if ((binding.property === 'duration.seconds' || binding.property === 'restAfterSec') && !['minutes', 'seconds'].includes(parameter.unit)) {
            errors.push(`${parameterPath}: unit ${parameter.unit} is incompatible with property ${binding.property}`);
          }
          if ((binding.property === 'target.rpe.min' || binding.property === 'target.rpe.max') && !['rpe', 'reps_in_reserve', 'repetitions'].includes(parameter.unit)) {
            errors.push(`${parameterPath}: unit ${parameter.unit} is incompatible with property ${binding.property}`);
          }

          if (parameter.minimum === 0 && ['sets', 'duration.seconds', 'restAfterSec'].includes(binding.property) && binding.zeroBehavior === undefined) {
            errors.push(`${parameterPath}: zero minimum requires explicit zeroBehavior for property ${binding.property}`);
          }
        }
        for (const declaredStepId of parameter.appliesToStepIds) {
          if (!boundStepIds.has(declaredStepId)) errors.push(`${parameterPath}: step ${declaredStepId} declared in appliesToStepIds is missing from bindings`);
        }
      }
    }

    for (const variant of workout.variants) {
      let totalSeconds = 0;
      let hasTimeBasedSteps = false;
      const overrideMap = new Map(variant.stepOverrides.map((o) => [o.stepId, o]));
      for (const block of workout.blocks) {
        for (const step of block.steps) {
          const override = overrideMap.get(step.id);
          if (override?.omit) continue;
          const sets = override?.sets ?? step.sets ?? 1;
          const durSec = override?.durationSeconds ?? (step.duration.type === 'time' ? step.duration.seconds : (step.duration.type === 'repetitions' ? 60 : 0));
          if (step.duration.type === 'time') hasTimeBasedSteps = true;
          const restSec = override?.restAfterSec ?? step.restAfterSec ?? 0;
          totalSeconds += (durSec * sets) + (restSec * Math.max(0, sets - 1));
        }
      }
      const computedMin = Math.round(totalSeconds / 60);
      if (workout.id !== 'rest_complete_01' && computedMin > 0 && hasTimeBasedSteps) {
        const diff = Math.abs(computedMin - variant.targetDurationMin);
        if (diff > 15) {
          warnings.push(`${prefix}/${variant.id}: computed step duration (${computedMin}m) differs from targetDurationMin (${variant.targetDurationMin}m) by ${diff}m`);
        }
      }
    }

    for (const relatedId of [...workout.regressions, ...workout.progressions]) {
      if (!workoutIds.has(relatedId)) errors.push(`${prefix}: related workout ${relatedId} does not exist`);
      if (relatedId === workout.id) errors.push(`${prefix}: workout cannot reference itself as progression or regression`);
    }

    for (const substitution of workout.substitutions) {
      if (!usedExerciseIds.has(substitution.exerciseId)) errors.push(`${prefix}: substitution source ${substitution.exerciseId} is not used by the workout`);
      if (!exerciseIds.has(substitution.substituteExerciseId)) errors.push(`${prefix}: substitution target ${substitution.substituteExerciseId} does not exist`);
      if (!substitution.reason.trim()) errors.push(`${prefix}: substitution reason is required`);
    }

    if (workout.garmin.exportable && workout.modality !== 'cycling' && workout.modality !== 'running') errors.push(`${prefix}: only cycling and running workouts may be Garmin-exportable`);
    if (workout.garmin.exportable && workout.garmin.supportedSport !== workout.modality) errors.push(`${prefix}: Garmin supportedSport must match workout modality`);
  }

  validateParameterBindings(workouts, parameterBindings, errors);
  validateProgressionGraph(workouts, errors);

  return { valid: errors.length === 0, errors, warnings };
}
