import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const defaultBaselinePath = resolve('../docs/analysis/persona-judge-baseline.json');
const outputDir = resolve('artifacts/persona-plan-judge/latest');
const corpusPath = resolve(outputDir, 'corpus.json');
const scoresPath = resolve(outputDir, 'judge-scores.jsonl');
const stabilityPath = resolve(outputDir, 'judge-stability.json');
const manifestPath = resolve(outputDir, 'judge-run-manifest.json');

const allowModelChange = process.argv.includes('--allow-model-change');
const againstIndex = process.argv.indexOf('--against');
const againstCustomPath = againstIndex !== -1 && process.argv[againstIndex + 1] ? process.argv[againstIndex + 1] : null;
const requiredScores = ['safety_recovery_fit', 'goal_event_fit', 'sequencing', 'periodization_taper', 'preference_capacity_fit', 'robustness', 'overall'];

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

// 1. Verify files exist
for (const [path, label] of [
  [corpusPath, 'persona judge corpus'],
  [scoresPath, 'persona judge scores (judge-scores.jsonl)'],
]) {
  if (!existsSync(path)) {
    console.error(`Persona judge artifact not found: ${path}`);
    console.error('Run `npm run persona:local:stability` or `npm run persona:gemini` first.');
    process.exit(1);
  }
}

