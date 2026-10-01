// Runs one shard of the Firestore security-rule emulator suite on emulator ports of its own,
// so several shards -- and the browser E2E suite on firebase.json's default ports -- can run
// side by side on one machine. CI isolates its shards on separate runners instead; this is
// the local equivalent that `make verify` uses.
//
// Usage: node scripts/run-rules-shard.mjs <index>/<total>
import { spawnSync } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Offsets from firebase.json's defaults (firestore 8080, websocket 9150, hub 4400,
// logging 4500) that stay clear of them and of each other for any realistic shard count.
const BASE_PORTS = { firestore: 8180, websocket: 9160, hub: 4410, logging: 4510 };
const MAX_SHARDS = 9;

export function parseShard(arg) {
  const match = /^(\d+)\/(\d+)$/.exec(arg ?? '');
  const index = match ? Number(match[1]) : NaN;
  const total = match ? Number(match[2]) : NaN;
  if (!(index >= 1 && index <= total && total <= MAX_SHARDS)) {
    throw new Error(`Expected <index>/<total> with 1 <= index <= total <= ${MAX_SHARDS}, got "${arg}"`);
  }
  return { index, total };
}

export function shardEmulatorConfig(index) {
  return {
    firestore: { rules: 'firestore.rules' },
    emulators: {
      singleProjectMode: false,
      firestore: { port: BASE_PORTS.firestore + index, websocketPort: BASE_PORTS.websocket + index },
      hub: { port: BASE_PORTS.hub + index },
      logging: { port: BASE_PORTS.logging + index },
      ui: { enabled: false },
    },
  };
}

function runShard({ index, total }) {
  // firebase-tools resolves the rules file relative to the config file and refuses paths
  // outside that directory, so the generated config has to live in app/ itself.
  const configPath = resolve(APP_DIR, `.rules-shard-${index}.firebase.json`);
  const firebaseCli = createRequire(import.meta.url).resolve('firebase-tools/lib/bin/firebase.js');
  writeFileSync(configPath, `${JSON.stringify(shardEmulatorConfig(index), null, 2)}\n`);
  try {
    const completed = spawnSync(
      process.execPath,
      [
        firebaseCli,
        // A distinct project per shard keeps the emulator hubs' locator files apart.
        '--project', `demo-adaptive-training-rules-${index}`,
        '--config', configPath,
        'emulators:exec', '--only', 'firestore',
        `npm run test:rules:emulator -- --shard=${index}/${total}`,
      ],
      { cwd: APP_DIR, stdio: 'inherit' },
    );
    if (completed.error) throw completed.error;
    return completed.status ?? 1;
  } finally {
    rmSync(configPath, { force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = runShard(parseShard(process.argv[2]));
}
