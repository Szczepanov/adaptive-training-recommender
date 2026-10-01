import { spawn, spawnSync } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { acquirePortBlock, isPidAlive, releasePortBlock } from './portLease.mjs';

const HARNESS_DIR = dirname(fileURLToPath(import.meta.url));
export const APP_DIR = resolve(HARNESS_DIR, '..', '..');
export const ROOT_DIR = resolve(APP_DIR, '..');

export function killProcessTree(pid) {
  if (!pid || !isPidAlive(pid)) return;
  if (process.platform === 'win32') {
    try {
      spawnSync('taskkill', ['/T', '/F', '/PID', String(pid)], { stdio: 'ignore' });
    } catch {
      // Ignore
    }
  } else {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // Ignore
      }
    }
  }
}

export function buildHarnessFirebaseConfig({
  lease,
  only = 'firestore',
  singleProjectMode = false,
}) {
  const onlyList = only.split(',').map((s) => s.trim().toLowerCase());
  const emulators = {
    ui: { enabled: false },
    hub: { port: lease.ports[2] },
    logging: { port: lease.ports[3] },
  };

  if (onlyList.includes('firestore')) {
    emulators.firestore = {
      port: lease.ports[0],
      websocketPort: lease.ports[1],
    };
  }

  if (onlyList.includes('auth')) {
    emulators.auth = {
      port: lease.ports[4],
    };
  }

  if (!singleProjectMode) {
    emulators.singleProjectMode = false;
  }

  const config = { emulators };
  if (onlyList.includes('firestore')) {
    config.firestore = { rules: 'firestore.rules' };
  }
  return config;
}

export function buildHarnessEnv({
  lease,
  projectId,
  extraEnv = {},
}) {
  const firestorePort = lease.ports[0];
  const authPort = lease.ports[4];
  const appPort = lease.ports[5];

  return {
    ...process.env,
    ...extraEnv,
    FIRESTORE_EMULATOR_HOST: `127.0.0.1:${firestorePort}`,
    FIREBASE_AUTH_EMULATOR_HOST: `127.0.0.1:${authPort}`,
    E2E_FIRESTORE_PORT: String(firestorePort),
    E2E_AUTH_PORT: String(authPort),
    E2E_APP_PORT: String(appPort),
    E2E_PROJECT_ID: projectId,
    VITE_FIREBASE_FIRESTORE_EMULATOR_PORT: String(firestorePort),
    VITE_FIREBASE_AUTH_EMULATOR_PORT: String(authPort),
    VITE_FIREBASE_PROJECT_ID: projectId,
    VITE_FIREBASE_EMULATOR_HOST: '127.0.0.1',
    VITE_USE_FIREBASE_EMULATORS: 'true',
    VITE_FIREBASE_AUTH_DOMAIN: '127.0.0.1',
    VITE_FIREBASE_STORAGE_BUCKET: `${projectId}.appspot.com`,
  };
}

export function parseCliArgs(argv) {
  const args = [...argv];
  let suite = 'harness';
  let only = 'firestore';
  let project = null;
  let singleProjectMode = false;
  const commandArgs = [];

  const doubleDashIdx = args.indexOf('--');
  let optionArgs = args;
  if (doubleDashIdx !== -1) {
    optionArgs = args.slice(0, doubleDashIdx);
    commandArgs.push(...args.slice(doubleDashIdx + 1));
  }

  for (let i = 0; i < optionArgs.length; i += 1) {
    const arg = optionArgs[i];
    if (arg === '--suite' && i + 1 < optionArgs.length) {
      suite = optionArgs[++i];
    } else if (arg === '--only' && i + 1 < optionArgs.length) {
      only = optionArgs[++i];
    } else if (arg === '--project' && i + 1 < optionArgs.length) {
      project = optionArgs[++i];
    } else if (arg === '--single-project-mode') {
      singleProjectMode = true;
    }
  }

  return {
    suite,
    only,
    project,
    singleProjectMode,
    command: commandArgs,
  };
}

export async function runWithEmulators({
  suite = 'harness',
  only = 'firestore',
  command = [],
  project = null,
  singleProjectMode = false,
  cwd = APP_DIR,
  stdio = 'inherit',
  extraEnv = {},
} = {}) {
  const lease = await acquirePortBlock({
    suite,
    size: 8,
    worktree: ROOT_DIR,
  });

  const sanitizedSuite = suite.replace(/[^a-zA-Z0-9-]/g, '-');
  const projectId = project || `demo-atr-${sanitizedSuite}-${lease.blockBase}`;
  const config = buildHarnessFirebaseConfig({ lease, only, singleProjectMode });
  const configPath = resolve(APP_DIR, `.harness-${lease.blockBase}.firebase.json`);
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);

  const injectedEnv = buildHarnessEnv({ lease, projectId, extraEnv });
  const firebaseCli = createRequire(import.meta.url).resolve('firebase-tools/lib/bin/firebase.js');

  const commandStr = Array.isArray(command) ? command.join(' ') : String(command);
  const args = [
    firebaseCli,
    '--project', projectId,
    '--config', configPath,
    'emulators:exec',
    '--only', only,
    commandStr,
  ];

  let childProc = null;
  const cleanup = () => {
    if (childProc && childProc.pid) {
      killProcessTree(childProc.pid);
    }
    try {
      rmSync(configPath, { force: true });
    } catch {
      // Ignore
    }
    releasePortBlock(lease);
  };

  const handleSignal = () => {
    cleanup();
    process.exit(130);
  };
  process.on('SIGINT', handleSignal);
  process.on('SIGTERM', handleSignal);

  try {
    const exitCode = await new Promise((res, rej) => {
      childProc = spawn(process.execPath, args, {
        cwd,
        stdio,
        env: injectedEnv,
      });
      childProc.on('error', rej);
      childProc.on('close', (code, signal) => {
        res(code ?? (signal ? 1 : 0));
      });
    });
    return exitCode;
  } finally {
    process.off('SIGINT', handleSignal);
    process.off('SIGTERM', handleSignal);
    cleanup();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const parsed = parseCliArgs(process.argv.slice(2));
  if (parsed.command.length === 0) {
    console.error('Usage: node runWithEmulators.mjs [--suite <name>] [--only <emulators>] -- <command...>');
    process.exit(1);
  }
  const code = await runWithEmulators(parsed);
  process.exit(code);
}
