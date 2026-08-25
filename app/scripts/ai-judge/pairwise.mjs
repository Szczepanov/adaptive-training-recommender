export function generatePairwiseResponseSchema(scale = '0-4') {
  const maxScore = scale === '0-4' ? 4 : 10;
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      schema: { const: 'adaptive-training-recommender/ai-plan-judge-pairwise@1' },
      familyId: { type: 'string' },
      caseA: { type: 'string' },
      caseB: { type: 'string' },
      expectedDirection: {
        type: 'string',
        enum: ['less_load', 'same', 'more_load', 'specificity_shift', 'timing_shift', 'mixed'],
      },
      expectedMagnitude: {
        type: 'string',
        enum: ['none', 'small', 'moderate', 'large'],
      },
      actualResponseAssessment: {
        type: 'string',
        enum: ['underreact', 'appropriate', 'overreact'],
      },
      confidence: {
        type: 'number',
        minimum: 0,
        maximum: 1,
      },
      evidence: {
        type: 'array',
        items: { type: 'string' },
      },
      preference: {
        type: 'string',
        enum: ['A_better', 'B_better', 'equal', 'both_flawed'],
      },
      sensitivityScore: {
        type: 'integer',
        minimum: 0,
        maximum: maxScore,
      },
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
    instruction: 'Compare Case A (baseline) against Case B (perturbed input). Assess whether the actual plan change matches the expected direction and magnitude. Answer "same" when minor input changes are clinically not decision-relevant. Select actualResponseAssessment from: underreact | appropriate | overreact.',
  };
}

export function evaluateOrderSwapConsistency(forwardResult, reversedResult) {
  if (!forwardResult || !reversedResult) {
    return {
      isSymmetric: false,
      positionUnstable: true,
      positionBiasDetected: true,
      rationale: 'Missing evaluation result.',
    };
  }

  // Forward evaluated (A, B); Reversed evaluated (B, A)
  // Symmetrical preferences:
  // Forward: A_better <==> Reversed: B_better
  // Forward: B_better <==> Reversed: A_better
  // Forward: equal <==> Reversed: equal
  // Forward: both_flawed <==> Reversed: both_flawed
  let preferenceSymmetric = false;
  if (forwardResult.preference === 'A_better' && reversedResult.preference === 'B_better') {
    preferenceSymmetric = true;
  } else if (forwardResult.preference === 'B_better' && reversedResult.preference === 'A_better') {
    preferenceSymmetric = true;
  } else if (forwardResult.preference === reversedResult.preference && ['equal', 'both_flawed'].includes(forwardResult.preference)) {
    preferenceSymmetric = true;
  }

  // Symmetrical assessment:
  // Both runs should classify the response appropriateness equivalently
  const assessmentSymmetric = forwardResult.actualResponseAssessment === reversedResult.actualResponseAssessment;

  const scoreDelta = Math.abs((forwardResult.sensitivityScore ?? 0) - (reversedResult.sensitivityScore ?? 0));
  const scoreConsistent = scoreDelta <= 1;

  const isSymmetric = preferenceSymmetric && assessmentSymmetric && scoreConsistent;
  const positionUnstable = !isSymmetric;

  return {
    isSymmetric,
    positionUnstable,
    positionBiasDetected: positionUnstable,
    preferenceSymmetric,
    assessmentSymmetric,
    scoreDelta,
  };
}

export function computePositionBiasIndex(pairwiseResults = []) {
  if (!Array.isArray(pairwiseResults) || pairwiseResults.length === 0) {
    return {
      totalPairs: 0,
      symmetricPairs: 0,
      biasedPairs: 0,
      positionBiasIndex: 0,
    };
  }

  const symmetricCount = pairwiseResults.filter((r) => r.isSymmetric).length;
  const biasedCount = pairwiseResults.length - symmetricCount;
  const positionBiasIndex = Math.round((biasedCount / pairwiseResults.length) * 1000) / 1000;

  return {
    totalPairs: pairwiseResults.length,
    symmetricPairs: symmetricCount,
    biasedPairs: biasedCount,
    positionBiasIndex,
  };
}

export function deriveFamilySensitivityFromEdges(pairwiseResults = []) {
  if (!Array.isArray(pairwiseResults) || pairwiseResults.length === 0) {
    return {
      totalEdges: 0,
      appropriateEdges: 0,
      underreactCount: 0,
      overreactCount: 0,
      positionUnstableCount: 0,
      appropriateRatio: 1.0,
      derivedSensitivityScore4: 4,
      derivedSensitivityScore10: 10.0,
    };
  }

  let appropriateEdges = 0;
  let underreactCount = 0;
  let overreactCount = 0;
  let positionUnstableCount = 0;

  for (const row of pairwiseResults) {
    const assessment = row.forward?.actualResponseAssessment;
    if (assessment === 'appropriate') appropriateEdges += 1;
    else if (assessment === 'underreact') underreactCount += 1;
    else if (assessment === 'overreact') overreactCount += 1;

    if (row.positionUnstable || row.swapConsistency?.positionUnstable) {
      positionUnstableCount += 1;
    }
  }

  const totalEdges = pairwiseResults.length;
  const appropriateRatio = Math.round((appropriateEdges / totalEdges) * 1000) / 1000;
  const unstablePenalty = (positionUnstableCount / totalEdges) * 0.5;

  const rawScore4 = (appropriateRatio * 4) - unstablePenalty;
  const derivedSensitivityScore4 = Math.max(0, Math.min(4, Math.round(rawScore4)));
  const derivedSensitivityScore10 = Math.round(derivedSensitivityScore4 * 2.5 * 10) / 10;

  return {
    totalEdges,
    appropriateEdges,
    underreactCount,
    overreactCount,
    positionUnstableCount,
    appropriateRatio,
    derivedSensitivityScore4,
    derivedSensitivityScore10,
  };
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
    if (!caseA || !caseB) continue;

    const forwardPacket = formatPairwiseComparisonPacket({
      familyId,
      edge,
      caseA,
      caseB,
      isSwapped: false,
    });

    const forwardResponse = await callProviderFn({
      packetJson: JSON.stringify(forwardPacket),
      schema: pairwiseSchema,
      promptContent: 'Evaluate the sensitivity and directional appropriateness of the plan change between Case A and Case B.',
      schemaContent: JSON.stringify(pairwiseSchema, null, 2),
      config,
      attempt: 1,
      sampleIndex,
      seed,
    });

    const forwardVal = forwardResponse.value;
    let reversedVal = null;
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
      const reversedResponse = await callProviderFn({
        packetJson: JSON.stringify(reversedPacket),
        schema: pairwiseSchema,
        promptContent: 'Evaluate the sensitivity and directional appropriateness of the plan change between Case A and Case B.',
        schemaContent: JSON.stringify(pairwiseSchema, null, 2),
        config,
        attempt: 1,
        sampleIndex,
        seed: reversedSeed,
      });

      reversedVal = reversedResponse.value;
      swapConsistency = evaluateOrderSwapConsistency(forwardVal, reversedVal);
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
