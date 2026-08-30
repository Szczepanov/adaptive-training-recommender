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

function makeScenario({ id, label, persona, readiness, context: userContext, trainingIntentProfile, userPreferences, initialHistory = [] }) {
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
      initialHistory: clone(initialHistory),
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

const balancedContext = context({
  goals: {
    shortTerm: 'Build a balanced week that improves aerobic fitness and whole-body strength without a competition target.',
    midTerm: 'Improve general performance while keeping both endurance and strength progressing.',
    longTerm: 'Remain broadly capable across endurance and resistance training.',
  },
  preferredModalities: ['Running', 'Strength'],
  equipment: { free_weights: true, treadmill: true },
  maxTimeMinutes: 60,
});
const balancedIntent = intent(['balanced_performance'], 4, 5);
const balancedPreferences = preferences(['Running', 'Strength']);
const balancedPersona = {
  personaId: 'balanced_performance_generalist',
  dataAvailability: 'garmin_plus_subjective_checkin',
  primaryGoal: 'balanced endurance and strength performance',
  currentTrainingIdentity: 'generalist with no event target',
  judgeExpectations: [
    'Treat balanced_performance as requiring meaningful aerobic and strength exposure, not as a synonym for endurance-only training.',
    'Do not invent an event, taper, or race-specific peak.',
    'Use today-specific modality preference as a soft signal, not authority to erase the other required adaptation.',
    'Adverse recovery should lower near-term cost while preserving the longer-horizon balanced intent.',
  ],
};

const stackedConstraintContext = context({
  goals: {
    shortTerm: 'Maintain a health-focused training routine while lower-body loading is temporarily constrained.',
    midTerm: 'Preserve aerobic fitness and strength with only currently compatible sessions.',
    longTerm: 'Return to unrestricted general training after the temporary constraint resolves.',
  },
  preferredModalities: ['Strength', 'Cycling', 'Running'],
  equipment: { free_weights: false, cable_machine: false, treadmill: false, indoor_bike: false, pullup_bar: false },
  guardrails: { avoid_heavy_lower_body: true },
  maxTimeMinutes: 60,
});
stackedConstraintContext.constraints.restrictedModalities = ['Running'];
const stackedConstraintIntent = intent(['health'], 4, 5);
const stackedConstraintPreferences = preferences(['Strength', 'Cycling', 'Running']);
const stackedConstraintPersona = {
  personaId: 'health_stacked_injury_equipment_constraints',
  dataAvailability: 'garmin_plus_subjective_checkin',
  primaryGoal: 'maintain health-oriented training within temporary injury and equipment constraints',
  currentTrainingIdentity: 'general fitness with temporarily restricted running and no training equipment',
  constraintContext: 'running is temporarily restricted; heavy lower-body work is guarded; free weights, cable machine, treadmill and indoor bike are unavailable',
  judgeExpectations: [
    'Never bypass a hard running restriction or recommend equipment the athlete does not have.',
    'Respect the heavy-lower-body guardrail even when health programming still needs aerobic and strength exposure.',
    'If the required weekly mix is infeasible, expose the shortfall rather than fabricating an inaccessible session.',
    'Adverse recovery or a short time window should tighten the recommendation on top of the standing hard constraints.',
  ],
};

const walkingContext = context({
  goals: {
    shortTerm: 'Build a repeatable health-focused exercise habit without running.',
    midTerm: 'Improve aerobic fitness and strength using walking as the primary cardio modality.',
    longTerm: 'Maintain lifelong health-focused training that does not depend on running being available.',
  },
  preferredModalities: ['Walking', 'Strength'],
  equipment: { free_weights: true },
  maxTimeMinutes: 60,
});
walkingContext.constraints.restrictedModalities = ['Running'];
const walkingIntent = intent(['health'], 4, 5);
const walkingPreferences = preferences(['Walking', 'Strength']);
const walkingPersona = {
  personaId: 'walking_preferred_no_running_health',
  dataAvailability: 'garmin_plus_subjective_checkin',
  primaryGoal: 'sustainable health-oriented fitness without running',
  currentTrainingIdentity: 'general fitness; running is not a viable modality',
  constraintContext: 'running is restricted; walking is the primary preferred aerobic modality',
  judgeExpectations: [
    'Never recommend running or a running-derived session; walking is the only viable aerobic modality here.',
    'A purposeful continuous walk is real aerobic-volume training for this persona, not merely a rest-day filler.',
    'Strength should remain represented alongside walking across the week, matching the standing health-priority guideline.',
    'A short time window should reduce session duration, not silently drop walking or strength from the week.',
  ],
};

const establishedHistoryContext = context({
  goals: {
    shortTerm: 'Continue progressing endurance performance from an already-consistent training base.',
    midTerm: 'Add purposeful quality work on top of established aerobic volume.',
    longTerm: 'Build toward a future event from a genuinely current, not historical, fitness level.',
  },
  preferredModalities: ['Running'],
  equipment: { free_weights: true },
  maxTimeMinutes: 75,
});
const establishedHistoryIntent = intent(['endurance'], 4, 5);
const establishedHistoryPreferences = preferences(['Running']);
const establishedHistoryPersona = {
  personaId: 'established_endurance_runner',
  dataAvailability: 'garmin_plus_subjective_checkin',
  primaryGoal: 'progress endurance performance from an established current training base',
  currentTrainingIdentity: 'consistently training runner with real, recent, current-state volume -- the direct contrast to the former-elite persona, whose authority is historical rather than current',
  judgeExpectations: [
    'A genuinely established, consistent recent training base may reasonably include one purposeful higher-intensity session per week, not only easy volume.',
    'This persona\'s authority is current logged training, never historical achievement -- do not confuse it with the former-elite persona\'s sparse-history caution.',
    'Adverse recovery should still reduce near-term load despite the established base.',
    'Low motivation alone, with good objective recovery, should not remove an otherwise-earned higher-intensity opportunity.',
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

  const balancedCases = [
    makeScenario({
      id: 'persona_balanced_performance_baseline',
      label: 'Balanced-performance persona — normal recovery',
      persona: balancedPersona,
      readiness: { subjective: subjective({ readiness: 8, fatigue: 2, soreness: 2, motivation: 8 }), objective: neutralGarmin },
      context: balancedContext,
      trainingIntentProfile: balancedIntent,
      userPreferences: balancedPreferences,
    }),
    makeScenario({
      id: 'persona_balanced_performance_adverse_recovery',
      label: 'Balanced-performance persona — adverse recovery',
      persona: balancedPersona,
      readiness: { subjective: subjective({ readiness: 4, sleepQuality: 4, fatigue: 7, soreness: 5, stress: 6, motivation: 7 }), objective: adverseGarmin },
      context: balancedContext,
      trainingIntentProfile: balancedIntent,
      userPreferences: balancedPreferences,
    }),
    makeScenario({
      id: 'persona_balanced_performance_strength_preference',
      label: 'Balanced-performance persona — strength preference today',
      persona: balancedPersona,
      readiness: { subjective: subjective({ readiness: 8, fatigue: 2, soreness: 2, motivation: 9, preferredModalityToday: 'Strength' }), objective: neutralGarmin },
      context: balancedContext,
      trainingIntentProfile: balancedIntent,
      userPreferences: balancedPreferences,
    }),
  ];

  const walkingCases = [
    makeScenario({
      id: 'persona_walking_baseline',
      label: 'Walking-preferred persona — Garmin, normal recovery',
      persona: walkingPersona,
      readiness: { subjective: subjective({ readiness: 7, fatigue: 3, soreness: 2, motivation: 7, preferredModalityToday: 'Walking' }), objective: neutralGarmin },
      context: walkingContext,
      trainingIntentProfile: walkingIntent,
      userPreferences: walkingPreferences,
    }),
    makeScenario({
      id: 'persona_walking_adverse_recovery',
      label: 'Walking-preferred persona — Garmin, adverse recovery',
      persona: walkingPersona,
      readiness: { subjective: subjective({ readiness: 4, sleepQuality: 4, fatigue: 7, soreness: 4, stress: 6, motivation: 6, preferredModalityToday: 'Walking' }), objective: adverseGarmin },
      context: walkingContext,
      trainingIntentProfile: walkingIntent,
      userPreferences: walkingPreferences,
    }),
    makeScenario({
      id: 'persona_walking_low_time',
      label: 'Walking-preferred persona — Garmin, only 30 minutes today',
      persona: walkingPersona,
      readiness: { subjective: subjective({ readiness: 7, fatigue: 3, soreness: 2, motivation: 7, timeAvailable: 30, preferredModalityToday: 'Walking' }), objective: neutralGarmin },
      context: { ...clone(walkingContext), constraints: { ...clone(walkingContext.constraints), maxTimeMinutes: 30 }, trainingSettings: { ...clone(walkingContext.trainingSettings), defaults: { ...clone(walkingContext.trainingSettings.defaults), weekdayMaxMinutes: 30 } } },
      trainingIntentProfile: walkingIntent,
      userPreferences: walkingPreferences,
    }),
  ];

  // 12 consistent 60-minute running exposures across a 28-day window ending just before
  // startDate (2026-08-31). inferAthleteTrainingState() requires >=28 observed days and
  // >=12 sessions / >=720 minutes to classify an athlete as 'established' -- this is
  // exactly that floor, deliberately not padded, so the family stays a precise regression
  // for the boundary rather than an easy over-qualification.
  const establishedHistoryExposures = [
    '2026-08-03', '2026-08-06', '2026-08-08', '2026-08-10',
    '2026-08-12', '2026-08-14', '2026-08-16', '2026-08-18',
    '2026-08-20', '2026-08-22', '2026-08-24', '2026-08-27',
  ].map((date, index) => ({
    occurrenceKey: `persona-established-running-${index}`,
    date,
    costProfile: { systemic: 0.25, cardiovascular: 0.35, lowerBody: 0.2, upperBody: 0, impactTissue: 0.15, neuromuscular: 0.1 },
    modality: 'Running',
    category: 'Easy Endurance',
    trainingRecordLike: { type: 'Running aerobic endurance', duration_min: 60, training_effect: 2, intensity_tag: 'easy' },
  }));

  const establishedHistoryCases = [
    makeScenario({
      id: 'persona_established_history_baseline',
      label: 'Established-history endurance persona — good recovery',
      persona: establishedHistoryPersona,
      readiness: { subjective: subjective({ readiness: 8, fatigue: 2, soreness: 2, motivation: 8, preferredModalityToday: 'Running' }), objective: neutralGarmin },
      context: establishedHistoryContext,
      trainingIntentProfile: establishedHistoryIntent,
      userPreferences: establishedHistoryPreferences,
      initialHistory: establishedHistoryExposures,
    }),
    makeScenario({
      id: 'persona_established_history_adverse_recovery',
      label: 'Established-history endurance persona — adverse recovery despite the established base',
      persona: establishedHistoryPersona,
      readiness: { subjective: subjective({ readiness: 4, sleepQuality: 4, fatigue: 7, soreness: 5, motivation: 7, preferredModalityToday: 'Running' }), objective: adverseGarmin },
      context: establishedHistoryContext,
      trainingIntentProfile: establishedHistoryIntent,
      userPreferences: establishedHistoryPreferences,
      initialHistory: establishedHistoryExposures,
    }),
    makeScenario({
      id: 'persona_established_history_low_motivation_only',
      label: 'Established-history endurance persona — low motivation without physiological red flags',
      persona: establishedHistoryPersona,
      readiness: { subjective: subjective({ readiness: 7, fatigue: 3, soreness: 2, stress: 4, motivation: 2, preferredModalityToday: 'Running' }), objective: neutralGarmin },
      context: establishedHistoryContext,
      trainingIntentProfile: establishedHistoryIntent,
      userPreferences: establishedHistoryPreferences,
      initialHistory: establishedHistoryExposures,
    }),
  ];

  const stackedConstraintCases = [
    makeScenario({
      id: 'persona_stacked_constraints_baseline',
      label: 'Stacked-constraint health persona — normal recovery',
      persona: stackedConstraintPersona,
      readiness: { subjective: subjective({ readiness: 7, fatigue: 3, soreness: 3, motivation: 8 }), objective: neutralGarmin },
      context: stackedConstraintContext,
      trainingIntentProfile: stackedConstraintIntent,
      userPreferences: stackedConstraintPreferences,
    }),
    makeScenario({
      id: 'persona_stacked_constraints_adverse_recovery',
      label: 'Stacked-constraint health persona — adverse recovery',
      persona: stackedConstraintPersona,
      readiness: { subjective: subjective({ readiness: 4, sleepQuality: 4, fatigue: 7, soreness: 5, stress: 6, motivation: 7 }), objective: adverseGarmin },
      context: stackedConstraintContext,
      trainingIntentProfile: stackedConstraintIntent,
      userPreferences: stackedConstraintPreferences,
    }),
    makeScenario({
      id: 'persona_stacked_constraints_low_time',
      label: 'Stacked-constraint health persona — only 30 minutes today',
      persona: stackedConstraintPersona,
      readiness: { subjective: subjective({ readiness: 7, fatigue: 3, soreness: 3, motivation: 8, timeAvailable: 30 }), objective: neutralGarmin },
      context: stackedConstraintContext,
      trainingIntentProfile: stackedConstraintIntent,
      userPreferences: stackedConstraintPreferences,
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
    {
      familyId: 'persona_balanced_performance',
      changedAxis: 'current recovery and today-specific modality preference for an evergreen balanced-performance generalist',
      comparisonInstruction: 'Compare the same balanced-performance athlete across normal recovery, adverse recovery, and a strength preference today. The planner should preserve both aerobic and strength requirements over the week without inventing event-specific preparation.',
      cases: balancedCases,
    },
    {
      familyId: 'persona_stacked_constraints',
      changedAxis: 'current recovery/time state with a standing running restriction, heavy-lower-body guardrail, and no training equipment',
      comparisonInstruction: 'Compare the same health-priority athlete across normal recovery, adverse recovery, and a short time window while all standing hard constraints remain active. Infeasible coverage should be reported rather than bypassing injury or equipment gates.',
      cases: stackedConstraintCases,
    },
    {
      familyId: 'persona_walking_preferred',
      changedAxis: 'current recovery/time state for a health-priority athlete who cannot run and prefers walking',
      comparisonInstruction: 'Compare the same walking-preferred, running-restricted athlete across normal recovery, adverse recovery, and a short time window. Walking must be treated as genuine aerobic-volume training, not merely optional recovery filler, and must never be silently replaced by a restricted running session.',
      cases: walkingCases,
    },
    {
      familyId: 'persona_established_history',
      changedAxis: 'current recovery and motivation state for an endurance athlete with a genuinely established, current 28-day training base',
      comparisonInstruction: 'This is the direct contrast to persona_former_elite_return: authority here is current, recent, consistently logged training rather than historical achievement. Compare the same established athlete across good recovery (which may reasonably unlock one purposeful higher-intensity session per week), adverse recovery (which should still reduce load), and low motivation alone with good objective signals (which should not remove an otherwise-earned higher-intensity opportunity).',
      cases: establishedHistoryCases,
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

  const balanced = allCases.filter((item) => item.persona.personaId === 'balanced_performance_generalist');
  if (balanced.length !== 3) failures.push(`Balanced-performance persona must have exactly 3 cases, found ${balanced.length}.`);
  if (balanced.some((item) => !item.scenario.trainingIntentProfile.priorities.includes('balanced_performance'))) {
    failures.push('Balanced-performance persona cases must carry balanced_performance priority.');
  }

  const stacked = allCases.filter((item) => item.persona.personaId === 'health_stacked_injury_equipment_constraints');
  if (stacked.length !== 3) failures.push(`Stacked-constraint persona must have exactly 3 cases, found ${stacked.length}.`);
  for (const definition of stacked) {
    const { context: stackedContext } = definition.scenario;
    if (!(stackedContext.constraints.restrictedModalities ?? []).includes('Running')) {
      failures.push(`${definition.scenario.id}: stacked-constraint persona must keep Running restricted.`);
    }
    if (!(stackedContext.constraints.impliedGuardrails ?? []).includes('avoid_heavy_lower_body')) {
      failures.push(`${definition.scenario.id}: stacked-constraint persona must keep avoid_heavy_lower_body active.`);
    }
    for (const equipment of ['free_weights', 'cable_machine', 'treadmill', 'indoor_bike', 'pullup_bar']) {
      if (stackedContext.trainingSettings.equipment[equipment]) {
        failures.push(`${definition.scenario.id}: stacked-constraint persona must not have ${equipment}.`);
      }
    }
  }

  const walking = allCases.filter((item) => item.persona.personaId === 'walking_preferred_no_running_health');
  if (walking.length !== 3) failures.push(`Walking-preferred persona must have exactly 3 cases, found ${walking.length}.`);
  for (const definition of walking) {
    if (!(definition.scenario.context.constraints.restrictedModalities ?? []).includes('Running')) {
      failures.push(`${definition.scenario.id}: walking-preferred persona must keep Running restricted.`);
    }
    if (!definition.scenario.preferences.preferredModalities.includes('Walking')) {
      failures.push(`${definition.scenario.id}: walking-preferred persona must prefer Walking.`);
    }
  }

  const establishedHistory = allCases.filter((item) => item.persona.personaId === 'established_endurance_runner');
  if (establishedHistory.length !== 3) failures.push(`Established-history persona must have exactly 3 cases, found ${establishedHistory.length}.`);
  for (const definition of establishedHistory) {
    const history = definition.scenario.initialHistory ?? [];
    if (history.length < 12) failures.push(`${definition.scenario.id}: established-history persona must seed at least 12 exposures, found ${history.length}.`);
    const dates = history.map((item) => item.date).sort();
    if (dates.length > 0) {
      const spanDays = (new Date(definition.scenario.startDate) - new Date(dates[0])) / 86_400_000;
      if (spanDays < 28) failures.push(`${definition.scenario.id}: established-history persona's seeded history must span at least 28 days before startDate, found ${spanDays}.`);
    }
    if (!definition.scenario.trainingIntentProfile.priorities.includes('endurance')) {
      failures.push(`${definition.scenario.id}: established-history persona must carry endurance priority.`);
    }
  }

  if (failures.length) throw new Error(`Persona fixture integrity failed:\n- ${failures.join('\n- ')}`);
  return { familyCount: families.length, caseCount: allCases.length };
}
