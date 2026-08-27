const OBJECTIVE_FIELDS = [
  'total_steps',
  'sleep_score',
  'sleep_duration_min',
  'rhr',
  'rhr_7d_avg',
  'rhr_delta',
  'hrv_weekly_avg',
  'hrv_last_night',
  'hrv_delta',
  'respiration',
  'body_battery_wake',
  'sleep_score_delta_7d',
  'rhr_delta_28d',
  'hrv_delta_28d',
  'sleep_score_delta_28d',
  'hrv_stdev_28d',
  'rhr_stdev_28d',
  'sleep_score_stdev_28d',
];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function objectiveUnavailable() {
  return {
    total_steps: null,
    sleep_score: null,
    sleep_duration_min: null,
    rhr: null,
    rhr_7d_avg: null,
    rhr_delta: null,
    hrv_weekly_avg: null,
    hrv_last_night: null,
    hrv_delta: null,
    respiration: null,
    body_battery_wake: null,
    last_3_days_hard_sessions_count: 0,
    yesterday_training: null,
    today_training: null,
    sleep_score_delta_7d: null,
    rhr_delta_28d: null,
    hrv_delta_28d: null,
    sleep_score_delta_28d: null,
    hrv_stdev_28d: null,
    rhr_stdev_28d: null,
    sleep_score_stdev_28d: null,
  };
}

function objectiveGarminNeutral() {
  return {
    total_steps: 7500,
    sleep_score: 80,
    sleep_duration_min: 440,
    rhr: 58,
    rhr_7d_avg: 58,
    rhr_delta: 0,
    hrv_weekly_avg: 42,
    hrv_last_night: 42,
    hrv_delta: 0,
    respiration: 14,
    body_battery_wake: 72,
    last_3_days_hard_sessions_count: 0,
    yesterday_training: null,
    today_training: null,
    sleep_score_delta_7d: 0,
    rhr_delta_28d: 0,
    hrv_delta_28d: 0,
    sleep_score_delta_28d: 0,
    hrv_stdev_28d: 7,
    rhr_stdev_28d: 3,
    sleep_score_stdev_28d: 8,
  };
}

function objectiveGarminAdverse() {
  return {
    ...objectiveGarminNeutral(),
    sleep_score: 52,
    sleep_duration_min: 315,
    rhr: 65,
    rhr_delta: 7,
    rhr_delta_28d: 7,
    hrv_last_night: 28,
    hrv_delta: -14,
    hrv_delta_28d: -14,
    body_battery_wake: 24,
    sleep_score_delta_7d: -24,
    sleep_score_delta_28d: -24,
  };
}

function subjective(overrides = {}) {
  return {
    readiness: 7,
    sleepQuality: 7,
    fatigue: 3,
    soreness: 3,
    stress: 4,
    motivation: 7,
    timeAvailable: 60,
    painFlag: false,
    alreadyTrainedToday: false,
    preferredModalityToday: null,
    ...overrides,
  };
}

function settings({ equipment = {}, guardrails = {}, weekdayMaxMinutes = 60, weekendMaxMinutes = 90 } = {}) {
  return {
    userId: 'persona-sim-user',
    schemaVersion: 2,
    equipment: {
      free_weights: true,
      cable_machine: false,
      treadmill: false,
      indoor_bike: false,
      pullup_bar: false,
      ...equipment,
    },
    guardrails: {
      avoid_high_impact: false,
      avoid_heavy_lower_body: false,
      avoid_overhead_pressing: false,
      avoid_heavy_spinal_loading: false,
      ...guardrails,
    },
    defaults: { weekdayMaxMinutes, weekendMaxMinutes, environment: 'either' },
    preferences: { preferActiveRecovery: false },
    migration: { legacyReviewed: true, migratedAt: null },
    createdAt: '',
    updatedAt: '',
  };
}

