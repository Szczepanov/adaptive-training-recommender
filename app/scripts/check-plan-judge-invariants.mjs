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
  ['recent_training', 7],
  ['event_proximity', 7],
  ['preferences_capacity', 6],
  ['event_demand', 4],
  ['interactions', 8],
  ['delivered_dose_variance', 4],
  ['concurrent_strength_endurance', 4],
  ['injury_constraints', 4],
  ['planning_modes_overlays', 4],
  ['temporal_acute_vs_persistent', 4],
  ['conflicting_tissue_vs_wearable', 4],
  ['same_day_execution_state', 4],
  ['multi_event_lifecycle', 5],
  ['partial_observability', 5],
  ['clinical_trajectory', 5],
  ['non_training_physical_load', 4],
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
const trajectory = (item) => Array.isArray(item.input?.readinessTrajectory) ? item.input.readinessTrajectory : [];

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
fail(travel.input.authoredPlanBlocks == null, 'Travel case advertises an authored plan overlay that the canonical simulation path does not execute.');
for (const day of travel.plan.slice(0, 3)) {
  fail((day.session.requiredEquipment ?? []).length === 0, `${day.date}: travel case selected equipment-dependent ${day.session.templateId}`);
  fail(['indoor', 'either'].includes(day.session.environment), `${day.date}: travel case selected non-indoor ${day.session.templateId}`);
  if (day.session.durationMin !== null) fail(day.session.durationMin <= 30, `${day.date}: travel case exceeded 30-minute travel capacity with ${day.session.templateId}`);
}
// Issue #677: respecting the hard constraints above is not sufficient -- Rest and
// Mobility/Recovery trivially satisfy all three checks too, which is exactly how the
// AI judge caught a real catalog gap that this checker previously missed (every travel
// day silently collapsed to Rest/Mobility with no aerobic maintenance stimulus at all).
fail(travel.plan.slice(0, 3).some((day) => !['Rest', 'Mobility/Recovery'].includes(day.session.category)),
  'Travel case collapses every day in the 3-day window to Rest/Mobility with no equipment-free aerobic maintenance stimulus.');

// Issue #677 originally used whole-horizon monotonicity as a diagnostic hypothesis for
// conservativeBias. Mechanism A (reservation placement) was a real defect and remains
// fixed: matched neutral/conservative runs reserve required roles on the same dates.
//
// Issue #692 resolves Mechanism B differently. The user-facing "Extra Recovery Margin"
// contract is local: when readiness is borderline or ambiguous, bias the decision toward
// lower-risk/lower-dose options. It is not a promise that every synthetic 14-day
// counterfactual has lower cumulative load. Earlier low-load days can reduce the planner's
// model-projected fatigue enough that a later date returns to the train tier and accepts a
// fuller discretionary dose. The per-candidate conservative ranking contract is still a
// hard test in travelConservativeOverlayBoundary.test.ts; the cross-run totals below are
// characterization telemetry only. The projected fatigue score is an internal product
// model, not a calibrated measurement of physiological recovery.
// See docs/analysis/2026-09-19-conservative-travel-overlay-investigation.md and
// docs/analysis/2026-09-20-whole-horizon-fatigue-tier-rebound.md.
const planLoad = (item) => (item.plan ?? []).reduce((acc, day) => {
  const systemic = day.session?.systemicCost ?? 0;
  const cardiovascular = day.session?.costProfile?.cardiovascular ?? 0;
  return {
    hardSessions: acc.hardSessions + (systemic >= 0.6 ? 1 : 0),
    systemic: acc.systemic + systemic,
    cardiovascular: acc.cardiovascular + cardiovascular,
  };
}, { hardSessions: 0, systemic: 0, cardiovascular: 0 });
const conservativeComparisons = [];
const conservativeTelemetry = [];
const recordConservativeTelemetry = (ok, message) => { if (!ok) conservativeTelemetry.push(message); };
const recordConservativeComparison = (neutralId, conservativeId) => {
  const neutral = planLoad(required(neutralId));
  const conservative = planLoad(required(conservativeId));
  const epsilon = 1e-9;
  recordConservativeTelemetry(conservative.hardSessions <= neutral.hardSessions,
    `${conservativeId}: conservative plan has ${conservative.hardSessions} hard sessions vs ${neutral.hardSessions} in ${neutralId}.`);
  recordConservativeTelemetry(conservative.systemic <= neutral.systemic + epsilon,
    `${conservativeId}: cumulative systemic cost ${conservative.systemic.toFixed(3)} exceeds ${neutral.systemic.toFixed(3)} in ${neutralId}.`);
  recordConservativeTelemetry(conservative.cardiovascular <= neutral.cardiovascular + epsilon,
    `${conservativeId}: cumulative cardiovascular cost ${conservative.cardiovascular.toFixed(3)} exceeds ${neutral.cardiovascular.toFixed(3)} in ${neutralId}.`);
  conservativeComparisons.push({ neutralId, conservativeId, neutral, conservative });
};
recordConservativeComparison('judge_pref_neutral', 'judge_pref_conservative');
recordConservativeComparison('judge_mode_event_directed', 'judge_mode_conservative_preference');

