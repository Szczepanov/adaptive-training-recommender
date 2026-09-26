import type { WorkoutDefinition } from '../models.ts';
import { repsStep, timeStep } from './helpers.ts';

export const STRENGTH_WORKOUTS: WorkoutDefinition[] = [
  {
    id: 'strength_full_body_maintenance_01', version: 3, status: 'active',
    name: 'Primary Full-body Strength Maintenance',
    description: 'Low-fatigue strength session preserving force, Olympic-lift speed and tissue capacity during cycling build.',
    modality: 'strength', category: 'full_body_strength', objectives: ['strength_maintenance', 'power_maintenance', 'tissue_capacity'],
    duration: { defaultMin: 60, minimumMin: 18, maximumMin: 70 },
    loadProfile: { cardiovascular: 2, muscular: 4, mechanical: 3, eccentric: 3, coordination: 4, recoveryHours: 48 },
    eligibility: { minimumReadiness: 6, maximumSoreness: 6, minimumDaysAfterHardLowerBody: 1, forbiddenPainFlags: ['knee_swelling', 'worsening_achilles_pain'] },
    equipment: ['barbell', 'rack', 'bench', 'pullup_bar', 'bodyweight'], contraindicationTags: ['knee_swelling'], engineTemplateIds: ['str_full_01', 'str_full_03'], warmupKnowledgeClaimIds: ['strength.warmup.contextual_preparation', 'strength.warmup.specific_rehearsal'],
    blocks: [
      { id: 'warmup', name: 'Warm-up and clean rehearsal', role: 'warmup', steps: [
        repsStep('full_warmup_hinge', 'bodyweight_hip_hinge', 'Bodyweight hip hinge', 8, { load: { kind: 'bodyweight' }, notes: ['Move smoothly through a comfortable range.'] }),
        repsStep('full_warmup_deadbug', 'dead_bug', 'Dead bug', 6, { load: { kind: 'bodyweight' }, notes: ['Use controlled breathing and trunk position.'] }),
        repsStep('full_warmup_clean_ramp', 'hang_power_clean', 'Hang power clean rehearsal', 3, { sets: 2, restAfterSec: 60, load: { kind: 'descriptive', display: 'Empty bar, then light rehearsal load' }, notes: ['Rehearse positions; stop before fatigue.'] })
      ]},
      { id: 'activation', name: 'Power activation', role: 'activation', steps: [
        repsStep('power_clean', 'hang_power_clean', 'Hang power clean', 3, { sets: 4, restAfterSec: 120, target: { type: 'reps_in_reserve', min: 4, max: 6 }, notes: ['Fast and crisp', 'Stop if speed drops'] })
      ]},
      { id: 'main', name: 'Strength maintenance', role: 'main', steps: [
        repsStep('front_squat', 'front_squat', 'Front squat', 5, { sets: 3, restAfterSec: 150, target: { type: 'reps_in_reserve', min: 3, max: 5 } }),
        repsStep('unilateral_lower_body', 'rear_foot_elevated_split_squat', 'Rear-foot elevated split squat', 6, { sets: 2, restAfterSec: 90, target: { type: 'reps_in_reserve', min: 3, max: 5 } }),
        repsStep('rdl', 'romanian_deadlift', 'Romanian deadlift', 6, { sets: 3, restAfterSec: 120, target: { type: 'reps_in_reserve', min: 3, max: 5 } }),
        repsStep('bench', 'bench_press', 'Bench press', 6, { sets: 3, restAfterSec: 120, target: { type: 'reps_in_reserve', min: 3, max: 5 } }),
        repsStep('pullup', 'pull_up', 'Pull-up', 5, { sets: 3, restAfterSec: 90, target: { type: 'reps_in_reserve', min: 2, max: 4 } })
      ]},
      { id: 'accessory', name: 'Tissue capacity', role: 'accessory', steps: [
        timeStep('soleus_iso', 'seated_soleus_iso', 'Seated soleus isometric', 25, { sets: 3, restAfterSec: 35 }),
        repsStep('tibialis', 'tibialis_raise', 'Tibialis raise', 15, { sets: 2, restAfterSec: 45 }),
        timeStep('copenhagen', 'copenhagen_plank', 'Copenhagen plank', 20, { sets: 2, restAfterSec: 40 }),
        repsStep('full_nordic', 'nordic_hamstring_curl', 'Nordic hamstring curl', 4, { sets: 2, restAfterSec: 75, optional: true }),
        repsStep('full_heel_raise', 'eccentric_heel_raise', 'Eccentric heel raise', 8, { sets: 2, restAfterSec: 45, optional: true })
      ]}
    ],
    variants: [
      { id: 'full', targetDurationMin: 60, loadMultiplier: 1, rationale: 'Normal weekly force-maintenance dose.', stepOverrides: [] },
      { id: 'reduced', targetDurationMin: 45, loadMultiplier: 0.7, rationale: 'Reduce lower-body sets and preserve upper-body and tissue work.', stepOverrides: [{ stepId: 'front_squat', sets: 2 }, { stepId: 'unilateral_lower_body', sets: 1 }, { stepId: 'rdl', sets: 2 }, { stepId: 'power_clean', sets: 3 }] },
      { id: 'return_to_training', targetDurationMin: 18, loadMultiplier: 0.5, rationale: 'Use upper-dominant work and low-load tissue capacity.', stepOverrides: [{ stepId: 'full_warmup_clean_ramp', omit: true }, { stepId: 'power_clean', omit: true }, { stepId: 'front_squat', omit: true }, { stepId: 'unilateral_lower_body', omit: true }, { stepId: 'rdl', sets: 2, target: { type: 'reps_in_reserve', min: 5, max: 6 } }, { stepId: 'bench', sets: 2 }, { stepId: 'pullup', sets: 2 }, { stepId: 'full_nordic', omit: true }, { stepId: 'full_heel_raise', omit: true }], compositionRelaxations: [{ pattern: 'unilateral_lower_body', reason: 'Return-to-training variant intentionally uses upper-dominant work while lower-body loading is reintroduced.' }] }
    ],
    compositionRequirements: [{ id: 'regular_unilateral_lower_body', pattern: 'unilateral_lower_body', stepIds: ['unilateral_lower_body'] }],
    regressions: ['strength_compact_power_01', 'strength_full_body_reentry_01'], progressions: [],
    substitutions: [
      { exerciseId: 'front_squat', substituteExerciseId: 'rear_foot_elevated_split_squat', reason: 'Use a symptom-free unilateral alternative when equipment or squat tolerance requires it.' },
      { exerciseId: 'rear_foot_elevated_split_squat', substituteExerciseId: 'walking_lunge', reason: 'Preserve unilateral lower-body composition with a supported lunge pattern.' },
      { exerciseId: 'rear_foot_elevated_split_squat', substituteExerciseId: 'step_up', reason: 'Preserve unilateral lower-body composition with a controlled step-up pattern.' }
    ],
    garmin: { exportable: false },
    tags: ['strength', 'low_grind', 'cycling_support'],
    sourceNotes: ['Macrocycle primary strength session is 45–70 minutes, mostly RPE 5–7, no grinding and generally 3–5 repetitions in reserve.']
  },
  {
    id: 'strength_compact_power_01', version: 2, status: 'active',
    name: 'Compact Power and Upper-body Maintenance',
    description: 'Short second strength exposure that preserves explosiveness without reducing cycling quality.',
    modality: 'strength', category: 'power_maintenance', objectives: ['power_maintenance', 'strength_maintenance', 'tissue_capacity'],
    duration: { defaultMin: 35, minimumMin: 20, maximumMin: 45 },
    loadProfile: { cardiovascular: 2, muscular: 3, mechanical: 2, eccentric: 2, coordination: 3, recoveryHours: 30 },
    eligibility: { minimumReadiness: 5, maximumSoreness: 7, forbiddenPainFlags: ['knee_swelling'] },
    equipment: ['medicine_ball', 'barbell', 'rack', 'bench', 'pullup_bar', 'bodyweight'], contraindicationTags: [], engineTemplateIds: ['str_power_01'], warmupKnowledgeClaimIds: ['strength.warmup.contextual_preparation', 'strength.warmup.specific_rehearsal'],
    blocks: [
      { id: 'warmup', name: 'Warm-up and upper-body rehearsal', role: 'warmup', steps: [
        repsStep('compact_warmup_scapula', 'scapular_push_up', 'Scapular push-up', 8, { load: { kind: 'bodyweight' } }),
        repsStep('compact_warmup_pushup', 'push_up', 'Easy push-up rehearsal', 5, { load: { kind: 'bodyweight' }, notes: ['Leave plenty in reserve.'] })
      ]},
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
  },
  {
    id: 'strength_reactive_power_01', version: 2, status: 'active',
    name: 'Reactive Power Maintenance', description: 'Low-contact plyometric and hip-extension work to maintain reactive strength without fatigue accumulation.',
    modality: 'strength', category: 'power_maintenance', objectives: ['power_maintenance', 'tissue_capacity'],
    duration: { defaultMin: 35, minimumMin: 20, maximumMin: 45 }, loadProfile: { cardiovascular: 2, muscular: 3, mechanical: 3, eccentric: 4, coordination: 4, recoveryHours: 36 },
    eligibility: { minimumReadiness: 6, maximumSoreness: 4, minimumDaysAfterHardLowerBody: 1, forbiddenPainFlags: ['worsening_achilles_pain', 'acute_hamstring_pain', 'knee_swelling', 'painful_deep_knee_flexion'] },
    equipment: ['bodyweight', 'plyo_box', 'barbell', 'bench'], contraindicationTags: ['worsening_achilles_pain', 'acute_hamstring_pain', 'knee_swelling', 'painful_deep_knee_flexion'], engineTemplateIds: ['str_power_01'], engineTemplatePriority: 2, warmupKnowledgeClaimIds: ['strength.warmup.contextual_preparation', 'strength.warmup.specific_rehearsal'],
    blocks: [
      { id: 'warmup', name: 'Low-impact warm-up', role: 'warmup', steps: [
        repsStep('reactive_warmup_squat', 'bodyweight_squat', 'Bodyweight squat', 8, { load: { kind: 'bodyweight' }, notes: ['Use a comfortable depth.'] }),
        repsStep('reactive_warmup_bridge', 'glute_bridge', 'Glute bridge', 8, { load: { kind: 'bodyweight' } })
      ]},
      { id: 'activation', name: 'Reactive preparation', role: 'activation', steps: [repsStep('reactive_pogo', 'pogo_hop', 'Pogo hop', 12, { sets: 3, restAfterSec: 45, target: { type: 'technical_quality', cue: 'Quiet, springy contacts; stop when stiffness or landing quality fades.' } })] },
      { id: 'main', name: 'Reactive power', role: 'main', steps: [repsStep('reactive_cmj', 'countermovement_jump', 'Countermovement jump', 3, { sets: 4, restAfterSec: 75, target: { type: 'technical_quality', cue: 'Jump fresh and land quietly.' } }), repsStep('reactive_drop', 'drop_jump_low', 'Low drop jump', 3, { sets: 3, restAfterSec: 90, target: { type: 'technical_quality', cue: 'Use a low box and stop before landing quality changes.' } }), repsStep('reactive_hip_thrust', 'hip_thrust', 'Hip thrust', 6, { sets: 3, restAfterSec: 90, target: { type: 'reps_in_reserve', min: 3, max: 5 } })] },
      { id: 'accessory', name: 'Posterior-chain capacity', role: 'accessory', steps: [repsStep('reactive_nordic', 'nordic_hamstring_curl', 'Nordic hamstring curl', 4, { sets: 2, restAfterSec: 75 }), repsStep('reactive_heel_raise', 'eccentric_heel_raise', 'Eccentric heel raise', 8, { sets: 2, restAfterSec: 45 })] }
    ],
    variants: [
      { id: 'full', targetDurationMin: 35, loadMultiplier: 1, rationale: 'Keep total contacts below 60 with full recovery.', stepOverrides: [] },
      { id: 'reduced', targetDurationMin: 27, loadMultiplier: 0.7, rationale: 'Reduce contacts before reducing recovery.', stepOverrides: [{ stepId: 'reactive_pogo', sets: 2 }, { stepId: 'reactive_cmj', sets: 3 }, { stepId: 'reactive_drop', sets: 2 }, { stepId: 'reactive_hip_thrust', sets: 2 }] },
      { id: 'return_to_training', targetDurationMin: 20, loadMultiplier: 0.5, rationale: 'Use only low-contact, symptom-free preparation.', stepOverrides: [{ stepId: 'reactive_drop', omit: true }, { stepId: 'reactive_cmj', sets: 2 }, { stepId: 'reactive_hip_thrust', sets: 2 }, { stepId: 'reactive_nordic', omit: true }] }
    ],
    regressions: [], progressions: ['strength_full_body_maintenance_01'], substitutions: [], garmin: { exportable: false }, tags: ['power', 'plyometric', 'tissue_capacity'], sourceNotes: ['Reactive work is intentionally low-volume, fully recovered, and limited to athletes with normal tendon and landing tolerance.']
  },
  {
    id: 'strength_low_load_trunk_01', version: 1, status: 'active',
    name: 'Low-load Strength and Trunk Maintenance',
    description: 'Supported, low-load lower-body and trunk work. Avoid overhead pressing and heavy spinal compression.',
    modality: 'strength', category: 'full_body_strength', objectives: ['strength_maintenance', 'tissue_capacity'],
    duration: { defaultMin: 30, minimumMin: 20, maximumMin: 35 },
    loadProfile: { cardiovascular: 1, muscular: 2, mechanical: 1, eccentric: 1, coordination: 1, recoveryHours: 24 },
    eligibility: { minimumReadiness: 3, maximumSoreness: 8, forbiddenPainFlags: [] },
    equipment: ['bodyweight'], contraindicationTags: [], engineTemplateIds: ['str_low_load_maint_01'],
    warmupKnowledgeClaimIds: ['strength.warmup.contextual_preparation', 'strength.warmup.specific_rehearsal'],
    blocks: [
      { id: 'warmup', name: 'Gentle supported pattern rehearsal', role: 'warmup', steps: [
        repsStep('low_warmup_squat', 'bodyweight_squat', 'Supported sit-to-stand', 6, { load: { kind: 'bodyweight' }, notes: ['Use a comfortable, pain-free depth and chair support.'] }),
        repsStep('low_warmup_bridge', 'glute_bridge', 'Easy glute bridge', 6, { load: { kind: 'bodyweight' }, notes: ['Keep the spine comfortable and avoid bracing against pain.'] })
      ]},
      { id: 'main', name: 'Low-load strength maintenance', role: 'main', steps: [
        repsStep('low_squat', 'bodyweight_squat', 'Supported sit-to-stand', 8, { sets: 2, restAfterSec: 60, load: { kind: 'bodyweight' }, target: { type: 'reps_in_reserve', min: 5, max: 7 }, notes: ['Stop or shorten the range if back or lower-body symptoms increase.'] }),
        repsStep('low_bridge', 'glute_bridge', 'Glute bridge', 8, { sets: 2, restAfterSec: 45, load: { kind: 'bodyweight' }, target: { type: 'reps_in_reserve', min: 5, max: 7 } }),
        repsStep('low_deadbug', 'dead_bug', 'Dead bug trunk stability', 6, { sets: 2, restAfterSec: 30, load: { kind: 'bodyweight' }, notes: ['Use slow, comfortable range and steady breathing.'] })
      ]}
    ],
    variants: [
      { id: 'full', targetDurationMin: 30, loadMultiplier: 1, rationale: 'Two easy sets of each comfortable pattern.', stepOverrides: [] },
      { id: 'reduced', targetDurationMin: 25, loadMultiplier: 0.7, rationale: 'Keep low-load movement with less volume.', stepOverrides: [{ stepId: 'low_squat', sets: 1 }, { stepId: 'low_bridge', sets: 1 }] },
      { id: 'return_to_training', targetDurationMin: 20, loadMultiplier: 0.5, rationale: 'Use only symptom-free lower-body and trunk patterns.', stepOverrides: [{ stepId: 'low_squat', sets: 1 }, { stepId: 'low_bridge', sets: 1 }, { stepId: 'low_deadbug', sets: 1 }] }
    ],
    regressions: [], progressions: ['strength_bodyweight_full_body_01', 'strength_full_body_reentry_01'], substitutions: [],
    garmin: { exportable: false }, tags: ['bodyweight', 'low_load', 'trunk', 'symptom_compatible'],
    sourceNotes: ['Issue #736 shoulder/spinal guardrail-compatible maintenance option. Use only movements that remain comfortable.']
  },
  {
    id: 'strength_full_body_reentry_01', version: 1, status: 'active',
    name: 'Full-body Strength Re-entry (Spinal-sparing)',
    description: 'Tolerance-proving full-body strength re-entry after lumbar flare-ups: non-grinding front/goblet squat, hip thrust and split squat in place of heavy RDL or explosive hinges, plus bench press, pull-ups, calf/soleus and anti-extension/lateral trunk work.',
    modality: 'strength', category: 'full_body_strength', objectives: ['strength_maintenance', 'tissue_capacity'],
    duration: { defaultMin: 50, minimumMin: 25, maximumMin: 55 },
    loadProfile: { cardiovascular: 2, muscular: 3, mechanical: 2, eccentric: 2, coordination: 2, recoveryHours: 36 },
    eligibility: { minimumReadiness: 5, maximumSoreness: 6, minimumDaysAfterHardLowerBody: 1, forbiddenPainFlags: ['knee_swelling', 'worsening_achilles_pain', 'acute_low_back_pain'] },
    equipment: ['barbell', 'rack', 'bench', 'dumbbells', 'pullup_bar', 'bodyweight'], contraindicationTags: ['knee_swelling', 'acute_low_back_pain'], warmupKnowledgeClaimIds: ['strength.warmup.contextual_preparation', 'strength.warmup.specific_rehearsal'],
    blocks: [
      { id: 'warmup', name: 'Unguarded movement check and pattern rehearsal', role: 'warmup', steps: [
        repsStep('reentry_warmup_squat', 'bodyweight_squat', 'Bodyweight squat', 5, { restAfterSec: 30, load: { kind: 'bodyweight' }, notes: ['5–8 min easy general movement first; confirm everything feels normal and unguarded.'] }),
        repsStep('reentry_warmup_hinge', 'bodyweight_hip_hinge', 'Unloaded hip hinge', 5, { restAfterSec: 30, load: { kind: 'bodyweight' }, notes: ['Smooth range with no protective bracing.'] }),
        repsStep('reentry_warmup_lunge', 'reverse_lunge', 'Unloaded reverse lunge', 6, { restAfterSec: 30, load: { kind: 'descriptive', display: 'Unloaded bodyweight' }, notes: ['A few easy alternating reps to confirm pelvis and lumbar comfort.'] })
      ]},
      { id: 'main', name: 'Spinal-sparing full-body loading', role: 'main', steps: [
        repsStep('reentry_front_squat', 'front_squat', 'Front squat or goblet squat', 5, { sets: 3, restAfterSec: 150, target: { type: 'reps_in_reserve', min: 4, max: 5 }, notes: ['3 × 4–5 @ RPE 5–6 (~4 RIR). Prove loading is tolerated; stop lower-body loading if back reaches >2/10 or tightens progressively.'] }),
        repsStep('reentry_hip_thrust', 'hip_thrust', 'Hip thrust or glute bridge', 8, { sets: 2, restAfterSec: 120, target: { type: 'reps_in_reserve', min: 4, max: 5 }, notes: ['2 × 6–8 in place of a meaningful RDL load today. Finish with ribs down and zero lumbar hyperextension.'] }),
        repsStep('reentry_split_squat', 'split_squat', 'Split squat or step-up (per side)', 6, { sets: 2, restAfterSec: 90, target: { type: 'reps_in_reserve', min: 4, max: 5 }, notes: ['2 × 6/side at easy-moderate load; do not alter movement to protect the back.'] }),
        repsStep('reentry_bench', 'bench_press', 'Bench press', 6, { sets: 3, restAfterSec: 120, target: { type: 'reps_in_reserve', min: 3, max: 5 }, notes: ['3 × 5–6 controlled reps with stable setup.'] }),
        repsStep('reentry_pullup', 'pull_up', 'Pull-up', 6, { sets: 3, restAfterSec: 90, target: { type: 'reps_in_reserve', min: 3, max: 5 }, notes: ['3 × 5–7 controlled reps; no grinding.'] })
      ]},
      { id: 'accessory', name: 'Calf/soleus and trunk stability', role: 'accessory', steps: [
        repsStep('reentry_calf', 'seated_calf_raise', 'Calf / soleus raise', 10, { sets: 2, restAfterSec: 60, target: { type: 'reps_in_reserve', min: 3, max: 5 }, notes: ['2 × 8–12 controlled tempo.'] }),
        timeStep('reentry_trunk', 'side_plank', 'Side plank or bird-dog trunk work', 30, { sets: 2, restAfterSec: 45, notes: ['2 controlled sets; keep spine neutral and unguarded.'] })
      ]}
    ],
    variants: [
      { id: 'full', targetDurationMin: 50, loadMultiplier: 1, rationale: '45–55 min full-body re-entry dose proving axial and unilateral tolerance without heavy hinges.', stepOverrides: [] },
      { id: 'reduced', targetDurationMin: 38, loadMultiplier: 0.75, rationale: 'Trim squat and upper-body working sets to 2 while keeping every pattern represented.', stepOverrides: [{ stepId: 'reentry_front_squat', sets: 2 }, { stepId: 'reentry_bench', sets: 2 }, { stepId: 'reentry_pullup', sets: 2 }] },
      { id: 'return_to_training', targetDurationMin: 25, loadMultiplier: 0.5, rationale: 'Keep unloaded/light bridge, upper-body push/pull, and trunk stability if squat/split-squat tolerance is questionable.', stepOverrides: [{ stepId: 'reentry_front_squat', omit: true }, { stepId: 'reentry_split_squat', omit: true }, { stepId: 'reentry_hip_thrust', sets: 2, target: { type: 'reps_in_reserve', min: 5, max: 6 } }, { stepId: 'reentry_bench', sets: 2, target: { type: 'reps_in_reserve', min: 4, max: 6 } }, { stepId: 'reentry_pullup', sets: 2, target: { type: 'reps_in_reserve', min: 4, max: 6 } }] }
    ],
    regressions: ['strength_low_load_trunk_01', 'strength_upper_body_trunk_01'],
    progressions: ['strength_full_body_maintenance_01'],
    substitutions: [
      { exerciseId: 'front_squat', substituteExerciseId: 'goblet_squat', reason: 'Use goblet squat when preferable for comfort, trunk uprightness, or equipment.' },
      { exerciseId: 'hip_thrust', substituteExerciseId: 'glute_bridge', reason: 'Use bodyweight or lightly loaded glute bridge when a lower-load hip extension option is preferred.' },
      { exerciseId: 'split_squat', substituteExerciseId: 'step_up', reason: 'Step-up is an equivalent unilateral knee/hip option.' },
      { exerciseId: 'seated_calf_raise', substituteExerciseId: 'standing_calf_raise', reason: 'Standing calf raise can substitute when seated soleus setup is unavailable.' },
      { exerciseId: 'side_plank', substituteExerciseId: 'bird_dog', reason: 'Bird-dog is an equivalent low-shear trunk stability option.' }
    ],
    garmin: { exportable: false },
    tags: ['strength', 'reentry', 'spinal_sparing', 'low_grind', 'symptom_compatible'],
    sourceNotes: ['Spinal-sparing full-body re-entry (45–55 min): omits heavy deadlift/RDL, loaded spinal flexion, grinding reps, and explosive hinge work. Stop lower-body loading if back pain exceeds 2/10, tightens progressively, or alters movement mechanics.']
  },
  {
    id: 'strength_bodyweight_full_body_01', version: 2, status: 'active',
    name: 'Bodyweight Full-body Strength',
    description: 'Genuine zero-equipment full-body resistance session: controlled-tempo squat, push-up, hip hinge, glute bridge, self-resisted prone row, and trunk work.',
    modality: 'strength', category: 'full_body_strength', objectives: ['strength_maintenance', 'tissue_capacity'],
    duration: { defaultMin: 35, minimumMin: 20, maximumMin: 45 },
    loadProfile: { cardiovascular: 2, muscular: 3, mechanical: 2, eccentric: 2, coordination: 2, recoveryHours: 24 },
    eligibility: { minimumReadiness: 4, maximumSoreness: 7, forbiddenPainFlags: ['knee_swelling', 'acute_shoulder_pain'] },
    equipment: ['bodyweight'], contraindicationTags: [], engineTemplateIds: ['str_full_02'], warmupKnowledgeClaimIds: ['strength.warmup.contextual_preparation', 'strength.warmup.specific_rehearsal'],
    blocks: [
      { id: 'warmup', name: 'Full-body pattern rehearsal', role: 'warmup', steps: [
        repsStep('bw_warmup_squat', 'bodyweight_squat', 'Easy bodyweight squat', 6, { load: { kind: 'bodyweight' } }),
        repsStep('bw_warmup_scapula', 'scapular_push_up', 'Scapular push-up', 6, { load: { kind: 'bodyweight' } }),
        repsStep('bw_warmup_hinge', 'bodyweight_hip_hinge', 'Easy bodyweight hip hinge', 6, { load: { kind: 'bodyweight' } })
      ]},
      { id: 'main', name: 'Full-body resistance', role: 'main', steps: [
        repsStep('bw_squat', 'bodyweight_squat', 'Bodyweight squat', 12, { sets: 3, restAfterSec: 60, target: { type: 'reps_in_reserve', min: 3, max: 5 } }),
        repsStep('bw_pushup', 'push_up', 'Push-up', 10, { sets: 3, restAfterSec: 60, target: { type: 'reps_in_reserve', min: 3, max: 5 } }),
        repsStep('bw_hinge', 'bodyweight_hip_hinge', 'Bodyweight hip hinge', 10, { sets: 3, restAfterSec: 60, target: { type: 'reps_in_reserve', min: 3, max: 5 } }),
        repsStep('bw_bridge', 'glute_bridge', 'Glute bridge', 12, { sets: 3, restAfterSec: 45, target: { type: 'reps_in_reserve', min: 3, max: 5 } }),
        repsStep('bw_row', 'prone_scapular_row', 'Prone scapular row', 12, { sets: 3, restAfterSec: 45, target: { type: 'reps_in_reserve', min: 3, max: 5 } })
      ]},
      { id: 'accessory', name: 'Trunk', role: 'accessory', steps: [
        timeStep('bw_plank', 'plank', 'Front plank', 30, { sets: 2, restAfterSec: 30 }),
        repsStep('bw_deadbug', 'dead_bug', 'Dead bug', 10, { sets: 2, restAfterSec: 30 })
      ]}
    ],
    variants: [
      { id: 'full', targetDurationMin: 35, loadMultiplier: 1, rationale: 'Normal weekly zero-equipment full-body dose.', stepOverrides: [] },
      { id: 'reduced', targetDurationMin: 25, loadMultiplier: 0.7, rationale: 'Fewer sets per pattern while keeping every movement represented.', stepOverrides: [{ stepId: 'bw_squat', sets: 2 }, { stepId: 'bw_hinge', sets: 2 }, { stepId: 'bw_row', sets: 2 }, { stepId: 'bw_deadbug', sets: 1 }] },
      { id: 'return_to_training', targetDurationMin: 20, loadMultiplier: 0.5, rationale: 'Drop the least familiar pattern first and keep the rest at a high reps-in-reserve.', stepOverrides: [{ stepId: 'bw_hinge', omit: true }, { stepId: 'bw_squat', sets: 2, target: { type: 'reps_in_reserve', min: 5, max: 6 } }, { stepId: 'bw_pushup', sets: 2, target: { type: 'reps_in_reserve', min: 5, max: 6 } }, { stepId: 'bw_bridge', sets: 2 }, { stepId: 'bw_row', sets: 2, target: { type: 'reps_in_reserve', min: 5, max: 6 } }, { stepId: 'bw_deadbug', omit: true }] }
    ],
    regressions: [], progressions: ['strength_full_body_maintenance_01'], substitutions: [],
    garmin: { exportable: false },
    tags: ['bodyweight', 'zero_equipment', 'full_body'],
    sourceNotes: ['Genuine zero-equipment session dosed like resistance training (2-4 reps in reserve), not a conditioning circuit. Unloaded pulling is inherently limited, so upper-back work uses a self-resisted prone row rather than fabricating equipment availability.']
  }
];