function context({ goals, preferredModalities, deprioritizedModalities = [], equipment = {}, guardrails = {}, maxTimeMinutes = 60 }) {
  const trainingSettings = settings({ equipment, guardrails, weekdayMaxMinutes: maxTimeMinutes, weekendMaxMinutes: Math.max(90, maxTimeMinutes) });
  const impliedGuardrails = Object.entries(guardrails).filter(([, enabled]) => enabled).map(([key]) => key);
  return {
    goals,
    constraints: {
      hasCableMachine: Boolean(trainingSettings.equipment.cable_machine),
      hasFreeWeights: Boolean(trainingSettings.equipment.free_weights),
      hasTreadmill: Boolean(trainingSettings.equipment.treadmill),
      hasIndoorBike: Boolean(trainingSettings.equipment.indoor_bike),
      restrictedModalities: [],
      impliedGuardrails,
      maxTimeMinutes,
    },
    preferences: {
      avoidedModalities: [],
      deprioritizedModalities,
      preferredModalities,
      conservativeBias: false,
      preferredRecoveryStyle: 'mixed',
    },
    trainingSettings,
  };
}

function intent(priorities, targetSessions, maxSessions = targetSessions + 1) {
  return {
    userId: 'persona-sim-user',
    planningMode: 'evergreen',
    priorities,
    weeklyCommitment: {
      minSessions: Math.max(2, targetSessions - 1),
      targetSessions,
      maxSessions,
    },
    organizationPreference: 'auto',
    schemaVersion: 1,
    createdAt: '',
    updatedAt: '',
  };
}

function preferences(preferredModalities = []) {
  return {
    userId: 'persona-sim-user',
    preferredRecoveryStyle: 'mixed',
    defaultWeekdayTimeMin: 60,
    defaultWeekendTimeMin: 90,
    preferredTimeOfDay: 'flexible',
    preferredModalities,
    deprioritizedModalities: [],
    avoidedModalities: [],
    unavailableModalities: [],
    explanationVerbosity: 'detailed',
    conservativeBias: false,
    preferredUnits: { distance: 'km', weight: 'kg', temperature: 'celsius' },
    schemaVersion: 1,
    createdAt: '',
    updatedAt: '',
  };
}

function makeScenario({ id, label, persona, readiness, context: userContext, trainingIntentProfile, userPreferences }) {
  return {
    persona,
    scenario: {
      id,
      label,
      description: `Synthetic persona evaluation case for ${persona.personaId}. No real person's name or identifying data is persisted.`,
      context: userContext,
      event: null,
      events: [],
      trainingIntentProfile,
      preferences: userPreferences,
      startDate: '2026-08-31',
      initialHistory: [],
      fixedActivities: [],
      tags: ['ai-plan-judge', 'persona-evaluation', persona.personaId],
      weeks: 2,
      readinessForWeek: () => clone(readiness),
      readinessForDate: () => clone(readiness),
    },
  };
}

const strengthContext = context({
  goals: {
    shortTerm: 'Increase bench press and deadlift strength while training consistently around a physically demanding job.',
    midTerm: 'Progress maximal strength without repeatedly aggravating shoulder or back symptoms.',
    longTerm: 'Stay strong and capable with sustainable training.',
  },
  preferredModalities: ['Strength'],
  deprioritizedModalities: ['Running', 'Cycling'],
  equipment: { free_weights: true, pullup_bar: true },
  maxTimeMinutes: 75,
});
const strengthIntent = intent(['strength_muscle'], 3, 4);
const strengthPreferences = preferences(['Strength']);
const strengthPersona = {
  personaId: 'strength_manual_work_no_wearable',
  dataAvailability: 'subjective_checkin_only',
  primaryGoal: 'maximal strength with bench/deadlift emphasis',
  currentTrainingIdentity: 'strength-oriented; not currently endurance-oriented',
  nonTrainingLoad: 'physically demanding occupation; check-in fatigue/soreness is decision-relevant load',
  injuryContext: 'intermittent shoulder/back symptoms; current symptoms, not historical labels alone, should tighten training',
  judgeExpectations: [
    'Do not require or hallucinate Garmin/HRV/body-battery data.',
    'Use subjective fatigue, soreness, pain and available time as legitimate recovery evidence.',
    'Preserve strength specificity when safe; cardio is not the primary performance goal.',
    'On an active shoulder/back flare, prefer compatible strength variants or recovery and respect active guardrails.',
  ],
};

