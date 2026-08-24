import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const path = resolve(process.argv[2] ?? 'artifacts/ai-plan-judge/latest/families.jsonl');
if (!existsSync(path)) throw new Error(`Missing judge corpus: ${path}`);

const families = readFileSync(path, 'utf8').split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map(JSON.parse);
const cases = new Map();
for (const family of families) {
  for (const item of family.cases ?? []) {
    const id = item.input?.caseId;
    if (!id) throw new Error(`Family ${family.familyId} contains a case without input.caseId`);
    if (cases.has(id)) throw new Error(`Duplicate judge case id: ${id}`);
    cases.set(id, item);
  }
}

const failures = [];
const required = (id) => {
  const value = cases.get(id);
  if (!value) throw new Error(`Missing required judge case: ${id}`);
  return value;
};
const fail = (ok, message) => { if (!ok) failures.push(message); };
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

if (failures.length > 0) {
  console.error('Plan-judge invariant failures:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log(`Plan-judge invariants passed for ${cases.size} cases across ${families.length} families.`);
console.log(`Event-demand sequence distance: A=${demandDistanceA.toFixed(3)}, B=${demandDistanceB.toFixed(3)}.`);
