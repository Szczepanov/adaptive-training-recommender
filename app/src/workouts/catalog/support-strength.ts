import type { WorkoutDefinition } from '../models.ts';
import { repsStep } from './helpers.ts';

export const SUPPORT_STRENGTH_WORKOUTS: WorkoutDefinition[] = [
  {
    id: 'strength_upper_body_trunk_01', version: 1, status: 'active',
    name: 'Upper-body and Trunk Maintenance',
    description: 'Lower-body-sparing strength option for yellow-light days, travel, or weeks when cycling quality has priority.',
    modality: 'strength', category: 'power_maintenance', objectives: ['strength_maintenance', 'power_maintenance'],
    duration: { defaultMin: 35, minimumMin: 25, maximumMin: 45 },
    loadProfile: { cardiovascular: 1, muscular: 3, mechanical: 1, eccentric: 2, coordination: 2, recoveryHours: 18 },
    eligibility: { minimumReadiness: 4, maximumSoreness: 8, forbiddenPainFlags: [] },
    equipment: ['bench', 'rack', 'barbell', 'pullup_bar', 'bodyweight'], contraindicationTags: ['acute_shoulder_pain'],
    blocks: [{ id: 'main', name: 'Upper-body strength', role: 'main', steps: [
      repsStep('upper_bench', 'bench_press', 'Bench press', 6, { sets: 3, restAfterSec: 90, target: { type: 'reps_in_reserve', min: 3, max: 6 } }),
      repsStep('upper_pull', 'pull_up', 'Pull-up', 5, { sets: 3, restAfterSec: 75, target: { type: 'reps_in_reserve', min: 3, max: 6 } }),
      repsStep('upper_pushup', 'push_up', 'Push-up', 10, { sets: 2, restAfterSec: 45, target: { type: 'reps_in_reserve', min: 3, max: 6 }, optional: true }),
      repsStep('upper_trunk', 'dead_bug', 'Dead bug', 8, { sets: 3, restAfterSec: 30, target: { type: 'technical_quality', cue: 'Controlled breathing and no trunk compensation.' } })
    ]}],
    variants: [
      { id: 'full', targetDurationMin: 35, loadMultiplier: 1, rationale: 'Normal upper-body and trunk maintenance dose.', stepOverrides: [] },
      { id: 'reduced', targetDurationMin: 25, loadMultiplier: 0.7, rationale: 'Use fewer sets and preserve movement quality.', stepOverrides: [{ stepId: 'upper_bench', sets: 2 }, { stepId: 'upper_pull', sets: 2 }, { stepId: 'upper_pushup', omit: true }, { stepId: 'upper_trunk', sets: 2 }] },
      { id: 'return_to_training', targetDurationMin: 20, loadMultiplier: 0.5, rationale: 'Use easy upper-body and trunk work only.', stepOverrides: [{ stepId: 'upper_bench', sets: 2, target: { type: 'reps_in_reserve', min: 5, max: 7 } }, { stepId: 'upper_pull', sets: 2, target: { type: 'reps_in_reserve', min: 5, max: 7 } }, { stepId: 'upper_pushup', omit: true }, { stepId: 'upper_trunk', sets: 2 }] }
    ],
    parameters: [
      { id: 'working_sets', label: 'Working sets', unit: 'sets', defaultValue: 3, minimum: 2, maximum: 4, step: 1, appliesToStepIds: ['upper_bench', 'upper_pull', 'upper_trunk'], description: 'Adjust volume without adding lower-body fatigue.' },
      { id: 'working_rir', label: 'Repetitions in reserve', unit: 'repetitions', defaultValue: 4, minimum: 3, maximum: 7, step: 1, appliesToStepIds: ['upper_bench', 'upper_pull', 'upper_pushup'], description: 'Keep the session well away from failure.' }
    ],
    regressions: ['rest_complete_01'], progressions: ['strength_compact_power_01'], substitutions: [
      { exerciseId: 'bench_press', substituteExerciseId: 'push_up', reason: 'Use a scalable bodyweight push when equipment or shoulders prefer it.' },
      { exerciseId: 'pull_up', substituteExerciseId: 'dumbbell_row', reason: 'Use a supported row when a pull-up bar is unavailable.' }
    ],
    garmin: { exportable: false },
    tags: ['upper_body', 'trunk', 'yellow_light', 'adjustable'],
    sourceNotes: ['Covers upper-body or trunk-only training when lower-body loading would interfere with cycling or tissue recovery.']
  }
];
