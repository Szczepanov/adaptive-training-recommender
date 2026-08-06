import type { WorkoutDefinition } from '../models.ts';
import { timeStep } from './helpers.ts';

export const BUILD_SUPPORT_WORKOUTS: WorkoutDefinition[] = [
  {
    id: 'cycling_event_specific_endurance_01', version: 1, status: 'active',
    name: 'Event-specific Endurance Ride',
    description: 'Adjustable outdoor endurance ride combining steady aerobic work, short accelerations, optional gap-closing work and a late controlled finish.',
    modality: 'cycling', category: 'race_simulation', objectives: ['aerobic_base', 'surge_tolerance', 'fatigue_resistant_finish'],
    duration: { defaultMin: 90, minimumMin: 50, maximumMin: 150 },
    loadProfile: { cardiovascular: 4, muscular: 3, mechanical: 1, eccentric: 1, coordination: 3, recoveryHours: 48 },
    eligibility: { minimumReadiness: 6, maximumSoreness: 6, minimumDaysAfterHardLowerBody: 1, forbiddenPainFlags: ['knee_swelling', 'acute_knee_pain'] },
    equipment: ['bike'], contraindicationTags: ['acute_knee_pain'],
    blocks: [
      { id: 'warmup', name: 'Progressive warm-up', role: 'warmup', steps: [
        timeStep('event_warmup', 'bike_progressive_warmup', 'Progressive warm-up', 900, { target: { type: 'rpe', min: 1, max: 3 } })
      ]},
      { id: 'main', name: 'Aerobic and event-specific work', role: 'main', steps: [
        timeStep('event_base', 'bike_easy_spin', 'Steady endurance riding', 3000, { target: { type: 'rpe', min: 2, max: 4 }, notes: ['Keep pedalling after every surge', 'Practise smooth positioning and drafting when safe'] }),
        timeStep('event_surges', 'bike_short_surge', 'Short acceleration', 20, { sets: 6, restAfterSec: 280, target: { type: 'rpe', min: 7, max: 9 }, notes: ['Submaximal unless explicitly designated as a test'] }),
        timeStep('event_gap_close', 'bike_threshold_interval', 'Gap-closing effort', 120, { sets: 1, restAfterSec: 300, target: { type: 'rpe', min: 7, max: 9 }, optional: true, notes: ['Return to meaningful pedalling rather than complete rest'] }),
        timeStep('event_finish', 'bike_hard_finish', 'Late hard finish', 90, { target: { type: 'rpe', min: 8, max: 10 }, optional: true })
      ]},
      { id: 'cooldown', name: 'Cool-down', role: 'cooldown', steps: [
        timeStep('event_cooldown', 'bike_easy_spin', 'Easy spin', 600, { target: { type: 'rpe', min: 1, max: 2 } })
      ]}
    ],
    variants: [
      { id: 'full', targetDurationMin: 90, loadMultiplier: 1, rationale: 'Use the full mix of aerobic riding and event-specific work.', stepOverrides: [] },
      { id: 'reduced', targetDurationMin: 65, loadMultiplier: 0.7, rationale: 'Shorten aerobic volume and reduce event-specific repetitions.', stepOverrides: [{ stepId: 'event_base', durationSeconds: 2100 }, { stepId: 'event_surges', sets: 4 }, { stepId: 'event_gap_close', omit: true }, { stepId: 'event_finish', durationSeconds: 60, target: { type: 'rpe', min: 7, max: 9 } }] },
      { id: 'return_to_training', targetDurationMin: 50, loadMultiplier: 0.5, rationale: 'Use easy aerobic riding with a few controlled accelerations only.', stepOverrides: [{ stepId: 'event_base', durationSeconds: 1800 }, { stepId: 'event_surges', sets: 3, target: { type: 'rpe', min: 5, max: 7 } }, { stepId: 'event_gap_close', omit: true }, { stepId: 'event_finish', omit: true }, { stepId: 'event_cooldown', durationSeconds: 300 }] }
    ],
    parameters: [
      { id: 'base_duration', label: 'Aerobic base duration', unit: 'minutes', defaultValue: 50, minimum: 30, maximum: 100, step: 5, appliesToStepIds: ['event_base'], bindings: [{ stepId: 'event_base', property: 'duration.seconds' }], description: 'Adjust total steady endurance volume without changing the session purpose.' },
      { id: 'surge_count', label: 'Short surge count', unit: 'repetitions', defaultValue: 6, minimum: 3, maximum: 12, step: 1, appliesToStepIds: ['event_surges'], bindings: [{ stepId: 'event_surges', property: 'sets' }], description: 'Progress surge count before making every effort harder.' },
      { id: 'surge_duration', label: 'Short surge duration', unit: 'seconds', defaultValue: 20, minimum: 10, maximum: 30, step: 5, appliesToStepIds: ['event_surges'], bindings: [{ stepId: 'event_surges', property: 'duration.seconds' }], description: 'Event-relevant acceleration duration.' },
      { id: 'gap_close_count', label: 'Gap-closing effort count', unit: 'sets', defaultValue: 1, minimum: 0, maximum: 2, step: 1, appliesToStepIds: ['event_gap_close'], bindings: [{ stepId: 'event_gap_close', property: 'sets', zeroBehavior: 'omit_step' }], description: 'Optional longer event-specific efforts.' },
      { id: 'gap_close_duration', label: 'Gap-closing effort duration', unit: 'seconds', defaultValue: 120, minimum: 60, maximum: 180, step: 30, appliesToStepIds: ['event_gap_close'], bindings: [{ stepId: 'event_gap_close', property: 'duration.seconds' }], description: 'Adjust within the expected one-to-three-minute event demand.' },
      { id: 'finish_duration', label: 'Late finish duration', unit: 'seconds', defaultValue: 90, minimum: 0, maximum: 120, step: 30, appliesToStepIds: ['event_finish'], bindings: [{ stepId: 'event_finish', property: 'duration.seconds', zeroBehavior: 'omit_step' }], description: 'Optional fatigued finish; zero means omit it.' }
    ],
    regressions: ['cycling_zone2_standard_01'], progressions: ['cycling_race_simulation_50_01'], substitutions: [],
    garmin: { exportable: true, supportedSport: 'cycling' },
    tags: ['outdoor_preferred', 'adjustable', 'event_specific', 'drafting_skill'],
    sourceNotes: ['Covers the weekly outdoor event-specific ride in the build and peak phases without requiring a full simulation every week.']
  },
  {
    id: 'cycling_gap_closing_01', version: 1, status: 'active',
    name: 'Adjustable Gap-closing Intervals',
    description: 'Longer event-specific efforts followed by continued moderate pedalling to train closing gaps without requiring complete recovery.',
    modality: 'cycling', category: 'surge_tolerance', objectives: ['high_aerobic_power', 'surge_tolerance'],
    duration: { defaultMin: 60, minimumMin: 40, maximumMin: 80 },
    loadProfile: { cardiovascular: 4, muscular: 4, mechanical: 1, eccentric: 1, coordination: 2, recoveryHours: 48 },
    eligibility: { minimumReadiness: 6, maximumSoreness: 6, minimumDaysAfterHardLowerBody: 1, forbiddenPainFlags: ['knee_swelling', 'acute_knee_pain'] },
    equipment: ['bike'], contraindicationTags: ['acute_knee_pain'],
    blocks: [
      { id: 'warmup', name: 'Warm-up', role: 'warmup', steps: [
        timeStep('gap_warmup', 'bike_progressive_warmup', 'Progressive warm-up', 900, { target: { type: 'rpe', min: 1, max: 3 } })
      ]},
      { id: 'main', name: 'Gap-closing work', role: 'main', steps: [
        timeStep('gap_efforts', 'bike_threshold_interval', 'Gap-closing effort', 120, { sets: 4, restAfterSec: 240, target: { type: 'rpe', min: 7, max: 9 }, notes: ['Recover while continuing to pedal', 'Keep the first effort repeatable rather than maximal'] }),
        timeStep('gap_aerobic_finish', 'bike_easy_spin', 'Steady aerobic finish', 1200, { target: { type: 'rpe', min: 2, max: 4 } })
      ]},
      { id: 'cooldown', name: 'Cool-down', role: 'cooldown', steps: [
        timeStep('gap_cooldown', 'bike_easy_spin', 'Easy spin', 480, { target: { type: 'rpe', min: 1, max: 2 } })
      ]}
    ],
    variants: [
      { id: 'full', targetDurationMin: 60, loadMultiplier: 1, rationale: 'Complete the chosen repeatable effort structure.', stepOverrides: [] },
      { id: 'reduced', targetDurationMin: 48, loadMultiplier: 0.72, rationale: 'Reduce effort count and preserve the aerobic finish.', stepOverrides: [{ stepId: 'gap_efforts', sets: 3 }, { stepId: 'gap_aerobic_finish', durationSeconds: 900 }] },
      { id: 'return_to_training', targetDurationMin: 40, loadMultiplier: 0.55, rationale: 'Use fewer shorter efforts at controlled intensity.', stepOverrides: [{ stepId: 'gap_efforts', sets: 2, durationSeconds: 60, target: { type: 'rpe', min: 5, max: 7 } }, { stepId: 'gap_aerobic_finish', durationSeconds: 900 }, { stepId: 'gap_cooldown', durationSeconds: 300 }] }
    ],
    parameters: [
      { id: 'effort_count', label: 'Effort count', unit: 'sets', defaultValue: 4, minimum: 3, maximum: 6, step: 1, appliesToStepIds: ['gap_efforts'], bindings: [{ stepId: 'gap_efforts', property: 'sets' }], description: 'Adjust the number of repeatable gap-closing efforts.' },
      { id: 'effort_duration', label: 'Effort duration', unit: 'seconds', defaultValue: 120, minimum: 30, maximum: 180, step: 30, appliesToStepIds: ['gap_efforts'], bindings: [{ stepId: 'gap_efforts', property: 'duration.seconds' }], description: 'Covers short high-lactate work through longer one-to-three-minute efforts.' },
      { id: 'recovery_duration', label: 'Pedalling recovery', unit: 'seconds', defaultValue: 240, minimum: 120, maximum: 360, step: 30, appliesToStepIds: ['gap_efforts'], bindings: [{ stepId: 'gap_efforts', property: 'restAfterSec' }], description: 'Recovery remains active rather than complete rest.' },
      { id: 'effort_rpe', label: 'Effort RPE', unit: 'rpe', defaultValue: 8, minimum: 6, maximum: 9, step: 0.5, appliesToStepIds: ['gap_efforts'], bindings: [{ stepId: 'gap_efforts', property: 'target.rpe.max' }], description: 'Use an RPE that keeps the set repeatable unless deliberately simulating the race.' }
    ],
    regressions: ['cycling_controlled_threshold_4x8_01'], progressions: ['cycling_event_specific_endurance_01'], substitutions: [],
    garmin: { exportable: true, supportedSport: 'cycling' },
    tags: ['adjustable', 'gap_closing', 'active_recovery_between_efforts'],
    sourceNotes: ['Covers the event demand for occasional 30–90-second and one-to-three-minute gap-closing work.']
  },
  {
    id: 'running_walk_run_01', version: 1, status: 'active',
    name: 'Optional Easy Walk-run',
    description: 'Adjustable low-intensity running exposure embedded inside walking for enjoyment and small impact maintenance.',
    modality: 'running', category: 'easy_endurance', objectives: ['running_exposure', 'aerobic_base'],
    duration: { defaultMin: 40, minimumMin: 25, maximumMin: 55 },
    loadProfile: { cardiovascular: 2, muscular: 2, mechanical: 3, eccentric: 3, coordination: 1, recoveryHours: 24 },
    eligibility: { minimumReadiness: 5, maximumSoreness: 5, minimumDaysAfterHardLowerBody: 1, forbiddenPainFlags: ['knee_swelling', 'worsening_achilles_pain', 'painful_braking'] },
    equipment: [], contraindicationTags: ['knee_swelling', 'worsening_achilles_pain'],
    blocks: [
      { id: 'warmup', name: 'Walking warm-up', role: 'warmup', steps: [ timeStep('walk_run_warmup', 'walk_run_easy', 'Easy walk', 600, { target: { type: 'rpe', min: 1, max: 2 } }) ]},
      { id: 'main', name: 'Walk-run exposure', role: 'main', steps: [ timeStep('walk_run_main', 'walk_run_easy', 'Alternating easy run and walk', 1200, { target: { type: 'rpe', min: 2, max: 3 }, notes: ['Flat predictable route', 'No hills, surges or fast finish', 'Stop running before calf or Achilles mechanics change'] }) ]},
      { id: 'cooldown', name: 'Walking cool-down', role: 'cooldown', steps: [ timeStep('walk_run_cooldown', 'walk_run_easy', 'Easy walk', 600, { target: { type: 'rpe', min: 1, max: 2 } }) ]}
    ],
    variants: [
      { id: 'full', targetDurationMin: 40, loadMultiplier: 1, rationale: 'Use the planned easy running exposure inside a longer walk.', stepOverrides: [] },
      { id: 'reduced', targetDurationMin: 30, loadMultiplier: 0.65, rationale: 'Reduce total running exposure and retain walking.', stepOverrides: [{ stepId: 'walk_run_main', durationSeconds: 720 }] },
      { id: 'return_to_training', targetDurationMin: 25, loadMultiplier: 0.4, rationale: 'Use mostly walking with only brief symptom-free jogging.', stepOverrides: [{ stepId: 'walk_run_main', durationSeconds: 420, target: { type: 'rpe', min: 1, max: 2 } }, { stepId: 'walk_run_cooldown', durationSeconds: 480 }] }
    ],
    parameters: [
      { id: 'total_running_minutes', label: 'Total easy running', unit: 'minutes', defaultValue: 18, minimum: 0, maximum: 25, step: 1, appliesToStepIds: ['walk_run_main'], bindings: [{ stepId: 'walk_run_main', property: 'duration.seconds', zeroBehavior: 'use_zero' }], description: 'Running volume inside the walk; zero converts the session to walking only.' },
      { id: 'run_interval_minutes', label: 'Run interval duration', unit: 'minutes', defaultValue: 3, minimum: 1, maximum: 5, step: 1, appliesToStepIds: ['walk_run_main'], bindings: [{ stepId: 'walk_run_main', property: 'duration.seconds' }], description: 'Keep individual running blocks short and quiet.' },
      { id: 'walk_interval_minutes', label: 'Walk interval duration', unit: 'minutes', defaultValue: 2, minimum: 1, maximum: 4, step: 1, appliesToStepIds: ['walk_run_main'], bindings: [{ stepId: 'walk_run_main', property: 'duration.seconds' }], description: 'Walking recovery between easy run blocks.' }
    ],
    regressions: ['recovery_mobility_tissue_01'], progressions: [], substitutions: [],
    garmin: { exportable: true, supportedSport: 'running' },
    tags: ['optional', 'adjustable', 'flat_route', 'impact_exposure'],
    sourceNotes: ['Matches the optional once-every-7–10-days walk-run rule and is removed first if it compromises cycling or lower-tissue recovery.']
  }
];
