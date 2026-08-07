import type { WorkoutDefinition } from '../models.ts';
import { timeStep } from './helpers.ts';

export const CYCLING_TECHNIQUE_WORKOUTS: WorkoutDefinition[] = [
  {
    id: 'cycling_pedalling_economy_01', version: 1, status: 'active',
    name: 'Cycling Pedalling Economy',
    description: 'Low-fatigue cadence and position practice that develops smoother pedalling without converting a technical day into an interval workout.',
    modality: 'cycling', category: 'technical_skill', objectives: ['cycling_pedalling_economy'],
    duration: { defaultMin: 40, minimumMin: 30, maximumMin: 55 },
    loadProfile: { cardiovascular: 2, muscular: 1, mechanical: 1, eccentric: 1, coordination: 4, recoveryHours: 18 },
    eligibility: { minimumReadiness: 4, maximumSoreness: 7, forbiddenPainFlags: ['acute_knee_pain'] },
    equipment: ['bike'], contraindicationTags: ['acute_knee_pain'],
    technicalRequirements: { environment: ['trainer', 'low_traffic_road'], supervision: 'none', stopConditions: ['Stop a drill if bouncing, gripping the bars or knee discomfort appears.', 'Keep every drill easy enough to preserve smooth breathing.'] },
    engineTemplateIds: ['cycling_technical_01'],
    blocks: [
      { id: 'warmup', name: 'Easy warm-up', role: 'warmup', steps: [timeStep('economy_warmup', 'bike_easy_spin', 'Easy spin', 600, { target: { type: 'rpe', min: 1, max: 2 } })] },
      { id: 'main', name: 'Cadence and position', role: 'main', steps: [
        timeStep('cadence_ladders', 'bike_cadence_ladder', 'Cadence ladder', 300, { sets: 3, restAfterSec: 120, target: { type: 'technical_quality', cue: 'Move through 85–100 rpm in light gears.', successCriteria: ['Quiet pelvis and upper body.', 'Even pressure through each pedal stroke.'], commonFaults: ['Bouncing or raising effort to chase cadence.'], stopConditions: ['Return to easy spinning if smoothness is lost.'] } }),
        timeStep('spinups', 'bike_spin_up', 'Controlled spin-up', 20, { sets: 6, restAfterSec: 70, target: { type: 'technical_quality', cue: 'Build cadence smoothly for 20 seconds; it is not a sprint.', successCriteria: ['Light hands.', 'No bouncing.'] } }),
        timeStep('transitions', 'bike_seated_standing_transition', 'Seated-to-standing transition', 30, { sets: 4, restAfterSec: 60, target: { type: 'technical_quality', cue: 'Change position without a gear surge.', successCriteria: ['Stable line and light hands.', 'Cadence remains controlled.'] } })
      ] },
      { id: 'cooldown', name: 'Easy finish', role: 'cooldown', steps: [timeStep('economy_cooldown', 'bike_easy_spin', 'Easy spin', 600, { target: { type: 'rpe', min: 1, max: 2 } })] }
    ],
    variants: [
      { id: 'full', targetDurationMin: 40, loadMultiplier: 1, rationale: 'Full technical coordination dose at easy aerobic cost.', stepOverrides: [] },
      { id: 'reduced', targetDurationMin: 32, loadMultiplier: 0.7, rationale: 'Reduce drill repetitions but preserve all technical themes.', stepOverrides: [{ stepId: 'cadence_ladders', sets: 2 }, { stepId: 'spinups', sets: 4 }, { stepId: 'economy_cooldown', durationSeconds: 420 }] },
      { id: 'return_to_training', targetDurationMin: 30, loadMultiplier: 0.5, rationale: 'Keep only controlled cadence ladders and easy riding.', stepOverrides: [{ stepId: 'cadence_ladders', sets: 2 }, { stepId: 'spinups', omit: true }, { stepId: 'transitions', omit: true }, { stepId: 'economy_cooldown', durationSeconds: 300 }] }
    ],
    regressions: ['cycling_recovery_spin_01'], progressions: ['cycling_short_surges_10x20_01'], substitutions: [],
    garmin: { exportable: true, supportedSport: 'cycling' }, tags: ['cycling', 'technique', 'cadence', 'low_fatigue'],
    sourceNotes: ['Cadence and position drills are submaximal coordination practice; smoothness, not peak cadence or watts, is the progression criterion.']
  },
  {
    id: 'cycling_cornering_braking_skill_01', version: 1, status: 'active',
    name: 'Cycling Cornering and Braking Skill',
    description: 'Conservative braking and cornering practice for a traffic-free area. This is deliberately manual-only until environment and supervision are captured by the planner.',
    modality: 'cycling', category: 'technical_skill', objectives: ['cycling_handling'],
    duration: { defaultMin: 45, minimumMin: 35, maximumMin: 60 },
    loadProfile: { cardiovascular: 1, muscular: 1, mechanical: 1, eccentric: 1, coordination: 5, recoveryHours: 18 },
    eligibility: { minimumReadiness: 5, maximumSoreness: 7, forbiddenPainFlags: ['acute_wrist_pain'] },
    equipment: ['bike', 'safe_riding_area'], contraindicationTags: ['acute_wrist_pain'],
    technicalRequirements: { environment: ['closed_road'], supervision: 'recommended', prerequisiteSkills: ['Comfortable basic bike control.'], stopConditions: ['Do not practise in traffic, on wet/contaminated surfaces, or at speeds beyond confident control.', 'Stop after any near-miss or loss of line.'] },
    manualOnly: true,
    blocks: [
      { id: 'warmup', name: 'Easy warm-up', role: 'warmup', steps: [timeStep('handling_warmup', 'bike_easy_spin', 'Easy spin', 600, { target: { type: 'rpe', min: 1, max: 2 } })] },
      { id: 'main', name: 'Handling practice', role: 'main', steps: [
        timeStep('braking', 'bike_braking_modulation', 'Progressive braking practice', 30, { sets: 8, restAfterSec: 75, target: { type: 'technical_quality', cue: 'Practise progressive braking from easy speed in a straight line.', successCriteria: ['Eyes stay up.', 'Braking remains smooth and predictable.'], stopConditions: ['Stop if the surface is unsafe or the line cannot be held.'] } }),
        timeStep('cornering', 'bike_cornering_line', 'Conservative cornering line', 30, { sets: 8, restAfterSec: 75, target: { type: 'technical_quality', cue: 'Brake before the turn, look through the exit, and use an easy conservative speed.', successCriteria: ['Stable line.', 'No late braking in the corner.'] } })
      ] },
      { id: 'cooldown', name: 'Easy finish', role: 'cooldown', steps: [timeStep('handling_cooldown', 'bike_easy_spin', 'Easy spin', 600, { target: { type: 'rpe', min: 1, max: 2 } })] }
    ],
    variants: [
      { id: 'full', targetDurationMin: 45, loadMultiplier: 1, rationale: 'Full conservative handling practice.', stepOverrides: [] },
      { id: 'reduced', targetDurationMin: 38, loadMultiplier: 0.7, rationale: 'Reduce repetitions while retaining both skills.', stepOverrides: [{ stepId: 'braking', sets: 5 }, { stepId: 'cornering', sets: 5 }] },
      { id: 'return_to_training', targetDurationMin: 35, loadMultiplier: 0.5, rationale: 'Practise straight-line braking only at easy speed.', stepOverrides: [{ stepId: 'braking', sets: 4 }, { stepId: 'cornering', omit: true }] }
    ],
    regressions: ['cycling_pedalling_economy_01'], progressions: [], substitutions: [],
    garmin: { exportable: false }, tags: ['cycling', 'handling', 'manual_only', 'traffic_free_area'],
    sourceNotes: ['Road-handling practice is not auto-prescribed until safety context, rider skill and setting are known.']
  }
];
