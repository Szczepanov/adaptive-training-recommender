import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

const reviewed = process.argv.includes('--reviewed');
const EXPECTED_SCHEMA = 'adaptive-training-recommender/persona-plan-judge-corpus@1';
const requiredScores = ['safety_recovery_fit', 'goal_event_fit', 'sequencing', 'periodization_taper', 'preference_capacity_fit', 'robustness', 'overall'];
const EXPECTED_FAMILY_COUNT = 3;
const EXPECTED_CASE_COUNT = 9;

const outputDir = resolve('artifacts/persona-plan-judge/latest');
const corpusPath = resolve(outputDir, 'corpus.json');
const familiesPath = resolve(outputDir, 'families.jsonl');
const promptPath = resolve(outputDir, 'judge-prompt.md');
const scoresPath = resolve(outputDir, 'judge-scores.jsonl');
const stabilityPath = resolve(outputDir, 'judge-stability.json');

const baselinePath = resolve('../docs/analysis/persona-judge-baseline.json');

if (!reviewed) {
  console.error('Refusing to update the committed persona judge baseline without --reviewed.');
  console.error('Run `npm run persona:local:stability` or `npm run persona:gemini`, review the');
  console.error('scores in artifacts/persona-plan-judge/latest/, then rerun:');
  console.error('  npm run persona:update-baseline -- --reviewed');
  process.exit(1);
}

for (const path of [corpusPath, familiesPath, promptPath, scoresPath]) {
  if (!existsSync(path)) {
    console.error(`Persona judge artifact not found: ${path}`);
    console.error('Run `npm run persona:local:stability` or `npm run persona:gemini` first.');
    process.exit(1);
  }
}