const evergreen = required('judge_mode_evergreen');
fail(evergreen.input.trainingIntentProfile?.planningMode === 'evergreen', 'Evergreen case did not propagate a valid trainingIntentProfile.planningMode.');
fail((evergreen.input.events ?? []).length === 0 && evergreen.input.event === null, 'Evergreen case still carries an event.');

for (const item of cases.values()) {
  const itemEvents = (item.input?.events?.length ?? 0) > 0
    ? item.input.events
    : (item.input?.event ? [item.input.event] : []);
  const planDates = item.plan?.map((day) => day.date) ?? [];
  // Some families (e.g. event proximity) deliberately schedule an event beyond the
  // simulated horizon; absence there is expected, not a dropped plan day.
  const planEndDate = planDates.length > 0 ? planDates.reduce((max, date) => (date > max ? date : max)) : null;

  for (const event of itemEvents) {
    if (!event?.date) continue;
    const eventCommitment = (item.input.fixedActivities ?? []).find((activity) => activity.id === `judge-event:${event.id}`);
    const inactive = event.lifecycle === 'cancelled' || event.lifecycle === 'DNS';
    if (inactive) {
      fail(!eventCommitment, `${item.input.caseId}: inactive event ${event.id} still owns a fixed activity.`);
      continue;
    }
    if (!eventCommitment || (planEndDate && event.date > planEndDate)) continue;
    const eventDay = item.plan?.find((day) => day.date === event.date);
    fail(Boolean(eventDay), `${item.input.caseId}: scheduled event date ${event.date} is missing from the simulated plan.`);
    if (eventDay) {
      fail(['Rest', 'Mobility/Recovery'].includes(eventDay.session.category), `${item.input.caseId}: scheduled event date ${event.date} also contains independent ${eventDay.session.title}.`);
    }
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

// Dynamic temporal invariants: these are explicit daily observations, not weekly anchors.
const neutralTrajectory = required('judge_traj_neutral');
const acuteAdverse = required('judge_traj_acute_adverse_day1');
const persistentAdverse = required('judge_traj_persistent_adverse_3d');
const improving = required('judge_traj_improving_trend');
for (const item of [neutralTrajectory, acuteAdverse, persistentAdverse, improving]) {
  fail(item.input.simulationMode === 'rolling_daily', `${item.input.caseId}: temporal case is not marked rolling_daily.`);
  fail(trajectory(item).length === 14, `${item.input.caseId}: expected 14 daily readiness observations, got ${trajectory(item).length}.`);
  fail((item.plan ?? []).length === 14, `${item.input.caseId}: expected 14 rolling daily decisions, got ${item.plan?.length ?? 0}.`);
  fail(trajectory(item).every((day, index) => day.date === item.plan?.[index]?.date), `${item.input.caseId}: readiness trajectory dates do not align one-to-one with plan dates.`);
}

const acuteTrajectory = trajectory(acuteAdverse);
fail(acuteTrajectory[0]?.subjective?.readiness === 3 && acuteTrajectory[0]?.objective?.hrv_delta === -17, 'Acute trajectory Day 1 is not the intended adverse observation.');
fail(acuteTrajectory[1]?.subjective?.readiness === 6 && acuteTrajectory[1]?.objective?.hrv_delta === 0, 'Acute trajectory did not recover to neutral on Day 2.');
const day1Cost = acuteAdverse.plan[0]?.session?.systemicCost ?? 1.0;
fail(day1Cost <= 0.4 || ['Rest', 'Mobility/Recovery'].includes(acuteAdverse.plan[0]?.session?.category), 'Acute 1-day adverse recovery case did not scale back Day 1 load.');

const persistentTrajectory = trajectory(persistentAdverse);
for (let d = 0; d < 3; d += 1) {
  fail(persistentTrajectory[d]?.subjective?.readiness === 3 && persistentTrajectory[d]?.objective?.hrv_delta === -17, `Persistent trajectory Day ${d + 1} is not adverse.`);
  fail(persistentAdverse.plan[d]?.session?.category !== 'Hard Endurance' && persistentAdverse.plan[d]?.session?.category !== 'Race-Specific Endurance', `Persistent 3-day adverse case scheduled high-intensity endurance on day ${d + 1} (${persistentAdverse.plan[d]?.session?.templateId}).`);
}
fail(persistentTrajectory[3]?.subjective?.readiness === 6 && persistentTrajectory[3]?.objective?.hrv_delta === 0, 'Persistent trajectory did not return to neutral on Day 4.');
fail(['Rest', 'Mobility/Recovery'].includes(persistentAdverse.plan[0]?.session?.category), 'Persistent 3-day adverse Day 1 must be Rest or Recovery.');

const improvingTrajectory = trajectory(improving);
fail(improvingTrajectory[0]?.subjective?.readiness === 5 && improvingTrajectory[0]?.objective?.hrv_delta === -5, 'Improving trajectory Day 1 is not borderline.');
fail(improvingTrajectory[1]?.subjective?.readiness === 6 && improvingTrajectory[1]?.objective?.hrv_delta === 0, 'Improving trajectory Day 2 is not neutral.');
fail(improvingTrajectory[2]?.subjective?.readiness === 9 && improvingTrajectory[2]?.objective?.hrv_delta === 8, 'Improving trajectory Day 3 is not fresh.');

const soreLegs = required('judge_conflict_sore_legs_great_hrv');
const soreLegsDay1 = soreLegs.plan[0];
fail(Boolean(soreLegsDay1)
  && !(soreLegsDay1.session.safetyTags ?? []).includes('avoid_heavy_lower_body')
  && (soreLegsDay1.session.costProfile?.lowerBody ?? 0) <= 0.6,
'Sore legs case scheduled heavy lower-body loading on day 1 despite muscle soreness.');

const systemicCollapse = required('judge_conflict_fresh_legs_terrible_hrv').plan[0];
fail(Boolean(systemicCollapse)
  && ((systemicCollapse.session.systemicCost ?? 1) <= 0.4 || ['Rest', 'Mobility/Recovery'].includes(systemicCollapse.session.category)),
'Fresh legs with severe systemic wearable collapse did not scale back Day 1 systemic load.');



const sameDaySelf = required('judge_today_self_report_done');
const sameDayDevice = required('judge_today_device_hard');
const sameDayBoth = required('judge_today_both_hard');
for (const item of [sameDaySelf, sameDayDevice, sameDayBoth]) {
  const day1 = item.plan?.[0];
  fail(Boolean(day1) && day1.session.category === 'Rest' && (day1.session.systemicCost ?? 1) === 0,
    `${item.input.caseId}: same-day completed-training evidence did not force canonical Rest on Day 1.`);
}
fail(templateSequenceDistance(sameDayDevice, sameDayBoth) === 0,
  'Duplicate self-report + device completion evidence changed the selected-template sequence relative to device evidence alone.');

const cancelledEventCase = required('judge_events_cancelled_then_A10');
const cancelledEvent = cancelledEventCase.input.events?.find((event) => event.lifecycle === 'cancelled');
fail(Boolean(cancelledEvent), 'Cancelled-event fixture does not contain the intended cancelled lifecycle event.');
if (cancelledEvent) {
  fail(!(cancelledEventCase.input.fixedActivities ?? []).some((activity) => activity.id === `judge-event:${cancelledEvent.id}`),
    'Cancelled event still produced a fixed activity commitment.');
}

const noWearables = required('judge_obs_no_wearables');
fail(noWearables.input.readiness?.objective?.hrv_delta === null
  && noWearables.input.readiness?.objective?.rhr_delta === null
  && noWearables.input.readiness?.objective?.sleep_score === null
  && noWearables.input.readiness?.objective?.body_battery_wake === null,
'No-wearables observability fixture does not preserve missing objective evidence as null.');
const partialSubjective = required('judge_obs_partial_subjective');
fail(JSON.stringify(partialSubjective.input.readiness?.subjective?.answeredDimensions) === JSON.stringify(['fatigue', 'soreness']),
  'Partial-subjective observability fixture lost its explicit answeredDimensions contract.');

const clinicalCases = [
  required('judge_clin_neutral'),
  required('judge_clin_illness_1d'),
  required('judge_clin_illness_3d'),
  required('judge_clin_pain_1d'),
  required('judge_clin_redflag_1d'),
];
for (const item of clinicalCases) {
  fail(item.input.simulationMode === 'rolling_daily', `${item.input.caseId}: clinical trajectory is not rolling_daily.`);
  fail(trajectory(item).length === 14 && (item.plan ?? []).length === 14,
    `${item.input.caseId}: clinical trajectory must contain 14 observations and 14 decisions.`);
  fail(trajectory(item).every((day, index) => day.date === item.plan?.[index]?.date),
    `${item.input.caseId}: clinical readiness dates do not align one-to-one with plan dates.`);
}
for (const id of ['judge_clin_illness_1d', 'judge_clin_illness_3d', 'judge_clin_pain_1d']) {
  const day1 = required(id).plan?.[0];
  fail(Boolean(day1)
    && ['Rest', 'Mobility/Recovery'].includes(day1.session.category)
    && (day1.session.systemicCost ?? 1) <= 0.15,
  `${id}: active non-red-flag clinical symptoms exceeded the Mobility safety envelope on Day 1.`);
}
const redFlagDay1 = required('judge_clin_redflag_1d').plan?.[0];
fail(Boolean(redFlagDay1) && redFlagDay1.session.category === 'Rest' && (redFlagDay1.session.systemicCost ?? 1) === 0,
  'Red-flag clinical trajectory did not pause physical training with canonical Rest on Day 1.');

const hardPhysicalWorkDay1 = required('judge_work_hard_medium').plan?.[0];
fail(Boolean(hardPhysicalWorkDay1) && (hardPhysicalWorkDay1.session.systemicCost ?? 1) <= 0.5,
  'Hard non-training physical work did not cap Day 1 systemic training load.');
const exhaustingPhysicalWorkDay1 = required('judge_work_exhausting_extended').plan?.[0];
fail(Boolean(exhaustingPhysicalWorkDay1)
  && ['Rest', 'Mobility/Recovery'].includes(exhaustingPhysicalWorkDay1.session.category)
  && (exhaustingPhysicalWorkDay1.session.systemicCost ?? 1) <= 0.15,
'Extended exhausting physical work with residual fatigue did not trigger a recovery-level Day 1.');

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
for (const check of conservativeComparisons) {
  console.log(`Conservative comparison ${check.conservativeId} vs ${check.neutralId}: hard ${check.conservative.hardSessions}/${check.neutral.hardSessions}, systemic ${check.conservative.systemic.toFixed(3)}/${check.neutral.systemic.toFixed(3)}, cardiovascular ${check.conservative.cardiovascular.toFixed(3)}/${check.neutral.cardiovascular.toFixed(3)}.`);
}
if (conservativeTelemetry.length > 0) {
  console.log('Conservative cross-counterfactual telemetry (Mechanism B, Issue #692 accepted non-invariant):');
  for (const item of conservativeTelemetry) console.log(`- ${item}`);
}
