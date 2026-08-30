import {
  assertPersonaFixtureIntegrity as assertCatalogIntegrity,
  buildPersonaFamilies as buildCatalogFamilies,
} from './personaScenarios.mjs';

const ACTIVE_TRIATHLON_FAMILY_ID = 'persona_triathlon_established_olympic';
const ACTIVE_TRIATHLON_PERSONA_ID = 'triathlon_established_olympic';
const CYCLING_HYBRID_FAMILY_ID = 'persona_cycling_primary_hybrid';
const CYCLING_HYBRID_PERSONA_ID = 'cycling_primary_hybrid_advanced';

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function requireFamily(families, familyId) {
  const family = families.find((candidate) => candidate.familyId === familyId);
  if (!family) throw new Error(`Persona catalog is missing required family: ${familyId}`);
  return family;
}

function requireCase(family, caseId) {
  const definition = family.cases.find((candidate) => candidate.scenario.id === caseId);
  if (!definition) throw new Error(`Persona catalog family ${family.familyId} is missing required case: ${caseId}`);
  return definition;
}

function staticReadiness(readiness) {
  const snapshot = clone(readiness);
  return {
    readinessForWeek: () => clone(snapshot),
    readinessForDate: () => clone(snapshot),
  };
}

function buildActiveTriathlonFamily(catalogFamilies) {
  const noviceFamily = requireFamily(catalogFamilies, 'persona_triathlon_novice_eighth');
  const intermediateFamily = requireFamily(catalogFamilies, 'persona_triathlon_intermediate_olympic');
  const advancedFamily = requireFamily(catalogFamilies, 'persona_triathlon_advanced_half_iron');

  const baselineSource = requireCase(intermediateFamily, 'persona_triathlon_intermediate_olympic_baseline');
  const adverseSource = requireCase(intermediateFamily, 'persona_triathlon_intermediate_olympic_adverse_recovery');
  const shortTimeSource = requireCase(intermediateFamily, 'persona_triathlon_intermediate_olympic_short_time');
  const poolLossSource = requireCase(noviceFamily, 'persona_triathlon_novice_eighth_pool_unavailable');
  const taperSource = requireCase(advancedFamily, 'persona_triathlon_advanced_half_iron_taper');

  const persona = {
    ...clone(baselineSource.persona),
    personaId: ACTIVE_TRIATHLON_PERSONA_ID,
    primaryGoal: 'prepare for an Olympic-distance triathlon from an established current mixed-discipline base',
    currentTrainingIdentity: 'established recreational triathlete with current swimming, cycling and running exposure',
    judgeExpectations: [
      'Use recent mixed-discipline history as current capacity evidence, but never as permission to override adverse recovery.',
      'Preserve Swimming, Cycling and Running when access exists; if pool access disappears, do not fabricate swimming or claim another modality fully substitutes for it.',
      'A short weekday window should reduce dose while preserving event relevance and hard feasibility.',
      'In the final 14 days before the A-event, show taper restraint rather than ordinary build volume.',
      'Do not invent brick requirements, swim pace/CSS anchors, open-water competence, or specialist long-course assumptions that are absent from the modeled evidence.',
    ],
  };

  const baseEvent = clone(baselineSource.scenario.event);
  const baseContext = clone(baselineSource.scenario.context);
  const basePreferences = clone(baselineSource.scenario.preferences);
  const baseHistory = clone(baselineSource.scenario.initialHistory);

  function normalizeCase(source, { id, label, context = baseContext, event = baseEvent, readiness } = {}) {
    const normalizedEvent = clone(event);
    const scenario = {
      ...source.scenario,
      id,
      label,
      description: `Synthetic persona evaluation case for ${ACTIVE_TRIATHLON_PERSONA_ID}. No real person's name or identifying data is persisted.`,
      context: clone(context),
      event: normalizedEvent,
      events: normalizedEvent ? [clone(normalizedEvent)] : [],
      trainingIntentProfile: null,
      preferences: clone(basePreferences),
      initialHistory: clone(baseHistory),
      tags: ['ai-plan-judge', 'persona-evaluation', ACTIVE_TRIATHLON_PERSONA_ID],
      ...(readiness ? staticReadiness(readiness) : {}),
    };
    return { persona: clone(persona), scenario };
  }

  const poolUnavailableContext = clone(baseContext);
  poolUnavailableContext.trainingSettings.equipment.swim_access = false;

  const taperEvent = clone(baseEvent);
  taperEvent.date = '2026-09-14';

  return {
    familyId: ACTIVE_TRIATHLON_FAMILY_ID,
    changedAxis: 'recovery, pool access, weekday capacity, and race proximity for one established Olympic-distance triathlete',
    comparisonInstruction: 'Compare one established Olympic-distance triathlete across normal recovery, adverse recovery, pool-access loss, a 45-minute weekday cap, and the final 14-day taper window. Current training history supports meaningful work but never weakens recovery or equipment gates; all three race disciplines remain distinct requirements when access exists.',
    cases: [
      normalizeCase(baselineSource, {
        id: 'persona_triathlon_established_olympic_baseline',
        label: 'Established triathlon persona — Olympic distance, normal recovery',
      }),
      normalizeCase(adverseSource, {
        id: 'persona_triathlon_established_olympic_adverse_recovery',
        label: 'Established triathlon persona — Olympic distance, adverse recovery',
      }),
      normalizeCase(poolLossSource, {
        id: 'persona_triathlon_established_olympic_pool_unavailable',
        label: 'Established triathlon persona — Olympic distance, pool unavailable',
        context: poolUnavailableContext,
        readiness: poolLossSource.scenario.readinessForWeek(0),
      }),
      normalizeCase(shortTimeSource, {
        id: 'persona_triathlon_established_olympic_short_time',
        label: 'Established triathlon persona — Olympic distance, 45-minute weekday cap',
      }),
      normalizeCase(taperSource, {
        id: 'persona_triathlon_established_olympic_taper',
        label: 'Established triathlon persona — Olympic distance, final 14-day taper window',
        event: taperEvent,
        readiness: taperSource.scenario.readinessForWeek(0),
      }),
    ],
  };
}

