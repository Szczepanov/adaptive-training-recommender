import type { WorkoutDefinition } from '../models.ts';
import { timeStep } from './helpers.ts';

export const CYCLING_BASE_WORKOUTS: WorkoutDefinition[] = [
  {
    id: 'cycling_recovery_spin_01', version: 1, status: 'active',
    name: 'Recovery Spin',
    description: 'Low-cost cycling used to promote movement and recovery without adding meaningful fatigue.',
    modality: 'cycling', category: 'recovery', objectives: ['active_recovery'],
    duration: { defaultMin: 30, minimumMin: 20, maximumMin: 45 },
    loadProfile: { cardiovascular: 1, muscular: 1, mechanical: 1, eccentric: 1, coordination: 1, recoveryHours: 6 },
    eligibility: { maximumSoreness: 8, forbiddenPainFlags: ['knee_swelling', 'worsening_achilles_pain'] },
    equipment: ['bike'], contraindicationTags: ['knee_swelling'],
    blocks: [
      { id: 'main', name: 'Easy continuous spin', role: 'main', steps: [ timeStep('easy_spin', 'bike_easy_spin', 'Easy spin', 1200, { target: { type: 'rpe', min: 1, max: 2 }, notes: ['Smooth cadence', 'No low-cadence grinding'] }) ]},
      { id: 'cooldown', name: 'Downshift', role: 'cooldown', steps: [ timeStep('downshift', 'bike_easy_spin', 'Very easy finish', 600, { target: { type: 'rpe', min: 1, max: 1 } }) ]}
    ],
    variants: [
      { id: 'full', targetDurationMin: 30, loadMultiplier: 1, rationale: 'Normal recovery dose.', stepOverrides: [] },
      { id: 'reduced', targetDurationMin: 20, loadMultiplier: 0.7, rationale: 'Shorten when recovery capacity or time is limited.', stepOverrides: [{ stepId: 'easy_spin', durationSeconds: 900 }, { stepId: 'downshift', durationSeconds: 300 }] },
      { id: 'return_to_training', targetDurationMin: 20, loadMultiplier: 0.6, rationale: 'Use only if symptoms remain quiet during movement.', stepOverrides: [{ stepId: 'easy_spin', durationSeconds: 900, target: { type: 'rpe', min: 1, max: 2 } }, { stepId: 'downshift', durationSeconds: 300 }] }
    ],
    parameters: [{ id: 'easy_duration', label: 'Easy riding duration', unit: 'minutes', defaultValue: 20, minimum: 15, maximum: 35, step: 5, appliesToStepIds: ['easy_spin'], description: 'Adjust recovery volume without raising intensity.' }],
    regressions: ['rest_complete_01'], progressions: ['cycling_zone2_standard_01'], substitutions: [],
    garmin: { exportable: true, supportedSport: 'cycling' },
    tags: ['low_fatigue', 'indoor_or_outdoor', 'recovery', 'adjustable'],
    sourceNotes: ['Macrocycle easy Zone 2 guidance: RPE 2–3, smooth cadence, no low-cadence grinding, finish unchanged or fresher.']
  },
  {
    id: 'cycling_zone2_standard_01', version: 1, status: 'active',
    name: 'Adjustable Aerobic Zone 2 Ride',
    description: 'Steady conversational cycling for aerobic volume, recovery support and race-build durability.',
    modality: 'cycling', category: 'easy_endurance', objectives: ['aerobic_base'],
    duration: { defaultMin: 60, minimumMin: 30, maximumMin: 90 },
    loadProfile: { cardiovascular: 2, muscular: 2, mechanical: 1, eccentric: 1, coordination: 1, recoveryHours: 18 },
    eligibility: { maximumSoreness: 7, forbiddenPainFlags: ['knee_swelling', 'worsening_achilles_pain'] },
    equipment: ['bike'], contraindicationTags: ['acute_knee_pain'],
    blocks: [
      { id: 'warmup', name: 'Progressive warm-up', role: 'warmup', steps: [ timeStep('warmup_easy', 'bike_progressive_warmup', 'Progressive easy riding', 600, { target: { type: 'rpe', min: 1, max: 2 } }) ]},
      { id: 'main', name: 'Zone 2 base', role: 'main', steps: [ timeStep('zone2_main', 'bike_easy_spin', 'Steady Zone 2', 2400, { target: { type: 'rpe', min: 2, max: 3 }, notes: ['Conversational breathing', 'Usually 85–95 rpm', 'Power and heart rate should remain stable'] }) ]},
      { id: 'cooldown', name: 'Cool-down', role: 'cooldown', steps: [ timeStep('cooldown_easy', 'bike_easy_spin', 'Easy finish', 600, { target: { type: 'rpe', min: 1, max: 2 } }) ]}
    ],
    variants: [
      { id: 'full', targetDurationMin: 60, loadMultiplier: 1, rationale: 'Standard aerobic volume.', stepOverrides: [] },
      { id: 'reduced', targetDurationMin: 40, loadMultiplier: 0.7, rationale: 'Retain aerobic stimulus while lowering total load.', stepOverrides: [{ stepId: 'zone2_main', durationSeconds: 1200 }] },
      { id: 'return_to_training', targetDurationMin: 30, loadMultiplier: 0.55, rationale: 'Use a conservative conversational exposure.', stepOverrides: [{ stepId: 'zone2_main', durationSeconds: 900 }, { stepId: 'cooldown_easy', durationSeconds: 300 }] }
    ],
    parameters: [
      { id: 'zone2_duration', label: 'Zone 2 duration', unit: 'minutes', defaultValue: 40, minimum: 15, maximum: 70, step: 5, appliesToStepIds: ['zone2_main'], description: 'Adjust total aerobic volume from recovery support to a longer endurance ride.' },
      { id: 'zone2_rpe', label: 'Zone 2 RPE', unit: 'rpe', defaultValue: 2.5, minimum: 2, maximum: 3, step: 0.5, appliesToStepIds: ['zone2_main'], description: 'Keep intensity conversational and device-independent.' }
    ],
    regressions: ['cycling_recovery_spin_01'], progressions: ['cycling_controlled_threshold_4x8_01', 'cycling_event_specific_endurance_01'], substitutions: [],
    garmin: { exportable: true, supportedSport: 'cycling' },
    tags: ['aerobic_base', 'low_impact', 'indoor_or_outdoor', 'adjustable'],
    sourceNotes: ['Macrocycle Zone 2 range is 30–90 minutes at RPE 2–3 with smooth cadence and stable power/HR.']
  }
];
