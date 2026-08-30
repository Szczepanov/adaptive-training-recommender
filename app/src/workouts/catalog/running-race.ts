import type { WorkoutDefinition } from '../models.ts';
import { timeStep } from './helpers.ts';

export const RUNNING_RACE_WORKOUTS: WorkoutDefinition[] = [
  {
    id: 'running_long_run_01', version: 1, status: 'active',
    name: 'Long Aerobic Run',
    description: 'Progressive long-run exposure for half-marathon and marathon durability. Keeps most of the session easy; duration is capped by the athlete time budget and current planned dose.',
    modality: 'running', category: 'easy_endurance', objectives: ['aerobic_base', 'fatigue_resistant_finish'],
    duration: { defaultMin: 90, minimumMin: 60, maximumMin: 180 },
    loadProfile: { cardiovascular: 4, muscular: 3, mechanical: 4, eccentric: 4, coordination: 1, recoveryHours: 48 },
    eligibility: { minimumReadiness: 6, maximumSoreness: 4, minimumDaysAfterHardLowerBody: 1, forbiddenPainFlags: ['knee_swelling', 'worsening_achilles_pain', 'painful_braking'] },
    equipment: [], contraindicationTags: ['knee_swelling', 'worsening_achilles_pain'], engineTemplateIds: ['run_long_01'],
    blocks: [
      { id: 'warmup', name: 'Warm-up', role: 'warmup', steps: [
        timeStep('long_run_warmup', 'easy_continuous_run', 'Easy jog', 600, { target: { type: 'rpe', min: 1, max: 2 } })
      ]},
      { id: 'main', name: 'Long aerobic running', role: 'main', steps: [
        timeStep('long_run_main', 'easy_continuous_run', 'Progressive long run', 4500, { target: { type: 'rpe', min: 2, max: 4 }, notes: ['Keep the large majority of the run easy and conversational.', 'A modest late pickup is optional; do not turn this into a race simulation.', 'Stop or walk if landing mechanics change.'] })
      ]},
      { id: 'cooldown', name: 'Cool-down', role: 'cooldown', steps: [
        timeStep('long_run_cooldown', 'easy_continuous_run', 'Easy jog or walk', 300, { target: { type: 'rpe', min: 1, max: 2 } })
      ]}
    ],
    variants: [
      { id: 'full', targetDurationMin: 90, loadMultiplier: 1, rationale: 'Use the currently planned long-run duration.', stepOverrides: [] },
      { id: 'reduced', targetDurationMin: 65, loadMultiplier: 0.7, rationale: 'Shorten the long run while preserving continuous aerobic exposure.', stepOverrides: [{ stepId: 'long_run_main', durationSeconds: 3000 }] },
      { id: 'return_to_training', targetDurationMin: 60, loadMultiplier: 0.5, rationale: 'Use the minimum durability-relevant continuous exposure.', stepOverrides: [{ stepId: 'long_run_main', durationSeconds: 2700 }] }
    ],
    parameters: [
      { id: 'long_run_duration', label: 'Long-run duration', unit: 'minutes', defaultValue: 75, minimum: 45, maximum: 165, step: 5, appliesToStepIds: ['long_run_main'], bindings: [{ stepId: 'long_run_main', property: 'duration.seconds' }], description: 'Grow duration progressively; it is capped by the athlete time budget and current planned dose, never assigned from event distance alone.' }
    ],
    regressions: ['running_easy_continuous_01'], progressions: [], substitutions: [],
    garmin: { exportable: true, supportedSport: 'running' },
    tags: ['running', 'long_run', 'durability', 'adjustable'],
    sourceNotes: ['Matches the engine’s long-run durability template introduced for half-marathon/marathon demand.']
  },
  {
    id: 'running_race_pace_01', version: 1, status: 'active',
    name: 'Running Race-Pace Specificity',
    description: 'Race-specific running with controlled work near the event-relevant sustainable pace, separated by easy running. The exact pace remains athlete-specific rather than inferred from event distance alone.',
    modality: 'running', category: 'threshold', objectives: ['lactate_threshold', 'aerobic_base'],
    duration: { defaultMin: 55, minimumMin: 40, maximumMin: 90 },
    loadProfile: { cardiovascular: 4, muscular: 4, mechanical: 4, eccentric: 3, coordination: 2, recoveryHours: 42 },
    eligibility: { minimumReadiness: 7, maximumSoreness: 4, minimumDaysAfterHardLowerBody: 1, forbiddenPainFlags: ['acute_hamstring_pain', 'knee_swelling', 'worsening_achilles_pain'] },
    equipment: [], contraindicationTags: ['acute_hamstring_pain', 'knee_swelling', 'worsening_achilles_pain'], engineTemplateIds: ['run_race_pace_01'],
    blocks: [
      { id: 'warmup', name: 'Warm-up', role: 'warmup', steps: [
        timeStep('race_pace_warmup', 'walk_run_easy', 'Easy running warm-up', 900, { target: { type: 'rpe', min: 2, max: 3 } })
      ]},
      { id: 'main', name: 'Race-pace repeats', role: 'main', steps: [
        timeStep('race_pace_main', 'run_race_pace_interval', 'Race-pace interval', 480, { sets: 3, restAfterSec: 180, target: { type: 'rpe', min: 6, max: 7 }, notes: ['Keep the final repeat as controlled as the first.', 'Recover with easy jogging rather than complete rest.'] })
      ]},
      { id: 'cooldown', name: 'Cool-down', role: 'cooldown', steps: [
        timeStep('race_pace_cooldown', 'walk_run_easy', 'Easy running cool-down', 600, { target: { type: 'rpe', min: 1, max: 2 } })
      ]}
    ],
    variants: [
      { id: 'full', targetDurationMin: 55, loadMultiplier: 1, rationale: 'Three repeatable race-pace efforts.', stepOverrides: [] },
      { id: 'reduced', targetDurationMin: 45, loadMultiplier: 0.75, rationale: 'Reduce repeat count before increasing effort.', stepOverrides: [{ stepId: 'race_pace_main', sets: 2 }, { stepId: 'race_pace_cooldown', durationSeconds: 660 }] },
      { id: 'return_to_training', targetDurationMin: 40, loadMultiplier: 0.55, rationale: 'Use a single controlled effort at reduced intensity.', stepOverrides: [{ stepId: 'race_pace_main', sets: 1, durationSeconds: 300, target: { type: 'rpe', min: 4, max: 5 } }, { stepId: 'race_pace_cooldown', durationSeconds: 1200 }] }
    ],
    parameters: [
      { id: 'repeat_count', label: 'Race-pace repeat count', unit: 'repetitions', defaultValue: 3, minimum: 2, maximum: 6, step: 1, appliesToStepIds: ['race_pace_main'], bindings: [{ stepId: 'race_pace_main', property: 'sets' }], description: 'Progress repeat count before making every effort harder.' }
    ],
    regressions: ['running_tempo_01'], progressions: [], substitutions: [],
    garmin: { exportable: true, supportedSport: 'running' },
    tags: ['running', 'race_specific', 'quality', 'adjustable'],
    sourceNotes: ['Matches the engine’s running race-pace-specificity template used in the specific build window.']
  },
  {
    id: 'running_taper_sharpening_01', version: 1, status: 'active',
    name: 'Running Taper Sharpening',
    description: 'Short race-week run retaining a little event-relevant intensity while removing volume. Finish feeling fresher than you started.',
    modality: 'running', category: 'surge_tolerance', objectives: ['freshness', 'race_execution'],
    duration: { defaultMin: 30, minimumMin: 20, maximumMin: 40 },
    loadProfile: { cardiovascular: 3, muscular: 2, mechanical: 3, eccentric: 2, coordination: 2, recoveryHours: 24 },
    eligibility: { minimumReadiness: 5, maximumSoreness: 5, forbiddenPainFlags: ['knee_swelling', 'worsening_achilles_pain'] },
    equipment: [], contraindicationTags: ['knee_swelling', 'worsening_achilles_pain'], engineTemplateIds: ['run_taper_sharpen_01'],
    blocks: [
      { id: 'warmup', name: 'Warm-up', role: 'warmup', steps: [
        timeStep('taper_run_warmup', 'walk_run_easy', 'Easy running warm-up', 480, { target: { type: 'rpe', min: 1, max: 2 } })
      ]},
      { id: 'main', name: 'Brief sharpening', role: 'main', steps: [
        timeStep('taper_run_efforts', 'run_tempo_interval', 'Controlled race-specific touch', 90, { sets: 3, restAfterSec: 150, target: { type: 'rpe', min: 6, max: 7 }, notes: ['Keep every touch crisp and clearly submaximal.', 'Stop before the session creates residual fatigue.'] })
      ]},
      { id: 'cooldown', name: 'Cool-down', role: 'cooldown', steps: [
        timeStep('taper_run_cooldown', 'walk_run_easy', 'Easy running cool-down', 750, { target: { type: 'rpe', min: 1, max: 2 } })
      ]}
    ],
    variants: [
      { id: 'full', targetDurationMin: 30, loadMultiplier: 1, rationale: 'Normal taper sharpening stimulus.', stepOverrides: [] },
      { id: 'reduced', targetDurationMin: 24, loadMultiplier: 0.7, rationale: 'Use two touches and a shorter cool-down.', stepOverrides: [{ stepId: 'taper_run_efforts', sets: 2 }, { stepId: 'taper_run_cooldown', durationSeconds: 630 }] },
      { id: 'return_to_training', targetDurationMin: 20, loadMultiplier: 0.5, rationale: 'Use easy running with one controlled sub-threshold touch.', stepOverrides: [{ stepId: 'taper_run_efforts', sets: 1, durationSeconds: 60, target: { type: 'rpe', min: 4, max: 5 } }, { stepId: 'taper_run_cooldown', durationSeconds: 660 }] }
    ],
    parameters: [
      { id: 'sharpening_count', label: 'Sharpening touch count', unit: 'repetitions', defaultValue: 3, minimum: 1, maximum: 4, step: 1, appliesToStepIds: ['taper_run_efforts'], bindings: [{ stepId: 'taper_run_efforts', property: 'sets' }], description: 'Use the smallest dose that preserves confidence and sharpness this close to the race.' }
    ],
    regressions: ['running_tempo_01'], progressions: [], substitutions: [],
    garmin: { exportable: true, supportedSport: 'running' },
    tags: ['running', 'taper', 'race_week', 'freshness'],
    sourceNotes: ['Matches the engine’s running taper-sharpening template rather than falling back to a generic easy run in race week.']
  }
];
