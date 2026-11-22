import { existsSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import { resolve } from 'node:path';
import { deserializeLease, getDefaultLeaseDir, isPidAlive, withBlockLock } from './portLease.mjs';
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

  // The ownership check, the kills, the listener sweep and the lease deletion all run under one
  // hold of the block lock. Otherwise a concurrent `preview:stop` could pass its check while this
  // one tears down, and after this one frees the block a new run could bind the same ports and
  // have its listeners killed by the second stop's sweep.
  let outcome = null;
  for (let attempt = 0; attempt < 50 && outcome === null; attempt += 1) {
    outcome = withBlockLock(leaseFile, () => stopOwnedPreview(preview, leaseFile));
    // Another process holds the block lock briefly; wait and retry.
    if (outcome === null) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
  }

  if (outcome === null) {
    console.error(
      'Could not take the port-block lock; another harness operation holds it. Nothing was ' +
        'stopped; retry "npm run preview:stop".',
    );
    process.exitCode = 1;
    return;
  }

  rmSync(PREVIEW_FILE, { force: true });
  if (outcome === 'not-owned') {
    console.log(
      'The preview is no longer running. Removed app/.preview.json without touching any process; ' +
        'run "npm run harness:status" / "npm run harness:reap" to clean up anything it left behind.',
    );
    return;
  }
  console.log('Preview stopped and resources released successfully.');
}

// Runs with the block lock held. Re-reads the lease inside the lock so the ownership decision and
// every kill it authorises see the same lease, and deletes the lease directly rather than through
// `releasePortBlock`, which would try to take the lock again.
function stopOwnedPreview(preview, leaseFile) {
  const lease = readLease(leaseFile);
  if (!previewOwnsBlock(preview, lease)) return 'not-owned';

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
  rmSync(leaseFile, { force: true });
  return 'stopped';
}

await main();
