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
      outdoor_bike: false,
      swim_access: false,
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

function makeScenario({ id, label, persona, readiness, context: userContext, trainingIntentProfile, userPreferences, initialHistory = [], event = null, weeks = 2 }) {
  return {
    persona,
    scenario: {
      id,
      label,
      description: `Synthetic persona evaluation case for ${persona.personaId}. No real person's name or identifying data is persisted.`,
      context: userContext,
      event: clone(event),
      events: event ? [clone(event)] : [],
      trainingIntentProfile,
      preferences: userPreferences,
      startDate: '2026-08-31',
      initialHistory: clone(initialHistory),
      fixedActivities: [],
      tags: ['ai-plan-judge', 'persona-evaluation', persona.personaId],
      weeks,
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

const TRIATHLON_DEMANDS = {
  eighth_im: { aerobicEndurance: 0.6, thresholdPower: 0.75, vo2MaxPower: 0.65, repeatedSurges: 0.3, sprintPower: 0.2, fatigueResistance: 0.5, neuromuscular: 0.2 },
  olympic: { aerobicEndurance: 0.75, thresholdPower: 0.8, vo2MaxPower: 0.45, repeatedSurges: 0.2, sprintPower: 0.1, fatigueResistance: 0.65, neuromuscular: 0.15 },
  half_iron: { aerobicEndurance: 0.9, thresholdPower: 0.7, vo2MaxPower: 0.25, repeatedSurges: 0.1, sprintPower: 0.05, fatigueResistance: 0.85, neuromuscular: 0.1 },
};

function triathlonEvent(preset, date) {
  return {
    id: `persona-triathlon-${preset}`,
    title: `Triathlon A-event (${preset})`,
    date,
    priority: 'A',
    lifecycle: 'scheduled',
    category: 'triathlon',
    demandProfile: clone(TRIATHLON_DEMANDS[preset]),
  };
}

function triathlonHistory(prefix, dates) {
  const modalities = ['Swimming', 'Cycling', 'Running'];
  return dates.map((date, index) => {
    const modality = modalities[index % modalities.length];
    return {
      occurrenceKey: `${prefix}-${index}`,
      date,
      costProfile: modality === 'Running'
        ? { systemic: 0.3, cardiovascular: 0.35, lowerBody: 0.25, upperBody: 0, impactTissue: 0.2, neuromuscular: 0.1 }
        : { systemic: 0.25, cardiovascular: 0.35, lowerBody: modality === 'Cycling' ? 0.2 : 0.05, upperBody: modality === 'Swimming' ? 0.12 : 0, impactTissue: 0.05, neuromuscular: 0.08 },
      modality,
      category: 'Easy Endurance',
      trainingRecordLike: { type: `${modality} aerobic endurance`, duration_min: modality === 'Swimming' ? 45 : 60, training_effect: 2, intensity_tag: 'easy' },
    };
  });
}

const triathlonNoviceContext = context({
  goals: {
    shortTerm: 'Learn to train consistently across swimming, cycling and running for a first short-distance triathlon.',
    midTerm: 'Build safe confidence in all three disciplines without forcing intensity beyond current experience.',
    longTerm: 'Complete a 1/8-distance triathlon with sustainable, repeatable preparation.',
  },
  preferredModalities: ['Swimming', 'Cycling', 'Running'],
  equipment: { outdoor_bike: true, swim_access: true },
  maxTimeMinutes: 60,
});
const triathlonNovicePreferences = preferences(['Swimming', 'Cycling', 'Running']);
const triathlonNovicePersona = {
  personaId: 'triathlon_novice_eighth',
  dataAvailability: 'garmin_plus_subjective_checkin',
  primaryGoal: 'complete a first 1/8-distance triathlon safely',
  currentTrainingIdentity: 'new triathlon athlete with no fabricated current training base',
  judgeExpectations: [
    'Treat no seeded current history as novice status; do not infer swim proficiency or a high training tolerance.',
    'When pool and bicycle access are available, preserve reachable exposure to Swimming, Cycling and Running across the week.',
    'When pool access is unavailable, never prescribe Swimming or invent an alternative that claims to satisfy the swim requirement.',
  ],
};

const triathlonIntermediateContext = context({
  goals: {
    shortTerm: 'Build consistent three-discipline preparation for an Olympic-distance triathlon.',
    midTerm: 'Progress aerobic durability and controlled quality without losing any race discipline.',
    longTerm: 'Complete an Olympic triathlon from a current, sustainable mixed-discipline base.',
  },
  preferredModalities: ['Swimming', 'Cycling', 'Running'],
  equipment: { outdoor_bike: true, swim_access: true },
  maxTimeMinutes: 75,
});
const triathlonIntermediatePreferences = preferences(['Swimming', 'Cycling', 'Running']);
const triathlonIntermediatePersona = {
  personaId: 'triathlon_intermediate_olympic',
  dataAvailability: 'garmin_plus_subjective_checkin',
  primaryGoal: 'prepare for an Olympic-distance triathlon from a current mixed-discipline base',
  currentTrainingIdentity: 'recreational triathlete with recent swimming, cycling and running exposure',
  judgeExpectations: [
    'Use the real recent mixed-discipline history as current capacity evidence, not as permission to ignore recovery signals.',
    'Retain all three race disciplines when access exists; a short time budget may reduce dose but not bypass hard feasibility rules.',
    'Do not invent a brick workout, swim pace anchor, or open-water capability that the engine does not model.',
  ],
};

const triathlonAdvancedContext = context({
  goals: {
    shortTerm: 'Prepare a durable three-discipline week for a 70.3-distance triathlon.',
    midTerm: 'Maintain consistent swimming, cycling and running while respecting recovery and race proximity.',
    longTerm: 'Arrive at a 70.3 with a sustainable current endurance base rather than an assumed elite capacity.',
  },
  preferredModalities: ['Swimming', 'Cycling', 'Running'],
  equipment: { outdoor_bike: true, swim_access: true },
  maxTimeMinutes: 90,
});
const triathlonAdvancedPreferences = preferences(['Swimming', 'Cycling', 'Running']);
const triathlonAdvancedPersona = {
  personaId: 'triathlon_advanced_half_iron',
  dataAvailability: 'garmin_plus_subjective_checkin',
  primaryGoal: 'prepare for a 70.3-distance triathlon from an established current mixed-discipline base',
  currentTrainingIdentity: 'experienced triathlete with substantial current mixed-discipline exposure',
  judgeExpectations: [
    'A larger current base can support more total work, but adverse recovery still reduces near-term cost.',
    'In the final 14 days, evaluate taper restraint against the scheduled A-event rather than rewarding ordinary build volume.',
    'Do not infer a specialist long-course volume progression, bricks, or swim-performance anchors beyond the modeled evidence.',
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
      context: { ...clone(healthContext), constraints: { ...clone(healthContext.constraints), maxTimeMinutes: 30 }, trainingSettings: { ...clone(healthContext.trainingSettings), defaults: { ...clone(healthContext.trainingSettings.defaults), weekdayMaxMinutes: 30, weekendMaxMinutes: 30 } } },
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
      context: { ...clone(walkingContext), constraints: { ...clone(walkingContext.constraints), maxTimeMinutes: 30 }, trainingSettings: { ...clone(walkingContext.trainingSettings), defaults: { ...clone(walkingContext.trainingSettings.defaults), weekdayMaxMinutes: 30, weekendMaxMinutes: 30 } } },
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

  const intermediateHistory = triathlonHistory('persona-triathlon-intermediate', [
    '2026-08-03', '2026-08-05', '2026-08-08', '2026-08-10', '2026-08-12', '2026-08-14',
    '2026-08-17', '2026-08-19', '2026-08-21', '2026-08-23', '2026-08-25', '2026-08-27',
  ]);
  const advancedHistory = triathlonHistory('persona-triathlon-advanced', [
    '2026-08-03', '2026-08-04', '2026-08-06', '2026-08-08', '2026-08-10', '2026-08-11',
    '2026-08-13', '2026-08-15', '2026-08-17', '2026-08-18', '2026-08-20', '2026-08-22',
    '2026-08-23', '2026-08-25', '2026-08-26', '2026-08-27', '2026-08-28', '2026-08-29',
  ]);

  const novicePoolUnavailableContext = clone(triathlonNoviceContext);
  novicePoolUnavailableContext.trainingSettings.equipment.swim_access = false;
  const intermediateShortTimeContext = clone(triathlonIntermediateContext);
  intermediateShortTimeContext.constraints.maxTimeMinutes = 45;
  intermediateShortTimeContext.trainingSettings.defaults.weekdayMaxMinutes = 45;

  const noviceTriathlonCases = [
    makeScenario({
      id: 'persona_triathlon_novice_eighth_baseline',
      label: 'Novice triathlon persona — 1/8 distance, normal recovery',
      persona: triathlonNovicePersona,
      readiness: { subjective: subjective({ readiness: 7, fatigue: 3, soreness: 2, motivation: 8, preferredModalityToday: 'Swimming' }), objective: neutralGarmin },
      context: triathlonNoviceContext,
      trainingIntentProfile: null,
      userPreferences: triathlonNovicePreferences,
      event: triathlonEvent('eighth_im', '2026-10-12'),
    }),
    makeScenario({
      id: 'persona_triathlon_novice_eighth_adverse_recovery',
      label: 'Novice triathlon persona — 1/8 distance, adverse recovery',
      persona: triathlonNovicePersona,
      readiness: { subjective: subjective({ readiness: 4, sleepQuality: 4, fatigue: 7, soreness: 5, stress: 6, motivation: 6, preferredModalityToday: 'Swimming' }), objective: adverseGarmin },
      context: triathlonNoviceContext,
      trainingIntentProfile: null,
      userPreferences: triathlonNovicePreferences,
      event: triathlonEvent('eighth_im', '2026-10-12'),
    }),
    makeScenario({
      id: 'persona_triathlon_novice_eighth_pool_unavailable',
      label: 'Novice triathlon persona — 1/8 distance, pool unavailable',
      persona: triathlonNovicePersona,
      readiness: { subjective: subjective({ readiness: 7, fatigue: 3, soreness: 2, motivation: 8, preferredModalityToday: 'Cycling' }), objective: neutralGarmin },
      context: novicePoolUnavailableContext,
      trainingIntentProfile: null,
      userPreferences: triathlonNovicePreferences,
      event: triathlonEvent('eighth_im', '2026-10-12'),
    }),
  ];

  const intermediateTriathlonCases = [
    makeScenario({
      id: 'persona_triathlon_intermediate_olympic_baseline',
      label: 'Intermediate triathlon persona — Olympic distance, normal recovery',
      persona: triathlonIntermediatePersona,
      readiness: { subjective: subjective({ readiness: 8, fatigue: 2, soreness: 2, motivation: 8, timeAvailable: 75, preferredModalityToday: 'Cycling' }), objective: neutralGarmin },
      context: triathlonIntermediateContext,
      trainingIntentProfile: null,
      userPreferences: triathlonIntermediatePreferences,
      initialHistory: intermediateHistory,
      event: triathlonEvent('olympic', '2026-10-12'),
    }),
    makeScenario({
      id: 'persona_triathlon_intermediate_olympic_adverse_recovery',
      label: 'Intermediate triathlon persona — Olympic distance, adverse recovery',
      persona: triathlonIntermediatePersona,
      readiness: { subjective: subjective({ readiness: 4, sleepQuality: 4, fatigue: 7, soreness: 5, stress: 6, motivation: 7, timeAvailable: 75, preferredModalityToday: 'Cycling' }), objective: adverseGarmin },
      context: triathlonIntermediateContext,
      trainingIntentProfile: null,
      userPreferences: triathlonIntermediatePreferences,
      initialHistory: intermediateHistory,
      event: triathlonEvent('olympic', '2026-10-12'),
    }),
    makeScenario({
      id: 'persona_triathlon_intermediate_olympic_short_time',
      label: 'Intermediate triathlon persona — Olympic distance, 45-minute weekday cap',
      persona: triathlonIntermediatePersona,
      readiness: { subjective: subjective({ readiness: 7, fatigue: 3, soreness: 2, motivation: 8, timeAvailable: 45, preferredModalityToday: 'Running' }), objective: neutralGarmin },
      context: intermediateShortTimeContext,
      trainingIntentProfile: null,
      userPreferences: triathlonIntermediatePreferences,
      initialHistory: intermediateHistory,
      event: triathlonEvent('olympic', '2026-10-12'),
    }),
  ];

  const advancedTriathlonCases = [
    makeScenario({
      id: 'persona_triathlon_advanced_half_iron_baseline',
      label: 'Advanced triathlon persona — 70.3 distance, normal recovery',
      persona: triathlonAdvancedPersona,
      readiness: { subjective: subjective({ readiness: 8, fatigue: 2, soreness: 2, motivation: 8, timeAvailable: 90, preferredModalityToday: 'Cycling' }), objective: neutralGarmin },
      context: triathlonAdvancedContext,
      trainingIntentProfile: null,
      userPreferences: triathlonAdvancedPreferences,
      initialHistory: advancedHistory,
      event: triathlonEvent('half_iron', '2026-10-12'),
    }),
    makeScenario({
      id: 'persona_triathlon_advanced_half_iron_adverse_recovery',
      label: 'Advanced triathlon persona — 70.3 distance, adverse recovery',
      persona: triathlonAdvancedPersona,
      readiness: { subjective: subjective({ readiness: 4, sleepQuality: 4, fatigue: 7, soreness: 5, stress: 6, motivation: 7, timeAvailable: 90, preferredModalityToday: 'Cycling' }), objective: adverseGarmin },
      context: triathlonAdvancedContext,
      trainingIntentProfile: null,
      userPreferences: triathlonAdvancedPreferences,
      initialHistory: advancedHistory,
      event: triathlonEvent('half_iron', '2026-10-12'),
    }),
    makeScenario({
      id: 'persona_triathlon_advanced_half_iron_taper',
      label: 'Advanced triathlon persona — 70.3 distance, final 14-day taper window',
      persona: triathlonAdvancedPersona,
      readiness: { subjective: subjective({ readiness: 8, fatigue: 2, soreness: 2, motivation: 8, timeAvailable: 90, preferredModalityToday: 'Swimming' }), objective: neutralGarmin },
      context: triathlonAdvancedContext,
      trainingIntentProfile: null,
      userPreferences: triathlonAdvancedPreferences,
      initialHistory: advancedHistory,
      event: triathlonEvent('half_iron', '2026-09-14'),
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
    {
      familyId: 'persona_triathlon_novice_eighth',
      changedAxis: 'current recovery and pool availability for a novice 1/8-distance triathlon athlete',
      comparisonInstruction: 'Compare the same novice athlete across normal recovery, adverse recovery, and a pool-access loss. With access, the event-directed plan should preserve safe Swimming, Cycling and Running exposure. Without access, it must not fabricate swimming or bypass the access gate.',
      cases: noviceTriathlonCases,
    },
    {
      familyId: 'persona_triathlon_intermediate_olympic',
      changedAxis: 'current recovery and weekday capacity for an intermediate Olympic-distance triathlon athlete',
      comparisonInstruction: 'Compare the same established mixed-discipline athlete across normal recovery, adverse recovery, and a 45-minute weekday cap. The plan must preserve race relevance and hard feasibility without inventing a brick, swim pace anchor, or inaccessible session.',
      cases: intermediateTriathlonCases,
    },
    {
      familyId: 'persona_triathlon_advanced_half_iron',
      changedAxis: 'current recovery and race proximity for an advanced 70.3-distance triathlon athlete',
      comparisonInstruction: 'Compare normal and adverse recovery at the same event distance with a final-14-day taper case. Current history supports meaningful training but does not weaken recovery gates; near-race planning should show taper restraint rather than ordinary build volume.',
      cases: advancedTriathlonCases,
    },
  ];
}

export function assertPersonaFixtureIntegrity(families) {
  const failures = [];
  const allCases = families.flatMap((family) => family.cases);
  const ids = new Set();
  for (const definition of allCases) {
    const { scenario, persona } = definition;
    const isTriathlonPersona = persona.personaId.startsWith('triathlon_');
    if (ids.has(scenario.id)) failures.push(`Duplicate persona case id: ${scenario.id}`);
    ids.add(scenario.id);
    if (isTriathlonPersona) {
      if (scenario.event?.category !== 'triathlon' || (scenario.events ?? []).length !== 1) failures.push(`${scenario.id}: triathlon persona must carry exactly one triathlon event.`);
      if (scenario.event?.priority !== 'A') failures.push(`${scenario.id}: triathlon persona must carry an A-priority event.`);
      if (scenario.trainingIntentProfile !== null) failures.push(`${scenario.id}: triathlon persona must remain event-directed rather than forcing evergreen mode.`);
    } else {
      if (scenario.event !== null || (scenario.events ?? []).length !== 0) failures.push(`${scenario.id}: evergreen persona fixture must not carry an event.`);
      if (scenario.trainingIntentProfile?.planningMode !== 'evergreen') failures.push(`${scenario.id}: missing evergreen training intent.`);
    }
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

  const triathlonExpectations = [
    { personaId: 'triathlon_novice_eighth', preset: 'eighth_im', historyCount: 0 },
    { personaId: 'triathlon_intermediate_olympic', preset: 'olympic', historyCount: 12 },
    { personaId: 'triathlon_advanced_half_iron', preset: 'half_iron', historyCount: 18 },
  ];
  for (const expectation of triathlonExpectations) {
    const definitions = allCases.filter((item) => item.persona.personaId === expectation.personaId);
    if (definitions.length !== 3) failures.push(`${expectation.personaId}: expected exactly 3 cases, found ${definitions.length}.`);
    for (const definition of definitions) {
      const { scenario } = definition;
      if (scenario.event?.id !== `persona-triathlon-${expectation.preset}`) failures.push(`${scenario.id}: incorrect triathlon event preset.`);
      if (JSON.stringify(scenario.event?.demandProfile) !== JSON.stringify(TRIATHLON_DEMANDS[expectation.preset])) failures.push(`${scenario.id}: triathlon event demand profile drifted from its fixture preset.`);
      if (!scenario.context.trainingSettings.equipment.outdoor_bike) failures.push(`${scenario.id}: triathlon persona must declare outdoor bike access.`);
      const poolUnavailable = scenario.id === 'persona_triathlon_novice_eighth_pool_unavailable';
      if (scenario.context.trainingSettings.equipment.swim_access === poolUnavailable) failures.push(`${scenario.id}: unexpected pool-access state.`);
      if ((scenario.initialHistory ?? []).length !== expectation.historyCount) failures.push(`${scenario.id}: expected ${expectation.historyCount} seeded current-history exposures.`);
      for (const modality of ['Swimming', 'Cycling', 'Running']) {
        if (!scenario.preferences.preferredModalities.includes(modality)) failures.push(`${scenario.id}: missing ${modality} preference.`);
      }
    }
  }

  const advancedTaper = allCases.find((item) => item.scenario.id === 'persona_triathlon_advanced_half_iron_taper');
  if (advancedTaper?.scenario.event?.date !== '2026-09-14') failures.push('Advanced triathlon taper case must end at its 14-day event boundary.');

  if (failures.length) throw new Error(`Persona fixture integrity failed:\n- ${failures.join('\n- ')}`);
  return { familyCount: families.length, caseCount: allCases.length };
}
