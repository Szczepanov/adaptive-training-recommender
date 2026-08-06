import type { WorkoutDefinition } from '../models.ts';
import { timeStep } from './helpers.ts';

export const CYCLING_QUALITY_WORKOUTS: WorkoutDefinition[] = [
  {
    id: 'cycling_controlled_threshold_4x8_01', version: 1, status: 'active',
    name: 'Adjustable Controlled Threshold Intervals',
    description: 'Repeatable sustained work to improve race power and lactate clearance without accidental testing.',
    modality: 'cycling', category: 'threshold', objectives: ['lactate_threshold', 'high_aerobic_power'],
    duration: { defaultMin: 70, minimumMin: 45, maximumMin: 90 },
    loadProfile: { cardiovascular: 4, muscular: 3, mechanical: 1, eccentric: 1, coordination: 1, recoveryHours: 48 },
    eligibility: { minimumReadiness: 6, maximumSoreness: 6, minimumDaysAfterHardLowerBody: 1, forbiddenPainFlags: ['knee_swelling', 'acute_knee_pain'] },
    equipment: ['bike'], contraindicationTags: ['acute_knee_pain'],
    blocks: [
      { id: 'warmup', name: 'Progressive warm-up', role: 'warmup', steps: [
        timeStep('threshold_warmup', 'bike_progressive_warmup', 'Progressive warm-up', 720, { target: { type: 'rpe', min: 1, max: 3 } }),
        timeStep('threshold_cadence', 'bike_cadence_activation', 'Cadence activation', 180, { target: { type: 'cadence', minRpm: 95, maxRpm: 105 } })
      ]},
      { id: 'main', name: 'Threshold work', role: 'main', steps: [
        timeStep('threshold_repeats', 'bike_threshold_interval', 'Threshold interval', 480, { sets: 4, restAfterSec: 240, target: { type: 'ftp_percent', min: 88, max: 94 }, notes: ['Use device-specific power or RPE', 'Finish around RPE 7–8', 'No maximal final interval'] })
      ]},
      { id: 'cooldown', name: 'Cool-down', role: 'cooldown', steps: [ timeStep('threshold_cooldown', 'bike_easy_spin', 'Easy spin', 600, { target: { type: 'rpe', min: 1, max: 2 } }) ]}
    ],
    variants: [
      { id: 'full', targetDurationMin: 70, loadMultiplier: 1, rationale: 'Complete the selected repeatable threshold dose.', stepOverrides: [] },
      { id: 'reduced', targetDurationMin: 55, loadMultiplier: 0.75, rationale: 'Remove one interval while retaining session purpose.', stepOverrides: [{ stepId: 'threshold_repeats', sets: 3 }] },
      { id: 'return_to_training', targetDurationMin: 45, loadMultiplier: 0.6, rationale: 'Shift toward controlled tempo if warm-up response is uncertain.', stepOverrides: [{ stepId: 'threshold_repeats', sets: 3, durationSeconds: 360, target: { type: 'rpe', min: 5, max: 7 } }] }
    ],
    parameters: [
      { id: 'interval_count', label: 'Interval count', unit: 'sets', defaultValue: 4, minimum: 3, maximum: 5, step: 1, appliesToStepIds: ['threshold_repeats'], description: 'Progress count only after the existing structure remains repeatable.' },
      { id: 'interval_duration', label: 'Interval duration', unit: 'minutes', defaultValue: 8, minimum: 4, maximum: 12, step: 1, appliesToStepIds: ['threshold_repeats'], description: 'Increase duration before aggressively increasing intensity.' },
      { id: 'recovery_duration', label: 'Recovery duration', unit: 'minutes', defaultValue: 4, minimum: 2, maximum: 6, step: 1, appliesToStepIds: ['threshold_repeats'], description: 'Adjust to keep the set repeatable while continuing to pedal.' },
      { id: 'target_rpe', label: 'Target RPE', unit: 'rpe', defaultValue: 7.5, minimum: 6, maximum: 8, step: 0.5, appliesToStepIds: ['threshold_repeats'], description: 'Primary generic intensity control when device-specific power is uncertain.' }
    ],
    regressions: ['cycling_zone2_standard_01'], progressions: ['cycling_over_under_3x12_01', 'cycling_gap_closing_01'], substitutions: [],
    garmin: { exportable: true, supportedSport: 'cycling' },
    tags: ['quality', 'repeatable', 'power_or_rpe', 'adjustable'],
    sourceNotes: ['Macrocycle threshold rule: increase duration before power; planned repeats should usually finish RPE 7–8, not 9.5.']
  },
  {
    id: 'cycling_over_under_3x12_01', version: 1, status: 'active',
    name: 'Adjustable Race Over-under Blocks',
    description: 'Variable-power work that trains surges above sustainable power and recovery while still pedalling.',
    modality: 'cycling', category: 'over_under', objectives: ['lactate_threshold', 'surge_tolerance'],
    duration: { defaultMin: 75, minimumMin: 50, maximumMin: 95 },
    loadProfile: { cardiovascular: 4, muscular: 4, mechanical: 1, eccentric: 1, coordination: 2, recoveryHours: 54 },
    eligibility: { minimumReadiness: 7, maximumSoreness: 5, minimumDaysAfterHardLowerBody: 1, forbiddenPainFlags: ['knee_swelling', 'acute_knee_pain'] },
    equipment: ['bike'], contraindicationTags: ['acute_knee_pain'],
    blocks: [
      { id: 'warmup', name: 'Warm-up', role: 'warmup', steps: [ timeStep('ou_warmup', 'bike_progressive_warmup', 'Progressive warm-up', 900, { target: { type: 'rpe', min: 1, max: 3 } }) ]},
      { id: 'main', name: 'Over-under blocks', role: 'main', steps: [ timeStep('ou_repeats', 'bike_over_under_interval', 'Over-under block', 720, { sets: 3, restAfterSec: 300, target: { type: 'rpe', min: 6, max: 8 }, notes: ['Alternate brief surges with meaningful pedalling near sustainable power', 'Change only one or two progression variables at a time'] }) ]},
      { id: 'cooldown', name: 'Cool-down', role: 'cooldown', steps: [ timeStep('ou_cooldown', 'bike_easy_spin', 'Easy spin', 600, { target: { type: 'rpe', min: 1, max: 2 } }) ]}
    ],
    variants: [
      { id: 'full', targetDurationMin: 75, loadMultiplier: 1, rationale: 'Full event-specific variable-power dose.', stepOverrides: [] },
      { id: 'reduced', targetDurationMin: 58, loadMultiplier: 0.75, rationale: 'Use two blocks while preserving the surge-and-recover pattern.', stepOverrides: [{ stepId: 'ou_repeats', sets: 2 }] },
      { id: 'return_to_training', targetDurationMin: 50, loadMultiplier: 0.6, rationale: 'Reduce both block count and intensity variability.', stepOverrides: [{ stepId: 'ou_repeats', sets: 2, durationSeconds: 600, target: { type: 'rpe', min: 5, max: 7 } }] }
    ],
    parameters: [
      { id: 'block_count', label: 'Block count', unit: 'sets', defaultValue: 3, minimum: 2, maximum: 4, step: 1, appliesToStepIds: ['ou_repeats'], description: 'Adjust total over-under volume.' },
      { id: 'block_duration', label: 'Block duration', unit: 'minutes', defaultValue: 12, minimum: 8, maximum: 15, step: 1, appliesToStepIds: ['ou_repeats'], description: 'Progress total block duration gradually.' },
      { id: 'surge_duration', label: 'Internal surge duration', unit: 'seconds', defaultValue: 60, minimum: 30, maximum: 120, step: 15, appliesToStepIds: ['ou_repeats'], description: 'Adjust the above-sustainable portions inside each block.' },
      { id: 'recovery_duration', label: 'Between-block recovery', unit: 'minutes', defaultValue: 5, minimum: 3, maximum: 7, step: 1, appliesToStepIds: ['ou_repeats'], description: 'Recovery remains active and should preserve repeatability.' }
    ],
    regressions: ['cycling_controlled_threshold_4x8_01'], progressions: ['cycling_event_specific_endurance_01', 'cycling_race_simulation_50_01'], substitutions: [],
    garmin: { exportable: true, supportedSport: 'cycling' },
    tags: ['race_specific', 'variable_power', 'surge_recovery', 'adjustable'],
    sourceNotes: ['Macrocycle over-under purpose is tolerating surges and recovering while still pedalling near threshold.']
  },
  {
    id: 'cycling_short_surges_10x20_01', version: 1, status: 'active',
    name: 'Adjustable Short Surge Tolerance',
    description: 'Short accelerations for holding wheels, closing small gaps and returning to meaningful pedalling.',
    modality: 'cycling', category: 'surge_tolerance', objectives: ['surge_tolerance', 'fatigue_resistant_finish'],
    duration: { defaultMin: 60, minimumMin: 40, maximumMin: 75 },
    loadProfile: { cardiovascular: 4, muscular: 4, mechanical: 1, eccentric: 1, coordination: 3, recoveryHours: 48 },
    eligibility: { minimumReadiness: 6, maximumSoreness: 6, forbiddenPainFlags: ['knee_swelling', 'acute_knee_pain'] },
    equipment: ['bike'], contraindicationTags: ['acute_knee_pain'],
    blocks: [
      { id: 'warmup', name: 'Warm-up', role: 'warmup', steps: [ timeStep('surge_warmup', 'bike_progressive_warmup', 'Progressive warm-up', 900, { target: { type: 'rpe', min: 1, max: 3 } }) ]},
      { id: 'main', name: 'Surge set', role: 'main', steps: [ timeStep('surges', 'bike_short_surge', 'Short acceleration', 20, { sets: 10, restAfterSec: 160, target: { type: 'rpe', min: 8, max: 9 }, notes: ['Continue pedalling during recovery', 'Do not turn every surge into a sprint test'] }) ]},
      { id: 'cooldown', name: 'Aerobic finish', role: 'cooldown', steps: [ timeStep('surge_aerobic_finish', 'bike_easy_spin', 'Steady aerobic finish', 1200, { target: { type: 'rpe', min: 2, max: 3 } }) ]}
    ],
    variants: [
      { id: 'full', targetDurationMin: 60, loadMultiplier: 1, rationale: 'Complete the selected surge dose.', stepOverrides: [] },
      { id: 'reduced', targetDurationMin: 48, loadMultiplier: 0.75, rationale: 'Reduce surge count while maintaining quality.', stepOverrides: [{ stepId: 'surges', sets: 6 }, { stepId: 'surge_aerobic_finish', durationSeconds: 900 }] },
      { id: 'return_to_training', targetDurationMin: 42, loadMultiplier: 0.6, rationale: 'Use controlled accelerations with complete technical control.', stepOverrides: [{ stepId: 'surges', sets: 5, target: { type: 'rpe', min: 6, max: 8 } }, { stepId: 'surge_aerobic_finish', durationSeconds: 600 }] }
    ],
    parameters: [
      { id: 'surge_count', label: 'Surge count', unit: 'sets', defaultValue: 10, minimum: 6, maximum: 15, step: 1, appliesToStepIds: ['surges'], description: 'Adjust repetition count before increasing intensity.' },
      { id: 'surge_duration', label: 'Surge duration', unit: 'seconds', defaultValue: 20, minimum: 10, maximum: 30, step: 5, appliesToStepIds: ['surges'], description: 'Initial event-relevant acceleration range.' },
      { id: 'recovery_duration', label: 'Pedalling recovery', unit: 'seconds', defaultValue: 160, minimum: 90, maximum: 240, step: 10, appliesToStepIds: ['surges'], description: 'Recovery is incomplete but should preserve surge quality.' },
      { id: 'surge_rpe', label: 'Surge RPE', unit: 'rpe', defaultValue: 8.5, minimum: 7, maximum: 9, step: 0.5, appliesToStepIds: ['surges'], description: 'Keep most surges below maximal sprint effort.' }
    ],
    regressions: ['cycling_zone2_standard_01'], progressions: ['cycling_gap_closing_01', 'cycling_event_specific_endurance_01'], substitutions: [],
    garmin: { exportable: true, supportedSport: 'cycling' },
    tags: ['accelerations', 'wheel_holding', 'race_specific', 'adjustable'],
    sourceNotes: ['Macrocycle short-surge duration begins at 10–30 seconds with incomplete recovery while continuing to ride.']
  }
];
