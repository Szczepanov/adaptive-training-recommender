import type { WorkoutDefinition } from '../models.ts';
import { repsStep, timeStep } from './helpers.ts';

export const STRENGTH_WORKOUTS: WorkoutDefinition[] = [
  {
      id: 'strength_full_body_maintenance_01', version: 1, status: 'active',
      name: 'Primary Full-body Strength Maintenance',
      description: 'Low-fatigue strength session preserving force, Olympic-lift speed and tissue capacity during cycling build.',
      modality: 'strength', category: 'full_body_strength', objectives: ['strength_maintenance', 'power_maintenance', 'tissue_capacity'],
      duration: { defaultMin: 60, minimumMin: 45, maximumMin: 70 },
      loadProfile: { cardiovascular: 2, muscular: 4, mechanical: 3, eccentric: 3, coordination: 4, recoveryHours: 48 },
      eligibility: { minimumReadiness: 6, maximumSoreness: 6, minimumDaysAfterHardLowerBody: 1, forbiddenPainFlags: ['knee_swelling', 'worsening_achilles_pain'] },
      equipment: ['barbell', 'rack', 'bench', 'pullup_bar', 'bodyweight'], contraindicationTags: ['knee_swelling'],
      blocks: [
        { id: 'activation', name: 'Power activation', role: 'activation', steps: [
          repsStep('power_clean', 'hang_power_clean', 'Hang power clean', 3, { sets: 4, restAfterSec: 120, target: { type: 'reps_in_reserve', min: 4, max: 6 }, notes: ['Fast and crisp', 'Stop if speed drops'] })
        ]},
        { id: 'main', name: 'Strength maintenance', role: 'main', steps: [
          repsStep('front_squat', 'front_squat', 'Front squat', 5, { sets: 3, restAfterSec: 150, target: { type: 'reps_in_reserve', min: 3, max: 5 } }),
          repsStep('rdl', 'romanian_deadlift', 'Romanian deadlift', 6, { sets: 3, restAfterSec: 120, target: { type: 'reps_in_reserve', min: 3, max: 5 } }),
          repsStep('bench', 'bench_press', 'Bench press', 6, { sets: 3, restAfterSec: 120, target: { type: 'reps_in_reserve', min: 3, max: 5 } }),
          repsStep('pullup', 'pull_up', 'Pull-up', 5, { sets: 3, restAfterSec: 90, target: { type: 'reps_in_reserve', min: 2, max: 4 } })
        ]},
        { id: 'accessory', name: 'Tissue capacity', role: 'accessory', steps: [
          timeStep('soleus_iso', 'seated_soleus_iso', 'Seated soleus isometric', 25, { sets: 3, restAfterSec: 35 }),
          repsStep('tibialis', 'tibialis_raise', 'Tibialis raise', 15, { sets: 2, restAfterSec: 45 }),
          timeStep('copenhagen', 'copenhagen_plank', 'Copenhagen plank', 20, { sets: 2, restAfterSec: 40 })
        ]}
      ],
      variants: [
        { id: 'full', targetDurationMin: 60, loadMultiplier: 1, rationale: 'Normal weekly force-maintenance dose.', stepOverrides: [] },
        { id: 'reduced', targetDurationMin: 45, loadMultiplier: 0.7, rationale: 'Reduce lower-body sets and preserve upper-body and tissue work.', stepOverrides: [{ stepId: 'front_squat', sets: 2 }, { stepId: 'rdl', sets: 2 }, { stepId: 'power_clean', sets: 3 }] },
        { id: 'return_to_training', targetDurationMin: 35, loadMultiplier: 0.5, rationale: 'Use upper-dominant work and low-load tissue capacity.', stepOverrides: [{ stepId: 'power_clean', omit: true }, { stepId: 'front_squat', omit: true }, { stepId: 'rdl', sets: 2, target: { type: 'reps_in_reserve', min: 5, max: 6 } }, { stepId: 'bench', sets: 2 }, { stepId: 'pullup', sets: 2 }] }
      ],
      regressions: ['strength_compact_power_01'], progressions: [],
      substitutions: [{ exerciseId: 'front_squat', substituteExerciseId: 'rear_foot_elevated_split_squat', reason: 'Use a symptom-free unilateral alternative when equipment or squat tolerance requires it.' }],
      garmin: { exportable: false },
      tags: ['strength', 'low_grind', 'cycling_support'],
      sourceNotes: ['Macrocycle primary strength session is 45–70 minutes, mostly RPE 5–7, no grinding and generally 3–5 repetitions in reserve.']
    },
  {
      id: 'strength_compact_power_01', version: 1, status: 'active',
      name: 'Compact Power and Upper-body Maintenance',
      description: 'Short second strength exposure that preserves explosiveness without reducing cycling quality.',
      modality: 'strength', category: 'power_maintenance', objectives: ['power_maintenance', 'strength_maintenance', 'tissue_capacity'],
      duration: { defaultMin: 35, minimumMin: 25, maximumMin: 45 },
      loadProfile: { cardiovascular: 2, muscular: 3, mechanical: 2, eccentric: 2, coordination: 3, recoveryHours: 30 },
      eligibility: { minimumReadiness: 5, maximumSoreness: 7, forbiddenPainFlags: ['knee_swelling'] },
      equipment: ['medicine_ball', 'bench', 'pullup_bar', 'bodyweight'], contraindicationTags: [],
      blocks: [
        { id: 'activation', name: 'Power', role: 'activation', steps: [
          repsStep('slam', 'medicine_ball_slam', 'Medicine-ball slam', 5, { sets: 4, restAfterSec: 60, target: { type: 'technical_quality', cue: 'Explosive and crisp; stop before fatigue.' } })
        ]},
        { id: 'main', name: 'Upper-body maintenance', role: 'main', steps: [
          repsStep('compact_bench', 'bench_press', 'Bench press', 6, { sets: 3, restAfterSec: 90, target: { type: 'reps_in_reserve', min: 3, max: 5 } }),
          repsStep('compact_pullup', 'pull_up', 'Pull-up', 5, { sets: 3, restAfterSec: 75, target: { type: 'reps_in_reserve', min: 3, max: 5 } })
        ]},
        { id: 'accessory', name: 'Tissue capacity', role: 'accessory', steps: [
          timeStep('compact_soleus', 'seated_soleus_iso', 'Seated soleus isometric', 25, { sets: 3, restAfterSec: 35 }),
          repsStep('compact_tibialis', 'tibialis_raise', 'Tibialis raise', 15, { sets: 2, restAfterSec: 45 })
        ]}
      ],
      variants: [
        { id: 'full', targetDurationMin: 35, loadMultiplier: 1, rationale: 'Normal compact maintenance dose.', stepOverrides: [] },
        { id: 'reduced', targetDurationMin: 25, loadMultiplier: 0.7, rationale: 'Preserve speed and upper-body work with fewer sets.', stepOverrides: [{ stepId: 'slam', sets: 3 }, { stepId: 'compact_bench', sets: 2 }, { stepId: 'compact_pullup', sets: 2 }] },
        { id: 'return_to_training', targetDurationMin: 20, loadMultiplier: 0.5, rationale: 'Keep only easy upper-body and symptom-free capacity work.', stepOverrides: [{ stepId: 'slam', omit: true }, { stepId: 'compact_bench', sets: 2, target: { type: 'reps_in_reserve', min: 5, max: 6 } }, { stepId: 'compact_pullup', sets: 2, target: { type: 'reps_in_reserve', min: 5, max: 6 } }] }
      ],
      regressions: [], progressions: ['strength_full_body_maintenance_01'], substitutions: [],
      garmin: { exportable: false },
      tags: ['compact', 'upper_body', 'power'],
      sourceNotes: ['Macrocycle compact session is optional, 25–45 minutes, and power work must leave the athlete sharper rather than tired.']
    }
];
