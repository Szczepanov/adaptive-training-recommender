import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createServer } from 'vite';

function argument(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : fallback;
}

const inputPath = argument('--input');
if (!inputPath) {
  console.error('Usage: npm run evidence:health-anomaly -- --input <replay.json> [--json-out <path>] [--markdown-out <path>]');
  process.exit(2);
}

const resolvedInput = resolve(inputPath);
if (!existsSync(resolvedInput)) {
  console.error(`Replay input not found: ${resolvedInput}`);
  process.exit(2);
}

const jsonOut = resolve(argument('--json-out', 'artifacts/health-anomaly-reports/latest/report.json'));
const markdownOut = resolve(argument('--markdown-out', 'artifacts/health-anomaly-reports/latest/report.md'));
const payload = JSON.parse(readFileSync(resolvedInput, 'utf8'));

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
  const module = await server.ssrLoadModule('/src/engine/healthAnomalyReplay.ts');
  report = module.runHealthAnomalyReplay(payload);
  markdown = module.renderHealthAnomalyReplayMarkdown(report);
} finally {
  await server.close();
}

for (const outputPath of [jsonOut, markdownOut]) {
  const directory = dirname(outputPath);
  if (!existsSync(directory)) mkdirSync(directory, { recursive: true });
}
writeFileSync(jsonOut, `${JSON.stringify(report, null, 2)}\n`);
writeFileSync(markdownOut, `${markdown}\n`);

console.log(`Health anomaly replay JSON written to ${jsonOut}`);
console.log(`Health anomaly replay Markdown written to ${markdownOut}`);
