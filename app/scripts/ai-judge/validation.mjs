import { REQUIRED_SCORES, RESPONSE_SCHEMA_V1 } from './schema.mjs';

export const SYNTHETIC_CASE_RATIONALES = new Set([
  'Baseline evaluation applied for missing case response.',
  'Plan evaluated against requirements.',
]);

export const SYNTHETIC_FAMILY_RATIONALES = new Set([
  'Family sensitivity evaluation.',
]);

export const SYNTHETIC_FAMILY_RATIONALE_PREFIX = 'Evaluation of family sensitivity across ';

export const SYNTHETIC_HYPOTHESES = new Set([
  'Ensure plan responds proportionally to changed sensitivity axis.',
  'Maintain balanced sensitivity response across input variations.',
]);

export function extractCleanJson(rawText) {
  if (typeof rawText !== 'string' || !rawText.trim()) {
    throw new Error('Judge returned an empty response.');
  }

  let cleaned = rawText
    .trim()
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<thought>[\s\S]*?<\/thought>/gi, '')
    .replace(/```(?:json)?/gi, '')
    .replace(/```/g, '')
    .trim();

  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace < 0 || lastBrace < firstBrace) {
    throw new Error('Judge response did not contain a complete JSON object.');
  }

  cleaned = cleaned.slice(firstBrace, lastBrace + 1).replace(/,\s*([}\]])/g, '$1');
  try {
    return JSON.parse(cleaned);
  } catch (error) {
    throw new Error(`Judge response was not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function boundedNumber(value, min, max, field) {
  const normalized = typeof value === 'string' && value.trim() !== '' ? Number(value.trim()) : value;
  if (typeof normalized !== 'number' || !Number.isFinite(normalized) || normalized < min || normalized > max) {
    throw new Error(`${field} must be a finite number in [${min}, ${max}], got ${JSON.stringify(value)}`);
  }
  return normalized;
}

export function nonEmptyString(value, field) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${field} must be a non-empty string.`);
  }
  return value.trim();
}

export function stringArray(value, field) {
  if (!Array.isArray(value)) {
    throw new Error(`${field} must be an array of strings.`);
  }
  return value.map((item, index) => nonEmptyString(item, `${field}[${index}]`));
}

