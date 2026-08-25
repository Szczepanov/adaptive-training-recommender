import { existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const defaultBaselinePath = resolve('../docs/analysis/plan-judge-baseline.json');
const currentPath = resolve('artifacts/ai-plan-judge/latest/judge-summary.json');
const allowModelChange = process.argv.includes('--allow-model-change');
const failOnRegression = process.argv.includes('--fail-on-regression');
const usePrevious = process.argv.includes('--previous') || process.argv.includes('--prev');
const againstIndex = process.argv.indexOf('--against');
const againstCustomPath = againstIndex !== -1 && process.argv[againstIndex + 1] ? process.argv[againstIndex + 1] : null;
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

const current = readJson(currentPath, 'current plan judge summary');

function normalizeToSummary(data, fallbackLabel) {
  if (data && data.schema === EXPECTED_SCHEMA) return data;
  if (data && data.current && data.current.scoreAverages) {
    return {
      schema: EXPECTED_SCHEMA,
      provenance: {
        corpusCommit: data.current.corpusCommit,
        judgeModel: data.current.judgeModel,
        judgeProvider: data.current.judgeProvider,
        promptSha256: data.current.promptSha256,
        responseSchemaSha256: data.current.responseSchemaSha256,
        caseSetSha256: data.current.caseSetSha256,
        corpusSha256: data.current.corpusSha256,
        familiesSha256: data.current.familiesSha256,
      },
      familyCount: data.current.familyCount,
      caseCount: data.current.caseCount,
      meanSensitivityQuality: data.current.meanSensitivityQuality,
      scoreAverages: data.current.scoreAverages,
      familySensitivity: Object.entries(data.familyDeltas || {}).map(([familyId, val]) => ({
        familyId,
        sensitivityQuality: val.current,
      })),
    };
  }
  return data;
}

let baselinePath = defaultBaselinePath;
let baselineLabel = 'Baseline';

if (againstCustomPath) {
  baselinePath = resolve(againstCustomPath);
  baselineLabel = `Custom (${againstCustomPath})`;
} else if (usePrevious) {
  const historyDir = resolve('artifacts/ai-plan-judge/history');
  if (existsSync(historyDir)) {
    const files = readdirSync(historyDir)
      .filter((f) => f.startsWith('diff-') && f.endsWith('.json'))
      .map((f) => {
        const fullPath = resolve(historyDir, f);
        const parsed = readJson(fullPath, f);
        const dateStr = parsed?.comparedAt || '';
        return { file: f, path: fullPath, commit: parsed?.current?.corpusCommit, date: dateStr };
      })
      .sort((a, b) => b.date.localeCompare(a.date));

    // Find the latest file that has a different corpus commit, or the 2nd newest file
    let candidate = null;
    for (const entry of files) {
      if (entry.commit && entry.commit !== current.provenance?.corpusCommit) {
        candidate = entry;
        break;
      }
    }
    if (!candidate && files.length >= 2) {
      candidate = files[1];
    }
    if (candidate) {
      baselinePath = candidate.path;
      baselineLabel = `Previous Run (${candidate.file})`;
    } else {
      console.error('No eligible previous judge diff artifact exists; refusing to relabel the committed baseline as a previous run.');
      process.exit(1);
    }
  } else {
    console.error(`No judge history directory exists at ${historyDir}; cannot compare with --previous.`);
    process.exit(1);
  }
}

const rawBaseline = readJson(baselinePath, baselineLabel);
const baseline = normalizeToSummary(rawBaseline, baselineLabel);
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

  if (usePrevious) {
    const baselineCaseSet = baseline.provenance.caseSetSha256;
    const currentCaseSet = current.provenance.caseSetSha256;
    if (!baselineCaseSet || !currentCaseSet) {
      fatal.push('Previous-run comparison is missing case-set provenance; legacy diff artifacts are not comparable.');
    } else if (baselineCaseSet !== currentCaseSet) {
      fatal.push('Judge family/case set changed; previous-run score deltas are not comparable.');
    }
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

console.log(`=== AI Plan Judge Diff Check (${usePrevious ? 'Current vs Previous Run' : againstCustomPath ? `Current vs ${againstCustomPath}` : 'Current vs Baseline'}) ===\n`);
console.log(`${usePrevious ? 'Previous' : 'Baseline'} corpus commit: ${baseline.provenance.corpusCommit ?? 'unknown'}`);
console.log(`Current corpus commit:  ${current.provenance.corpusCommit ?? 'unknown'}`);
console.log(`Judge model:            ${current.provenance.judgeModel ?? 'unknown'}`);
if ((baseline.provenance.judgeProvider ?? 'unknown') !== (current.provenance.judgeProvider ?? 'unknown')) {
  warnings.push(`Judge provider metadata differs: ${baseline.provenance.judgeProvider ?? 'unknown'} -> ${current.provenance.judgeProvider ?? 'unknown'}.`);
}
console.log(`${usePrevious ? 'Previous' : 'Baseline'} families/cases: ${baseline.familyCount}/${baseline.caseCount}`);
console.log(`Current families/cases:  ${current.familyCount}/${current.caseCount}`);
const baseMean = numeric(baseline.meanSensitivityQuality, 'baseline.meanSensitivityQuality', fatal);
const currMean = numeric(current.meanSensitivityQuality, 'current.meanSensitivityQuality', fatal);
console.log(`${usePrevious ? 'Previous' : 'Baseline'} mean sensitivity: ${baseMean.toFixed(2)}/10`);
console.log(`Current mean sensitivity:  ${currMean.toFixed(2)}/10\n`);

let regressionCount = 0;
let improvementCount = 0;
let notableCount = 0;

const stability = current.judgeStability;
const familyStabilityMap = new Map((stability?.families ?? []).map((f) => [f.familyId, f]));

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
  const famStab = familyStabilityMap.get(currentFamily.familyId);
  const noiseMad = famStab?.familySensitivityMad ?? 0;

  let flag = '';
  let status = 'unchanged';
  if (delta < -0.2) {
    if (noiseMad > 0 && Math.abs(delta) <= noiseMad) {
      flag = ` [INCONCLUSIVE (within noise ±${noiseMad})]`;
      status = 'inconclusive';
    } else {
      flag = ' [REGRESSION]';
      status = 'regression';
      regressionCount += 1;
      notableCount += 1;
    }
  } else if (delta > 0.2) {
    if (noiseMad > 0 && Math.abs(delta) <= noiseMad) {
      flag = ` [INCONCLUSIVE (within noise ±${noiseMad})]`;
      status = 'inconclusive';
    } else {
      flag = ' [IMPROVEMENT]';
      status = 'improvement';
      improvementCount += 1;
      notableCount += 1;
    }
  }
  familyDeltas[currentFamily.familyId] = { baseline: round2(baseValue), current: round2(currentValue), delta: round2(delta), status, ...(famStab ? { mad: famStab.familySensitivityMad } : {}) };
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
    judgeProvider: baseline.provenance.judgeProvider ?? 'unknown',
    promptSha256: baseline.provenance.promptSha256,
    responseSchemaSha256: baseline.provenance.responseSchemaSha256,
    caseSetSha256: baseline.provenance.caseSetSha256,
    familyCount: baseline.familyCount,
    caseCount: baseline.caseCount,
    meanSensitivityQuality: round2(baseMean),
    scoreAverages: baseline.scoreAverages,
  },
  current: {
    corpusCommit: current.provenance.corpusCommit ?? 'unknown',
    judgeModel: current.provenance.judgeModel ?? 'unknown',
    judgeProvider: current.provenance.judgeProvider ?? 'unknown',
    promptSha256: current.provenance.promptSha256,
    responseSchemaSha256: current.provenance.responseSchemaSha256,
    caseSetSha256: current.provenance.caseSetSha256,
    corpusSha256: current.provenance.corpusSha256,
    familiesSha256: current.provenance.familiesSha256,
    familyCount: current.familyCount,
    caseCount: current.caseCount,
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
