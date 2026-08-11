import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { projectFromArgs } from './check-firestore-rules-drift.mjs';

function optionValue(args, option) {
  const index = args.indexOf(option);
  return index === -1 ? undefined : args[index + 1];
}

function accessToken() {
  const gcloud = process.platform === 'win32' ? 'gcloud.cmd' : 'gcloud';
  try {
    return execFileSync(
      gcloud,
      ['auth', 'application-default', 'print-access-token'],
      {
        encoding: 'utf8',
        shell: process.platform === 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    ).trim();
  } catch {
    throw new Error('Application Default Credentials are required. Run "gcloud auth application-default login" locally, then retry.');
  }
}

async function main() {
  const args = process.argv.slice(2);
  const project = projectFromArgs(args);
  const backupPath = optionValue(args, '--backup');
  if (!args.includes('--confirm') || !backupPath) {
    throw new Error('Usage: npm run firestore:rules:rollback -- --backup <rollback.json> --confirm');
  }

  const backup = JSON.parse(await readFile(backupPath, 'utf8'));
  if (backup.project !== project || !backup.releaseName || !backup.rulesetName) {
    throw new Error('Rollback metadata does not identify the requested project, release, and ruleset.');
  }

  const response = await fetch(`https://firebaserules.googleapis.com/v1/${backup.releaseName}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${accessToken()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      release: {
        name: backup.releaseName,
        rulesetName: backup.rulesetName,
      },
      updateMask: 'rulesetName',
    }),
  });
  if (!response.ok) {
    throw new Error(`Firebase Rules API ${response.status}: ${await response.text()}`);
  }

  console.log(`Restored ${backup.releaseName} to ${backup.rulesetName}.`);
  console.log('Verify with: npm run firestore:rules:drift');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