const healthContext = context({
  goals: {
    shortTerm: 'Build a repeatable exercise habit that supports fat loss and cardiometabolic health.',
    midTerm: 'Improve aerobic fitness and strength while reducing excess body fat gradually.',
    longTerm: 'Maintain lifelong health-focused training without a competition peak.',
  },
  preferredModalities: ['Strength', 'Walking', 'Cycling'],
  equipment: { free_weights: true },
  maxTimeMinutes: 60,
});
const healthIntent = intent(['health'], 4, 5);
const healthPreferences = preferences(['Strength', 'Walking', 'Cycling']);
const healthPersona = {
  personaId: 'health_fat_loss_garmin',
  dataAvailability: 'garmin_plus_subjective_checkin',
  primaryGoal: 'sustainable fat loss and general health',
  currentTrainingIdentity: 'general fitness; no event target',
  bodyCompositionContext: 'higher body mass with a fat-loss goal; no BMI or weight is invented in the fixture',
  judgeExpectations: [
    'Prefer sustainable aerobic plus resistance exposure over event-style peaking.',
    'Do not reward unnecessary high-intensity work merely because wearable data are available.',
    'Adverse recovery data should reduce near-term training cost without turning the evergreen plan into chronic rest.',
    'Training recommendations may support fat loss, but should not invent aggressive diet targets from absent nutrition data.',
  ],
};

const formerEliteContext = context({
  goals: {
    shortTerm: 'Return to consistent running safely from intermittent current training.',
    midTerm: 'Rebuild endurance and strength using current response rather than historical fitness.',
    longTerm: 'Develop durable recreational endurance fitness without assuming former competitive capacity persists.',
  },
  preferredModalities: ['Running', 'Strength'],
  equipment: { free_weights: true },
  maxTimeMinutes: 75,
});
const formerEliteIntent = intent(['endurance', 'strength_muscle'], 4, 5);
const formerElitePreferences = preferences(['Running', 'Strength']);
const formerElitePersona = {
  personaId: 'former_elite_endurance_return',
  dataAvailability: 'garmin_plus_subjective_checkin',
  primaryGoal: 'rebuild sustainable endurance fitness',
  currentTrainingIdentity: 'currently intermittent runner',
  historicalBackground: 'former high-level biathlon/endurance athlete; historical level is context, not current readiness',
  judgeExpectations: [
    'Do not infer current elite training tolerance from historical achievement.',
    'Current recent history and recovery evidence should govern dose progression.',
    'A good wearable day is not evidence that large historical workloads are currently appropriate.',
    'Retain endurance specificity while using conservative progression when current training history is sparse.',
  ],
};

