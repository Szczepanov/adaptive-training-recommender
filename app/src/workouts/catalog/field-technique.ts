import type { WorkoutDefinition } from '../models.ts';
import { repsStep, timeStep } from './helpers.ts';

export const FIELD_TECHNIQUE_WORKOUTS: WorkoutDefinition[] = [
  {
    id: 'field_sprint_mechanics_foundation_01', version: 1, status: 'active',
    name: 'Sprint Mechanics Foundation',
    description: 'A low-volume acceleration mechanics session. It develops posture, projection and rhythm without turning speed work into conditioning.',
    modality: 'field', category: 'technical_skill', objectives: ['sprint_mechanics', 'acceleration_mechanics'],
    duration: { defaultMin: 30, minimumMin: 20, maximumMin: 40 },
    loadProfile: { cardiovascular: 2, muscular: 2, mechanical: 3, eccentric: 2, coordination: 5, recoveryHours: 30 },
    eligibility: { minimumReadiness: 6, maximumSoreness: 4, minimumDaysAfterHardLowerBody: 1, forbiddenPainFlags: ['acute_hamstring_pain', 'worsening_achilles_pain', 'knee_swelling'] },
    equipment: ['field', 'cones'], contraindicationTags: ['acute_hamstring_pain', 'worsening_achilles_pain', 'knee_swelling'],
    technicalRequirements: { environment: ['field'], supervision: 'recommended', stopConditions: ['Stop if calf, Achilles, hamstring or knee symptoms appear.', 'Stop when posture, foot strike or acceleration rhythm deteriorates.'] },
    engineTemplateIds: ['field_technical_01'],
    blocks: [
      { id: 'warmup', name: 'Warm-up', role: 'warmup', steps: [timeStep('sprint_warmup', 'field_dynamic_warmup', 'Dynamic warm-up', 600, { target: { type: 'rpe', min: 2, max: 3 } })] },
      { id: 'drills', name: 'Mechanics drills', role: 'activation', steps: [
        repsStep('wall_drives', 'sprint_wall_drive', 'Wall drives', 5, { sets: 2, restAfterSec: 30, target: { type: 'technical_quality', cue: 'Straight line and forceful knee drive.', successCriteria: ['Ribs remain stacked over pelvis.', 'Foot contacts under the hips.'], commonFaults: ['Arching the back or reaching with the foot.'], stopConditions: ['Stop if the calf or hamstring feels sharp.'] } }),
        timeStep('a_march', 'sprint_a_march', 'A-march', 20, { sets: 2, restAfterSec: 40, target: { type: 'technical_quality', cue: 'Tall posture and quiet contacts.', successCriteria: ['Dorsiflexed ankle.', 'No forward reach.'] } })
      ] },
      { id: 'main', name: 'Acceleration quality', role: 'main', steps: [
        repsStep('falling_starts', 'sprint_falling_start_10m', 'Falling-start acceleration', 1, { sets: 6, restAfterSec: 75, target: { type: 'technical_quality', cue: 'Accelerate at approximately 70–80%, then walk back fully recovered.', successCriteria: ['Smooth forward projection.', 'Balanced finish without braking.'], commonFaults: ['Forcing maximal effort or popping upright early.'], stopConditions: ['End the set when a rep is not technically repeatable.'] } })
      ] }
    ],
    variants: [
      { id: 'full', targetDurationMin: 30, loadMultiplier: 1, rationale: 'Full low-volume mechanics exposure.', stepOverrides: [] },
      { id: 'reduced', targetDurationMin: 24, loadMultiplier: 0.7, rationale: 'Keep drills and reduce acceleration contacts.', stepOverrides: [{ stepId: 'falling_starts', sets: 4 }] },
      { id: 'return_to_training', targetDurationMin: 20, loadMultiplier: 0.45, rationale: 'Use drills and only easy symptom-free starts.', stepOverrides: [{ stepId: 'falling_starts', sets: 3, target: { type: 'technical_quality', cue: 'Approximately 60–70%, smooth and symptom-free.', stopConditions: ['Stop at the first change in lower-leg mechanics.'] } }] }
    ],
    regressions: ['recovery_mobility_tissue_01'], progressions: ['field_acceleration_braking_01'], substitutions: [],
    garmin: { exportable: false }, tags: ['sprint', 'technique', 'low_volume', 'field'],
    sourceNotes: ['Technical speed work uses long recovery and ends before fatigue changes mechanics.']
  },
  {
    id: 'field_acceleration_braking_01', version: 1, status: 'active',
    name: 'Acceleration and Braking Skill',
    description: 'A progression from sprint mechanics into controlled acceleration and deceleration, with quality protected by full recovery.',
    modality: 'field', category: 'technical_skill', objectives: ['acceleration_mechanics', 'deceleration_mechanics'],
    duration: { defaultMin: 35, minimumMin: 25, maximumMin: 45 },
    loadProfile: { cardiovascular: 2, muscular: 3, mechanical: 4, eccentric: 4, coordination: 5, recoveryHours: 42 },
    eligibility: { minimumReadiness: 7, maximumSoreness: 3, minimumDaysAfterHardLowerBody: 2, forbiddenPainFlags: ['acute_hamstring_pain', 'worsening_achilles_pain', 'knee_swelling', 'painful_braking'] },
    equipment: ['field', 'cones'], contraindicationTags: ['acute_hamstring_pain', 'worsening_achilles_pain', 'knee_swelling', 'painful_braking'],
    technicalRequirements: { environment: ['field'], supervision: 'recommended', prerequisiteSkills: ['Sprint Mechanics Foundation completed without symptoms.'], stopConditions: ['Stop with any pain or instability.', 'End the session when braking cannot finish balanced.'] },
    engineTemplateIds: ['field_technical_02'],
    blocks: [
      { id: 'warmup', name: 'Warm-up', role: 'warmup', steps: [timeStep('accel_warmup', 'field_dynamic_warmup', 'Dynamic warm-up', 720, { target: { type: 'rpe', min: 2, max: 4 } })] },
      { id: 'main', name: 'Acceleration and braking', role: 'main', steps: [
        repsStep('accel_20m', 'sprint_falling_start_10m', '20 m acceleration pattern', 1, { sets: 5, restAfterSec: 100, target: { type: 'technical_quality', cue: 'Build to approximately 80–90%; walk back and recover fully.', successCriteria: ['Projection stays smooth through the first steps.', 'No reaching or excessive forward bend.'] } }),
        repsStep('braking_sticks', 'deceleration_stick', 'Deceleration stick', 1, { sets: 5, restAfterSec: 80, target: { type: 'technical_quality', cue: 'Use several planned braking steps and hold the finish for two seconds.', successCriteria: ['Quiet knee alignment.', 'Balanced two-second finish.'], stopConditions: ['Stop with knee pain, instability or painful braking.'] } })
      ] }
    ],
    variants: [
      { id: 'full', targetDurationMin: 35, loadMultiplier: 1, rationale: 'Normal technical progression after mechanics foundation.', stepOverrides: [] },
      { id: 'reduced', targetDurationMin: 28, loadMultiplier: 0.7, rationale: 'Reduce contacts but preserve both movement qualities.', stepOverrides: [{ stepId: 'accel_20m', sets: 4 }, { stepId: 'braking_sticks', sets: 3 }] },
      { id: 'return_to_training', targetDurationMin: 25, loadMultiplier: 0.5, rationale: 'Return to controlled acceleration only; omit braking exposure.', stepOverrides: [{ stepId: 'accel_20m', sets: 3, target: { type: 'technical_quality', cue: 'Approximately 70%, smooth and symptom-free.', stopConditions: ['Stop at the first symptom or mechanics change.'] } }, { stepId: 'braking_sticks', omit: true }] }
    ],
    regressions: ['field_sprint_mechanics_foundation_01'], progressions: ['field_controlled_maintenance_01'], substitutions: [],
    garmin: { exportable: false }, tags: ['sprint', 'braking', 'technique', 'field'],
    sourceNotes: ['Acceleration and braking are progressed separately because braking has substantially greater eccentric cost.']
  }
];
