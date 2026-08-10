import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const reviewed = process.argv.includes('--reviewed');
if (!reviewed) {
  console.error('Refusing to update the committed simulation baseline without --reviewed.');
  console.error('Run `npm run simulate:diff`, review the semantic changes, then rerun:');
  console.error('  npm run simulate:update-baseline -- --reviewed');
  process.exit(1);
}

// Always regenerate the report first. This prevents a stale artifact from becoming the
// committed baseline and also re-runs the aggregate invariant gate before any write.
execFileSync(process.execPath, ['scripts/simulate-scenarios.mjs'], {
  cwd: resolve('.'),
  stdio: 'inherit',
});

const reportPath = resolve('artifacts/simulation-reports/latest/report.json');
if (!existsSync(reportPath)) {
  console.error(`Fresh simulation report not found at ${reportPath}.`);
  process.exit(1);
}

let report;
try {
  report = JSON.parse(readFileSync(reportPath, 'utf8'));
} catch (error) {
  console.error(`Fresh simulation report is malformed JSON: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

if (!report || !Array.isArray(report.scenarios)) {
  console.error('Fresh simulation report does not contain a scenarios array; baseline not updated.');
  process.exit(1);
}

const baselinePath = resolve('../docs/analysis/simulation-baseline.json');
const normalizedBaseline = {
  ...report,
  commit: 'baseline',
  capturedAt: 'baseline',
};
writeFileSync(baselinePath, `${JSON.stringify(normalizedBaseline, null, 2)}\n`);
console.log(`Reviewed simulation baseline updated at ${baselinePath}.`);