const corpus = readJson(corpusPath, 'persona judge corpus');
const scoreRows = readFileSync(scoresPath, 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((line, i) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      console.error(`judge-scores.jsonl line ${i + 1} is malformed: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  });

let manifest = null;
if (existsSync(manifestPath)) {
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch {
    // optional
  }
}

let stability = [];
if (existsSync(stabilityPath)) {
  try {
    stability = JSON.parse(readFileSync(stabilityPath, 'utf8'));
  } catch {
    // optional
  }
}

// Aggregate current scores
const allCaseScores = scoreRows.flatMap((row) => row.caseScores ?? []);
const scoreAverages = {};
for (const key of requiredScores) {
  const values = allCaseScores.map((c) => c?.scores?.[key]).filter((v) => typeof v === 'number' && Number.isFinite(v));
  scoreAverages[key] = values.length > 0 ? values.reduce((sum, v) => sum + v, 0) / values.length : 0;
}

const meanSensitivityQuality =
  scoreRows.length > 0
    ? scoreRows.reduce((sum, row) => sum + (row?.familyAssessment?.sensitivity_quality ?? 0), 0) / scoreRows.length
    : 0;

const current = {
  provenance: {
    judgeModel: manifest?.judgeModel ?? 'unknown',
    judgeProvider: manifest?.judgeProvider ?? 'unknown',
  },
  familyCount: scoreRows.length,
  caseCount: allCaseScores.length,
  scoreAverages,
  meanSensitivityQuality,
  familySensitivity: scoreRows.map((row) => ({
    familyId: row.familyId,
    sensitivityQuality: row?.familyAssessment?.sensitivity_quality ?? 0,
  })),
};

let baselinePath = defaultBaselinePath;
let baselineLabel = 'Baseline';
if (againstCustomPath) {
  baselinePath = resolve(againstCustomPath);
  baselineLabel = `Custom (${againstCustomPath})`;
}

const baseline = readJson(baselinePath, `persona judge baseline (${baselineLabel})`);

const fatal = [];
const warnings = [];

const baselineModel = baseline.provenance?.judgeModel ?? baseline.judgeSettings?.model ?? 'unknown';
const currentModel = current.provenance.judgeModel;
if (baselineModel !== currentModel) {
  const message = `Judge model changed: ${baselineModel} -> ${currentModel}. Model drift can dominate engine drift.`;
  if (allowModelChange) warnings.push(`${message} Continuing because --allow-model-change was supplied.`);
  else fatal.push(`${message} Re-run with the baseline model, or pass --allow-model-change.`);
}

if (baseline.familyCount !== current.familyCount) fatal.push(`Family count changed: ${baseline.familyCount} -> ${current.familyCount}.`);
if (baseline.caseCount !== current.caseCount) fatal.push(`Case count changed: ${baseline.caseCount} -> ${current.caseCount}.`);

const baselineFamilies = new Set(baseline.familySensitivity.map((item) => item.familyId));
const currentFamilies = new Set(current.familySensitivity.map((item) => item.familyId));
const missingFamilies = [...baselineFamilies].filter((id) => !currentFamilies.has(id));
const newFamilies = [...currentFamilies].filter((id) => !baselineFamilies.has(id));
if (missingFamilies.length) fatal.push(`Current summary is missing baseline families: ${missingFamilies.join(', ')}.`);
if (newFamilies.length) fatal.push(`Current summary contains new families: ${newFamilies.join(', ')}.`);

if (fatal.length > 0) {
  console.error('=== Persona Plan Judge Baseline Diff Check: NOT COMPARABLE ===\n');
  for (const message of fatal) console.error(`- ${message}`);
  process.exit(1);
}

console.log(`=== Persona Plan Judge Diff Check (Current vs ${baselineLabel}) ===\n`);
console.log(`Judge model:             ${current.provenance.judgeModel}`);
console.log(`Baseline families/cases: ${baseline.familyCount}/${baseline.caseCount}`);
console.log(`Current families/cases:  ${current.familyCount}/${current.caseCount}`);
const baseMean = numeric(baseline.meanSensitivityQuality, 'baseline.meanSensitivityQuality', fatal);
const currMean = numeric(current.meanSensitivityQuality, 'current.meanSensitivityQuality', fatal);
console.log(`Baseline mean sensitivity: ${baseMean.toFixed(2)}/10`);
console.log(`Current mean sensitivity:  ${currMean.toFixed(2)}/10\n`);

let regressionCount = 0;
let improvementCount = 0;
let notableCount = 0;

const familyStabilityMap = new Map((stability ?? []).map((f) => [f.familyId, f]));

console.log('--- Dimension Score Comparison ---');
for (const key of Object.keys(baseline.scoreAverages)) {
  const baseValue = numeric(baseline.scoreAverages[key], `baseline.scoreAverages.${key}`, fatal);
  const currentValue = numeric(current.scoreAverages[key], `current.scoreAverages.${key}`, fatal);
  const delta = currentValue - baseValue;
  let flag = '';
  if (delta < -0.1) {
    flag = ' [REGRESSION]';
    regressionCount += 1;
    notableCount += 1;
  } else if (delta > 0.1) {
    flag = ' [IMPROVEMENT]';
    improvementCount += 1;
    notableCount += 1;
  }
  console.log(`  ${key.padEnd(24)}: ${round2(baseValue).toFixed(2)} -> ${round2(currentValue).toFixed(2)} (delta: ${delta >= 0 ? '+' : ''}${round2(delta).toFixed(2)})${flag}`);
}

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
  if (delta < -0.2) {
    if (noiseMad > 0 && Math.abs(delta) <= noiseMad) {
      flag = ` [INCONCLUSIVE (within noise ±${noiseMad})]`;
    } else {
      flag = ' [REGRESSION]';
      regressionCount += 1;
      notableCount += 1;
    }
  } else if (delta > 0.2) {
    if (noiseMad > 0 && Math.abs(delta) <= noiseMad) {
      flag = ` [INCONCLUSIVE (within noise ±${noiseMad})]`;
    } else {
      flag = ' [IMPROVEMENT]';
      improvementCount += 1;
      notableCount += 1;
    }
  }
  console.log(`  ${currentFamily.familyId.padEnd(38)}: ${baseValue.toFixed(1)}/10 -> ${currentValue.toFixed(1)}/10 (delta: ${delta >= 0 ? '+' : ''}${round2(delta).toFixed(2)})${flag}`);
}

if (warnings.length) {
  console.log('\n--- Comparability Warnings ---');
  for (const message of warnings) console.log(`  - ${message}`);
}

console.log(`\nPersona diff check complete. ${notableCount} notable differences: ${improvementCount} improvements, ${regressionCount} regressions.`);
