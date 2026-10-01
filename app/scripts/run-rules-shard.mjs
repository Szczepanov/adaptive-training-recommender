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

const SHARD_EMULATORS = 'firestore';
// Rules suites open several project ids on one emulator (recommendationAuditBudget probes).
const SHARD_SINGLE_PROJECT_MODE = false;

export function shardEmulatorConfig(lease) {
  return buildHarnessFirebaseConfig({
    lease,
    only: SHARD_EMULATORS,
    singleProjectMode: SHARD_SINGLE_PROJECT_MODE,
  });
}

export async function runShard({ index, total }) {
  return runWithEmulators({
    suite: `rules-${index}`,
    only: SHARD_EMULATORS,
    singleProjectMode: SHARD_SINGLE_PROJECT_MODE,
    command: ['npm', 'run', 'test:rules:emulator', '--', `--shard=${index}/${total}`],
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const code = await runShard(parseShard(process.argv[2]));
  process.exitCode = code;
}
