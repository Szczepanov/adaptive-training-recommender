import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { REACTION_CLASSES, SELF_TEST_SUMMARY_SCHEMA } from './selfTestSchema.mjs';

export const REFERENCE_AUDIT_SCHEMA = 'adaptive-training-recommender/ai-judge-reference-audit@1';

export const REFERENCE_CONTRACT_FIELDS = [
  'suiteId',
  'casesSha256',
  'expectedSha256',
  'caseSetSha256',
  'promptSha256',
  'responseSchema',
  'runtimeSchemaSha256',
  'samples',
  'baseSeed',
  'seedStrategy',
  'batchSize',
];

function rate(numerator, denominator) {
  return denominator === 0 ? null : Math.round((numerator / denominator) * 10000) / 10000;
}

function readSummaryPath(inputPath) {
  const absolute = resolve(inputPath);
  if (existsSync(absolute) && !absolute.endsWith('.json')) {
    return resolve(absolute, 'self-test-summary.json');
  }
  return absolute;
}

function validateAggregateResults(path, summary) {
  if (!Array.isArray(summary.aggregateResults) || summary.aggregateResults.length === 0) {
    throw new Error(`${path} must contain non-empty aggregateResults.`);
  }
  const seen = new Set();
  for (const [index, result] of summary.aggregateResults.entries()) {
    if (!result || typeof result !== 'object' || Array.isArray(result)) {
      throw new Error(`${path} aggregateResults[${index}] must be an object.`);
    }
    if (typeof result.caseId !== 'string' || !result.caseId.trim()) {
      throw new Error(`${path} aggregateResults[${index}].caseId must be a non-empty string.`);
    }
    if (seen.has(result.caseId)) throw new Error(`${path} contains duplicate aggregate case '${result.caseId}'.`);
    seen.add(result.caseId);
    if (typeof result.absoluteClass !== 'number' || !Number.isFinite(result.absoluteClass)
      || result.absoluteClass < 0 || result.absoluteClass > 4) {
      throw new Error(`${path} aggregate case '${result.caseId}' has invalid absoluteClass.`);
    }
    if (!REACTION_CLASSES.includes(result.reactionClass)) {
      throw new Error(`${path} aggregate case '${result.caseId}' has invalid reactionClass.`);
    }
    if (typeof result.preferredPlanId !== 'string' || !result.preferredPlanId.trim()) {
      throw new Error(`${path} aggregate case '${result.caseId}' has invalid preferredPlanId.`);
    }
  }
}

