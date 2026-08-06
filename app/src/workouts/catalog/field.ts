import type { WorkoutDefinition } from '../models.ts';
import { repsStep, timeStep } from './helpers.ts';

export const FIELD_WORKOUTS: WorkoutDefinition[] = [
  {
      id: 'field_controlled_maintenance_01', version: 1, status: 'active',
      name: 'Controlled Field and Football Maintenance',
      description: 'Low-frequency exposure to acceleration, braking, cutting and ball skill without chaotic fatigue.',
      modality: 'field', category: 'field_maintenance', objectives: ['acceleration', 'braking', 'change_of_direction', 'football_skill', 'tissue_capacity'],
      duration: { defaultMin: 40, minimumMin: 25, maximumMin: 50 },
      loadProfile: { cardiovascular: 3, muscular: 3, mechanical: 4, eccentric: 4, coordination: 5, recoveryHours: 48 },
      eligibility: { minimumReadiness: 7, maximumSoreness: 4, minimumDaysAfterHardLowerBody: 2, forbiddenPainFlags: ['knee_swelling', 'instability', 'worsening_achilles_pain', 'painful_braking'] },
      equipment: ['field', 'cones'], contraindicationTags: ['knee_swelling', 'worsening_achilles_pain'],
      blocks: [
        { id: 'warmup', name: 'Field warm-up', role: 'warmup', steps: [
          timeStep('field_warmup', 'field_dynamic_warmup', 'Dynamic warm-up', 720, { target: { type: 'rpe', min: 2, max: 4 } })
        ]},
        { id: 'main', name: 'Controlled movement exposure', role: 'main', steps: [
          repsStep('accels', 'acceleration_10m', '10 m acceleration', 1, { sets: 6, restAfterSec: 60, target: { type: 'technical_quality', cue: 'Smooth acceleration at approximately 70–85%, balanced finish.' } }),
          repsStep('decelerations', 'controlled_deceleration', 'Controlled deceleration', 1, { sets: 6, restAfterSec: 60, target: { type: 'technical_quality', cue: 'Planned braking steps and quiet knee alignment.' } }),
          repsStep('cuts', 'change_of_direction_45', '45-degree change of direction', 1, { sets: 6, restAfterSec: 60, target: { type: 'technical_quality', cue: 'Pre-planned cut at controlled speed.' } }),
          timeStep('ball_skill', 'ball_dribbling', 'Ball skill and family play', 600, { target: { type: 'rpe', min: 2, max: 4 }, notes: ['Avoid chaotic competitive fatigue', 'Session passes only if later-day and next-morning response remain normal'] })
        ]}
      ],
      variants: [
        { id: 'full', targetDurationMin: 40, loadMultiplier: 1, rationale: 'Normal maintenance exposure every 7–10 days.', stepOverrides: [] },
        { id: 'reduced', targetDurationMin: 30, loadMultiplier: 0.65, rationale: 'Reduce repetitions and keep all movement pre-planned.', stepOverrides: [{ stepId: 'accels', sets: 4 }, { stepId: 'decelerations', sets: 4 }, { stepId: 'cuts', sets: 4 }, { stepId: 'ball_skill', durationSeconds: 360 }] },
        { id: 'return_to_training', targetDurationMin: 22, loadMultiplier: 0.45, rationale: 'Use warm-up, easy ball skill and submaximal accelerations only.', stepOverrides: [{ stepId: 'accels', sets: 3, target: { type: 'technical_quality', cue: 'Approximately 60–70%, smooth and symptom-free.' } }, { stepId: 'decelerations', omit: true }, { stepId: 'cuts', omit: true }, { stepId: 'ball_skill', durationSeconds: 360 }] }
      ],
      regressions: ['recovery_mobility_tissue_01'], progressions: [], substitutions: [],
      garmin: { exportable: false },
      tags: ['field', 'football', 'controlled', 'mechanical_load'],
      sourceNotes: ['Macrocycle football exposure is approximately every 7–10 days; unrestricted 90–120 minute play is not required before the race.']
    }
];
