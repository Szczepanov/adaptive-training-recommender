export const ORDINAL_RUBRIC = {
  4: {
    label: 'Excellent',
    description: 'Optimal physiological adaptation, seamless fatigue/recovery sequencing, perfect constraint adherence, highly tailored to event demand.',
  },
  3: {
    label: 'Good',
    description: 'Clinically safe, sensible training load and periodization; minor sub-optimal recovery spacing or non-critical preference compromises.',
  },
  2: {
    label: 'Mixed / Meaningful flaws',
    description: 'Safe from acute overload, but questionable recovery timing, excessive fatigue accumulation, or noticeable capacity mismatch.',
  },
  1: {
    label: 'Major flaws',
    description: 'Substantial sequencing defect, inappropriate acute load during high fatigue, or violation of athlete time/modality constraints.',
  },
  0: {
    label: 'Unsafe / Invalid',
    description: 'Critical physiological safety violation, extreme fatigue overload, or breach of hard medical/injury restrictions.',
  },
};

export function rubricTo10Point(score4) {
  if (typeof score4 !== 'number' || Number.isNaN(score4)) return null;
  const clamped = Math.max(0, Math.min(4, score4));
  return Math.round(clamped * 2.5 * 10) / 10;
}

export function tenPointToRubric(score10) {
  if (typeof score10 !== 'number' || Number.isNaN(score10)) return null;
  const clamped = Math.max(0, Math.min(10, score10));
  return Math.round(clamped / 2.5);
}

export function validateRubricScore(score, scale = '0-4') {
  if (typeof score !== 'number' || Number.isNaN(score)) return false;
  if (scale === '0-4') {
    return Number.isInteger(score) && score >= 0 && score <= 4;
  }
  return score >= 0 && score <= 10;
}
