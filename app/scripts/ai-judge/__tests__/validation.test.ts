import { describe, expect, it } from 'vitest';
import {
  extractCleanJson,
  validateAndNormalizeJudgeRow,
  classifyError,
  isRetryableError,
} from '../validation.mjs';
import { REQUIRED_SCORES, RESPONSE_SCHEMA_V1 } from '../schema.mjs';

describe('AI Judge Validation and Error Taxonomy', () => {
  const familyId = 'fam_obj';
  const expectedCases = ['case_a', 'case_b'];

  const validResponse = {
    schema: RESPONSE_SCHEMA_V1,
    familyId: 'fam_obj',
    caseScores: [
      {
        caseId: 'case_a',
        scores: Object.fromEntries(REQUIRED_SCORES.map((k) => [k, 8])),
        confidence: 0.9,
        flags: ['flag1'],
        rationale: 'Good response to adverse readiness.',
        suggestedChanges: [],
      },
      {
        caseId: 'case_b',
        scores: Object.fromEntries(REQUIRED_SCORES.map((k) => [k, 7])),
        confidence: 0.85,
        flags: [],
        rationale: 'Reasonable training plan.',
        suggestedChanges: ['Add rest'],
      },
    ],
    familyAssessment: {
      sensitivity_quality: 7.5,
      overreactionCases: [],
      underreactionCases: ['case_b'],
      goodSensitivityCases: ['case_a'],
      rationale: 'Appropriate reduction in load across cases.',
      algorithmAdjustmentHypotheses: ['Consider earlier rest placement'],
    },
  };

  it('validates a well-formed response cleanly', () => {
    const validated = validateAndNormalizeJudgeRow(validResponse, familyId, expectedCases);
    expect(validated.familyId).toBe(familyId);
    expect(validated.caseScores.length).toBe(2);
    expect(validated.familyAssessment.sensitivity_quality).toBe(7.5);
  });

  it('extracts JSON from text with think tags and markdown fences', () => {
    const raw = `
    <think>
    Thinking about the plan...
    </think>
    \`\`\`json
    { "schema": "test", "val": 123 }
    \`\`\`
    `;
    const parsed = extractCleanJson(raw);
    expect(parsed).toEqual({ schema: 'test', val: 123 });
  });

  it('rejects response with missing case score', () => {
    const bad = {
      ...validResponse,
      caseScores: [validResponse.caseScores[0]],
    };
    expect(() => validateAndNormalizeJudgeRow(bad, familyId, expectedCases)).toThrow(/cardinality mismatch|missing case scores/);
  });

  it('rejects response with duplicate case score', () => {
    const bad = {
      ...validResponse,
      caseScores: [validResponse.caseScores[0], validResponse.caseScores[0]],
    };
    expect(() => validateAndNormalizeJudgeRow(bad, familyId, expectedCases)).toThrow(/duplicate caseId/);
  });

  it('rejects synthetic fallback rationale', () => {
    const bad = {
      ...validResponse,
      caseScores: [
        {
          ...validResponse.caseScores[0],
          rationale: 'Baseline evaluation applied for missing case response.',
        },
        validResponse.caseScores[1],
      ],
    };
    expect(() => validateAndNormalizeJudgeRow(bad, familyId, expectedCases)).toThrow(/synthesized fallback/);
  });

  it('classifies errors properly', () => {
    expect(classifyError(new Error('401 Unauthorized API key'))).toBe('auth_or_permission');
    expect(classifyError(new Error('429 Rate limit exceeded'))).toBe('rate_limit');
    expect(classifyError(new Error('502 Bad Gateway'))).toBe('provider_5xx');
    expect(classifyError(new Error('ETIMEDOUT connection timed out'))).toBe('timeout');
    expect(classifyError(new Error('SyntaxError: Unexpected token'))).toBe('structured_output_invalid');
    expect(classifyError(new Error('overall must be a finite number'))).toBe('semantic_validation_invalid');
  });

  it('determines retryability correctly', () => {
    expect(isRetryableError('rate_limit')).toBe(true);
    expect(isRetryableError('timeout')).toBe(true);
    expect(isRetryableError('structured_output_invalid')).toBe(true);
    expect(isRetryableError('semantic_validation_invalid')).toBe(true);
    expect(isRetryableError('auth_or_permission')).toBe(false);
    expect(isRetryableError('configuration_error')).toBe(false);
  });
});
