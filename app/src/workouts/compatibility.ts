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

// Mirrors the systemicCost scale used by app/src/engine/templates.ts (0 = none, 1 =
// maximal whole-body/autonomic cost), so rules.ts's MODIFY_MAX_SYSTEMIC_COST behaves
// consistently regardless of which template source produced a given SessionTemplate.
const systemicCostMap: Record<SessionTemplate['category'], number> = {
  'Rest': 0.0,
  'Mobility/Recovery': 0.1,
  'Easy Endurance': 0.3,
  'Upper-body Strength': 0.3,
  'Lower-body Strength': 0.6,
  'Full-body Strength': 0.6,
  'Moderate Endurance': 0.7,
  'Field Maintenance': 0.65,
  'Power Maintenance': 0.75,
  'Hard Endurance': 1.0
};

export function toLegacySessionTemplate(workout: WorkoutDefinition): SessionTemplate {
  const requiredEquipment = Array.from(new Set(
    workout.equipment
      .map((equipment) => legacyEquipmentMap[equipment])
      .filter((equipment): equipment is SessionTemplate['requiredEquipment'][number] => equipment !== undefined)
  ));
  const isCompleteRest = workout.id === 'rest_complete_01';
  const category = isCompleteRest ? 'Rest' : categoryMap[workout.category];

  return {
    id: workout.id,
    category,
    modality: isCompleteRest ? 'None' : modalityMap[workout.modality],
    durationMin: workout.duration.minimumMin,
    durationMax: workout.duration.maximumMin,
    title: workout.name,
    description: workout.description,
    requiredEquipment,
    systemicCost: systemicCostMap[category]
  };
}
