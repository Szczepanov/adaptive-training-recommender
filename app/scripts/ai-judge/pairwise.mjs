const PAIRWISE_SCHEMA_ID = 'adaptive-training-recommender/ai-plan-judge-pairwise@1';
const DIRECTION_VALUES = ['less_load', 'same', 'more_load', 'specificity_shift', 'timing_shift', 'mixed'];
const MAGNITUDE_VALUES = ['none', 'small', 'moderate', 'large'];
const ASSESSMENT_VALUES = ['underreaction', 'appropriate', 'overreaction'];
const PREFERENCE_VALUES = ['A_better', 'B_better', 'equal', 'both_flawed'];

function finiteNumber(value, min, max, field) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${field} must be a finite number in [${min}, ${max}], got ${JSON.stringify(value)}.`);
  }
  return value;
}

function nonEmptyString(value, field, minLength = 1) {
  if (typeof value !== 'string' || value.trim().length < minLength) {
    throw new Error(`${field} must be a string with at least ${minLength} character(s).`);
  }
  return value.trim();
}

function enumValue(value, allowed, field) {
  if (!allowed.includes(value)) {
    throw new Error(`${field} must be one of ${allowed.join(' | ')}, got ${JSON.stringify(value)}.`);
  }
  return value;
}

function validateSensitivityScore(value, scale) {
  if (scale === '0-4') {
    if (!Number.isInteger(value) || value < 0 || value > 4) {
      throw new Error(`sensitivityScore must be an integer in [0, 4], got ${JSON.stringify(value)}.`);
    }
    return value;
  }
  return finiteNumber(value, 0, 10, 'sensitivityScore');
}

export function generatePairwiseResponseSchema(scale = '0-4') {
  const scoreSchema = scale === '0-4'
    ? { type: 'integer', minimum: 0, maximum: 4 }
    : { type: 'number', minimum: 0, maximum: 10 };

  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      schema: { const: PAIRWISE_SCHEMA_ID },
      familyId: { type: 'string' },
      caseA: { type: 'string' },
      caseB: { type: 'string' },
      expectedDirection: {
        type: 'string',
        enum: DIRECTION_VALUES,
      },
      expectedMagnitude: {
        type: 'string',
        enum: MAGNITUDE_VALUES,
      },
      actualDirection: {
        type: 'string',
        enum: DIRECTION_VALUES,
      },
      actualResponseAssessment: {
        type: 'string',
        enum: ASSESSMENT_VALUES,
      },
      confidence: {
        type: 'number',
        minimum: 0,
        maximum: 1,
      },
      evidence: {
        type: 'array',
        minItems: 1,
        items: { type: 'string', minLength: 1 },
      },
      preference: {
        type: 'string',
        enum: PREFERENCE_VALUES,
      },
      sensitivityScore: scoreSchema,
      rationale: {
        type: 'string',
        minLength: 10,
      },
    },
    required: [
      'schema',
      'familyId',
      'caseA',
      'caseB',
      'expectedDirection',
      'expectedMagnitude',
      'actualDirection',
      'actualResponseAssessment',
      'confidence',
      'evidence',
      'preference',
      'sensitivityScore',
      'rationale',
    ],
  };
}

export function formatPairwiseComparisonPacket({ familyId, edge, caseA, caseB, isSwapped = false }) {
  const [first, second] = isSwapped ? [caseB, caseA] : [caseA, caseB];

  return {
    packetSchema: 'adaptive-training-recommender/ai-plan-judge-pairwise-packet@1',
    familyId,
    comparisonAxis: edge.axis,
    comparisonRoles: {
      baselineCaseId: caseA.caseId,
      perturbedCaseId: caseB.caseId,
    },
    expectedDirection: edge.expectedDirection,
    expectedMagnitude: edge.expectedMagnitude,
    caseA: {
      caseId: first.caseId,
      label: first.label,
      inputContext: first.inputContext,
      plan14d: first.plan14d,
      derivedPlanFeatures: first.derivedPlanFeatures ?? first.derivedFeatures,
    },
    caseB: {
      caseId: second.caseId,
      label: second.label,
      inputContext: second.inputContext,
      plan14d: second.plan14d,
      derivedPlanFeatures: second.derivedPlanFeatures ?? second.derivedFeatures,
    },
    instruction: [
      'The displayed A/B order may be swapped for a position-bias check.',
      'Use comparisonRoles to assess the canonical change from baselineCaseId to perturbedCaseId regardless of display slot.',
      'Report actualDirection for that canonical baseline-to-perturbed change and judge whether its magnitude/direction is underreaction, appropriate, or overreaction.',
      'preference is display-slot relative: choose A_better or B_better according to the currently displayed cases, or equal/both_flawed when appropriate.',
    ].join(' '),
  };
}

export function validateAndNormalizePairwiseResponse(value, { familyId, packet, edge, scale = '0-4' }) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${familyId}: pairwise response must be an object.`);
  }
  if (value.schema !== PAIRWISE_SCHEMA_ID) {
    throw new Error(`${familyId}: unexpected pairwise schema ${JSON.stringify(value.schema)}.`);
  }
  if (value.familyId !== familyId) {
    throw new Error(`${familyId}: pairwise response familyId must be exactly '${familyId}'.`);
  }
  if (value.caseA !== packet.caseA.caseId || value.caseB !== packet.caseB.caseId) {
    throw new Error(`${familyId}: pairwise response caseA/caseB must match the displayed packet order.`);
  }
  if (value.expectedDirection !== edge.expectedDirection) {
    throw new Error(`${familyId}: pairwise expectedDirection must echo '${edge.expectedDirection}'.`);
  }
  if (value.expectedMagnitude !== edge.expectedMagnitude) {
    throw new Error(`${familyId}: pairwise expectedMagnitude must echo '${edge.expectedMagnitude}'.`);
  }

  if (!Array.isArray(value.evidence) || value.evidence.length === 0) {
    throw new Error(`${familyId}: pairwise evidence must contain at least one item.`);
  }

  return {
    schema: PAIRWISE_SCHEMA_ID,
    familyId,
    caseA: packet.caseA.caseId,
    caseB: packet.caseB.caseId,
    expectedDirection: edge.expectedDirection,
    expectedMagnitude: edge.expectedMagnitude,
    actualDirection: enumValue(value.actualDirection, DIRECTION_VALUES, `${familyId}.actualDirection`),
    actualResponseAssessment: enumValue(
      value.actualResponseAssessment,
      ASSESSMENT_VALUES,
      `${familyId}.actualResponseAssessment`
    ),
    confidence: finiteNumber(value.confidence, 0, 1, `${familyId}.confidence`),
    evidence: value.evidence.map((item, index) => nonEmptyString(item, `${familyId}.evidence[${index}]`)),
    preference: enumValue(value.preference, PREFERENCE_VALUES, `${familyId}.preference`),
    sensitivityScore: validateSensitivityScore(value.sensitivityScore, scale),
    rationale: nonEmptyString(value.rationale, `${familyId}.rationale`, 10),
  };
}

