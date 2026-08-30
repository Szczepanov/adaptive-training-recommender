import type { WorkoutDefinition } from '../models.ts';
import { timeStep } from './helpers.ts';

export const SWIMMING_WORKOUTS: WorkoutDefinition[] = [
  {
    id: 'swimming_technique_01', version: 1, status: 'active',
    name: 'Pool Swim Technique',
    description: 'Easy technique-focused pool session with relaxed repeats, body-position work, and generous recovery. Stop technical work when stroke quality deteriorates.',
    modality: 'swimming', category: 'easy_endurance', objectives: ['aerobic_base'],
    duration: { defaultMin: 35, minimumMin: 25, maximumMin: 45 },
    loadProfile: { cardiovascular: 2, muscular: 1, mechanical: 1, eccentric: 1, coordination: 4, recoveryHours: 12 },
    eligibility: { minimumReadiness: 4, maximumSoreness: 7 },
    equipment: ['pool'], contraindicationTags: [], engineTemplateIds: ['swim_technique_01'],
    blocks: [
      { id: 'warmup', name: 'Easy warm-up', role: 'warmup', steps: [
        timeStep('swim_tech_warmup', 'swim_easy_continuous', 'Easy warm-up swimming', 600, { target: { type: 'rpe', min: 1, max: 2 } })
      ]},
      { id: 'main', name: 'Technique repeats', role: 'main', steps: [
        timeStep('swim_tech_drill', 'swim_technique_drill', 'Technique drill repeat', 90, { sets: 6, restAfterSec: 45, target: { type: 'technical_quality', cue: 'Relaxed body position with a long, controlled stroke.', successCriteria: ['Quiet head position.', 'Even breathing rhythm.'], commonFaults: ['Rushing stroke rate to chase pace.'], stopConditions: ['Stop technical work when stroke quality deteriorates.'] } }),
        timeStep('swim_tech_integration', 'swim_easy_continuous', 'Easy whole-stroke integration', 315, { target: { type: 'rpe', min: 1, max: 2 }, notes: ['Carry the drill cue into relaxed whole-stroke swimming without chasing pace.'] })
      ]},
      { id: 'cooldown', name: 'Easy cool-down', role: 'cooldown', steps: [
        timeStep('swim_tech_cooldown', 'swim_easy_continuous', 'Easy cool-down swimming', 420, { target: { type: 'rpe', min: 1, max: 2 } })
      ]}
    ],
    variants: [
      { id: 'full', targetDurationMin: 35, loadMultiplier: 1, rationale: 'Full technique dose across warm-up, drills and cool-down.', stepOverrides: [] },
      { id: 'reduced', targetDurationMin: 28, loadMultiplier: 0.75, rationale: 'Reduce drill repeats while preserving the technical theme.', stepOverrides: [{ stepId: 'swim_tech_drill', sets: 4 }, { stepId: 'swim_tech_integration', durationSeconds: 165 }] },
      { id: 'return_to_training', targetDurationMin: 25, loadMultiplier: 0.5, rationale: 'Use mostly easy continuous swimming with minimal drill work.', stepOverrides: [{ stepId: 'swim_tech_drill', sets: 2 }, { stepId: 'swim_tech_integration', durationSeconds: 375 }, { stepId: 'swim_tech_cooldown', durationSeconds: 300 }] }
    ],
    parameters: [
      { id: 'drill_count', label: 'Technique drill count', unit: 'repetitions', defaultValue: 6, minimum: 2, maximum: 8, step: 1, appliesToStepIds: ['swim_tech_drill'], bindings: [{ stepId: 'swim_tech_drill', property: 'sets' }], description: 'Progress repeat count before adding intensity; technique work stays easy.' }
    ],
    regressions: ['rest_complete_01'], progressions: ['swimming_easy_aerobic_01'], substitutions: [],
    garmin: { exportable: false },
    tags: ['swimming', 'technique', 'low_fatigue', 'pool'],
    sourceNotes: ['Matches the engine’s pool-swim technique template: relaxed repeats, body-position focus, generous recovery.']
  },
  {
    id: 'swimming_easy_aerobic_01', version: 1, status: 'active',
    name: 'Easy Aerobic Swim',
    description: 'Conversational-equivalent aerobic swimming in repeatable relaxed sets. Keeps breathing and stroke mechanics controlled rather than chasing pace.',
    modality: 'swimming', category: 'easy_endurance', objectives: ['aerobic_base'],
    duration: { defaultMin: 45, minimumMin: 30, maximumMin: 60 },
    loadProfile: { cardiovascular: 3, muscular: 2, mechanical: 1, eccentric: 1, coordination: 2, recoveryHours: 16 },
    eligibility: { minimumReadiness: 4, maximumSoreness: 7 },
    equipment: ['pool'], contraindicationTags: [], engineTemplateIds: ['swim_easy_01'],
    blocks: [
      { id: 'warmup', name: 'Warm-up', role: 'warmup', steps: [
        timeStep('swim_easy_warmup', 'swim_easy_continuous', 'Easy warm-up swimming', 600, { target: { type: 'rpe', min: 1, max: 2 } })
      ]},
      { id: 'main', name: 'Aerobic swim sets', role: 'main', steps: [
        timeStep('swim_easy_main', 'swim_easy_continuous', 'Relaxed aerobic swimming', 1800, { sets: 1, target: { type: 'rpe', min: 2, max: 3 }, notes: ['Break into repeatable sets with short rest if needed.', 'Keep breathing and stroke mechanics controlled rather than chasing pace.'] })
      ]},
      { id: 'cooldown', name: 'Cool-down', role: 'cooldown', steps: [
        timeStep('swim_easy_cooldown', 'swim_easy_continuous', 'Easy cool-down swimming', 300, { target: { type: 'rpe', min: 1, max: 2 } })
      ]}
    ],
    variants: [
      { id: 'full', targetDurationMin: 45, loadMultiplier: 1, rationale: 'Standard aerobic swim volume.', stepOverrides: [] },
      { id: 'reduced', targetDurationMin: 35, loadMultiplier: 0.75, rationale: 'Retain the aerobic stimulus while lowering total volume.', stepOverrides: [{ stepId: 'swim_easy_main', durationSeconds: 1200 }] },
      { id: 'return_to_training', targetDurationMin: 30, loadMultiplier: 0.55, rationale: 'Use a conservative relaxed exposure.', stepOverrides: [{ stepId: 'swim_easy_main', durationSeconds: 900 }] }
    ],
    parameters: [
      { id: 'aerobic_duration', label: 'Aerobic swim duration', unit: 'minutes', defaultValue: 30, minimum: 15, maximum: 45, step: 5, appliesToStepIds: ['swim_easy_main'], bindings: [{ stepId: 'swim_easy_main', property: 'duration.seconds' }], description: 'Adjust total aerobic swim volume from a short exposure to a longer session.' }
    ],
    regressions: ['swimming_technique_01'], progressions: ['swimming_threshold_intervals_01'], substitutions: [],
    garmin: { exportable: false },
    tags: ['swimming', 'aerobic_base', 'pool', 'adjustable'],
    sourceNotes: ['Matches the engine’s easy-aerobic swim template.']
  },
  {
    id: 'swimming_threshold_intervals_01', version: 1, status: 'active',
    name: 'Sustained Swim Intervals',
    description: 'Controlled moderate-to-threshold pool repeats with enough recovery to preserve stroke mechanics. Uses RPE and repeat consistency until swim-specific pace anchors are available.',
    modality: 'swimming', category: 'threshold', objectives: ['lactate_threshold', 'aerobic_base'],
    duration: { defaultMin: 45, minimumMin: 35, maximumMin: 60 },
    loadProfile: { cardiovascular: 4, muscular: 3, mechanical: 1, eccentric: 1, coordination: 3, recoveryHours: 30 },
    eligibility: { minimumReadiness: 6, maximumSoreness: 5 },
    equipment: ['pool'], contraindicationTags: [], engineTemplateIds: ['swim_threshold_01'],
    blocks: [
      { id: 'warmup', name: 'Warm-up', role: 'warmup', steps: [
        timeStep('swim_thresh_warmup', 'swim_easy_continuous', 'Easy warm-up swimming', 600, { target: { type: 'rpe', min: 1, max: 2 } })
      ]},
      { id: 'main', name: 'Threshold repeats', role: 'main', steps: [
        timeStep('swim_thresh_main', 'swim_threshold_interval', 'Sustained swim interval', 300, { sets: 5, restAfterSec: 60, target: { type: 'rpe', min: 6, max: 7 }, notes: ['Keep the final repeat consistent with the first rather than fading.', 'Prioritise repeat consistency over chasing a pace target.'] })
      ]},
      { id: 'cooldown', name: 'Cool-down', role: 'cooldown', steps: [
        timeStep('swim_thresh_cooldown', 'swim_easy_continuous', 'Easy cool-down swimming', 360, { target: { type: 'rpe', min: 1, max: 2 } })
      ]}
    ],
    variants: [
      { id: 'full', targetDurationMin: 45, loadMultiplier: 1, rationale: 'Five repeatable threshold intervals.', stepOverrides: [] },
      { id: 'reduced', targetDurationMin: 39, loadMultiplier: 0.75, rationale: 'Reduce interval count before increasing effort.', stepOverrides: [{ stepId: 'swim_thresh_main', sets: 4 }] },
      { id: 'return_to_training', targetDurationMin: 35, loadMultiplier: 0.55, rationale: 'Use fewer, easier repeats.', stepOverrides: [{ stepId: 'swim_thresh_main', sets: 3, target: { type: 'rpe', min: 4, max: 5 } }, { stepId: 'swim_thresh_cooldown', durationSeconds: 480 }] }
    ],
    parameters: [
      { id: 'interval_count', label: 'Interval count', unit: 'repetitions', defaultValue: 5, minimum: 4, maximum: 7, step: 1, appliesToStepIds: ['swim_thresh_main'], bindings: [{ stepId: 'swim_thresh_main', property: 'sets' }], description: 'Progress repeat count before making every effort harder.' }
    ],
    regressions: ['swimming_easy_aerobic_01'], progressions: [], substitutions: [],
    garmin: { exportable: false },
    tags: ['swimming', 'threshold', 'pool', 'quality'],
    sourceNotes: ['Matches the engine’s sustained swim-interval template; no invented pace target until swim-specific benchmarks exist.']
  }
];
