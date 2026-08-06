import type { WorkoutDefinition } from '../models.ts';
import { repsStep, timeStep } from './helpers.ts';

export const TRAVEL_WORKOUTS: WorkoutDefinition[] = [
  {
    id: 'travel_aerobic_maintenance_01', version: 1, status: 'active',
    name: 'Travel Aerobic Maintenance',
    description: 'Generic hotel-machine aerobic session using RPE and breathing rather than machine-specific watts.',
    modality: 'cross_training', category: 'easy_endurance', objectives: ['aerobic_base', 'travel_maintenance'],
    duration: { defaultMin: 40, minimumMin: 30, maximumMin: 45 },
    loadProfile: { cardiovascular: 2, muscular: 2, mechanical: 1, eccentric: 1, coordination: 1, recoveryHours: 16 },
    eligibility: { maximumSoreness: 7, forbiddenPainFlags: ['knee_swelling', 'worsening_achilles_pain'] },
    equipment: ['hotel_gym'], contraindicationTags: ['acute_knee_pain'],
    blocks: [
      { id: 'warmup', name: 'Easy start', role: 'warmup', steps: [ timeStep('travel_aerobic_warmup', 'aerobic_machine_easy', 'Easy machine warm-up', 480, { target: { type: 'rpe', min: 1, max: 2 } }) ]},
      { id: 'main', name: 'Aerobic maintenance', role: 'main', steps: [ timeStep('travel_aerobic_main', 'aerobic_machine_easy', 'Steady aerobic work', 1440, { target: { type: 'rpe', min: 2, max: 4 }, notes: ['Use any available aerobic machine', 'Do not compare machine watts with another device'] }) ]},
      { id: 'cooldown', name: 'Easy finish', role: 'cooldown', steps: [ timeStep('travel_aerobic_cooldown', 'aerobic_machine_easy', 'Easy cool-down', 480, { target: { type: 'rpe', min: 1, max: 2 } }) ]}
    ],
    variants: [
      { id: 'full', targetDurationMin: 40, loadMultiplier: 1, rationale: 'Normal travel aerobic maintenance dose.', stepOverrides: [] },
      { id: 'reduced', targetDurationMin: 30, loadMultiplier: 0.7, rationale: 'Shorten when travel or walking has already added load.', stepOverrides: [{ stepId: 'travel_aerobic_main', durationSeconds: 900 }, { stepId: 'travel_aerobic_cooldown', durationSeconds: 420 }] },
      { id: 'return_to_training', targetDurationMin: 25, loadMultiplier: 0.5, rationale: 'Keep the session purely easy and symptom-free.', stepOverrides: [{ stepId: 'travel_aerobic_main', durationSeconds: 720, target: { type: 'rpe', min: 1, max: 3 } }, { stepId: 'travel_aerobic_cooldown', durationSeconds: 300 }] }
    ],
    parameters: [
      { id: 'aerobic_duration', label: 'Steady aerobic duration', unit: 'minutes', defaultValue: 24, minimum: 15, maximum: 30, step: 5, appliesToStepIds: ['travel_aerobic_main'], description: 'Adjust around sightseeing, travel fatigue and available time.' },
      { id: 'aerobic_rpe', label: 'Aerobic RPE', unit: 'rpe', defaultValue: 3, minimum: 2, maximum: 4, step: 0.5, appliesToStepIds: ['travel_aerobic_main'], description: 'Machine-independent effort control.' }
    ],
    regressions: ['rest_complete_01'], progressions: ['cycling_zone2_standard_01'], substitutions: [],
    garmin: { exportable: false },
    tags: ['travel', 'hotel', 'machine_independent', 'adjustable'],
    sourceNotes: ['Covers the planned 30–45-minute aerobic hotel session during travel.']
  },
  {
    id: 'travel_strength_maintenance_01', version: 1, status: 'active',
    name: 'Travel Strength Maintenance',
    description: 'Adjustable hotel-gym circuit preserving strength and tissue capacity without creating soreness.',
    modality: 'strength', category: 'full_body_strength', objectives: ['strength_maintenance', 'tissue_capacity', 'travel_maintenance'],
    duration: { defaultMin: 35, minimumMin: 25, maximumMin: 40 },
    loadProfile: { cardiovascular: 2, muscular: 3, mechanical: 2, eccentric: 2, coordination: 2, recoveryHours: 24 },
    eligibility: { minimumReadiness: 5, maximumSoreness: 7, forbiddenPainFlags: ['knee_swelling'] },
    equipment: ['hotel_gym'], contraindicationTags: ['knee_swelling'],
    blocks: [
      { id: 'main', name: 'Adjustable maintenance circuit', role: 'main', steps: [
        repsStep('travel_squat', 'goblet_squat', 'Goblet squat or comfortable squat pattern', 8, { sets: 3, restAfterSec: 60, target: { type: 'reps_in_reserve', min: 4, max: 6 } }),
        repsStep('travel_push', 'push_up', 'Push-up or machine press', 10, { sets: 3, restAfterSec: 45, target: { type: 'reps_in_reserve', min: 3, max: 6 } }),
        repsStep('travel_pull', 'dumbbell_row', 'Dumbbell or machine row', 10, { sets: 3, restAfterSec: 45, target: { type: 'reps_in_reserve', min: 3, max: 6 } }),
        repsStep('travel_trunk', 'dead_bug', 'Dead bug', 8, { sets: 3, restAfterSec: 30, target: { type: 'technical_quality', cue: 'Quiet trunk and controlled breathing.' } }),
        timeStep('travel_soleus', 'seated_soleus_iso', 'Soleus isometric', 25, { sets: 3, restAfterSec: 35, optional: true })
      ]}
    ],
    variants: [
      { id: 'full', targetDurationMin: 35, loadMultiplier: 1, rationale: 'Normal hotel-gym maintenance circuit.', stepOverrides: [] },
      { id: 'reduced', targetDurationMin: 25, loadMultiplier: 0.7, rationale: 'Use two rounds and preserve easy movement quality.', stepOverrides: [{ stepId: 'travel_squat', sets: 2 }, { stepId: 'travel_push', sets: 2 }, { stepId: 'travel_pull', sets: 2 }, { stepId: 'travel_trunk', sets: 2 }, { stepId: 'travel_soleus', sets: 2 }] },
      { id: 'return_to_training', targetDurationMin: 20, loadMultiplier: 0.5, rationale: 'Use upper body, trunk and optional symptom-free lower work only.', stepOverrides: [{ stepId: 'travel_squat', omit: true }, { stepId: 'travel_push', sets: 2, target: { type: 'reps_in_reserve', min: 5, max: 7 } }, { stepId: 'travel_pull', sets: 2, target: { type: 'reps_in_reserve', min: 5, max: 7 } }, { stepId: 'travel_trunk', sets: 2 }, { stepId: 'travel_soleus', sets: 2 }] }
    ],
    parameters: [
      { id: 'circuit_rounds', label: 'Circuit rounds', unit: 'sets', defaultValue: 3, minimum: 2, maximum: 4, step: 1, appliesToStepIds: ['travel_squat', 'travel_push', 'travel_pull', 'travel_trunk'], description: 'Adjust total work to walking and travel load.' },
      { id: 'working_repetitions', label: 'Working repetitions', unit: 'repetitions', defaultValue: 10, minimum: 6, maximum: 12, step: 1, appliesToStepIds: ['travel_squat', 'travel_push', 'travel_pull'], description: 'Use smooth repetitions and stop well before failure.' },
      { id: 'strength_rir', label: 'Repetitions in reserve', unit: 'repetitions', defaultValue: 4, minimum: 3, maximum: 7, step: 1, appliesToStepIds: ['travel_squat', 'travel_push', 'travel_pull'], description: 'Higher values keep the session low-fatigue.' }
    ],
    regressions: ['strength_upper_body_trunk_01'], progressions: ['strength_full_body_maintenance_01'],
    substitutions: [
      { exerciseId: 'goblet_squat', substituteExerciseId: 'rear_foot_elevated_split_squat', reason: 'Use a symptom-free unilateral option if it is better tolerated and equipment allows.' },
      { exerciseId: 'push_up', substituteExerciseId: 'bench_press', reason: 'Use a light machine or bench press when available.' },
      { exerciseId: 'dumbbell_row', substituteExerciseId: 'pull_up', reason: 'Use a controlled vertical pull when available.' }
    ],
    garmin: { exportable: false },
    tags: ['travel', 'hotel', 'full_body', 'adjustable', 'low_soreness'],
    sourceNotes: ['Covers the planned 25–40-minute hotel-gym maintenance session during travel.']
  }
];