export function evaluateOrderSwapConsistency(forwardResult, reversedResult, scale = '0-4') {
  if (!forwardResult || !reversedResult) {
    return {
      isSymmetric: false,
      positionUnstable: true,
      positionBiasDetected: true,
      preferenceSymmetric: false,
      directionSymmetric: false,
      assessmentSymmetric: false,
      scoreConsistent: false,
      rationale: 'Missing evaluation result.',
    };
  }

  let preferenceSymmetric = false;
  if (forwardResult.preference === 'A_better' && reversedResult.preference === 'B_better') {
    preferenceSymmetric = true;
  } else if (forwardResult.preference === 'B_better' && reversedResult.preference === 'A_better') {
    preferenceSymmetric = true;
  } else if (
    forwardResult.preference === reversedResult.preference
    && ['equal', 'both_flawed'].includes(forwardResult.preference)
  ) {
    preferenceSymmetric = true;
  }

  const directionSymmetric = forwardResult.actualDirection === reversedResult.actualDirection;
  const assessmentSymmetric = forwardResult.actualResponseAssessment === reversedResult.actualResponseAssessment;
  const scoreDelta = Math.abs((forwardResult.sensitivityScore ?? 0) - (reversedResult.sensitivityScore ?? 0));
  const scoreTolerance = scale === '0-4' ? 1 : 2.5;
  const scoreConsistent = scoreDelta <= scoreTolerance;

  const isSymmetric = preferenceSymmetric && directionSymmetric && assessmentSymmetric && scoreConsistent;
  const positionUnstable = !isSymmetric;

  return {
    isSymmetric,
    positionUnstable,
    positionBiasDetected: !preferenceSymmetric,
    preferenceSymmetric,
    directionSymmetric,
    assessmentSymmetric,
    scoreConsistent,
    scoreDelta,
    scoreTolerance,
  };
}

