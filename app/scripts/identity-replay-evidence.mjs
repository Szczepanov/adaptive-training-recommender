import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createServer } from 'vite';

function argument(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : fallback;
}

const inputPath = argument('--input');
if (!inputPath) {
  console.error(
    'Usage: npm run evidence:identity-replay -- --input <replay.json> [--json-out <path>] [--markdown-out <path>]',
  );
  console.error(
    'Input JSON shape: { "nights": IdentityReplayNightInput[], "config": IdentityReplayConfig }',
  );
  console.error('See app/src/engine/identityReplay.ts for the exact contracts.');
  process.exit(2);
}

const resolvedInput = resolve(inputPath);
if (!existsSync(resolvedInput)) {
  console.error(`Replay input not found: ${resolvedInput}`);
  process.exit(2);
}

const jsonOut = resolve(argument('--json-out', 'artifacts/identity-replay-reports/latest/report.json'));
const markdownOut = resolve(argument('--markdown-out', 'artifacts/identity-replay-reports/latest/report.md'));
const payload = JSON.parse(readFileSync(resolvedInput, 'utf8'));

if (!Array.isArray(payload.nights) || !payload.config) {
  console.error('Replay input must be { "nights": [...], "config": {...} } -- see identityReplay.ts.');
  process.exit(2);
}

const server = await createServer({
  configFile: false,
  root: resolve('.'),
  logLevel: 'warn',
  server: { middlewareMode: true },
  appType: 'custom',
});

let report;
let markdown;
try {
  const module = await server.ssrLoadModule('/src/engine/identityReplay.ts');
  report = module.runIdentityReplay(payload.nights, payload.config);
  markdown = module.renderIdentityReplayMarkdown(report);
} finally {
  await server.close();
}

for (const outputPath of [jsonOut, markdownOut]) {
  const directory = dirname(outputPath);
  if (!existsSync(directory)) mkdirSync(directory, { recursive: true });
}
writeFileSync(jsonOut, `${JSON.stringify(report, null, 2)}\n`);
writeFileSync(markdownOut, `${markdown}\n`);

console.log(`Identity replay JSON written to ${jsonOut}`);
console.log(`Identity replay Markdown written to ${markdownOut}`);
console.log(
  `Paired nights: ${report.pairedNightCount}, automatic USER coverage: ${(report.automaticUserCoverage * 100).toFixed(1)}%`,
);
