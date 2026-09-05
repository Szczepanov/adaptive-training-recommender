/** Return true only for the seven opt-in H1 cases that intentionally expose extra judge facts. */
export function shouldExposeHybridExpansionFacts(scenario, hybridExpansion) {
  return Boolean(hybridExpansion && scenario?.tags?.includes('hybrid-expansion'));
}

/**
 * Rotate only the opt-in H1 family case order across repeated judge samples.
 * Validation normalizes by caseId afterwards, so this changes presentation order without
 * changing result identity. The reviewed active suite keeps its existing packet order.
 */
export function familyForJudgeSample(family, { hybridExpansion = false, sampleIndex = 0 } = {}) {
  if (!hybridExpansion || !family?.familyId?.startsWith('persona_hybrid_') || family.cases.length < 2) {
    return family;
  }

  const offset = ((sampleIndex % family.cases.length) + family.cases.length) % family.cases.length;
  if (offset === 0) return family;

  return {
    ...family,
    cases: [...family.cases.slice(offset), ...family.cases.slice(0, offset)],
  };
}