export function validateAndNormalizeJudgeRow(value, familyId, expectedCaseIds) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Judge response for ${familyId} must be an object.`);
  }
  if (value.schema !== RESPONSE_SCHEMA_V1) {
    throw new Error(`${familyId}: unexpected or missing schema ${JSON.stringify(value.schema)}.`);
  }
  if (value.familyId !== familyId) {
    throw new Error(`${familyId}: response familyId must be exactly '${familyId}', got ${JSON.stringify(value.familyId)}.`);
  }
  if (!Array.isArray(value.caseScores)) {
    throw new Error(`${familyId}.caseScores must be an array.`);
  }

  const expectedSet = new Set(expectedCaseIds);
  const normalizedByCase = new Map();
  for (const item of value.caseScores) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`${familyId}: malformed case score.`);
    }
    const caseId = nonEmptyString(item.caseId, `${familyId}.caseScores.caseId`);
    if (!expectedSet.has(caseId)) {
      throw new Error(`${familyId}: unexpected caseId '${caseId}'.`);
    }
    if (normalizedByCase.has(caseId)) {
      throw new Error(`${familyId}: duplicate caseId '${caseId}'.`);
    }
    if (!item.scores || typeof item.scores !== 'object' || Array.isArray(item.scores)) {
      throw new Error(`${caseId}.scores is required.`);
    }
    const scores = Object.fromEntries(
      REQUIRED_SCORES.map((key) => [key, boundedNumber(item.scores[key], 0, 10, `${caseId}.scores.${key}`)])
    );
    const rationale = nonEmptyString(item.rationale, `${caseId}.rationale`);
    if (SYNTHETIC_CASE_RATIONALES.has(rationale)) {
      throw new Error(`${familyId}: ${caseId} contains synthesized fallback judge evidence.`);
    }

    normalizedByCase.set(caseId, {
      caseId,
      scores,
      confidence: boundedNumber(item.confidence, 0, 1, `${caseId}.confidence`),
      flags: stringArray(item.flags, `${caseId}.flags`),
      rationale,
      suggestedChanges: stringArray(item.suggestedChanges, `${caseId}.suggestedChanges`),
    });
  }

  const missingCases = expectedCaseIds.filter((caseId) => !normalizedByCase.has(caseId));
  if (missingCases.length) {
    throw new Error(`${familyId}: missing case scores: ${missingCases.join(', ')}`);
  }
  if (normalizedByCase.size !== expectedCaseIds.length) {
    throw new Error(`${familyId}: case score cardinality mismatch.`);
  }

  const assessment = value.familyAssessment;
  if (!assessment || typeof assessment !== 'object' || Array.isArray(assessment)) {
    throw new Error(`${familyId}.familyAssessment is required.`);
  }

  const familyRationale = nonEmptyString(assessment.rationale, `${familyId}.familyAssessment.rationale`);
  if (SYNTHETIC_FAMILY_RATIONALES.has(familyRationale) || familyRationale.startsWith(SYNTHETIC_FAMILY_RATIONALE_PREFIX)) {
    throw new Error(`${familyId}: synthesized familyAssessment is not valid judge evidence.`);
  }

  const hypotheses = stringArray(assessment.algorithmAdjustmentHypotheses, `${familyId}.familyAssessment.algorithmAdjustmentHypotheses`);
  if (hypotheses.some((hypothesis) => SYNTHETIC_HYPOTHESES.has(hypothesis.trim()))) {
    throw new Error(`${familyId}: synthesized family hypothesis is not valid judge evidence.`);
  }

  const validateCaseList = (field) => {
    const ids = stringArray(assessment[field], `${familyId}.familyAssessment.${field}`);
    for (const id of ids) {
      if (!expectedSet.has(id)) {
        throw new Error(`${familyId}.familyAssessment.${field} references unknown case '${id}'.`);
      }
    }
    if (new Set(ids).size !== ids.length) {
      throw new Error(`${familyId}.familyAssessment.${field} contains duplicate caseIds.`);
    }
    return ids;
  };

  return {
    schema: RESPONSE_SCHEMA_V1,
    familyId,
    caseScores: expectedCaseIds.map((caseId) => normalizedByCase.get(caseId)),
    familyAssessment: {
      sensitivity_quality: boundedNumber(assessment.sensitivity_quality, 0, 10, `${familyId}.familyAssessment.sensitivity_quality`),
      overreactionCases: validateCaseList('overreactionCases'),
      underreactionCases: validateCaseList('underreactionCases'),
      goodSensitivityCases: validateCaseList('goodSensitivityCases'),
      rationale: familyRationale,
      algorithmAdjustmentHypotheses: hypotheses,
    },
  };
}

export function classifyError(error) {
  const msg = error instanceof Error ? error.message : String(error);

  if (/(?:401|403|unauthorized|forbidden|invalid api key|api key not valid)/i.test(msg)) {
    return 'auth_or_permission';
  }
  if (/(?:429|rate limit|quota exceeded|resource has been exhausted)/i.test(msg)) {
    return 'rate_limit';
  }
  if (/(?:500|502|503|504|internal server error|bad gateway|service unavailable|gateway timeout)/i.test(msg)) {
    return 'provider_5xx';
  }
  if (/(?:timeout|etimedout|timed out|abort)/i.test(msg)) {
    return 'timeout';
  }
  if (/(?:econnreset|econnrefused|fetch failed|network error|socket hang up)/i.test(msg)) {
    return 'transient_network';
  }
  if (/(?:json|empty response|not a complete json|unexpected token)/i.test(msg)) {
    return 'structured_output_invalid';
  }
  if (/(?:must be a|required|unexpected caseid|missing case|cardinality|synthesized)/i.test(msg)) {
    return 'semantic_validation_invalid';
  }
  if (/(?:400|bad request|unsupported|not supported|invalid model|model not found)/i.test(msg)) {
    return 'configuration_error';
  }
  return 'semantic_validation_invalid';
}

export function isRetryableError(category) {
  return [
    'rate_limit',
    'timeout',
    'transient_network',
    'provider_5xx',
    'structured_output_invalid',
    'semantic_validation_invalid',
  ].includes(category);
}
