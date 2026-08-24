import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const reviewed = process.argv.includes('--reviewed');
if (!reviewed) {
  console.error('Refusing to update the committed plan judge baseline without --reviewed.');
  console.error('Run `npm run judge:diff`, review the semantic changes, then rerun:');
  console.error('  npm run judge:update-baseline -- --reviewed');
  process.exit(1);
}

const summaryPath = resolve('artifacts/ai-plan-judge/latest/judge-summary.json');
if (!existsSync(summaryPath)) {
  console.error(`Fresh plan judge summary not found at ${summaryPath}.`);
  console.error('Run `npm run judge:local` or `npm run judge:run` first.');
  process.exit(1);
}

let summary;
try {
  summary = JSON.parse(readFileSync(summaryPath, 'utf8'));
} catch (error) {
  console.error(`Plan judge summary is malformed JSON: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

if (!summary || summary.familyCount === undefined || !Array.isArray(summary.familySensitivity)) {
  console.error('Plan judge summary is missing required family fields; baseline not updated.');
  process.exit(1);
}

const baselinePath = resolve('../docs/analysis/plan-judge-baseline.json');
writeFileSync(baselinePath, `${JSON.stringify(summary, null, 2)}\n`);
console.log(`Reviewed plan judge baseline updated at ${baselinePath}.`);
