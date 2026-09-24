import { isCanonicalWorkoutExport, adaptCanonicalWorkoutToSessionDefinition } from '../../sessions/canonicalWorkoutAdapter';

export const SESSION_AI_PROMPT_TEMPLATE = `Output a single workout session as one JSON object and nothing else. Follow this SessionDefinition (schemaVersion: 1) contract:

{
  "schemaVersion": 1,
  "id": "<kebab-or-snake-case-id>",
  "revision": 1,
  "title": "<Session Title>",
  "summary": "<1-2 sentence objective and clinical/execution summary>",
  "intent": "training", // one of: "training" | "testing" | "competition" | "rehab_return" | "recovery" | "skill_technical"
  "modalities": ["strength"], // subset of: "cycling" | "running" | "swimming" | "walking" | "strength" | "field" | "mobility" | "recovery" | "cross_training"
  "dominantModality": "strength",
  "duration": { "min": 45, "max": 55 }, // minutes (number or { min, max })
  "defaultScheduledDate": "YYYY-MM-DD", // optional Warsaw calendar date
  "prohibitedAdditions": ["<optional list of excluded movements or intensities>"],
  "blocks": [
    {
      "id": "warmup",
      "role": "warmup", // one of: "warmup" | "main" | "cooldown" | "accessory" | "test" | "recovery"
      "title": "<Block Title>",
      "executionMode": "sequential", // one of: "sequential" | "circuit" | "superset" | "density" | "amrap" | "alternating"
      "steps": [
        {
          "id": "step_1",
          "kind": "exercise",
          "exerciseRef": { "kind": "catalog", "exerciseId": "<canonical_exercise_id>" },
          "dose": { "kind": "repetition", "sets": 3, "reps": { "min": 4, "max": 5 } },
          "laterality": "bilateral", // optional: "bilateral" | "per_side" | "alternating"
          "load": { "kind": "descriptive", "display": "RPE 5-6 (~4 RIR)" }, // or { "kind": "bodyweight" }, { "kind": "unloaded" }, { "kind": "mass", "kg": 40 }
          "intensity": { "kind": "rir", "value": 4 }, // optional: { "kind": "rir", "value": N } or { "kind": "rpe", "value": N }
          "restSeconds": 120,
          "notes": "<optional execution cue>",
          "stopConditions": ["<optional clinical/technical stop criteria>"],
          "alternatives": [
            {
              "id": "alt_1",
              "label": "<Alternative Exercise Name>",
              "exerciseRef": { "kind": "catalog", "exerciseId": "<canonical_exercise_id>" },
              "dose": { "kind": "repetition", "sets": 3, "reps": { "min": 4, "max": 5 } }
            }
          ]
        }
      ]
    }
  ]
}

Rules:
1. Prefer {"kind": "catalog", "exerciseId": "<id>"} when matching known movements:
   - Strength: front_squat, back_squat, goblet_squat, split_squat, rear_foot_elevated_split_squat, reverse_lunge, walking_lunge, step_up, romanian_deadlift, single_leg_romanian_deadlift, kettlebell_deadlift, hip_thrust, single_leg_hip_thrust, glute_bridge, bench_press, dumbbell_bench_press, incline_dumbbell_press, push_up, pull_up, chin_up, lat_pulldown, dumbbell_row, chest_supported_dumbbell_row, cable_row, seated_dumbbell_overhead_press, barbell_overhead_press, hang_power_clean, medicine_ball_slam, seated_calf_raise, standing_calf_raise, seated_soleus_iso, eccentric_heel_raise, tibialis_raise, copenhagen_plank, side_plank, plank, dead_bug, bird_dog, pallof_press, bodyweight_squat, bodyweight_hip_hinge, scapular_push_up
   - Cycling/Running/Mobility: bike_progressive_warmup, bike_easy_spin, bike_threshold_interval, bike_vo2_interval, bike_over_under_interval, bike_cooldown, easy_continuous_run, walk_run_easy, run_tempo_interval, run_vo2_interval, mobility_flow, breathwork_downregulation
   Use {"kind": "unresolved_free_text", "name": "..."} only when no catalog exerciseId fits.
2. Dose must be one of:
   - {"kind": "repetition", "sets": <positive int>, "reps": <number or {min, max}>}
   - {"kind": "duration", "sets": <positive int>, "seconds": <number or {min, max}>}
   - {"kind": "distance", "sets": <positive int>, "meters": <number or {min, max}>}
   - {"kind": "checkoff", "rounds": <positive int>}
3. Never include "systemicCost" or outer plan fields ("schema", "planId", "weekCount", "sessions").`;

export function unwrapSingleSessionFromPlanEnvelope(raw: unknown): {
    target: unknown;
    sourceFormat: 'session_definition' | 'canonical_workout_v1' | 'external_plan_single_session';
    multiSessionCount?: number;
} {
    if (isCanonicalWorkoutExport(raw)) {
        return {
            target: adaptCanonicalWorkoutToSessionDefinition(raw),
            sourceFormat: 'canonical_workout_v1',
        };
    }

    if (typeof raw === 'object' && raw !== null && !Array.isArray(raw) && 'sessions' in raw) {
        const sessions = (raw as { sessions?: unknown }).sessions;
        if (Array.isArray(sessions)) {
            if (sessions.length === 1) {
                const first = sessions[0] as { definition?: unknown } | undefined;
                if (first && typeof first === 'object' && first.definition && typeof first.definition === 'object') {
                    return {
                        target: first.definition,
                        sourceFormat: 'external_plan_single_session',
                    };
                }
            } else if (sessions.length > 1) {
                return {
                    target: raw,
                    sourceFormat: 'session_definition',
                    multiSessionCount: sessions.length,
                };
            }
        }
    }

    return { target: raw, sourceFormat: 'session_definition' };
}
