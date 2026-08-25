import { describe, expect, it } from 'vitest';
import {
  generatePairwiseResponseSchema,
  formatPairwiseComparisonPacket,
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

  it('generates valid pairwise response schema with Task 4.3 fields for 0..4 scale', () => {
    const schema = generatePairwiseResponseSchema('0-4');
    expect(schema.required).toContain('expectedDirection');
    expect(schema.required).toContain('expectedMagnitude');
    expect(schema.required).toContain('actualResponseAssessment');
    expect(schema.required).toContain('confidence');
    expect(schema.required).toContain('evidence');
    expect(schema.required).toContain('preference');
    expect(schema.properties.sensitivityScore.maximum).toBe(4);
  });

  it('formats pairwise comparison packets and handles order swap correctly', () => {
    const forward = formatPairwiseComparisonPacket({
      familyId: 'objective_recovery',
      edge: dummyEdge,
      caseA: dummyCaseA,
      caseB: dummyCaseB,
      isSwapped: false,
    });

    expect(forward.caseA.caseId).toBe('judge_obj_neutral');
    expect(forward.caseB.caseId).toBe('judge_obj_hrv_2sd');
    expect(forward.expectedDirection).toBe('less_load');
    expect(forward.expectedMagnitude).toBe('moderate');

    const reversed = formatPairwiseComparisonPacket({
      familyId: 'objective_recovery',
      edge: dummyEdge,
      caseA: dummyCaseA,
      caseB: dummyCaseB,
      isSwapped: true,
    });

    expect(reversed.caseA.caseId).toBe('judge_obj_hrv_2sd');
    expect(reversed.caseB.caseId).toBe('judge_obj_neutral');
  });

  it('detects symmetric judgments between forward and reversed order evaluations', () => {
    const forwardResult = {
      expectedDirection: 'less_load',
      expectedMagnitude: 'moderate',
      actualResponseAssessment: 'appropriate',
      confidence: 0.95,
      evidence: ['Systemic load decreased from 0.7 to 0.2'],
      preference: 'A_better',
      sensitivityScore: 4,
      rationale: 'Case B appropriately reduced training load.',
    };

    // When reversed, original Case A is in slot B, so preference should be B_better
    const reversedSymmetricResult = {
      expectedDirection: 'less_load',
      expectedMagnitude: 'moderate',
      actualResponseAssessment: 'appropriate',
      confidence: 0.95,
      evidence: ['Systemic load decreased from 0.7 to 0.2'],
      preference: 'B_better',
      sensitivityScore: 4,
      rationale: 'Original Case A in slot B has better baseline structure.',
    };

    const evalResult = evaluateOrderSwapConsistency(forwardResult, reversedSymmetricResult);
    expect(evalResult.isSymmetric).toBe(true);
    expect(evalResult.positionUnstable).toBe(false);
    expect(evalResult.positionBiasDetected).toBe(false);
  });

  it('detects position bias and marks positionUnstable when evaluator prefers slot A regardless of case swap', () => {
    const forwardResult = {
      expectedDirection: 'less_load',
      expectedMagnitude: 'moderate',
      actualResponseAssessment: 'appropriate',
      confidence: 0.9,
      evidence: ['Plan changed'],
      preference: 'A_better',
      sensitivityScore: 4,
      rationale: 'Prefer slot A.',
    };

    // Position-biased evaluator keeps picking slot A even when cases are swapped
    const reversedBiasedResult = {
      expectedDirection: 'less_load',
      expectedMagnitude: 'moderate',
      actualResponseAssessment: 'appropriate',
      confidence: 0.9,
      evidence: ['Plan changed'],
      preference: 'A_better', // Flaw: should be B_better if symmetric
      sensitivityScore: 4,
      rationale: 'Still preferring slot A.',
    };

    const evalResult = evaluateOrderSwapConsistency(forwardResult, reversedBiasedResult);
    expect(evalResult.isSymmetric).toBe(false);
    expect(evalResult.positionUnstable).toBe(true);
    expect(evalResult.positionBiasDetected).toBe(true);
  });

  it('computes position bias index across evaluated edge collections', () => {
    const pairs = [
      { isSymmetric: true },
      { isSymmetric: true },
      { isSymmetric: false },
      { isSymmetric: true },
    ];

    const bias = computePositionBiasIndex(pairs);
    expect(bias.totalPairs).toBe(4);
    expect(bias.symmetricPairs).toBe(3);
    expect(bias.biasedPairs).toBe(1);
    expect(bias.positionBiasIndex).toBe(0.25);
  });

  it('derives mathematical family sensitivity summary from edge judgments (Task 4.5)', () => {
    const edgeResults = [
      { forward: { actualResponseAssessment: 'appropriate' }, positionUnstable: false },
      { forward: { actualResponseAssessment: 'appropriate' }, positionUnstable: false },
      { forward: { actualResponseAssessment: 'underreact' }, positionUnstable: false },
      { forward: { actualResponseAssessment: 'appropriate' }, positionUnstable: true },
    ];

    const summary = deriveFamilySensitivityFromEdges(edgeResults);
    expect(summary.totalEdges).toBe(4);
    expect(summary.appropriateEdges).toBe(3);
    expect(summary.underreactCount).toBe(1);
    expect(summary.overreactCount).toBe(0);
    expect(summary.positionUnstableCount).toBe(1);
    expect(summary.appropriateRatio).toBe(0.75);
    expect(summary.derivedSensitivityScore4).toBeGreaterThanOrEqual(2);
    expect(summary.derivedSensitivityScore10).toBeGreaterThanOrEqual(5.0);
  });

  it('executes family pairwise evaluations with mock provider', async () => {
    const mockCallProvider = async ({ packetJson }) => {
      const packet = JSON.parse(packetJson);
      const isReversed = packet.caseA.caseId === 'judge_obj_hrv_2sd';
      return {
        value: {
          schema: 'adaptive-training-recommender/ai-plan-judge-pairwise@1',
          familyId: 'objective_recovery',
          caseA: packet.caseA.caseId,
          caseB: packet.caseB.caseId,
          expectedDirection: 'less_load',
          expectedMagnitude: 'moderate',
          actualResponseAssessment: 'appropriate',
          confidence: 0.9,
          evidence: ['Reduced systemic load from 0.7 to 0.2'],
          preference: isReversed ? 'B_better' : 'A_better',
          sensitivityScore: 4,
          rationale: 'Appropriate load reduction.',
        },
      };
    };

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

    expect(outcome.pairwiseResults).toHaveLength(1);
    expect(outcome.pairwiseResults[0].isSymmetric).toBe(true);
    expect(outcome.pairwiseResults[0].positionUnstable).toBe(false);
    expect(outcome.positionBias.positionBiasIndex).toBe(0);
    expect(outcome.edgeSensitivitySummary.appropriateEdges).toBe(1);
  });
});
