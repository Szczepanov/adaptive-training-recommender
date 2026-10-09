import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  appDirectory,
  compareLocalFirestoreRules,
  inspectDeployedFirestoreRules,
  printComparison,
  projectFromArgs,
} from './check-firestore-rules-drift.mjs';
import { buildRules } from './build-firestore-rules.mjs';
import { minifyRules } from './minify-firestore-rules.mjs';

export async function withMinifiedRulesConfig(deploy, directory = appDirectory) {
  const temporaryDirectory = await mkdtemp(path.join(directory, '.firestore-rules-deploy-'));
  // Firebase resolves every relative reference from the config's directory.
  const configPath = `${temporaryDirectory}.json`;
  try {
    const config = JSON.parse(await readFile(path.join(directory, 'firebase.json'), 'utf8'));
    if (!config.firestore || Array.isArray(config.firestore) || config.firestore.rules !== 'firestore.rules') {
      throw new Error('Expected firebase.json firestore.rules to reference the generated firestore.rules.');
    }
    const rulesPath = path.join(temporaryDirectory, 'firestore.rules');
    const source = await readFile(path.join(directory, 'firestore.rules'), 'utf8');
    await writeFile(rulesPath, minifyRules(source), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    config.firestore.rules = path.relative(directory, rulesPath).split(path.sep).join('/');
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    return await deploy(configPath);
  } finally {
    await Promise.all([
      rm(configPath, { force: true }),
      rm(temporaryDirectory, { recursive: true, force: true }),
    ]);
  }
}

function run(command, args) {
  execFileSync(command, args, {
    cwd: appDirectory,
    shell: process.platform === 'win32',
    stdio: 'inherit',
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// firebase-tools' release update falls back to a plain "create" call on ANY error from its
// initial update attempt (see updateOrCreateRelease in firebase-tools/lib/gcp/rules.js) --
// including a transient timeout or 5xx from the Firebase Rules API, not just "release does
// not exist yet". Past the very first deploy the release always already exists, so that
// fallback then fails with "409: Requested entity already exists", surfacing a transient
// backend hiccup as a hard error. This is a known firebase-tools limitation that gets more
// likely to bite the larger firestore.rules gets
// (https://github.com/firebase/firebase-tools/issues/5590,
// https://github.com/firebase/firebase-tools/issues/2127). Retrying is safe: `firebase
// deploy --only firestore:rules` is idempotent, and the post-deploy hash check in main()
// still fails the run if every attempt leaves the deployed rules not matching this repo.
const RULES_DEPLOY_ATTEMPTS = 3;
const RULES_DEPLOY_RETRY_DELAY_MS = 15_000;

async function deployRulesWithRetry(command, args) {
  for (let attempt = 1; attempt <= RULES_DEPLOY_ATTEMPTS; attempt += 1) {
    try {
      run(command, args);
      return;
    } catch (err) {
      if (attempt === RULES_DEPLOY_ATTEMPTS) {
        throw err;
      }
      console.warn(
        `firebase deploy --only firestore:rules failed on attempt ${attempt}/${RULES_DEPLOY_ATTEMPTS}; ` +
          `retrying in ${RULES_DEPLOY_RETRY_DELAY_MS / 1000}s (see the comment above ` +
          'deployRulesWithRetry for why this is often transient).',
      );
      console.warn(err instanceof Error ? err.message : err);
      await sleep(RULES_DEPLOY_RETRY_DELAY_MS);
    }
  }
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
  printComparison(await compareLocalFirestoreRules(project));

  console.log('Deploying only Cloud Firestore Security Rules.');
  await withMinifiedRulesConfig((configPath) => deployRulesWithRetry(
    process.platform === 'win32' ? 'firebase.cmd' : 'firebase',
    ['deploy', '--only', 'firestore:rules', '--project', project, '--non-interactive', '--config', path.basename(configPath)],
  ));

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