export function buildPersonaFamilies() {
  const noWearable = objectiveUnavailable();
  const neutralGarmin = objectiveGarminNeutral();
  const adverseGarmin = objectiveGarminAdverse();

  const strengthFlareContext = clone(strengthContext);
  strengthFlareContext.constraints.impliedGuardrails = ['avoid_overhead_pressing', 'avoid_heavy_spinal_loading'];
  strengthFlareContext.trainingSettings.guardrails.avoid_overhead_pressing = true;
  strengthFlareContext.trainingSettings.guardrails.avoid_heavy_spinal_loading = true;

  const strengthCases = [
    makeScenario({
      id: 'persona_strength_no_wearable_baseline',
      label: 'Strength persona — no wearable, normal check-in',
      persona: strengthPersona,
      readiness: { subjective: subjective({ readiness: 8, fatigue: 3, soreness: 3, motivation: 9, timeAvailable: 75, preferredModalityToday: 'Strength' }), objective: noWearable },
      context: strengthContext,
      trainingIntentProfile: strengthIntent,
      userPreferences: strengthPreferences,
    }),
    makeScenario({
      id: 'persona_strength_no_wearable_work_fatigue',
      label: 'Strength persona — no wearable, physically fatigued from work',
      persona: strengthPersona,
      readiness: { subjective: subjective({ readiness: 4, fatigue: 8, soreness: 7, stress: 6, motivation: 7, timeAvailable: 60, preferredModalityToday: 'Strength' }), objective: noWearable },
      context: strengthContext,
      trainingIntentProfile: strengthIntent,
      userPreferences: strengthPreferences,
    }),
    makeScenario({
      id: 'persona_strength_no_wearable_symptom_flare',
      label: 'Strength persona — no wearable, active shoulder/back symptom flare',
      persona: strengthPersona,
      readiness: { subjective: subjective({ readiness: 3, fatigue: 6, soreness: 6, stress: 5, painFlag: true, timeAvailable: 60, preferredModalityToday: 'Strength' }), objective: noWearable },
      context: strengthFlareContext,
      trainingIntentProfile: strengthIntent,
      userPreferences: strengthPreferences,
    }),
  ];

  const healthCases = [
    makeScenario({
      id: 'persona_health_fatloss_baseline',
      label: 'Health/fat-loss persona — Garmin, normal recovery',
      persona: healthPersona,
      readiness: { subjective: subjective({ readiness: 7, fatigue: 3, soreness: 2, motivation: 7 }), objective: neutralGarmin },
      context: healthContext,
      trainingIntentProfile: healthIntent,
      userPreferences: healthPreferences,
    }),
    makeScenario({
      id: 'persona_health_fatloss_adverse_recovery',
      label: 'Health/fat-loss persona — Garmin, adverse recovery',
      persona: healthPersona,
      readiness: { subjective: subjective({ readiness: 4, sleepQuality: 4, fatigue: 7, soreness: 4, stress: 6, motivation: 6 }), objective: adverseGarmin },
      context: healthContext,
      trainingIntentProfile: healthIntent,
      userPreferences: healthPreferences,
    }),
    makeScenario({
      id: 'persona_health_fatloss_low_time',
      label: 'Health/fat-loss persona — Garmin, only 30 minutes today',
      persona: healthPersona,
      readiness: { subjective: subjective({ readiness: 7, fatigue: 3, soreness: 2, motivation: 7, timeAvailable: 30 }), objective: neutralGarmin },
      context: { ...clone(healthContext), constraints: { ...clone(healthContext.constraints), maxTimeMinutes: 30 }, trainingSettings: { ...clone(healthContext.trainingSettings), defaults: { ...clone(healthContext.trainingSettings.defaults), weekdayMaxMinutes: 30 } } },
      trainingIntentProfile: healthIntent,
      userPreferences: healthPreferences,
    }),
  ];

  const formerEliteCases = [
    makeScenario({
      id: 'persona_former_elite_sparse_history_baseline',
      label: 'Former-elite persona — good Garmin day, sparse current history',
      persona: formerElitePersona,
      readiness: { subjective: subjective({ readiness: 8, fatigue: 2, soreness: 2, motivation: 9, preferredModalityToday: 'Running' }), objective: neutralGarmin },
      context: formerEliteContext,
      trainingIntentProfile: formerEliteIntent,
      userPreferences: formerElitePreferences,
    }),
    makeScenario({
      id: 'persona_former_elite_adverse_recovery',
      label: 'Former-elite persona — adverse recovery despite strong background',
      persona: formerElitePersona,
      readiness: { subjective: subjective({ readiness: 4, sleepQuality: 4, fatigue: 7, soreness: 5, motivation: 8, preferredModalityToday: 'Running' }), objective: adverseGarmin },
      context: formerEliteContext,
      trainingIntentProfile: formerEliteIntent,
      userPreferences: formerElitePreferences,
    }),
    makeScenario({
      id: 'persona_former_elite_low_motivation_only',
      label: 'Former-elite persona — low motivation without physiological red flags',
      persona: formerElitePersona,
      readiness: { subjective: subjective({ readiness: 7, fatigue: 3, soreness: 2, stress: 4, motivation: 2, preferredModalityToday: 'Running' }), objective: neutralGarmin },
      context: formerEliteContext,
      trainingIntentProfile: formerEliteIntent,
      userPreferences: formerElitePreferences,
    }),
  ];

  return [
    {
      familyId: 'persona_strength_no_wearable',
      changedAxis: 'current check-in state for a strength-priority athlete with no wearable data',
      comparisonInstruction: 'Compare the same synthetic athlete across normal work recovery, high occupational fatigue, and an active shoulder/back symptom flare. Missing wearable metrics are intentional and must not be treated as a reason to invent objective recovery data.',
      cases: strengthCases,
    },
    {
      familyId: 'persona_health_fat_loss',
      changedAxis: 'current recovery/time state for a health-and-fat-loss evergreen athlete with Garmin data',
      comparisonInstruction: 'Compare sustainable health-oriented programming across normal recovery, adverse recovery, and a short time window. There is no race and no reason to peak.',
      cases: healthCases,
    },
    {
      familyId: 'persona_former_elite_return',
      changedAxis: 'current recovery state for a former high-level endurance athlete whose present training is intermittent',
      comparisonInstruction: 'Historical competitive level must not be mistaken for current load tolerance. Compare current-state reactions; sparse present history should remain the dose authority.',
      cases: formerEliteCases,
    },
  ];
}

