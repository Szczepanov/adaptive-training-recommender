import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { createServer } from 'vite';

function gitCommit() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

function addDays(date, days) {
  const [year, month, day] = date.split('-').map(Number);
  const value = new Date(Date.UTC(year, month - 1, day));
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function requireScenario(scenarios, id) {
  const scenario = scenarios.find((candidate) => candidate.id === id);
  if (!scenario) throw new Error(`Missing simulation scenario '${id}'.`);
  return scenario;
}

function patchReadiness(base, subjectivePatch = {}, objectivePatch = {}) {
  const readiness = base.readinessForDate?.(base.startDate, 0) ?? base.readinessForWeek(0);
  return {
    ...clone(readiness),
    subjective: { ...clone(readiness.subjective), ...subjectivePatch },
    objective: { ...clone(readiness.objective), ...objectivePatch },
  };
}

function scenarioVariant(base, id, label, axis, options = {}) {
  const readiness = patchReadiness(base, options.subjective, options.objective);
  const context = clone(base.context);
  const event = clone(options.event ?? base.event ?? null);
  const events = options.events ? clone(options.events) : undefined;

  if (options.contextPatch) options.contextPatch(context);
  if (options.eventDaysOut !== undefined && event) event.date = addDays(base.startDate, options.eventDaysOut);
  if (options.eventPriority && event) event.priority = options.eventPriority;

  return {
    scenario: {
      ...base,
      id,
      label,
      description: `AI-judge sensitivity case. Changed axis: ${JSON.stringify(axis)}.`,
      context,
      event,
      ...(events ? { events } : {}),
      startDate: base.startDate,
      weeks: options.weeks ?? 2,
      readinessForWeek: () => clone(readiness),
      readinessForDate: () => clone(readiness),
      ...(options.initialHistory !== undefined ? { initialHistory: clone(options.initialHistory) } : {}),
      tags: ['ai-plan-judge', ...(base.tags ?? []), ...(options.tags ?? [])],
    },
    axis,
  };
}

function exposureOn(exposure, date, occurrenceSuffix) {
  return {
    ...clone(exposure),
    occurrenceKey: `judge:${occurrenceSuffix}:${date}`,
    date,
  };
}

function makeFamilies(scenarios, deliveredDoseModule, resolveDemandProfile) {
  const base = requireScenario(scenarios, 'cycling_criterium_A');
  const granFondo = requireScenario(scenarios, 'cycling_gran_fondo_A');
  const hardLoadSource = requireScenario(scenarios, 'external_load_green_readiness');
  const completionSource = requireScenario(scenarios, 'inferred_partial_completion');
  const hardExposure = hardLoadSource.initialHistory?.[0];
  const easyExposure = completionSource.initialHistory?.find((item) => item.category === 'Easy Endurance');
  if (!hardExposure || !easyExposure) throw new Error('Judge corpus requires hard and easy history fixtures.');

  const neutral = (id, label, axis = { state: 'neutral' }, options = {}) =>
    scenarioVariant(base, id, label, axis, options);

  const objectiveRecovery = [
    neutral('judge_obj_neutral', 'Objective recovery — neutral'),
    neutral('judge_obj_hrv_1sd', 'Objective recovery — HRV down ~1 SD', { objectiveRecovery: 'hrv_down_1sd' }, { objective: { hrv_delta: -8.5, hrv_delta_28d: -8.5, hrv_last_night: 41.5 } }),
    neutral('judge_obj_hrv_2sd', 'Objective recovery — HRV down ~2 SD', { objectiveRecovery: 'hrv_down_2sd' }, { objective: { hrv_delta: -17, hrv_delta_28d: -17, hrv_last_night: 33 } }),
    neutral('judge_obj_rhr_1sd', 'Objective recovery — RHR up ~1 SD', { objectiveRecovery: 'rhr_up_1sd' }, { objective: { rhr: 53.5, rhr_delta: 3.5, rhr_delta_28d: 3.5 } }),
    neutral('judge_obj_rhr_2sd', 'Objective recovery — RHR up ~2 SD', { objectiveRecovery: 'rhr_up_2sd' }, { objective: { rhr: 57, rhr_delta: 7, rhr_delta_28d: 7 } }),
    neutral('judge_obj_poor_sleep', 'Objective recovery — poor sleep', { objectiveRecovery: 'poor_sleep' }, { objective: { sleep_score: 52, sleep_duration_min: 315, sleep_score_delta_7d: -25, sleep_score_delta_28d: -25, body_battery_wake: 45 } }),
    neutral('judge_obj_low_battery', 'Objective recovery — low body battery', { objectiveRecovery: 'low_body_battery' }, { objective: { body_battery_wake: 25 } }),
    neutral('judge_obj_combined_bad', 'Objective recovery — combined adverse metrics', { objectiveRecovery: 'combined_bad' }, { objective: { hrv_delta: -17, hrv_delta_28d: -17, hrv_last_night: 33, rhr: 57, rhr_delta: 7, rhr_delta_28d: 7, sleep_score: 50, sleep_duration_min: 300, sleep_score_delta_7d: -28, sleep_score_delta_28d: -28, body_battery_wake: 22 } }),
  ];

  const subjectiveRecovery = [
    neutral('judge_subj_neutral', 'Subjective recovery — neutral'),
    neutral('judge_subj_fresh', 'Subjective recovery — very fresh', { subjectiveRecovery: 'fresh' }, { subjective: { readiness: 9, sleepQuality: 9, fatigue: 1, soreness: 1, stress: 2, motivation: 9 } }),
    neutral('judge_subj_low_readiness', 'Subjective recovery — low readiness', { subjectiveRecovery: 'low_readiness' }, { subjective: { readiness: 4 } }),
    neutral('judge_subj_fatigue', 'Subjective recovery — high fatigue', { subjectiveRecovery: 'high_fatigue' }, { subjective: { fatigue: 8 } }),
    neutral('judge_subj_soreness', 'Subjective recovery — high soreness', { subjectiveRecovery: 'high_soreness' }, { subjective: { soreness: 8 } }),
    neutral('judge_subj_stress', 'Subjective recovery — high stress', { subjectiveRecovery: 'high_stress' }, { subjective: { stress: 9 } }),
    neutral('judge_subj_low_motivation', 'Subjective recovery — low motivation', { subjectiveRecovery: 'low_motivation' }, { subjective: { motivation: 2 } }),
    neutral('judge_subj_combined_bad', 'Subjective recovery — combined adverse report', { subjectiveRecovery: 'combined_bad' }, { subjective: { readiness: 3, sleepQuality: 4, fatigue: 8, soreness: 7, stress: 8, motivation: 3 } }),
  ];

  const recentTraining = [
    neutral('judge_load_none', 'Recent training — no seeded load', { recentTraining: 'none' }, { initialHistory: [] }),
    neutral('judge_load_easy_yesterday', 'Recent training — easy Z2 yesterday', { recentTraining: 'easy_yesterday' }, { initialHistory: [exposureOn(easyExposure, addDays(base.startDate, -1), 'easy-yesterday')] }),
    neutral('judge_load_hard_yesterday', 'Recent training — hard cycling yesterday', { recentTraining: 'hard_yesterday' }, { initialHistory: [exposureOn(hardExposure, addDays(base.startDate, -1), 'hard-yesterday')] }),
    neutral('judge_load_hard_2d', 'Recent training — hard cycling two days ago', { recentTraining: 'hard_2d' }, { initialHistory: [exposureOn(hardExposure, addDays(base.startDate, -2), 'hard-2d')] }),
    neutral('judge_load_hard_3d', 'Recent training — hard cycling three days ago', { recentTraining: 'hard_3d' }, { initialHistory: [exposureOn(hardExposure, addDays(base.startDate, -3), 'hard-3d')] }),
  ];

  const eventProximity = [40, 20, 14, 7, 3].map((daysOut) =>
    neutral(`judge_event_${daysOut}d`, `Event proximity — ${daysOut} days`, { eventDaysOut: daysOut }, { eventDaysOut: daysOut }));

  const capacityPreferences = [
    neutral('judge_pref_neutral', 'Preferences/capacity — neutral'),
    neutral('judge_pref_conservative', 'Preferences/capacity — conservative bias', { preference: 'conservative_bias' }, { contextPatch: (context) => { context.preferences.conservativeBias = true; if (context.trainingSettings) context.trainingSettings.defaults.conservativeBias = true; } }),
    neutral('judge_pref_active_recovery', 'Preferences/capacity — active recovery style', { preference: 'active_recovery' }, { contextPatch: (context) => { context.preferences.preferredRecoveryStyle = 'active'; } }),
    neutral('judge_pref_mixed_recovery', 'Preferences/capacity — mixed recovery style', { preference: 'mixed_recovery' }, { contextPatch: (context) => { context.preferences.preferredRecoveryStyle = 'mixed'; } }),
    neutral('judge_pref_45min', 'Preferences/capacity — 45 minute weekdays', { capacity: '45_min_weekday' }, { contextPatch: (context) => { context.constraints.maxTimeMinutes = 45; if (context.trainingSettings) context.trainingSettings.defaults.weekdayMaxMinutes = 45; } }),
    neutral('judge_pref_90min', 'Preferences/capacity — 90 minute weekdays', { capacity: '90_min_weekday' }, { contextPatch: (context) => { context.constraints.maxTimeMinutes = 90; if (context.trainingSettings) context.trainingSettings.defaults.weekdayMaxMinutes = 90; } }),
  ];

  const critEventA = { ...clone(base.event), priority: 'A', eventPreset: 'criterium', demandProfile: resolveDemandProfile('cycling_event', 'criterium') };
  const critEventB = { ...clone(base.event), priority: 'B', eventPreset: 'criterium', demandProfile: resolveDemandProfile('cycling_event', 'criterium') };
  const granEventA = { ...clone(granFondo.event), priority: 'A', eventPreset: 'gran_fondo', demandProfile: resolveDemandProfile('cycling_event', 'gran_fondo') };
  const granEventB = { ...clone(granFondo.event), priority: 'B', eventPreset: 'gran_fondo', demandProfile: resolveDemandProfile('cycling_event', 'gran_fondo') };

  const eventDemand = [
    scenarioVariant(base, 'judge_demand_crit_A', 'Event demand — criterium A', { eventDemand: 'criterium', priority: 'A' }, { event: critEventA }),
    scenarioVariant(base, 'judge_demand_crit_B', 'Event demand — criterium B', { eventDemand: 'criterium', priority: 'B' }, { event: critEventB }),
    scenarioVariant(base, 'judge_demand_gran_A', 'Event demand — gran fondo A', { eventDemand: 'gran_fondo', priority: 'A' }, { event: granEventA }),
    scenarioVariant(base, 'judge_demand_gran_B', 'Event demand — gran fondo B', { eventDemand: 'gran_fondo', priority: 'B' }, { event: granEventB }),
  ];

  const goodObjective = { hrv_delta: 8, hrv_delta_28d: 8, hrv_last_night: 58, rhr: 46, rhr_delta: -4, rhr_delta_28d: -4, sleep_score: 92, sleep_duration_min: 480, sleep_score_delta_7d: 8, sleep_score_delta_28d: 8, body_battery_wake: 92 };
  const badObjective = { hrv_delta: -17, hrv_delta_28d: -17, hrv_last_night: 33, rhr: 57, rhr_delta: 7, rhr_delta_28d: 7, sleep_score: 50, sleep_duration_min: 300, sleep_score_delta_7d: -28, sleep_score_delta_28d: -28, body_battery_wake: 22 };
  const goodSubjective = { readiness: 9, sleepQuality: 9, fatigue: 1, soreness: 1, stress: 2, motivation: 9 };
  const badSubjective = { readiness: 3, sleepQuality: 4, fatigue: 8, soreness: 7, stress: 8, motivation: 3 };

  const interactions = [
    neutral('judge_int_fresh_hard_yday', 'Interaction — fresh metrics + hard yesterday', { interaction: 'fresh_plus_hard_yesterday' }, { subjective: goodSubjective, objective: goodObjective, initialHistory: [exposureOn(hardExposure, addDays(base.startDate, -1), 'fresh-hard-yesterday')] }),
    neutral('judge_int_badobj_noload', 'Interaction — poor objective metrics + no seeded load', { interaction: 'bad_objective_no_load' }, { objective: badObjective, initialHistory: [] }),
    neutral('judge_int_badobj_hard_yday', 'Interaction — poor objective metrics + hard yesterday', { interaction: 'bad_objective_hard_yesterday' }, { objective: badObjective, initialHistory: [exposureOn(hardExposure, addDays(base.startDate, -1), 'badobj-hard-yesterday')] }),
    neutral('judge_int_badsubj_goodobj', 'Interaction — poor subjective + good objective', { interaction: 'bad_subjective_good_objective' }, { subjective: badSubjective, objective: goodObjective }),
    neutral('judge_int_goodsubj_badobj', 'Interaction — good subjective + poor objective', { interaction: 'good_subjective_bad_objective' }, { subjective: goodSubjective, objective: badObjective }),
    neutral('judge_int_race7_fresh', 'Interaction — race in 7 days + fresh', { interaction: 'race7_fresh' }, { eventDaysOut: 7, subjective: goodSubjective, objective: goodObjective }),
    neutral('judge_int_race7_hard_yday', 'Interaction — race in 7 days + hard yesterday', { interaction: 'race7_hard_yesterday' }, { eventDaysOut: 7, initialHistory: [exposureOn(hardExposure, addDays(base.startDate, -1), 'race7-hard-yesterday')] }),
    neutral('judge_int_race7_badobj', 'Interaction — race in 7 days + poor objective recovery', { interaction: 'race7_bad_objective' }, { eventDaysOut: 7, objective: badObjective }),
  ];

  const deliveredDoseVariance = [
    neutral('judge_dose_exact', 'Delivered dose — exact 3x17m @ 95%', { deliveredDose: 'exact_3x17' }, { initialHistory: [deliveredDoseModule.makeThreshold3x17Exposure(addDays(base.startDate, -1), 'exact')] }),
    neutral('judge_dose_surged', 'Delivered dose — surged 3x17m @ 105%', { deliveredDose: 'surged_3x17' }, { initialHistory: [deliveredDoseModule.makeThreshold3x17Exposure(addDays(base.startDate, -1), 'surged')] }),
    neutral('judge_dose_curtailed', 'Delivered dose — curtailed 2 of 3 reps', { deliveredDose: 'curtailed_3x17' }, { initialHistory: [deliveredDoseModule.makeThreshold3x17Exposure(addDays(base.startDate, -1), 'curtailed')] }),
    neutral('judge_dose_skipped', 'Delivered dose — skipped workout', { deliveredDose: 'skipped_rest' }, { initialHistory: [] }),
  ];

  const makeStrengthExposure = (date, templateId, category, costProfile) => ({
    occurrenceKey: `strength:${templateId}:${date}`,
    date,
    templateId,
    category,
    modality: 'Strength',
    costProfile,
    stimulusProfile: { aerobicEndurance: 0, thresholdPower: 0, vo2MaxPower: 0, repeatedSurges: 0, sprintPower: 0, fatigueResistance: 0, maxStrength: 0.8, hypertrophy: 0.7 },
    stimulusConfidence: 'exact',
  });

  const concurrentStrength = [
    neutral('judge_concurrent_none', 'Concurrent — endurance build baseline', { concurrentStrength: 'none' }, { initialHistory: [] }),
    neutral('judge_concurrent_heavy_lower', 'Concurrent — heavy lower-body yesterday', { concurrentStrength: 'heavy_lower_yesterday' }, { initialHistory: [makeStrengthExposure(addDays(base.startDate, -1), 'str_heavy_lower', 'Lower-body Strength', { systemic: 0.7, cardiovascular: 0.3, lowerBody: 0.85, upperBody: 0.1, impactTissue: 0.3, neuromuscular: 0.75 })] }),
    neutral('judge_concurrent_heavy_upper', 'Concurrent — heavy upper-body yesterday', { concurrentStrength: 'heavy_upper_yesterday' }, { initialHistory: [makeStrengthExposure(addDays(base.startDate, -1), 'str_heavy_upper', 'Upper-body Strength', { systemic: 0.5, cardiovascular: 0.2, lowerBody: 0.05, upperBody: 0.85, impactTissue: 0.1, neuromuscular: 0.6 })] }),
    neutral('judge_concurrent_power_maintenance', 'Concurrent — power maintenance strength yesterday', { concurrentStrength: 'power_maintenance_yesterday' }, { initialHistory: [makeStrengthExposure(addDays(base.startDate, -1), 'str_power_maintenance', 'Power Maintenance', { systemic: 0.4, cardiovascular: 0.2, lowerBody: 0.35, upperBody: 0.2, impactTissue: 0.1, neuromuscular: 0.4 })] }),
  ];

  const injuryConstraints = [
    neutral('judge_injury_none', 'Injury — healthy baseline', { injuryConstraint: 'none' }),
    neutral('judge_injury_running_restricted', 'Injury — restricted running modality', { injuryConstraint: 'restricted_running' }, {
      contextPatch: (c) => {
        c.constraints.restrictedModalities = ['Running'];
        if (c.guardrails) c.guardrails.avoid_high_impact = true;
        if (c.trainingSettings?.defaults?.guardrails) c.trainingSettings.defaults.guardrails.avoid_high_impact = true;
        c.constraints.injuries = [{ id: 'inj-run', region: 'knee', severity: 'exclude', reviewBy: addDays(base.startDate, 14) }];
      },
    }),
    neutral('judge_injury_lower_body_restricted', 'Injury — avoid heavy lower body', { injuryConstraint: 'avoid_heavy_lower_body' }, {
      contextPatch: (c) => {
        if (c.guardrails) c.guardrails.avoid_heavy_lower_body = true;
        if (c.trainingSettings?.defaults?.guardrails) c.trainingSettings.defaults.guardrails.avoid_heavy_lower_body = true;
        c.constraints.injuries = [{ id: 'inj-lower', region: 'hamstring', severity: 'exclude', reviewBy: addDays(base.startDate, 14) }];
      },
    }),
    neutral('judge_injury_expired', 'Injury — review date passed', { injuryConstraint: 'expired_review' }, {
      contextPatch: (c) => {
        c.constraints.injuries = [{ id: 'inj-exp', region: 'hamstring', severity: 'exclude', reviewBy: addDays(base.startDate, -2) }];
      },
    }),
  ];

  const planningModesOverlays = [
    neutral('judge_mode_event_directed', 'Planning mode — event directed A-race', { planningMode: 'event_directed' }),
    scenarioVariant(base, 'judge_mode_evergreen', 'Planning mode — evergreen fitness maintenance', { planningMode: 'evergreen' }, { event: null, events: [], trainingIntentProfile: { userId: 'judge-user', mode: 'evergreen', horizonWeeks: 4, weeklyTargetSessions: 3, primaryFocus: 'general_fitness', adaptationTargets: ['aerobic_endurance', 'strength'] } }),
    neutral('judge_mode_travel_overlay', 'Planning mode — 3-day travel overlay', { planningMode: 'travel_overlay' }, { authoredPlanBlocks: [{ id: 'travel-block-1', phase: 'travel', startDate: base.startDate, endDate: addDays(base.startDate, 2), volumeScale: 0.5, intensityScale: 0.7 }], contextPatch: (c) => { c.constraints.availableEquipment = ['bodyweight']; c.environment = 'indoor'; } }),
    neutral('judge_mode_conservative_preference', 'Planning mode — high conservative bias', { planningMode: 'conservative_overlay' }, { contextPatch: (c) => { c.preferences.conservativeBias = true; if (c.trainingSettings) c.trainingSettings.defaults.conservativeBias = true; } }),
  ];

  return [
    { familyId: 'objective_recovery', changedAxis: 'objective recovery metrics', cases: objectiveRecovery },
    { familyId: 'subjective_recovery', changedAxis: 'subjective recovery metrics', cases: subjectiveRecovery },
    { familyId: 'recent_training', changedAxis: 'recent completed training load / recency', cases: recentTraining },
    { familyId: 'event_proximity', changedAxis: 'days to A-priority criterium', cases: eventProximity },
    { familyId: 'preferences_capacity', changedAxis: 'recovery preference / conservatism / time capacity', cases: capacityPreferences },
    { familyId: 'event_demand', changedAxis: 'event demand and priority', cases: eventDemand },
    { familyId: 'interactions', changedAxis: 'selected multi-signal interactions', cases: interactions },
    { familyId: 'delivered_dose_variance', changedAxis: 'delivered-dose adherence and variance (3x17m threshold)', cases: deliveredDoseVariance },
    { familyId: 'concurrent_strength_endurance', changedAxis: 'concurrent strength-endurance interference', cases: concurrentStrength },
    { familyId: 'injury_constraints', changedAxis: 'structured injury guardrails and modality restrictions', cases: injuryConstraints },
    { familyId: 'planning_modes_overlays', changedAxis: 'macro planning modes and travel overlays', cases: planningModesOverlays },
  ];
}

function serializableScenario(caseDefinition) {
  const scenario = caseDefinition.scenario;
  const readiness = scenario.readinessForDate?.(scenario.startDate, 0) ?? scenario.readinessForWeek(0);
  return {
    caseId: scenario.id,
    label: scenario.label,
    changedAxis: caseDefinition.axis,
    startDate: scenario.startDate,
    weeks: scenario.weeks,
    readiness,
    event: scenario.event ?? null,
    events: scenario.events ?? null,
    preferences: scenario.preferences ?? scenario.context.preferences,
    context: scenario.context,
    initialHistory: scenario.initialHistory ?? [],
    fixedActivities: scenario.fixedActivities ?? [],
    authoredPlanBlocks: scenario.authoredPlanBlocks ?? null,
    trainingIntentProfile: scenario.trainingIntentProfile ?? null,
  };
}

function planFromResult(result, templatesById) {
  return result.decisionTraces.map((trace) => {
    const template = templatesById.get(trace.selected.templateId);
    return {
      date: trace.date,
      mode: trace.mode,
      readinessTier: trace.readinessTier,
      session: {
        templateId: trace.selected.templateId,
        title: template?.title ?? trace.selected.templateId,
        category: trace.selected.category,
        modality: trace.selected.modality,
        durationMin: template?.durationMin ?? null,
        durationMax: template?.durationMax ?? null,
        systemicCost: trace.selected.projectedCost.systemic,
        costProfile: trace.selected.projectedCost,
        stimulusProfile: template?.stimulusProfile ?? null,
      },
      projectedFatigue: trace.fatigue,
      activeObjectives: trace.activeObjectives,
      contributorObjectiveChanges: trace.contributorObjectiveChanges,
      fixedActivity: trace.fixedActivity,
      rejectionCounts: trace.rejectionCounts,
      utility: trace.utility,
    };
  });
}

const server = await createServer({
  configFile: false,
  root: resolve('.'),
  logLevel: 'warn',
  server: { middlewareMode: true },
  appType: 'custom',
});

let families;
let templates;
let runScenario;
try {
  const scenariosModule = await server.ssrLoadModule('/src/engine/simulation/scenarios.ts');
  const analyzeModule = await server.ssrLoadModule('/src/engine/simulation/analyze.ts');
  const templatesModule = await server.ssrLoadModule('/src/engine/templates.ts');
  const deliveredDoseModule = await server.ssrLoadModule('/src/engine/simulation/deliveredDoseScenarios.ts');
  const eventPresetsModule = await server.ssrLoadModule('/src/engine/eventPresets.ts');
  families = makeFamilies(scenariosModule.SCENARIOS, deliveredDoseModule, eventPresetsModule.resolveDemandProfile);
  templates = templatesModule.ENRICHED_TEMPLATES;
  runScenario = analyzeModule.runScenario;

  const templatesById = new Map(templates.map((template) => [template.id, template]));
  const familyPackets = [];
  for (const family of families) {
    const cases = [];
    for (const caseDefinition of family.cases) {
      const result = await runScenario(caseDefinition.scenario);
      cases.push({
        input: serializableScenario(caseDefinition),
        plan: planFromResult(result, templatesById),
        engineSummary: {
          categoryDistribution: result.categoryDistribution,
          modalityDistribution: result.modalityDistribution,
          restOrRecoveryDayCount: result.restOrRecoveryDayCount,
          fatigueTierDayCounts: result.fatigueTierDayCounts,
          objectiveResolution: result.objectiveResolution,
          constraintViolations: result.constraintViolations,
          qualityWarnings: result.qualityWarnings,
        },
      });
    }
    familyPackets.push({
      familyId: family.familyId,
      changedAxis: family.changedAxis,
      comparisonInstruction: 'Compare cases within this family. Judge both absolute plan quality and whether the algorithm reacts appropriately to the changed input axis.',
      cases,
    });
  }

  const outputDir = resolve('artifacts/ai-plan-judge/latest');
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });
  const corpus = {
    schema: 'adaptive-training-recommender/ai-plan-judge-corpus@1',
    commit: gitCommit(),
    capturedAt: new Date().toISOString(),
    familyCount: familyPackets.length,
    caseCount: familyPackets.reduce((sum, family) => sum + family.cases.length, 0),
    families: familyPackets,
  };
  writeFileSync(resolve(outputDir, 'corpus.json'), `${JSON.stringify(corpus, null, 2)}\n`);
  writeFileSync(resolve(outputDir, 'families.jsonl'), `${familyPackets.map((family) => JSON.stringify(family)).join('\n')}\n`);

  const prompt = `# AI plan judge instructions\n\nYou are an independent endurance-training plan evaluator. You are judging plans produced by an algorithm; do not assume the algorithm's rationale, fatigue tier, rejection codes, or utility scores are correct merely because they are present. Treat them as diagnostics, not ground truth.\n\nEach JSONL row is one sensitivity family. Cases in a family are deliberately very similar and differ mainly in the named axis. Evaluate the whole multi-day sequence, not only day 1.\n\nFor each case score 0-10 on:\n- safety_recovery_fit: load and recovery sequencing fits the supplied objective + subjective state and recent training.\n- goal_event_fit: sessions address the event demands / objectives without irrelevant work.\n- sequencing: hard/easy/recovery ordering, interaction of adjacent sessions, and accumulation of fatigue are coherent.\n- periodization_taper: training emphasis and volume/intensity are appropriate for event proximity and priority.\n- preference_capacity_fit: plan respects time, modality, conservatism and recovery-style preferences without allowing preferences to override safety.\n- robustness: plan is sensible without depending on one fragile score or arbitrary threshold.\n- overall: holistic quality; do not compute it mechanically from the other scores.\n\nAlso score family sensitivity_quality 0-10: did changing the named axis cause an appropriately sized and directionally sensible plan change? Penalize both overreaction and underreaction. More recovery is NOT automatically better, and more training is NOT automatically better.\n\nReturn exactly one JSON object per input family, one line per family, matching judge-response-schema.json. Give concise evidence-based rationales. When proposing algorithm changes, describe the behavioral principle first; avoid tuning a numeric threshold from a single case unless the family provides clear repeated evidence.\n`;
  writeFileSync(resolve(outputDir, 'judge-prompt.md'), prompt);

  const responseSchema = {
    schema: 'adaptive-training-recommender/ai-plan-judge-response@1',
    familyId: 'string',
    caseScores: [{
      caseId: 'string',
      scores: {
        safety_recovery_fit: 'number 0..10',
        goal_event_fit: 'number 0..10',
        sequencing: 'number 0..10',
        periodization_taper: 'number 0..10',
        preference_capacity_fit: 'number 0..10',
        robustness: 'number 0..10',
        overall: 'number 0..10',
      },
      confidence: 'number 0..1',
      flags: ['string'],
      rationale: 'string',
      suggestedChanges: ['string'],
    }],
    familyAssessment: {
      sensitivity_quality: 'number 0..10',
      overreactionCases: ['caseId'],
      underreactionCases: ['caseId'],
      goodSensitivityCases: ['caseId'],
      rationale: 'string',
      algorithmAdjustmentHypotheses: ['string'],
    },
  };
  writeFileSync(resolve(outputDir, 'judge-response-schema.json'), `${JSON.stringify(responseSchema, null, 2)}\n`);
  console.log(`Generated ${corpus.caseCount} cases across ${corpus.familyCount} AI-judge families in ${outputDir}`);
} finally {
  await server.close();
}
