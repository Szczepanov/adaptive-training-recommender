import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const baselinePath = resolve('../docs/analysis/plan-judge-baseline.json');
const currentPath = resolve('artifacts/ai-plan-judge/latest/judge-summary.json');

if (!existsSync(baselinePath)) {
  console.error(`Missing plan judge baseline file: ${baselinePath}`);
  process.exit(1);
}

if (!existsSync(currentPath)) {
  console.error(`Missing current plan judge summary file: ${currentPath}. Run 'npm run simulate:plan-judge && npm run analyze:plan-judge' first.`);
  process.exit(1);
}

const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
const current = JSON.parse(readFileSync(currentPath, 'utf8'));

console.log('=== AI Plan Judge Baseline Diff Check ===\n');
console.log(`Baseline Families: ${baseline.familyCount} | Cases: ${baseline.caseCount} | Mean Sensitivity: ${(baseline.meanSensitivityQuality ?? 0).toFixed(2)}/10`);
console.log(`Current  Families: ${current.familyCount} | Cases: ${current.caseCount} | Mean Sensitivity: ${(current.meanSensitivityQuality ?? 0).toFixed(2)}/10\n`);

let diffCount = 0;
const round2 = (num) => Math.round(num * 100) / 100;

console.log('--- Dimension Score Comparison ---');
for (const [key, baseVal] of Object.entries(baseline.scoreAverages)) {
  const curVal = current.scoreAverages[key] ?? 0;
  const delta = curVal - baseVal;
  const flag = delta < -0.1 ? ' [REGRESSION]' : delta > 0.1 ? ' [IMPROVEMENT]' : '';
  if (flag) diffCount++;
  console.log(`  ${key.padEnd(24)}: ${round2(baseVal).toFixed(2)} -> ${round2(curVal).toFixed(2)} (delta: ${delta >= 0 ? '+' : ''}${round2(delta).toFixed(2)})${flag}`);
}

console.log('\n--- Family Sensitivity Comparison ---');
const baseFamMap = new Map(baseline.familySensitivity.map((f) => [f.familyId, f]));
for (const curFam of current.familySensitivity) {
  const baseFam = baseFamMap.get(curFam.familyId);
  if (!baseFam) {
    console.log(`  [NEW FAMILY] ${curFam.familyId}: sensitivity ${curFam.sensitivityQuality}/10`);
    diffCount++;
    continue;
  }
  const delta = curFam.sensitivityQuality - baseFam.sensitivityQuality;
  const flag = delta < -0.2 ? ' [REGRESSION]' : delta > 0.2 ? ' [IMPROVEMENT]' : '';
  if (flag) diffCount++;
  console.log(`  ${curFam.familyId.padEnd(30)}: ${baseFam.sensitivityQuality}/10 -> ${curFam.sensitivityQuality}/10 (delta: ${delta >= 0 ? '+' : ''}${round2(delta).toFixed(2)})${flag}`);
}

console.log(`\nDiff check complete. ${diffCount} notable score differences detected.`);
