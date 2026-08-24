import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';

const outputDir = resolve('artifacts/ai-plan-judge/latest');
const inputPath = resolve(process.argv[2] ?? `${outputDir}/judge-scores.jsonl`);
const familiesPath = resolve(`${outputDir}/families.jsonl`);
const promptPath = resolve(`${outputDir}/judge-prompt.md`);
const schemaPath = resolve(`${outputDir}/judge-response-schema.json`);
const corpusPath = resolve(`${outputDir}/corpus.json`);
const requiredScores = ['safety_recovery_fit', 'goal_event_fit', 'sequencing', 'periodization_taper', 'preference_capacity_fit', 'robustness', 'overall'];
const listFields = ['overreactionCases', 'underreactionCases', 'goodSensitivityCases', 'algorithmAdjustmentHypotheses'];
const SYNTHETIC_CASE_RATIONALES = new Set([
  'Baseline evaluation applied for missing case response.',
  'Plan evaluated against requirements.',
]);
const SYNTHETIC_FAMILY_RATIONALES = new Set([
  'Family sensitivity evaluation.',
]);
const SYNTHETIC_FAMILY_RATIONALE_PREFIX = 'Evaluation of family sensitivity across ';
const SYNTHETIC_HYPOTHESES = new Set([
  'Ensure plan responds proportionally to changed sensitivity axis.',
  'Maintain balanced sensitivity response across input variations.',
]);

for (const path of [inputPath, familiesPath, promptPath, schemaPath, corpusPath]) {
  if (!existsSync(path)) throw new Error(`Missing AI plan judge artifact: ${path}`);
}

const hashFile = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const boundedNumber = (value, min, max, field) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${field} must be a finite number in [${min}, ${max}], got ${JSON.stringify(value)}`);
  }
  return value;
};
const nonEmptyString = (value, field) => {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} must be a non-empty string.`);
  return value;
};
const stringArray = (value, field) => {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item.trim())) {
    throw new Error(`${field} must be an array of non-empty strings.`);
  }
  return value;
};
const parseJsonl = (path) => readFileSync(path, 'utf8')
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean)
  .map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(`${path}:${index + 1} invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
const portablePath = (path) => relative(resolve('.'), path).replaceAll('\\', '/');

const expectedFamilies = parseJsonl(familiesPath);
const expectedByFamily = new Map();
for (const family of expectedFamilies) {
  if (!family || typeof family !== 'object' || typeof family.familyId !== 'string' || !family.familyId.trim() || !Array.isArray(family.cases)) {
    throw new Error(`Malformed family packet in ${familiesPath}`);
  }
  if (expectedByFamily.has(family.familyId)) throw new Error(`Duplicate familyId in corpus: ${family.familyId}`);
  const caseIds = family.cases.map((item) => item.input?.caseId);
  if (caseIds.some((id) => typeof id !== 'string' || !id.trim())) throw new Error(`Family ${family.familyId} contains missing case ids.`);
  if (new Set(caseIds).size !== caseIds.length) throw new Error(`Family ${family.familyId} contains duplicate case ids.`);
  expectedByFamily.set(family.familyId, new Set(caseIds));
}

const rawRows = parseJsonl(inputPath);
const seenFamilies = new Set();
function parseJudgeRow(value, index) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Line ${index + 1}: judge response must be an object.`);
  if (value.schema !== 'adaptive-training-recommender/ai-plan-judge-response@1') throw new Error(`Line ${index + 1}: unexpected schema ${JSON.stringify(value.schema)}.`);
  if (typeof value.familyId !== 'string' || !expectedByFamily.has(value.familyId)) throw new Error(`Line ${index + 1}: unknown familyId ${JSON.stringify(value.familyId)}.`);
  if (seenFamilies.has(value.familyId)) throw new Error(`Duplicate judge response for family ${value.familyId}.`);
  seenFamilies.add(value.familyId);
  if (!Array.isArray(value.caseScores)) throw new Error(`${value.familyId}.caseScores must be an array.`);

  const expectedCaseIds = expectedByFamily.get(value.familyId);
  const seenCases = new Set();
  for (const item of value.caseScores) {
    if (!item || typeof item !== 'object' || Array.isArray(item) || typeof item.caseId !== 'string') throw new Error(`${value.familyId}: malformed case score.`);
    if (!expectedCaseIds.has(item.caseId)) throw new Error(`${value.familyId}: unexpected case ${item.caseId}.`);
    if (seenCases.has(item.caseId)) throw new Error(`${value.familyId}: duplicate case ${item.caseId}.`);
    seenCases.add(item.caseId);
    if (!item.scores || typeof item.scores !== 'object' || Array.isArray(item.scores)) throw new Error(`${item.caseId}.scores is required.`);
    for (const key of requiredScores) boundedNumber(item.scores[key], 0, 10, `${item.caseId}.${key}`);
    boundedNumber(item.confidence, 0, 1, `${item.caseId}.confidence`);
    stringArray(item.flags, `${item.caseId}.flags`);
    stringArray(item.suggestedChanges, `${item.caseId}.suggestedChanges`);
    const rationale = nonEmptyString(item.rationale, `${item.caseId}.rationale`).trim();
    if (SYNTHETIC_CASE_RATIONALES.has(rationale)) {
      throw new Error(`${value.familyId}: ${item.caseId} contains synthesized fallback judge evidence; rerun this family instead of scoring fabricated data.`);
    }
  }
  if (seenCases.size !== expectedCaseIds.size) {
    const missing = [...expectedCaseIds].filter((id) => !seenCases.has(id));
    throw new Error(`${value.familyId}: missing case scores: ${missing.join(', ')}`);
  }

  const assessment = value.familyAssessment;
  if (!assessment || typeof assessment !== 'object' || Array.isArray(assessment)) throw new Error(`${value.familyId}.familyAssessment is required.`);
  boundedNumber(assessment.sensitivity_quality, 0, 10, `${value.familyId}.sensitivity_quality`);
  const familyRationale = nonEmptyString(assessment.rationale, `${value.familyId}.familyAssessment.rationale`).trim();
  for (const field of listFields) stringArray(assessment[field], `${value.familyId}.familyAssessment.${field}`);
  if (SYNTHETIC_FAMILY_RATIONALES.has(familyRationale) || familyRationale.startsWith(SYNTHETIC_FAMILY_RATIONALE_PREFIX)) {
    throw new Error(`${value.familyId}: synthesized familyAssessment is not valid judge evidence; rerun the family.`);
  }
  if (assessment.algorithmAdjustmentHypotheses.some((hypothesis) => SYNTHETIC_HYPOTHESES.has(hypothesis.trim()))) {
    throw new Error(`${value.familyId}: synthesized family hypothesis is not valid judge evidence; rerun the family.`);
  }
  for (const field of ['overreactionCases', 'underreactionCases', 'goodSensitivityCases']) {
    const ids = assessment[field];
    if (new Set(ids).size !== ids.length) throw new Error(`${value.familyId}.${field} contains duplicate case ids.`);
    for (const id of ids) if (!expectedCaseIds.has(id)) throw new Error(`${value.familyId}.${field} references unknown case ${id}.`);
  }
  return value;
}

