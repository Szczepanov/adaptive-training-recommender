import type { WorkoutDefinition } from '../models.ts';
import { repsStep, timeStep } from './helpers.ts';

export const LOWER_BODY_STRENGTH_WORKOUTS: WorkoutDefinition[] = [
  {
    id: 'strength_lower_body_01', version: 2, status: 'active',
    name: 'Lower-body Strength and Power',
    description: 'Lower-body force, power, and tissue-capacity work without upper-body pressing or pulling.',
    modality: 'strength', category: 'full_body_strength', objectives: ['strength_maintenance', 'power_maintenance', 'tissue_capacity'],
    duration: { defaultMin: 55, minimumMin: 25, maximumMin: 65 },
    loadProfile: { cardiovascular: 2, muscular: 4, mechanical: 4, eccentric: 4, coordination: 4, recoveryHours: 48 },
    eligibility: { minimumReadiness: 6, maximumSoreness: 5, minimumDaysAfterHardLowerBody: 1, forbiddenPainFlags: ['acute_hamstring_pain', 'knee_swelling', 'worsening_achilles_pain', 'painful_deep_knee_flexion'] },
    equipment: ['barbell', 'rack', 'dumbbells', 'bench', 'bodyweight'], contraindicationTags: ['acute_hamstring_pain', 'knee_swelling', 'worsening_achilles_pain', 'painful_deep_knee_flexion'], engineTemplateIds: ['str_lower_01'], warmupKnowledgeClaimIds: ['strength.warmup.contextual_preparation', 'strength.warmup.specific_rehearsal'],
    blocks: [
      { id: 'warmup', name: 'Warm-up and clean rehearsal', role: 'warmup', steps: [
        repsStep('lower_warmup_squat', 'bodyweight_squat', 'Bodyweight squat', 8, { load: { kind: 'bodyweight' }, notes: ['Use a comfortable depth.'] }),
        repsStep('lower_warmup_hinge', 'bodyweight_hip_hinge', 'Bodyweight hip hinge', 8, { load: { kind: 'bodyweight' } }),
        repsStep('lower_warmup_clean_ramp', 'hang_power_clean', 'Hang power clean rehearsal', 3, { sets: 2, restAfterSec: 60, load: { kind: 'descriptive', display: 'Empty bar, then light rehearsal load' }, notes: ['Rehearse positions; stop before fatigue.'] })
      ]},
      { id: 'activation', name: 'Power activation', role: 'activation', steps: [
        repsStep('lower_power_clean', 'hang_power_clean', 'Hang power clean', 3, { sets: 3, restAfterSec: 120, target: { type: 'reps_in_reserve', min: 4, max: 6 }, notes: ['Fast and crisp; stop if speed drops.'] })
      ] },
      { id: 'main', name: 'Lower-body strength', role: 'main', steps: [
        repsStep('lower_front_squat', 'front_squat', 'Front squat', 5, { sets: 3, restAfterSec: 150, target: { type: 'reps_in_reserve', min: 3, max: 5 } }),
        repsStep('lower_split_squat', 'rear_foot_elevated_split_squat', 'Rear-foot elevated split squat', 6, { sets: 3, restAfterSec: 90, target: { type: 'reps_in_reserve', min: 3, max: 5 } }),
        repsStep('lower_rdl', 'romanian_deadlift', 'Romanian deadlift', 6, { sets: 3, restAfterSec: 120, target: { type: 'reps_in_reserve', min: 3, max: 5 } })
      ] },
      { id: 'accessory', name: 'Tissue capacity', role: 'accessory', steps: [
        timeStep('lower_soleus', 'seated_soleus_iso', 'Seated soleus isometric', 25, { sets: 3, restAfterSec: 35 }),
        repsStep('lower_tibialis', 'tibialis_raise', 'Tibialis raise', 15, { sets: 2, restAfterSec: 45 }),
        timeStep('lower_copenhagen', 'copenhagen_plank', 'Copenhagen plank', 20, { sets: 2, restAfterSec: 40 }),
        repsStep('lower_nordic', 'nordic_hamstring_curl', 'Nordic hamstring curl', 4, { sets: 2, restAfterSec: 75, optional: true }),
        repsStep('lower_heel_raise', 'eccentric_heel_raise', 'Eccentric heel raise', 8, { sets: 2, restAfterSec: 45, optional: true })
      ] }
    ],
    variants: [
      { id: 'full', targetDurationMin: 55, loadMultiplier: 1, rationale: 'Normal lower-body force and tissue-capacity dose.', stepOverrides: [] },
      { id: 'reduced', targetDurationMin: 40, loadMultiplier: 0.7, rationale: 'Reduce main-lift volume while retaining capacity work.', stepOverrides: [{ stepId: 'lower_power_clean', sets: 2 }, { stepId: 'lower_front_squat', sets: 2 }, { stepId: 'lower_split_squat', sets: 2 }, { stepId: 'lower_rdl', sets: 2 }] },
      { id: 'return_to_training', targetDurationMin: 25, loadMultiplier: 0.5, rationale: 'Use only low-volume, symptom-free lower-body work.', stepOverrides: [{ stepId: 'lower_warmup_clean_ramp', omit: true }, { stepId: 'lower_power_clean', omit: true }, { stepId: 'lower_front_squat', omit: true }, { stepId: 'lower_split_squat', sets: 2, target: { type: 'reps_in_reserve', min: 5, max: 6 } }, { stepId: 'lower_rdl', sets: 2, target: { type: 'reps_in_reserve', min: 5, max: 6 } }, { stepId: 'lower_nordic', omit: true }, { stepId: 'lower_heel_raise', omit: true }] }
    ],
    regressions: ['strength_compact_power_01'], progressions: [], substitutions: [],
    garmin: { exportable: false }, tags: ['strength', 'lower_body', 'power'],
    sourceNotes: ['Lower-body strength session uses non-grinding compound work with controlled posterior-chain and calf capacity accessories.']
  }
];