export function computePositionBiasIndex(pairwiseResults = []) {
  if (!Array.isArray(pairwiseResults) || pairwiseResults.length === 0) {
    return {
      totalPairs: 0,
      symmetricPairs: 0,
      unstablePairs: 0,
      biasedPairs: 0,
      positionBiasIndex: 0,
      orderInstabilityIndex: 0,
    };
  }

  const symmetricCount = pairwiseResults.filter((r) => r.isSymmetric).length;
  const unstableCount = pairwiseResults.filter((r) => r.positionUnstable ?? !r.isSymmetric).length;
  const biasedCount = pairwiseResults.filter(
    (r) => r.swapConsistency?.positionBiasDetected ?? r.positionBiasDetected ?? !r.isSymmetric
  ).length;

  return {
    totalPairs: pairwiseResults.length,
    symmetricPairs: symmetricCount,
    unstablePairs: unstableCount,
    biasedPairs: biasedCount,
    positionBiasIndex: Math.round((biasedCount / pairwiseResults.length) * 1000) / 1000,
    orderInstabilityIndex: Math.round((unstableCount / pairwiseResults.length) * 1000) / 1000,
  };
}

export function deriveFamilySensitivityFromEdges(pairwiseResults = []) {
  if (!Array.isArray(pairwiseResults) || pairwiseResults.length === 0) {
    return {
      totalEdges: 0,
      appropriateEdges: 0,
      underreactionCount: 0,
      overreactionCount: 0,
      positionUnstableCount: 0,
      coverage: 'uncovered',
      appropriateRatio: null,
      derivedSensitivityScore4: null,
      derivedSensitivityScore10: null,
    };
  }

  let appropriateEdges = 0;
  let underreactionCount = 0;
  let overreactionCount = 0;
  let positionUnstableCount = 0;

  for (const row of pairwiseResults) {
    const assessment = row.forward?.actualResponseAssessment;
    if (assessment === 'appropriate') appropriateEdges += 1;
    else if (assessment === 'underreaction') underreactionCount += 1;
    else if (assessment === 'overreaction') overreactionCount += 1;

    if (row.positionUnstable || row.swapConsistency?.positionUnstable) {
      positionUnstableCount += 1;
    }
  }

  const totalEdges = pairwiseResults.length;
  const appropriateRatio = Math.round((appropriateEdges / totalEdges) * 1000) / 1000;
  const unstablePenalty = (positionUnstableCount / totalEdges) * 0.5;

  const rawScore4 = (appropriateRatio * 4) - unstablePenalty;
  // Once a swapped display changes a judgment, preserve that evidence in the
  // ordinal score rather than allowing nearest-integer rounding to erase it.
  const derivedSensitivityScore4 = Math.max(
    0,
    Math.min(4, positionUnstableCount > 0 ? Math.floor(rawScore4) : Math.round(rawScore4))
  );
  const derivedSensitivityScore10 = Math.round(derivedSensitivityScore4 * 2.5 * 10) / 10;

  return {
    totalEdges,
    appropriateEdges,
    underreactionCount,
    overreactionCount,
    positionUnstableCount,
    coverage: 'covered',
    appropriateRatio,
    derivedSensitivityScore4,
    derivedSensitivityScore10,
  };
}

