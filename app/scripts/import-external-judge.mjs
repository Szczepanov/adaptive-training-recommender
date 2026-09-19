import { resolve } from 'node:path';
import { importExternalRun, suiteConfig } from './ai-judge/externalRun.mjs';

function help() {
  console.log(`Usage: node scripts/import-external-judge.mjs --suite <plan|persona> [options]

Options:
  --package <dir>         External package directory (default: artifacts/external-judge/<suite>/latest)
  --responses <dir>       Saved response JSON directory (default: <package>/responses)
  --out <dir>             Normal suite artifact directory (default: artifacts/<suite>-plan-judge/latest)
  --model <label>         Explicit external model label (default: external-manual-unknown)
  --dry-run               Print resolved paths without writing suite artifacts
  --help                  Show this help
`);
}

function valueAfter(args, flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

const args = process.argv.slice(2);
if (args.includes('--help') || args.length === 0) {
  help();
  process.exit(0);
}

const suite = valueAfter(args, '--suite');
const config = suiteConfig(suite);
const packageDir = valueAfter(args, '--package') ?? `artifacts/external-judge/${suite}/latest`;
const responsesDir = valueAfter(args, '--responses');
const outputDir = valueAfter(args, '--out') ?? config.outputDir;
const model = valueAfter(args, '--model') ?? 'external-manual-unknown';

if (args.includes('--dry-run')) {
  console.log(JSON.stringify({ suite, packageDir: resolve(packageDir), responsesDir: resolve(responsesDir ?? `${packageDir}/responses`), outputDir: resolve(outputDir), model }, null, 2));
  process.exit(0);
}

const result = importExternalRun({ suite, packageDir, responsesDir, outputDir, model, expectedSuite: suite });
console.log(`Imported ${result.rows.length} ${suite} external judge families into ${result.outputDir}`);
