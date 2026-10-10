import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  appDirectory,
  accessToken,
  compareLocalFirestoreRules,
  inspectDeployedFirestoreRules,
  printComparison,
  projectFromArgs,
  rulesApiRequest,
} from './check-firestore-rules-drift.mjs';
import { buildRules } from './build-firestore-rules.mjs';
import { minifyRules } from './minify-firestore-rules.mjs';

export async function deployFirestoreRules(project, source) {
  const content = minifyRules(source);
  if (Buffer.byteLength(content, 'utf8') > 256 * 1024) {
    throw new Error('Minified Firestore rules exceed the 256 KiB source limit.');
  }
  const token = accessToken();
  const projectName = `projects/${encodeURIComponent(project)}`;
  // Creation compiles the source; avoid the CLI's extra :test compile and catch-all
  // PATCH -> POST fallback that masks transient release failures as HTTP 409 (#5590).
  const ruleset = await rulesApiRequest(`${projectName}/rulesets`, token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source: { files: [{ name: 'firestore.rules', content }] } }),
  });
  if (typeof ruleset.name !== 'string' || !ruleset.name.startsWith(`${projectName}/rulesets/`)) {
    throw new Error('Firebase Rules API did not return a ruleset in the requested project.');
  }
  const releaseName = `${projectName}/releases/cloud.firestore`;
  // This guarded procedure backs up an existing release before deploying; no create fallback.
  try {
    return await rulesApiRequest(releaseName, token, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ release: { name: releaseName, rulesetName: ruleset.name }, updateMask: 'rulesetName' }),
    });
  } catch (error) {
    if (![429, 500, 502, 503, 504].includes(error.status)
      && !['TypeError', 'TimeoutError', 'AbortError'].includes(error.name)) throw error;
    // A failed response can follow a successful write; prove activation before failing.
    let release;
    try {
      release = await rulesApiRequest(releaseName, token);
    } catch {
      throw error;
    }
    if (release.rulesetName === ruleset.name) return release;
    throw error;
  }
}

function run(command, args) {
  execFileSync(command, args, {
    cwd: appDirectory,
    shell: process.platform === 'win32',
    stdio: 'inherit',
  });
}

async function main() {
  await buildRules({ check: true });
  const args = process.argv.slice(2);
  const project = projectFromArgs(args);
  if (!args.includes('--confirm')) {
    throw new Error(
      'Refusing to change production rules without --confirm. First run "npm run test:rules" and "npm run firestore:rules:drift".',
    );
  }

  const before = await inspectDeployedFirestoreRules(project);
  const backupDirectory = path.join(appDirectory, 'artifacts', 'firestore-rules-rollbacks');
  await mkdir(backupDirectory, { recursive: true });
  const backupPath = path.join(backupDirectory, `${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  await writeFile(
    backupPath,
    `${JSON.stringify({ project, ...before }, null, 2)}\n`,
    'utf8',
  );
  console.log(`Saved rollback metadata to ${backupPath}`);

  console.log('Running the mandatory local emulator suite.');
  run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'test:rules']);

  console.log('Pre-deployment deployed-rules identity:');
  const comparison = await compareLocalFirestoreRules(project);
  printComparison(comparison);

  if (comparison.matches) {
    console.log('Rules already match; skipping ruleset creation and activation.');
  } else {
    console.log('Deploying only Cloud Firestore Security Rules.');
    await deployFirestoreRules(project, await readFile(path.join(appDirectory, 'firestore.rules'), 'utf8'));
  }

  console.log('Post-deployment deployed-rules identity:');
  const after = await compareLocalFirestoreRules(project);
  printComparison(after);
  if (!after.matches) {
    throw new Error(`Deployment completed but the deployed rules do not match. Roll back with ${backupPath}.`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
