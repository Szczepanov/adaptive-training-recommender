export function computeDerivedPlanFeatures(plan, inputContext = {}) {
  const days = Array.isArray(plan) ? plan : [];
  let totalPlannedDurationMin = 0;
  let cumulativeSystemicCost = 0;
  let cumulativeCardiovascularCost = 0;
  let cumulativeNeuromuscularCost = 0;
  let hardSessionCount = 0;
  let recoveryOrRestDayCount = 0;
  let maxSessionDurationMin = 0;

  const modalityDistribution = {};
  const categoryDistribution = {};
  const stimulusTotals = {
    aerobicEndurance: 0,
    thresholdPower: 0,
    vo2MaxPower: 0,
    repeatedSurges: 0,
    fatigueResistance: 0,
  };
  const requiredEquipmentSet = new Set();
  const restrictedViolations = [];

  const restrictedModalities = new Set(inputContext.constraints?.restrictedModalities ?? []);

  let currentConsecutiveHard = 0;
  let consecutiveHardDaysMax = 0;
  const hardSessionDates = [];
  const systemicByDate = [];

  for (const day of days) {
    const session = day.session ?? {};
    const duration = session.durationMin ?? session.durationMax ?? 0;
    totalPlannedDurationMin += duration;
    maxSessionDurationMin = Math.max(maxSessionDurationMin, duration);

    const systemic = session.systemicCost ?? session.costProfile?.systemic ?? 0;
    const cardio = session.costProfile?.cardiovascular ?? 0;
    const neuro = session.costProfile?.neuromuscular ?? 0;

    cumulativeSystemicCost += systemic;
    cumulativeCardiovascularCost += cardio;
    cumulativeNeuromuscularCost += neuro;
    if (day.date) systemicByDate.push({ date: day.date, systemic });

    const stim = session.stimulusProfile ?? {};
    stimulusTotals.aerobicEndurance += stim.aerobicEndurance ?? 0;
    stimulusTotals.thresholdPower += stim.thresholdPower ?? 0;
    stimulusTotals.vo2MaxPower += stim.vo2MaxPower ?? 0;
    stimulusTotals.repeatedSurges += stim.repeatedSurges ?? 0;
    stimulusTotals.fatigueResistance += stim.fatigueResistance ?? 0;

    // Modality & Category tracking
    const modality = session.modality || (systemic === 0 ? 'Rest' : 'Unknown');
    const category = session.category || (systemic === 0 ? 'Rest' : 'Uncategorized');

    modalityDistribution[modality] = (modalityDistribution[modality] ?? 0) + 1;
    categoryDistribution[category] = (categoryDistribution[category] ?? 0) + 1;

    if (restrictedModalities.has(modality)) {
      restrictedViolations.push({ date: day.date, modality, title: session.title });
    }

    for (const eq of session.requiredEquipment ?? []) {
      requiredEquipmentSet.add(eq);
    }

    const isHard = category === 'Hard Endurance' || category === 'Race-Specific Endurance' || systemic >= 0.6;
    const isRecoveryOrRest = category === 'Rest' || category === 'Mobility/Recovery';

    if (isHard) {
      hardSessionCount += 1;
      currentConsecutiveHard += 1;
      if (currentConsecutiveHard > consecutiveHardDaysMax) {
        consecutiveHardDaysMax = currentConsecutiveHard;
      }
      if (day.date) hardSessionDates.push(day.date);
    } else {
      currentConsecutiveHard = 0;
    }

    if (isRecoveryOrRest) {
      recoveryOrRestDayCount += 1;
    }
  }

  // Rolling-load and event-proximity features are descriptive only; they do not
  // become planner decision authority.
  const dayMs = 24 * 60 * 60 * 1000;
  let maxRolling3dSystemicCost = 0;
  for (const anchor of systemicByDate) {
    const anchorTime = new Date(anchor.date).getTime();
    const windowStart = anchorTime - 2 * dayMs;
    const rollingCost = systemicByDate
      .filter((item) => {
        const time = new Date(item.date).getTime();
        return time >= windowStart && time <= anchorTime;
      })
      .reduce((sum, item) => sum + item.systemic, 0);
    maxRolling3dSystemicCost = Math.max(maxRolling3dSystemicCost, rollingCost);
  }

  let daysFromLastHardSessionToEvent = null;
  let eventWeekHardSessionCount = null;
  let hardSessionsWithin48hOfEvent = null;
  const inputEvents = Array.isArray(inputContext.events) && inputContext.events.length > 0
    ? inputContext.events
    : (inputContext.event ? [inputContext.event] : []);
  const scheduledEvents = inputEvents.filter((event) => event?.date && !['cancelled', 'DNS'].includes(event.lifecycle));
  const eventDate = inputContext.event?.date ?? scheduledEvents[0]?.date;
  if (eventDate && hardSessionDates.length > 0) {
    const eventTime = new Date(eventDate).getTime();
    const hardTimesBeforeEvent = hardSessionDates
      .map((d) => new Date(d).getTime())
      .filter((t) => t <= eventTime);

    if (hardTimesBeforeEvent.length > 0) {
      const lastHardTime = Math.max(...hardTimesBeforeEvent);
      daysFromLastHardSessionToEvent = Math.round((eventTime - lastHardTime) / dayMs);
    }

    const sevenDaysBefore = eventTime - 7 * dayMs;
    eventWeekHardSessionCount = hardTimesBeforeEvent.filter((t) => t >= sevenDaysBefore && t < eventTime).length;
  }

  if (scheduledEvents.length > 0) {
    const qualifyingHardDates = new Set();
    for (const event of scheduledEvents) {
      const eventTime = new Date(event.date).getTime();
      const twoDaysBefore = eventTime - 2 * dayMs;
      for (const hardDate of hardSessionDates) {
        const hardTime = new Date(hardDate).getTime();
        if (hardTime >= twoDaysBefore && hardTime < eventTime) qualifyingHardDates.add(hardDate);
      }
    }
    hardSessionsWithin48hOfEvent = qualifyingHardDates.size;
  }

  return {
    totalPlannedDurationMin: Math.round(totalPlannedDurationMin),
    cumulativeSystemicCost: Math.round(cumulativeSystemicCost * 100) / 100,
    cumulativeCardiovascularCost: Math.round(cumulativeCardiovascularCost * 100) / 100,
    cumulativeNeuromuscularCost: Math.round(cumulativeNeuromuscularCost * 100) / 100,
    hardSessionCount,
    recoveryOrRestDayCount,
    maxSessionDurationMin: Math.round(maxSessionDurationMin),
    maxRolling3dSystemicCost: Math.round(maxRolling3dSystemicCost * 100) / 100,
    consecutiveHardDaysMax,
    modalityDistribution,
    categoryDistribution,
    stimulusTotals: {
      aerobicEndurance: Math.round(stimulusTotals.aerobicEndurance * 100) / 100,
      thresholdPower: Math.round(stimulusTotals.thresholdPower * 100) / 100,
      vo2MaxPower: Math.round(stimulusTotals.vo2MaxPower * 100) / 100,
      repeatedSurges: Math.round(stimulusTotals.repeatedSurges * 100) / 100,
      fatigueResistance: Math.round(stimulusTotals.fatigueResistance * 100) / 100,
    },
    requiredEquipmentUsed: [...requiredEquipmentSet].sort(),
    restrictedModalitiesViolated: restrictedViolations,
    daysFromLastHardSessionToEvent,
    eventWeekHardSessionCount,
    hardSessionsWithin48hOfEvent,
    scheduledEventCount: scheduledEvents.length,
  };
}
