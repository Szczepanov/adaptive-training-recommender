import { describe, expect, it } from 'vitest';

import {
  aggregateSelfTestSamples,
  buildSelfTestPacket,
  computeSelfTestMetrics,
  loadSelfTestFixtures,
  quadraticWeightedKappa,
  resolveJsonPointer,
  validateSelfTestResponse,
} from '../selfTest.mjs';
import { SELF_TEST_RESPONSE_SCHEMA, generateSelfTestResponseSchema } from '../selfTestSchema.mjs';

function makePerfectResult(fixtures, cases = fixtures.cases) {
  return {
    schema: SELF_TEST_RESPONSE_SCHEMA,
    suiteId: fixtures.suiteId,
    results: cases.map((fixture) => {
      const rule = fixtures.expected.cases[fixture.caseId];
      const evidenceReferences = [...new Set((rule.mustReferenceAnyOf ?? []).map((group) => group[0]))];
      if (evidenceReferences.length === 0) evidenceReferences.push('/focusPlanId');
      return {
        caseId: fixture.caseId,
        absoluteClass: rule.ordinalTarget,
        reactionClass: rule.allowedReactionClasses[0],
        preferredPlanId: rule.allowedPreferredPlanIds[0],
        diagnosticAssessment: rule.allowedDiagnosticAssessments[0],
        evidenceReferences,
        observations: [{ text: 'The cited packet facts support the judgment.', evidenceReferences }],
        hypotheses: [],
        numericParameterCandidates: [],
        rationale: 'Judgment follows the anchored rubric and cited factual fields.',
      };
    }),
  };
}