const families = rawRows.map(parseJudgeRow);
if (families.length !== expectedByFamily.size) {
  const missing = [...expectedByFamily.keys()].filter((id) => !seenFamilies.has(id));
  throw new Error(`Judge output covers ${families.length}/${expectedByFamily.size} families. Missing: ${missing.join(', ')}`);
}

const cases = families.flatMap((family) => family.caseScores.map((item) => ({ familyId: family.familyId, ...item })));
const average = (values) => values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
const normalizedText = (value) => String(value ?? '').trim().replace(/\s+/g, ' ');
const countStrings = (values) => {
  const counts = new Map();
  for (const value of values) {
    const normalized = normalizedText(value);
    if (normalized) counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
};

const scoreAverages = Object.fromEntries(requiredScores.map((key) => [key, average(cases.map((item) => item.scores[key]))]));
const weakestCases = [...cases].sort((a, b) => a.scores.overall - b.scores.overall).slice(0, 15);
const strongestCases = [...cases].sort((a, b) => b.scores.overall - a.scores.overall).slice(0, 10);
const familySensitivity = families.map((family) => ({
  familyId: family.familyId,
  sensitivityQuality: family.familyAssessment.sensitivity_quality,
  rationale: family.familyAssessment.rationale,
  overreactionCases: family.familyAssessment.overreactionCases,
  underreactionCases: family.familyAssessment.underreactionCases,
  algorithmAdjustmentHypotheses: family.familyAssessment.algorithmAdjustmentHypotheses,
})).sort((a, b) => a.sensitivityQuality - b.sensitivityQuality || a.familyId.localeCompare(b.familyId));
const familyHypotheses = countStrings(families.flatMap((family) => family.familyAssessment.algorithmAdjustmentHypotheses)).map(({ value: hypothesis, count }) => ({ hypothesis, count }));
const caseFlagCounts = countStrings(cases.flatMap((item) => item.flags)).map(({ value: flag, count }) => ({ flag, count }));
const caseSuggestedChangeCounts = countStrings(cases.flatMap((item) => item.suggestedChanges)).map(({ value: suggestion, count }) => ({ suggestion, count }));

let corpus;
try {
  corpus = JSON.parse(readFileSync(corpusPath, 'utf8'));
} catch (error) {
  throw new Error(`${corpusPath} is invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
}
if (!corpus || typeof corpus !== 'object' || typeof corpus.schema !== 'string') throw new Error(`Malformed corpus metadata in ${corpusPath}.`);

const manifestPath = resolve(outputDir, 'judge-run-manifest.json');
let manifest = null;
if (existsSync(manifestPath)) {
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch {
    // Best-effort manifest reading only.
  }
}

const provenance = {
  corpusCommit: corpus.commit ?? 'unknown',
  corpusSchema: corpus.schema,
  corpusSha256: hashFile(corpusPath),
  familiesSha256: hashFile(familiesPath),
  promptSha256: hashFile(promptPath),
  responseSchemaSha256: hashFile(schemaPath),
  judgeScoresSha256: hashFile(inputPath),
  judgeModel: process.env.JUDGE_MODEL ?? manifest?.judgeModel ?? process.env.LOCAL_JUDGE_MODEL ?? process.env.OLLAMA_MODEL ?? 'unknown',
  judgeProvider: process.env.JUDGE_PROVIDER ?? manifest?.judgeProvider ?? 'unknown',
  analyzedAt: new Date().toISOString(),
};

const summary = {
  schema: 'adaptive-training-recommender/ai-plan-judge-summary@3',
  source: portablePath(inputPath),
  provenance,
  familyCount: families.length,
  caseCount: cases.length,
  scoreAverages,
  meanSensitivityQuality: average(families.map((family) => family.familyAssessment.sensitivity_quality)),
  familySensitivity,
  weakestCases,
  strongestCases,
  repeatedCaseFlags: caseFlagCounts.filter((item) => item.count >= 2),
  repeatedCaseSuggestedChanges: caseSuggestedChangeCounts.filter((item) => item.count >= 2),
  caseFlagCounts,
  caseSuggestedChangeCounts,
  familyHypotheses,
  repeatedHypotheses: familyHypotheses.filter((item) => item.count >= 2),
};

const summaryMdPath = resolve(outputDir, 'judge-summary.md');
const summaryJsonPath = resolve(outputDir, 'judge-summary.json');
const provenanceJsonPath = resolve(outputDir, 'judge-run-provenance.json');
if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });
writeFileSync(summaryJsonPath, `${JSON.stringify(summary, null, 2)}\n`);
writeFileSync(provenanceJsonPath, `${JSON.stringify(provenance, null, 2)}\n`);

const lines = [
  '# AI plan judge summary', '',
  `- Generated at: ${provenance.analyzedAt}`,
  `- Families scored: ${summary.familyCount}`,
  `- Cases scored: ${summary.caseCount}`,
  `- Mean family sensitivity quality: ${summary.meanSensitivityQuality.toFixed(2)}/10`,
  `- Corpus commit: ${provenance.corpusCommit}`,
  `- Judge: ${provenance.judgeProvider}/${provenance.judgeModel}`,
  `- Families SHA-256: ${provenance.familiesSha256}`,
  `- Judge scores SHA-256: ${provenance.judgeScoresSha256}`, '',
  '## Mean absolute plan scores', '',
  ...requiredScores.map((key) => `- ${key}: ${scoreAverages[key].toFixed(2)}/10`), '',
  '## Weakest cases', '',
  ...weakestCases.map((item) => `- ${item.caseId} (${item.familyId}): ${item.scores.overall.toFixed(1)}/10 — ${item.rationale}`), '',
  '## Family sensitivity', '',
  ...familySensitivity.map((item) => `- ${item.familyId}: ${item.sensitivityQuality.toFixed(1)}/10 — ${item.rationale}`), '',
  '## Repeated case-level flags', '',
  ...(summary.repeatedCaseFlags.length ? summary.repeatedCaseFlags.map((item) => `- ${item.count}× ${item.flag}`) : ['- none']), '',
  '## Repeated case-level suggested changes', '',
  ...(summary.repeatedCaseSuggestedChanges.length ? summary.repeatedCaseSuggestedChanges.map((item) => `- ${item.count}× ${item.suggestion}`) : ['- none']), '',
  '## Repeated family-level hypotheses', '',
  ...(summary.repeatedHypotheses.length ? summary.repeatedHypotheses.map((item) => `- ${item.count}× ${item.hypothesis}`) : ['- none']), '',
  'Treat repeated case-level patterns as stronger evidence than one-off family hypotheses. Mild perturbations are not required to change a plan unless they are decision-relevant.',
];
writeFileSync(summaryMdPath, `${lines.join('\n')}\n`);

const timestamp = new Date().toLocaleTimeString('en-GB', { hour12: false });
console.log(`[${timestamp}] Validated and analyzed ${summary.caseCount} judged cases across ${summary.familyCount} families.`);
console.log(`[${timestamp}] Output files generated at ${provenance.analyzedAt}:`);
console.log(`[${timestamp}]   📄 Summary report:     ${summaryMdPath}`);
console.log(`[${timestamp}]   📊 Summary JSON:       ${summaryJsonPath}`);
console.log(`[${timestamp}]   🔒 Provenance record:  ${provenanceJsonPath}`);
