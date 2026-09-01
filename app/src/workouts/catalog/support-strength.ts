import type { WorkoutDefinition } from '../models.ts';
import { repsStep } from './helpers.ts';

export const SUPPORT_STRENGTH_WORKOUTS: WorkoutDefinition[] = [
  {
    id: 'strength_upper_body_trunk_01', version: 2, status: 'active',
    name: 'Upper-body and Trunk Maintenance',
    description: 'Lower-body-sparing strength option for yellow-light days, travel, or weeks when cycling quality has priority.',
    modality: 'strength', category: 'power_maintenance', objectives: ['strength_maintenance', 'power_maintenance'],
    duration: { defaultMin: 35, minimumMin: 20, maximumMin: 45 },
    loadProfile: { cardiovascular: 1, muscular: 3, mechanical: 1, eccentric: 2, coordination: 2, recoveryHours: 18 },
    eligibility: { minimumReadiness: 4, maximumSoreness: 8, forbiddenPainFlags: [] },
    equipment: ['bench', 'rack', 'barbell', 'pullup_bar', 'bodyweight'], contraindicationTags: ['acute_shoulder_pain'], warmupKnowledgeClaimIds: ['strength.warmup.contextual_preparation', 'strength.warmup.specific_rehearsal'],
    blocks: [{ id: 'warmup', name: 'Shoulder and press rehearsal', role: 'warmup', steps: [
      repsStep('upper_warmup_scapula', 'scapular_push_up', 'Scapular push-up', 8, { load: { kind: 'bodyweight' } }),
      repsStep('upper_warmup_pushup', 'push_up', 'Easy push-up rehearsal', 5, { load: { kind: 'bodyweight' }, notes: ['Leave plenty in reserve.'] })
    ]}, { id: 'main', name: 'Upper-body strength', role: 'main', steps: [
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
      { id: 'working_sets', label: 'Working sets', unit: 'sets', defaultValue: 3, minimum: 2, maximum: 4, step: 1, appliesToStepIds: ['upper_bench', 'upper_pull', 'upper_trunk'], bindings: [{ stepId: 'upper_bench', property: 'sets' }, { stepId: 'upper_pull', property: 'sets' }, { stepId: 'upper_trunk', property: 'sets' }], description: 'Adjust volume without adding lower-body fatigue.' },
      { id: 'working_rir', label: 'Repetitions in reserve', unit: 'repetitions', defaultValue: 4, minimum: 3, maximum: 7, step: 1, appliesToStepIds: ['upper_bench', 'upper_pull', 'upper_pushup'], bindings: [{ stepId: 'upper_bench', property: 'target.rpe.max' }, { stepId: 'upper_pull', property: 'target.rpe.max' }, { stepId: 'upper_pushup', property: 'target.rpe.max' }], description: 'Keep the session well away from failure.' }
    ],
    regressions: ['rest_complete_01'], progressions: ['strength_compact_power_01'], substitutions: [
      { exerciseId: 'bench_press', substituteExerciseId: 'push_up', reason: 'Use a scalable bodyweight push when equipment or shoulders prefer it.' },
      { exerciseId: 'pull_up', substituteExerciseId: 'dumbbell_row', reason: 'Use a supported row when a pull-up bar is unavailable.' }
    ],
    garmin: { exportable: false },
    tags: ['upper_body', 'trunk', 'yellow_light', 'adjustable'],
    sourceNotes: ['Covers upper-body or trunk-only training when lower-body loading would interfere with cycling or tissue recovery.']
  },
  {
    id: 'strength_cable_upper_01', version: 2, status: 'active', name: 'Cable Upper-body Circuit', description: 'Controlled cable pressing and rowing for joint-friendly upper-body volume.',
    modality: 'strength', category: 'power_maintenance', objectives: ['strength_maintenance'], duration: { defaultMin: 35, minimumMin: 20, maximumMin: 50 }, loadProfile: { cardiovascular: 2, muscular: 3, mechanical: 1, eccentric: 2, coordination: 2, recoveryHours: 18 },
    eligibility: { minimumReadiness: 4, maximumSoreness: 8, forbiddenPainFlags: [] }, equipment: ['cable_machine'], contraindicationTags: ['acute_shoulder_pain'], engineTemplateIds: ['str_upper_02'], warmupKnowledgeClaimIds: ['strength.warmup.contextual_preparation', 'strength.warmup.specific_rehearsal'],
    blocks: [{ id: 'warmup', name: 'Cable press and row rehearsal', role: 'warmup', steps: [repsStep('cable_warmup_press', 'cable_chest_press', 'Easy cable chest press', 8, { load: { kind: 'descriptive', display: 'Very light rehearsal load' }, notes: ['Move smoothly and stay well below fatigue.'] }), repsStep('cable_warmup_row', 'cable_row', 'Easy cable row', 8, { load: { kind: 'descriptive', display: 'Very light rehearsal load' } })] }, { id: 'main', name: 'Cable circuit', role: 'main', steps: [repsStep('cable_press', 'cable_chest_press', 'Cable chest press', 10, { sets: 3, restAfterSec: 60, target: { type: 'reps_in_reserve', min: 3, max: 5 } }), repsStep('cable_row', 'cable_row', 'Cable row', 10, { sets: 3, restAfterSec: 60, target: { type: 'reps_in_reserve', min: 3, max: 5 } })] }],
    variants: [{ id: 'full', targetDurationMin: 35, loadMultiplier: 1, rationale: 'Three controlled circuit rounds.', stepOverrides: [] }, { id: 'reduced', targetDurationMin: 25, loadMultiplier: 0.7, rationale: 'Two circuit rounds.', stepOverrides: [{ stepId: 'cable_press', sets: 2 }, { stepId: 'cable_row', sets: 2 }] }, { id: 'return_to_training', targetDurationMin: 20, loadMultiplier: 0.5, rationale: 'Low-load symptom-free circuit.', stepOverrides: [{ stepId: 'cable_press', sets: 2, target: { type: 'reps_in_reserve', min: 5, max: 7 } }, { stepId: 'cable_row', sets: 2, target: { type: 'reps_in_reserve', min: 5, max: 7 } }] }],
    regressions: ['strength_upper_body_trunk_01'], progressions: [], substitutions: [], garmin: { exportable: false }, tags: ['upper_body', 'cable'], sourceNotes: ['Cable work provides controlled upper-body volume without adding lower-body fatigue.']
  }
];
