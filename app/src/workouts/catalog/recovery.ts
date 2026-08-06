import type { WorkoutDefinition } from '../models.ts';
import { repsStep, timeStep } from './helpers.ts';

export const RECOVERY_WORKOUTS: WorkoutDefinition[] = [
  {
      id: 'recovery_mobility_tissue_01', version: 1, status: 'active',
      name: 'Mobility and Lower-leg Capacity',
      description: 'Low-fatigue mobility, breathing and calf/soleus capacity for recovery days or yellow-light adjustments.',
      modality: 'mobility', category: 'mobility_recovery', objectives: ['mobility', 'tissue_capacity', 'active_recovery'],
      duration: { defaultMin: 25, minimumMin: 15, maximumMin: 35 },
      loadProfile: { cardiovascular: 1, muscular: 2, mechanical: 1, eccentric: 1, coordination: 1, recoveryHours: 6 },
      eligibility: { maximumSoreness: 9, forbiddenPainFlags: ['worsening_achilles_pain'] },
      equipment: ['bodyweight', 'bench'], contraindicationTags: ['worsening_achilles_pain'],
      blocks: [
        { id: 'main', name: 'Recovery flow', role: 'main', steps: [
          timeStep('mobility_flow', 'mobility_flow', 'Mobility and breathing flow', 720, { target: { type: 'rpe', min: 1, max: 2 } }),
          timeStep('recovery_soleus', 'seated_soleus_iso', 'Seated soleus isometric', 25, { sets: 4, restAfterSec: 35 }),
          repsStep('recovery_tibialis', 'tibialis_raise', 'Tibialis raise', 15, { sets: 2, restAfterSec: 45 })
        ]}
      ],
      variants: [
        { id: 'full', targetDurationMin: 25, loadMultiplier: 1, rationale: 'Normal low-fatigue recovery and capacity dose.', stepOverrides: [] },
        { id: 'reduced', targetDurationMin: 15, loadMultiplier: 0.65, rationale: 'Short recovery dose for limited time.', stepOverrides: [{ stepId: 'mobility_flow', durationSeconds: 480 }, { stepId: 'recovery_soleus', sets: 3 }] },
        { id: 'return_to_training', targetDurationMin: 15, loadMultiplier: 0.5, rationale: 'Use symptom-free ranges and stop if Achilles symptoms increase.', stepOverrides: [{ stepId: 'mobility_flow', durationSeconds: 600 }, { stepId: 'recovery_soleus', sets: 2 }, { stepId: 'recovery_tibialis', omit: true }] }
      ],
      regressions: [], progressions: ['field_controlled_maintenance_01'], substitutions: [],
      garmin: { exportable: false },
      tags: ['yellow_light', 'mobility', 'calf_capacity'],
      sourceNotes: ['Macrocycle yellow-light options include ROM, isometrics and reduced planned movement; low-fatigue soleus and tibialis work are specifically supported.']
    }
];
