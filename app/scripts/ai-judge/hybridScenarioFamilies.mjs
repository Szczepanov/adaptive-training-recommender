import { decayAcuteReadinessTowardBaseline, projectedRecoveryBaseline } from './readinessProjection.mjs';

/** Targeted evaluation cases sharing the active hybrid identity, not a second persona. */
export function buildHybridScenarioFamilies(hybridFamily) {
  const baseline = hybridFamily.cases.find(({ scenario }) => scenario.id === 'persona_cycling_hybrid_baseline');
  const adverse = hybridFamily.cases.find(({ scenario }) => scenario.id === 'persona_cycling_hybrid_adverse_recovery');
  if (!baseline || !adverse) throw new Error('Hybrid expansion requires the active baseline and adverse-recovery cases.');

  // A synthetic 28-day, 7-hour/week base: four 80-minute rides and two 50-minute
  // strength sessions per week. The older active fixture is deliberately untouched.
  // This is observed history, distinct from the larger future availability experiment.
  const currentHistory = Array.from({ length: 4 }, (_, week) =>
    Array.from({ length: 6 }, (_, day) => {
      const modality = day === 0 || day === 3 ? 'Strength' : 'Cycling';
      const exposure = structuredClone(baseline.scenario.initialHistory.find((item) => item.modality === modality));
      const date = `2026-08-${String(3 + week * 7 + day).padStart(2, '0')}`;
      return {
        ...exposure, date, occurrenceKey: `synthetic-hybrid-current:${date}`,
        trainingRecordLike: { ...exposure.trainingRecordLike, duration_min: modality === 'Cycling' ? 80 : 50 },
      };
    })).flat();

  function makeCase(suffix, label, source = baseline) {
    const readiness = structuredClone(source.scenario.readinessForWeek(0));
    readiness.subjective.timeAvailable = baseline.scenario.readinessForWeek(0).subjective.timeAvailable;
    const projectedBaseline = projectedRecoveryBaseline(readiness);
    const { readinessForWeek: _week, readinessForDate: _date, ...data } = source.scenario;
    const scenario = structuredClone(data);
    scenario.id = `persona_cycling_hybrid_${suffix}`;
    scenario.label = label;
    scenario.tags = [...scenario.tags, 'hybrid-expansion'];
    scenario.initialHistory = structuredClone(currentHistory);
    scenario.readinessForWeek = (week = 0) => decayAcuteReadinessTowardBaseline(readiness, projectedBaseline, week * 7);
    scenario.readinessForDate = (_date, week = 0) => decayAcuteReadinessTowardBaseline(readiness, projectedBaseline, week * 7);
    const persona = structuredClone(source.persona);
    persona.constraintContext = 'Free weights and outdoor bicycle access; exact equipment and day-specific limits are supplied in trainingSettings. No cable machine. Running is optional.';
    scenario.context.constraints.hasCableMachine = false;
    scenario.context.trainingSettings.equipment.cable_machine = false;
    return { persona, scenario };
  }

  function withCapacity(definition, weekday, weekend) {
    const { scenario } = definition;
    scenario.context.constraints.maxTimeMinutes = Math.max(weekday, weekend);
    scenario.context.trainingSettings.defaults.weekdayMaxMinutes = weekday;
    scenario.context.trainingSettings.defaults.weekendMaxMinutes = weekend;
    scenario.preferences.defaultWeekdayTimeMin = weekday;
    scenario.preferences.defaultWeekendTimeMin = weekend;
    const readiness = scenario.readinessForWeek(0);
    readiness.subjective.timeAvailable = weekday;
    const projectedBaseline = projectedRecoveryBaseline(readiness);
    scenario.readinessForWeek = (week = 0) => decayAcuteReadinessTowardBaseline(readiness, projectedBaseline, week * 7);
    scenario.readinessForDate = (_date, week = 0) => decayAcuteReadinessTowardBaseline(readiness, projectedBaseline, week * 7);
    return definition;
  }

  function withReadiness(definition, subjectiveOverrides) {
    const { scenario } = definition;
    const readiness = structuredClone(scenario.readinessForWeek(0));
    readiness.subjective = { ...readiness.subjective, ...subjectiveOverrides };
    const projectedBaseline = projectedRecoveryBaseline(readiness);
    scenario.readinessForWeek = (week = 0) => decayAcuteReadinessTowardBaseline(readiness, projectedBaseline, week * 7);
    scenario.readinessForDate = (_date, week = 0) => decayAcuteReadinessTowardBaseline(readiness, projectedBaseline, week * 7);
    return definition;
  }

  function withGuardrails(definition, guardrails) {
    const { scenario } = definition;
    scenario.context.constraints.impliedGuardrails = [...guardrails];
    for (const key of Object.keys(scenario.context.trainingSettings.guardrails)) {
      scenario.context.trainingSettings.guardrails[key] = guardrails.includes(key);
    }
    return definition;
  }

  function asReentryState(definition) {
    definition.scenario.startDate = '2026-09-04';
    definition.scenario.tags = [...definition.scenario.tags, 'tissue-reentry'];
    return definition;
  }

  const reference = makeCase('capacity_reference', 'Hybrid capacity — reference availability');
  const moreTime = withCapacity(makeCase('more_time', 'Hybrid capacity — more time, unchanged observed training'), 180, 180);
  const shortWeekends = withCapacity(makeCase('short_weekends', 'Hybrid capacity — 90-minute weekdays, 20-minute weekend stress case'), 90, 20);
  const outdoorOnly = makeCase('outdoor_only', 'Hybrid equipment — outdoor bicycle, no indoor bicycle');
  outdoorOnly.scenario.context.constraints.hasIndoorBike = false;
  outdoorOnly.scenario.context.trainingSettings.equipment.indoor_bike = false;
  outdoorOnly.persona.constraintContext += ' An airbike is not modeled as indoor-bicycle access or as a source of bicycle FTP.';

  // Tissue re-entry is modeled as matched counterfactual states, not as a diagnosis and
  // not as an assumption that a future day will automatically clear symptoms. Moving the
  // start date past the last synthetic strength exposure makes the weekly strength role
  // genuinely open in every case while identity/history/commitment remain identical.
  const reentryActive = asReentryState(withGuardrails(withReadiness(
    makeCase('reentry_active_back_guardrail', 'Hybrid tissue re-entry — active lumbar-loading guardrail'),
    { readiness: 6, fatigue: 3, soreness: 5, motivation: 8, timeAvailable: 75, painFlag: true, preferredModalityToday: 'Cycling' },
  ), ['avoid_heavy_spinal_loading']));
  const reentryPending = asReentryState(withGuardrails(withReadiness(
    makeCase('reentry_pending_recheck', 'Hybrid tissue re-entry — good recovery but restriction still pending re-check'),
    { readiness: 8, fatigue: 2, soreness: 2, motivation: 9, timeAvailable: 75, painFlag: false, preferredModalityToday: 'Cycling' },
  ), ['avoid_heavy_spinal_loading']));
  const reentrySettled = asReentryState(withReadiness(
    makeCase('reentry_settled', 'Hybrid tissue re-entry — explicit settled state restores normal strength planning'),
    { readiness: 8, fatigue: 2, soreness: 2, motivation: 9, timeAvailable: 75, painFlag: false, preferredModalityToday: 'Cycling' },
  ));
  const reentryStackedFallback = asReentryState(withGuardrails(withReadiness(
    makeCase('reentry_stacked_guardrail_fallback', 'Hybrid tissue re-entry — spinal and overhead guardrails require low-load strength support'),
    { readiness: 7, fatigue: 3, soreness: 3, motivation: 8, timeAvailable: 75, painFlag: false, preferredModalityToday: 'Strength' },
  ), ['avoid_heavy_spinal_loading', 'avoid_overhead_pressing']));

  // Synthetic dates, not the athlete's actual race calendar. Keep the two-week taper
  // horizon entirely before race day, with an explicit authored taper boundary.
  const buildEvent = {
    id: 'synthetic-hybrid-road-event', title: 'Synthetic road cycling A event',
    date: '2026-10-26', category: 'cycling_event', priority: 'A', lifecycle: 'scheduled',
    demandProfile: {
      aerobicEndurance: 0.8, thresholdPower: 0.75, vo2MaxPower: 0.4,
      repeatedSurges: 0.6, sprintPower: 0.3, fatigueResistance: 0.8, neuromuscular: 0.3,
    },
  };
  function withEvent(definition, event) {
    definition.scenario.event = structuredClone(event);
    definition.scenario.events = [structuredClone(event)];
    definition.scenario.trainingIntentProfile.planningMode = 'event_directed';
    return definition;
  }
  const eventBuild = withEvent(makeCase('event_build', 'Hybrid event — cycling build with strength retention'), buildEvent);
  const eventAdverse = withEvent(makeCase('event_adverse', 'Hybrid event — same build, adverse recovery', adverse), buildEvent);
  const eventTaper = withEvent(makeCase('event_taper', 'Hybrid event — explicit 14-day taper'), {
    ...buildEvent, date: '2026-09-14', taper: { startDate: '2026-08-31' },
  });

  return [
    {
      familyId: 'persona_hybrid_capacity_equipment',
      changedAxis: 'available time, weekday/weekend distribution, or indoor bicycle access; unchanged athlete history and commitment',
      comparisonInstruction: 'Compare the same hybrid athlete with reference capacity, more available time, short weekends, and outdoor-only bicycle access. Availability is not evidence of greater physiological capacity. Check actual per-day limits and equipment; preserve cycling relevance and feasible strength retention without inventing an airbike-to-bicycle power equivalence. The single-session-per-date harness does not prove AM/PM support or long-term adaptation.',
      cases: [reference, moreTime, shortWeekends, outdoorOnly],
    },
    {
      familyId: 'persona_hybrid_event_lifecycle',
      changedAxis: 'recovery or event proximity under explicit event-directed planning for the same hybrid athlete',
      comparisonInstruction: 'Compare a cycling A-event build, the same build with adverse recovery, and an explicitly authored taper. Recovery must constrain the event plan. Retain feasible supporting strength in build; taper should remove fatigue without inventing new developmental work. The event date and authored taper boundary are synthetic explicit inputs, not inferred from the persona.',
      cases: [eventBuild, eventAdverse, eventTaper],
    },
    {
      familyId: 'persona_hybrid_tissue_reentry',
      changedAxis: 'local lumbar/shoulder guardrail state after interrupted training; unchanged athlete identity, history, weekly commitment and favorable global recovery',
      comparisonInstruction: 'Compare matched tissue-re-entry states for the same cycling-primary hybrid athlete. An active or pending local restriction must continue to constrain incompatible loading even when wearable recovery is favorable. A settled state should restore a feasible exact primary-strength opportunity. When spinal and overhead guardrails block exact full-body strength, a symptom-compatible low-load strength session may preserve resistance exposure, but it must not be credited as completion of the exact primary-strength weekly role.',
      cases: [reentryActive, reentryPending, reentrySettled, reentryStackedFallback],
    },
  ];
}

