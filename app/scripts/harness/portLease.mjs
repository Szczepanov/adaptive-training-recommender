import { randomUUID } from 'node:crypto';
import {
  existsSync,
  linkSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import { resolve } from 'node:path';

export const DEFAULT_MIN_PORT = 20000;
export const DEFAULT_MAX_PORT = 39999;
export const DEFAULT_STEP = 10;
export const DEFAULT_BLOCK_SIZE = 8;

export function getDefaultLeaseDir() {
  return resolve(os.tmpdir(), 'atr-harness', 'leases');
}

export function* candidateBlockBases({
  minPort = DEFAULT_MIN_PORT,
  maxPort = DEFAULT_MAX_PORT,
  step = DEFAULT_STEP,
} = {}) {
  for (let port = minPort; port <= maxPort; port += step) {
    yield port;
  }
}

export function portsForBlock(blockBase, size = DEFAULT_BLOCK_SIZE) {
  if (!Number.isInteger(blockBase) || blockBase <= 0) {
    throw new Error(`Invalid blockBase: ${blockBase}`);
  }
  if (!Number.isInteger(size) || size <= 0) {
    throw new Error(`Invalid block size: ${size}`);
  }
  const ports = [];
  for (let i = 0; i < size; i += 1) {
    ports.push(blockBase + i);
  }
  return ports;
}

export function serializeLease(lease) {
  return JSON.stringify(
    {
      pid: lease.pid,
      worktree: lease.worktree,
      suite: lease.suite,
      blockBase: lease.blockBase,
      ports: lease.ports,
      startedAt: lease.startedAt ?? new Date().toISOString(),
    },
    null,
    2,
  );
}

export function deserializeLease(content) {
  const parsed = JSON.parse(content);
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof parsed.pid !== 'number' ||
    typeof parsed.blockBase !== 'number' ||
    !Array.isArray(parsed.ports)
  ) {
    throw new Error('Invalid lease content');
  }
  return parsed;
}

export function isPidAlive(pid) {
  if (typeof pid !== 'number' || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err?.code === 'EPERM';
  }
}

export function isStale(lease, { isPidAliveFn = isPidAlive } = {}) {
  if (!lease || typeof lease.pid !== 'number') return true;
  return !isPidAliveFn(lease.pid);
}

let _ipv6Supported = null;
export async function isIpv6Supported() {
  if (_ipv6Supported !== null) return _ipv6Supported;
  return new Promise((res) => {
    const s = net.createServer();
    s.unref();
    s.on('error', (err) => {
      _ipv6Supported = !(err.code === 'EADDRNOTAVAIL' || err.code === 'EAFNOSUPPORT');
      res(_ipv6Supported);
    });
    s.listen({ port: 0, host: '::1', exclusive: true }, () => {
      s.close(() => {
        _ipv6Supported = true;
        res(true);
      });
    });
  });
}

export async function canBindPort(port, host) {
  return new Promise((res) => {
    const s = net.createServer();
    s.unref();
    s.on('error', () => {
      res(false);
    });
    s.listen({ port, host, exclusive: true }, () => {
      s.close(() => {
        res(true);
      });
    });
  });
}

export async function probeBlockPorts(ports, { checkIpv6 = null } = {}) {
  const hasIpv6 = checkIpv6 ?? (await isIpv6Supported());
  for (const port of ports) {
    const v4Ok = await canBindPort(port, '127.0.0.1');
    if (!v4Ok) return false;
    if (hasIpv6) {
      const v6Ok = await canBindPort(port, '::1');
      if (!v6Ok) return false;
    }
  }
  return true;
}

// A lease file that cannot be parsed is reclaimable only once it is this old, so a reader never
// mistakes another acquirer's half-written lease (e.g. `previewStart` rewriting its pid) for an
// orphan.
export const UNPARSEABLE_LEASE_GRACE_MS = 10_000;
// A reclaim lock outliving this was left by a crashed reclaimer; reclaiming takes milliseconds.
export const RECLAIM_LOCK_STALE_MS = 30_000;

function fileAgeMs(path) {
  try {
    return Date.now() - statSync(path).mtimeMs;
  } catch {
    return 0;
  }
}

// Publishes `content` at `path` only if nothing is there, in one step: write a private temp file,
// then hard-link it into place (link fails with EEXIST when the path exists). Readers therefore
// never observe an empty or partial lease. Returns false when the path is already taken.
function createFileExclusive(path, content) {
  const tmp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(tmp, content, { flag: 'wx' });
  try {
    linkSync(tmp, path);
    return true;
  } catch (err) {
    if (err.code === 'EEXIST') return false;
    throw err;
  } finally {
    rmSync(tmp, { force: true });
  }
}

