import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServer } from 'vite';

const baselinePath = resolve('../docs/analysis/simulation-baseline.json');

if (!existsSync(baselinePath)) {
  console.error(`Baseline file not found at ${baselinePath}. Create it only after review with npm run simulate:update-baseline -- --reviewed.`);
  process.exit(1);
}

let baseline;
try {
  baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
} catch (error) {
  console.error(`Baseline file at ${baselinePath} is malformed JSON: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

if (!baseline || !Array.isArray(baseline.scenarios)) {
  console.error(`Baseline file at ${baselinePath} does not contain a scenarios array.`);
  process.exit(1);
}

const server = await createServer({
  configFile: false,
  root: resolve('.'),
  logLevel: 'warn',
  server: { middlewareMode: true },
  appType: 'custom',
});

let current;
try {
  const { runAllScenarios } = await server.ssrLoadModule('/src/engine/simulation/analyze.ts');
  current = await runAllScenarios(undefined, 'current');
} finally {
  await server.close();
}

console.log('=== Simulation Semantic Diff against Committed Baseline ===\n');

let changesFound = false;

const currentByScenario = new Map(current.scenarios.map((s) => [s.scenarioId, s]));

for (const baseScenario of baseline.scenarios) {
  const curScenario = currentByScenario.get(baseScenario.scenarioId);
  if (!curScenario) {
    console.log(`[REMOVED SCENARIO] ${baseScenario.scenarioId}`);
    changesFound = true;
    continue;
  }

  const diffs = [];

  // 1. Rest/Recovery Pct
  if (baseScenario.restOrRecoveryDayPct !== curScenario.restOrRecoveryDayPct) {
    diffs.push(`  Rest/Recovery %: ${baseScenario.restOrRecoveryDayPct}% -> ${curScenario.restOrRecoveryDayPct}%`);
  }

  // 2. Modality Distribution
  const allModalities = new Set([
    ...Object.keys(baseScenario.modalityDistribution),
    ...Object.keys(curScenario.modalityDistribution),
  ]);
  const modDiffs = [];
  for (const mod of allModalities) {
    const bVal = baseScenario.modalityDistribution[mod] ?? 0;
    const cVal = curScenario.modalityDistribution[mod] ?? 0;
    if (bVal !== cVal) {
      modDiffs.push(`${mod}: ${bVal} -> ${cVal}`);
    }
  }
  if (modDiffs.length > 0) {
    diffs.push(`  Modality dist: ${modDiffs.join(', ')}`);
  }

  // 3. Category Distribution
  const allCategories = new Set([
    ...Object.keys(baseScenario.categoryDistribution),
    ...Object.keys(curScenario.categoryDistribution),
  ]);
  const catDiffs = [];
  for (const cat of allCategories) {
    const bVal = baseScenario.categoryDistribution[cat] ?? 0;
    const cVal = curScenario.categoryDistribution[cat] ?? 0;
    if (bVal !== cVal) {
      catDiffs.push(`${cat}: ${bVal} -> ${cVal}`);
    }
  }
  if (catDiffs.length > 0) {
    diffs.push(`  Category dist: ${catDiffs.join(', ')}`);
  }

  // 4. Fatigue Tier Days
  const bFat = baseScenario.fatigueTierDayCounts;
  const cFat = curScenario.fatigueTierDayCounts;
  if (bFat.train !== cFat.train || bFat.modify !== cFat.modify || bFat.recover !== cFat.recover) {
    diffs.push(`  Fatigue tiers (train/modify/recover): ${bFat.train}/${bFat.modify}/${bFat.recover} -> ${cFat.train}/${cFat.modify}/${cFat.recover}`);
  }

  // 5. Objective Resolution
  const baseObjMap = new Map(baseScenario.objectiveResolution.map((o) => [o.key, o]));
  const curObjMap = new Map(curScenario.objectiveResolution.map((o) => [o.key, o]));
  const allObjKeys = new Set([...baseObjMap.keys(), ...curObjMap.keys()]);
  const objDiffs = [];
  for (const objKey of allObjKeys) {
    const bObj = baseObjMap.get(objKey);
    const cObj = curObjMap.get(objKey);
    const bStr = bObj ? `${bObj.timesResolved}/${bObj.timesGenerated}` : '0/0';
    const cStr = cObj ? `${cObj.timesResolved}/${cObj.timesGenerated}` : '0/0';
    if (bStr !== cStr) {
      objDiffs.push(`${objKey}: ${bStr} -> ${cStr}`);
    }
  }
  if (objDiffs.length > 0) {
    diffs.push(`  Objective resolution: ${objDiffs.join(', ')}`);
  }

  // 6. Objective Credits -- which sessions actually earned credit, not just the tally.
  const creditKey = (c) => `${c.weekIndex}|${c.date}|${c.objectiveKey}|${c.templateId}`;
  const baseCreditKeys = new Set(baseScenario.objectiveCredits.map(creditKey));
  const curCreditKeys = new Set(curScenario.objectiveCredits.map(creditKey));
  if (baseCreditKeys.size !== curCreditKeys.size
      || ![...baseCreditKeys].every((k) => curCreditKeys.has(k))) {
    diffs.push(`  Objective credits: ${baseCreditKeys.size} -> ${curCreditKeys.size} entries (set changed)`);
  }

  // 7. Utility diagnostics
  const bUtil = baseScenario.utilityDiagnostics;
  const cUtil = curScenario.utilityDiagnostics;
  const utilDiffs = [];
  for (const key of ['fragileSelectionCount', 'lowerBenefitSelectionCount', 'trainTierRestOrRecoveryCount']) {
    if (bUtil[key] !== cUtil[key]) utilDiffs.push(`${key}: ${bUtil[key]} -> ${cUtil[key]}`);
  }
  if (utilDiffs.length > 0) {
    diffs.push(`  Utility diagnostics: ${utilDiffs.join(', ')}`);
  }

  // 8. Quality warnings
  const baseWarnings = [...baseScenario.qualityWarnings].sort();
  const curWarnings = [...curScenario.qualityWarnings].sort();
  if (JSON.stringify(baseWarnings) !== JSON.stringify(curWarnings)) {
    diffs.push(`  Quality warnings: [${baseWarnings.join(' | ')}] -> [${curWarnings.join(' | ')}]`);
  }

  // 9. Anchor weeks
  const anchorKey = (w) => `${w.weekIndex}|${w.eventSpecificAnchorDate}|${w.qualityAnchorDate}|${w.eventSpecificAnchorHit}|${w.eventSpecificAnchorFulfilled}|${w.qualityAnchorHit}`;
  const baseAnchorKeys = baseScenario.anchorWeeks.map(anchorKey);
  const curAnchorKeys = curScenario.anchorWeeks.map(anchorKey);
  if (JSON.stringify(baseAnchorKeys) !== JSON.stringify(curAnchorKeys)) {
    diffs.push(`  Anchor weeks changed (${baseAnchorKeys.length} -> ${curAnchorKeys.length} weeks, or hit/fulfilled state differs)`);
  }

  // 10. Same-template streak diagnostics
  if (baseScenario.maxConsecutiveSameTemplateStreakWithinCall !== curScenario.maxConsecutiveSameTemplateStreakWithinCall) {
    diffs.push(`  Max streak within call: ${baseScenario.maxConsecutiveSameTemplateStreakWithinCall} -> ${curScenario.maxConsecutiveSameTemplateStreakWithinCall}`);
  }
  if (baseScenario.maxConsecutiveSameTemplateStreakAcrossWeeks !== curScenario.maxConsecutiveSameTemplateStreakAcrossWeeks) {
    diffs.push(`  Max streak across weeks: ${baseScenario.maxConsecutiveSameTemplateStreakAcrossWeeks} -> ${curScenario.maxConsecutiveSameTemplateStreakAcrossWeeks}`);
  }

  if (diffs.length > 0) {
    changesFound = true;
    console.log(`[MODIFIED] ${curScenario.label} (${curScenario.scenarioId}):`);
    diffs.forEach((d) => console.log(d));
    console.log('');
  }
}

for (const curScenario of current.scenarios) {
  if (!baseline.scenarios.some((s) => s.scenarioId === curScenario.scenarioId)) {
    console.log(`[NEW SCENARIO] ${curScenario.scenarioId}: ${curScenario.label}`);
    changesFound = true;
  }
}

// 11. Readiness/preference sensitivity are top-level report fields.
const sensitivityKey = (r) => JSON.stringify(r);
const baseReadiness = (baseline.readinessSensitivity ?? []).map(sensitivityKey);
const curReadiness = (current.readinessSensitivity ?? []).map(sensitivityKey);
if (JSON.stringify(baseReadiness) !== JSON.stringify(curReadiness)) {
  console.log('[MODIFIED] readinessSensitivity:');
  console.log(`  ${JSON.stringify(baseline.readinessSensitivity)} ->`);
  console.log(`  ${JSON.stringify(current.readinessSensitivity)}`);
  console.log('');
  changesFound = true;
}
const basePreference = (baseline.preferenceSensitivity ?? []).map(sensitivityKey);
const curPreference = (current.preferenceSensitivity ?? []).map(sensitivityKey);
if (JSON.stringify(basePreference) !== JSON.stringify(curPreference)) {
  console.log('[MODIFIED] preferenceSensitivity:');
  console.log(`  ${JSON.stringify(baseline.preferenceSensitivity)} ->`);
  console.log(`  ${JSON.stringify(current.preferenceSensitivity)}`);
  console.log('');
  changesFound = true;
}

if (!changesFound) {
  console.log('No semantic differences found. Current simulation matches committed baseline.');
}
