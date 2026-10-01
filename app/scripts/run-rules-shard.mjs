// Runs one shard of the Firestore security-rule emulator suite on leased emulator ports,
// so several shards -- and the browser E2E suite -- can run side by side on one machine
// without port collisions or orphaned emulators.
//
// Usage: node scripts/run-rules-shard.mjs <index>/<total>
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildHarnessFirebaseConfig, runWithEmulators } from './harness/runWithEmulators.mjs';

export function parseShard(arg) {
  const match = /^(\d+)\/(\d+)$/.exec(arg ?? '');
  const index = match ? Number(match[1]) : NaN;
  const total = match ? Number(match[2]) : NaN;
  if (!(index >= 1 && index <= total && Number.isInteger(total))) {
    throw new Error(`Expected <index>/<total> with 1 <= index <= total, got "${arg}"`);
  }
  return { index, total };
}

export function shardEmulatorConfig(leaseOrBase) {
  const lease = typeof leaseOrBase === 'object' && Array.isArray(leaseOrBase?.ports)
    ? leaseOrBase
    : {
        ports: [
          (typeof leaseOrBase === 'number' ? leaseOrBase : 20000),
          (typeof leaseOrBase === 'number' ? leaseOrBase : 20000) + 1,
          (typeof leaseOrBase === 'number' ? leaseOrBase : 20000) + 2,
          (typeof leaseOrBase === 'number' ? leaseOrBase : 20000) + 3,
        ],
      };

  return buildHarnessFirebaseConfig({
    lease,
    only: 'firestore',
    singleProjectMode: false,
  });
}

export async function runShard({ index, total }) {
  return runWithEmulators({
    suite: `rules-${index}`,
    only: 'firestore',
    singleProjectMode: false,
    command: ['npm', 'run', 'test:rules:emulator', '--', `--shard=${index}/${total}`],
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const code = await runShard(parseShard(process.argv[2]));
  process.exitCode = code;
}
