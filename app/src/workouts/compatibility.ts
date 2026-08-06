import type { SessionTemplate } from '../engine/models.ts';
import type { Equipment, WorkoutDefinition } from './models.ts';

const legacyEquipmentMap: Partial<Record<Equipment, SessionTemplate['requiredEquipment'][number]>> = {
  indoor_bike: 'indoor_bike',
  treadmill: 'treadmill',
  barbell: 'free_weights',
  dumbbells: 'free_weights',
  kettlebell: 'free_weights'
};

const categoryMap: Record<WorkoutDefinition['category'], SessionTemplate['category']> = {
  recovery: 'Mobility/Recovery',
  easy_endurance: 'Easy Endurance',
  threshold: 'Hard Endurance',
  over_under: 'Hard Endurance',
  surge_tolerance: 'Hard Endurance',
  race_simulation: 'Hard Endurance',
  full_body_strength: 'Full-body Strength',
  power_maintenance: 'Power Maintenance',
  field_maintenance: 'Field Maintenance',
  mobility_recovery: 'Mobility/Recovery'
};

const modalityMap: Record<WorkoutDefinition['modality'], SessionTemplate['modality']> = {
  cycling: 'Cycling',
  running: 'Running',
  strength: 'Strength',
  field: 'Field',
  mobility: 'Mobility',
  recovery: 'Mobility',
  cross_training: 'Cross Training'
};

export function toLegacySessionTemplate(workout: WorkoutDefinition): SessionTemplate {
  const requiredEquipment = Array.from(new Set(
    workout.equipment
      .map((equipment) => legacyEquipmentMap[equipment])
      .filter((equipment): equipment is SessionTemplate['requiredEquipment'][number] => equipment !== undefined)
  ));
  const isCompleteRest = workout.id === 'rest_complete_01';

  return {
    id: workout.id,
    category: isCompleteRest ? 'Rest' : categoryMap[workout.category],
    modality: isCompleteRest ? 'None' : modalityMap[workout.modality],
    durationMin: workout.duration.minimumMin,
    durationMax: workout.duration.maximumMin,
    title: workout.name,
    description: workout.description,
    requiredEquipment
  };
}
