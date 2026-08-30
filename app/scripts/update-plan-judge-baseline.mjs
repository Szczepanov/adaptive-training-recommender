import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

const reviewed = process.argv.includes('--reviewed');
const EXPECTED_SCHEMA = 'adaptive-training-recommender/ai-plan-judge-summary@3';
const requiredScores = ['safety_recovery_fit', 'goal_event_fit', 'sequencing', 'periodization_taper', 'preference_capacity_fit', 'robustness', 'overall'];
const outputDir = resolve('artifacts/ai-plan-judge/latest');
const summaryPath = resolve(outputDir, 'judge-summary.json');
const familiesPath = resolve(outputDir, 'families.jsonl');
const promptPath = resolve(outputDir, 'judge-prompt.md');
const responseSchemaPath = resolve(outputDir, 'judge-response-schema.json');
const scoresPath = resolve(outputDir, 'judge-scores.jsonl');
const corpusPath = resolve(outputDir, 'corpus.json');

if (!reviewed) {
  console.error('Refusing to update the committed plan judge baseline without --reviewed.');
  console.error('Run `npm run judge:diff`, review the semantic changes, then rerun:');
  console.error('  npm run judge:update-baseline -- --reviewed');
  process.exit(1);
}

for (const path of [summaryPath, familiesPath, promptPath, responseSchemaPath, scoresPath, corpusPath]) {
  if (!existsSync(path)) {
    console.error(`Fresh plan judge artifact not found: ${path}`);
    console.error('Run `npm run judge:local` or `npm run judge:run` first.');
    process.exit(1);
  }
}

let summary;
try {
  summary = JSON.parse(readFileSync(summaryPath, 'utf8'));
} catch (error) {
  console.error(`Plan judge summary is malformed JSON: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

const targetArgIdx = process.argv.indexOf('--target');
const explicitTarget = targetArgIdx !== -1 && process.argv[targetArgIdx + 1] ? resolve(process.argv[targetArgIdx + 1]) : null;

const judgeModel = summary?.provenance?.judgeModel || '';
const is4B = !explicitTarget && /4b/i.test(judgeModel);
const targetBaselineFilename = is4B ? 'plan-judge-baseline.4b.json' : 'plan-judge-baseline.json';
const targetStabilityFilename = is4B ? 'plan-judge-stability.4b.json' : 'plan-judge-stability.json';

const baselinePath = explicitTarget || resolve(`../docs/analysis/${targetBaselineFilename}`);
const baselineStabilityPath = resolve(`../docs/analysis/${targetStabilityFilename}`);
const stabilitySource = `docs/analysis/${targetStabilityFilename}`;

const failures = [];
const hashFile = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const requireString = (value, field) => {
  if (typeof value !== 'string' || !value.trim()) failures.push(`${field} must be a non-empty string.`);
};

if (!summary || typeof summary !== 'object') failures.push('Plan judge summary must be an object.');
if (summary?.schema !== EXPECTED_SCHEMA) failures.push(`Plan judge summary schema must be ${EXPECTED_SCHEMA}, got ${JSON.stringify(summary?.schema)}.`);
if (!Number.isInteger(summary?.familyCount) || summary.familyCount <= 0) failures.push('familyCount must be a positive integer.');
if (!Number.isInteger(summary?.caseCount) || summary.caseCount <= 0) failures.push('caseCount must be a positive integer.');
if (!Array.isArray(summary?.familySensitivity) || summary.familySensitivity.length !== summary.familyCount) failures.push('familySensitivity must contain one entry per family.');
if (!summary?.scoreAverages || typeof summary.scoreAverages !== 'object') failures.push('scoreAverages is required.');
for (const key of requiredScores) {
  if (typeof summary?.scoreAverages?.[key] !== 'number' || !Number.isFinite(summary.scoreAverages[key])) failures.push(`scoreAverages.${key} must be finite.`);
}
if (!summary?.provenance || typeof summary.provenance !== 'object') failures.push('provenance is required.');

if (summary?.source && isAbsolute(summary.source)) {
  failures.push(`summary.source must be repository-relative, not an absolute machine-local path: ${summary.source}`);
}

const provenance = summary?.provenance ?? {};
for (const field of ['corpusCommit', 'corpusSchema', 'corpusSha256', 'familiesSha256', 'promptSha256', 'responseSchemaSha256', 'judgeScoresSha256', 'judgeModel', 'judgeProvider']) {
  requireString(provenance[field], `provenance.${field}`);
  if (provenance[field] === 'unknown') failures.push(`provenance.${field} cannot be 'unknown' for a committed baseline.`);
}

const expectedHashes = {
  corpusSha256: hashFile(corpusPath),
  familiesSha256: hashFile(familiesPath),
  promptSha256: hashFile(promptPath),
  responseSchemaSha256: hashFile(responseSchemaPath),
  judgeScoresSha256: hashFile(scoresPath),
};
for (const [field, expected] of Object.entries(expectedHashes)) {
  if (provenance[field] !== expected) failures.push(`provenance.${field} does not match the current artifact (${provenance[field]} != ${expected}).`);
}

let currentCommit = 'unknown';
try {
  currentCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
} catch {
  failures.push('Could not resolve the current git commit; refusing to write an untraceable baseline.');
}
if (currentCommit !== 'unknown' && provenance.corpusCommit !== currentCommit) {
  failures.push(`provenance.corpusCommit (${provenance.corpusCommit}) does not match current HEAD (${currentCommit}); regenerate the corpus/judge summary after the latest code change.`);
}

if (failures.length > 0) {
  console.error('Refusing to update plan judge baseline:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

const artifactStabilityPath = resolve(outputDir, 'judge-stability.json');

const cleanSummary = { ...summary };
let stabilityData = cleanSummary.judgeStability ?? null;
if (!stabilityData && existsSync(artifactStabilityPath)) {
  try {
    stabilityData = JSON.parse(readFileSync(artifactStabilityPath, 'utf8'));
  } catch {
    // optional stability reading
  }
}

if (stabilityData) {
  writeFileSync(baselineStabilityPath, `${JSON.stringify(stabilityData, null, 2)}\n`);
  cleanSummary.stabilitySource = stabilitySource;
  delete cleanSummary.judgeStability;
  console.log(`Reviewed plan judge stability updated at ${baselineStabilityPath}.`);
}

writeFileSync(baselinePath, `${JSON.stringify(cleanSummary, null, 2)}\n`);
console.log(`Reviewed plan judge baseline updated at ${baselinePath}.`);
console.log(`Corpus commit: ${provenance.corpusCommit}`);
console.log(`Families SHA-256: ${provenance.familiesSha256}`);
console.log(`Judge: ${provenance.judgeProvider}/${provenance.judgeModel}`);
if (provenance.judgeSettings) {
  console.log(`Settings: ${JSON.stringify(provenance.judgeSettings)}`);
}