async function callValidatedPairwise({
  familyId,
  edge,
  packet,
  pairwiseSchema,
  config,
  sampleIndex,
  seed,
  callProviderFn,
  retries = 3,
}) {
  let lastError = null;

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const response = await callProviderFn({
        packetJson: JSON.stringify(packet),
        schema: pairwiseSchema,
        promptContent: 'Evaluate the sensitivity and directional appropriateness of this pairwise training-plan comparison.',
        schemaContent: JSON.stringify(pairwiseSchema, null, 2),
        config,
        attempt,
        sampleIndex,
        seed,
      });

      return {
        value: validateAndNormalizePairwiseResponse(response.value, {
          familyId,
          packet,
          edge,
          scale: config.rubricScale,
        }),
        telemetry: response.telemetry ?? null,
      };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function executeFamilyPairwiseEvaluations({
  familyId,
  edges,
  casesById,
  config,
  seed,
  sampleIndex = 0,
  callProviderFn,
}) {
  const pairwiseSchema = generatePairwiseResponseSchema(config.rubricScale);
  const pairwiseResults = [];

  for (const edge of edges) {
    const caseA = casesById.get(edge.from);
    const caseB = casesById.get(edge.to);
    if (!caseA || !caseB) {
      throw new Error(`${familyId}: missing pairwise case for edge ${edge.from}->${edge.to}.`);
    }

    const forwardPacket = formatPairwiseComparisonPacket({
      familyId,
      edge,
      caseA,
      caseB,
      isSwapped: false,
    });

    const forwardResponse = await callValidatedPairwise({
      familyId,
      edge,
      packet: forwardPacket,
      pairwiseSchema,
      config,
      sampleIndex,
      seed,
      callProviderFn,
    });

    const forwardVal = forwardResponse.value;
    let reversedVal = null;
    let reversedTelemetry = null;
    let swapConsistency = null;

    if (config.checkPositionBias) {
      const reversedPacket = formatPairwiseComparisonPacket({
        familyId,
        edge,
        caseA,
        caseB,
        isSwapped: true,
      });

      const reversedSeed = typeof seed === 'number' ? seed + 99991 : null;
      const reversedResponse = await callValidatedPairwise({
        familyId,
        edge,
        packet: reversedPacket,
        pairwiseSchema,
        config,
        sampleIndex,
        seed: reversedSeed,
        callProviderFn,
      });

      reversedVal = reversedResponse.value;
      reversedTelemetry = reversedResponse.telemetry;
      swapConsistency = evaluateOrderSwapConsistency(forwardVal, reversedVal, config.rubricScale);
    }

    const isSymmetric = swapConsistency ? swapConsistency.isSymmetric : true;
    const positionUnstable = swapConsistency ? swapConsistency.positionUnstable : false;

    pairwiseResults.push({
      familyId,
      edge: `${edge.from}->${edge.to}`,
      axis: edge.axis,
      expectedDirection: edge.expectedDirection,
      expectedMagnitude: edge.expectedMagnitude,
      forward: forwardVal,
      reversed: reversedVal,
      swapConsistency,
      isSymmetric,
      positionUnstable,
      telemetry: {
        forward: forwardResponse.telemetry,
        reversed: reversedTelemetry,
      },
    });
  }

  const positionBias = computePositionBiasIndex(pairwiseResults);
  const edgeSensitivitySummary = deriveFamilySensitivityFromEdges(pairwiseResults);

  return {
    familyId,
    sampleIndex,
    pairwiseResults,
    positionBias,
    edgeSensitivitySummary,
  };
}
