import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const outputDir = resolve('artifacts/ai-plan-judge/latest');
const familiesPath = resolve(outputDir, 'families.jsonl');
const corpusPath = resolve(outputDir, 'corpus.json');
const OLD_WARNING = /^Event-specific exposure occurred off the nominated anchor date in (\d+) week\(s\)\.$/;

function normalizeWarning(value) {
  if (typeof value !== 'string') return value;
  const match = value.match(OLD_WARNING);
  return match
    ? `Event-specific exposure occurred off the nominated anchor date in ${match[1]} week(s) (adaptively fulfilled in-window).`
    : value;
}

function normalizeFamily(family) {
  return {
    ...family,
    cases: (family.cases ?? []).map((item) => ({
      ...item,
      engineSummary: item.engineSummary
        ? {
            ...item.engineSummary,
            qualityWarnings: (item.engineSummary.qualityWarnings ?? []).map(normalizeWarning),
          }
        : item.engineSummary,
    })),
  };
}

if (!existsSync(familiesPath) || !existsSync(corpusPath)) {
  throw new Error(`Missing generated judge corpus under ${outputDir}.`);
}

const familyRows = readFileSync(familiesPath, 'utf8')
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean)
  .map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(`${familiesPath}:${index + 1} invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
const normalizedFamilies = familyRows.map(normalizeFamily);
writeFileSync(familiesPath, `${normalizedFamilies.map((family) => JSON.stringify(family)).join('\n')}\n`);

let corpus;
try {
  corpus = JSON.parse(readFileSync(corpusPath, 'utf8'));
} catch (error) {
  throw new Error(`${corpusPath} invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
}
corpus.families = (corpus.families ?? []).map(normalizeFamily);
const corrections = Array.isArray(corpus.harnessCorrections) ? corpus.harnessCorrections : [];
if (!corrections.includes('judge-facing anchor-placement warning normalization')) {
  corpus.harnessCorrections = [...corrections, 'judge-facing anchor-placement warning normalization'];
}
writeFileSync(corpusPath, `${JSON.stringify(corpus, null, 2)}\n`);

console.log('Normalized judge-facing simulation diagnostics without modifying shared engine code.');
