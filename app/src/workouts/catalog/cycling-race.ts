import type { WorkoutDefinition } from '../models.ts';
import { timeStep } from './helpers.ts';

export const CYCLING_RACE_WORKOUTS: WorkoutDefinition[] = [
  {
    id: 'cycling_criterium_surges_01', version: 1, status: 'active',
    name: 'Compact Criterium Surge Set',
    description: 'Time-efficient race-specific set of repeated short surges with firm, VO2-adjacent pedalling recoveries and a controlled fast finish for surge-heavy short-format events.',
    modality: 'cycling', category: 'surge_tolerance', objectives: ['surge_tolerance', 'fatigue_resistant_finish'],
    duration: { defaultMin: 38, minimumMin: 30, maximumMin: 45 },
    loadProfile: { cardiovascular: 4, muscular: 4, mechanical: 1, eccentric: 1, coordination: 4, recoveryHours: 48 },
    eligibility: { minimumReadiness: 7, maximumSoreness: 5, forbiddenPainFlags: ['knee_swelling', 'acute_knee_pain'] },
    equipment: ['bike'], contraindicationTags: ['acute_knee_pain'], engineTemplateIds: ['end_crit_surges_01'],
    blocks: [
      { id: 'warmup', name: 'Warm-up', role: 'warmup', steps: [ timeStep('crit_warmup', 'bike_progressive_warmup', 'Progressive warm-up', 600, { target: { type: 'rpe', min: 1, max: 3 } }) ]},
      { id: 'main', name: 'Criterium surge set', role: 'main', steps: [
        timeStep('crit_surges', 'bike_short_surge', 'Short criterium surge', 20, { sets: 10, restAfterSec: 90, target: { type: 'rpe', min: 8, max: 9 }, notes: ['Recover at a firm, VO2-adjacent effort rather than coasting or an easy spin', 'Repeated surges simulate criterium accelerations out of corners'] }),
        timeStep('crit_finish', 'bike_hard_finish', 'Controlled fast finish', 60, { target: { type: 'rpe', min: 9, max: 10 }, notes: ['Execute after accumulated fatigue', 'Preserve cadence and position'] })
      ]},
      { id: 'cooldown', name: 'Cool-down', role: 'cooldown', steps: [ timeStep('crit_cooldown', 'bike_easy_spin', 'Easy spin', 600, { target: { type: 'rpe', min: 1, max: 2 } }) ]}
    ],
    variants: [
      { id: 'full', targetDurationMin: 38, loadMultiplier: 1, rationale: 'Complete the compact criterium surge dose.', stepOverrides: [] },
      { id: 'reduced', targetDurationMin: 32, loadMultiplier: 0.75, rationale: 'Reduce surge count while preserving the fast finish.', stepOverrides: [{ stepId: 'crit_surges', sets: 7 }] },
      { id: 'return_to_training', targetDurationMin: 30, loadMultiplier: 0.6, rationale: 'Use controlled accelerations only and omit the maximal finish.', stepOverrides: [{ stepId: 'crit_surges', sets: 6, target: { type: 'rpe', min: 6, max: 8 } }, { stepId: 'crit_finish', omit: true }] }
    ],
    regressions: ['cycling_short_surges_10x20_01'], progressions: ['cycling_race_simulation_50_01'], substitutions: [],
    garmin: { exportable: true, supportedSport: 'cycling' },
    tags: ['race_specific', 'criterium', 'surge_tolerance', 'adjustable'],
    sourceNotes: ['Compact criterium-format session: short repeated surges with firm VO2-adjacent recoveries and a controlled fast finish, sized below full race simulation duration for time-limited race-specific work.']
  },
  {
    id: 'cycling_race_simulation_50_01', version: 1, status: 'active',
    name: 'Adjustable Variable Race Simulation',
    description: 'Peak-specific simulation with variable power, surges, limited coasting and a hard late finish.',
    modality: 'cycling', category: 'race_simulation', objectives: ['surge_tolerance', 'high_aerobic_power', 'fatigue_resistant_finish'],
    duration: { defaultMin: 75, minimumMin: 50, maximumMin: 95 },
    loadProfile: { cardiovascular: 5, muscular: 4, mechanical: 1, eccentric: 1, coordination: 4, recoveryHours: 72 },
    eligibility: { minimumReadiness: 8, maximumSoreness: 4, minimumDaysAfterHardLowerBody: 2, forbiddenPainFlags: ['knee_swelling', 'acute_knee_pain', 'worsening_achilles_pain'] },
    equipment: ['bike'], contraindicationTags: ['acute_knee_pain'], engineTemplateIds: ['end_race_sim_01'],
    blocks: [
      { id: 'warmup', name: 'Race warm-up', role: 'warmup', steps: [ timeStep('race_warmup', 'bike_progressive_warmup', 'Progressive warm-up', 900, { target: { type: 'rpe', min: 1, max: 4 } }) ]},
      { id: 'main', name: 'Variable race block', role: 'main', steps: [
        timeStep('race_variable', 'bike_over_under_interval', 'Variable power race block', 2400, { target: { type: 'rpe', min: 5, max: 8 }, notes: ['Include repeated short accelerations', 'Include optional longer gap-closing work', 'Limit coasting', 'Practise drafting when safe and available'] }),
        timeStep('race_finish', 'bike_hard_finish', 'Final hard effort', 90, { target: { type: 'rpe', min: 9, max: 10 }, notes: ['Execute after accumulated fatigue', 'Preserve cadence and position'] })
      ]},
      { id: 'cooldown', name: 'Cool-down', role: 'cooldown', steps: [ timeStep('race_cooldown', 'bike_easy_spin', 'Easy spin', 600, { target: { type: 'rpe', min: 1, max: 2 } }) ]}
    ],
    variants: [
      { id: 'full', targetDurationMin: 75, loadMultiplier: 1, rationale: 'Peak-specific full simulation.', stepOverrides: [] },
      { id: 'reduced', targetDurationMin: 60, loadMultiplier: 0.75, rationale: 'Shorten the variable block and keep one controlled hard finish.', stepOverrides: [{ stepId: 'race_variable', durationSeconds: 1800 }, { stepId: 'race_finish', durationSeconds: 60, target: { type: 'rpe', min: 8, max: 9 } }] },
      { id: 'return_to_training', targetDurationMin: 50, loadMultiplier: 0.55, rationale: 'Not a true simulation; use aerobic riding with a few submaximal surges.', stepOverrides: [{ stepId: 'race_variable', durationSeconds: 1500, target: { type: 'rpe', min: 3, max: 6 } }, { stepId: 'race_finish', omit: true }] }
    ],
    parameters: [
      { id: 'simulation_duration', label: 'Variable race block duration', unit: 'minutes', defaultValue: 40, minimum: 30, maximum: 60, step: 5, appliesToStepIds: ['race_variable'], bindings: [{ stepId: 'race_variable', property: 'duration.seconds' }], description: 'Adjust to the event format and phase while keeping the simulation infrequent.' },
      { id: 'short_surge_count', label: 'Short surge count', unit: 'repetitions', defaultValue: 8, minimum: 4, maximum: 12, step: 1, appliesToStepIds: ['race_variable'], bindings: [{ stepId: 'race_variable', property: 'sets' }], description: 'Short accelerations are embedded inside the variable block.' },
      { id: 'gap_close_count', label: 'Longer effort count', unit: 'repetitions', defaultValue: 1, minimum: 0, maximum: 2, step: 1, appliesToStepIds: ['race_variable'], bindings: [{ stepId: 'race_variable', property: 'sets', zeroBehavior: 'omit_step' }], description: 'Optional one-to-three-minute gap-closing work inside the simulation.' },
      { id: 'finish_duration', label: 'Hard finish duration', unit: 'seconds', defaultValue: 90, minimum: 60, maximum: 120, step: 30, appliesToStepIds: ['race_finish'], bindings: [{ stepId: 'race_finish', property: 'duration.seconds' }], description: 'Represents the final kilometre or equivalent fatigued finish.' }
    ],
    regressions: ['cycling_event_specific_endurance_01', 'cycling_over_under_3x12_01', 'cycling_short_surges_10x20_01'], progressions: ['cycling_taper_sharpening_01'], substitutions: [],
    garmin: { exportable: true, supportedSport: 'cycling' },
    tags: ['peak_specific', 'outdoor_preferred', 'hard_finish', 'adjustable'],
    sourceNotes: ['Macrocycle simulation target is 45–60 minutes with variable power, repeated surges, limited coasting, harder one-to-three-minute work and a hard final kilometre.']
  }
];