/** Guard the intended counterfactuals before running either deterministic or AI evaluation. */
export function assertHybridScenarioIntegrity(families, hybridFamily) {
  const expansion = families.filter(({ familyId }) => familyId.startsWith('persona_hybrid_'));
  if (!expansion.length) return;
  const expected = new Map([
    ['persona_hybrid_capacity_equipment', 4],
    ['persona_hybrid_event_lifecycle', 3],
    ['persona_hybrid_tissue_reentry', 4],
  ]);
  if (expansion.length !== expected.size) throw new Error('Hybrid expansion requires all targeted comparison families.');
  const baseline = hybridFamily.cases.find(({ scenario }) => scenario.id === 'persona_cycling_hybrid_baseline');
  const reference = expansion.find(({ familyId }) => familyId === 'persona_hybrid_capacity_equipment')?.cases[0]?.scenario;
  for (const family of expansion) {
    if (family.cases.length !== expected.get(family.familyId)) throw new Error(`Unexpected hybrid case count: ${family.familyId}`);
    for (const { persona, scenario } of family.cases) {
      if (persona.personaId !== baseline.persona.personaId
        || JSON.stringify(scenario.initialHistory) !== JSON.stringify(reference?.initialHistory)
        || JSON.stringify(scenario.trainingIntentProfile.weeklyCommitment) !== JSON.stringify(baseline.scenario.trainingIntentProfile.weeklyCommitment)) {
        throw new Error(`${scenario.id}: hybrid perturbations must preserve identity, observed history and commitment.`);
      }
      if (scenario.initialHistory.length !== 24
        || scenario.initialHistory.reduce((sum, item) => sum + item.trainingRecordLike.duration_min, 0) !== 1680) {
        throw new Error(`${scenario.id}: hybrid expansion requires the synthetic 28-day, seven-hour weekly base.`);
      }
      if (scenario.context.trainingSettings.equipment.cable_machine || scenario.context.constraints.hasCableMachine) {
        throw new Error(`${scenario.id}: hybrid home-gym fixture cannot acquire cable access.`);
      }
      const eventDirected = family.familyId === 'persona_hybrid_event_lifecycle';
      if (scenario.trainingIntentProfile.planningMode !== (eventDirected ? 'event_directed' : 'evergreen')
        || (eventDirected ? scenario.event?.category !== 'cycling_event' : scenario.event !== null)) {
        throw new Error(`${scenario.id}: hybrid family planning authority mismatch.`);
      }
      if (family.familyId === 'persona_hybrid_tissue_reentry' && scenario.startDate !== '2026-09-04') {
        throw new Error(`${scenario.id}: tissue-reentry cases must share the post-interruption start date.`);
      }
    }
  }
}