describe('AI judge self-test calibration contract', () => {
  const fixtures = loadSelfTestFixtures();

  it('loads 20–40 unique controls covering every required category', () => {
    expect(fixtures.cases.length).toBeGreaterThanOrEqual(20);
    expect(fixtures.cases.length).toBeLessThanOrEqual(40);
    expect(new Set(fixtures.cases.map((item) => item.caseId)).size).toBe(fixtures.cases.length);
    expect(new Set(fixtures.cases.map((item) => item.category))).toEqual(new Set([
      'hard_control',
      'correct_non_reaction',
      'deliberate_overreaction',
      'deliberate_underreaction',
      'event_specificity',
      'bias_adversarial',
      'temporal_semantics',
      'root_cause_discipline',
    ]));
  });

  it('builds blind primary packets without expectations, categories, or source diagnostics', () => {
    const fixture = fixtures.cases.find((item) => item.caseId === 'cal_bias_false_diagnostic');
    const packet = buildSelfTestPacket(fixture);
    expect(packet).not.toHaveProperty('sourceDiagnostics');
    expect(packet).not.toHaveProperty('category');
    expect(packet).not.toHaveProperty('expected');
    expect(JSON.stringify(packet)).not.toContain('CRITICAL: hard restriction violated');
  });

  it('reverses presentation order while preserving stable plan identities', () => {
    const forward = buildSelfTestPacket(fixtures.cases.find((item) => item.caseId === 'cal_bias_verbose_ab'));
    const reverse = buildSelfTestPacket(fixtures.cases.find((item) => item.caseId === 'cal_bias_verbose_ba'));
    expect(forward.plans.map((plan) => plan.planId)).toEqual(['concise_plan', 'verbose_plan']);
    expect(reverse.plans.map((plan) => plan.planId)).toEqual(['verbose_plan', 'concise_plan']);
  });

  it('generates an exact per-batch schema with anchored classes and case IDs', () => {
    const cases = fixtures.cases.slice(0, 3);
    const schema = generateSelfTestResponseSchema(fixtures.suiteId, cases);
    expect(schema.properties.results.minItems).toBe(3);
    expect(schema.properties.results.maxItems).toBe(3);
    expect(schema.properties.results.items.properties.caseId.enum).toEqual(cases.map((item) => item.caseId));
    expect(schema.properties.results.items.properties.absoluteClass).toMatchObject({ type: 'integer', minimum: 0, maximum: 4 });
    expect(schema.properties.results.items.properties.evidenceReferences.items.pattern).toContain('inputContext|plans|comparison|focusPlanId');
    expect(schema.additionalProperties).toBe(false);
  });

  it('strictly validates a complete response and every evidence pointer', () => {
    const cases = fixtures.cases.slice(0, 3);
    const value = makePerfectResult(fixtures, cases);
    const validated = validateSelfTestResponse(value, fixtures.suiteId, cases);
    expect(validated.results).toHaveLength(3);
    expect(resolveJsonPointer(buildSelfTestPacket(cases[0]), validated.results[0].evidenceReferences[0])).toBeDefined();
  });

  it('rejects duplicate cases, unresolved pointers, and non-speculative hypotheses', () => {
    const cases = fixtures.cases.slice(0, 2);
    const duplicate = makePerfectResult(fixtures, cases);
    duplicate.results[1].caseId = duplicate.results[0].caseId;
    expect(() => validateSelfTestResponse(duplicate, fixtures.suiteId, cases)).toThrow(/Duplicate self-test caseId/);

    const badPointer = makePerfectResult(fixtures, cases);
    badPointer.results[0].evidenceReferences = ['/not/in/the/packet'];
    expect(() => validateSelfTestResponse(badPointer, fixtures.suiteId, cases)).toThrow(/unresolved JSON Pointer/);

    const badHypothesis = makePerfectResult(fixtures, cases);
    badHypothesis.results[0].hypotheses = [{ text: 'Certain internal cause.', speculative: false, evidenceReferences: [] }];
    expect(() => validateSelfTestResponse(badHypothesis, fixtures.suiteId, cases)).toThrow(/speculative must be true/);
  });

  it('computes perfect calibration metrics with raw counts and kappa', () => {
    const result = validateSelfTestResponse(makePerfectResult(fixtures), fixtures.suiteId, fixtures.cases);
    const metrics = computeSelfTestMetrics([{ sampleIndex: 0, result }], fixtures.cases, fixtures.expected);
    expect(metrics.rates.fullControlPassRate).toBe(1);
    expect(metrics.rates.absoluteRangeAccuracy).toBe(1);
    expect(metrics.quadraticWeightedKappa).toBe(1);
    expect(metrics.rates.evidenceReferenceValidity).toBe(1);
    expect(metrics.counts.forbiddenClaimViolations).toBe(0);
    expect(metrics.counts.misleadingDiagnosticFalsePositives).toBe(0);
    expect(metrics.rates.orderConsistency).toBe(1);
  });

  it('surfaces order bias, false diagnostics, forbidden claims, and parameter candidates', () => {
    const raw = makePerfectResult(fixtures);
    raw.results.find((item) => item.caseId === 'cal_bias_verbose_ba').preferredPlanId = 'concise_plan';
    raw.results.find((item) => item.caseId === 'cal_bias_false_diagnostic').diagnosticAssessment = 'supported';
    const root = raw.results.find((item) => item.caseId === 'cal_root_cause_unknown');
    root.hypotheses = [{
      text: 'The input is definitely not passed to function X.',
      speculative: true,
      evidenceReferences: ['/inputContext/internalTraceAvailable'],
    }];
    root.numericParameterCandidates = [{ text: 'Use a universal HRV cutoff of -2.0.', evidenceReferences: ['/inputContext/internalTraceAvailable'] }];
    const validated = validateSelfTestResponse(raw, fixtures.suiteId, fixtures.cases);
    const metrics = computeSelfTestMetrics([{ sampleIndex: 0, result: validated }], fixtures.cases, fixtures.expected);
    expect(metrics.rates.orderConsistency).toBeLessThan(1);
    expect(metrics.counts.misleadingDiagnosticFalsePositives).toBe(1);
    expect(metrics.counts.forbiddenClaimViolations).toBeGreaterThanOrEqual(2);
    expect(metrics.counts.numericParameterCandidateViolations).toBe(1);
  });

  it('aggregates repeated samples with median, MAD, and categorical agreement', () => {
    const first = validateSelfTestResponse(makePerfectResult(fixtures), fixtures.suiteId, fixtures.cases);
    const secondRaw = makePerfectResult(fixtures);
    secondRaw.results[0].absoluteClass = 1;
    const second = validateSelfTestResponse(secondRaw, fixtures.suiteId, fixtures.cases);
    const aggregate = aggregateSelfTestSamples([
      { sampleIndex: 0, result: first },
      { sampleIndex: 1, result: second },
    ], fixtures.cases);
    expect(aggregate[0].absoluteClass).toBe(0.5);
    expect(aggregate[0].stability.absoluteClassMad).toBe(0.5);
    expect(aggregate[0].stability.reactionAgreement).toBe(1);
  });

  it('computes quadratic weighted kappa for perfect and degraded ordinal judgments', () => {
    expect(quadraticWeightedKappa([0, 1, 2, 3, 4], [0, 1, 2, 3, 4])).toBe(1);
    expect(quadraticWeightedKappa([0, 1, 2, 3, 4], [4, 3, 2, 1, 0])).toBeLessThan(0);
    expect(quadraticWeightedKappa([], [])).toBeNull();
  });
});
