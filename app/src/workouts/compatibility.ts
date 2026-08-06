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
  power_maintenance: 'Upper-body Strength',
  field_maintenance: 'Moderate Endurance',
  mobility_recovery: 'Mobility/Recovery'
};

const modalityMap: Record<WorkoutDefinition['modality'], SessionTemplate['modality']> = {
  cycling: 'Cycling',
  running: 'Running',
  strength: 'Strength',
  field: 'Running',
  mobility: 'Mobility',
  recovery: 'Mobility'
};

export function toLegacySessionTemplate(workout: WorkoutDefinition): SessionTemplate {
  const requiredEquipment = Array.from(new Set(
    workout.equipment
      .map((equipment) => legacyEquipmentMap[equipment])
      .filter((equipment): equipment is SessionTemplate['requiredEquipment'][number] => equipment !== undefined)
  ));

  return {
    id: workout.id,
    category: categoryMap[workout.category],
    modality: modalityMap[workout.modality],
    durationMin: workout.duration.minimumMin,
    durationMax: workout.duration.maximumMin,
    title: workout.name,
    description: workout.description,
    requiredEquipment
  };
}
