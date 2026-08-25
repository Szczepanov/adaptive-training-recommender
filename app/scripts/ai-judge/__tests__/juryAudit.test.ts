import { describe, expect, it } from 'vitest';

import {
  assertCompatibleReferenceRuns,
  buildReferenceAudit,
  renderReferenceAuditMarkdown,
} from '../juryAudit.mjs';
import { SELF_TEST_SUMMARY_SCHEMA } from '../selfTestSchema.mjs';

function summary(runLabel, model, overrides = {}) {
  return {
    schema: SELF_TEST_SUMMARY_SCHEMA,
    runLabel,
    provenance: {
      suiteId: 'suite-1',
      casesSha256: 'cases',
      expectedSha256: 'expected',
      caseSetSha256: 'case-set',
      promptSha256: 'prompt',
      responseSchema: 'response@1',
      runtimeSchemaSha256: 'runtime-schema',
      provider: 'local',
      model,
      modelDigest: `${model}-digest`,
      quantization: 'Q4',
      samples: 3,
      baseSeed: 42,
      seedStrategy: 'derived',
      thinkingEnabled: true,
      batchSize: 6,
      inferenceSha256: 'same-inference-profile',
      ...overrides,
    },
    metrics: {
      rates: {
        absoluteRangeAccuracy: 0.9,
        reactionAccuracy: 0.8,
        fullControlPassRate: 0.75,
        orderConsistency: 1,
        retestAbsoluteAgreement: 0.8,
        retestReactionAgreement: 0.9,
        misleadingDiagnosticFalsePositiveRate: 0,
        requiredEvidenceCoverage: 1,
      },
      quadraticWeightedKappa: 0.82,
      counts: { evidenceReferences: 10, forbiddenClaimViolations: 0, numericParameterCandidateViolations: 0 },
    },
    telemetry: {
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
      wallClockMs: 1000,
      acceptedInferenceMs: 900,
      schemaEnforcementRate: 1,
      estimatedCostUsd: 0.01,
    },
    aggregateResults: [
      { caseId: 'case-a', absoluteClass: 3, reactionClass: 'appropriate', preferredPlanId: 'none' },
      { caseId: 'case-b', absoluteClass: 1, reactionClass: 'underreaction', preferredPlanId: 'none' },
    ],
  };
}

describe('AI judge reference/jury audit', () => {
  it('compares compatible runs across different models without selecting a winner', () => {
    const loaded = [
      { path: 'q4.json', value: summary('q4', 'model-q4') },
      { path: 'q6.json', value: summary('q6', 'model-q6') },
    ];
    const audit = buildReferenceAudit(loaded, '2026-08-25T00:00:00.000Z');
    expect(audit.runs).toHaveLength(2);
    expect(audit.pairwiseComparisons[0].reactionAgreement).toBe(1);
    expect(audit.pairwiseComparisons[0].changedEvaluatorAxes).toEqual(['model', 'modelDigest']);
    expect(audit).not.toHaveProperty('winner');
    expect(audit.interpretation).toMatch(/No automatic winner/);
    expect(audit.runs[0]).toMatchObject({ estimatedCostUsd: 0.01, schemaEnforcementRate: 1, acceptedInferenceMs: 900 });
  });

  it('fails closed with the exact incompatible contract field', () => {
    const loaded = [
      { path: 'q4.json', value: summary('q4', 'model-q4') },
      { path: 'q6.json', value: summary('q6', 'model-q6', { promptSha256: 'changed-prompt' }) },
    ];
    expect(() => assertCompatibleReferenceRuns(loaded)).toThrow(/contract mismatch for 'promptSha256'/);
  });

  it('makes multi-axis evaluator comparisons explicit', () => {
    const loaded = [
      { path: 'q4.json', value: summary('q4', 'model-q4') },
      {
        path: 'quick.json',
        value: summary('quick', 'model-quick', {
          thinkingEnabled: false,
          inferenceSha256: 'different-inference-profile',
        }),
      },
    ];
    const audit = buildReferenceAudit(loaded);
    expect(audit.pairwiseComparisons[0].changedEvaluatorAxes).toEqual([
      'model',
      'modelDigest',
      'thinkingEnabled',
      'inferenceProfile',
    ]);
    expect(audit.interpretation).toMatch(/confounded/);
  });

  it('surfaces cross-evaluator disagreement and renders provenance', () => {
    const left = summary('q4', 'model-q4');
    const right = summary('reference', 'model-reference');
    right.aggregateResults[1] = { caseId: 'case-b', absoluteClass: 2, reactionClass: 'appropriate', preferredPlanId: 'none' };
    const audit = buildReferenceAudit([
      { path: 'q4.json', value: left },
      { path: 'reference.json', value: right },
    ]);
    expect(audit.pairwiseComparisons[0].disagreements).toHaveLength(1);
    expect(audit.pairwiseComparisons[0].absoluteClassAgreement).toBe(0.5);
    const markdown = renderReferenceAuditMarkdown(audit);
    expect(markdown).toContain('model-q4');
    expect(markdown).toContain('model-reference');
    expect(markdown).toContain('Changed evaluator axes');
    expect(markdown).toContain('Native schema');
    expect(markdown).toContain('comparability break');
  });
});
