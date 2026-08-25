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

function userPreferences(overrides = {}) {
  return {
    userId: 'judge-user',
    preferredRecoveryStyle: 'passive',
    defaultWeekdayTimeMin: 60,
    defaultWeekendTimeMin: 120,
    preferredTimeOfDay: 'flexible',
    preferredModalities: [],
    deprioritizedModalities: [],
    avoidedModalities: [],
    unavailableModalities: [],
    explanationVerbosity: 'detailed',
    conservativeBias: false,
    preferredUnits: { distance: 'km', weight: 'kg', temperature: 'celsius' },
    schemaVersion: 1,
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

function evergreenIntent() {
  return {
    userId: 'judge-user',
    planningMode: 'evergreen',
    priorities: ['balanced_performance'],
    weeklyCommitment: { minSessions: 2, targetSessions: 3, maxSessions: 4 },
    organizationPreference: 'auto',
    schemaVersion: 1,
    createdAt: '',
    updatedAt: '',
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

function exposureOn(exposure, date, occurrenceSuffix) {
  return {
    ...clone(exposure),
    occurrenceKey: `judge:${occurrenceSuffix}:${date}`,
    date,
  };
}

function makeStrengthExposure(date, templateId, category, costProfile) {
  return {
    occurrenceKey: `strength:${templateId}:${date}`,
    date,
    templateId,
    category,
    modality: 'Strength',
    costProfile,
    stimulusProfile: {
      aerobicEndurance: 0,
      thresholdPower: 0,
      vo2MaxPower: 0,
      repeatedSurges: 0,
      sprintPower: 0,
      fatigueResistance: 0,
      maxStrength: 0.8,
      hypertrophy: 0.7,
    },
    stimulusConfidence: 'exact',
    trainingRecordLike: {
      type: `Strength ${category}`,
      duration_min: 45,
      training_effect: 0,
      intensity_tag: '',
    },
  };
}

function normalizeWarning(value) {
  if (typeof value !== 'string') return value;
  const match = value.match(/^Event-specific exposure occurred off the nominated anchor date in (\d+) week\(s\)\.$/);
  return match
    ? `Event-specific exposure occurred off the nominated anchor date in ${match[1]} week(s) (adaptively fulfilled in-window).`
    : value;
}

function variant(base, id, label, axis, options = {}) {
  const readiness = patchReadiness(base, options.subjective, options.objective);
  const context = clone(base.context);
  if (options.contextPatch) options.contextPatch(context);
  const event = clone(options.event !== undefined ? options.event : (base.event ?? null));
  const events = options.events !== undefined ? clone(options.events) : clone(base.events);
  if (options.eventDaysOut !== undefined && event) event.date = addDays(base.startDate, options.eventDaysOut);

  const readinessForDate = options.readinessForDate ?? (() => clone(readiness));
  const readinessForWeek = options.readinessForWeek ?? (() => clone(readiness));

  return {
    axis,
    scenario: {
      ...base,
      id,
      label,
      description: `AI-judge sensitivity case. Changed axis: ${JSON.stringify(axis)}.`,
      context,
      event,
      ...(events !== undefined ? { events } : {}),
      ...(options.preferences !== undefined ? { preferences: clone(options.preferences) } : {}),
      ...(options.trainingIntentProfile !== undefined ? { trainingIntentProfile: clone(options.trainingIntentProfile) } : {}),
      ...(options.authoredPlanBlocks !== undefined ? { authoredPlanBlocks: clone(options.authoredPlanBlocks) } : {}),
      ...(options.initialHistory !== undefined ? { initialHistory: clone(options.initialHistory) } : {}),
      ...(options.fixedActivities !== undefined ? { fixedActivities: clone(options.fixedActivities) } : {}),
      startDate: base.startDate,
      weeks: options.weeks ?? 2,
      readinessForWeek,
      readinessForDate,
      tags: ['ai-plan-judge', ...(base.tags ?? []), ...(options.tags ?? [])],
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
    caseId: scenario.id,
    label: scenario.label,
    changedAxis: definition.axis,
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
  input.changedAxis = { ...definition.axis, judgeContext: judgeContext(input) };
  return input;
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
        durationMin: trace.selected.durationMin ?? template?.durationMin ?? null,
        durationMax: trace.selected.durationMax ?? template?.durationMax ?? null,
        environment: template?.environment ?? 'either',
        requiredEquipment: template?.requiredEquipment ?? [],
        safetyTags: template?.safetyTags ?? [],
        systemicCost: trace.selected.projectedCost.systemic,
        costProfile: trace.selected.projectedCost,
        stimulusProfile: trace.selected.stimulusProfile ?? template?.stimulusProfile ?? null,
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

function packetFromResult(definition, result, templatesById) {
  return {
    input: serializeInput(definition),
    plan: planFromResult(result, templatesById),
    engineSummary: {
      categoryDistribution: result.categoryDistribution,
      modalityDistribution: result.modalityDistribution,
      restOrRecoveryDayCount: result.restOrRecoveryDayCount,
      fatigueTierDayCounts: result.fatigueTierDayCounts,
      objectiveResolution: result.objectiveResolution,
      constraintViolations: result.constraintViolations,
      qualityWarnings: (result.qualityWarnings ?? []).map(normalizeWarning),
      anchorWeeks: result.anchorWeeks,
    },
  };
}

export function makeAllFamilies(scenarios, deliveredDoseModule, resolveDemandProfile) {
  const base = requireScenario(scenarios, 'cycling_criterium_A');
  const granFondo = requireScenario(scenarios, 'cycling_gran_fondo_A');
  const hardLoadSource = requireScenario(scenarios, 'external_load_green_readiness');
  const completionSource = requireScenario(scenarios, 'inferred_partial_completion');
  const hardExposure = hardLoadSource.initialHistory?.[0];
  const easyExposure = completionSource.initialHistory?.find((item) => item.category === 'Easy Endurance');
  if (!hardExposure || !easyExposure) throw new Error('Judge corpus requires hard and easy history fixtures.');

  const neutral = (id, label, axis = { state: 'neutral' }, options = {}) =>
    variant(base, id, label, axis, options);

  // 1. Objective recovery
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

  // 2. Subjective recovery
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

  // 3. Recent training
  const recentTraining = [
    neutral('judge_load_none', 'Recent training — no seeded load', { recentTraining: 'none' }, { initialHistory: [] }),
    neutral('judge_load_easy_yesterday', 'Recent training — easy Z2 yesterday', { recentTraining: 'easy_yesterday' }, { initialHistory: [exposureOn(easyExposure, addDays(base.startDate, -1), 'easy-yesterday')] }),
    neutral('judge_load_hard_yesterday', 'Recent training — hard cycling yesterday', { recentTraining: 'hard_yesterday' }, { initialHistory: [exposureOn(hardExposure, addDays(base.startDate, -1), 'hard-yesterday')] }),
    neutral('judge_load_hard_2d', 'Recent training — hard cycling two days ago', { recentTraining: 'hard_2d' }, { initialHistory: [exposureOn(hardExposure, addDays(base.startDate, -2), 'hard-2d')] }),
    neutral('judge_load_hard_3d', 'Recent training — hard cycling three days ago', { recentTraining: 'hard_3d' }, { initialHistory: [exposureOn(hardExposure, addDays(base.startDate, -3), 'hard-3d')] }),
  ];

  // 4. Event proximity
  const eventProximity = [40, 20, 14, 7, 3].map((daysOut) => {
    const event = clone(base.event);
    event.date = addDays(base.startDate, daysOut);
    return variant(base, `judge_event_${daysOut}d`, `Event proximity — ${daysOut} days`, { eventDaysOut: daysOut }, {
      event,
      fixedActivities: [eventFixedActivity(event)].filter(Boolean),
    });
  });

  // 5. Preferences and capacity
  const capacityPreferences = [
    neutral('judge_pref_neutral', 'Preferences/capacity — passive recovery baseline', { preference: 'passive_recovery' }, { preferences: userPreferences({ preferredRecoveryStyle: 'passive' }) }),
    neutral('judge_pref_conservative', 'Preferences/capacity — conservative bias', { preference: 'conservative_bias' }, { preferences: userPreferences({ conservativeBias: true }), contextPatch: (c) => { c.preferences.conservativeBias = true; } }),
    neutral('judge_pref_active_recovery', 'Preferences/capacity — active recovery style', { preference: 'active_recovery' }, { preferences: userPreferences({ preferredRecoveryStyle: 'active' }), contextPatch: (c) => { c.preferences.preferredRecoveryStyle = 'active'; } }),
    neutral('judge_pref_mixed_recovery', 'Preferences/capacity — mixed recovery style', { preference: 'mixed_recovery' }, { preferences: userPreferences({ preferredRecoveryStyle: 'mixed' }), contextPatch: (c) => { c.preferences.preferredRecoveryStyle = 'mixed'; } }),
    neutral('judge_pref_45min', 'Preferences/capacity — 45 minute weekdays', { capacity: '45_min_weekday' }, { preferences: userPreferences({ defaultWeekdayTimeMin: 45 }), contextPatch: (c) => { c.constraints.maxTimeMinutes = 45; if (c.trainingSettings) c.trainingSettings.defaults.weekdayMaxMinutes = 45; } }),
    neutral('judge_pref_90min', 'Preferences/capacity — 90 minute weekdays', { capacity: '90_min_weekday' }, { preferences: userPreferences({ defaultWeekdayTimeMin: 90 }), contextPatch: (c) => { c.constraints.maxTimeMinutes = 90; if (c.trainingSettings) c.trainingSettings.defaults.weekdayMaxMinutes = 90; } }),
  ];

  // 6. Event demand
  const critEventA = { ...clone(base.event), priority: 'A', eventPreset: 'criterium', demandProfile: resolveDemandProfile('cycling_event', 'criterium') };
  const critEventB = { ...clone(base.event), priority: 'B', eventPreset: 'criterium', demandProfile: resolveDemandProfile('cycling_event', 'criterium') };
  const granEventA = { ...clone(granFondo.event), priority: 'A', eventPreset: 'gran_fondo', demandProfile: resolveDemandProfile('cycling_event', 'gran_fondo') };
  const granEventB = { ...clone(granFondo.event), priority: 'B', eventPreset: 'gran_fondo', demandProfile: resolveDemandProfile('cycling_event', 'gran_fondo') };

  const eventDemand = [
    variant(base, 'judge_demand_crit_A', 'Event demand — criterium A', { eventDemand: 'criterium', priority: 'A' }, { event: critEventA }),
    variant(base, 'judge_demand_crit_B', 'Event demand — criterium B', { eventDemand: 'criterium', priority: 'B' }, { event: critEventB }),
    variant(base, 'judge_demand_gran_A', 'Event demand — gran fondo A', { eventDemand: 'gran_fondo', priority: 'A' }, { event: granEventA }),
    variant(base, 'judge_demand_gran_B', 'Event demand — gran fondo B', { eventDemand: 'gran_fondo', priority: 'B' }, { event: granEventB }),
  ];

  // 7. Interactions
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

  // 8. Delivered dose variance
  const deliveredDoseVariance = [
    neutral('judge_dose_exact', 'Delivered dose — exact 3x17m @ 95%', { deliveredDose: 'exact_3x17' }, { initialHistory: [deliveredDoseModule.makeThreshold3x17Exposure(addDays(base.startDate, -1), 'exact')] }),
    neutral('judge_dose_surged', 'Delivered dose — surged 3x17m @ 105%', { deliveredDose: 'surged_3x17' }, { initialHistory: [deliveredDoseModule.makeThreshold3x17Exposure(addDays(base.startDate, -1), 'surged')] }),
    neutral('judge_dose_curtailed', 'Delivered dose — curtailed 2 of 3 reps', { deliveredDose: 'curtailed_3x17' }, { initialHistory: [deliveredDoseModule.makeThreshold3x17Exposure(addDays(base.startDate, -1), 'curtailed')] }),
    neutral('judge_dose_skipped', 'Delivered dose — skipped workout', { deliveredDose: 'skipped_rest' }, { initialHistory: [] }),
  ];

  // 9. Concurrent strength-endurance
  const concurrentStrength = [
    neutral('judge_concurrent_none', 'Concurrent — endurance build baseline', { concurrentStrength: 'none' }, { initialHistory: [] }),
    neutral('judge_concurrent_heavy_lower', 'Concurrent — heavy lower-body yesterday', { concurrentStrength: 'heavy_lower_yesterday' }, { initialHistory: [makeStrengthExposure(addDays(base.startDate, -1), 'str_heavy_lower', 'Lower-body Strength', { systemic: 0.7, cardiovascular: 0.3, lowerBody: 0.85, upperBody: 0.1, impactTissue: 0.3, neuromuscular: 0.75 })] }),
    neutral('judge_concurrent_heavy_upper', 'Concurrent — heavy upper-body yesterday', { concurrentStrength: 'heavy_upper_yesterday' }, { initialHistory: [makeStrengthExposure(addDays(base.startDate, -1), 'str_heavy_upper', 'Upper-body Strength', { systemic: 0.5, cardiovascular: 0.2, lowerBody: 0.05, upperBody: 0.85, impactTissue: 0.1, neuromuscular: 0.6 })] }),
    neutral('judge_concurrent_power_maintenance', 'Concurrent — power maintenance strength yesterday', { concurrentStrength: 'power_maintenance_yesterday' }, { initialHistory: [makeStrengthExposure(addDays(base.startDate, -1), 'str_power_maintenance', 'Power Maintenance', { systemic: 0.4, cardiovascular: 0.2, lowerBody: 0.35, upperBody: 0.2, impactTissue: 0.1, neuromuscular: 0.4 })] }),
  ];

  // 10. Injury constraints
  const injuryConstraints = [
    neutral('judge_injury_none', 'Injury — healthy baseline', { injuryConstraint: 'none' }),
    neutral('judge_injury_running_restricted', 'Injury — restricted running modality', { injuryConstraint: 'restricted_running' }, {
      contextPatch: (c) => {
        c.constraints.restrictedModalities = ['Running'];
        c.constraints.impliedGuardrails = [...new Set([...(c.constraints.impliedGuardrails ?? []), 'avoid_high_impact'])];
        if (c.trainingSettings) c.trainingSettings.guardrails.avoid_high_impact = true;
      },
    }),
    neutral('judge_injury_lower_body_restricted', 'Injury — avoid heavy lower body', { injuryConstraint: 'avoid_heavy_lower_body' }, {
      contextPatch: (c) => {
        c.constraints.impliedGuardrails = [...new Set([...(c.constraints.impliedGuardrails ?? []), 'avoid_heavy_lower_body'])];
        if (c.trainingSettings) c.trainingSettings.guardrails.avoid_heavy_lower_body = true;
      },
    }),
    neutral('judge_injury_expired', 'Injury — expired review, no active engine restriction', { injuryConstraint: 'expired_review_inactive' }),
  ];

  // 11. Planning modes and overlays
  const planningModesOverlays = [
    neutral('judge_mode_event_directed', 'Planning mode — event directed A-race', { planningMode: 'event_directed' }),
    variant(base, 'judge_mode_evergreen', 'Planning mode — evergreen fitness maintenance', { planningMode: 'evergreen' }, {
      event: null,
      events: [],
      trainingIntentProfile: evergreenIntent(),
      preferences: userPreferences({ preferredRecoveryStyle: 'mixed' }),
    }),
    neutral('judge_mode_travel_overlay', 'Planning mode — 3-day travel constraints + authored overlay', { planningMode: 'travel_overlay' }, {
      authoredPlanBlocks: [{
        id: 'travel-block-1',
        userId: 'judge-user',
        phase: 'travel',
        startDate: base.startDate,
        endDate: addDays(base.startDate, 2),
        volumeScale: 0.5,
        intensityScale: 0.7,
        createdAt: '',
        updatedAt: '',
      }],
      contextPatch: (c) => {
        c.constraints.maxTimeMinutes = 30;
        c.constraints.hasFreeWeights = false;
        c.constraints.hasCableMachine = false;
        c.constraints.hasTreadmill = false;
        c.constraints.hasIndoorBike = false;
        if (c.trainingSettings) {
          for (const key of Object.keys(c.trainingSettings.equipment)) c.trainingSettings.equipment[key] = false;
          c.trainingSettings.defaults.weekdayMaxMinutes = 30;
          c.trainingSettings.defaults.weekendMaxMinutes = 30;
          c.trainingSettings.defaults.environment = 'indoor';
        }
      },
    }),
    neutral('judge_mode_conservative_preference', 'Planning mode — high conservative bias', { planningMode: 'conservative_overlay' }, {
      preferences: userPreferences({ conservativeBias: true }),
      contextPatch: (c) => { c.preferences.conservativeBias = true; },
    }),
  ];

  // 12. Dynamic temporal trajectories: Acute vs Persistent
  const neutralReadiness = patchReadiness(base);
  const acuteAdverseDay1 = patchReadiness(base, { readiness: 3, fatigue: 8 }, badObjective);
  const persistentAdverse3d = patchReadiness(base, { readiness: 3, fatigue: 8, soreness: 7 }, badObjective);

  const temporalAcuteVsPersistent = [
    neutral('judge_traj_neutral', 'Temporal trajectory — neutral baseline', { temporalTrajectory: 'neutral_14d' }),
    variant(base, 'judge_traj_acute_adverse_day1', 'Temporal trajectory — acute 1-day adverse recovery', { temporalTrajectory: 'acute_day1_adverse' }, {
      readinessForDate: (_date, dayIndex) => {
        if (dayIndex === 0) return clone(acuteAdverseDay1);
        return clone(neutralReadiness);
      },
    }),
    variant(base, 'judge_traj_persistent_adverse_3d', 'Temporal trajectory — persistent 3-day adverse recovery', { temporalTrajectory: 'persistent_3d_adverse' }, {
      readinessForDate: (_date, dayIndex) => {
        if (dayIndex >= 0 && dayIndex <= 2) return clone(persistentAdverse3d);
        return clone(neutralReadiness);
      },
    }),
    variant(base, 'judge_traj_improving_trend', 'Temporal trajectory — improving recovery trend (Day 1 borderline to Day 3 fresh)', { temporalTrajectory: 'improving_trend' }, {
      readinessForDate: (_date, dayIndex) => {
        if (dayIndex === 0) return patchReadiness(base, { readiness: 5, fatigue: 6 }, { hrv_delta: -5, rhr_delta: 2 });
        if (dayIndex === 1) return clone(neutralReadiness);
        return patchReadiness(base, goodSubjective, goodObjective);
      },
    }),
  ];

  // 13. Conflicting local tissue vs systemic wearable signals
  const conflictingTissueVsWearable = [
    neutral('judge_conflict_neutral', 'Conflicting signals — neutral baseline', { conflictingSignals: 'neutral' }),
    neutral('judge_conflict_sore_legs_great_hrv', 'Conflicting signals — sore legs (soreness=8) but excellent wearable metrics', { conflictingSignals: 'sore_legs_great_wearables' }, {
      subjective: { soreness: 8, fatigue: 5, readiness: 6 },
      objective: goodObjective,
      initialHistory: [makeStrengthExposure(addDays(base.startDate, -1), 'str_heavy_lower', 'Lower-body Strength', { systemic: 0.5, cardiovascular: 0.2, lowerBody: 0.85, upperBody: 0.1, impactTissue: 0.3, neuromuscular: 0.75 })],
    }),
    neutral('judge_conflict_fresh_legs_terrible_hrv', 'Conflicting signals — fresh legs (soreness=1) but severe systemic wearable collapse', { conflictingSignals: 'fresh_legs_terrible_wearables' }, {
      subjective: { soreness: 1, fatigue: 4, readiness: 7 },
      objective: badObjective,
    }),
    neutral('judge_conflict_high_stress_fresh_body', 'Conflicting signals — high life stress (stress=9, motivation=2) with normal physical recovery', { conflictingSignals: 'high_stress_fresh_body' }, {
      subjective: { stress: 9, motivation: 2, fatigue: 3, soreness: 1, readiness: 5 },
      objective: neutralReadiness.objective,
    }),
  ];

  return [
    { familyId: 'objective_recovery', changedAxis: 'objective recovery metrics', cases: objectiveRecovery },
    { familyId: 'subjective_recovery', changedAxis: 'subjective recovery metrics', cases: subjectiveRecovery },
    { familyId: 'recent_training', changedAxis: 'recent completed training load / recency', cases: recentTraining },
    { familyId: 'event_proximity', changedAxis: 'days to A-priority criterium with event-day commitment reserved', cases: eventProximity },
    { familyId: 'preferences_capacity', changedAxis: 'recovery preference / conservatism / time capacity', cases: capacityPreferences },
    { familyId: 'event_demand', changedAxis: 'event demand and priority', cases: eventDemand },
    { familyId: 'interactions', changedAxis: 'selected multi-signal interactions with scheduled event load reserved', cases: interactions },
    { familyId: 'delivered_dose_variance', changedAxis: 'delivered-dose adherence and variance (3x17m threshold)', cases: deliveredDoseVariance },
    { familyId: 'concurrent_strength_endurance', changedAxis: 'concurrent strength-endurance interference', cases: concurrentStrength },
    { familyId: 'injury_constraints', changedAxis: 'structured injury guardrails and modality restrictions', cases: injuryConstraints },
    { familyId: 'planning_modes_overlays', changedAxis: 'macro planning modes and travel constraints/overlays', cases: planningModesOverlays },
    { familyId: 'temporal_acute_vs_persistent', changedAxis: 'dynamic temporal recovery trajectories (acute 1-day vs persistent 3-day vs improving trend)', cases: temporalAcuteVsPersistent },
    { familyId: 'conflicting_tissue_vs_wearable', changedAxis: 'conflicting local tissue fatigue vs systemic wearable recovery signals', cases: conflictingTissueVsWearable },
  ];
}

export async function buildPlanJudgeCorpus(options = {}) {
  const outputDir = resolve(options.outputDir ?? 'artifacts/ai-plan-judge/latest');
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });

  const server = await createServer({
    configFile: false,
    root: resolve('.'),
    logLevel: 'warn',
    server: { middlewareMode: true },
    appType: 'custom',
  });

  try {
    const scenariosModule = await server.ssrLoadModule('/src/engine/simulation/scenarios.ts');
    const analyzeModule = await server.ssrLoadModule('/src/engine/simulation/analyze.ts');
    const templatesModule = await server.ssrLoadModule('/src/engine/templates.ts');
    const deliveredDoseModule = await server.ssrLoadModule('/src/engine/simulation/deliveredDoseScenarios.ts');
    const eventPresetsModule = await server.ssrLoadModule('/src/engine/eventPresets.ts');

    const families = makeAllFamilies(
      scenariosModule.SCENARIOS,
      deliveredDoseModule,
      eventPresetsModule.resolveDemandProfile
    );
    const templates = templatesModule.ENRICHED_TEMPLATES;
    const runScenario = analyzeModule.runScenario;
    const templatesById = new Map(templates.map((template) => [template.id, template]));

    const familyPackets = [];
    for (const family of families) {
      const cases = [];
      for (const caseDefinition of family.cases) {
        const result = await runScenario(caseDefinition.scenario);
        cases.push(packetFromResult(caseDefinition, result, templatesById));
      }
      familyPackets.push({
        familyId: family.familyId,
        changedAxis: family.changedAxis,
        comparisonInstruction: 'Compare cases within this family. An unchanged plan is acceptable when the changed axis is not decision-relevant; hard safety, capacity constraints, and scheduled commitments must always be obeyed.',
        cases,
      });
    }

    const corpus = {
      schema: 'adaptive-training-recommender/ai-plan-judge-corpus@3',
      commit: gitCommit(),
      capturedAt: new Date().toISOString(),
      familyCount: familyPackets.length,
      caseCount: familyPackets.reduce((sum, family) => sum + family.cases.length, 0),
      families: familyPackets,
      canonicalBuilder: 'build-plan-judge-corpus.mjs',
    };

    writeFileSync(resolve(outputDir, 'corpus.json'), `${JSON.stringify(corpus, null, 2)}\n`);
    writeFileSync(resolve(outputDir, 'families.jsonl'), `${familyPackets.map((family) => JSON.stringify(family)).join('\n')}\n`);

    const prompt = `# AI plan judge instructions\n\nYou are an independent endurance-training plan evaluator. Engine rationale, fatigue tiers, rejection codes and utility are diagnostics, not ground truth. Evaluate the whole multi-day sequence. Scheduled events represented in fixedActivities own their event date and contribute reserved load; do not ask the planner to schedule another workout on top of them.\n\nScore each case 0-10 on safety_recovery_fit, goal_event_fit, sequencing, periodization_taper, preference_capacity_fit, robustness and overall, plus family sensitivity_quality.\n\nCalibration rules:\n- Sensitivity does not require every perturbation to change the plan. Mild isolated variation (including ~1 SD HRV/RHR movement) can legitimately leave a good plan unchanged.\n- Low motivation alone is not a physiological safety signal.\n- Easy training yesterday does not make quality work today unsafe; judge actual delivered load and residual fatigue.\n- Judge taper by workload/volume reduction with appropriate intensity/specificity, not rest-day count alone.\n- Preferences are soft unless encoded as constraints; safety restrictions and time/equipment availability are hard. Never propose violating a hard capacity/equipment restriction as the fix.\n- Criterium/surge events should emphasize repeated surges/VO2/sprint qualities, while long gran-fondo demands emphasize sustained aerobic durability/fatigue resistance.\n- More recovery is not automatically better; more training is not automatically better.\n- Prefer repeated family patterns over one-off threshold tuning.\n\nReturn exactly one JSON object matching judge-response-schema.json. All flags, suggestedChanges and familyAssessment list fields must be JSON arrays of strings.\n`;
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
    return corpus;
  } finally {
    await server.close();
  }
}

// Auto-run when executed directly
if (process.argv[1]?.endsWith('build-plan-judge-corpus.mjs')) {
  await buildPlanJudgeCorpus();
}
