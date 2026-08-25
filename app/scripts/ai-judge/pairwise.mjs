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
      observedDirection: {
        type: 'string',
        enum: ['less_load', 'more_load', 'same_load', 'shift_modality', 'shift_intensity', 'other'],
      },
      reactionAppropriateness: {
        type: 'string',
        enum: ['appropriate', 'underreaction', 'overreaction', 'opposite_direction', 'inappropriate_shift'],
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
      'observedDirection',
      'reactionAppropriateness',
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
    instruction: 'Compare Case A (baseline) against Case B (perturbed input). Did the training plan change in a directionally sound and physiologically appropriate manner for the specified changed axis? Penalize both overreaction and underreaction.',
  };
}

export function evaluateOrderSwapConsistency(forwardResult, reversedResult) {
  if (!forwardResult || !reversedResult) {
    return { isSymmetric: false, positionBiasDetected: true, rationale: 'Missing evaluation result.' };
  }

  // Forward evaluated (A, B); Reversed evaluated (B, A)
  // Symmetrical preferences:
  // Forward: A_better <==> Reversed: B_better (since original A is now in slot B)
  // Forward: B_better <==> Reversed: A_better (since original B is now in slot A)
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

  // Symmetrical direction:
  // Forward: less_load <==> Reversed: more_load
  // Forward: more_load <==> Reversed: less_load
  // Forward: same_load <==> Reversed: same_load
  // Forward: shift_modality / shift_intensity <==> Reversed matches
  let directionSymmetric = false;
  if (forwardResult.observedDirection === 'less_load' && reversedResult.observedDirection === 'more_load') {
    directionSymmetric = true;
  } else if (forwardResult.observedDirection === 'more_load' && reversedResult.observedDirection === 'less_load') {
    directionSymmetric = true;
  } else if (forwardResult.observedDirection === reversedResult.observedDirection) {
    directionSymmetric = true;
  }

  const scoreDelta = Math.abs((forwardResult.sensitivityScore ?? 0) - (reversedResult.sensitivityScore ?? 0));
  const scoreConsistent = scoreDelta <= 1;

  const isSymmetric = preferenceSymmetric && directionSymmetric && scoreConsistent;

  return {
    isSymmetric,
    positionBiasDetected: !isSymmetric,
    preferenceSymmetric,
    directionSymmetric,
    scoreDelta,
  };
}

export function computePositionBiasIndex(pairwiseResults = []) {
  if (!Array.isArray(pairwiseResults) || pairwiseResults.length === 0) {
    return {
      totalPairs: 0,
      symmetricPairs: 0,
      positionBiasIndex: 0,
    };
  }

  const symmetricCount = pairwiseResults.filter((r) => r.isSymmetric).length;
  const biasCount = pairwiseResults.length - symmetricCount;
  const positionBiasIndex = Math.round((biasCount / pairwiseResults.length) * 1000) / 1000;

  return {
    totalPairs: pairwiseResults.length,
    symmetricPairs: symmetricCount,
    biasedPairs: biasCount,
    positionBiasIndex,
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

    pairwiseResults.push({
      familyId,
      edge: `${edge.from}->${edge.to}`,
      axis: edge.axis,
      expectedDirection: edge.expectedDirection,
      forward: forwardVal,
      reversed: reversedVal,
      swapConsistency,
      isSymmetric: swapConsistency ? swapConsistency.isSymmetric : true,
    });
  }

  const positionBias = computePositionBiasIndex(pairwiseResults);

  return {
    familyId,
    sampleIndex,
    pairwiseResults,
    positionBias,
  };
}
