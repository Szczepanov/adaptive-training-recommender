import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const inputPath = resolve(process.argv[2] ?? 'artifacts/ai-plan-judge/latest/judge-scores.jsonl');
if (!existsSync(inputPath)) {
  console.error(`Missing judge score file: ${inputPath}`);
  console.error('Feed families.jsonl + judge-prompt.md to the AI judge, save its JSONL response as judge-scores.jsonl, then rerun.');
  process.exit(1);
}

const rows = readFileSync(inputPath, 'utf8').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
const requiredScores = ['safety_recovery_fit', 'goal_event_fit', 'sequencing', 'periodization_taper', 'preference_capacity_fit', 'robustness', 'overall'];

function boundedNumber(value, min, max, field) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${field} must be a finite number in [${min}, ${max}], got ${JSON.stringify(value)}`);
  }
  return value;
}

function parseRow(line, index) {
  let value;
  try {
    value = JSON.parse(line);
  } catch (error) {
    throw new Error(`Line ${index + 1} is not valid JSON: ${error.message}`);
  }
  if (!value || typeof value !== 'object' || typeof value.familyId !== 'string' || !Array.isArray(value.caseScores)) {
    throw new Error(`Line ${index + 1} must contain familyId and caseScores.`);
  }
  for (const item of value.caseScores) {
    if (typeof item.caseId !== 'string' || !item.scores || typeof item.scores !== 'object') {
      throw new Error(`Line ${index + 1} has a malformed case score.`);
    }
    for (const key of requiredScores) boundedNumber(item.scores[key], 0, 10, `${item.caseId}.${key}`);
    boundedNumber(item.confidence, 0, 1, `${item.caseId}.confidence`);
    if (item.flags !== undefined && !Array.isArray(item.flags)) throw new Error(`${item.caseId}.flags must be an array when supplied.`);
    if (item.suggestedChanges !== undefined && !Array.isArray(item.suggestedChanges)) throw new Error(`${item.caseId}.suggestedChanges must be an array when supplied.`);
  }
  boundedNumber(value.familyAssessment?.sensitivity_quality, 0, 10, `${value.familyId}.sensitivity_quality`);
  return value;
}

function normalizedText(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

function countStrings(values) {
  const counts = new Map();
  for (const value of values) {
    const normalized = normalizedText(value);
    if (!normalized) continue;
    counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((left, right) => right.count - left.count || left.value.localeCompare(right.value));
}

const families = rows.map(parseRow);
const cases = families.flatMap((family) => family.caseScores.map((item) => ({ familyId: family.familyId, ...item })));
const average = (values) => values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;

const scoreAverages = Object.fromEntries(requiredScores.map((key) => [key, average(cases.map((item) => item.scores[key]))]));
const weakestCases = [...cases].sort((left, right) => left.scores.overall - right.scores.overall).slice(0, 15);
const strongestCases = [...cases].sort((left, right) => right.scores.overall - left.scores.overall).slice(0, 10);
const familySensitivity = families.map((family) => ({
  familyId: family.familyId,
  sensitivityQuality: family.familyAssessment.sensitivity_quality,
  rationale: family.familyAssessment.rationale,
  overreactionCases: family.familyAssessment.overreactionCases ?? [],
  underreactionCases: family.familyAssessment.underreactionCases ?? [],
  algorithmAdjustmentHypotheses: family.familyAssessment.algorithmAdjustmentHypotheses ?? [],
})).sort((left, right) => left.sensitivityQuality - right.sensitivityQuality);

// Family hypotheses are useful hypotheses, but they are not repeated evidence: each family
// assessment is emitted once. Keep them for inspection without labelling a 1x family string
// as repetition. Repetition is measured below from case-level structured flags and concrete
// suggested changes.
const familyHypotheses = countStrings(families.flatMap((family) => family.familyAssessment.algorithmAdjustmentHypotheses ?? []))
  .map(({ value: hypothesis, count }) => ({ hypothesis, count }));

const caseFlagCounts = countStrings(cases.flatMap((item) => item.flags ?? []))
  .map(({ value: flag, count }) => ({ flag, count }));
const repeatedCaseFlags = caseFlagCounts.filter((item) => item.count >= 2);

const caseSuggestedChangeCounts = countStrings(cases.flatMap((item) => item.suggestedChanges ?? []))
  .map(({ value: suggestion, count }) => ({ suggestion, count }));
const repeatedCaseSuggestedChanges = caseSuggestedChangeCounts.filter((item) => item.count >= 2);

// Preserve the historical field name for downstream readers, but make its semantics honest:
// it now contains only hypotheses with evidence repeated across 2+ family assessments.
const repeatedHypotheses = familyHypotheses.filter((item) => item.count >= 2);

const summary = {
  schema: 'adaptive-training-recommender/ai-plan-judge-summary@2',
  source: inputPath,
  familyCount: families.length,
  caseCount: cases.length,
  scoreAverages,
  meanSensitivityQuality: average(families.map((family) => family.familyAssessment.sensitivity_quality)),
  familySensitivity,
  weakestCases,
  strongestCases,
  repeatedCaseFlags,
  repeatedCaseSuggestedChanges,
  caseFlagCounts,
  caseSuggestedChangeCounts,
  familyHypotheses,
  repeatedHypotheses,
};

const outputDir = resolve('artifacts/ai-plan-judge/latest');
if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });
writeFileSync(resolve(outputDir, 'judge-summary.json'), `${JSON.stringify(summary, null, 2)}\n`);

const lines = [
  '# AI plan judge summary',
  '',
  `- Families scored: ${summary.familyCount}`,
  `- Cases scored: ${summary.caseCount}`,
  `- Mean family sensitivity quality: ${summary.meanSensitivityQuality.toFixed(2)}/10`,
  '',
  '## Mean absolute plan scores',
  '',
  ...requiredScores.map((key) => `- ${key}: ${scoreAverages[key].toFixed(2)}/10`),
  '',
  '## Weakest cases',
  '',
  ...weakestCases.map((item) => `- ${item.caseId} (${item.familyId}): ${item.scores.overall.toFixed(1)}/10 — ${item.rationale ?? ''}`),
  '',
  '## Family sensitivity',
  '',
  ...familySensitivity.map((item) => `- ${item.familyId}: ${item.sensitivityQuality.toFixed(1)}/10 — ${item.rationale ?? ''}`),
  '',
  '## Repeated case-level flags',
  '',
  ...(repeatedCaseFlags.length > 0 ? repeatedCaseFlags.map((item) => `- ${item.count}× ${item.flag}`) : ['- none']),
  '',
  '## Repeated case-level suggested changes',
  '',
  ...(repeatedCaseSuggestedChanges.length > 0 ? repeatedCaseSuggestedChanges.map((item) => `- ${item.count}× ${item.suggestion}`) : ['- none']),
  '',
  '## Repeated family-level hypotheses',
  '',
  ...(repeatedHypotheses.length > 0 ? repeatedHypotheses.map((item) => `- ${item.count}× ${item.hypothesis}`) : ['- none']),
  '',
  '## All family-level hypotheses',
  '',
  ...(familyHypotheses.length > 0 ? familyHypotheses.map((item) => `- ${item.count}× ${item.hypothesis}`) : ['- none']),
  '',
  'Treat repeated case-level patterns as stronger evidence than a one-off family hypothesis. Avoid changing a physiological threshold solely because one isolated case or one family assessment scored poorly.',
];
writeFileSync(resolve(outputDir, 'judge-summary.md'), `${lines.join('\n')}\n`);
console.log(`Analyzed ${summary.caseCount} judged cases. Summary written to ${outputDir}`);