// --- Parse corpus for provenance + settings ---
let corpus;
try {
  corpus = JSON.parse(readFileSync(corpusPath, 'utf8'));
} catch (error) {
  console.error(`Persona judge corpus is malformed JSON: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

// --- Parse scores ---
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

// --- Validate ---
const failures = [];
const hashFile = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

if (corpus?.schema !== EXPECTED_SCHEMA) {
  failures.push(`corpus.schema must be ${EXPECTED_SCHEMA}, got ${JSON.stringify(corpus?.schema)}.`);
}
if (corpus?.familyCount !== EXPECTED_FAMILY_COUNT) {
  failures.push(`corpus.familyCount must be ${EXPECTED_FAMILY_COUNT}, got ${corpus?.familyCount}.`);
}
if (corpus?.caseCount !== EXPECTED_CASE_COUNT) {
  failures.push(`corpus.caseCount must be ${EXPECTED_CASE_COUNT}, got ${corpus?.caseCount}.`);
}
if (scoreRows.length !== EXPECTED_FAMILY_COUNT) {
  failures.push(`judge-scores.jsonl must contain ${EXPECTED_FAMILY_COUNT} rows (one per family), got ${scoreRows.length}.`);
}

// Verify every required score dimension is a real number across all families
for (const row of scoreRows) {
  for (const caseScore of row?.caseScores ?? []) {
    for (const key of requiredScores) {
      const val = caseScore?.scores?.[key];
      if (typeof val !== 'number' || !Number.isFinite(val)) {
        failures.push(`Case ${caseScore?.caseId}: scores.${key} must be a finite number.`);
      }
    }
  }
  const sensitivityQuality = row?.familyAssessment?.sensitivity_quality;
  if (typeof sensitivityQuality !== 'number' || !Number.isFinite(sensitivityQuality)) {
    failures.push(`Family ${row?.familyId}: familyAssessment.sensitivity_quality must be a finite number.`);
  }
}

// Resolve current git commit
let currentCommit = 'unknown';
try {
  currentCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
} catch {
  failures.push('Could not resolve the current git commit; refusing to write an untraceable baseline.');
}

if (failures.length > 0) {
  console.error('Refusing to update persona judge baseline:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

// --- Build provenance ---
const corpusSha256 = hashFile(corpusPath);
const familiesSha256 = hashFile(familiesPath);
const promptSha256 = hashFile(promptPath);
const judgeScoresSha256 = hashFile(scoresPath);

// Extract judge config from corpus or first score row
const judgeConfig = corpus?.judgeConfig ?? scoreRows[0]?.judgeConfig ?? null;
const judgeModel = judgeConfig?.model ?? null;
const judgeProvider = judgeConfig?.provider ?? null;

if (!judgeModel || typeof judgeModel !== 'string') {
  console.warn('Warning: judgeModel not found in corpus — provenance.judgeModel will be null.');
}
if (!judgeProvider || typeof judgeProvider !== 'string') {
  console.warn('Warning: judgeProvider not found in corpus — provenance.judgeProvider will be null.');
}

// --- Aggregate score averages across all cases ---
const allCaseScores = scoreRows.flatMap((row) => row.caseScores ?? []);
const scoreAverages = {};
for (const key of requiredScores) {
  const values = allCaseScores.map((c) => c?.scores?.[key]).filter((v) => typeof v === 'number' && Number.isFinite(v));
  scoreAverages[key] = values.length > 0 ? values.reduce((sum, v) => sum + v, 0) / values.length : null;
}

const meanSensitivityQuality =
  scoreRows.length > 0
    ? scoreRows.reduce((sum, row) => sum + (row?.familyAssessment?.sensitivity_quality ?? 0), 0) / scoreRows.length
    : null;

const familySensitivity = scoreRows.map((row) => ({
  familyId: row.familyId,
  changedAxis: corpus?.families?.find((f) => f.familyId === row.familyId)?.changedAxis ?? null,
  sensitivityQuality: row?.familyAssessment?.sensitivity_quality ?? null,
  rationale: row?.familyAssessment?.rationale ?? null,
  overreactionCases: row?.familyAssessment?.overreaction_cases ?? [],
  underreactionCases: row?.familyAssessment?.underreaction_cases ?? [],
  algorithmAdjustmentHypotheses: row?.familyAssessment?.algorithm_adjustment_hypotheses ?? [],
}));

// --- Load existing baseline (to preserve history context if present) ---
let existingBaseline = {};
if (existsSync(baselinePath)) {
  try {
    existingBaseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
  } catch {
    // ignore — will overwrite
  }
}

// --- Write new baseline ---
const baseline = {
  schema: 'adaptive-training-recommender/persona-plan-judge-baseline@1',
  source: 'artifacts/persona-plan-judge/latest/judge-scores.jsonl',
  provenance: {
    corpusCommit: currentCommit,
    corpusSchema: EXPECTED_SCHEMA,
    corpusSha256,
    familiesSha256,
    promptSha256,
    judgeScoresSha256,
    judgeModel,
    judgeProvider,
    analyzedAt: new Date().toISOString(),
    judgeSettings: judgeConfig ?? null,
  },
  judgeSettings: judgeConfig ?? null,
  familyCount: EXPECTED_FAMILY_COUNT,
  caseCount: EXPECTED_CASE_COUNT,
  personaFamilies: scoreRows.map((row) => row.familyId),
  scoreAverages,
  meanSensitivityQuality,
  familySensitivity,
  caseScores: allCaseScores,
};

// Optionally carry through stability data
if (existsSync(stabilityPath)) {
  try {
    baseline.stability = JSON.parse(readFileSync(stabilityPath, 'utf8'));
  } catch {
    // optional
  }
}

writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`);
console.log(`Reviewed persona judge baseline updated at ${baselinePath}`);
console.log(`Corpus commit: ${currentCommit}`);
console.log(`Families SHA-256: ${familiesSha256}`);
console.log(`Judge: ${judgeProvider}/${judgeModel}`);
if (judgeConfig) {
  console.log(`Settings: ${JSON.stringify(judgeConfig)}`);
}
