import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServer } from 'vite';

const outputDir = resolve('artifacts/ai-plan-judge/latest');
const familiesPath = resolve(outputDir, 'families.jsonl');
const corpusPath = resolve(outputDir, 'corpus.json');
const promptPath = resolve(outputDir, 'judge-prompt.md');
if (!existsSync(familiesPath)) throw new Error(`Missing base judge corpus: ${familiesPath}`);

function clone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }
function addDays(date, days) {
  const [year, month, day] = date.split('-').map(Number);
  const value = new Date(Date.UTC(year, month - 1, day));
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
function requireScenario(scenarios, id) {
  const scenario = scenarios.find((candidate) => candidate.id === id);
  if (!scenario) throw new Error(`Missing simulation scenario '${id}'.`);
  return scenario;
}
function patchReadiness(base, subjectivePatch = {}, objectivePatch = {}) {
  const readiness = base.readinessForDate?.(base.startDate, 0) ?? base.readinessForWeek(0);
  return { ...clone(readiness), subjective: { ...clone(readiness.subjective), ...subjectivePatch }, objective: { ...clone(readiness.objective), ...objectivePatch } };
}
function userPreferences(overrides = {}) {
  return {
    userId: 'judge-user', preferredRecoveryStyle: 'passive', defaultWeekdayTimeMin: 60, defaultWeekendTimeMin: 120,
    preferredTimeOfDay: 'flexible', preferredModalities: [], deprioritizedModalities: [], avoidedModalities: [], unavailableModalities: [],
    explanationVerbosity: 'detailed', conservativeBias: false,
    preferredUnits: { distance: 'km', weight: 'kg', temperature: 'celsius' }, schemaVersion: 1, createdAt: '', updatedAt: '', ...overrides,
  };
}
function evergreenIntent() {
  return {
    userId: 'judge-user', planningMode: 'evergreen', priorities: ['balanced_performance'],
    weeklyCommitment: { minSessions: 2, targetSessions: 3, maxSessions: 4 }, organizationPreference: 'auto',
    schemaVersion: 1, createdAt: '', updatedAt: '',
  };
}
function eventFixedActivity(event) {
  if (!event?.date || event.lifecycle === 'cancelled' || event.lifecycle === 'DNS') return null;
  const demand = event.demandProfile ?? {};
  return {
    id: `judge-event:${event.id}`,
    userId: 'judge-user',
    title: `Scheduled event: ${event.title}`,
    date: event.date,
    durationMin: 60,
    fixed: true,
    environment: 'outdoor',
    equipment: [],
    isCompleted: false,
    expectedCost: {
      systemic: 0.95,
      cardiovascular: 0.95,
      lowerBody: 0.65,
      upperBody: 0.1,
      impactTissue: 0.2,
      neuromuscular: 0.8,
    },
    expectedStimulus: {
      aerobicEndurance: demand.aerobicEndurance ?? 0.6,
      thresholdPower: demand.thresholdPower ?? 0.6,
      vo2MaxPower: demand.vo2MaxPower ?? 0.6,
      repeatedSurges: demand.repeatedSurges ?? 0.6,
      sprintPower: demand.sprintPower ?? 0.2,
      fatigueResistance: demand.fatigueResistance ?? 0.7,
      maxStrength: 0,
      hypertrophy: 0,
    },
    createdAt: '',
    updatedAt: '',
  };
}
function exposureOn(exposure, date, suffix) {
  return { ...clone(exposure), occurrenceKey: `judge:${suffix}:${date}`, date };
}
function variant(base, id, label, axis, options = {}) {
  const readiness = patchReadiness(base, options.subjective, options.objective);
  const context = clone(base.context);
  if (options.contextPatch) options.contextPatch(context);
  const event = clone(options.event !== undefined ? options.event : (base.event ?? null));
  const events = options.events !== undefined ? clone(options.events) : clone(base.events);
  if (options.eventDaysOut !== undefined && event) event.date = addDays(base.startDate, options.eventDaysOut);
  return {
    axis,
    scenario: {
      ...base, id, label, description: `AI-judge sensitivity case. Changed axis: ${JSON.stringify(axis)}.`, context, event,
      ...(events !== undefined ? { events } : {}),
      ...(options.preferences !== undefined ? { preferences: clone(options.preferences) } : {}),
      ...(options.trainingIntentProfile !== undefined ? { trainingIntentProfile: clone(options.trainingIntentProfile) } : {}),
      ...(options.authoredPlanBlocks !== undefined ? { authoredPlanBlocks: clone(options.authoredPlanBlocks) } : {}),
      ...(options.initialHistory !== undefined ? { initialHistory: clone(options.initialHistory) } : {}),
      ...(options.fixedActivities !== undefined ? { fixedActivities: clone(options.fixedActivities) } : {}),
      startDate: base.startDate, weeks: options.weeks ?? 2,
      readinessForWeek: () => clone(readiness), readinessForDate: () => clone(readiness),
      tags: ['ai-plan-judge', ...(base.tags ?? [])],
    },
  };
}
function judgeContext(input) {
  return {
    readiness: input.readiness,
    event: input.event ?? null,
    events: input.events ?? null,
    preferences: input.preferences ?? input.context?.preferences ?? null,
    constraints: input.context?.constraints ?? null,
    trainingSettings: input.context?.trainingSettings ?? null,
    initialHistory: input.initialHistory ?? [],
    fixedActivities: input.fixedActivities ?? [],
    authoredPlanBlocks: input.authoredPlanBlocks ?? null,
    trainingIntentProfile: input.trainingIntentProfile ?? null,
  };
}
function serializeInput(definition) {
  const scenario = definition.scenario;
  const readiness = scenario.readinessForDate?.(scenario.startDate, 0) ?? scenario.readinessForWeek(0);
  const input = {
    caseId: scenario.id, label: scenario.label, changedAxis: definition.axis, startDate: scenario.startDate, weeks: scenario.weeks,
    readiness, event: scenario.event ?? null, events: scenario.events ?? null,
    preferences: scenario.preferences ?? scenario.context.preferences, context: scenario.context,
    initialHistory: scenario.initialHistory ?? [], fixedActivities: scenario.fixedActivities ?? [],
    authoredPlanBlocks: scenario.authoredPlanBlocks ?? null, trainingIntentProfile: scenario.trainingIntentProfile ?? null,
  };
  input.changedAxis = { ...definition.axis, judgeContext: judgeContext(input) };
  return input;
}
function planFromResult(result, templatesById) {
  return result.decisionTraces.map((trace) => {
    const template = templatesById.get(trace.selected.templateId);
    return {
      date: trace.date, mode: trace.mode, readinessTier: trace.readinessTier,
      session: {
        templateId: trace.selected.templateId, title: template?.title ?? trace.selected.templateId,
        category: trace.selected.category, modality: trace.selected.modality,
        durationMin: template?.durationMin ?? null, durationMax: template?.durationMax ?? null,
        systemicCost: trace.selected.projectedCost.systemic, costProfile: trace.selected.projectedCost,
        stimulusProfile: template?.stimulusProfile ?? null, safetyTags: template?.safetyTags ?? [],
        requiredEquipment: template?.requiredEquipment ?? [], environment: template?.environment ?? 'either',
      },
      projectedFatigue: trace.fatigue, activeObjectives: trace.activeObjectives,
      contributorObjectiveChanges: trace.contributorObjectiveChanges, fixedActivity: trace.fixedActivity,
      rejectionCounts: trace.rejectionCounts, utility: trace.utility,
    };
  });
}
function packetFromResult(definition, result, templatesById) {
  return {
    input: serializeInput(definition), plan: planFromResult(result, templatesById),
    engineSummary: {
      categoryDistribution: result.categoryDistribution, modalityDistribution: result.modalityDistribution,
      restOrRecoveryDayCount: result.restOrRecoveryDayCount, fatigueTierDayCounts: result.fatigueTierDayCounts,
      objectiveResolution: result.objectiveResolution, constraintViolations: result.constraintViolations,
      qualityWarnings: result.qualityWarnings, anchorWeeks: result.anchorWeeks,
    },
  };
}

const rows = readFileSync(familiesPath, 'utf8').split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map(JSON.parse);
const server = await createServer({ configFile: false, root: resolve('.'), logLevel: 'warn', server: { middlewareMode: true }, appType: 'custom' });
try {
  const scenariosModule = await server.ssrLoadModule('/src/engine/simulation/scenarios.ts');
  const analyzeModule = await server.ssrLoadModule('/src/engine/simulation/analyze.ts');
  const templatesModule = await server.ssrLoadModule('/src/engine/templates.ts');
  const base = requireScenario(scenariosModule.SCENARIOS, 'cycling_criterium_A');
  const hardLoadSource = requireScenario(scenariosModule.SCENARIOS, 'external_load_green_readiness');
  const hardExposure = hardLoadSource.initialHistory?.[0];
  if (!hardExposure) throw new Error('Judge corpus requires a hard recent-training fixture.');
  const templatesById = new Map(templatesModule.ENRICHED_TEMPLATES.map((template) => [template.id, template]));
  const neutral = (id, label, axis, options = {}) => variant(base, id, label, axis, options);

  const replacements = new Map();
  const preferences = [
    neutral('judge_pref_neutral', 'Preferences/capacity — passive recovery baseline', { preference: 'passive_recovery' }, { preferences: userPreferences({ preferredRecoveryStyle: 'passive' }) }),
    neutral('judge_pref_conservative', 'Preferences/capacity — conservative bias', { preference: 'conservative_bias' }, { preferences: userPreferences({ conservativeBias: true }), contextPatch: (c) => { c.preferences.conservativeBias = true; } }),
    neutral('judge_pref_active_recovery', 'Preferences/capacity — active recovery style', { preference: 'active_recovery' }, { preferences: userPreferences({ preferredRecoveryStyle: 'active' }), contextPatch: (c) => { c.preferences.preferredRecoveryStyle = 'active'; } }),
    neutral('judge_pref_mixed_recovery', 'Preferences/capacity — mixed recovery style', { preference: 'mixed_recovery' }, { preferences: userPreferences({ preferredRecoveryStyle: 'mixed' }), contextPatch: (c) => { c.preferences.preferredRecoveryStyle = 'mixed'; } }),
    neutral('judge_pref_45min', 'Preferences/capacity — 45 minute weekdays', { capacity: '45_min_weekday' }, { preferences: userPreferences({ defaultWeekdayTimeMin: 45 }), contextPatch: (c) => { c.constraints.maxTimeMinutes = 45; if (c.trainingSettings) c.trainingSettings.defaults.weekdayMaxMinutes = 45; } }),
    neutral('judge_pref_90min', 'Preferences/capacity — 90 minute weekdays', { capacity: '90_min_weekday' }, { preferences: userPreferences({ defaultWeekdayTimeMin: 90 }), contextPatch: (c) => { c.constraints.maxTimeMinutes = 90; if (c.trainingSettings) c.trainingSettings.defaults.weekdayMaxMinutes = 90; } }),
  ];
  const injuries = [
    neutral('judge_injury_none', 'Injury — healthy baseline', { injuryConstraint: 'none' }),
    neutral('judge_injury_running_restricted', 'Injury — restricted running modality', { injuryConstraint: 'restricted_running' }, { contextPatch: (c) => {
      c.constraints.restrictedModalities = ['Running'];
      c.constraints.impliedGuardrails = [...new Set([...(c.constraints.impliedGuardrails ?? []), 'avoid_high_impact'])];
      if (c.trainingSettings) c.trainingSettings.guardrails.avoid_high_impact = true;
    } }),
    neutral('judge_injury_lower_body_restricted', 'Injury — avoid heavy lower body', { injuryConstraint: 'avoid_heavy_lower_body' }, { contextPatch: (c) => {
      c.constraints.impliedGuardrails = [...new Set([...(c.constraints.impliedGuardrails ?? []), 'avoid_heavy_lower_body'])];
      if (c.trainingSettings) c.trainingSettings.guardrails.avoid_heavy_lower_body = true;
    } }),
    neutral('judge_injury_expired', 'Injury — expired review, no active engine restriction', { injuryConstraint: 'expired_review_inactive' }),
  ];
  const modes = [
    neutral('judge_mode_event_directed', 'Planning mode — event directed A-race', { planningMode: 'event_directed' }),
    variant(base, 'judge_mode_evergreen', 'Planning mode — evergreen fitness maintenance', { planningMode: 'evergreen' }, { event: null, events: [], trainingIntentProfile: evergreenIntent(), preferences: userPreferences({ preferredRecoveryStyle: 'mixed' }) }),
    neutral('judge_mode_travel_overlay', 'Planning mode — 3-day travel constraints + authored overlay', { planningMode: 'travel_overlay' }, {
      authoredPlanBlocks: [{ id: 'travel-block-1', userId: 'judge-user', phase: 'travel', startDate: base.startDate, endDate: addDays(base.startDate, 2), volumeScale: 0.5, intensityScale: 0.7, createdAt: '', updatedAt: '' }],
      contextPatch: (c) => {
        c.constraints.maxTimeMinutes = 30; c.constraints.hasFreeWeights = false; c.constraints.hasCableMachine = false; c.constraints.hasTreadmill = false; c.constraints.hasIndoorBike = false;
        if (c.trainingSettings) {
          for (const key of Object.keys(c.trainingSettings.equipment)) c.trainingSettings.equipment[key] = false;
          c.trainingSettings.defaults.weekdayMaxMinutes = 30; c.trainingSettings.defaults.weekendMaxMinutes = 30; c.trainingSettings.defaults.environment = 'indoor';
        }
      },
    }),
    neutral('judge_mode_conservative_preference', 'Planning mode — high conservative bias', { planningMode: 'conservative_overlay' }, { preferences: userPreferences({ conservativeBias: true }), contextPatch: (c) => { c.preferences.conservativeBias = true; } }),
  ];

  const eventProximity = [40, 20, 14, 7, 3].map((daysOut) => {
    const event = clone(base.event);
    event.date = addDays(base.startDate, daysOut);
    return variant(base, `judge_event_${daysOut}d`, `Event proximity — ${daysOut} days`, { eventDaysOut: daysOut }, {
      event,
      fixedActivities: [eventFixedActivity(event)].filter(Boolean),
    });
  });

  const goodObjective = { hrv_delta: 8, hrv_delta_28d: 8, hrv_last_night: 58, rhr: 46, rhr_delta: -4, rhr_delta_28d: -4, sleep_score: 92, sleep_duration_min: 480, sleep_score_delta_7d: 8, sleep_score_delta_28d: 8, body_battery_wake: 92 };
  const badObjective = { hrv_delta: -17, hrv_delta_28d: -17, hrv_last_night: 33, rhr: 57, rhr_delta: 7, rhr_delta_28d: 7, sleep_score: 50, sleep_duration_min: 300, sleep_score_delta_7d: -28, sleep_score_delta_28d: -28, body_battery_wake: 22 };
  const goodSubjective = { readiness: 9, sleepQuality: 9, fatigue: 1, soreness: 1, stress: 2, motivation: 9 };
  const badSubjective = { readiness: 3, sleepQuality: 4, fatigue: 8, soreness: 7, stress: 8, motivation: 3 };
  const race7 = clone(base.event);
  race7.date = addDays(base.startDate, 7);
  const race7Fixed = [eventFixedActivity(race7)].filter(Boolean);
  const interactions = [
    neutral('judge_int_fresh_hard_yday', 'Interaction — fresh metrics + hard yesterday', { interaction: 'fresh_plus_hard_yesterday' }, { subjective: goodSubjective, objective: goodObjective, initialHistory: [exposureOn(hardExposure, addDays(base.startDate, -1), 'fresh-hard-yesterday')] }),
    neutral('judge_int_badobj_noload', 'Interaction — poor objective metrics + no seeded load', { interaction: 'bad_objective_no_load' }, { objective: badObjective, initialHistory: [] }),
    neutral('judge_int_badobj_hard_yday', 'Interaction — poor objective metrics + hard yesterday', { interaction: 'bad_objective_hard_yesterday' }, { objective: badObjective, initialHistory: [exposureOn(hardExposure, addDays(base.startDate, -1), 'badobj-hard-yesterday')] }),
    neutral('judge_int_badsubj_goodobj', 'Interaction — poor subjective + good objective', { interaction: 'bad_subjective_good_objective' }, { subjective: badSubjective, objective: goodObjective }),
    neutral('judge_int_goodsubj_badobj', 'Interaction — good subjective + poor objective', { interaction: 'good_subjective_bad_objective' }, { subjective: goodSubjective, objective: badObjective }),
    variant(base, 'judge_int_race7_fresh', 'Interaction — race in 7 days + fresh', { interaction: 'race7_fresh' }, { event: race7, subjective: goodSubjective, objective: goodObjective, fixedActivities: race7Fixed }),
    variant(base, 'judge_int_race7_hard_yday', 'Interaction — race in 7 days + hard yesterday', { interaction: 'race7_hard_yesterday' }, { event: race7, initialHistory: [exposureOn(hardExposure, addDays(base.startDate, -1), 'race7-hard-yesterday')], fixedActivities: race7Fixed }),
    variant(base, 'judge_int_race7_badobj', 'Interaction — race in 7 days + poor objective recovery', { interaction: 'race7_bad_objective' }, { event: race7, objective: badObjective, fixedActivities: race7Fixed }),
  ];

  for (const [familyId, changedAxis, definitions] of [
    ['preferences_capacity', 'recovery preference / conservatism / time capacity', preferences],
    ['injury_constraints', 'structured injury guardrails and modality restrictions', injuries],
    ['planning_modes_overlays', 'macro planning modes and travel constraints/overlays', modes],
    ['event_proximity', 'days to A-priority criterium with event-day commitment reserved', eventProximity],
    ['interactions', 'selected multi-signal interactions with scheduled event load reserved', interactions],
  ]) {
    const cases = [];
    for (const definition of definitions) cases.push(packetFromResult(definition, await analyzeModule.runScenario(definition.scenario), templatesById));
    replacements.set(familyId, { familyId, changedAxis, comparisonInstruction: 'Compare cases within this family. An unchanged plan is acceptable when the changed axis is not decision-relevant; hard safety and scheduled commitments must always be obeyed.', cases });
  }

  const patched = rows.map((family) => replacements.get(family.familyId) ?? {
    ...family,
    cases: family.cases.map((item) => {
      const input = clone(item.input);
      const axis = input.changedAxis && typeof input.changedAxis === 'object' ? input.changedAxis : { value: input.changedAxis };
      input.changedAxis = { ...axis, judgeContext: judgeContext(input) };
      return { ...item, input };
    }),
  });
  writeFileSync(familiesPath, `${patched.map((family) => JSON.stringify(family)).join('\n')}\n`);

  if (existsSync(corpusPath)) {
    const corpus = JSON.parse(readFileSync(corpusPath, 'utf8'));
    corpus.schema = 'adaptive-training-recommender/ai-plan-judge-corpus@2';
    corpus.familyCount = patched.length;
    corpus.caseCount = patched.reduce((sum, family) => sum + family.cases.length, 0);
    corpus.families = patched;
    corpus.harnessCorrections = ['planner-facing preferences', 'active injury guardrail paths', 'valid evergreen intent', 'travel constraints', 'judge-context enrichment', 'scheduled event fixed-activity ownership'];
    writeFileSync(corpusPath, `${JSON.stringify(corpus, null, 2)}\n`);
  }

  const prompt = `# AI plan judge instructions\n\nYou are an independent endurance-training plan evaluator. Engine rationale, fatigue tiers, rejection codes and utility are diagnostics, not ground truth. Evaluate the whole multi-day sequence. Scheduled events represented in fixedActivities own their event date and contribute reserved load; do not ask the planner to schedule another workout on top of them.\n\nScore each case 0-10 on safety_recovery_fit, goal_event_fit, sequencing, periodization_taper, preference_capacity_fit, robustness and overall, plus family sensitivity_quality.\n\nCalibration rules:\n- Sensitivity does not require every perturbation to change the plan. Mild isolated variation (including ~1 SD HRV/RHR movement) can legitimately leave a good plan unchanged.\n- Low motivation alone is not a physiological safety signal.\n- Easy training yesterday does not make quality work today unsafe; judge actual delivered load and residual fatigue.\n- Judge taper by workload/volume reduction with appropriate intensity/specificity, not rest-day count alone.\n- Preferences are soft unless encoded as constraints; safety restrictions and time/equipment availability are hard. Never propose violating a hard capacity/equipment restriction as the fix.\n- Criterium/surge events should emphasize repeated surges/VO2/sprint qualities, while long gran-fondo demands emphasize sustained aerobic durability/fatigue resistance.\n- More recovery is not automatically better; more training is not automatically better.\n- Prefer repeated family patterns over one-off threshold tuning.\n\nReturn exactly one JSON object matching judge-response-schema.json. All flags, suggestedChanges and familyAssessment list fields must be JSON arrays of strings.\n`;
  writeFileSync(promptPath, prompt);
  console.log('Patched AI-judge corpus with corrected fixtures, scheduled event ownership, and enriched judge context.');
} finally {
  await server.close();
}
