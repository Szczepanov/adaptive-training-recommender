import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { minifyRules, minifyRulesWithOrigins } from './minify-firestore-rules.mjs';

const appDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const RULES_MODULES = [
  '00-header.rules',
  '01-users-core.rules',
  '02-schedule-windows.rules',
  '03-external-plans.rules',
  '04-session-occurrences.rules',
  '05-session-executions.rules',
  '06-recommendations.rules',
  '07-health-anomalies.rules',
  '08-outcomes-trials.rules',
  '09-nutrition-anthropometry.rules',
  '10-ledger-flags.rules',
  '99-footer.rules',
];

// Firebase rejects a release whose *compiled* ruleset exceeds 256,000 bytes; compiled size
// counts logic and string literals and measured ~1.95-1.98x the minified source. This budget
// keeps ~10% below that deploy-time limit (118,000 * 1.96 = ~231,000 bytes). See ADR-0053.
export const MAX_MINIFIED_RULES_BYTES = 118000;

export function assertMinifiedRulesBudget(minified) {
  const bytes = Buffer.byteLength(minified, 'utf8');
  if (bytes > MAX_MINIFIED_RULES_BYTES) {
    throw new Error(
      `Minified Firestore rules are ${bytes} bytes, over the ${MAX_MINIFIED_RULES_BYTES}-byte budget. `
      + 'Firebase rejects deploys whose compiled ruleset exceeds 256,000 bytes, measured at ~1.95-1.98x '
      + 'the minified source. Move nested value checks that a TypeScript validator enforces on the '
      + 'write path out of the rules (ADR-0053), or factor repeated expressions into helpers in '
      + 'rules/00-header.rules.',
    );
  }
  return bytes;
}

// Concatenates the rules modules exactly as the generated file is built and records each
// module's [start, end) offset range within the concatenation.
async function assembleRules(directory) {
  const modulesDirectory = path.join(directory, 'rules');
  const names = (await readdir(modulesDirectory)).filter((name) => /^\d+-[a-z0-9-]+\.rules$/.test(name)).sort();
  const missing = RULES_MODULES.filter((name) => !names.includes(name));
  if (missing.length) throw new Error(`Missing rules modules: ${missing.join(', ')}.`);
  const modules = await Promise.all(names.map((name) => readFile(path.join(modulesDirectory, name), 'utf8')));
  let offset = 0;
  const boundaries = [];
  const source = modules.map((module, position) => {
    const normalized = module.replace(/\r\n/g, '\n');
    const text = normalized.endsWith('\n') ? normalized : `${normalized}\n`;
    boundaries.push({ name: names[position], start: offset, end: offset + text.length });
    offset += text.length;
    return text;
  }).join('');
  return { source, boundaries };
}

// Informational per-module attribution of the minified size (by token provenance, so the
// parts sum exactly to the minified total). Never affects the build result.
export function rulesSizeReportFor(source, boundaries) {
  const { minified, modules } = minifyRulesWithOrigins(source, boundaries);
  const total = Buffer.byteLength(minified, 'utf8');
  return {
    total,
    budget: MAX_MINIFIED_RULES_BYTES,
    headroom: MAX_MINIFIED_RULES_BYTES - total,
    modules: modules.map(({ name, bytes }) => ({ name, bytes, share: total === 0 ? 0 : bytes / total })),
  };
}

export async function rulesSizeReport({ directory = appDirectory } = {}) {
  const { source, boundaries } = await assembleRules(directory);
  return rulesSizeReportFor(source, boundaries);
}

export function formatRulesSizeReport(report) {
  const format = new Intl.NumberFormat('en-US');
  const width = Math.max(...report.modules.map((module) => module.name.length));
  const bytesWidth = Math.max(...report.modules.map((module) => format.format(module.bytes).length));
  const lines = [
    `Minified Firestore rules: ${format.format(report.total)} bytes (budget ${format.format(report.budget)}; headroom ${format.format(report.headroom)})`,
    ...report.modules.map((module) => `  ${module.name.padEnd(width)}  ${format.format(module.bytes).padStart(bytesWidth)}  ${(module.share * 100).toFixed(1).padStart(5)}%`),
  ];
  return lines.join('\n');
}

export async function buildRules({ directory = appDirectory, check = false } = {}) {
  const { source } = await assembleRules(directory);
  assertMinifiedRulesBudget(minifyRules(source));
  const outputPath = path.join(directory, 'firestore.rules');
  if (check) {
    let existing;
    try {
      existing = await readFile(outputPath, 'utf8');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      throw new Error('Generated firestore.rules is missing. Run "npm run rules:build".');
    }
    if (existing.replace(/\r\n/g, '\n') !== source) {
      throw new Error('Generated firestore.rules is stale. Run "npm run rules:build".');
    }
  } else {
    await writeFile(outputPath, source, 'utf8');
  }
  return source;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== '--check')) throw new Error('Usage: build-firestore-rules.mjs [--check]');
  await buildRules({ check: args.includes('--check') });
  console.log(args.includes('--check') ? 'Generated Firestore rules are in sync.' : 'Generated readable firestore.rules.');
  console.log(formatRulesSizeReport(await rulesSizeReport()));
}
