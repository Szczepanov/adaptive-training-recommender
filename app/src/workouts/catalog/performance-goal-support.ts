import type { WorkoutDefinition } from '../models.ts';
import { repsStep, timeStep } from './helpers.ts';

/**
 * PG6 direct-coverage candidates for the first typed strength/speed/power goal slice.
 *
 * These definitions deliberately have no engineTemplateIds. PG6 supplies legitimate catalog
 * content; PG7 decides when goal-specific coverage may affect automatic weekly allocation.
 * Keeping the target outcome value out of these definitions is an architecture invariant:
 * current capability, RIR/quality and normal eligibility remain dose authority.
 */
export const PERFORMANCE_GOAL_SUPPORT_WORKOUTS: WorkoutDefinition[] = [
  {
    id: 'strength_conventional_deadlift_practice_01',
    version: 1,
    status: 'active',
    name: 'Conventional Deadlift Strength Practice',
    description: 'Low-grind direct conventional-deadlift practice for athletes whose measurable strength goal requires exact-lift exposure.',
    modality: 'strength',
    category: 'full_body_strength',
    objectives: ['strength_maintenance', 'tissue_capacity'],
    duration: { defaultMin: 40, minimumMin: 25, maximumMin: 50 },
    loadProfile: { cardiovascular: 1, muscular: 4, mechanical: 4, eccentric: 3, coordination: 3, recoveryHours: 48 },
    eligibility: {
      minimumReadiness: 6,
      maximumSoreness: 5,
      minimumDaysAfterHardLowerBody: 1,
      forbiddenPainFlags: ['acute_hamstring_pain', 'acute_low_back_pain'],
    },
    equipment: ['barbell', 'bodyweight'],
    contraindicationTags: ['acute_hamstring_pain', 'acute_low_back_pain'],
    warmupKnowledgeClaimIds: ['strength.warmup.contextual_preparation', 'strength.warmup.specific_rehearsal'],
    blocks: [
      {
        id: 'warmup',
        name: 'Hinge preparation and lift rehearsal',
        role: 'warmup',
        steps: [
          repsStep('deadlift_warmup_hinge', 'bodyweight_hip_hinge', 'Bodyweight hip hinge', 8, {
            load: { kind: 'bodyweight' },
            notes: ['Use a comfortable range and finish each repetition balanced.'],
          }),
          repsStep('deadlift_warmup_deadbug', 'dead_bug', 'Dead bug', 6, {
            load: { kind: 'bodyweight' },
            notes: ['Use controlled breathing and trunk position.'],
          }),
          repsStep('deadlift_rehearsal', 'conventional_deadlift', 'Conventional deadlift rehearsal', 3, {
            sets: 2,
            restAfterSec: 60,
            load: { kind: 'descriptive', display: 'Empty bar, then a light rehearsal load' },
            target: { type: 'reps_in_reserve', min: 6, max: 8 },
            notes: ['Rehearse bracing and bar path; this is preparation, not a work set.'],
          }),
        ],
      },
      {
        id: 'main',
        name: 'Direct strength practice',
        role: 'main',
        steps: [
          repsStep('deadlift_main', 'conventional_deadlift', 'Conventional deadlift', 3, {
            sets: 3,
            restAfterSec: 180,
            target: { type: 'reps_in_reserve', min: 3, max: 5 },
            notes: [
              'Choose load from current capability and today\'s execution quality, never from the aspirational goal 1RM.',
              'Stop the set if bracing, bar path or rep speed deteriorates materially.',
            ],
          }),
        ],
      },
      {
        id: 'accessory',
        name: 'Low-fatigue trunk and hip support',
        role: 'accessory',
        steps: [
          repsStep('deadlift_glute_bridge', 'glute_bridge', 'Glute bridge', 8, {
            sets: 2,
            restAfterSec: 45,
            load: { kind: 'bodyweight' },
            target: { type: 'reps_in_reserve', min: 4, max: 6 },
          }),
          repsStep('deadlift_deadbug', 'dead_bug', 'Dead bug', 6, {
            sets: 2,
            restAfterSec: 30,
            load: { kind: 'bodyweight' },
          }),
        ],
      },
    ],
    variants: [
      {
        id: 'full',
        targetDurationMin: 40,
        loadMultiplier: 1,
        rationale: 'Three high-quality direct-practice work sets with complete enough recovery to avoid grinding.',
        stepOverrides: [],
      },
      {
        id: 'reduced',
        targetDurationMin: 30,
        loadMultiplier: 0.7,
        rationale: 'Preserve exact-lift exposure while reducing work-set volume.',
        stepOverrides: [
          { stepId: 'deadlift_rehearsal', sets: 1 },
          { stepId: 'deadlift_main', sets: 2, target: { type: 'reps_in_reserve', min: 4, max: 6 } },
          { stepId: 'deadlift_glute_bridge', sets: 1 },
        ],
      },
      {
        id: 'return_to_training',
        targetDurationMin: 25,
        loadMultiplier: 0.5,
        rationale: 'Remove loaded conventional-deadlift exposure; this variant is not direct goal coverage.',
        stepOverrides: [
          { stepId: 'deadlift_rehearsal', omit: true },
          { stepId: 'deadlift_main', omit: true },
          { stepId: 'deadlift_glute_bridge', sets: 2, target: { type: 'reps_in_reserve', min: 5, max: 7 } },
          { stepId: 'deadlift_deadbug', sets: 2 },
        ],
      },
    ],
    regressions: [],
    progressions: [],
    substitutions: [
      {
        exerciseId: 'conventional_deadlift',
        substituteExerciseId: 'romanian_deadlift',
        reason: 'Broad hinge-strength substitute only; it does not preserve conventional-deadlift-specific performance-goal coverage.',
      },
    ],
    garmin: { exportable: false },
    tags: ['performance_goal', 'strength', 'conventional_deadlift', 'direct_practice', 'low_grind'],
    sourceNotes: [
      'Knowledge lineage: performance.strength.high_load_strength_gain and policy.workout_catalog.deadlift_direct_practice_v1. The exact 3x3/RIR/rest prescription is a conservative product heuristic, not a claim of universal optimality.',
    ],
  },
  {
    id: 'cycling_sprint_power_5s_01',
    version: 1,
    status: 'active',
    name: 'Short Maximal Cycling Sprint Power',
    description: 'Fresh, fully recovered maximal cycling sprints for direct 5-second peak-power goal coverage without turning the session into repeated-sprint conditioning.',
    modality: 'cycling',
    category: 'surge_tolerance',
    objectives: ['power_maintenance', 'surge_tolerance'],
    duration: { defaultMin: 42, minimumMin: 25, maximumMin: 50 },
    loadProfile: { cardiovascular: 3, muscular: 4, mechanical: 2, eccentric: 1, coordination: 4, recoveryHours: 48 },
    eligibility: {
      minimumReadiness: 7,
      maximumSoreness: 4,
      minimumDaysAfterHardLowerBody: 1,
      forbiddenPainFlags: ['acute_knee_pain', 'knee_swelling'],
    },
    equipment: ['bike', 'safe_riding_area'],
    contraindicationTags: ['acute_knee_pain', 'knee_swelling'],
    blocks: [
      {
        id: 'warmup',
        name: 'Progressive sprint preparation',
        role: 'warmup',
        steps: [
          timeStep('sprint_power_warmup', 'bike_progressive_warmup', 'Progressive warm-up', 600, {
            target: { type: 'rpe', min: 1, max: 3 },
          }),
          timeStep('sprint_power_cadence', 'bike_cadence_activation', 'Cadence activation', 120, {
            target: { type: 'cadence', minRpm: 95, maxRpm: 110 },
          }),
          timeStep('sprint_power_openers', 'bike_short_surge', 'Controlled sprint opener', 6, {
            sets: 2,
            restAfterSec: 90,
            target: { type: 'rpe', min: 6, max: 7 },
            notes: ['Build speed smoothly; these are preparation, not maximal efforts.'],
          }),
        ],
      },
      {
        id: 'main',
        name: 'Peak-power sprints',
        role: 'main',
        steps: [
          timeStep('sprint_power_main', 'bike_sprint_power', 'Maximal cycling sprint', 8, {
            sets: 5,
            restAfterSec: 240,
            target: {
              type: 'technical_quality',
              cue: 'Accelerate maximally while holding a stable, predictable line and controlled bike position.',
              successCriteria: ['Each effort is fresh and explosive rather than a fatigued grind.'],
              commonFaults: ['Shortening recovery to chase conditioning fatigue.', 'Continuing after coordination or sprint quality clearly falls.'],
              stopConditions: ['Stop for knee pain, dizziness, unsafe traffic or loss of bike control.', 'Stop maximal work if sprint quality drops materially.'],
            },
            notes: [
              'Use easy pedalling during the long recovery.',
              'The athlete\'s goal wattage is an outcome target, never the prescribed wattage for these repetitions.',
            ],
          }),
        ],
      },
      {
        id: 'cooldown',
        name: 'Easy spin',
        role: 'cooldown',
        steps: [
          timeStep('sprint_power_cooldown', 'bike_easy_spin', 'Easy spin', 600, {
            target: { type: 'rpe', min: 1, max: 2 },
          }),
        ],
      },
    ],
    variants: [
      {
        id: 'full',
        targetDurationMin: 42,
        loadMultiplier: 1,
        rationale: 'Five short maximal efforts with long recovery to prioritize repeatable peak-power quality.',
        stepOverrides: [],
      },
      {
        id: 'reduced',
        targetDurationMin: 32,
        loadMultiplier: 0.7,
        rationale: 'Keep direct maximal sprint exposure but reduce repetition count.',
        stepOverrides: [{ stepId: 'sprint_power_main', sets: 3 }],
      },
      {
        id: 'return_to_training',
        targetDurationMin: 25,
        loadMultiplier: 0.5,
        rationale: 'Remove maximal sprint exposure and retain only controlled preparation/easy riding; this variant is not direct goal coverage.',
        stepOverrides: [
          { stepId: 'sprint_power_main', omit: true },
          { stepId: 'sprint_power_openers', sets: 2, target: { type: 'rpe', min: 5, max: 6 } },
          { stepId: 'sprint_power_cooldown', durationSeconds: 720 },
        ],
      },
    ],
    regressions: [],
    progressions: [],
    substitutions: [],
    garmin: { exportable: false },
    tags: ['performance_goal', 'cycling', 'sprint_power', 'maximal', 'full_recovery', 'safe_area'],
    sourceNotes: [
      'Knowledge lineage: performance.cycling.short_sprint_anaerobic_performance and policy.workout_catalog.cycling_sprint_power_v1. Short maximal sprint training is evidence-supported; the exact 5x8 s/240 s recovery default is explicit product calibration.',
    ],
  },
];
