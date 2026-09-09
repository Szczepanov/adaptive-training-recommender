import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  appDirectory,
  compareLocalFirestoreRules,
  inspectDeployedFirestoreRules,
  printComparison,
  projectFromArgs,
} from './check-firestore-rules-drift.mjs';

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
  await deployRulesWithRetry(
    process.platform === 'win32' ? 'firebase.cmd' : 'firebase',
    ['deploy', '--only', 'firestore:rules', '--project', project, '--non-interactive'],
  );

  console.log('Post-deployment deployed-rules identity:');
  const after = await compareLocalFirestoreRules(project);
  printComparison(after);
  if (!after.matches) {
    throw new Error(`Deployment completed but the deployed rules do not match. Roll back with ${backupPath}.`);
  }
}

await main();
