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
  run(
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
