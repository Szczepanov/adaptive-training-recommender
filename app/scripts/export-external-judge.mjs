import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { buildExternalPackage, suiteConfig } from './ai-judge/externalRun.mjs';

function help() {
  console.log(`Usage: node scripts/export-external-judge.mjs --suite <plan|persona> [options]

Options:
  --out <dir>             External package directory (default: artifacts/external-judge/<suite>/latest)
  --source <dir>          Existing deterministic artifact directory
  --no-build              Do not regenerate deterministic artifacts
  --hybrid-expansion      Build the optional persona hybrid expansion suite
  --dry-run               Print the resolved operation without writing files
  --help                  Show this help
`);
}

function valueAfter(args, flag) {
  const index = args.indexOf(flag);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value.`);
  return value;
}

const args = process.argv.slice(2);
if (args.includes('--help') || args.length === 0) {
  help();
  process.exit(0);
}

const suite = valueAfter(args, '--suite');
const config = suiteConfig(suite);
const explicitSourceDir = valueAfter(args, '--source');
const outputDir = valueAfter(args, '--out') ?? `artifacts/external-judge/${suite}/latest`;
const noBuild = args.includes('--no-build');
const hybridExpansion = args.includes('--hybrid-expansion');
if (hybridExpansion && suite !== 'persona') throw new Error('--hybrid-expansion is only valid for the persona suite.');
const sourceDir = explicitSourceDir ?? (suite === 'persona' && hybridExpansion ? config.hybridSourceDir : config.sourceDir);

if (args.includes('--dry-run')) {
  console.log(JSON.stringify({ suite, sourceDir: resolve(sourceDir), outputDir: resolve(outputDir), build: !noBuild && !explicitSourceDir, hybridExpansion }, null, 2));
  process.exit(0);
}

function runNode(script, scriptArgs) {
  const result = spawnSync(process.execPath, [script, ...scriptArgs], { stdio: 'inherit', shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (!noBuild && !explicitSourceDir) {
  if (suite === 'plan') {
    const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const result = spawnSync(npmCommand, ['run', 'simulate:plan-judge'], { stdio: 'inherit', shell: false });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status ?? 1);
  } else {
    runNode('scripts/run-persona-ai-judge.mjs', [
      '--build-only',
      ...(hybridExpansion ? ['--hybrid-expansion'] : []),
    ]);
  }
}

const manifest = buildExternalPackage({ suite, sourceDir, outputDir });
console.log(`Created ${suite} external judge package with ${manifest.families.length} families at ${resolve(outputDir)}`);
console.log(`Upload only ${resolve(outputDir, 'upload')} to the external LLM; keep responses/ and local-provenance/ local.`);