function isReclaimable(leaseFile, isPidAliveFn) {
  let content;
  try {
    content = readFileSync(leaseFile, 'utf8');
  } catch (err) {
    // Released between our failed create and this read: the block is free to retry.
    return err.code === 'ENOENT';
  }
  try {
    return isStale(deserializeLease(content), { isPidAliveFn });
  } catch {
    return fileAgeMs(leaseFile) > UNPARSEABLE_LEASE_GRACE_MS;
  }
}

// Replaces a stale lease with ours. Unlink-then-create is two steps, so without the lock two
// acquirers that both saw the same dead lease could each delete the other's fresh one and both
// believe they own the block. Under the lock the staleness check is repeated, so a block that
// another acquirer has just reclaimed is left alone.
function tryReclaimLease(leaseFile, content, isPidAliveFn) {
  const lockFile = `${leaseFile}.reclaim`;
  // Publish locks atomically too; opening a contended, deleting file can return EPERM on Windows.
  if (!createFileExclusive(lockFile, String(process.pid))) {
    if (fileAgeMs(lockFile) > RECLAIM_LOCK_STALE_MS) rmSync(lockFile, { force: true });
    return false;
  }
  try {
    if (!isReclaimable(leaseFile, isPidAliveFn)) return false;
    rmSync(leaseFile, { force: true });
    return createFileExclusive(leaseFile, content);
  } finally {
    rmSync(lockFile, { force: true });
  }
}

export async function acquirePortBlock({
  suite = 'unknown',
  size = DEFAULT_BLOCK_SIZE,
  leaseDir = getDefaultLeaseDir(),
  worktree = process.cwd(),
  pid = process.pid,
  minPort = DEFAULT_MIN_PORT,
  maxPort = DEFAULT_MAX_PORT,
  step = DEFAULT_STEP,
  probePorts = true,
  isPidAliveFn = isPidAlive,
} = {}) {
  mkdirSync(leaseDir, { recursive: true });

  for (const blockBase of candidateBlockBases({ minPort, maxPort, step })) {
    const leaseFile = resolve(leaseDir, `${blockBase}.json`);
    const leaseData = {
      pid,
      worktree,
      suite,
      blockBase,
      ports: portsForBlock(blockBase, size),
      startedAt: new Date().toISOString(),
    };
    const content = `${serializeLease(leaseData)}\n`;

    const acquired =
      createFileExclusive(leaseFile, content) || tryReclaimLease(leaseFile, content, isPidAliveFn);
    if (!acquired) continue;

    if (probePorts && !(await probeBlockPorts(leaseData.ports))) {
      // A non-harness process holds one of the ports (or the OS reserves it): try the next block.
      rmSync(leaseFile, { force: true });
      continue;
    }

    return {
      ...leaseData,
      leaseFile,
      released: false,
    };
  }

  throw new Error(`Failed to acquire port block of size ${size} in range ${minPort}-${maxPort}`);
}

export function releasePortBlock(lease, { leaseDir = getDefaultLeaseDir() } = {}) {
  if (!lease) return;
  if (lease.released) return;

  const leaseFile = lease.leaseFile || resolve(leaseDir, `${lease.blockBase}.json`);
  try {
    unlinkSync(leaseFile);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  lease.released = true;
}

export function listLeases({
  leaseDir = getDefaultLeaseDir(),
  isPidAliveFn = isPidAlive,
} = {}) {
  if (!existsSync(leaseDir)) return [];

  const files = readdirSync(leaseDir).filter((f) => f.endsWith('.json'));
  const leases = [];

  for (const file of files) {
    const fullPath = resolve(leaseDir, file);
    try {
      const content = readFileSync(fullPath, 'utf8');
      const data = deserializeLease(content);
      const stale = isStale(data, { isPidAliveFn });
      leases.push({
        ...data,
        leaseFile: fullPath,
        stale,
      });
    } catch {
      // Unparseable: an orphan once past the grace period, otherwise possibly mid-write.
      const match = /^(\d+)\.json$/.exec(file);
      const blockBase = match ? Number(match[1]) : NaN;
      leases.push({
        pid: -1,
        worktree: 'unknown',
        suite: 'unknown',
        blockBase,
        ports: Number.isInteger(blockBase) ? portsForBlock(blockBase) : [],
        startedAt: 'unknown',
        leaseFile: fullPath,
        stale: fileAgeMs(fullPath) > UNPARSEABLE_LEASE_GRACE_MS,
      });
    }
  }

  return leases.sort((a, b) => a.blockBase - b.blockBase);
}
