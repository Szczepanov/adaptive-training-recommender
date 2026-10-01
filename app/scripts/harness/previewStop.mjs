import { existsSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { releasePortBlock } from './portLease.mjs';
import { getListeningPidsForPorts } from './harnessAdmin.mjs';
import { APP_DIR, killProcessTree } from './runWithEmulators.mjs';

const PREVIEW_FILE = resolve(APP_DIR, '.preview.json');

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

  console.log(`Stopping preview (PID: ${preview.pid})...`);
  if (preview.pid) {
    killProcessTree(preview.pid);
  }

  // Also reap any processes still listening on preview ports
  if (preview.ports) {
    const ports = Object.values(preview.ports);
    const listeningPids = getListeningPidsForPorts(ports);
    for (const pid of listeningPids) {
      killProcessTree(pid);
    }
  }

  if (preview.configPath) {
    rmSync(preview.configPath, { force: true });
  }

  if (preview.leaseFile || preview.blockBase) {
    releasePortBlock({
      blockBase: preview.blockBase,
      leaseFile: preview.leaseFile,
      released: false,
    });
  }

  rmSync(PREVIEW_FILE, { force: true });
  console.log('Preview stopped and resources released successfully.');
}

await main();