function buildCyclingPrimaryHybridFamily(catalogFamilies) {
  const balancedFamily = requireFamily(catalogFamilies, 'persona_balanced_performance');
  const establishedFamily = requireFamily(catalogFamilies, 'persona_established_history');
  const triathlonFamily = requireFamily(catalogFamilies, 'persona_triathlon_intermediate_olympic');

  const balancedBaseline = requireCase(balancedFamily, 'persona_balanced_performance_baseline');
  const establishedBaseline = requireCase(establishedFamily, 'persona_established_history_baseline');
  const triathlonBaseline = requireCase(triathlonFamily, 'persona_triathlon_intermediate_olympic_baseline');
  const triathlonAdverse = requireCase(triathlonFamily, 'persona_triathlon_intermediate_olympic_adverse_recovery');

  const context = clone(balancedBaseline.scenario.context);
  context.goals = {
    shortTerm: 'Improve cycling performance while retaining meaningful strength and muscle with sustainable recovery.',
    midTerm: 'Build aerobic durability and cycling-specific quality without allowing secondary training to compromise key cycling work.',
    longTerm: 'Become a stronger, faster and durable cyclist while preserving general athletic capability and improving body composition gradually.',
  };
  context.constraints.hasFreeWeights = true;
  context.constraints.hasIndoorBike = true;
  context.constraints.maxTimeMinutes = 90;
  context.constraints.restrictedModalities = [];
  context.preferences.preferredModalities = ['Cycling', 'Strength'];
  context.preferences.deprioritizedModalities = ['Running'];
  context.trainingSettings.equipment.free_weights = true;
  context.trainingSettings.equipment.indoor_bike = true;
  context.trainingSettings.equipment.outdoor_bike = true;
  context.trainingSettings.equipment.swim_access = false;
  context.trainingSettings.defaults.weekdayMaxMinutes = 90;
  context.trainingSettings.defaults.weekendMaxMinutes = 120;

  const intent = clone(balancedBaseline.scenario.trainingIntentProfile);
  intent.priorities = ['endurance', 'strength_muscle'];
  intent.weeklyCommitment = { minSessions: 5, targetSessions: 6, maxSessions: 7 };

  const preferences = clone(balancedBaseline.scenario.preferences);
  preferences.defaultWeekdayTimeMin = 90;
  preferences.defaultWeekendTimeMin = 120;
  preferences.preferredModalities = ['Cycling', 'Strength'];
  preferences.deprioritizedModalities = ['Running'];

  // Keep the fixture's observed history aligned with the identity the judge is asked to
  // evaluate. A cycling-primary hybrid can be cycling-dominant without erasing recent
  // resistance exposure from the evidence available to the planner.
  const strengthHistoryIndexes = new Set([2, 5, 8, 11]);
  const cyclingQualityIndexes = new Set([3, 7]);
  const currentHistory = clone(establishedBaseline.scenario.initialHistory).map((exposure, index) => {
    if (strengthHistoryIndexes.has(index)) {
      return {
        ...exposure,
        occurrenceKey: `persona-cycling-hybrid-${index}`,
        modality: 'Strength',
        category: 'Full-body Strength',
        costProfile: {
          systemic: 0.35,
          cardiovascular: 0.12,
          lowerBody: 0.42,
          upperBody: 0.32,
          impactTissue: 0.02,
          neuromuscular: 0.42,
        },
        trainingRecordLike: {
          ...exposure.trainingRecordLike,
          type: 'Full-body resistance training',
          duration_min: 50,
          training_effect: 2,
          intensity_tag: 'moderate',
        },
      };
    }

    const isQuality = cyclingQualityIndexes.has(index);
    return {
      ...exposure,
      occurrenceKey: `persona-cycling-hybrid-${index}`,
      modality: 'Cycling',
      category: isQuality ? 'Tempo' : 'Easy Endurance',
      costProfile: isQuality
        ? {
            systemic: 0.45,
            cardiovascular: 0.58,
            lowerBody: 0.3,
            upperBody: 0,
            impactTissue: 0.03,
            neuromuscular: 0.16,
          }
        : {
            systemic: 0.25,
            cardiovascular: 0.35,
            lowerBody: 0.2,
            upperBody: 0,
            impactTissue: 0.03,
            neuromuscular: 0.08,
          },
      trainingRecordLike: {
        ...exposure.trainingRecordLike,
        type: isQuality ? 'Cycling tempo endurance' : 'Cycling aerobic endurance',
        duration_min: 60,
        training_effect: isQuality ? 3 : 2,
        intensity_tag: isQuality ? 'moderate' : 'easy',
      },
    };
  });

  const persona = {
    personaId: CYCLING_HYBRID_PERSONA_ID,
    dataAvailability: 'garmin_plus_subjective_checkin',
    primaryGoal: 'maximize cycling performance while retaining strength, muscle and broad athletic capability',
    currentTrainingIdentity: 'established cycling-primary hybrid athlete with a current aerobic base and regular resistance training',
    goalHierarchy: 'cycling performance is primary; strength and muscle are retention goals; body-composition progress must not compromise key training',
    constraintContext: 'high training willingness and access to indoor/outdoor cycling plus free weights; running is secondary rather than required',
    judgeExpectations: [
      'When goals compete, protect key cycling adaptation first while retaining enough resistance training to preserve strength and muscle.',
      'Good wearable readiness must not override active pain or mechanical guardrails; local symptom evidence is decision-relevant even when HRV, sleep and resting heart rate look favorable.',
      'Prefer cycling-specific aerobic work over unnecessary running when both satisfy endurance development and cycling is the declared primary sport.',
      'Adverse recovery should reduce near-term training cost without erasing the longer-horizon requirement for both cycling and resistance exposure.',
      'A strength preference today is a soft preference, not authority to turn the week into strength-primary programming.',
      'More available training time is not automatically a reason to add another hard session; inexpensive aerobic volume is preferable to gratuitous intensity when progression is otherwise appropriate.',
    ],
  };

  function readinessFrom(definition, subjectiveOverrides = {}, objectiveOverrides = {}) {
    const readiness = clone(definition.scenario.readinessForWeek(0));
    readiness.subjective = { ...readiness.subjective, ...subjectiveOverrides };
    readiness.objective = { ...readiness.objective, ...objectiveOverrides };
    return readiness;
  }

  function makeCase({ id, label, readiness, caseContext = context }) {
    return {
      persona: clone(persona),
      scenario: {
        ...balancedBaseline.scenario,
        id,
        label,
        description: `Synthetic persona evaluation case for ${CYCLING_HYBRID_PERSONA_ID}. No real person's name or identifying data is persisted.`,
        context: clone(caseContext),
        event: null,
        events: [],
        trainingIntentProfile: clone(intent),
        preferences: clone(preferences),
        initialHistory: clone(currentHistory),
        fixedActivities: [],
        tags: ['ai-plan-judge', 'persona-evaluation', CYCLING_HYBRID_PERSONA_ID],
        weeks: 2,
        ...staticReadiness(readiness),
      },
    };
  }

  const tissueConflictContext = clone(context);
  tissueConflictContext.constraints.impliedGuardrails = ['avoid_high_impact', 'avoid_heavy_lower_body'];
  tissueConflictContext.trainingSettings.guardrails.avoid_high_impact = true;
  tissueConflictContext.trainingSettings.guardrails.avoid_heavy_lower_body = true;

  const lowTimeContext = clone(context);
  lowTimeContext.constraints.maxTimeMinutes = 35;
  lowTimeContext.trainingSettings.defaults.weekdayMaxMinutes = 35;

  const baselineReadiness = readinessFrom(triathlonBaseline, {
    readiness: 8,
    fatigue: 2,
    soreness: 2,
    motivation: 9,
    timeAvailable: 90,
    painFlag: false,
    preferredModalityToday: 'Cycling',
  });
  const adverseReadiness = readinessFrom(triathlonAdverse, {
    readiness: 4,
    fatigue: 7,
    soreness: 5,
    motivation: 7,
    timeAvailable: 75,
    painFlag: false,
    preferredModalityToday: 'Cycling',
  });
  const tissueConflictReadiness = readinessFrom(
    triathlonBaseline,
    {
      readiness: 6,
      fatigue: 3,
      soreness: 6,
      motivation: 8,
      timeAvailable: 75,
      painFlag: true,
      preferredModalityToday: 'Cycling',
    },
    {
      sleep_score: 92,
      sleep_duration_min: 500,
      rhr: 54,
      rhr_delta: -4,
      hrv_last_night: 51,
      hrv_delta: 9,
      body_battery_wake: 88,
      sleep_score_delta_7d: 10,
    },
  );
  const strengthPreferenceReadiness = readinessFrom(triathlonBaseline, {
    readiness: 8,
    fatigue: 2,
    soreness: 2,
    motivation: 9,
    timeAvailable: 90,
    painFlag: false,
    preferredModalityToday: 'Strength',
  });
  const lowTimeReadiness = readinessFrom(triathlonBaseline, {
    readiness: 8,
    fatigue: 2,
    soreness: 2,
    motivation: 9,
    timeAvailable: 35,
    painFlag: false,
    preferredModalityToday: 'Cycling',
  });

  return {
    familyId: CYCLING_HYBRID_FAMILY_ID,
    changedAxis: 'recovery, local mechanical constraint, today-specific modality preference, and time availability for a cycling-primary hybrid athlete',
    comparisonInstruction: 'Compare one established cycling-primary hybrid athlete across normal recovery, adverse recovery, a genuinely favorable-wearable/local-tissue conflict, a strength preference today, and a short training window. Cycling remains the primary performance objective, resistance training remains a real retention requirement backed by observed history, and active pain/guardrails outrank favorable wearable readiness.',
    cases: [
      makeCase({ id: 'persona_cycling_hybrid_baseline', label: 'Cycling-primary hybrid persona — normal recovery', readiness: baselineReadiness }),
      makeCase({ id: 'persona_cycling_hybrid_adverse_recovery', label: 'Cycling-primary hybrid persona — adverse recovery', readiness: adverseReadiness }),
      makeCase({ id: 'persona_cycling_hybrid_local_tissue_conflict', label: 'Cycling-primary hybrid persona — favorable wearable signals with active local-tissue guardrails', readiness: tissueConflictReadiness, caseContext: tissueConflictContext }),
      makeCase({ id: 'persona_cycling_hybrid_strength_preference', label: 'Cycling-primary hybrid persona — strength preference today', readiness: strengthPreferenceReadiness }),
      makeCase({ id: 'persona_cycling_hybrid_low_time', label: 'Cycling-primary hybrid persona — 35-minute training window', readiness: lowTimeReadiness, caseContext: lowTimeContext }),
    ],
  };
}

