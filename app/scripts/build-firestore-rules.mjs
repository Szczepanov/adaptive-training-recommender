import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { minifyRules } from './minify-firestore-rules.mjs';

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
  '99-footer.rules',
];

export async function buildRules({ directory = appDirectory, check = false } = {}) {
  const modulesDirectory = path.join(directory, 'rules');
  const names = (await readdir(modulesDirectory)).filter((name) => /^\d+-[a-z0-9-]+\.rules$/.test(name)).sort();
  const missing = RULES_MODULES.filter((name) => !names.includes(name));
  if (missing.length) throw new Error(`Missing rules modules: ${missing.join(', ')}.`);
  const modules = await Promise.all(names.map((name) => readFile(path.join(modulesDirectory, name), 'utf8')));
  const source = modules.map((module) => {
    const normalized = module.replace(/\r\n/g, '\n');
    return normalized.endsWith('\n') ? normalized : `${normalized}\n`;
  }).join('');
  minifyRules(source);
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
}
