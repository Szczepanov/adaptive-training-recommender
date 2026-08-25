import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const path = resolve(process.argv[2] ?? 'artifacts/ai-plan-judge/latest/families.jsonl');
if (!existsSync(path)) throw new Error(`Missing judge corpus: ${path}`);

const raw = readFileSync(path, 'utf8');
const families = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line, index) => {
  try {
    return JSON.parse(line);
  } catch (error) {
    throw new Error(`${path}:${index + 1} invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
});
const EXPECTED_FAMILY_CASE_COUNTS = new Map([
  ['objective_recovery', 8],
  ['subjective_recovery', 8],
  ['recent_training', 5],
  ['event_proximity', 5],
  ['preferences_capacity', 6],
  ['event_demand', 4],
  ['interactions', 8],
  ['delivered_dose_variance', 4],
  ['concurrent_strength_endurance', 4],
  ['injury_constraints', 4],
  ['planning_modes_overlays', 4],
  ['temporal_acute_vs_persistent', 4],
  ['conflicting_tissue_vs_wearable', 4],
]);
const EXPECTED_CASE_COUNT = [...EXPECTED_FAMILY_CASE_COUNTS.values()].reduce((sum, count) => sum + count, 0);

const cases = new Map();
const familyIds = new Set();
const failures = [];
const fail = (ok, message) => { if (!ok) failures.push(message); };

for (const family of families) {
  if (!family || typeof family !== 'object' || typeof family.familyId !== 'string' || !family.familyId.trim()) {
    failures.push('Corpus contains a family without a non-empty familyId.');
    continue;
  }
  fail(!familyIds.has(family.familyId), `Duplicate judge family id: ${family.familyId}`);
  familyIds.add(family.familyId);
  fail(EXPECTED_FAMILY_CASE_COUNTS.has(family.familyId), `Unexpected judge family id: ${family.familyId}`);
  fail(Array.isArray(family.cases), `Family ${family.familyId} is missing cases.`);
  if (!Array.isArray(family.cases)) continue;
  const expectedCount = EXPECTED_FAMILY_CASE_COUNTS.get(family.familyId);
  if (expectedCount !== undefined) fail(family.cases.length === expectedCount, `Family ${family.familyId} has ${family.cases.length} cases; expected ${expectedCount}.`);
  for (const item of family.cases) {
    const id = item.input?.caseId;
    if (!id) {
      failures.push(`Family ${family.familyId} contains a case without input.caseId`);
      continue;
    }
    fail(!cases.has(id), `Duplicate judge case id: ${id}`);
    cases.set(id, item);
  }
}

for (const familyId of EXPECTED_FAMILY_CASE_COUNTS.keys()) {
  fail(familyIds.has(familyId), `Missing required judge family: ${familyId}`);
}
fail(families.length === EXPECTED_FAMILY_CASE_COUNTS.size, `Judge corpus has ${families.length} families; expected ${EXPECTED_FAMILY_CASE_COUNTS.size}.`);
fail(cases.size === EXPECTED_CASE_COUNT, `Judge corpus has ${cases.size} unique cases; expected ${EXPECTED_CASE_COUNT}.`);

const required = (id) => {
  const value = cases.get(id);
  if (!value) throw new Error(`Missing required judge case: ${id}`);
  return value;
};
const weekday = (date) => {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day >= 1 && day <= 5;
};
const templateSequenceDistance = (left, right) => {
  const n = Math.max(left.plan?.length ?? 0, right.plan?.length ?? 0);
  if (n === 0) return 0;
  let different = 0;
  for (let i = 0; i < n; i += 1) {
    if (left.plan?.[i]?.session?.templateId !== right.plan?.[i]?.session?.templateId) different += 1;
  }
  return different / n;
};
const templateCount = (item, templateId) => (item.plan ?? []).filter((day) => day.session?.templateId === templateId).length;

const runningRestricted = required('judge_injury_running_restricted');
for (const day of runningRestricted.plan) {
  fail(day.session.modality !== 'Running', `${day.date}: restricted-running case selected ${day.session.templateId}`);
}

const lowerRestricted = required('judge_injury_lower_body_restricted');
for (const day of lowerRestricted.plan) {
  fail(!(day.session.safetyTags ?? []).includes('avoid_heavy_lower_body'), `${day.date}: heavy-lower-body restriction selected ${day.session.templateId}`);
}

const max45 = required('judge_pref_45min');
for (const day of max45.plan) {
  if (weekday(day.date) && day.session.durationMin !== null) {
    fail(day.session.durationMin <= 45, `${day.date}: 45-minute weekday case selected ${day.session.templateId} with minimum duration ${day.session.durationMin}`);
  }
}
const compactRaceSpecific = max45.plan.find((day) => day.session.category === 'Race-Specific Endurance' && (day.session.durationMin ?? Number.POSITIVE_INFINITY) <= 45);
fail(Boolean(compactRaceSpecific), '45-minute capacity case never receives a feasible <=45 minute race-specific cycling session.');
if (compactRaceSpecific) {
  fail(compactRaceSpecific.session.templateId === 'end_crit_surges_01', `45-minute criterium capacity case used ${compactRaceSpecific.session.templateId} instead of the compact criterium-specific template.`);
}

const travel = required('judge_mode_travel_overlay');
fail(Array.isArray(travel.input.authoredPlanBlocks) && travel.input.authoredPlanBlocks.length === 1, 'Travel case lost its authored plan block during scenario construction.');
for (const day of travel.plan.slice(0, 3)) {
  fail((day.session.requiredEquipment ?? []).length === 0, `${day.date}: travel case selected equipment-dependent ${day.session.templateId}`);
  fail(['indoor', 'either'].includes(day.session.environment), `${day.date}: travel case selected non-indoor ${day.session.templateId}`);
  if (day.session.durationMin !== null) fail(day.session.durationMin <= 30, `${day.date}: travel case exceeded 30-minute travel capacity with ${day.session.templateId}`);
}

const evergreen = required('judge_mode_evergreen');
fail(evergreen.input.trainingIntentProfile?.planningMode === 'evergreen', 'Evergreen case did not propagate a valid trainingIntentProfile.planningMode.');
fail((evergreen.input.events ?? []).length === 0 && evergreen.input.event === null, 'Evergreen case still carries an event.');

for (const item of cases.values()) {
  const event = item.input?.event;
  if (!event?.date) continue;
  const eventCommitment = (item.input.fixedActivities ?? []).find((activity) => activity.date === event.date && activity.id?.startsWith('judge-event:'));
  if (!eventCommitment) continue;
  const planDates = new Set(item.plan?.map((day) => day.date) ?? []);
  if (!planDates.has(event.date)) continue;
  const eventDay = item.plan?.find((day) => day.date === event.date);
  fail(Boolean(eventDay), `${item.input.caseId}: scheduled event date ${event.date} is missing from the simulated plan.`);
  if (eventDay) {
    fail(['Rest', 'Mobility/Recovery'].includes(eventDay.session.category), `${item.input.caseId}: scheduled event date ${event.date} also contains independent ${eventDay.session.title}.`);
  }
}

const critA = required('judge_demand_crit_A');
const granA = required('judge_demand_gran_A');
const critB = required('judge_demand_crit_B');
const granB = required('judge_demand_gran_B');
const demandDistanceA = templateSequenceDistance(critA, granA);
const demandDistanceB = templateSequenceDistance(critB, granB);
fail(demandDistanceA > 0, 'A-priority criterium and gran-fondo cases produce identical selected-template sequences.');
fail(demandDistanceB > 0, 'B-priority criterium and gran-fondo cases produce identical selected-template sequences.');

const critACompactCount = templateCount(critA, 'end_crit_surges_01');
const granACompactCount = templateCount(granA, 'end_crit_surges_01');
fail(critACompactCount > 0, 'A-priority criterium case never selects the compact criterium surge template.');
fail(granACompactCount === 0, `A-priority gran-fondo case selected the compact criterium surge template ${granACompactCount} time(s).`);

// Dynamic temporal invariants
const acuteAdverse = required('judge_traj_acute_adverse_day1');
const day1Cost = acuteAdverse.plan[0]?.session?.systemicCost ?? 1.0;
fail(day1Cost <= 0.4 || ['Rest', 'Mobility/Recovery'].includes(acuteAdverse.plan[0]?.session?.category), 'Acute 1-day adverse recovery case did not scale back Day 1 load.');

const persistentAdverse = required('judge_traj_persistent_adverse_3d');
for (let d = 0; d < 3; d += 1) {
  fail(persistentAdverse.plan[d]?.session?.category !== 'Hard Endurance' && persistentAdverse.plan[d]?.session?.category !== 'Race-Specific Endurance', `Persistent 3-day adverse case scheduled high-intensity endurance on day ${d + 1} (${persistentAdverse.plan[d]?.session?.templateId}).`);
}
fail(['Rest', 'Mobility/Recovery'].includes(persistentAdverse.plan[0]?.session?.category), 'Persistent 3-day adverse Day 1 must be Rest or Recovery.');

const soreLegs = required('judge_conflict_sore_legs_great_hrv');
const soreLegsDay1 = soreLegs.plan[0];
fail(soreLegsDay1 && (!(soreLegsDay1.session.safetyTags ?? []).includes('avoid_heavy_lower_body') || (soreLegsDay1.session.costProfile?.lowerBody ?? 0) <= 0.6), 'Sore legs case scheduled heavy lower-body loading on day 1 despite muscle soreness.');

if (failures.length > 0) {
  console.error('Plan-judge invariant failures:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
const familiesSha256 = createHash('sha256').update(raw).digest('hex');
console.log(`Plan-judge invariants passed for ${cases.size} cases across ${families.length} families.`);
console.log(`Families SHA-256: ${familiesSha256}`);
console.log(`Event-demand sequence distance: A=${demandDistanceA.toFixed(3)}, B=${demandDistanceB.toFixed(3)}.`);
console.log(`Compact criterium template count: criterium A=${critACompactCount}, gran fondo A=${granACompactCount}.`);
