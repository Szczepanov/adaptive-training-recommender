import { spawn } from 'node:child_process';
import { readFileSync, rmSync, appendFileSync, mkdirSync, openSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { deserializeLease, releasePortBlock } from './portLease.mjs';
import { APP_DIR, buildHarnessEnv, killProcessTree } from './runWithEmulators.mjs';

const [, , leaseFile, configPath, previewFilePath] = process.argv;

if (!leaseFile || !configPath) {
  process.exit(1);
}

const logDir = resolve(APP_DIR, 'artifacts');
mkdirSync(logDir, { recursive: true });
const logFile = resolve(logDir, 'preview-supervisor.log');
const emuLogFile = resolve(logDir, 'preview-emulators.log');
const viteLogFile = resolve(logDir, 'preview-vite.log');

function log(msg) {
  try {
    appendFileSync(logFile, `[${new Date().toISOString()}] ${msg}\n`);
  } catch {
    // Ignore
  }
}

process.on('uncaughtException', (err) => {
  log(`uncaughtException: ${err}\n${err?.stack}`);
});
process.on('unhandledRejection', (err) => {
  log(`unhandledRejection: ${err}`);
});

let lease;
try {
  lease = deserializeLease(readFileSync(leaseFile, 'utf8'));
} catch (err) {
  log(`Failed to load lease: ${err}`);
  process.exit(1);
}

const firestorePort = lease.ports[0];
const authPort = lease.ports[4];
const appPort = lease.ports[5];
const projectId = `demo-atr-preview-${lease.blockBase}`;

const firebaseCli = createRequire(import.meta.url).resolve('firebase-tools/lib/bin/firebase.js');
const injectedEnv = buildHarnessEnv({ lease, projectId });

let emulatorsProc = null;
let viteProc = null;
let cleanedUp = false;

function cleanup() {
  if (cleanedUp) return;
  cleanedUp = true;
  log('Supervisor cleaning up processes...');
  if (viteProc && viteProc.pid) killProcessTree(viteProc.pid);
  if (emulatorsProc && emulatorsProc.pid) killProcessTree(emulatorsProc.pid);
  try { rmSync(configPath, { force: true }); } catch {}
  try { rmSync(previewFilePath, { force: true }); } catch {}
  releasePortBlock(lease);
}

process.on('SIGINT', () => { log('SIGINT received'); cleanup(); process.exit(0); });
process.on('SIGTERM', () => { log('SIGTERM received'); cleanup(); process.exit(0); });

try {
  log(`Spawning emulators:start for ${projectId} on port ${firestorePort}...`);
  const emuFd = openSync(emuLogFile, 'a');
  emulatorsProc = spawn(
    process.execPath,
    [
      firebaseCli,
      '--project', projectId,
      '--config', configPath,
      'emulators:start',
      '--only', 'auth,firestore',
    ],
    {
      cwd: APP_DIR,
      stdio: ['ignore', emuFd, emuFd],
      env: injectedEnv,
    },
  );

  log(`Spawning vite on port ${appPort}...`);
  const viteFd = openSync(viteLogFile, 'a');
  viteProc = spawn(
    'npx',
    [
      'vite',
      '--mode', 'e2e',
      '--host', '127.0.0.1',
      '--port', String(appPort),
      '--strictPort',
    ],
    {
      cwd: APP_DIR,
      shell: true,
      stdio: ['ignore', viteFd, viteFd],
      env: injectedEnv,
    },
  );

  emulatorsProc.on('exit', (code) => {
    log(`emulatorsProc exited with code ${code}`);
    cleanup();
    process.exit(code ?? 0);
  });

  viteProc.on('exit', (code) => {
    log(`viteProc exited with code ${code}`);
    cleanup();
    process.exit(code ?? 0);
  });

  // Keep supervisor event loop active
  const timer = setInterval(() => {
    log('heartbeat: supervisor alive');
  }, 10000);
  timer.unref(); // wait, unref would allow exit if nothing else is pending! Keep ref!
  timer.ref();
} catch (err) {
  log(`Spawn error: ${err}`);
  cleanup();
  process.exit(1);
}
