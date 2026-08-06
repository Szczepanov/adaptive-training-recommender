import type { WorkoutDefinition } from '../models.ts';
import { timeStep } from './helpers.ts';

export const CYCLING_QUALITY_WORKOUTS: WorkoutDefinition[] = [
  {
      id: 'cycling_controlled_threshold_4x8_01', version: 1, status: 'active',
      name: 'Controlled Threshold 4 × 8 min',
      description: 'Repeatable sustained work to improve race power and lactate clearance without accidental testing.',
      modality: 'cycling', category: 'threshold', objectives: ['lactate_threshold', 'high_aerobic_power'],
      duration: { defaultMin: 70, minimumMin: 50, maximumMin: 85 },
      loadProfile: { cardiovascular: 4, muscular: 3, mechanical: 1, eccentric: 1, coordination: 1, recoveryHours: 48 },
      eligibility: { minimumReadiness: 6, maximumSoreness: 6, minimumDaysAfterHardLowerBody: 1, forbiddenPainFlags: ['knee_swelling', 'acute_knee_pain'] },
      equipment: ['bike'], contraindicationTags: ['acute_knee_pain'],
      blocks: [
        { id: 'warmup', name: 'Progressive warm-up', role: 'warmup', steps: [
          timeStep('threshold_warmup', 'bike_progressive_warmup', 'Progressive warm-up', 720, { target: { type: 'rpe', min: 1, max: 3 } }),
          timeStep('threshold_cadence', 'bike_cadence_activation', 'Cadence activation', 180, { target: { type: 'cadence', minRpm: 95, maxRpm: 105 } })
        ]},
        { id: 'main', name: 'Threshold work', role: 'main', steps: [
          timeStep('threshold_repeats', 'bike_threshold_interval', 'Threshold interval', 480, { sets: 4, restAfterSec: 240, target: { type: 'ftp_percent', min: 88, max: 94 }, notes: ['Use device-specific power', 'Finish around RPE 7–8', 'No maximal final interval'] })
        ]},
        { id: 'cooldown', name: 'Cool-down', role: 'cooldown', steps: [
          timeStep('threshold_cooldown', 'bike_easy_spin', 'Easy spin', 600, { target: { type: 'rpe', min: 1, max: 2 } })
        ]}
      ],
      variants: [
        { id: 'full', targetDurationMin: 70, loadMultiplier: 1, rationale: 'Complete the planned repeatable threshold dose.', stepOverrides: [] },
        { id: 'reduced', targetDurationMin: 55, loadMultiplier: 0.75, rationale: 'Remove one interval while retaining session purpose.', stepOverrides: [{ stepId: 'threshold_repeats', sets: 3 }] },
        { id: 'return_to_training', targetDurationMin: 45, loadMultiplier: 0.6, rationale: 'Shift toward controlled tempo if warm-up response is uncertain.', stepOverrides: [{ stepId: 'threshold_repeats', sets: 3, durationSeconds: 360, target: { type: 'ftp_percent', min: 80, max: 88 } }] }
      ],
      regressions: ['cycling_zone2_standard_01'], progressions: ['cycling_over_under_3x12_01'], substitutions: [],
      garmin: { exportable: true, supportedSport: 'cycling' },
      tags: ['quality', 'repeatable', 'power_or_rpe'],
      sourceNotes: ['Macrocycle threshold rule: increase duration before power; planned repeats should usually finish RPE 7–8, not 9.5.']
    },
  {
      id: 'cycling_over_under_3x12_01', version: 1, status: 'active',
      name: 'Race Over-unders 3 × 12 min',
      description: 'Variable-power work that trains surges above sustainable power and recovery while still pedalling.',
      modality: 'cycling', category: 'over_under', objectives: ['lactate_threshold', 'surge_tolerance'],
      duration: { defaultMin: 75, minimumMin: 55, maximumMin: 90 },
      loadProfile: { cardiovascular: 4, muscular: 4, mechanical: 1, eccentric: 1, coordination: 2, recoveryHours: 54 },
      eligibility: { minimumReadiness: 7, maximumSoreness: 5, minimumDaysAfterHardLowerBody: 1, forbiddenPainFlags: ['knee_swelling', 'acute_knee_pain'] },
      equipment: ['bike'], contraindicationTags: ['acute_knee_pain'],
      blocks: [
        { id: 'warmup', name: 'Warm-up', role: 'warmup', steps: [
          timeStep('ou_warmup', 'bike_progressive_warmup', 'Progressive warm-up', 900, { target: { type: 'rpe', min: 1, max: 3 } })
        ]},
        { id: 'main', name: 'Over-under blocks', role: 'main', steps: [
          timeStep('ou_repeats', 'bike_over_under_interval', '12-minute over-under block', 720, { sets: 3, restAfterSec: 300, target: { type: 'rpe', min: 6, max: 8 }, notes: ['Alternate 60–90 sec just above sustainable power with 2–3 min near threshold', 'Change only one or two progression variables at a time'] })
        ]},
        { id: 'cooldown', name: 'Cool-down', role: 'cooldown', steps: [
          timeStep('ou_cooldown', 'bike_easy_spin', 'Easy spin', 600, { target: { type: 'rpe', min: 1, max: 2 } })
        ]}
      ],
      variants: [
        { id: 'full', targetDurationMin: 75, loadMultiplier: 1, rationale: 'Full event-specific variable-power dose.', stepOverrides: [] },
        { id: 'reduced', targetDurationMin: 58, loadMultiplier: 0.75, rationale: 'Use two blocks while preserving the surge-and-recover pattern.', stepOverrides: [{ stepId: 'ou_repeats', sets: 2 }] },
        { id: 'return_to_training', targetDurationMin: 50, loadMultiplier: 0.6, rationale: 'Reduce both block count and intensity variability.', stepOverrides: [{ stepId: 'ou_repeats', sets: 2, durationSeconds: 600, target: { type: 'rpe', min: 5, max: 7 } }] }
      ],
      regressions: ['cycling_controlled_threshold_4x8_01'], progressions: ['cycling_race_simulation_50_01'], substitutions: [],
      garmin: { exportable: true, supportedSport: 'cycling' },
      tags: ['race_specific', 'variable_power', 'surge_recovery'],
      sourceNotes: ['Macrocycle over-under purpose is tolerating surges and recovering while still pedalling near threshold.']
    },
  {
      id: 'cycling_short_surges_10x20_01', version: 1, status: 'active',
      name: 'Short Surge Tolerance 10 × 20 sec',
      description: 'Short accelerations for holding wheels, closing gaps and returning to meaningful pedalling.',
      modality: 'cycling', category: 'surge_tolerance', objectives: ['surge_tolerance', 'fatigue_resistant_finish'],
      duration: { defaultMin: 60, minimumMin: 45, maximumMin: 75 },
      loadProfile: { cardiovascular: 4, muscular: 4, mechanical: 1, eccentric: 1, coordination: 3, recoveryHours: 48 },
      eligibility: { minimumReadiness: 6, maximumSoreness: 6, forbiddenPainFlags: ['knee_swelling', 'acute_knee_pain'] },
      equipment: ['bike'], contraindicationTags: ['acute_knee_pain'],
      blocks: [
        { id: 'warmup', name: 'Warm-up', role: 'warmup', steps: [
          timeStep('surge_warmup', 'bike_progressive_warmup', 'Progressive warm-up', 900, { target: { type: 'rpe', min: 1, max: 3 } })
        ]},
        { id: 'main', name: 'Surge set', role: 'main', steps: [
          timeStep('surges', 'bike_short_surge', '20-second acceleration', 20, { sets: 10, restAfterSec: 160, target: { type: 'rpe', min: 8, max: 9 }, notes: ['Continue pedalling during recovery', 'Do not turn every surge into a sprint test'] })
        ]},
        { id: 'cooldown', name: 'Aerobic finish', role: 'cooldown', steps: [
          timeStep('surge_aerobic_finish', 'bike_easy_spin', 'Steady aerobic finish', 1200, { target: { type: 'rpe', min: 2, max: 3 } })
        ]}
      ],
      variants: [
        { id: 'full', targetDurationMin: 60, loadMultiplier: 1, rationale: 'Complete the planned surge count.', stepOverrides: [] },
        { id: 'reduced', targetDurationMin: 48, loadMultiplier: 0.75, rationale: 'Reduce surge count while maintaining quality.', stepOverrides: [{ stepId: 'surges', sets: 6 }, { stepId: 'surge_aerobic_finish', durationSeconds: 900 }] },
        { id: 'return_to_training', targetDurationMin: 42, loadMultiplier: 0.6, rationale: 'Use controlled accelerations with complete technical control.', stepOverrides: [{ stepId: 'surges', sets: 5, target: { type: 'rpe', min: 6, max: 8 } }, { stepId: 'surge_aerobic_finish', durationSeconds: 600 }] }
      ],
      regressions: ['cycling_zone2_standard_01'], progressions: ['cycling_race_simulation_50_01'], substitutions: [],
      garmin: { exportable: true, supportedSport: 'cycling' },
      tags: ['accelerations', 'wheel_holding', 'race_specific'],
      sourceNotes: ['Macrocycle short-surge duration begins at 10–30 seconds with incomplete recovery while continuing to ride.']
    }
];