export function buildPersonaFamilies() {
  const catalogFamilies = buildCatalogFamilies();
  assertCatalogIntegrity(catalogFamilies);

  const nonTriathlonFamilies = catalogFamilies.filter((family) => !family.familyId.startsWith('persona_triathlon_'));
  return [
    ...nonTriathlonFamilies,
    buildCyclingPrimaryHybridFamily(catalogFamilies),
    buildActiveTriathlonFamily(catalogFamilies),
  ];
}

export function assertPersonaFixtureIntegrity(families) {
  const failures = [];
  const allCases = families.flatMap((family) => family.cases);
  const caseIds = new Set();

  for (const definition of allCases) {
    const { scenario, persona } = definition;
    if (caseIds.has(scenario.id)) failures.push(`Duplicate active persona case id: ${scenario.id}`);
    caseIds.add(scenario.id);

    const serialized = JSON.stringify({ persona, label: scenario.label, description: scenario.description }).toLowerCase();
    for (const realName of ['adrian', 'rafal', 'rafał', 'ola', 'aleksandra', 'marcin']) {
      if (serialized.includes(realName)) failures.push(`${scenario.id}: active public fixture contains a real-person name (${realName}).`);
    }
  }

  const triathlonFamilies = families.filter((family) => family.familyId.startsWith('persona_triathlon_'));
  if (triathlonFamilies.length !== 1) failures.push(`Active suite must expose exactly one triathlon persona family, found ${triathlonFamilies.length}.`);
  const triathlon = triathlonFamilies[0];
  if (triathlon?.familyId !== ACTIVE_TRIATHLON_FAMILY_ID) failures.push(`Unexpected active triathlon family: ${triathlon?.familyId ?? 'missing'}.`);
  if (triathlon?.cases.length !== 5) failures.push(`Active triathlon persona must have exactly 5 state cases, found ${triathlon?.cases.length ?? 0}.`);
  for (const definition of triathlon?.cases ?? []) {
    const { scenario, persona } = definition;
    if (persona.personaId !== ACTIVE_TRIATHLON_PERSONA_ID) failures.push(`${scenario.id}: active triathlon case drifted to persona ${persona.personaId}.`);
    if (scenario.event?.category !== 'triathlon' || scenario.event?.priority !== 'A') failures.push(`${scenario.id}: active triathlon case must carry an A-priority triathlon event.`);
    if (scenario.trainingIntentProfile !== null) failures.push(`${scenario.id}: active triathlon case must remain event-directed.`);
    if (!scenario.context.trainingSettings.equipment.outdoor_bike) failures.push(`${scenario.id}: active triathlon case must retain outdoor bike access.`);
    if ((scenario.initialHistory ?? []).length !== 12) failures.push(`${scenario.id}: active triathlon case must retain the same 12-exposure current base.`);
    for (const modality of ['Swimming', 'Cycling', 'Running']) {
      if (!scenario.preferences.preferredModalities.includes(modality)) failures.push(`${scenario.id}: active triathlon case is missing ${modality} preference.`);
    }
  }
  const poolUnavailable = triathlon?.cases.find((definition) => definition.scenario.id === 'persona_triathlon_established_olympic_pool_unavailable');
  if (poolUnavailable?.scenario.context.trainingSettings.equipment.swim_access !== false) failures.push('Active triathlon pool-loss case must set swim_access=false.');
  const taper = triathlon?.cases.find((definition) => definition.scenario.id === 'persona_triathlon_established_olympic_taper');
  if (taper?.scenario.event?.date !== '2026-09-14') failures.push('Active triathlon taper case must place the A-event at the 14-day boundary.');

  const cyclingHybrid = families.find((family) => family.familyId === CYCLING_HYBRID_FAMILY_ID);
  if (!cyclingHybrid) failures.push('Active suite is missing the cycling-primary hybrid persona.');
  if (cyclingHybrid?.cases.length !== 5) failures.push(`Cycling-primary hybrid persona must have exactly 5 state cases, found ${cyclingHybrid?.cases.length ?? 0}.`);
  for (const definition of cyclingHybrid?.cases ?? []) {
    const { scenario, persona } = definition;
    if (persona.personaId !== CYCLING_HYBRID_PERSONA_ID) failures.push(`${scenario.id}: cycling-primary hybrid case drifted to persona ${persona.personaId}.`);
    if (scenario.event !== null || (scenario.events ?? []).length !== 0) failures.push(`${scenario.id}: cycling-primary hybrid must remain evergreen.`);
    if (scenario.trainingIntentProfile?.planningMode !== 'evergreen') failures.push(`${scenario.id}: cycling-primary hybrid must carry evergreen training intent.`);
    if (!scenario.trainingIntentProfile?.priorities.includes('endurance') || !scenario.trainingIntentProfile?.priorities.includes('strength_muscle')) failures.push(`${scenario.id}: cycling-primary hybrid must preserve endurance and strength_muscle priorities.`);
    if (!scenario.preferences.preferredModalities.includes('Cycling') || !scenario.preferences.preferredModalities.includes('Strength')) failures.push(`${scenario.id}: cycling-primary hybrid must prefer Cycling and Strength.`);

    const history = scenario.initialHistory ?? [];
    const cyclingCount = history.filter((item) => item.modality === 'Cycling').length;
    const strengthCount = history.filter((item) => item.modality === 'Strength').length;
    if (history.length !== 12 || cyclingCount !== 8 || strengthCount !== 4) failures.push(`${scenario.id}: cycling-primary hybrid must seed a 12-exposure cycling-dominant mixed history (8 Cycling, 4 Strength).`);
  }
  const tissueConflict = cyclingHybrid?.cases.find((definition) => definition.scenario.id === 'persona_cycling_hybrid_local_tissue_conflict');
  const tissueReadiness = tissueConflict?.scenario.readinessForWeek(0);
  if (!tissueReadiness?.subjective.painFlag) failures.push('Cycling-primary hybrid local-tissue case must set painFlag=true.');
  if (!(tissueReadiness?.objective.hrv_delta > 0) || !(tissueReadiness?.objective.rhr_delta < 0) || !(tissueReadiness?.objective.sleep_score >= 90) || !(tissueReadiness?.objective.body_battery_wake >= 80)) {
    failures.push('Cycling-primary hybrid local-tissue case must contain clearly favorable wearable signals so symptom-over-wearable arbitration is actually exercised.');
  }
  for (const guardrail of ['avoid_high_impact', 'avoid_heavy_lower_body']) {
    if (!(tissueConflict?.scenario.context.constraints.impliedGuardrails ?? []).includes(guardrail)) failures.push(`Cycling-primary hybrid local-tissue case must activate ${guardrail}.`);
  }

  if (failures.length) throw new Error(`Active persona suite integrity failed:\
- ${failures.join('\
- ')}`);
  return { familyCount: families.length, caseCount: allCases.length };
}
