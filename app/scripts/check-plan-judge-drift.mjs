import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

const baselinePath = resolve('../docs/analysis/plan-judge-baseline.json');
const currentPath = resolve('artifacts/ai-plan-judge/latest/judge-summary.json');
const allowModelChange = process.argv.includes('--allow-model-change');
const failOnRegression = process.argv.includes('--fail-on-regression');
const EXPECTED_SCHEMA = 'adaptive-training-recommender/ai-plan-judge-summary@3';

function readJson(path, label) {
  if (!existsSync(path)) {
    console.error(`Missing ${label}: ${path}`);
    process.exit(1);
  }
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    console.error(`${label} is malformed JSON: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

function numeric(value, field, fatal) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fatal.push(`${field} must be a finite number.`);
    return 0;
  }
  return value;
}

const baseline = readJson(baselinePath, 'plan judge baseline');
const current = readJson(currentPath, 'current plan judge summary');
const fatal = [];
const warnings = [];

if (baseline.schema !== EXPECTED_SCHEMA) fatal.push(`Baseline schema is ${JSON.stringify(baseline.schema)}, expected ${EXPECTED_SCHEMA}.`);
if (current.schema !== EXPECTED_SCHEMA) fatal.push(`Current schema is ${JSON.stringify(current.schema)}, expected ${EXPECTED_SCHEMA}.`);

for (const [label, summary] of [['baseline', baseline], ['current', current]]) {
  if (!summary.provenance || typeof summary.provenance !== 'object') fatal.push(`${label} summary is missing provenance.`);
  if (!summary.scoreAverages || typeof summary.scoreAverages !== 'object') fatal.push(`${label} summary is missing scoreAverages.`);
  if (!Array.isArray(summary.familySensitivity)) fatal.push(`${label} summary is missing familySensitivity.`);
}

if (fatal.length === 0) {
  if (baseline.provenance.promptSha256 !== current.provenance.promptSha256) {
    fatal.push('Judge prompt hash changed; score deltas are not comparable to the committed baseline.');
  }
  if (baseline.provenance.responseSchemaSha256 !== current.provenance.responseSchemaSha256) {
    fatal.push('Judge response schema hash changed; score deltas are not comparable to the committed baseline.');
  }

  const baselineModel = baseline.provenance.judgeModel ?? 'unknown';
  const currentModel = current.provenance.judgeModel ?? 'unknown';
  if (baselineModel !== currentModel) {
    const message = `Judge model changed: ${baselineModel} -> ${currentModel}. Model drift can dominate engine drift.`;
    if (allowModelChange) warnings.push(`${message} Continuing because --allow-model-change was supplied.`);
    else fatal.push(`${message} Re-run with the baseline model, or explicitly pass --allow-model-change for an exploratory comparison.`);
  }

  if (baseline.familyCount !== current.familyCount) fatal.push(`Family count changed: ${baseline.familyCount} -> ${current.familyCount}.`);
  if (baseline.caseCount !== current.caseCount) fatal.push(`Case count changed: ${baseline.caseCount} -> ${current.caseCount}.`);

  const baselineFamilies = new Set(baseline.familySensitivity.map((item) => item.familyId));
  const currentFamilies = new Set(current.familySensitivity.map((item) => item.familyId));
  const missingFamilies = [...baselineFamilies].filter((id) => !currentFamilies.has(id));
  const newFamilies = [...currentFamilies].filter((id) => !baselineFamilies.has(id));
  if (missingFamilies.length) fatal.push(`Current summary is missing baseline families: ${missingFamilies.join(', ')}.`);
  if (newFamilies.length) fatal.push(`Current summary contains new families: ${newFamilies.join(', ')}.`);

  const baselineDimensions = new Set(Object.keys(baseline.scoreAverages));
  const currentDimensions = new Set(Object.keys(current.scoreAverages));
  const missingDimensions = [...baselineDimensions].filter((key) => !currentDimensions.has(key));
  const newDimensions = [...currentDimensions].filter((key) => !baselineDimensions.has(key));
  if (missingDimensions.length) fatal.push(`Current summary is missing score dimensions: ${missingDimensions.join(', ')}.`);
  if (newDimensions.length) fatal.push(`Current summary contains new score dimensions: ${newDimensions.join(', ')}.`);
}

if (fatal.length > 0) {
  console.error('=== AI Plan Judge Baseline Diff Check: NOT COMPARABLE ===\n');
  for (const message of fatal) console.error(`- ${message}`);
  process.exit(1);
}

console.log('=== AI Plan Judge Baseline Diff Check ===\n');
console.log(`Baseline corpus commit: ${baseline.provenance.corpusCommit ?? 'unknown'}`);
console.log(`Current corpus commit:  ${current.provenance.corpusCommit ?? 'unknown'}`);
console.log(`Judge model:            ${current.provenance.judgeModel ?? 'unknown'}`);
if ((baseline.provenance.judgeProvider ?? 'unknown') !== (current.provenance.judgeProvider ?? 'unknown')) {
  warnings.push(`Judge provider metadata differs: ${baseline.provenance.judgeProvider ?? 'unknown'} -> ${current.provenance.judgeProvider ?? 'unknown'}.`);
}
console.log(`Baseline families/cases: ${baseline.familyCount}/${baseline.caseCount}`);
console.log(`Current families/cases:  ${current.familyCount}/${current.caseCount}`);
const baseMean = numeric(baseline.meanSensitivityQuality, 'baseline.meanSensitivityQuality', fatal);
const currMean = numeric(current.meanSensitivityQuality, 'current.meanSensitivityQuality', fatal);
console.log(`Baseline mean sensitivity: ${baseMean.toFixed(2)}/10`);
console.log(`Current mean sensitivity:  ${currMean.toFixed(2)}/10\n`);

let regressionCount = 0;
let improvementCount = 0;
let notableCount = 0;

const dimensionDeltas = {};
console.log('--- Dimension Score Comparison ---');
for (const key of Object.keys(baseline.scoreAverages)) {
  const baseValue = numeric(baseline.scoreAverages[key], `baseline.scoreAverages.${key}`, fatal);
  const currentValue = numeric(current.scoreAverages[key], `current.scoreAverages.${key}`, fatal);
  const delta = currentValue - baseValue;
  let flag = '';
  let status = 'unchanged';
  if (delta < -0.1) {
    flag = ' [REGRESSION]';
    status = 'regression';
    regressionCount += 1;
    notableCount += 1;
  } else if (delta > 0.1) {
    flag = ' [IMPROVEMENT]';
    status = 'improvement';
    improvementCount += 1;
    notableCount += 1;
  }
  dimensionDeltas[key] = { baseline: round2(baseValue), current: round2(currentValue), delta: round2(delta), status };
  console.log(`  ${key.padEnd(24)}: ${round2(baseValue).toFixed(2)} -> ${round2(currentValue).toFixed(2)} (delta: ${delta >= 0 ? '+' : ''}${round2(delta).toFixed(2)})${flag}`);
}

const familyDeltas = {};
console.log('\n--- Family Sensitivity Comparison ---');
const baselineFamilyMap = new Map(baseline.familySensitivity.map((item) => [item.familyId, item]));
for (const currentFamily of [...current.familySensitivity].sort((a, b) => a.familyId.localeCompare(b.familyId))) {
  const baselineFamily = baselineFamilyMap.get(currentFamily.familyId);
  const baseValue = numeric(baselineFamily.sensitivityQuality, `baseline.${currentFamily.familyId}.sensitivityQuality`, fatal);
  const currentValue = numeric(currentFamily.sensitivityQuality, `current.${currentFamily.familyId}.sensitivityQuality`, fatal);
  const delta = currentValue - baseValue;
  let flag = '';
  let status = 'unchanged';
  if (delta < -0.2) {
    flag = ' [REGRESSION]';
    status = 'regression';
    regressionCount += 1;
    notableCount += 1;
  } else if (delta > 0.2) {
    flag = ' [IMPROVEMENT]';
    status = 'improvement';
    improvementCount += 1;
    notableCount += 1;
  }
  familyDeltas[currentFamily.familyId] = { baseline: round2(baseValue), current: round2(currentValue), delta: round2(delta), status };
  console.log(`  ${currentFamily.familyId.padEnd(30)}: ${baseValue.toFixed(1)}/10 -> ${currentValue.toFixed(1)}/10 (delta: ${delta >= 0 ? '+' : ''}${round2(delta).toFixed(2)})${flag}`);
}

if (warnings.length) {
  console.log('\n--- Comparability Warnings ---');
  for (const message of warnings) console.log(`  - ${message}`);
}

console.log(`\nDiff check complete. ${notableCount} notable differences: ${improvementCount} improvements, ${regressionCount} regressions.`);

const diffData = {
  comparedAt: new Date().toISOString(),
  baseline: {
    corpusCommit: baseline.provenance.corpusCommit ?? 'unknown',
    judgeModel: baseline.provenance.judgeModel ?? 'unknown',
    meanSensitivityQuality: round2(baseMean),
    scoreAverages: baseline.scoreAverages,
  },
  current: {
    corpusCommit: current.provenance.corpusCommit ?? 'unknown',
    judgeModel: current.provenance.judgeModel ?? 'unknown',
    meanSensitivityQuality: round2(currMean),
    scoreAverages: current.scoreAverages,
  },
  summary: {
    meanSensitivityDelta: round2(currMean - baseMean),
    notableDifferences: notableCount,
    improvements: improvementCount,
    regressions: regressionCount,
  },
  dimensionDeltas,
  familyDeltas,
  warnings,
};

try {
  const latestDir = resolve('artifacts/ai-plan-judge/latest');
  const historyDir = resolve('artifacts/ai-plan-judge/history');
  mkdirSync(latestDir, { recursive: true });
  mkdirSync(historyDir, { recursive: true });

  const diffJson = JSON.stringify(diffData, null, 2);
  writeFileSync(resolve(latestDir, 'judge-diff.json'), diffJson, 'utf8');

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  writeFileSync(resolve(historyDir, `diff-${timestamp}.json`), diffJson, 'utf8');
} catch (error) {
  console.warn(`Could not persist diff artifacts: ${error instanceof Error ? error.message : String(error)}`);
}

if (failOnRegression && regressionCount > 0) {
  console.error('Failing because --fail-on-regression was supplied.');
  process.exit(2);
}
