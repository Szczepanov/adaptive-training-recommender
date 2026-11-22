import { existsSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import { resolve } from 'node:path';
import { deserializeLease, getDefaultLeaseDir, isPidAlive, releasePortBlock } from './portLease.mjs';
import { getListeningPidsForPorts } from './harnessAdmin.mjs';
import { APP_DIR, killProcessTree } from './runWithEmulators.mjs';

const PREVIEW_FILE = resolve(APP_DIR, '.preview.json');

function readLease(leaseFile) {
  try {
    return deserializeLease(readFileSync(leaseFile, 'utf8'));
  } catch {
    return null;
  }
}

// `.preview.json` can outlive its preview (reboot, hard kill), and by then the block may belong to
// another worktree's run. Only a lease that still names this preview's supervisor, with that
// supervisor alive, proves the processes on these ports are ours to kill.
function previewOwnsBlock(preview, lease) {
  return lease !== null && lease.pid === preview.pid && isPidAlive(preview.pid);
}

async function main() {
  if (!existsSync(PREVIEW_FILE)) {
    console.log('No preview state found (app/.preview.json does not exist).');
    return;
  }

  let preview;
  try {
    preview = JSON.parse(readFileSync(PREVIEW_FILE, 'utf8'));
  } catch (err) {
    console.error('Failed to parse app/.preview.json:', err);
    rmSync(PREVIEW_FILE, { force: true });
    return;
  }

  const leaseFile = preview.leaseFile ?? resolve(getDefaultLeaseDir(), `${preview.blockBase}.json`);
  const lease = readLease(leaseFile);

  if (!previewOwnsBlock(preview, lease)) {
    rmSync(PREVIEW_FILE, { force: true });
    console.log(
      'The preview is no longer running. Removed app/.preview.json without touching any process; ' +
        'run "npm run harness:status" / "npm run harness:reap" to clean up anything it left behind.',
    );
    return;
  }

  console.log(`Stopping preview (PID: ${preview.pid})...`);
  killProcessTree(preview.pid);

  // The live lease is ours, so whatever still listens on its ports is this preview's.
  for (const pid of getListeningPidsForPorts(lease.ports)) {
    killProcessTree(pid);
  }

  // The emulators were hard-killed, so firebase-tools never removed its hub locator.
  if (typeof preview.projectId === 'string') {
    rmSync(resolve(os.tmpdir(), `hub-${preview.projectId}.json`), { force: true });
  }
  if (preview.configPath) {
    rmSync(preview.configPath, { force: true });
  }
  releasePortBlock({ ...lease, leaseFile, released: false });

  rmSync(PREVIEW_FILE, { force: true });
  console.log('Preview stopped and resources released successfully.');
}

await main();
