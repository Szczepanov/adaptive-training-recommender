import type { PlanningAuthorityMode } from '../ledger/planningAuthorityMode';
import { EXTERNAL_PLAN_SCHEMA_V6 } from '../sessions/externalPlanV6';

const ENGINE_MODE_TRAVEL_INSTRUCTION =
    'Do not encode travel weeks, illness, or externally imposed time off as restDays — those are handled separately by the app\'s own calendar. restDays is only for deliberate plan-authored protected rest such as sequencing, taper or deload intent. Plan as if every otherwise scheduled day is available.';

const LEDGER_MODE_TRAVEL_INSTRUCTION =
    'Plan around `userContext.travel` (startDate, endDate, volumeScale, intensityScale) and `venueRestrictions` (date, title, environment, equipment) from the ledger export — adjust session volume, intensity, environment, and equipment on those dates directly in the authored sessions rather than assuming every day is available. Use restDays only for deliberate plan-authored protected rest such as sequencing, taper, deload, or travel-enforced rest.';

export function buildAiPromptTemplate(mode: PlanningAuthorityMode): string {
    const travelInstruction = mode === 'ledger'
        ? LEDGER_MODE_TRAVEL_INSTRUCTION
        : ENGINE_MODE_TRAVEL_INSTRUCTION;
    return `Output the plan as a single JSON document and nothing else. Follow this contract exactly.

Top level: schema (literal "${EXTERNAL_PLAN_SCHEMA_V6}"), planId (lowercase slug, unchanged between revisions of the same plan), revision (integer, increment when revising), title, startDate (the Monday week 1 begins, YYYY-MM-DD), weekCount, optional notes, required restDays, optional intentBlocks, and sessions.

restDays is a list of deliberate protected-rest directives. It may be empty. Each directive is exactly {"id": "<stable-unique-id>", "week": <1-based-week>, "day": "<lowercase-weekday>"}. Use the same monday/tuesday/wednesday/thursday/friday/saturday/sunday vocabulary as session placement. Do not put absolute dates in restDays: startDate is the plan's only authored absolute date, and the app resolves week/day to a calendar date. Do not use omission to mean protected rest — a date with neither a session nor a restDays directive is intentionally unplanned and may use the app's normal fallback. Never place a fixed session and a restDays directive on the same week/day.

Do not compute calendar dates for sessions. Each session has id (unique within the plan, at most 64 characters), title, priority (key/supporting/optional), and:

- placement: week (1-based), optional preferredDay (lowercase weekday), flexibility (fixed/preferred/any_day), ifMissed (drop/reschedule_within_week/carry_forward).
- gating: modality (cycling/running/strength/field/mobility/cross_training), intensity (recovery/easy/moderate/hard/max), durationMin, durationMax (minutes), environment (indoor/outdoor/either), equipment (subset of free_weights, cable_machine, treadmill, indoor_bike, pullup_bar).
- objectives: zero or more of threshold_quality, surge_repeatability, zone2_aerobic, strength_maintenance, strength_development, race_specific_endurance, vo2_max.
- definition: the executable content — schemaVersion (1), id (same as the session's own id), revision (1), title, optional summary, intent (training/testing/competition/rehab_return/recovery/skill_technical), optional dominantModality (matching gating.modality), optional duration ({min, max} minutes), and blocks. Each block has id, optional title, role (warmup/main/cooldown/accessory/test/recovery), executionMode (sequential/circuit/superset/density/amrap/alternating), and steps. Each step has id, kind ("exercise"), optional title, exerciseRef (prefer {"kind": "catalog", "exerciseId": "<id>"} when matching known movements — e.g. bike_progressive_warmup, bike_easy_spin, bike_threshold_interval, bike_vo2_interval, bike_float_interval, bike_over_under_interval, bike_short_surge, bike_hard_finish, bike_race_simulation, bike_race_opener, bike_cooldown, goblet_squat, front_squat, back_squat, rear_foot_elevated_split_squat, romanian_deadlift, kettlebell_deadlift, hip_thrust, bench_press, push_up, pull_up, dumbbell_row, chest_supported_dumbbell_row, dead_bug, side_plank, plank, copenhagen_plank, seated_soleus_iso, calf_isometric, easy_continuous_run, run_tempo_interval, run_vo2_interval, mobility_flow — or use {"kind": "unresolved_free_text", "name": "..."} for custom movements), dose, optional rest (seconds, or {min, max} for a range), optional notes. dose is one of: {"kind": "repetition", "sets": N, "reps": N or {min,max}}; {"kind": "duration", "sets": N (optional), "seconds": N or {min,max}} — use seconds for anything under two minutes (e.g. 10, 20, 30), never fractional minutes; {"kind": "distance", "sets": N (optional), "meters": N or {min,max}}. Example a 30-second-on/15-second-off interval step, 10 reps per set, 3 sets: {"id": "step-1", "kind": "exercise", "title": "30-second work", "exerciseRef": {"kind": "catalog", "exerciseId": "bike_vo2_interval"}, "dose": {"kind": "duration", "sets": 3, "seconds": 30}, "rest": 15}.
- isEvent: true only on the target event itself (a race, a test event). An event session must also use flexibility: "fixed" with a preferredDay. Do not mark ordinary hard sessions as events.
- scaling: reducible (boolean; set to false when no useful reduced form exists), reducedSummary and reducedDurationMin (advisory display only), minimumUsefulDurationMin, fallback (advisory only), and optional reducedDefinition. reducedDefinition is a complete SessionDefinition with the exact same id, intent and dominantModality as definition; it is the only executable scaled form. Omit it when reducible is false.
- replacesSessionId (optional, revisions only): when this session replaces a session from the previous revision of the same plan, set it to that earlier session's exact id. Only the previous revision's ids are valid, at most one new session may replace each earlier session, and it must not name another session this revision keeps. Omit it when a session replaces nothing; the app never infers a replacement from titles or dates.
- intraday (optional): only for a session that is one member of a same-day training bundle (e.g. an AM ride plus a PM strength session on the same date). {"window": {"startLocal": "HH:mm", "endLocal": "HH:mm"}, "bundleId": "<stable-id-unique-within-the-week>", "order": <0-based integer, unique within the bundle>, optional "afterSessionId": "<earlier session's own id in this bundle>", optional "minimumSeparationMinutes": <number, requires afterSessionId>}. Every session sharing a bundleId in the same week must also share the same placement.week, placement.preferredDay and placement.flexibility. window is the requested interval only — the app resolves it against the athlete's real same-day availability at placement time, so only request a window the athlete has actually told the app about (Training Windows in the app). Do not invent a second session on a day with no evidence the athlete wants to train twice; do not use intraday for two unrelated sessions on different days.

${travelInstruction}

Do not encode readiness or autoregulation rules anywhere, including notes. The app adjudicates each session against that morning's data and owns all green/yellow/red decisions. Use notes only for context the app cannot know: which power meter is the reference, whether wattage targets or RPE take precedence, what block preceded this one.

Never include a "systemicCost" or similar calibrated load figure anywhere in definition — the app derives that itself from modality, intensity and duration.

Output as a downloadable JSON file.`;
}

export const AI_PROMPT_TEMPLATE = buildAiPromptTemplate('engine');