export function loadSelfTestSummary(inputPath) {
  const path = readSummaryPath(inputPath);
  if (!existsSync(path)) throw new Error(`Self-test summary does not exist: ${path}`);
  const value = JSON.parse(readFileSync(path, 'utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.schema !== SELF_TEST_SUMMARY_SCHEMA) {
    throw new Error(`${path} is not a ${SELF_TEST_SUMMARY_SCHEMA} artifact.`);
  }
  if (!value.provenance || typeof value.provenance !== 'object' || Array.isArray(value.provenance)
    || !value.metrics || typeof value.metrics !== 'object' || Array.isArray(value.metrics)) {
    throw new Error(`${path} is missing provenance or metrics.`);
  }
  if (typeof value.runLabel !== 'string' || !value.runLabel.trim()) throw new Error(`${path} is missing runLabel.`);
  validateAggregateResults(path, value);
  return { path, value };
}

export function assertCompatibleReferenceRuns(loadedRuns) {
  if (!Array.isArray(loadedRuns) || loadedRuns.length < 2) {
    throw new Error('Reference audit requires at least two completed self-test summaries.');
  }
  const reference = loadedRuns[0].value.provenance;
  for (const run of loadedRuns.slice(1)) {
    for (const field of REFERENCE_CONTRACT_FIELDS) {
      if (run.value.provenance[field] !== reference[field]) {
        throw new Error(
          `Reference audit contract mismatch for '${field}': ${loadedRuns[0].value.runLabel}=${JSON.stringify(reference[field])}, ${run.value.runLabel}=${JSON.stringify(run.value.provenance[field])}.`
        );
      }
    }
  }
}

function modelMetrics(summary) {
  return {
    runLabel: summary.runLabel,
    provider: summary.provenance.provider,
    model: summary.provenance.model,
    modelDigest: summary.provenance.modelDigest ?? null,
    quantization: summary.provenance.quantization ?? null,
    thinkingEnabled: summary.provenance.thinkingEnabled,
    inferenceSha256: summary.provenance.inferenceSha256 ?? null,
    absoluteRangeAccuracy: summary.metrics.rates.absoluteRangeAccuracy,
    reactionAccuracy: summary.metrics.rates.reactionAccuracy,
    fullControlPassRate: summary.metrics.rates.fullControlPassRate,
    quadraticWeightedKappa: summary.metrics.quadraticWeightedKappa,
    orderConsistency: summary.metrics.rates.orderConsistency,
    retestAbsoluteAgreement: summary.metrics.rates.retestAbsoluteAgreement,
    retestReactionAgreement: summary.metrics.rates.retestReactionAgreement,
    misleadingDiagnosticFalsePositiveRate: summary.metrics.rates.misleadingDiagnosticFalsePositiveRate,
    evidenceReferenceValidity: summary.metrics.rates.evidenceReferenceValidity,
    requiredEvidenceCoverage: summary.metrics.rates.requiredEvidenceCoverage,
    forbiddenClaimViolations: summary.metrics.counts.forbiddenClaimViolations,
    numericParameterCandidateViolations: summary.metrics.counts.numericParameterCandidateViolations,
    promptTokens: summary.telemetry?.promptTokens ?? null,
    completionTokens: summary.telemetry?.completionTokens ?? null,
    totalTokens: summary.telemetry?.totalTokens ?? null,
    wallClockMs: summary.telemetry?.wallClockMs ?? null,
    acceptedInferenceMs: summary.telemetry?.acceptedInferenceMs ?? null,
    schemaEnforcementRate: summary.telemetry?.schemaEnforcementRate ?? null,
    estimatedCostUsd: summary.telemetry?.estimatedCostUsd ?? null,
  };
}

function changedEvaluatorAxes(left, right) {
  const axes = [
    ['provider', left.provenance.provider, right.provenance.provider],
    ['model', left.provenance.model, right.provenance.model],
    ['modelDigest', left.provenance.modelDigest ?? null, right.provenance.modelDigest ?? null],
    ['quantization', left.provenance.quantization ?? null, right.provenance.quantization ?? null],
    ['thinkingEnabled', left.provenance.thinkingEnabled, right.provenance.thinkingEnabled],
    ['inferenceProfile', left.provenance.inferenceSha256 ?? null, right.provenance.inferenceSha256 ?? null],
  ];
  return axes.filter(([, leftValue, rightValue]) => leftValue !== rightValue).map(([name]) => name);
}

function compareAggregateResults(left, right) {
  const rightById = new Map(right.aggregateResults.map((item) => [item.caseId, item]));
  let cases = 0;
  let absoluteClassAgreements = 0;
  let reactionAgreements = 0;
  let preferredPlanAgreements = 0;
  const disagreements = [];
  for (const leftResult of left.aggregateResults) {
    const rightResult = rightById.get(leftResult.caseId);
    if (!rightResult) throw new Error(`Run ${right.runLabel} is missing aggregate case '${leftResult.caseId}'.`);
    cases += 1;
    const absoluteAgreement = leftResult.absoluteClass === rightResult.absoluteClass;
    const reactionAgreement = leftResult.reactionClass === rightResult.reactionClass;
    const preferredAgreement = leftResult.preferredPlanId === rightResult.preferredPlanId;
    absoluteClassAgreements += Number(absoluteAgreement);
    reactionAgreements += Number(reactionAgreement);
    preferredPlanAgreements += Number(preferredAgreement);
    if (!absoluteAgreement || !reactionAgreement || !preferredAgreement) {
      disagreements.push({
        caseId: leftResult.caseId,
        left: {
          absoluteClass: leftResult.absoluteClass,
          reactionClass: leftResult.reactionClass,
          preferredPlanId: leftResult.preferredPlanId,
        },
        right: {
          absoluteClass: rightResult.absoluteClass,
          reactionClass: rightResult.reactionClass,
          preferredPlanId: rightResult.preferredPlanId,
        },
      });
    }
  }
  if (cases !== right.aggregateResults.length) throw new Error(`Aggregate case cardinality differs between ${left.runLabel} and ${right.runLabel}.`);
  return {
    leftRunLabel: left.runLabel,
    rightRunLabel: right.runLabel,
    cases,
    changedEvaluatorAxes: changedEvaluatorAxes(left, right),
    absoluteClassAgreement: rate(absoluteClassAgreements, cases),
    reactionAgreement: rate(reactionAgreements, cases),
    preferredPlanAgreement: rate(preferredPlanAgreements, cases),
    disagreements,
  };
}

export function buildReferenceAudit(loadedRuns, generatedAt = new Date().toISOString()) {
  assertCompatibleReferenceRuns(loadedRuns);
  const summaries = loadedRuns.map((run) => run.value);
  const pairwiseComparisons = [];
  for (let left = 0; left < summaries.length; left += 1) {
    for (let right = left + 1; right < summaries.length; right += 1) {
      pairwiseComparisons.push(compareAggregateResults(summaries[left], summaries[right]));
    }
  }
  return {
    schema: REFERENCE_AUDIT_SCHEMA,
    generatedAt,
    contract: Object.fromEntries(REFERENCE_CONTRACT_FIELDS.map((field) => [field, summaries[0].provenance[field]])),
    runs: loadedRuns.map((run) => ({ sourcePath: run.path, ...modelMetrics(run.value) })),
    pairwiseComparisons,
    interpretation: 'No automatic winner or model switch is selected. Review expert-label agreement, stability, bias, evidence discipline, structured-output enforcement, runtime, and cost together; comparisons that change multiple evaluator axes are intentionally visible and should be interpreted as confounded rather than causal.',
  };
}

export function renderReferenceAuditMarkdown(audit) {
  const format = (value) => value == null ? 'n/a' : typeof value === 'number' ? value.toFixed(3) : String(value);
  const lines = [
    '# AI judge reference audit',
    '',
    `- Suite: \`${audit.contract.suiteId}\``,
    `- Cases hash: \`${audit.contract.casesSha256}\``,
    `- Expectation hash: \`${audit.contract.expectedSha256}\``,
    `- Samples/seed: ${audit.contract.samples} / ${audit.contract.baseSeed} (${audit.contract.seedStrategy})`,
    '',
    '## Evaluator metrics',
    '',
    '| Run | Provider/model | Thinking | Full pass | QWK | Order | Retest reaction | Diagnostic FP | Evidence valid | Evidence required | Native schema | Unsupported / numeric claims | Tokens | Accepted inference ms | Cost USD |',
    '|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
    ...audit.runs.map((run) => `| ${run.runLabel} | ${run.provider}/${run.model} | ${run.thinkingEnabled ? 'on' : 'off'} | ${format(run.fullControlPassRate)} | ${format(run.quadraticWeightedKappa)} | ${format(run.orderConsistency)} | ${format(run.retestReactionAgreement)} | ${format(run.misleadingDiagnosticFalsePositiveRate)} | ${format(run.evidenceReferenceValidity)} | ${format(run.requiredEvidenceCoverage)} | ${format(run.schemaEnforcementRate)} | ${run.forbiddenClaimViolations} / ${run.numericParameterCandidateViolations} | ${format(run.totalTokens)} | ${format(run.acceptedInferenceMs ?? run.wallClockMs)} | ${format(run.estimatedCostUsd)} |`),
    '',
    '## Cross-evaluator agreement',
    '',
    '| Runs | Changed evaluator axes | Absolute class | Reaction | Preferred plan | Disagreements |',
    '|---|---|---:|---:|---:|---:|',
    ...audit.pairwiseComparisons.map((comparison) => `| ${comparison.leftRunLabel} ↔ ${comparison.rightRunLabel} | ${comparison.changedEvaluatorAxes.join(', ') || 'none'} | ${format(comparison.absoluteClassAgreement)} | ${format(comparison.reactionAgreement)} | ${format(comparison.preferredPlanAgreement)} | ${comparison.disagreements.length} |`),
    '',
    '## Interpretation boundary',
    '',
    audit.interpretation,
    '',
    'A model/provider difference is intentional in this audit but remains a comparability break for normal planner-score drift. This report does not migrate the response contract or committed baseline.',
  ];
  return `${lines.join('\n')}\n`;
}
