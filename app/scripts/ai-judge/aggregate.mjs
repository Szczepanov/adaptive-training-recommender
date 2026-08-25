import { createHash } from 'node:crypto';
import { REQUIRED_SCORES, RESPONSE_SCHEMA_V1 } from './schema.mjs';

export function deriveSampleSeed(baseSeed, familyId, sampleIndex, strategy = 'derived') {
  if (strategy === 'fixed') return baseSeed;
  const hash = createHash('sha256').update(`${baseSeed}:${familyId}:${sampleIndex}`).digest();
  return hash.readUInt32BE(0) % 1000000000;
}

export function median(numbers) {
  if (!Array.isArray(numbers) || numbers.length === 0) return 0;
  const sorted = [...numbers].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return Math.round(((sorted[mid - 1] + sorted[mid]) / 2) * 100) / 100;
}

export function mad(numbers) {
  if (!Array.isArray(numbers) || numbers.length === 0) return 0;
  const med = median(numbers);
  const deviations = numbers.map((x) => Math.abs(x - med));
  return median(deviations);
}

export function round2(num) {
  return Math.round(num * 100) / 100;
}

export function aggregateFamilySamples(familyId, sampleRecords, expectedCaseIds) {
  if (!Array.isArray(sampleRecords) || sampleRecords.length === 0) {
    throw new Error(`aggregateFamilySamples for ${familyId} requires at least one sample record`);
  }

  const sampleCount = sampleRecords.length;

  if (sampleCount === 1) {
    const single = sampleRecords[0].result;
    return {
      aggregateResult: single,
      stability: {
        familyId,
        samples: 1,
        familySensitivityMedian: single.familyAssessment.sensitivity_quality,
        familySensitivityMad: 0,
        familySensitivitySpread: 0,
        dimensionMadAverages: Object.fromEntries(REQUIRED_SCORES.map((k) => [k, 0])),
        cases: Object.fromEntries(
          expectedCaseIds.map((caseId) => [
            caseId,
            {
              scoreMedians: Object.fromEntries(
                REQUIRED_SCORES.map((k) => [k, single.caseScores.find((c) => c.caseId === caseId)?.scores[k] ?? 0])
              ),
              dimensionMads: Object.fromEntries(REQUIRED_SCORES.map((k) => [k, 0])),
              maxSpread: 0,
              observedAgreement: 1.0,
            },
          ])
        ),
      },
    };
  }

  // Multi-sample aggregation
  const caseAggregations = expectedCaseIds.map((caseId) => {
    const caseSamples = sampleRecords.map((s) => s.result.caseScores.find((c) => c.caseId === caseId)).filter(Boolean);
    if (caseSamples.length !== sampleCount) {
      throw new Error(`Case ${caseId} in ${familyId} has missing sample records`);
    }

    const scoreMedians = {};
    const scoreMads = {};
    const scoreRanges = {};

    let maxSpread = 0;
    for (const key of REQUIRED_SCORES) {
      const vals = caseSamples.map((cs) => cs.scores[key]);
      const med = median(vals);
      const m = mad(vals);
      const min = Math.min(...vals);
      const max = Math.max(...vals);
      const spread = round2(max - min);

      scoreMedians[key] = med;
      scoreMads[key] = m;
      scoreRanges[key] = { min, max, spread };
      if (spread > maxSpread) maxSpread = spread;
    }

    const confidences = caseSamples.map((cs) => cs.confidence);
    const confidenceMed = median(confidences);

    // Pick representative rationale: the sample whose scores have smallest sum-of-differences from medians
    let bestSampleIdx = 0;
    let minDiff = Infinity;
    caseSamples.forEach((cs, idx) => {
      let diff = 0;
      for (const k of REQUIRED_SCORES) diff += Math.abs(cs.scores[k] - scoreMedians[k]);
      if (diff < minDiff) {
        minDiff = diff;
        bestSampleIdx = idx;
      }
    });

    const representativeCase = caseSamples[bestSampleIdx];

    // Collect all flags and suggested changes that appear in at least ceil(N/2) samples
    const flagCounts = new Map();
    const changeCounts = new Map();
    for (const cs of caseSamples) {
      for (const f of cs.flags ?? []) flagCounts.set(f, (flagCounts.get(f) ?? 0) + 1);
      for (const ch of cs.suggestedChanges ?? []) changeCounts.set(ch, (changeCounts.get(ch) ?? 0) + 1);
    }

    const majorityThreshold = Math.ceil(sampleCount / 2);
    const consensusFlags = [...flagCounts.entries()]
      .filter(([, count]) => count >= majorityThreshold)
      .map(([f]) => f);
    const consensusChanges = [...changeCounts.entries()]
      .filter(([, count]) => count >= majorityThreshold)
      .map(([ch]) => ch);

    return {
      caseId,
      scores: scoreMedians,
      confidence: confidenceMed,
      flags: consensusFlags.length ? consensusFlags : representativeCase.flags,
      rationale: representativeCase.rationale,
      suggestedChanges: consensusChanges.length ? consensusChanges : representativeCase.suggestedChanges,
      // Metadata for stability
      _stability: {
        dimensionMads: scoreMads,
        scoreRanges,
        maxSpread,
      },
    };
  });

  // Family Assessment Aggregation
  const assessments = sampleRecords.map((s) => s.result.familyAssessment);
  const sensVals = assessments.map((a) => a.sensitivity_quality);
  const sensMedian = median(sensVals);
  const sensMad = mad(sensVals);
  const sensMin = Math.min(...sensVals);
  const sensMax = Math.max(...sensVals);
  const sensSpread = round2(sensMax - sensMin);

  // Categorical lists modal resolution
  const resolveModalCaseList = (field) => {
    const counts = new Map();
    for (const a of assessments) {
      for (const id of a[field] ?? []) {
        counts.set(id, (counts.get(id) ?? 0) + 1);
      }
    }
    const majorityThreshold = Math.ceil(sampleCount / 2);
    return [...counts.entries()]
      .filter(([, count]) => count >= majorityThreshold)
      .map(([id]) => id);
  };

  const overreactionCases = resolveModalCaseList('overreactionCases');
  const underreactionCases = resolveModalCaseList('underreactionCases');
  const goodSensitivityCases = resolveModalCaseList('goodSensitivityCases');

  // Pick representative family rationale
  let bestFamIdx = 0;
  let minFamDiff = Infinity;
  assessments.forEach((a, idx) => {
    const diff = Math.abs(a.sensitivity_quality - sensMedian);
    if (diff < minFamDiff) {
      minFamDiff = diff;
      bestFamIdx = idx;
    }
  });

  // Collect hypotheses that appear across multiple samples
  const hypCounts = new Map();
  for (const a of assessments) {
    for (const h of a.algorithmAdjustmentHypotheses ?? []) {
      hypCounts.set(h, (hypCounts.get(h) ?? 0) + 1);
    }
  }
  const modalHypotheses = [...hypCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([h]) => h);

  const aggregateResult = {
    schema: RESPONSE_SCHEMA_V1,
    familyId,
    caseScores: caseAggregations.map(({ _stability, ...rest }) => rest),
    familyAssessment: {
      sensitivity_quality: sensMedian,
      overreactionCases,
      underreactionCases,
      goodSensitivityCases,
      rationale: assessments[bestFamIdx].rationale,
      algorithmAdjustmentHypotheses: modalHypotheses.length ? modalHypotheses : assessments[bestFamIdx].algorithmAdjustmentHypotheses,
    },
  };

  const dimMadAverages = {};
  for (const k of REQUIRED_SCORES) {
    dimMadAverages[k] = round2(
      caseAggregations.reduce((sum, ca) => sum + ca._stability.dimensionMads[k], 0) / caseAggregations.length
    );
  }

  const stability = {
    familyId,
    samples: sampleCount,
    familySensitivityMedian: sensMedian,
    familySensitivityMad: sensMad,
    familySensitivitySpread: sensSpread,
    dimensionMadAverages: dimMadAverages,
    cases: Object.fromEntries(
      caseAggregations.map((ca) => [
        ca.caseId,
        {
          scoreMedians: ca.scores,
          dimensionMads: ca._stability.dimensionMads,
          maxSpread: ca._stability.maxSpread,
        },
      ])
    ),
  };

  return {
    aggregateResult,
    stability,
  };
}
