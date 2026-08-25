import { describe, expect, it } from 'vitest';
import {
  median,
  mad,
  deriveSampleSeed,
  aggregateFamilySamples,
} from '../aggregate.mjs';
import { REQUIRED_SCORES, RESPONSE_SCHEMA_V1 } from '../schema.mjs';

describe('AI Judge Multi-Sample Aggregation', () => {
  it('computes exact medians for odd and even arrays', () => {
    expect(median([5, 1, 9])).toBe(5);
    expect(median([1, 2, 8, 9])).toBe(5); // (2+8)/2 = 5
    expect(median([7])).toBe(7);
  });

  it('computes Median Absolute Deviation (MAD)', () => {
    // Array: [1, 2, 3, 4, 5, 6, 7], median = 4
    // Deviations: [3, 2, 1, 0, 1, 2, 3] -> sorted: [0, 1, 1, 2, 2, 3, 3], median = 2
    expect(mad([1, 2, 3, 4, 5, 6, 7])).toBe(2);
    expect(mad([5, 5, 5])).toBe(0);
  });

  it('derives stable pseudo-random seeds per sample', () => {
    const seed1 = deriveSampleSeed(42, 'fam1', 0);
    const seed2 = deriveSampleSeed(42, 'fam1', 1);
    const seed1Again = deriveSampleSeed(42, 'fam1', 0);

    expect(seed1).toBe(seed1Again);
    expect(seed1).not.toBe(seed2);
    expect(Number.isInteger(seed1)).toBe(true);
  });

  it('aggregates multiple independent samples into median scores and stability metrics', () => {
    const familyId = 'fam_test';
    const caseIds = ['case_1'];

    const sample1 = {
      sampleIndex: 0,
      seed: 100,
      result: {
        schema: RESPONSE_SCHEMA_V1,
        familyId,
        caseScores: [
          {
            caseId: 'case_1',
            scores: Object.fromEntries(REQUIRED_SCORES.map((k) => [k, 7])),
            confidence: 0.8,
            flags: ['flagA'],
            rationale: 'Sample 1 rationale',
            suggestedChanges: [],
          },
        ],
        familyAssessment: {
          sensitivity_quality: 7.0,
          overreactionCases: [],
          underreactionCases: [],
          goodSensitivityCases: ['case_1'],
          rationale: 'Sample 1 fam rationale',
          algorithmAdjustmentHypotheses: ['Hypothesis A'],
        },
      },
    };

    const sample2 = {
      sampleIndex: 1,
      seed: 101,
      result: {
        schema: RESPONSE_SCHEMA_V1,
        familyId,
        caseScores: [
          {
            caseId: 'case_1',
            scores: Object.fromEntries(REQUIRED_SCORES.map((k) => [k, 8])),
            confidence: 0.9,
            flags: ['flagA', 'flagB'],
            rationale: 'Sample 2 rationale',
            suggestedChanges: [],
          },
        ],
        familyAssessment: {
          sensitivity_quality: 8.0,
          overreactionCases: [],
          underreactionCases: [],
          goodSensitivityCases: ['case_1'],
          rationale: 'Sample 2 fam rationale',
          algorithmAdjustmentHypotheses: ['Hypothesis A', 'Hypothesis B'],
        },
      },
    };

    const sample3 = {
      sampleIndex: 2,
      seed: 102,
      result: {
        schema: RESPONSE_SCHEMA_V1,
        familyId,
        caseScores: [
          {
            caseId: 'case_1',
            scores: Object.fromEntries(REQUIRED_SCORES.map((k) => [k, 7.5])),
            confidence: 0.85,
            flags: ['flagA'],
            rationale: 'Sample 3 rationale',
            suggestedChanges: [],
          },
        ],
        familyAssessment: {
          sensitivity_quality: 7.5,
          overreactionCases: [],
          underreactionCases: [],
          goodSensitivityCases: ['case_1'],
          rationale: 'Sample 3 fam rationale',
          algorithmAdjustmentHypotheses: ['Hypothesis A'],
        },
      },
    };

    const { aggregateResult, stability } = aggregateFamilySamples(familyId, [sample1, sample2, sample3], caseIds);

    expect(aggregateResult.caseScores[0].scores.overall).toBe(7.5);
    expect(aggregateResult.caseScores[0].confidence).toBe(0.85);
    expect(aggregateResult.caseScores[0].flags).toContain('flagA'); // Majority flag
    expect(aggregateResult.familyAssessment.sensitivity_quality).toBe(7.5);

    expect(stability.samples).toBe(3);
    expect(stability.familySensitivityMedian).toBe(7.5);
    expect(stability.familySensitivityMad).toBe(0.5); // [7, 7.5, 8] -> med 7.5, devs [0.5, 0, 0.5] -> med 0.5
    expect(stability.cases.case_1.maxSpread).toBe(1.0); // 8 - 7

    // Hypothesis A appears in all 3 samples (majority), Hypothesis B in only 1 (single-sample noise).
    expect(aggregateResult.familyAssessment.algorithmAdjustmentHypotheses).toContain('Hypothesis A');
    expect(aggregateResult.familyAssessment.algorithmAdjustmentHypotheses).not.toContain('Hypothesis B');
  });
});
