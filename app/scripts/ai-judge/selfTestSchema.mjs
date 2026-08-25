export const SELF_TEST_SUITE_SCHEMA = 'adaptive-training-recommender/ai-judge-self-test-suite@1';
export const SELF_TEST_CASE_SCHEMA = 'adaptive-training-recommender/ai-judge-self-test-case@1';
export const SELF_TEST_PACKET_SCHEMA = 'adaptive-training-recommender/ai-judge-self-test-packet@1';
export const SELF_TEST_RESPONSE_SCHEMA = 'adaptive-training-recommender/ai-judge-self-test-response@1';
export const SELF_TEST_SUMMARY_SCHEMA = 'adaptive-training-recommender/ai-judge-self-test-summary@1';

export const REACTION_CLASSES = [
  'appropriate',
  'overreaction',
  'underreaction',
  'opposite_direction',
  'not_applicable',
];

export const DIAGNOSTIC_ASSESSMENTS = [
  'not_shown',
  'supported',
  'misleading',
  'insufficient_evidence',
];

export function generateSelfTestResponseSchema(suiteId, calibrationCases) {
  if (typeof suiteId !== 'string' || !suiteId.trim()) {
    throw new Error('generateSelfTestResponseSchema requires a non-empty suiteId.');
  }
  if (!Array.isArray(calibrationCases) || calibrationCases.length === 0) {
    throw new Error('generateSelfTestResponseSchema requires at least one calibration case.');
  }

  const caseIds = calibrationCases.map((item) => item.caseId);
  if (caseIds.some((caseId) => typeof caseId !== 'string' || !caseId.trim())) {
    throw new Error('Every calibration case requires a non-empty caseId.');
  }
  if (new Set(caseIds).size !== caseIds.length) {
    throw new Error('Calibration response schema cannot be generated for duplicate caseIds.');
  }

  const planIds = [...new Set(calibrationCases.flatMap((item) => (item.plans ?? []).map((plan) => plan.planId)))];
  const evidenceReferenceItems = { type: 'string', pattern: '^/(inputContext|plans|comparison|focusPlanId)(/.*)?$' };
  const evidenceClaim = {
    type: 'object',
    additionalProperties: false,
    required: ['text', 'evidenceReferences'],
    properties: {
      text: { type: 'string', minLength: 1 },
      evidenceReferences: {
        type: 'array',
        items: evidenceReferenceItems,
      },
    },
  };
  const supportedObservationClaim = {
    ...evidenceClaim,
    properties: {
      ...evidenceClaim.properties,
      evidenceReferences: {
        type: 'array',
        minItems: 1,
        items: evidenceReferenceItems,
      },
    },
  };

  return {
    type: 'object',
    additionalProperties: false,
    required: ['schema', 'suiteId', 'results'],
    properties: {
      schema: { type: 'string', const: SELF_TEST_RESPONSE_SCHEMA },
      suiteId: { type: 'string', const: suiteId },
      results: {
        type: 'array',
        minItems: caseIds.length,
        maxItems: caseIds.length,
        items: {
          type: 'object',
          additionalProperties: false,
          required: [
            'caseId',
            'absoluteClass',
            'reactionClass',
            'preferredPlanId',
            'diagnosticAssessment',
            'evidenceReferences',
            'observations',
            'hypotheses',
            'numericParameterCandidates',
            'rationale',
          ],
          properties: {
            caseId: { type: 'string', enum: caseIds },
            absoluteClass: {
              type: 'integer',
              minimum: 0,
              maximum: 4,
              description: 'Quality/safety of the planner focusPlanId output, never the quality of this evaluator answer: 4 exemplary, 3 sound, 2 marginal, 1 flawed, 0 unsafe.',
            },
            reactionClass: {
              type: 'string',
              enum: REACTION_CLASSES,
              description: 'Whether the PLANNER response to the supplied input is appropriate, an overreaction, an underreaction, opposite direction, or not applicable. Do not grade the evaluator response itself.',
            },
            preferredPlanId: {
              type: 'string',
              enum: ['none', ...planIds],
              description: 'For pairwise cases, the stable ID of the factually better plan; use none when equal or both flawed. For pointwise cases always use none, but still evaluate the focus plan.',
            },
            diagnosticAssessment: {
              type: 'string',
              enum: DIAGNOSTIC_ASSESSMENTS,
              description: 'Assessment of source/planner diagnostics only. Blind primary packets contain no source diagnostics, so use not_shown; this is not confidence in your evidence.',
            },
            evidenceReferences: {
              type: 'array',
              minItems: 1,
              items: evidenceReferenceItems,
            },
            observations: {
              type: 'array',
              minItems: 1,
              items: supportedObservationClaim,
            },
            hypotheses: {
              type: 'array',
              items: {
                ...evidenceClaim,
                required: ['text', 'speculative', 'evidenceReferences'],
                properties: {
                  ...evidenceClaim.properties,
                  speculative: { type: 'boolean', const: true },
                },
              },
            },
            numericParameterCandidates: {
              type: 'array',
              description: 'Optional numeric tuning thresholds requiring independent repeated calibration evidence. Leave empty for these synthetic controls unless such evidence is explicitly present.',
              items: evidenceClaim,
            },
            rationale: { type: 'string', minLength: 1 },
          },
        },
      },
    },
  };
}
