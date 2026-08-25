export function computeDerivedPlanFeatures(plan, inputContext = {}) {
  const days = Array.isArray(plan) ? plan : [];
  let totalPlannedDurationMin = 0;
  let cumulativeSystemicCost = 0;
  let cumulativeCardiovascularCost = 0;
  let cumulativeNeuromuscularCost = 0;
  let hardSessionCount = 0;
  let recoveryOrRestDayCount = 0;

  const modalityDistribution = {};
  const categoryDistribution = {};
  const requiredEquipmentSet = new Set();
  const restrictedViolations = [];

  const restrictedModalities = new Set(inputContext.constraints?.restrictedModalities ?? []);

  let currentConsecutiveHard = 0;
  let consecutiveHardDaysMax = 0;
  const hardSessionDates = [];

  for (const day of days) {
    const session = day.session ?? {};
    const duration = session.durationMin ?? session.durationMax ?? 0;
    totalPlannedDurationMin += duration;

    const systemic = session.systemicCost ?? session.costProfile?.systemic ?? 0;
    const cardio = session.costProfile?.cardiovascular ?? 0;
    const neuro = session.costProfile?.neuromuscular ?? 0;

    cumulativeSystemicCost += systemic;
    cumulativeCardiovascularCost += cardio;
    cumulativeNeuromuscularCost += neuro;

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

    const isHard = systemic >= 0.6;
    const isRecoveryOrRest = systemic <= 0.25 || category.toLowerCase().includes('recovery') || modality === 'Rest';

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

  // Event proximity features
  let daysFromLastHardSessionToEvent = null;
  let eventWeekHardSessionCount = null;

  const eventDate = inputContext.event?.date;
  if (eventDate && hardSessionDates.length > 0) {
    const eventTime = new Date(eventDate).getTime();
    const hardTimesBeforeEvent = hardSessionDates
      .map((d) => new Date(d).getTime())
      .filter((t) => t <= eventTime);

    if (hardTimesBeforeEvent.length > 0) {
      const lastHardTime = Math.max(...hardTimesBeforeEvent);
      daysFromLastHardSessionToEvent = Math.round((eventTime - lastHardTime) / (1000 * 60 * 60 * 24));
    }

    const sevenDaysBefore = eventTime - 7 * 24 * 60 * 60 * 1000;
    eventWeekHardSessionCount = hardTimesBeforeEvent.filter((t) => t >= sevenDaysBefore && t < eventTime).length;
  }

  return {
    totalPlannedDurationMin: Math.round(totalPlannedDurationMin),
    cumulativeSystemicCost: Math.round(cumulativeSystemicCost * 100) / 100,
    cumulativeCardiovascularCost: Math.round(cumulativeCardiovascularCost * 100) / 100,
    cumulativeNeuromuscularCost: Math.round(cumulativeNeuromuscularCost * 100) / 100,
    hardSessionCount,
    recoveryOrRestDayCount,
    consecutiveHardDaysMax,
    modalityDistribution,
    categoryDistribution,
    requiredEquipmentUsed: [...requiredEquipmentSet].sort(),
    restrictedModalitiesViolated: restrictedViolations,
    daysFromLastHardSessionToEvent,
    eventWeekHardSessionCount,
  };
}
