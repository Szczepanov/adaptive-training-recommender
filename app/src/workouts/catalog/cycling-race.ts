import type { WorkoutDefinition } from '../models.ts';
import { timeStep } from './helpers.ts';

export const CYCLING_RACE_WORKOUTS: WorkoutDefinition[] = [
  {
      id: 'cycling_race_simulation_50_01', version: 1, status: 'active',
      name: '50-minute Variable Race Simulation',
      description: 'Peak-specific simulation with variable power, surges, limited coasting and a hard final kilometre equivalent.',
      modality: 'cycling', category: 'race_simulation', objectives: ['surge_tolerance', 'high_aerobic_power', 'fatigue_resistant_finish'],
      duration: { defaultMin: 75, minimumMin: 60, maximumMin: 90 },
      loadProfile: { cardiovascular: 5, muscular: 4, mechanical: 1, eccentric: 1, coordination: 4, recoveryHours: 72 },
      eligibility: { minimumReadiness: 8, maximumSoreness: 4, minimumDaysAfterHardLowerBody: 2, forbiddenPainFlags: ['knee_swelling', 'acute_knee_pain', 'worsening_achilles_pain'] },
      equipment: ['bike'], contraindicationTags: ['acute_knee_pain'],
      blocks: [
        { id: 'warmup', name: 'Race warm-up', role: 'warmup', steps: [
          timeStep('race_warmup', 'bike_progressive_warmup', 'Progressive warm-up', 900, { target: { type: 'rpe', min: 1, max: 4 } })
        ]},
        { id: 'main', name: 'Variable race block', role: 'main', steps: [
          timeStep('race_variable', 'bike_over_under_interval', 'Variable power race block', 2400, { target: { type: 'rpe', min: 5, max: 8 }, notes: ['Include repeated 10–30 sec accelerations', 'Include one harder 1–3 min section', 'Limit coasting', 'Practise drafting when safe and available'] }),
          timeStep('race_finish', 'bike_hard_finish', 'Final hard effort', 90, { target: { type: 'rpe', min: 9, max: 10 }, notes: ['Execute after accumulated fatigue', 'Preserve cadence and position'] })
        ]},
        { id: 'cooldown', name: 'Cool-down', role: 'cooldown', steps: [
          timeStep('race_cooldown', 'bike_easy_spin', 'Easy spin', 600, { target: { type: 'rpe', min: 1, max: 2 } })
        ]}
      ],
      variants: [
        { id: 'full', targetDurationMin: 75, loadMultiplier: 1, rationale: 'Peak-specific full simulation.', stepOverrides: [] },
        { id: 'reduced', targetDurationMin: 60, loadMultiplier: 0.75, rationale: 'Shorten the variable block and keep only one controlled hard finish.', stepOverrides: [{ stepId: 'race_variable', durationSeconds: 1800 }, { stepId: 'race_finish', durationSeconds: 60, target: { type: 'rpe', min: 8, max: 9 } }] },
        { id: 'return_to_training', targetDurationMin: 50, loadMultiplier: 0.55, rationale: 'Not a true simulation; use aerobic riding with a few submaximal surges.', stepOverrides: [{ stepId: 'race_variable', durationSeconds: 1500, target: { type: 'rpe', min: 3, max: 6 } }, { stepId: 'race_finish', omit: true }] }
      ],
      regressions: ['cycling_over_under_3x12_01', 'cycling_short_surges_10x20_01'], progressions: [], substitutions: [],
      garmin: { exportable: true, supportedSport: 'cycling' },
      tags: ['peak_specific', 'outdoor_preferred', 'hard_finish'],
      sourceNotes: ['Macrocycle simulation target is 45–60 minutes with variable power, repeated surges, limited coasting, harder 1–3 min work and a hard final kilometre.']
    }
];
