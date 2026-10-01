import { spawn } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { acquirePortBlock, isPidAlive, serializeLease } from './portLease.mjs';
import { APP_DIR, ROOT_DIR, buildHarnessFirebaseConfig, harnessConfigPath } from './runWithEmulators.mjs';

const HARNESS_DIR = dirname(fileURLToPath(import.meta.url));
const PREVIEW_FILE = resolve(APP_DIR, '.preview.json');

async function waitForUrl(url, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return true;
    } catch {
      // Waiting
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function main() {
  if (existsSync(PREVIEW_FILE)) {
    try {
      const existing = JSON.parse(readFileSync(PREVIEW_FILE, 'utf8'));
      if (isPidAlive(existing.pid)) {
        console.log('Preview is already running:');
        console.log(`  App URL:        ${existing.urls.app}`);
        console.log(`  Auth Emulator:  ${existing.urls.auth}`);
        console.log(`  Firestore:      ${existing.urls.firestore}`);
        console.log(`  Project ID:     ${existing.projectId}`);
        console.log(`  PID:            ${existing.pid}`);
        console.log('\nRun "npm run preview:stop" to stop it.');
        return;
      }
    } catch {
      // Corrupt file
    }
    rmSync(PREVIEW_FILE, { force: true });
  }

  console.log('Acquiring leased ports for local app preview...');
  const lease = await acquirePortBlock({
    suite: 'preview',
    size: 8,
    worktree: ROOT_DIR,
  });

  const firestorePort = lease.ports[0];
  const authPort = lease.ports[4];
  const appPort = lease.ports[5];
  const projectId = `demo-atr-preview-${lease.blockBase}`;

  const config = buildHarnessFirebaseConfig({
    lease,
    only: 'auth,firestore',
    singleProjectMode: false,
  });
  const configPath = harnessConfigPath(ROOT_DIR, lease.blockBase);
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);

  console.log(`Starting preview supervisor (ports: App=${appPort}, Auth=${authPort}, Firestore=${firestorePort})...`);
  const supervisor = spawn(
    process.execPath,
    [
      resolve(HARNESS_DIR, 'previewSupervisor.mjs'),
      lease.leaseFile,
      configPath,
      PREVIEW_FILE,
    ],
    {
      cwd: APP_DIR,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    },
  );
  supervisor.unref();

  // Update lease with supervisor PID
  lease.pid = supervisor.pid;
  writeFileSync(lease.leaseFile, `${serializeLease(lease)}\n`);

  const previewInfo = {
    pid: supervisor.pid,
    worktree: ROOT_DIR,
    blockBase: lease.blockBase,
    projectId,
    leaseFile: lease.leaseFile,
    configPath,
    ports: {
      auth: authPort,
      firestore: firestorePort,
      app: appPort,
      hub: lease.ports[2],
      logging: lease.ports[3],
    },
    urls: {
      app: `http://127.0.0.1:${appPort}`,
      auth: `http://127.0.0.1:${authPort}`,
      firestore: `http://127.0.0.1:${firestorePort}`,
    },
    startedAt: new Date().toISOString(),
  };

  writeFileSync(PREVIEW_FILE, `${JSON.stringify(previewInfo, null, 2)}\n`);

  console.log('Waiting for emulators and Vite to be ready...');
  const [authReady, appReady] = await Promise.all([
    waitForUrl(previewInfo.urls.auth),
    waitForUrl(previewInfo.urls.app),
  ]);

  if (!authReady || !appReady) {
    console.warn('Warning: Server did not respond within timeout, but supervisor is running.');
  } else {
    console.log('All services ready!\n');
  }

  console.log('=== Local App Preview Running ===');
  console.log(`  App URL:        ${previewInfo.urls.app}`);
  console.log(`  Auth Emulator:  ${previewInfo.urls.auth}`);
  console.log(`  Firestore:      ${previewInfo.urls.firestore}`);
  console.log(`  Project ID:     ${previewInfo.projectId}`);
  console.log(`  PID:            ${previewInfo.pid}`);
  console.log('\nState recorded in app/.preview.json');
  console.log('Run "npm run preview:stop" to shut down.');
}

await main();