export function assertPersonaFixtureIntegrity(families) {
  const failures = [];
  const allCases = families.flatMap((family) => family.cases);
  const ids = new Set();
  for (const definition of allCases) {
    const { scenario, persona } = definition;
    if (ids.has(scenario.id)) failures.push(`Duplicate persona case id: ${scenario.id}`);
    ids.add(scenario.id);
    if (scenario.event !== null || (scenario.events ?? []).length !== 0) failures.push(`${scenario.id}: persona fixtures must be evergreen and event-free.`);
    if (scenario.trainingIntentProfile?.planningMode !== 'evergreen') failures.push(`${scenario.id}: missing evergreen training intent.`);
    const serialized = JSON.stringify({ persona, label: scenario.label, description: scenario.description }).toLowerCase();
    for (const realName of ['adrian', 'rafal', 'rafał', 'ola', 'aleksandra']) {
      if (serialized.includes(realName)) failures.push(`${scenario.id}: public fixture contains a real-person name (${realName}).`);
    }
  }

  for (const definition of allCases.filter((item) => item.persona.personaId === 'strength_manual_work_no_wearable')) {
    const readiness = definition.scenario.readinessForWeek(0);
    for (const field of OBJECTIVE_FIELDS) {
      if (readiness.objective[field] !== null) failures.push(`${definition.scenario.id}: no-wearable field ${field} must be null.`);
    }
  }

  const flare = allCases.find((item) => item.scenario.id === 'persona_strength_no_wearable_symptom_flare');
  if (!flare?.scenario.readinessForWeek(0).subjective.painFlag) failures.push('Strength flare case must set painFlag=true.');
  const flareGuards = new Set(flare?.scenario.context.constraints.impliedGuardrails ?? []);
  for (const guardrail of ['avoid_overhead_pressing', 'avoid_heavy_spinal_loading']) {
    if (!flareGuards.has(guardrail)) failures.push(`Strength flare case must activate ${guardrail}.`);
  }

  const health = allCases.find((item) => item.scenario.id === 'persona_health_fatloss_baseline');
  if (!health?.scenario.trainingIntentProfile.priorities.includes('health')) failures.push('Health/fat-loss persona must carry health priority.');
  const formerElite = allCases.find((item) => item.scenario.id === 'persona_former_elite_sparse_history_baseline');
  if ((formerElite?.scenario.initialHistory ?? []).length !== 0) failures.push('Former-elite sparse-history case must not invent current training history from historical status.');

  if (failures.length) throw new Error(`Persona fixture integrity failed:\n- ${failures.join('\n- ')}`);
  return { familyCount: families.length, caseCount: allCases.length };
}
