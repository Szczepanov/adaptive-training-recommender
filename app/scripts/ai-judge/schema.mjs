import { createHash } from 'node:crypto';

export const REQUIRED_SCORES = [
  'safety_recovery_fit',
  'goal_event_fit',
  'sequencing',
  'periodization_taper',
  'preference_capacity_fit',
  'robustness',
  'overall',
];

export const RESPONSE_SCHEMA_V1 = 'adaptive-training-recommender/ai-plan-judge-response@1';

export function hashString(content) {
  return createHash('sha256').update(content).digest('hex');
}

export function hashJson(obj) {
  return hashString(JSON.stringify(obj));
}

export function generateFamilyResponseSchema(familyId, expectedCaseIds) {
  if (!familyId || typeof familyId !== 'string') {
    throw new Error('generateFamilyResponseSchema requires a valid string familyId');
  }
  if (!Array.isArray(expectedCaseIds) || expectedCaseIds.length === 0) {
    throw new Error('generateFamilyResponseSchema requires a non-empty array of expectedCaseIds');
  }

  return {
    type: 'object',
    additionalProperties: false,
    required: ['schema', 'familyId', 'caseScores', 'familyAssessment'],
    properties: {
      schema: {
        type: 'string',
        const: RESPONSE_SCHEMA_V1,
      },
      familyId: {
        type: 'string',
        const: familyId,
      },
      caseScores: {
        type: 'array',
        minItems: expectedCaseIds.length,
        maxItems: expectedCaseIds.length,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['caseId', 'scores', 'confidence', 'flags', 'rationale', 'suggestedChanges'],
          properties: {
            caseId: {
              type: 'string',
              enum: expectedCaseIds,
            },
            scores: {
              type: 'object',
              additionalProperties: false,
              required: REQUIRED_SCORES,
              properties: Object.fromEntries(
                REQUIRED_SCORES.map((key) => [
                  key,
                  { type: 'number', minimum: 0, maximum: 10 },
                ])
              ),
            },
            confidence: {
              type: 'number',
              minimum: 0,
              maximum: 1,
            },
            flags: {
              type: 'array',
              items: { type: 'string' },
            },
            rationale: {
              type: 'string',
              minLength: 1,
            },
            suggestedChanges: {
              type: 'array',
              items: { type: 'string' },
            },
          },
        },
      },
      familyAssessment: {
        type: 'object',
        additionalProperties: false,
        required: [
          'sensitivity_quality',
          'overreactionCases',
          'underreactionCases',
          'goodSensitivityCases',
          'rationale',
          'algorithmAdjustmentHypotheses',
        ],
        properties: {
          sensitivity_quality: {
            type: 'number',
            minimum: 0,
            maximum: 10,
          },
          overreactionCases: {
            type: 'array',
            items: { type: 'string', enum: expectedCaseIds },
          },
          underreactionCases: {
            type: 'array',
            items: { type: 'string', enum: expectedCaseIds },
          },
          goodSensitivityCases: {
            type: 'array',
            items: { type: 'string', enum: expectedCaseIds },
          },
          rationale: {
            type: 'string',
            minLength: 1,
          },
          algorithmAdjustmentHypotheses: {
            type: 'array',
            items: { type: 'string' },
          },
        },
      },
    },
  };
}
