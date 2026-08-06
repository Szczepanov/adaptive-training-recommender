import type { WorkoutDefinition } from '../models.ts';
import { repsStep, timeStep } from './helpers.ts';

export const TAPER_RACE_WORKOUTS: WorkoutDefinition[] = [
  {
    id: 'cycling_taper_sharpening_01', version: 1, status: 'active',
    name: 'Taper Sharpening Ride',
    description: 'Short adjustable quality session that retains event-specific intensity while reducing total training volume.',
    modality: 'cycling', category: 'surge_tolerance', objectives: ['high_aerobic_power', 'surge_tolerance', 'freshness'],
    duration: { defaultMin: 45, minimumMin: 30, maximumMin: 55 },
    loadProfile: { cardiovascular: 4, muscular: 3, mechanical: 1, eccentric: 1, coordination: 2, recoveryHours: 36 },
    eligibility: { minimumReadiness: 6, maximumSoreness: 5, minimumDaysAfterHardLowerBody: 1, forbiddenPainFlags: ['knee_swelling', 'acute_knee_pain'] },
    equipment: ['bike'], contraindicationTags: ['acute_knee_pain'],
    blocks: [
      { id: 'warmup', name: 'Warm-up', role: 'warmup', steps: [ timeStep('sharpen_warmup', 'bike_progressive_warmup', 'Progressive warm-up', 720, { target: { type: 'rpe', min: 1, max: 3 } }) ]},
      { id: 'main', name: 'Brief quality', role: 'main', steps: [
        timeStep('sharpen_efforts', 'bike_threshold_interval', 'Controlled race-specific effort', 120, { sets: 3, restAfterSec: 300, target: { type: 'rpe', min: 7, max: 8 }, notes: ['Keep every effort crisp and repeatable', 'Stop before the session creates residual fatigue'] }),
        timeStep('sharpen_surges', 'bike_short_surge', 'Short acceleration', 15, { sets: 3, restAfterSec: 180, target: { type: 'rpe', min: 7, max: 9 }, optional: true })
      ]},
      { id: 'cooldown', name: 'Cool-down', role: 'cooldown', steps: [ timeStep('sharpen_cooldown', 'bike_easy_spin', 'Easy spin', 600, { target: { type: 'rpe', min: 1, max: 2 } }) ]}
    ],
    variants: [
      { id: 'full', targetDurationMin: 45, loadMultiplier: 1, rationale: 'Normal taper sharpening stimulus.', stepOverrides: [] },
      { id: 'reduced', targetDurationMin: 35, loadMultiplier: 0.7, rationale: 'Use two efforts and omit extra surges.', stepOverrides: [{ stepId: 'sharpen_efforts', sets: 2 }, { stepId: 'sharpen_surges', omit: true }, { stepId: 'sharpen_cooldown', durationSeconds: 480 }] },
      { id: 'return_to_training', targetDurationMin: 30, loadMultiplier: 0.5, rationale: 'Use easy riding with two controlled sub-threshold efforts.', stepOverrides: [{ stepId: 'sharpen_efforts', sets: 2, durationSeconds: 60, target: { type: 'rpe', min: 5, max: 7 } }, { stepId: 'sharpen_surges', omit: true }, { stepId: 'sharpen_cooldown', durationSeconds: 420 }] }
    ],
    parameters: [
      { id: 'stimulus_count', label: 'Quality effort count', unit: 'sets', defaultValue: 3, minimum: 2, maximum: 5, step: 1, appliesToStepIds: ['sharpen_efforts'], bindings: [{ stepId: 'sharpen_efforts', property: 'sets' }], description: 'Use the smallest dose that preserves confidence and sharpness.' },
      { id: 'stimulus_duration', label: 'Quality effort duration', unit: 'seconds', defaultValue: 120, minimum: 60, maximum: 180, step: 30, appliesToStepIds: ['sharpen_efforts'], bindings: [{ stepId: 'sharpen_efforts', property: 'duration.seconds' }], description: 'Keep the final taper stimulus brief.' },
      { id: 'surge_count', label: 'Short acceleration count', unit: 'sets', defaultValue: 3, minimum: 0, maximum: 5, step: 1, appliesToStepIds: ['sharpen_surges'], bindings: [{ stepId: 'sharpen_surges', property: 'sets', zeroBehavior: 'omit_step' }], description: 'Optional extra event-specific sharpness without fatigue.' }
    ],
    regressions: ['cycling_zone2_standard_01'], progressions: ['cycling_pre_race_openers_01'], substitutions: [],
    garmin: { exportable: true, supportedSport: 'cycling' },
    tags: ['taper', 'adjustable', 'brief_intensity', 'freshness'],
    sourceNotes: ['Covers the final meaningful but short cycling stimulus in either event-date branch.']
  },
  {
    id: 'cycling_pre_race_openers_01', version: 1, status: 'active',
    name: 'Pre-race Openers',
    description: 'Very short adjustable activation ride used only when it improves freshness, confidence and leg speed.',
    modality: 'cycling', category: 'surge_tolerance', objectives: ['freshness', 'race_execution'],
    duration: { defaultMin: 30, minimumMin: 20, maximumMin: 40 },
    loadProfile: { cardiovascular: 2, muscular: 2, mechanical: 1, eccentric: 1, coordination: 2, recoveryHours: 12 },
    eligibility: { minimumReadiness: 5, maximumSoreness: 5, forbiddenPainFlags: ['knee_swelling', 'acute_knee_pain'] },
    equipment: ['bike'], contraindicationTags: ['acute_knee_pain'],
    blocks: [
      { id: 'warmup', name: 'Easy warm-up', role: 'warmup', steps: [ timeStep('openers_warmup', 'bike_easy_spin', 'Easy riding', 720, { target: { type: 'rpe', min: 1, max: 2 } }) ]},
      { id: 'activation', name: 'Openers', role: 'activation', steps: [
        timeStep('openers_cadence', 'bike_cadence_activation', 'Fast-cadence opener', 15, { sets: 3, restAfterSec: 180, target: { type: 'cadence', minRpm: 100, maxRpm: 120 } }),
        timeStep('openers_effort', 'bike_short_surge', 'Controlled race-intensity touch', 45, { sets: 1, restAfterSec: 300, target: { type: 'rpe', min: 7, max: 8 }, optional: true })
      ]},
      { id: 'cooldown', name: 'Easy finish', role: 'cooldown', steps: [ timeStep('openers_cooldown', 'bike_easy_spin', 'Easy finish', 480, { target: { type: 'rpe', min: 1, max: 2 } }) ]}
    ],
    variants: [
      { id: 'full', targetDurationMin: 30, loadMultiplier: 1, rationale: 'Use the normal opener dose when it consistently improves race-day feel.', stepOverrides: [] },
      { id: 'reduced', targetDurationMin: 22, loadMultiplier: 0.65, rationale: 'Use two cadence openers and omit the longer touch.', stepOverrides: [{ stepId: 'openers_warmup', durationSeconds: 600 }, { stepId: 'openers_cadence', sets: 2 }, { stepId: 'openers_effort', omit: true }, { stepId: 'openers_cooldown', durationSeconds: 360 }] },
      { id: 'return_to_training', targetDurationMin: 20, loadMultiplier: 0.4, rationale: 'Easy spin only; use complete rest instead when symptoms or fatigue are present.', stepOverrides: [{ stepId: 'openers_warmup', durationSeconds: 600 }, { stepId: 'openers_cadence', omit: true }, { stepId: 'openers_effort', omit: true }, { stepId: 'openers_cooldown', durationSeconds: 600 }] }
    ],
    parameters: [
      { id: 'opener_count', label: 'Opener count', unit: 'sets', defaultValue: 3, minimum: 0, maximum: 5, step: 1, appliesToStepIds: ['openers_cadence'], bindings: [{ stepId: 'openers_cadence', property: 'sets', zeroBehavior: 'omit_step' }], description: 'Zero converts the workout to an easy spin.' },
      { id: 'opener_duration', label: 'Opener duration', unit: 'seconds', defaultValue: 15, minimum: 10, maximum: 30, step: 5, appliesToStepIds: ['openers_cadence'], bindings: [{ stepId: 'openers_cadence', property: 'duration.seconds' }], description: 'Keep activation short enough to avoid fatigue.' },
      { id: 'race_touch_duration', label: 'Race-intensity touch', unit: 'seconds', defaultValue: 45, minimum: 0, maximum: 60, step: 15, appliesToStepIds: ['openers_effort'], bindings: [{ stepId: 'openers_effort', property: 'duration.seconds', zeroBehavior: 'omit_step' }], description: 'Optional controlled effort; zero means omit.' }
    ],
    regressions: ['rest_complete_01'], progressions: ['cycling_race_day_01'], substitutions: [],
    garmin: { exportable: true, supportedSport: 'cycling' },
    tags: ['race_week', 'openers', 'adjustable', 'freshness'],
    sourceNotes: ['Covers the short openers-or-rest decision immediately before the event.']
  },
  {
    id: 'strength_race_week_primer_01', version: 1, status: 'active',
    name: 'Race-week Strength Primer',
    description: 'Short early-week neural and strength-maintenance session with sharply reduced volume and no grinding.',
    modality: 'strength', category: 'power_maintenance', objectives: ['power_maintenance', 'strength_maintenance', 'freshness'],
    duration: { defaultMin: 30, minimumMin: 18, maximumMin: 35 },
    loadProfile: { cardiovascular: 1, muscular: 2, mechanical: 2, eccentric: 1, coordination: 3, recoveryHours: 24 },
    eligibility: { minimumReadiness: 5, maximumSoreness: 5, minimumDaysAfterHardLowerBody: 1, forbiddenPainFlags: ['knee_swelling', 'worsening_achilles_pain'] },
    equipment: ['medicine_ball', 'barbell', 'rack', 'bench', 'pullup_bar'], contraindicationTags: ['knee_swelling'],
    blocks: [
      { id: 'activation', name: 'Fast activation', role: 'activation', steps: [ repsStep('primer_slam', 'medicine_ball_slam', 'Medicine-ball slam', 4, { sets: 3, restAfterSec: 60, target: { type: 'technical_quality', cue: 'Fast, crisp and clearly submaximal.' } }) ]},
      { id: 'main', name: 'Low-volume maintenance', role: 'main', steps: [
        repsStep('primer_squat', 'front_squat', 'Front squat', 3, { sets: 2, restAfterSec: 120, target: { type: 'reps_in_reserve', min: 5, max: 7 } }),
        repsStep('primer_bench', 'bench_press', 'Bench press', 5, { sets: 2, restAfterSec: 90, target: { type: 'reps_in_reserve', min: 4, max: 7 } }),
        repsStep('primer_pull', 'pull_up', 'Pull-up', 4, { sets: 2, restAfterSec: 75, target: { type: 'reps_in_reserve', min: 4, max: 7 } })
      ]}
    ],
    variants: [
      { id: 'full', targetDurationMin: 30, loadMultiplier: 1, rationale: 'Normal race-week primer early in the week.', stepOverrides: [] },
      { id: 'reduced', targetDurationMin: 22, loadMultiplier: 0.65, rationale: 'Remove one movement or one activation set.', stepOverrides: [{ stepId: 'primer_slam', sets: 2 }, { stepId: 'primer_squat', sets: 1 }, { stepId: 'primer_bench', sets: 2 }, { stepId: 'primer_pull', sets: 2 }] },
      { id: 'return_to_training', targetDurationMin: 18, loadMultiplier: 0.4, rationale: 'Use upper body and easy activation only.', stepOverrides: [{ stepId: 'primer_slam', sets: 2 }, { stepId: 'primer_squat', omit: true }, { stepId: 'primer_bench', sets: 2, target: { type: 'reps_in_reserve', min: 6, max: 8 } }, { stepId: 'primer_pull', sets: 2, target: { type: 'reps_in_reserve', min: 6, max: 8 } }] }
    ],
    parameters: [
      { id: 'primer_sets', label: 'Working sets', unit: 'sets', defaultValue: 2, minimum: 1, maximum: 2, step: 1, appliesToStepIds: ['primer_squat', 'primer_bench', 'primer_pull'], bindings: [{ stepId: 'primer_squat', property: 'sets' }, { stepId: 'primer_bench', property: 'sets' }, { stepId: 'primer_pull', property: 'sets' }], description: 'Race-week strength volume remains 30–50% below normal.' },
      { id: 'primer_rir', label: 'Repetitions in reserve', unit: 'repetitions', defaultValue: 6, minimum: 4, maximum: 8, step: 1, appliesToStepIds: ['primer_squat', 'primer_bench', 'primer_pull'], bindings: [{ stepId: 'primer_squat', property: 'target.rpe.max' }, { stepId: 'primer_bench', property: 'target.rpe.max' }, { stepId: 'primer_pull', property: 'target.rpe.max' }], description: 'Keep every repetition fast and non-fatiguing.' }
    ],
    regressions: ['strength_upper_body_trunk_01'], progressions: [], substitutions: [{ exerciseId: 'front_squat', substituteExerciseId: 'goblet_squat', reason: 'Use a lighter simple squat pattern when appropriate.' }],
    garmin: { exportable: false },
    tags: ['race_week', 'primer', 'low_volume', 'freshness'],
    sourceNotes: ['Implements the final short strength-maintenance exposure with approximately 30–50% less volume.']
  },
  {
    id: 'cycling_race_day_01', version: 1, status: 'active',
    name: 'Cycling Event — Race Day',
    description: 'Generic event-day structure for warm-up, variable group-race execution, repeated surges and a final fatigued effort.',
    modality: 'cycling', category: 'race_simulation', objectives: ['race_execution', 'surge_tolerance', 'fatigue_resistant_finish'],
    duration: { defaultMin: 70, minimumMin: 30, maximumMin: 90 },
    loadProfile: { cardiovascular: 5, muscular: 5, mechanical: 1, eccentric: 1, coordination: 5, recoveryHours: 96 },
    eligibility: { minimumReadiness: 1, maximumSoreness: 10, forbiddenPainFlags: ['knee_swelling', 'acute_knee_pain', 'worsening_achilles_pain'] },
    equipment: ['bike'], contraindicationTags: ['acute_knee_pain'],
    blocks: [
      { id: 'warmup', name: 'Race warm-up', role: 'warmup', steps: [ timeStep('race_day_warmup', 'bike_progressive_warmup', 'Progressive race warm-up', 900, { target: { type: 'rpe', min: 1, max: 5 }, notes: ['Include only the activation needed to feel ready', 'Do not win the warm-up'] }) ]},
      { id: 'main', name: 'Race execution', role: 'main', steps: [
        timeStep('race_day_main', 'bike_over_under_interval', 'Variable group-race effort', 3000, { target: { type: 'rpe', min: 6, max: 10 }, notes: ['Prioritize drafting and wheel-holding', 'Recover while still pedalling', 'Avoid unnecessary braking and gaps'] }),
        timeStep('race_day_finish', 'bike_hard_finish', 'Final hard kilometre equivalent', 90, { target: { type: 'rpe', min: 9, max: 10 }, notes: ['Commit after accumulated fatigue while preserving position and cadence'] })
      ]},
      { id: 'cooldown', name: 'Post-race spin', role: 'cooldown', steps: [ timeStep('race_day_cooldown', 'bike_easy_spin', 'Easy post-race spin', 600, { target: { type: 'rpe', min: 1, max: 2 }, optional: true }) ]}
    ],
    variants: [
      { id: 'full', targetDurationMin: 70, loadMultiplier: 1, rationale: 'Planned event-day execution.', stepOverrides: [] },
      { id: 'reduced', targetDurationMin: 55, loadMultiplier: 0.8, rationale: 'Represents a shorter event format or abbreviated warm-up/cool-down.', stepOverrides: [{ stepId: 'race_day_warmup', durationSeconds: 720 }, { stepId: 'race_day_main', durationSeconds: 2400 }, { stepId: 'race_day_cooldown', durationSeconds: 420 }] },
      { id: 'return_to_training', targetDurationMin: 30, loadMultiplier: 0.4, rationale: 'Not a race prescription; use easy riding when the event is skipped or symptoms prevent racing.', stepOverrides: [{ stepId: 'race_day_warmup', durationSeconds: 600 }, { stepId: 'race_day_main', durationSeconds: 900, target: { type: 'rpe', min: 2, max: 4 } }, { stepId: 'race_day_finish', omit: true }, { stepId: 'race_day_cooldown', durationSeconds: 300 }] }
    ],
    parameters: [
      { id: 'event_duration', label: 'Expected race duration', unit: 'minutes', defaultValue: 50, minimum: 40, maximum: 60, step: 5, appliesToStepIds: ['race_day_main'], bindings: [{ stepId: 'race_day_main', property: 'duration.seconds' }], description: 'Adjust to the confirmed event format.' },
      { id: 'warmup_duration', label: 'Warm-up duration', unit: 'minutes', defaultValue: 15, minimum: 10, maximum: 25, step: 5, appliesToStepIds: ['race_day_warmup'], bindings: [{ stepId: 'race_day_warmup', property: 'duration.seconds' }], description: 'Enough activation to feel ready without accumulating fatigue.' },
      { id: 'finish_duration', label: 'Final hard effort', unit: 'seconds', defaultValue: 90, minimum: 60, maximum: 120, step: 30, appliesToStepIds: ['race_day_finish'], bindings: [{ stepId: 'race_day_finish', property: 'duration.seconds' }], description: 'Represents the final kilometre or equivalent event finish.' }
    ],
    regressions: ['cycling_pre_race_openers_01'], progressions: [], substitutions: [],
    garmin: { exportable: false },
    tags: ['race_day', 'group_race', 'drafting', 'hard_finish'],
    sourceNotes: ['Represents the expected approximately 50-minute road event and preserves adjustable event-duration assumptions.']
  },
  {
    id: 'rest_complete_01', version: 1, status: 'active',
    name: 'Complete Rest',
    description: 'A deliberate no-training day used when passive recovery is the correct prescription.',
    modality: 'recovery', category: 'recovery', objectives: ['freshness'],
    duration: { defaultMin: 0, minimumMin: 0, maximumMin: 0 },
    loadProfile: { cardiovascular: 1, muscular: 1, mechanical: 1, eccentric: 1, coordination: 1, recoveryHours: 0 },
    eligibility: {}, equipment: [], contraindicationTags: [],
    blocks: [{ id: 'main', name: 'No training', role: 'main', steps: [{ id: 'complete_rest', exerciseId: 'complete_rest_protocol', name: 'Complete rest protocol', duration: { type: 'open' }, notes: ['Ordinary daily movement is allowed', 'Do not compensate for missed training later'] }] }],
    variants: [
      { id: 'full', targetDurationMin: 0, loadMultiplier: 1, rationale: 'Complete passive recovery.', stepOverrides: [] },
      { id: 'reduced', targetDurationMin: 0, loadMultiplier: 1, rationale: 'Rest remains rest; no extra workout is added.', stepOverrides: [] },
      { id: 'return_to_training', targetDurationMin: 0, loadMultiplier: 1, rationale: 'Use rest when symptoms or fatigue make training inappropriate.', stepOverrides: [] }
    ],
    regressions: [], progressions: ['recovery_mobility_tissue_01', 'cycling_recovery_spin_01'], substitutions: [],
    garmin: { exportable: false },
    tags: ['rest', 'taper', 'red_light', 'freshness'],
    sourceNotes: ['Covers complete rest days in normal build, travel, taper and immediately before the event.']
  }
];
