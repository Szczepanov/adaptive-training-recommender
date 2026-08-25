import { describe, expect, it, vi } from 'vitest';
import {
  generatePairwiseResponseSchema,
  formatPairwiseComparisonPacket,
  validateAndNormalizePairwiseResponse,
  evaluateOrderSwapConsistency,
  computePositionBiasIndex,
  deriveFamilySensitivityFromEdges,
  executeFamilyPairwiseEvaluations,
} from '../pairwise.mjs';

describe('pairwise module', () => {
  const dummyCaseA = {
    caseId: 'judge_obj_neutral',
    label: 'Objective Neutral',
    inputContext: { readiness: { objective: { hrv_delta: 0 } } },
    plan14d: [{ day: 1, session: { title: 'Tempo Ride', systemicCost: 0.7 } }],
    derivedPlanFeatures: { totalPlannedDurationMin: 60, hardSessionCount: 1 },
  };

  const dummyCaseB = {
    caseId: 'judge_obj_hrv_2sd',
    label: 'Objective HRV Down 2SD',
    inputContext: { readiness: { objective: { hrv_delta: -17 } } },
    plan14d: [{ day: 1, session: { title: 'Recovery Spin', systemicCost: 0.2 } }],
    derivedPlanFeatures: { totalPlannedDurationMin: 30, hardSessionCount: 0 },
  };

  const dummyEdge = {
    from: 'judge_obj_neutral',
    to: 'judge_obj_hrv_2sd',
    axis: 'HRV down 2 SD',
    expectedDirection: 'less_load',
    expectedMagnitude: 'moderate',
  };

  function responseFor(packet, overrides = {}) {
    return {
      schema: 'adaptive-training-recommender/ai-plan-judge-pairwise@1',
      familyId: 'objective_recovery',
      caseA: packet.caseA.caseId,
      caseB: packet.caseB.caseId,
      expectedDirection: 'less_load',
      expectedMagnitude: 'moderate',
      actualDirection: 'less_load',
      actualResponseAssessment: 'appropriate',
      confidence: 0.9,
      evidence: ['Reduced systemic load from 0.7 to 0.2'],
      preference: 'A_better',
      sensitivityScore: 4,
      rationale: 'Appropriate load reduction for the adverse recovery input.',
      ...overrides,
    };
  }

  it('generates a strict pairwise response schema for both score scales', () => {
    const ordinal = generatePairwiseResponseSchema('0-4');
    expect(ordinal.required).toContain('actualDirection');
    expect(ordinal.required).toContain('actualResponseAssessment');
    expect(ordinal.properties.sensitivityScore).toEqual({ type: 'integer', minimum: 0, maximum: 4 });
    expect(ordinal.properties.evidence.minItems).toBe(1);

    const tenPoint = generatePairwiseResponseSchema('0-10');
    expect(tenPoint.properties.sensitivityScore).toEqual({ type: 'number', minimum: 0, maximum: 10 });
  });

  it('keeps canonical comparison roles stable when display order is swapped', () => {
    const forward = formatPairwiseComparisonPacket({
      familyId: 'objective_recovery',
      edge: dummyEdge,
      caseA: dummyCaseA,
      caseB: dummyCaseB,
      isSwapped: false,
    });
    const reversed = formatPairwiseComparisonPacket({
      familyId: 'objective_recovery',
      edge: dummyEdge,
      caseA: dummyCaseA,
      caseB: dummyCaseB,
      isSwapped: true,
    });

    expect(forward.caseA.caseId).toBe('judge_obj_neutral');
    expect(forward.caseB.caseId).toBe('judge_obj_hrv_2sd');
    expect(reversed.caseA.caseId).toBe('judge_obj_hrv_2sd');
    expect(reversed.caseB.caseId).toBe('judge_obj_neutral');
    expect(reversed.comparisonRoles).toEqual(forward.comparisonRoles);
    expect(reversed.comparisonRoles).toEqual({
      baselineCaseId: 'judge_obj_neutral',
      perturbedCaseId: 'judge_obj_hrv_2sd',
    });
    expect(reversed.expectedDirection).toBe('less_load');
  });

  it('strictly validates pairwise evidence after provider parsing', () => {
    const packet = formatPairwiseComparisonPacket({
      familyId: 'objective_recovery',
      edge: dummyEdge,
      caseA: dummyCaseA,
      caseB: dummyCaseB,
    });

    const validated = validateAndNormalizePairwiseResponse(responseFor(packet), {
      familyId: 'objective_recovery',
      packet,
      edge: dummyEdge,
      scale: '0-4',
    });
    expect(validated.actualDirection).toBe('less_load');

    expect(() => validateAndNormalizePairwiseResponse(responseFor(packet, { caseA: 'wrong' }), {
      familyId: 'objective_recovery',
      packet,
      edge: dummyEdge,
      scale: '0-4',
    })).toThrow(/caseA\/caseB/);

    expect(() => validateAndNormalizePairwiseResponse(responseFor(packet, { sensitivityScore: 3.5 }), {
      familyId: 'objective_recovery',
      packet,
      edge: dummyEdge,
      scale: '0-4',
    })).toThrow(/integer in \[0, 4\]/);
  });

  it('detects fully symmetric judgments between forward and reversed display order', () => {
    const forwardResult = {
      actualDirection: 'less_load',
      actualResponseAssessment: 'appropriate',
      preference: 'A_better',
      sensitivityScore: 4,
    };
    const reversedResult = {
      actualDirection: 'less_load',
      actualResponseAssessment: 'appropriate',
      preference: 'B_better',
      sensitivityScore: 4,
    };

    const evalResult = evaluateOrderSwapConsistency(forwardResult, reversedResult);
    expect(evalResult.isSymmetric).toBe(true);
    expect(evalResult.positionUnstable).toBe(false);
    expect(evalResult.positionBiasDetected).toBe(false);
    expect(evalResult.directionSymmetric).toBe(true);
  });

  it('separates position bias from non-positional order instability', () => {
    const forwardResult = {
      actualDirection: 'less_load',
      actualResponseAssessment: 'appropriate',
      preference: 'A_better',
      sensitivityScore: 4,
    };

    const slotBiased = evaluateOrderSwapConsistency(forwardResult, {
      actualDirection: 'less_load',
      actualResponseAssessment: 'appropriate',
      preference: 'A_better',
      sensitivityScore: 4,
    });
    expect(slotBiased.positionBiasDetected).toBe(true);
    expect(slotBiased.positionUnstable).toBe(true);

    const directionUnstable = evaluateOrderSwapConsistency(forwardResult, {
      actualDirection: 'more_load',
      actualResponseAssessment: 'appropriate',
      preference: 'B_better',
      sensitivityScore: 4,
    });
    expect(directionUnstable.positionBiasDetected).toBe(false);
    expect(directionUnstable.positionUnstable).toBe(true);
    expect(directionUnstable.directionSymmetric).toBe(false);
  });

  it('computes separate position-bias and order-instability indices', () => {
    const pairs = [
      { isSymmetric: true, positionUnstable: false, swapConsistency: { positionBiasDetected: false } },
      { isSymmetric: false, positionUnstable: true, swapConsistency: { positionBiasDetected: true } },
      { isSymmetric: false, positionUnstable: true, swapConsistency: { positionBiasDetected: false } },
      { isSymmetric: true, positionUnstable: false, swapConsistency: { positionBiasDetected: false } },
    ];

    const bias = computePositionBiasIndex(pairs);
    expect(bias.totalPairs).toBe(4);
    expect(bias.symmetricPairs).toBe(2);
    expect(bias.unstablePairs).toBe(2);
    expect(bias.biasedPairs).toBe(1);
    expect(bias.positionBiasIndex).toBe(0.25);
    expect(bias.orderInstabilityIndex).toBe(0.5);
  });

  it('derives mathematical family sensitivity summary from edge judgments', () => {
    const edgeResults = [
      { forward: { actualResponseAssessment: 'appropriate' }, positionUnstable: false },
      { forward: { actualResponseAssessment: 'appropriate' }, positionUnstable: false },
      { forward: { actualResponseAssessment: 'underreaction' }, positionUnstable: false },
      { forward: { actualResponseAssessment: 'overreaction' }, positionUnstable: true },
    ];

    const summary = deriveFamilySensitivityFromEdges(edgeResults);
    expect(summary.totalEdges).toBe(4);
    expect(summary.appropriateEdges).toBe(2);
    expect(summary.underreactionCount).toBe(1);
    expect(summary.overreactionCount).toBe(1);
    expect(summary.positionUnstableCount).toBe(1);
    expect(summary.appropriateRatio).toBe(0.5);
  });

  it('retries invalid pairwise responses and stores validated forward/reversed evaluations', async () => {
    let firstForward = true;
    const mockCallProvider = vi.fn(async ({ packetJson }) => {
      const packet = JSON.parse(packetJson);
      const isReversed = packet.caseA.caseId === 'judge_obj_hrv_2sd';
      if (!isReversed && firstForward) {
        firstForward = false;
        return { value: responseFor(packet, { caseA: 'wrong' }), telemetry: { promptTokens: 1 } };
      }
      return {
        value: responseFor(packet, { preference: isReversed ? 'B_better' : 'A_better' }),
        telemetry: { promptTokens: 10 },
      };
    });

    const casesById = new Map([
      ['judge_obj_neutral', dummyCaseA],
      ['judge_obj_hrv_2sd', dummyCaseB],
    ]);

    const outcome = await executeFamilyPairwiseEvaluations({
      familyId: 'objective_recovery',
      edges: [dummyEdge],
      casesById,
      config: { rubricScale: '0-4', checkPositionBias: true },
      seed: 42,
      sampleIndex: 0,
      callProviderFn: mockCallProvider,
    });

    expect(mockCallProvider).toHaveBeenCalledTimes(3);
    expect(outcome.pairwiseResults).toHaveLength(1);
    expect(outcome.pairwiseResults[0].isSymmetric).toBe(true);
    expect(outcome.pairwiseResults[0].telemetry.forward).toEqual({ promptTokens: 10 });
    expect(outcome.positionBias.positionBiasIndex).toBe(0);
    expect(outcome.positionBias.orderInstabilityIndex).toBe(0);
    expect(outcome.edgeSensitivitySummary.appropriateEdges).toBe(1);
  });

  it('fails closed when an edge references a case missing from the family packet', async () => {
    await expect(executeFamilyPairwiseEvaluations({
      familyId: 'objective_recovery',
      edges: [dummyEdge],
      casesById: new Map([['judge_obj_neutral', dummyCaseA]]),
      config: { rubricScale: '0-4', checkPositionBias: false },
      seed: 42,
      callProviderFn: vi.fn(),
    })).rejects.toThrow(/missing pairwise case/);
  });
});
