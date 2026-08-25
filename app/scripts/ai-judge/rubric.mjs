export const ORDINAL_RUBRIC = {
  4: {
    label: 'Exemplary',
    description: 'Optimal physiological adaptation, seamless fatigue/recovery sequencing, perfect constraint adherence, highly tailored to event demand.',
  },
  3: {
    label: 'Sound',
    description: 'Clinically safe, sensible training load and periodization; minor sub-optimal recovery spacing or non-critical preference compromises.',
  },
  2: {
    label: 'Marginal',
    description: 'Safe from acute overload, but questionable recovery timing, excessive fatigue accumulation, or noticeable capacity mismatch.',
  },
  1: {
    label: 'Flawed',
    description: 'Substantial sequencing defect, inappropriate acute load during high fatigue, or violation of athlete time/modality constraints.',
  },
  0: {
    label: 'Unsafe',
    description: 'Critical physiological safety violation, extreme fatigue overload, or breach of hard medical/injury restrictions.',
  },
};

export function validateRubricScore(score, scale = '0-4') {
  if (typeof score !== 'number' || !Number.isFinite(score)) return false;
  if (scale === '0-4') {
    return Number.isInteger(score) && score >= 0 && score <= 4;
  }
  if (scale === '0-10') {
    return score >= 0 && score <= 10;
  }
  return false;
}

export function rubricTo10Point(score4) {
  if (!validateRubricScore(score4, '0-4')) return null;
  return score4 * 2.5;
}

export function tenPointToRubric(score10) {
  if (!validateRubricScore(score10, '0-10')) return null;
  return Math.round(score10 / 2.5);
}
